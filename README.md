# AC Tools

A Manifest V3 Chrome extension that turns one-off console scripts for AlayaCare scheduling into a maintainable side-panel toolkit.

## Install

You do not need to clone this repo or install Node. Grab the latest release zip and load it into Chrome.

1. Open the [latest release](https://github.com/ahzs645/ACtools/releases/latest) and download `ac-tools-vX.Y.Z.zip`.
2. Unzip it to a stable folder. The folder has to keep existing — Chrome reads files from it on every load, so do not put it in `Downloads` if you tend to clean that out.
3. Open `chrome://extensions`.
4. Turn on **Developer mode** in the top right.
5. Click **Load unpacked** and pick the unzipped folder.
6. AC Tools is now reachable from the extensions toolbar. Click the icon to open the side panel on any AlayaCare tab.

To update later, download the next release zip, replace the folder contents, and hit the reload icon on the AC Tools card in `chrome://extensions`.

## Current features

- `Day View` overlay for side-by-side employee schedule comparison, delivered as a jQuery-free content feature
- `Availability Test` workspace in the side panel that posts a single-day availability entry through the current AlayaCare browser session
- automatic `AC Tools` page button injection beside `.global-search`
- planned slots in the drawer for shift swap, save/restore, PDF export, and rotation tooling

## Notes

- The extension action opens `sidepanel.html` through the Chrome `sidePanel` API instead of a popup.
- The manifest targets common AlayaCare host patterns (`*.alayacare.ca`, `*.alayacare.com`, `*.alayacare.cloud`) plus `localhost` for local testing.
- The availability POST uses relative URLs and `credentials: "include"` so it piggybacks on the active AlayaCare session rather than storing credentials in the extension.

---

## For contributors

Everything below is for people working on the extension itself. End users should stick to the [Install](#install) section above.

### Project structure

```text
public/manifest.json      Chrome extension manifest
src/background/           MV3 service worker
src/content/              content script, overlay, page integration, AlayaCare API client
src/popup/                shared drawer UI code used by the side panel page
src/shared/               typed messages and shared helpers
scripts/build.mjs         build orchestration for popup/background/content
scripts/package.mjs       version sync, build, and release zip
```

### Development

```bash
npm install
npm run dev        # watch build into dist/
npm run build      # one-off production build
npm run typecheck  # tsc --noEmit
```

While developing, load the `dist/` folder into Chrome via `chrome://extensions` → Developer mode → Load unpacked. The watch build will keep `dist/` in sync; click the reload icon on the extension card after saving.

The build uses Vite for the side panel page and esbuild for `background.js` and `content.js`. `content.js` is bundled as a single classic script so Chrome can load it as a manifest content script without ESM import errors.

### Releasing

Releases are tag-driven. The GitHub Actions workflow at `.github/workflows/release.yml` triggers on any `v*.*.*` tag push, builds in a clean environment, and publishes a GitHub release with the zip attached.

```bash
npm version patch        # or minor / major — bumps package.json and creates a v* tag
git push --follow-tags
```

The workflow verifies the tag matches `package.json`, runs typecheck, runs `npm run package`, and uploads `releases/ac-tools-vX.Y.Z.zip` to the release. End users then follow the [Install](#install) instructions above.

To produce a release zip locally without publishing:

```bash
npm run package
```

This syncs `public/manifest.json` to the version in `package.json`, runs the production build, and writes `releases/ac-tools-v<version>.zip`. The script shells out to the system `zip` command, which is preinstalled on macOS, Linux, and the GitHub Actions Ubuntu runner. On Windows, run it from WSL or install a `zip` binary.
