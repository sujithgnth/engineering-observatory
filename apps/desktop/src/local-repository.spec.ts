import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { list as listTar } from "tar";
import { afterEach, describe, expect, it } from "vitest";

import {
  createDesktopRepositoryArchive,
  ignoredRepositoryPath,
} from "./local-repository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("desktop local repository packaging", () => {
  it("packages source and excludes generated directories", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "desktop-repository-test-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "node_modules/library"), { recursive: true });
    await writeFile(path.join(root, "package.json"), '{"name":"demo"}');
    await writeFile(path.join(root, "src/app.ts"), "export const app = true;");
    await writeFile(
      path.join(root, "node_modules/library/index.js"),
      "ignored",
    );

    const archive = await createDesktopRepositoryArchive(root);
    temporaryDirectories.push(archive.temporaryDirectory);
    const entries: string[] = [];
    await listTar({
      file: archive.archivePath,
      onReadEntry: (entry) => entries.push(entry.path),
    });

    expect(entries).toEqual(["package.json", "src/app.ts"]);
    expect(archive.fileCount).toBe(2);
  });

  it("recognizes generated and macOS metadata paths", () => {
    expect(ignoredRepositoryPath("packages/app/dist/index.js")).toBe(true);
    expect(ignoredRepositoryPath("src/._app.ts")).toBe(true);
    expect(ignoredRepositoryPath("src/app.ts")).toBe(false);
  });
});
