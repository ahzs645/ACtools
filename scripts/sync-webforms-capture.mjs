import { copyFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
let source = resolve(process.argv[2] ?? resolve(root, "../webforms"));
try { await access(resolve(source, "tools/alayacare-bridge/capture.mjs")); source = resolve(source, "tools/alayacare-bridge"); } catch { /* Also accepts the capture directory itself. */ }
for (const name of ["capture.mjs", "capture.d.mts", "capture.test.mjs", "deployment.mjs", "deployment.d.mts", "deployment.test.mjs", "native-transport.mjs", "native-transport.d.mts", "tenant-catalog.mjs", "tenant-catalog.d.mts", "tenant-catalog.test.mjs"]) {
  await copyFile(resolve(source, name), resolve(root, "packages/ac-core/src/shared", name));
}
console.log("Synced the shared Webforms form-definition capture module and tests.");
