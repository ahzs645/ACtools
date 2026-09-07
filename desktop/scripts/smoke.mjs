#!/usr/bin/env node
/**
 * Headless smoke test for the desktop app.
 *
 * Launches the built app (run `npm run build` first) with the smoke hooks in
 * `src/main/index.ts`: the panel's console is logged, a bridge round-trip is
 * executed in the page, a screenshot is written, and the process exits
 * non-zero if the renderer logged an error or the round-trip failed.
 *
 * On Linux without a display, run under `xvfb-run -a`.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electronBinary = require("electron");

const screenshot = process.env.AC_TOOLS_SMOKE_SCREENSHOT ?? resolve(desktopDir, "smoke.png");

// Exercises storage tiers, the router, and the desktop-only session messages
// against a tenant that refuses connections, so every path returns quickly.
const bridgeExercise = `(async () => {
  const bridge = window.acBridge;
  if (!bridge) throw new Error("window.acBridge is missing");
  await bridge.storage.local.set("smoke", { ok: true });
  const stored = await bridge.storage.local.get("smoke");
  await bridge.storage.session.set("smoke-session", 1);
  const sessionKeys = await bridge.storage.session.keys();
  const saved = await bridge.sendMessage({
    type: "ac/popup/save-environment",
    payload: { name: "Smoke", origin: "http://localhost:1", supportUrl: "https://healthbc.service-now.com/" }
  });
  const selected = await bridge.sendMessage({ type: "ac/popup/desktop/select-tenant", payload: { origin: "http://localhost:1" } });
  const credentials = await bridge.sendMessage({ type: "ac/popup/get-employee-api-credential-status" });
  const status = await bridge.sendMessage({ type: "ac/popup/get-status" });
  await bridge.sendMessage({ type: "ac/popup/delete-environment", payload: { origin: "http://localhost:1" } });
  await bridge.storage.local.remove("smoke");
  const checks = {
    stored: stored?.ok === true,
    sessionKeys: sessionKeys.includes("smoke-session"),
    saved: saved.ok === true,
    selected: selected.ok === true && selected.data.activeOrigin === "http://localhost:1",
    credentials: credentials.ok === true && credentials.data.configured === false,
    status: status.ok === true && status.data.ready === false,
    surface: document.documentElement.dataset.surface === "desktop",
    tenantBar: document.getElementById("desktop-tenant-bar").hidden === false
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length > 0) throw new Error("bridge checks failed: " + failed.join(", "));
  return checks;
})()`;

const child = spawn(electronBinary, ["--no-sandbox", desktopDir], {
  cwd: desktopDir,
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_DISABLE_SANDBOX: "1",
    AC_TOOLS_SMOKE_SCREENSHOT: screenshot,
    AC_TOOLS_SMOKE_EVAL: bridgeExercise
  }
});

const timeout = setTimeout(() => {
  console.error("[smoke] timed out after 120 s");
  child.kill("SIGKILL");
  process.exitCode = 1;
}, 120_000);

child.on("exit", (code) => {
  clearTimeout(timeout);
  process.exitCode = code ?? 1;
});
