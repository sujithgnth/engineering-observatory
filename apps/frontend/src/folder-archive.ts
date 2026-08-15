import { zip } from "fflate";

export const LOCAL_FOLDER_LIMITS = {
  maximumCompressedBytes: 25 * 1024 * 1024,
  maximumFileBytes: 5 * 1024 * 1024,
  maximumFiles: 5_000,
  maximumInputBytes: 50 * 1024 * 1024,
} as const;

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".angular",
  ".git",
  ".next",
  ".nx",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

function sourcePath(file: File): string {
  return file.webkitRelativePath || file.name;
}

function pathSegments(path: string): string[] {
  if (path.includes("\\") || path.includes("\0") || path.startsWith("/")) {
    throw new Error("The selected folder contains an unsafe file path");
  }

  const segments = path.split("/");
  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("The selected folder contains an unsafe file path");
  }
  return segments;
}

export function selectedFolderName(files: readonly File[]): string {
  const first = files[0];
  if (!first) return "";
  const segments = pathSegments(sourcePath(first));
  return segments.length > 1 && segments[0] ? segments[0] : "Local repository";
}

function archivePath(file: File, commonRoot: string | null): string | null {
  const segments = pathSegments(sourcePath(file));
  const relativeSegments =
    commonRoot && segments[0] === commonRoot ? segments.slice(1) : segments;

  if (
    relativeSegments.length === 0 ||
    relativeSegments.some((segment) =>
      EXCLUDED_DIRECTORY_NAMES.has(segment.toLowerCase()),
    ) ||
    relativeSegments.at(-1) === ".DS_Store"
  ) {
    return null;
  }

  return relativeSegments.join("/");
}

function commonFolderRoot(files: readonly File[]): string | null {
  const paths = files.map((file) => pathSegments(sourcePath(file)));
  const first = paths[0];
  const candidate = first && first.length > 1 ? first[0] : null;
  return candidate &&
    paths.every((segments) => segments.length > 1 && segments[0] === candidate)
    ? candidate
    : null;
}

function compress(entries: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(entries, { level: 6 }, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

export async function buildFolderArchive(
  files: readonly File[],
): Promise<File> {
  if (files.length === 0) throw new Error("Choose a project folder first");

  const root = commonFolderRoot(files);
  const selected: Array<{ file: File; path: string }> = [];
  const seen = new Set<string>();
  let inputBytes = 0;

  for (const file of files) {
    const path = archivePath(file, root);
    if (!path) continue;
    if (file.size > LOCAL_FOLDER_LIMITS.maximumFileBytes) {
      throw new Error(`File is larger than 5 MB: ${path}`);
    }
    if (seen.has(path)) {
      throw new Error(`The selected folder contains a duplicate path: ${path}`);
    }
    seen.add(path);
    inputBytes += file.size;
    selected.push({ file, path });
  }

  if (selected.length === 0) {
    throw new Error(
      "No analyzable files remain after generated folders were skipped",
    );
  }
  if (selected.length > LOCAL_FOLDER_LIMITS.maximumFiles) {
    throw new Error("The folder contains more than 5,000 analyzable files");
  }
  if (inputBytes > LOCAL_FOLDER_LIMITS.maximumInputBytes) {
    throw new Error("The folder contains more than 50 MB of analyzable source");
  }

  const entries: Record<string, Uint8Array> = {};
  for (const entry of selected) {
    entries[entry.path] = new Uint8Array(await entry.file.arrayBuffer());
  }
  const archive = await compress(entries);
  if (archive.byteLength > LOCAL_FOLDER_LIMITS.maximumCompressedBytes) {
    throw new Error("The prepared folder archive is larger than 25 MB");
  }

  const folderName = (root || "local-repository").replace(
    /[^A-Za-z0-9_.-]+/g,
    "-",
  );
  const bytes = archive.buffer.slice(
    archive.byteOffset,
    archive.byteOffset + archive.byteLength,
  ) as ArrayBuffer;
  return new File([bytes], `${folderName}.zip`, {
    type: "application/zip",
  });
}
