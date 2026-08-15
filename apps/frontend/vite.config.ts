import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig, type PluginOption } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
const analyzeBundle = process.env["ANALYZE_BUNDLE"] === "true";

export default defineConfig({
  root: path.join(workspaceRoot, "apps/frontend"),
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        {
          src: path.join(workspaceRoot, "node_modules/monaco-editor/min/vs"),
          dest: "monaco",
        },
      ],
    }),
    ...(analyzeBundle
      ? [
          visualizer({
            filename: path.join(workspaceRoot, "artifacts/bundle/treemap.html"),
            title: "Engineering Observatory bundle",
            template: "treemap",
            gzipSize: true,
            brotliSize: true,
            projectRoot: workspaceRoot,
          }) as PluginOption,
          visualizer({
            filename: path.join(
              workspaceRoot,
              "artifacts/bundle/raw-data.json",
            ),
            template: "raw-data",
            gzipSize: true,
            brotliSize: true,
            projectRoot: workspaceRoot,
          }) as PluginOption,
          visualizer({
            filename: path.join(workspaceRoot, "artifacts/bundle/report.md"),
            template: "markdown",
            gzipSize: true,
            brotliSize: true,
            projectRoot: workspaceRoot,
          }) as PluginOption,
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@engineering-observatory/shared-types": path.join(
        workspaceRoot,
        "libs/shared-types/src/index.ts",
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3333",
    },
  },
  build: {
    outDir: path.join(workspaceRoot, "dist/apps/frontend"),
    emptyOutDir: true,
  },
});
