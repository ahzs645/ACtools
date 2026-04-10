#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

async function main() {
  const pkgPath = resolve(rootDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  const version = pkg.version;

  if (!version || typeof version !== "string") {
    throw new Error("package.json is missing a version field.");
  }

  console.log(`Packaging AC Tools v${version}`);

  await syncManifestVersion(version);

  console.log("Running build\u2026");
  await runCommand("node", ["scripts/build.mjs"], { cwd: rootDir });

  const releasesDir = resolve(rootDir, "releases");
  await mkdir(releasesDir, { recursive: true });

  const zipName = `ac-tools-v${version}.zip`;
  const zipPath = resolve(releasesDir, zipName);
  await rm(zipPath, { force: true });

  console.log(`Creating ${zipName}\u2026`);
  await runCommand("zip", ["-r", zipPath, "."], {
    cwd: resolve(rootDir, "dist")
  });

  const stats = await stat(zipPath);
  const sizeKb = (stats.size / 1024).toFixed(1);
  console.log(`Wrote releases/${zipName} (${sizeKb} KB)`);
}

async function syncManifestVersion(version) {
  const manifestPath = resolve(rootDir, "public/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  if (manifest.version === version) {
    return;
  }

  manifest.version = version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Updated public/manifest.json to version ${version}`);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
