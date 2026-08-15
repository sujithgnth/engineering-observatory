import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@engineering-observatory/shared-types": `${root}libs/shared-types/src/index.ts`,
      "@engineering-observatory/scanners": `${root}libs/scanners/src/index.ts`,
      "@engineering-observatory/analyzer-engine": `${root}libs/analyzer-engine/src/index.ts`,
      "@engineering-observatory/frontend-intelligence": `${root}libs/frontend-intelligence/src/index.ts`,
      "@engineering-observatory/ai-adapter": `${root}libs/ai-adapter/src/index.ts`,
      "@engineering-observatory/persistence": `${root}libs/persistence/src/index.ts`,
      "@engineering-observatory/performance-engine": `${root}libs/performance-engine/src/index.ts`,
    },
  },
  test: {
    include: ["apps/**/*.spec.{ts,tsx}", "libs/**/*.spec.{ts,tsx}"],
    setupFiles: ["apps/frontend/src/test-setup.ts"],
    coverage: {
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
    },
  },
});
