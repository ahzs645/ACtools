declare module "*/scripts/html-include.mjs" {
  import type { Plugin } from "vite";

  export function expandHtml(html: string, root: string, trail?: string[]): string;
  export function htmlInclude(options: { root: string; entries: string[] }): Plugin;
}
