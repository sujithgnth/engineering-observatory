import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import * as tar from "tar";
import yauzl from "yauzl";

export type ArchivePolicy = {
  maxCompressedBytes: number;
  maxExtractedBytes: number;
  maxEntries: number;
  maxFileBytes: number;
};

export const DEFAULT_ARCHIVE_POLICY: ArchivePolicy = {
  maxCompressedBytes: 25 * 1024 * 1024,
  maxExtractedBytes: 150 * 1024 * 1024,
  maxEntries: 20_000,
  maxFileBytes: 5 * 1024 * 1024,
};

const ALLOWED_EXTENSIONS = [".zip", ".tar", ".tar.gz", ".tgz"];

export function validateArchiveEntryPath(entryPath: string): string {
  if (!entryPath || entryPath.includes("\0"))
    throw new Error("archive_invalid_path");
  const unixPath = entryPath.replaceAll("\\", "/");
  if (/^[A-Za-z]:/.test(unixPath) || unixPath.startsWith("/")) {
    throw new Error("archive_absolute_path");
  }
  const normalized = path.posix.normalize(unixPath);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("archive_path_traversal");
  }
  return normalized.replace(/^\.\//, "");
}

function assertInsideRoot(root: string, relativePath: string): string {
  const destination = path.resolve(root, relativePath);
  const relative = path.relative(path.resolve(root), destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("archive_path_traversal");
  }
  return destination;
}

function extensionFor(fileName: string): string {
  const lower = fileName.toLowerCase();
  const extension = ALLOWED_EXTENSIONS.find((candidate) =>
    lower.endsWith(candidate),
  );
  if (!extension) throw new Error("archive_unsupported_type");
  return extension;
}

export class LocalArtifactStore {
  constructor(
    private readonly root = path.resolve(
      process.env.ARTIFACT_ROOT ?? ".observatory/artifacts",
    ),
    private readonly policy = DEFAULT_ARCHIVE_POLICY,
  ) {}

  async put(
    fileName: string,
    bytes: Uint8Array,
  ): Promise<{ path: string; sha256: string }> {
    const extension = extensionFor(fileName);
    if (bytes.byteLength > this.policy.maxCompressedBytes)
      throw new Error("archive_too_large");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await mkdir(this.root, { recursive: true });
    const artifactPath = path.join(this.root, `${randomUUID()}${extension}`);
    await writeFile(artifactPath, bytes, { flag: "wx", mode: 0o600 });
    return { path: artifactPath, sha256 };
  }

  async delete(artifactPath: string) {
    const resolved = path.resolve(artifactPath);
    const relative = path.relative(this.root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("artifact_outside_store");
    }
    await rm(resolved, { force: true });
  }
}

export async function createIsolatedWorkspace(): Promise<string> {
  const base = path.resolve(".observatory/work");
  await mkdir(base, { recursive: true });
  return mkdtemp(path.join(base, "analysis-"));
}

export async function cleanupWorkspace(workspace: string) {
  const allowedRoot = path.resolve(".observatory/work");
  const resolved = path.resolve(workspace);
  const relative = path.relative(allowedRoot, resolved);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !path.basename(resolved).startsWith("analysis-")
  ) {
    throw new Error("workspace_cleanup_rejected");
  }
  await rm(resolved, { recursive: true, force: true });
}

export async function extractArchive(
  archivePath: string,
  destination: string,
  policy = DEFAULT_ARCHIVE_POLICY,
) {
  const archiveStats = await stat(archivePath);
  if (archiveStats.size > policy.maxCompressedBytes)
    throw new Error("archive_too_large");
  await mkdir(destination, { recursive: true });
  const lower = archivePath.toLowerCase();
  if (lower.endsWith(".zip")) {
    await extractZip(archivePath, destination, policy);
    return;
  }
  if (
    lower.endsWith(".tar") ||
    lower.endsWith(".tar.gz") ||
    lower.endsWith(".tgz")
  ) {
    await extractTar(archivePath, destination, policy);
    return;
  }
  throw new Error("archive_unsupported_type");
}

