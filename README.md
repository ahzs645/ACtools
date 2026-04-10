# AC Tools

`AC Tools` is a Manifest V3 Chrome extension scaffold for AlayaCare scheduling utilities. It is structured to turn one-off console scripts into maintainable extension features:

- `side panel` as a persistent toolkit drawer / app launcher
- `background` for runtime routing
- `content` for page integration and overlay UI
- `shared` for typed messages and common helpers

## Current features

- `Day View` overlay for side-by-side employee schedule comparison, delivered as a jQuery-free content feature
- `Availability Test` workspace in the side panel that posts a single-day availability entry through the current AlayaCare browser session
- automatic `AC Tools` page button injection beside `.global-search`
- planned slots in the drawer for shift swap, save/restore, PDF export, and rotation tooling
- best-effort same-department and same-group filtering for employees and client visits when those arrays are present in the AlayaCare payload

## Project structure

```text
public/manifest.json      Chrome extension manifest
src/background/           MV3 service worker
src/content/              content script, overlay, page integration, AlayaCare API client
src/popup/                shared drawer UI code used by the side panel page
src/shared/               typed messages and shared helpers
scripts/build.mjs         build orchestration for popup/background/content
```

## Development

Install dependencies:

```bash
npm install
```

Watch build output into `dist/`:

```bash
npm run dev
```

Create a production build:

```bash
npm run build
```

Load `dist/` into Chrome via `chrome://extensions` with Developer Mode enabled.

## Notes

- The build uses `Vite` for the side panel page and `esbuild` for `background.js` and `content.js`.
- `content.js` is bundled as a single classic script so Chrome can load it as a manifest content script without ESM import errors.
- The extension action opens `sidepanel.html` through the Chrome `sidePanel` API instead of a popup.
- The manifest currently targets common AlayaCare host patterns plus `localhost` for local testing.
- The popup defaults still use Walter's sample values so the feature is immediately testable.
- The availability POST uses relative URLs and `credentials: "include"` so it piggybacks on the active AlayaCare session rather than storing credentials in the extension.
