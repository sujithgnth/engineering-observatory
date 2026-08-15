import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile?.(".env");
} catch {
  // The development database URL below is sufficient for client generation.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://observatory:observatory@127.0.0.1:5432/observatory",
  },
});
