import { build as esbuildBuild, context as esbuildContext } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const isWatchMode = process.argv.includes("--watch");

const popupConfig = {
  configFile: resolve(rootDir, "vite.config.ts"),
  mode: isWatchMode ? "development" : "production"
};

const backgroundOptions = {
  absWorkingDir: rootDir,
  bundle: true,
  entryPoints: [resolve(rootDir, "src/background/index.ts")],
  format: "esm",
  legalComments: "none",
  logLevel: "info",
  outfile: resolve(rootDir, "dist/background.js"),
  platform: "browser",
  sourcemap: isWatchMode ? "inline" : false,
  target: "chrome120"
};

const contentOptions = {
  absWorkingDir: rootDir,
  bundle: true,
  entryPoints: [resolve(rootDir, "src/content/index.ts")],
  format: "iife",
  legalComments: "none",
  logLevel: "info",
  outfile: resolve(rootDir, "dist/content.js"),
  platform: "browser",
  sourcemap: isWatchMode ? "inline" : false,
  target: "chrome120"
};

async function run() {
  if (isWatchMode) {
    await viteBuild({
      ...popupConfig,
      build: {
        watch: {}
      }
    });

    const [backgroundContext, contentContext] = await Promise.all([
      esbuildContext(backgroundOptions),
      esbuildContext(contentOptions)
    ]);

    await Promise.all([backgroundContext.watch(), contentContext.watch()]);
    console.log("Watching popup, background, and content builds...");
    return;
  }

  await viteBuild(popupConfig);
  await Promise.all([esbuildBuild(backgroundOptions), esbuildBuild(contentOptions)]);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
