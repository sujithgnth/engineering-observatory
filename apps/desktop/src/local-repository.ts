import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import fastGlob from "fast-glob";
import { create as createTar } from "tar";

export const DESKTOP_REPOSITORY_LIMITS = {
  maximumCompressedBytes: 25 * 1024 * 1024,
  maximumFileBytes: 5 * 1024 * 1024,
  maximumFiles: 20_000,
  maximumInputBytes: 150 * 1024 * 1024,
} as const;

const EXCLUDED_DIRECTORIES = [
  ".angular",
  ".git",
  ".next",
  ".nx",
  ".observatory",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
];

export function ignoredRepositoryPath(entryPath: string): boolean {
  const segments = entryPath.split(/[\\/]/).filter(Boolean);
  return (
    segments.some((segment) =>
      EXCLUDED_DIRECTORIES.includes(segment.toLowerCase()),
    ) ||
    segments.at(-1) === ".DS_Store" ||
    (segments.at(-1)?.startsWith("._") ?? false)
  );
}

export async function createDesktopRepositoryArchive(root: string) {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("Choose a real project directory");
  }

  const candidates = await fastGlob("**/*", {
    cwd: root,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    unique: true,
    ignore: EXCLUDED_DIRECTORIES.flatMap((directory) => [
      `${directory}/**`,
      `**/${directory}/**`,
    ]),
  });
  const files = candidates
    .filter((entry) => !ignoredRepositoryPath(entry))
    .sort();
  if (files.length === 0) {
    throw new Error(
      "No analyzable files remain after generated folders were skipped",
    );
  }
  if (files.length > DESKTOP_REPOSITORY_LIMITS.maximumFiles) {
    throw new Error("The project contains more than 20,000 analyzable files");
  }

  let inputBytes = 0;
  for (const file of files) {
    const info = await lstat(path.join(root, file));
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`Unsupported repository entry: ${file}`);
    }
    if (info.size > DESKTOP_REPOSITORY_LIMITS.maximumFileBytes) {
      throw new Error(`File is larger than 5 MB: ${file}`);
    }
    inputBytes += info.size;
  }
  if (inputBytes > DESKTOP_REPOSITORY_LIMITS.maximumInputBytes) {
    throw new Error(
      "The project contains more than 150 MB of analyzable source",
    );
  }

  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "frontend-intelligence-desktop-"),
  );
  const archivePath = path.join(temporaryDirectory, `${randomUUID()}.tar.gz`);
  try {
    await createTar(
      {
        cwd: root,
        file: archivePath,
        gzip: true,
        portable: true,
        noMtime: true,
      },
      files,
    );
    const archiveInfo = await stat(archivePath);
    if (archiveInfo.size > DESKTOP_REPOSITORY_LIMITS.maximumCompressedBytes) {
      throw new Error("The prepared project archive is larger than 25 MB");
    }
    return {
      archivePath,
      temporaryDirectory,
      fileCount: files.length,
      inputBytes,
      compressedBytes: archiveInfo.size,
    };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}
