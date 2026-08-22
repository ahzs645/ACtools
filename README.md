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
- `Shift Lab` for resolving active UAT service locations and creating validated, unassigned shift and shift-ruleset test records in local extension storage
- `Field Catalog` utility that manually exports tenant form-context bindings, native/profile input types, and configured options as versioned JSON, CSV, or a styled Excel workbook
- `Client Chart Export`, a menu of three workspaces — structured client snapshot, client creation from JSON, and batch PDF parsing — behind a single synthetic-UAT confirmation
- the structured client snapshot searches or inspects synthetic UAT clients and downloads a source-attributed JSON snapshot with section-level failures and attachment metadata but no attachment binaries (**off by default**, see [Optional tools](#optional-tools))
- guarded UAT-only client creation from an AC Tools chart JSON export, with a new test-marked identity, one-or-more live facility/client-group destinations, an optional cost centre, and sanitized medical-history and risk-assessment copying
- local parsing of AlayaCare client-chart batch PDFs into JSON with reconstructed page text, report groups, client identifiers, batch dates, and visit-day/visit-ID indexes
- `Connector Utilities` for scenario backup and JSON editing, read-only operations health, semantic blueprint audits, draft/published comparison, and sanitized inventories of Templates, Connections, Webhooks, Functions, Keys, Data Stores, and Data Structures
- `Employee Manager` for authenticated employee search, session caching, configurable sorting, details, status updates, audit notes, and guarded cross-tenant employee copying
- copy dry runs with duplicate detection, automatic and manual group/role/department/employment-type mappings, ServiceNow shortcuts, and per-tenant execution progress
- `Environment Manager` for friendly tenant names, add/edit/delete, a default tenant, non-secret import/export, per-tenant credential setup, and authentication/metadata health checks
- validated external API credentials that default to memory-only session storage, with an explicit opt-in to remember keys locally in the current Chrome profile; credentials are never synced or embedded in the extension
- a UAT round-trip test that operates only on a selected employee clearly marked as a test record
- configurable employee status choices and default timezone, plus an in-extension changelog and toast notifications
- automatic `AC Tools` page button injection beside `.global-search`
- planned slots in the drawer for shift swap, save/restore, and rotation tooling

## Notes

- The extension action opens `sidepanel.html` through the Chrome `sidePanel` API instead of a popup.
- The manifest targets common AlayaCare host patterns (`*.alayacare.ca`, `*.alayacare.com`, `*.alayacare.cloud`) plus `localhost` for local testing.
- The availability POST uses relative URLs and `credentials: "include"` so it piggybacks on the active AlayaCare session rather than storing credentials in the extension.
- Connector utilities query `connector.alayacare.ca` through the active browser tab and session; they never store Connector credentials. Published blueprints are read-only, and draft saves are gated by structural validation, change detection, an acknowledgement, and a final confirmation.
- Field Catalog export is deliberately manual. It reads configuration metadata from the active signed-in tenant, downloads JSON, CSV, or Excel, and does not send data directly to Webforms. The export contains no client records.

### Export a field catalog snapshot

1. Open an authenticated AlayaCare tab.
2. Open AC Tools and select **Field Catalog**.
3. Select **Export JSON** for the versioned machine-readable snapshot, **Export CSV** for the portable raw table, or **Export Excel** for the styled and filterable 12-column client-field table.
4. Review the downloaded file before using it to update a downstream curated catalog.

The CSV and Excel exports follow the maintained reference columns from `SubSubSection` through `Note`. Both merge current Patient binding labels and types with the committed documentation annotations, keep annotation-only chart fields, and append new live Patient fields with blank documentation cells for review. The Excel workbook additionally highlights those review rows and includes frozen headers, filters, wrapped text, readable column sizing, and alternating row shading.

### Inspect a synthetic UAT client chart

This workspace is off by default. Turn on **Structured client snapshot** in
**Settings → Optional tools** before following these steps; see [Optional tools](#optional-tools).

1. Open an authenticated AlayaCare UAT tenant. You may remain on any supported page or open a synthetic client chart.
2. Open AC Tools and select **Client Chart Export**, then confirm **Synthetic UAT data only** to unlock the workspaces.
3. Choose **Structured client snapshot**.
4. Search by client name or AlayaCare ID and choose **Inspect chart** on a result, or select **Inspect chart** for the chart open on the active tab.
5. Review the client identifiers, section coverage, and any endpoint failures.
6. Select **Download JSON** to save the structured snapshot locally.

To locate richer synthetic charts, choose a 10- or 25-client deep-scan limit and select
**Rank charts**. The utility reviews the active-client pool, preselects metadata-rich
candidates, and ranks the bounded deep scan by populated patient-chart sections and capped
record counts. This is a practical test-data finder rather than a guarantee across every client.

The snapshot contains client records and must be handled accordingly. The utility is UAT-only,
does not upload data, and exports attachment metadata without downloading attachment file contents.

To create a synthetic test client from a downloaded snapshot, open **Create client from JSON**,
select the file, review the proposed test-marked name, choose one or more live UAT facility/client
groups and an optional cost centre, and review the supported clinical sections before you
confirm the create operation. AC Tools creates a new client in the currently authenticated UAT
tenant, then copies sanitized medical-history and risk-assessment data into that new client's own
clinical documents. The source client ID/GUID, health-card and external identifiers, contact and
address details, attachment contents, authors, timestamps, and document IDs/versions are omitted.
The source and destination tenant origins must match.

Multiple destination selections assign a single new client chart to multiple client groups; they
do not create one chart per facility. AC Tools reloads and validates the destination catalog at
write time so stale or forged group and cost-centre identifiers are rejected before creation.

This first import version does not clone contacts, notes, services, care plans, forms, tasks,
medications, documents, or attachments. Those sections need tenant-specific reference mapping or
can trigger operational workflows, so the import preview reports them as omitted instead.

For batch exports, open the **Batch PDF parser** workspace: select one or more PDFs, choose
**Parse PDFs**, and download the locally parsed JSON. The files are processed inside the
extension and are not uploaded.

### Build an unassigned shift scenario

1. Open an authenticated AlayaCare UAT tenant, then open **Shift Lab**.
2. Confirm UAT test-data use and search for the service location, such as `Heritage Heights`.
3. Select the exact active staffing position returned by the tenant.
4. Optionally save a local ruleset, then review the shift fixture and save the scenario.
5. Download the last shift or the complete local Shift Lab registry as JSON.

Shift Lab validates the `S##########` and `R##########` identifiers, calculates duration,
checks pay duration and expiry, and always initializes client/employee cohorts, visits,
availability, and assignments as empty arrays. Its records remain in this Chrome profile.
The interface separately evaluates the local fixture and reports native-visit readiness, marking
unavailable capacity/fatigue checks as not evaluated and missing client/service mappings as
blockers. Saved records can be inspected, duplicated, copied, deleted, or exported.

AlayaCare's currently exposed scheduler creates client/service visits through
`/api/v1/scheduler/`; it does not expose the Shift/Ruleset fields represented by this scenario.
For that reason, Shift Lab does not post these fixtures as native AlayaCare visits or claim that a
native ruleset was created. This boundary is shown directly in the utility and recorded in every
shift JSON with `alayaCareNativeRecordCreated: false`.

See [Shift Lab design and test documentation](docs/shift-lab.md) for the complete BDD mapping,
storage schema, UAT discovery evidence, validation rules, and repeatable test commands.

### Optional tools

Each Client Chart Export workspace can be turned on or off from **Settings → Optional tools**.
The choice is stored per install in `chrome.storage.local`, so it survives a reload and needs no
rebuild.

| Tool | Default | Covers |
| --- | --- | --- |
| Structured client snapshot | off | Client search, chart ranking, and live chart reads |
| Create client from JSON | on | Guarded synthetic client creation |
| Batch PDF parser | on | Local batch-PDF parsing |

A tool that is off stays visible in the Client Chart Export menu with an `Off` badge but cannot be
opened, and the background service worker refuses its messages, so a stale side panel cannot reach
it either. Nothing reaches the tenant while a tool is off.

The shipped defaults live in `DEFAULT_FEATURE_FLAGS` in `src/shared/featureFlags.ts`; change them
there to alter what a fresh install starts with.

For a data-first conversion with normalized care plans, medications, MAR months, visits,
visit metrics, and visit forms, run `scripts/parse_alayacare_chart_pdf.py` with one or more
PDF paths and `--output-dir`. The resulting schema-v2 JSON also retains source page text
and extracted tables for auditability.

### Browse, edit, or export Connector resources

1. Open any team page on `connector.alayacare.ca` and open AC Tools.
2. Select **Connector Utilities**, then choose **Scenario Library**, **JSON Editor**, **Asset Inventory**, **Operations & Health**, or **Diagnostics & Audit**.
3. In **Scenario Library**, AC Tools queries the team from the current URL. On a scenario editor page, **Load Active Scenario** opens that scenario immediately; otherwise select one from the searchable list.
4. The selected draft or published blueprint opens in **JSON Editor**, where you can format, validate, copy, import, or export its JSON. **Export Published + Draft Bundle** backs up one scenario; **Download All Scenarios** creates a ZIP with published, draft, and combined JSON for every accessible scenario plus a manifest of any failures.
5. Open **Asset Inventory** to export sanitized metadata for Templates, Connections, Webhooks, Functions, Keys, Data Stores, and Data Structures. Key values and Data Store records are never queried or exported.
6. Open **Operations & Health** for scenario state, schedule type, next execution, incomplete-execution count, operations, transfer, and retained history, with a direct link to Connector History.
7. Open **Diagnostics & Audit** to compare draft and published structure, find write/delete/API modules, missing or masking error handlers, operation-growth patterns, and possible static-secret field paths. The audit reports paths only, never values, and includes a common-error triage reference.
8. To write an edit, load **Draft**, fix every validation error, acknowledge the warning, and select **Save Draft JSON**. AC Tools checks that the server copy has not changed since it was loaded before saving.

Scenario exports can contain connection identifiers and configured static values. Review them before sharing or committing them. Asset exports are sanitized: secret values, Data Store records, webhook URLs and payload data, connection account details, and creator identities are excluded. Run-once, activate/deactivate, delete, incomplete-execution retry, record editing, and previous-version restore controls remain intentionally outside this read-only operations layer.

---

## For contributors

Everything below is for people working on the extension itself. End users should stick to the [Install](#install) section above.

### Project structure

```text
public/manifest.json      Chrome extension manifest
src/background/           MV3 service worker
src/background/employees/ Credential storage and external employee/copy/health services
src/background/environments/ Non-secret environment registry storage
src/content/              content script, overlay, page integration, AlayaCare API client
src/popup/features/       Modular environment, employee copy/cache/sort, and preferences controllers
src/popup/ui/             Shared side-panel UI helpers such as toast notifications
src/popup/                shared drawer UI entry point used by the side panel page
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

To refresh the field-catalog documentation annotations from an approved tab-separated reference export before packaging:

```bash
node scripts/generate-form-context-annotations.mjs /path/to/reference.tsv
```

This syncs `public/manifest.json` to the version in `package.json`, runs the production build, and writes both:

- `releases/ac-tools-latest/` — a stable unpacked directory that Chrome can stay pointed at. After packaging again, click the reload icon on the AC Tools card in `chrome://extensions`.
- `releases/ac-tools-v<version>.zip` — the versioned release archive.

The script shells out to the system `zip` command, which is preinstalled on macOS, Linux, and the GitHub Actions Ubuntu runner. On Windows, run it from WSL or install a `zip` binary.
