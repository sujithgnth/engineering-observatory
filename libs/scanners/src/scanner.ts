import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type {
  Confidence,
  DatabaseSignal,
  FrameworkSignal,
  ProjectDescriptor,
  ProjectProfile,
} from "@engineering-observatory/shared-types";
import fg from "fast-glob";

const SCANNER_VERSION = "1.0.0";
const IGNORED = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.angular/**",
  "**/.nx/**",
  "**/vendor/**",
  "**/__MACOSX/**",
  "**/._*",
  "**/.DS_Store",
];

type PackageManifest = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
};

const FRAMEWORK_PACKAGES: Array<[FrameworkSignal["name"], string[]]> = [
  ["react", ["react"]],
  ["angular", ["@angular/core"]],
  ["typescript", ["typescript"]],
  ["node", ["@types/node", "express", "fastify"]],
  ["nestjs", ["@nestjs/core"]],
];

const DATABASE_PACKAGES: Array<[DatabaseSignal["name"], string[]]> = [
  ["mongodb", ["mongodb", "mongoose", "@nestjs/mongoose"]],
  [
    "postgresql",
    [
      "pg",
      "postgres",
      "@prisma/client",
      "prisma",
      "typeorm",
      "@nestjs/typeorm",
      "sequelize",
    ],
  ],
];

async function readManifest(filePath: string): Promise<PackageManifest | null> {
  const file = await readFile(filePath, "utf8");
  if (Buffer.byteLength(file) > 1_000_000) return null;
  try {
    return JSON.parse(file) as PackageManifest;
  } catch {
    return null;
  }
}

function detectPackageManager(
  files: Set<string>,
): ProjectProfile["packageManager"] {
  if (files.has("pnpm-lock.yaml")) return "pnpm";
  if (files.has("yarn.lock")) return "yarn";
  if (files.has("bun.lock") || files.has("bun.lockb")) return "bun";
  if (files.has("package-lock.json")) return "npm";
  return "unknown";
}

function signalConfidence(version: string | undefined): Confidence {
  return version ? "high" : "medium";
}

function detectFrameworks(
  dependencies: Record<string, string>,
  evidencePath: string,
): FrameworkSignal[] {
  return FRAMEWORK_PACKAGES.flatMap(([name, packages]) => {
    const dependency = packages.find((candidate) => dependencies[candidate]);
    return dependency
      ? [
          {
            name,
            version: dependencies[dependency] ?? null,
            evidencePath,
            confidence: signalConfidence(dependencies[dependency]),
          },
        ]
      : [];
  });
}

function detectDatabases(
  dependencies: Record<string, string>,
  evidencePath: string,
): DatabaseSignal[] {
  return DATABASE_PACKAGES.flatMap(([name, packages]) => {
    const adapter = packages.find((candidate) => dependencies[candidate]);
    return adapter
      ? [
          {
            name,
            adapter: adapter ?? null,
            evidencePath,
            confidence: "high" as const,
          },
        ]
      : [];
  });
}

function projectKind(frameworks: FrameworkSignal[]): ProjectDescriptor["kind"] {
  const frontend = frameworks.some(
    (signal) => signal.name === "react" || signal.name === "angular",
  );
  const backend = frameworks.some(
    (signal) => signal.name === "nestjs" || signal.name === "node",
  );
  if (frontend && backend) return "fullstack";
  if (frontend) return "frontend";
  if (backend) return "backend";
  if (frameworks.length > 0) return "library";
  return "unknown";
}

export async function scanRepository(
  repositoryRoot: string,
  snapshotId: string,
): Promise<ProjectProfile> {
  const files = await fg(["**/*"], {
    cwd: repositoryRoot,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    ignore: IGNORED,
    absolute: false,
  });
  const normalizedFiles = files
    .map((file) => file.replaceAll(path.sep, "/"))
    .sort();
  const fileSet = new Set(normalizedFiles);
  const manifestPaths = normalizedFiles.filter((file) =>
    file.endsWith("package.json"),
  );
  const projects: ProjectDescriptor[] = [];
  const packageNames = new Map<string, string>();
  let analyzedBytes = 0;

  for (const file of normalizedFiles) {
    const fileStats = await stat(path.join(repositoryRoot, file));
    analyzedBytes += fileStats.size;
  }

  for (const manifestPath of manifestPaths) {
    const manifest = await readManifest(
      path.join(repositoryRoot, manifestPath),
    );
    if (!manifest) continue;
    const root =
      path.posix.dirname(manifestPath) === "."
        ? "."
        : path.posix.dirname(manifestPath);
    const dependencies = {
      ...(manifest.peerDependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
      ...(manifest.dependencies ?? {}),
    };
    const frameworks = detectFrameworks(dependencies, manifestPath);
    const databases = detectDatabases(dependencies, manifestPath);
    const sourceFileCount = normalizedFiles.filter(
      (file) =>
        (root === "." || file.startsWith(`${root}/`)) &&
        /\.(?:js|jsx|mjs|cjs|ts|tsx)$/.test(file),
    ).length;
    const name =
      manifest.name ?? (root === "." ? "root" : path.posix.basename(root));
    packageNames.set(name, root);
    projects.push({
      name,
      root,
      kind: projectKind(frameworks),
      frameworks,
      databases,
      dependencies,
      scripts: Object.keys(manifest.scripts ?? {}).sort(),
      sourceFileCount,
    });
  }

  if (projects.length === 0) {
    projects.push({
      name: path.basename(repositoryRoot),
      root: ".",
      kind: "unknown",
      frameworks: [],
      databases: [],
      dependencies: {},
      scripts: [],
      sourceFileCount: normalizedFiles.filter((file) =>
        /\.(?:js|jsx|ts|tsx)$/.test(file),
      ).length,
    });
  }

  const architectureEdges = projects.flatMap((project) =>
    Object.keys(project.dependencies).flatMap((dependency) => {
      const target = packageNames.get(dependency);
      return target
        ? [{ source: project.root, target, kind: "workspace" as const }]
        : [];
    }),
  );
  const workspaceTool = fileSet.has("nx.json")
    ? "nx"
    : fileSet.has("angular.json")
      ? "angular-workspace"
      : fileSet.has("turbo.json")
        ? "turborepo"
        : null;

  return {
    schemaVersion: "project-profile-v1",
    scannerVersion: SCANNER_VERSION,
    snapshotId,
    repositoryRoot: ".",
    monorepo: projects.length > 1 || workspaceTool !== null,
    workspaceTool,
    packageManager: detectPackageManager(fileSet),
    projects,
    analyzedFileCount: normalizedFiles.length,
    excludedFileCount: 0,
    analyzedBytes,
    architectureEdges,
    coverage: {
      completed: [
        "manifest-discovery",
        "framework-detection",
        "database-detection",
      ],
      skipped: [
        {
          check: "git-submodules",
          reason: "Submodules are not followed in V1",
        },
        {
          check: "git-lfs",
          reason: "Git LFS objects are not downloaded in V1",
        },
      ],
      warnings:
        manifestPaths.length === 0 ? ["No package.json was detected"] : [],
    },
  };
}

export const repositoryFilePatterns = ["**/*.{ts,tsx,js,jsx,mjs,cjs}"];
export const repositoryIgnorePatterns = IGNORED;
