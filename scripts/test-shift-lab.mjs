import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { expandHtml } from "./html-include.mjs";

const tempDirectory = await mkdtemp(join(tmpdir(), "ac-tools-shift-lab-"));
const bundlePath = join(tempDirectory, "shiftLab.mjs");

try {
  await build({
    entryPoints: ["src/shared/shiftLab.ts"],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent"
  });
  const shiftLab = await import(`${pathToFileURL(bundlePath).href}?test=${Date.now()}`);

  assert.equal(
    shiftLab.calculateShiftDurationHours("2026-09-01T07:30", "2026-09-01T16:00"),
    8.5
  );
  assert.equal(shiftLab.validateScenarioIdentifier("S0000000032", "S"), "S0000000032");
  assert.equal(shiftLab.validateScenarioIdentifier("r0000000032", "R"), "R0000000032");
  assert.equal(
    shiftLab.nextScenarioIdentifier("S", ["S0000000031", "S0000000032"]),
    "S0000000033"
  );
  assert.equal(
    shiftLab.nextScenarioIdentifier("R", ["R0000000032"]),
    "R0000000033"
  );
  assert.throws(() => shiftLab.validateScenarioIdentifier("S32", "S"), /10 digits/);
  assert.throws(
    () => shiftLab.calculateShiftDurationHours("2026-09-01T16:00", "2026-09-01T07:30"),
    /greater than 0/
  );
  assert.deepEqual(shiftLab.parseShiftLabRegistry(null), {
    schemaVersion: 1,
    rulesets: [],
    shifts: []
  });
  assert.deepEqual(
    shiftLab.parseShiftLabRegistry({ schemaVersion: 1, rulesets: [], shifts: [] }),
    { schemaVersion: 1, rulesets: [], shifts: [] }
  );

  const ruleset = {
    kind: "ac-tools/shift-ruleset",
    schemaVersion: 1,
    rulesetId: "R0000000032",
    name: "Approved",
    overtimeApproved: true,
    ignoreCapacity: false,
    ignoreFatigue: false,
    canShiftSwap: true,
    rules: [],
    createdAt: "2026-08-21T00:00:00.000Z",
    storageScope: "extension-local"
  };
  const readyEvaluation = shiftLab.evaluateShiftFixture({
    overtimeEligibility: "Ruleset",
    durationHours: 8.5,
    payDurationHours: 8,
    ruleset
  });
  assert.equal(readyEvaluation.status, "ready");
  assert.equal(readyEvaluation.items.find((item) => item.id === "overtime")?.tone, "pass");
  assert.equal(readyEvaluation.items.find((item) => item.id === "capacity")?.tone, "not-evaluated");
  assert.equal(
    shiftLab.evaluateShiftFixture({
      overtimeEligibility: "Ruleset",
      durationHours: 8.5,
      payDurationHours: 8
    }).status,
    "blocked"
  );

  const blockedNativeReadiness = shiftLab.buildNativeVisitReadiness({
    hasServiceLocation: true,
    hasValidTimes: true
  });
  assert.equal(blockedNativeReadiness.canCreateNativeVisit, false);
  assert.equal(blockedNativeReadiness.items.find((item) => item.id === "client")?.tone, "blocked");
  assert.equal(
    shiftLab.buildNativeVisitReadiness({
      hasServiceLocation: true,
      hasValidTimes: true,
      patientId: 1341,
      serviceId: 9876
    }).canCreateNativeVisit,
    true
  );

  const html = expandHtml(await readFile("sidepanel.html", "utf8"), process.cwd());
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicateIds, []);
  for (const requiredId of [
    "panel-shift-lab",
    "shift-lab-uat-confirm",
    "shift-location-search-input",
    "shift-native-readiness",
    "shift-native-readiness-list",
    "shift-ruleset-form",
    "shift-scenario-form",
    "shift-fixture-evaluation",
    "shift-fixture-evaluation-list",
    "shift-export-last",
    "shift-export-registry"
  ]) {
    assert.ok(ids.includes(requiredId), `Missing Shift Lab control: ${requiredId}`);
  }

  console.log("Shift Lab tests passed: fixture math, identifiers, evaluation, readiness, registry, and UI contract.");
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