async function extractTar(
  archivePath: string,
  destination: string,
  policy: ArchivePolicy,
) {
  let entries = 0;
  let totalBytes = 0;
  let validationError: Error | null = null;
  await tar.list({
    file: archivePath,
    strict: true,
    onReadEntry: (entry) => {
      if (validationError) return;
      try {
        entries += 1;
        if (entries > policy.maxEntries)
          throw new Error("archive_too_many_entries");
        const safePath = validateArchiveEntryPath(entry.path);
        assertInsideRoot(destination, safePath);
        if (!["File", "Directory"].includes(entry.type))
          throw new Error("archive_link_rejected");
        if (entry.size > policy.maxFileBytes)
          throw new Error("archive_file_too_large");
        totalBytes += entry.size;
        if (totalBytes > policy.maxExtractedBytes)
          throw new Error("archive_expansion_too_large");
      } catch (error) {
        validationError =
          error instanceof Error ? error : new Error("archive_rejected");
      }
    },
  });
  if (validationError) throw validationError;
  await tar.extract({
    file: archivePath,
    cwd: destination,
    strict: true,
    preservePaths: false,
    filter: (entryPath, entry) => {
      const safePath = validateArchiveEntryPath(entryPath);
      assertInsideRoot(destination, safePath);
      return "type" in entry && ["File", "Directory"].includes(entry.type);
    },
  });
}

async function extractZip(
  archivePath: string,
  destination: string,
  policy: ArchivePolicy,
) {
  await new Promise<void>((resolve, reject) => {
    yauzl.open(
      archivePath,
      { lazyEntries: true, autoClose: true },
      (openError, zipFile) => {
        if (openError || !zipFile)
          return reject(openError ?? new Error("archive_open_failed"));
        let entries = 0;
        let totalBytes = 0;
        let settled = false;
        const fail = (error: unknown) => {
          if (settled) return;
          settled = true;
          zipFile.close();
          reject(error);
        };

        zipFile.on("error", fail);
        zipFile.on("end", () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        });
        zipFile.on("entry", (entry) => {
          void (async () => {
            entries += 1;
            if (entries > policy.maxEntries)
              throw new Error("archive_too_many_entries");
            const safePath = validateArchiveEntryPath(entry.fileName);
            const destinationPath = assertInsideRoot(destination, safePath);
            const unixMode = (entry.externalFileAttributes >>> 16) & 0o170000;
            if (unixMode === 0o120000) throw new Error("archive_link_rejected");
            if (entry.uncompressedSize > policy.maxFileBytes)
              throw new Error("archive_file_too_large");
            totalBytes += entry.uncompressedSize;
            if (totalBytes > policy.maxExtractedBytes)
              throw new Error("archive_expansion_too_large");

            if (entry.fileName.endsWith("/")) {
              await mkdir(destinationPath, { recursive: true });
              zipFile.readEntry();
              return;
            }

            await mkdir(path.dirname(destinationPath), { recursive: true });
            const source = await new Promise<NodeJS.ReadableStream>(
              (streamResolve, streamReject) => {
                zipFile.openReadStream(entry, (streamError, stream) => {
                  if (streamError || !stream)
                    streamReject(
                      streamError ?? new Error("archive_read_failed"),
                    );
                  else streamResolve(stream);
                });
              },
            );
            await pipeline(
              source,
              createWriteStream(destinationPath, { flags: "wx", mode: 0o600 }),
            );
            zipFile.readEntry();
          })().catch(fail);
        });
        zipFile.readEntry();
      },
    );
  });
}

export async function readArtifactBytes(artifactPath: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const stream = createReadStream(artifactPath);
  for await (const chunk of stream)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function temporaryArchivePath(extension = ".tar.gz") {
  return path.join(
    tmpdir(),
    `engineering-observatory-${randomUUID()}${extension}`,
  );
}
