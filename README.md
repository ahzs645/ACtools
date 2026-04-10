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

## Project structure

```text
public/manifest.json      Chrome extension manifest
src/background/           MV3 service worker
src/content/              content script, overlay, page integration, AlayaCare API client
src/popup/                shared drawer UI code used by the side panel page
src/shared/               typed messages and shared helpers
scripts/build.mjs         build orchestration for popup/background/content
scripts/package.mjs       version sync, build, and release zip
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

## Installing a release (no build required)

End users do not need to clone the repo or install Node.

1. Open the [latest release](https://github.com/ahzs645/ACtools/releases/latest) and download `ac-tools-vX.Y.Z.zip`.
2. Unzip it to a stable folder. The folder must keep existing — Chrome reads files from it on every load.
3. Open `chrome://extensions`.
4. Turn on **Developer mode** in the top right.
5. Click **Load unpacked** and pick the unzipped folder.
6. The AC Tools side panel is now reachable from the extensions toolbar.

To update later, download the next release zip, replace the folder contents, and click the reload icon on the extension card in `chrome://extensions`.

## Releasing

Cutting a release is tag-driven. The GitHub Actions workflow at `.github/workflows/release.yml` triggers on any `v*.*.*` tag push, builds in a clean environment, and publishes a release with the zip attached.

```bash
# bump the version in package.json and create a matching git tag
npm version patch     # or minor / major
git push --follow-tags
```

The workflow verifies the tag matches `package.json`, runs `npm run typecheck` and `npm run package`, and uploads `releases/ac-tools-vX.Y.Z.zip` to a new GitHub release.

To produce a release zip locally without publishing, run:

```bash
npm run package
```

This syncs `public/manifest.json` to the version in `package.json`, runs the production build, and writes `releases/ac-tools-v<version>.zip`. The script shells out to the system `zip` command, which is preinstalled on macOS, Linux, and the GitHub Actions Ubuntu runner. On Windows, run it from WSL or install a `zip` binary.

## Notes

- The build uses `Vite` for the side panel page and `esbuild` for `background.js` and `content.js`.
- `content.js` is bundled as a single classic script so Chrome can load it as a manifest content script without ESM import errors.
- The extension action opens `sidepanel.html` through the Chrome `sidePanel` API instead of a popup.
- The manifest currently targets common AlayaCare host patterns plus `localhost` for local testing.
- The popup defaults still use Walter's sample values so the feature is immediately testable.
- The availability POST uses relative URLs and `credentials: "include"` so it piggybacks on the active AlayaCare session rather than storing credentials in the extension.
