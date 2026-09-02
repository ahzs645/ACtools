import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Build-time HTML partials for the extension surfaces.
 *
 * A line of the form `<!-- @include <path> -->` is replaced by the file at that
 * path, re-indented to the directive's own indentation so the assembled HTML
 * reads the same as if it had been written inline. Paths are relative to `root`.
 *
 * This runs before Vite parses the entry HTML, so script/asset resolution and
 * the emitted output are unchanged: partials are a source-layout concern only,
 * with no runtime cost and nothing for the page to fetch.
 */
const INCLUDE = /^([ \t]*)<!--\s*@include\s+(\S+)\s*-->[ \t]*\r?$/gm;

export function expandHtml(html, root, trail = []) {
  return html.replace(INCLUDE, (_line, indent, relative) => {
    if (trail.includes(relative)) {
      throw new Error(`@include cycle: ${[...trail, relative].join(" -> ")}`);
    }

    const body = readFileSync(resolve(root, relative), "utf8").replace(/\r?\n$/, "");

    return expandHtml(body, root, [...trail, relative])
      .split("\n")
      .map((line) => (line.trim() ? indent + line : line))
      .join("\n");
  });
}

function collect(html, root, found = new Set()) {
  for (const [, , relative] of html.matchAll(INCLUDE)) {
    if (found.has(relative)) {
      continue;
    }

    found.add(relative);
    collect(readFileSync(resolve(root, relative), "utf8"), root, found);
  }

  return found;
}

export function htmlInclude({ root, entries }) {
  return {
    name: "ac-html-include",
    enforce: "pre",
    buildStart() {
      // Without this, `vite build --watch` would not rebuild on a partial edit:
      // partials never enter the module graph.
      for (const entry of entries) {
        const html = readFileSync(resolve(root, entry), "utf8");
        for (const relative of collect(html, root)) {
          this.addWatchFile(resolve(root, relative));
        }
      }
    },
    transformIndexHtml: {
      order: "pre",
      handler: (html) => expandHtml(html, root)
    }
  };
}
