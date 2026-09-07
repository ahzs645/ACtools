# AC Tools desktop app

The AC Tools side panel and its services as a standalone Electron app, built from this repository.
Nothing is forked: the renderer is the repository's own `sidepanel.html`, and the services are
`packages/ac-core`. The extension and the desktop app therefore share every feature and every
guard, including the cross-tenant employee copy, duplicate detection, dry-run mapping plans, health
checks, and onboarding task cloning.

Two ways of talking to a tenant:

| Pathway | Auth | What it powers |
| --- | --- | --- |
| **Session** | You sign into the tenant in a window owned by the app; the app keeps that tenant's cookies in its own Electron session | Employee search and details, Field Catalog, Client Chart Export, Shift Lab lookups, Availability Test, Connector Utilities, onboarding task cloning |
| **External API** | Per-tenant API keys, validated and stored by Environment Manager | Employee status updates with audit notes, cross-tenant employee copy, health checks |

What is not here: anything that needs an AlayaCare page open in a browser tab, which is the Day
View overlay and the injected page button. Those remain extension-only; the desktop app refuses
them with a message rather than failing silently.

## Install

Download the installer for your platform from the
[latest release](https://github.com/ahzs645/ACtools/releases/latest): `ac-tools-desktop-<version>-setup.exe`
(Windows), `ac-tools-desktop-<version>.dmg` (macOS), or `ac-tools-desktop-<version>.AppImage`
(Linux). No Chrome, no Developer mode.

## First run

1. Open **Environments** and add each tenant: a friendly name, the tenant URL, the support link, and
   optionally the onboarding task template ID and owning-group pattern.
2. Pick the tenant in the **Tenant** bar at the top and choose **Sign in**. Complete the tenant's
   normal sign-in in the window that opens; it closes itself once AlayaCare reports who you are.
   Session tools now work against that tenant.
3. For employee writes and cross-tenant copies, add the tenant's external API keys under
   **Environments → API credentials** (or in **Employees**). Keys are validated against the tenant
   before they are kept.

Switching the tenant in the bar switches every session tool at once. Each tenant keeps its own
cookies, so signing into UAT never touches Production and vice versa.

## Where data lives

- `ac-tools-local.json` in the app's user-data folder holds the environment registry, remembered
  API keys, preferences, feature flags, and Shift Lab records. It is encrypted with the operating
  system's credential store (DPAPI, Keychain, or the desktop keyring) whenever Electron reports
  encryption is available, and written with owner-only permissions.
- Session-only API keys live in memory and disappear when the app exits.
- Tenant cookies live in per-tenant Electron partitions (`persist:ac-<host>`) inside the same
  user-data folder. **Sign out** clears a tenant's partition.
- Exports (JSON, CSV, Excel, ZIP) go through a native save dialog.

## For contributors

```text
electron.vite.config.ts    main / preload / renderer bundles; the renderer is ../sidepanel.html
src/main/index.ts          window, CSP, smoke-test hooks
src/main/ipc.ts            ac:message → @ac-core router; ac:storage; ac:version
src/main/tenantSessions.ts per-tenant sessions, sign-in window, Session.fetch, save dialog
src/main/stores.ts         encrypted JSON file store (local tier)
src/preload/index.ts       window.acBridge, the contract src/popup/platform.ts looks for
scripts/smoke.mjs          headless launch + bridge round-trip + screenshot
electron-builder.yml       installers
```

The package is an npm workspace of the repository root, so one `npm install` at the root installs
everything. From the root:

```bash
npm run desktop:dev       # Electron with hot reload of the panel
npm run typecheck         # extension + core + desktop
npm run desktop:build     # desktop/out/{main,preload,renderer}
npm run desktop:smoke     # after a build; use xvfb-run -a on a headless Linux box
npm run desktop:package   # installers into desktop/release for the current platform
```

Panel and core changes are ordinary repository changes; the desktop app picks them up on its next
build. Keep `packages/ac-core` free of Chrome, DOM, and Electron references, and keep new panel
storage going through `src/popup/platform.ts`, and both hosts stay in step.

### Headless smoke test

`npm run desktop:smoke` launches the built app with `AC_TOOLS_SMOKE_SCREENSHOT` and
`AC_TOOLS_SMOKE_EVAL` set. The app logs the panel's console, runs a bridge exercise in the page
(storage tiers, environment save, tenant selection, credential status, session status), writes
`desktop/smoke.png`, and exits non-zero on any renderer error or failed check. CI runs it on every
push.

### Releasing

The desktop version follows the root `package.json`; `npm run package` syncs it. Pushing a
`v<version>` tag builds the extension zip and the three installers and attaches all of them to one
GitHub release.
