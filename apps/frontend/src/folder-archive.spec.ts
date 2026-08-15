// @vitest-environment jsdom

import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildFolderArchive, selectedFolderName } from "./folder-archive";

function folderFile(path: string, contents: string): File {
  const file = new File([contents], path.split("/").at(-1) ?? "file");
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

describe("local folder archive", () => {
  it("packages source relative to the chosen root and skips generated folders", async () => {
    const files = [
      folderFile("checkout/package.json", '{"name":"checkout"}'),
      folderFile("checkout/src/app.ts", "export const app = true;"),
      folderFile("checkout/node_modules/library/index.js", "ignored"),
      folderFile("checkout/dist/bundle.js", "ignored"),
    ];

    const archive = await buildFolderArchive(files);
    const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));

    expect(selectedFolderName(files)).toBe("checkout");
    expect(Object.keys(entries).sort()).toEqual(["package.json", "src/app.ts"]);
    expect(new TextDecoder().decode(entries["src/app.ts"])).toContain("app");
  });

  it("rejects unsafe relative paths before reading file contents", async () => {
    await expect(
      buildFolderArchive([folderFile("checkout/../secret.txt", "secret")]),
    ).rejects.toThrow(/unsafe file path/i);
  });
});
