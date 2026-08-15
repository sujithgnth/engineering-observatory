import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";
import * as tar from "tar";

import { scanRepository } from "./scanner";
import { extractArchive, validateArchiveEntryPath } from "./archive";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true })),
  );
});

describe("repository scanner", () => {
  it("profiles a mixed React and NestJS repository from manifests", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "observatory-scanner-"));
    workspaces.push(root);
    await mkdir(path.join(root, "apps/frontend/src"), { recursive: true });
    await mkdir(path.join(root, "apps/backend/src"), { recursive: true });
    await writeFile(path.join(root, "package-lock.json"), "{}");
    await writeFile(path.join(root, "nx.json"), "{}");
    await writeFile(
      path.join(root, "apps/frontend/package.json"),
      JSON.stringify({
        name: "frontend",
        dependencies: { react: "19.0.0", typescript: "5.9.0" },
      }),
    );
    await writeFile(
      path.join(root, "apps/backend/package.json"),
      JSON.stringify({
        name: "backend",
        dependencies: { "@nestjs/core": "11.0.0", pg: "8.0.0" },
      }),
    );
    await writeFile(
      path.join(root, "apps/frontend/src/app.tsx"),
      "export const App = () => <div />;",
    );
    await writeFile(
      path.join(root, "apps/backend/src/main.ts"),
      "export {};\n",
    );

    const profile = await scanRepository(root, randomUUID());

    expect(profile.monorepo).toBe(true);
    expect(profile.workspaceTool).toBe("nx");
    expect(profile.packageManager).toBe("npm");
    expect(profile.projects).toHaveLength(2);
    expect(
      profile.projects.flatMap((project) =>
        project.frameworks.map((item) => item.name),
      ),
    ).toEqual(expect.arrayContaining(["react", "typescript", "nestjs"]));
    expect(
      profile.projects.flatMap((project) =>
        project.databases.map((item) => item.name),
      ),
    ).toContain("postgresql");
  });
});

describe("archive path policy", () => {
  it.each([
    "../escape.ts",
    "/etc/passwd",
    "C:\\secret.txt",
    "safe/../../escape.ts",
  ])("rejects unsafe path %s", (entry) =>
    expect(() => validateArchiveEntryPath(entry)).toThrow(),
  );

  it("normalizes a safe archive path", () => {
    expect(validateArchiveEntryPath("project/src/main.ts")).toBe(
      "project/src/main.ts",
    );
  });

  it("rejects a symbolic link contained in a tar archive", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "observatory-tar-policy-"));
    workspaces.push(root);
    const source = path.join(root, "source");
    const destination = path.join(root, "destination");
    const archive = path.join(root, "unsafe.tgz");
    await mkdir(source);
    await writeFile(path.join(source, "target.txt"), "safe target");
    await symlink("target.txt", path.join(source, "linked.txt"));
    await tar.create({ cwd: source, file: archive, gzip: true }, ["."]);

    await expect(extractArchive(archive, destination)).rejects.toThrow(
      "archive_link_rejected",
    );
  });
});
