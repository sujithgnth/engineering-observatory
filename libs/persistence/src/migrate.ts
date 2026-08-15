import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

function loadLocalEnvironment() {
  try {
    process.loadEnvFile?.(".env");
  } catch {
    // Environment injection is preferred outside local development.
  }
}

export async function migrate(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  const migrationsDirectory = fileURLToPath(
    new URL("./migrations", import.meta.url),
  );
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    for (const migrationFile of migrationFiles) {
      const sql = await readFile(
        path.join(migrationsDirectory, migrationFile),
        "utf8",
      );
      await pool.query(sql);
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  loadLocalEnvironment();
  await migrate();
  process.stdout.write(
    "Engineering Observatory database migration complete.\n",
  );
}

if (
  process.argv[1] &&
  path.basename(process.argv[1]) === "migrate.ts" &&
  fileURLToPath(import.meta.url) === process.argv[1]
) {
  void main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown migration failure";
    process.stderr.write(`Migration failed: ${message}\n`);
    process.exitCode = 1;
  });
}
