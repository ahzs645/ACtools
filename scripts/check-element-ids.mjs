import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guards the contract between the assembled surface HTML and the popup code.
 *
 * `getPopupElements()` resolves ~200 elements by literal selector and throws if
 * any is missing, so a renamed id — or a panel partial dropped from the include
 * list — is a hard failure the moment that surface loads. Checking the built
 * HTML turns that into a build error with a file:line instead.
 */
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = resolve(rootDir, "dist/sidepanel.html");
// Only the popup drives this markup; content scripts query AlayaCare's own DOM.
const sourceDir = resolve(rootDir, "src/popup");

// Matched against whole file text, not line by line: the formatter wraps long
// calls, so the selector often sits on its own line.
//
// Every `"#..."` literal is treated as a selector rather than only those inside
// a querySelector call, because several modules resolve elements through helpers
// (`required`, `requireElement`). Every such literal in src/popup is a selector
// today; a non-selector one added later would report here and need excluding.
const PATTERNS = [
  { regex: /getElementById\(\s*"([^"]+)"/g, kind: "id" },
  { regex: /"#([A-Za-z0-9_-]+)"/g, kind: "id" },
  // Collection queries are guarded by `.length === 0`, so an empty result is
  // the symptom of a partial that never made it into the page.
  { regex: /querySelectorAll(?:<[^>]*>)?\(\s*"\[(data-[a-z0-9-]+)\]"/g, kind: "data" },
  { regex: /showDetail\([^)]*?"([a-z0-9-]+)"\s*\)/g, kind: "panel" }
];

function typescriptFiles(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      typescriptFiles(path, found);
    } else if (path.endsWith(".ts")) {
      found.push(path);
    }
  }

  return found;
}

const html = readFileSync(htmlPath, "utf8");
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const dataAttributes = new Set([...html.matchAll(/\s(data-[a-z0-9-]+)[="\s>]/g)].map((m) => m[1]));

const missing = {
  id: (value) => (ids.has(value) ? null : `no element with id "${value}"`),
  data: (value) => (dataAttributes.has(value) ? null : `no element carries [${value}]`),
  panel: (value) =>
    ids.has(`panel-${value}`) ? null : `showDetail("${value}") has no #panel-${value}`
};

const failures = [];

for (const file of typescriptFiles(sourceDir)) {
  const source = readFileSync(file, "utf8");
  // Offset -> line number, so a wrapped call still reports where it starts.
  const lineStarts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "\n") lineStarts.push(i + 1);
  }
  const lineAt = (offset) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (lineStarts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };

  for (const { regex, kind } of PATTERNS) {
    for (const match of source.matchAll(regex)) {
      const problem = missing[kind](match[1]);
      if (problem) {
        failures.push(`${relative(rootDir, file)}:${lineAt(match.index)}  ${problem}`);
      }
    }
  }
}

// Every launcher tile target needs a panel to show.
for (const match of html.matchAll(/data-tool-panel="([^"]+)"/g)) {
  if (!ids.has(`panel-${match[1]}`)) {
    failures.push(`sidepanel.html  data-tool-panel="${match[1]}" has no #panel-${match[1]}`);
  }
}

if (failures.length > 0) {
  console.error(`\nElement contract broken in ${relative(rootDir, htmlPath)}:\n`);
  for (const failure of failures.sort()) console.error(`  ${failure}`);
  console.error("");
  process.exit(1);
}

console.log(`Element contract OK: ${ids.size} ids, ${dataAttributes.size} data attributes.`);
