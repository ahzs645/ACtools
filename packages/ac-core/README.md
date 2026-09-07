# @ac-tools/core

Host-agnostic TypeScript shared by the AC Tools Chrome extension and the AC Tools desktop app
(`desktop/`), both built from this repository.

Two pathways, one code base:

| Pathway | Auth | Entry point | Used for |
| --- | --- | --- | --- |
| Session | The tenant's own cookies (`SessionContext`) | `session/AlayaCareClient.ts` + `session/dispatch.ts` | Everything on `/api/v1`, `/api/v2`, Connector, Day View data, employee reads, task cloning |
| External API | Tenant API keys, Basic auth (`CorePlatform`) | `external/employeeService.ts` | Employee status writes, cross-tenant copy with guarded mapping, health checks |

`router.ts` is the popup message router both hosts share. The extension's background service
worker and the desktop app's main process each provide a `PopupRouterDeps` (storage, fetch,
"the current tenant", and how to run a session command) and forward `ac/popup/*` messages to it.

Rules:

- Nothing in `src/` may reference `chrome.*`, `window`, `document`, or Electron directly.
  Hosts pass those in through `platform.ts`.
- Optional DOM use is allowed only behind a runtime check with a DOM-free fallback
  (see `readHtmlTables` in the session client).
- Type-check with `npm run typecheck:core` from the repository root.
