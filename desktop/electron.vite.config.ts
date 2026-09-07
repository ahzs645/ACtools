import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

import { htmlInclude } from "../scripts/html-include.mjs";

const repoRoot = resolve(__dirname, "..");
const core = resolve(repoRoot, "packages/ac-core/src");

/**
 * Three bundles:
 *
 * - main: Electron main process. Hosts the ac-core router, the API-key
 *   pathway (Node fetch), and the session pathway (per-tenant Electron
 *   sessions with the tenant's cookies).
 * - preload: exposes `window.acBridge` so the AC Tools panel can talk to main.
 * - renderer: the AC Tools side panel itself, built from the repository root
 *   with the same HTML partials plugin the extension build uses. Nothing here
 *   is forked from the extension.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { "@ac-core": core } },
    build: {
      rollupOptions: { input: resolve(__dirname, "src/main/index.ts") }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/preload/index.ts"),
        output: { format: "cjs", entryFileNames: "[name].cjs" }
      }
    }
  },
  renderer: {
    root: repoRoot,
    base: "./",
    publicDir: resolve(repoRoot, "public"),
    plugins: [htmlInclude({ root: repoRoot, entries: ["sidepanel.html"] })],
    resolve: { alias: { "@ac-core": core } },
    build: {
      outDir: resolve(__dirname, "out/renderer"),
      emptyOutDir: true,
      rollupOptions: { input: resolve(repoRoot, "sidepanel.html") }
    }
  }
});
