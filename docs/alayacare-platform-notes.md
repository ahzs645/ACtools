# AlayaCare Platform Notes

Reverse-engineering knowledge about the AlayaCare web app, distilled from a sibling
automation project (credit-void + expenses-autofill). Captured here so it survives
independently of that project. None of this is documented by AlayaCare — it was learned
by observation and may drift when AlayaCare ships platform updates.

> ACtools already follows the two biggest principles from that project: **API-first over
> DOM scraping** (`AlayaCareClient` hits `/api/v2/...`) and **side panel over popup**
> (persists across tab switches). The notes below matter when ACtools adds features that
> have to touch the DOM — form autofill, client navigation, anything the API can't do.

---

## 1. API surface

ACtools talks to the internal `/api/v2/...` endpoints via relative URLs with
`credentials: "include"`, piggybacking on the active session. Endpoints already in use
live in `src/content/services/AlayaCareClient.ts`. Additional endpoints observed:

- **Account-code → client lookup (autocomplete):** AlayaCare exposes an internal
  account-code autocomplete endpoint that returns the internal `client_id` directly.
  The sibling project used it to replace per-client page navigation with a single
  `fetch()` (~150ms). Find the exact path in the Network tab while typing into an
  account-code field; capture it here once confirmed.

### `client_id` gotcha (important)

The **exported client CSV contains 11-digit IDs that do NOT match the 4-digit internal
`client_id`** the API uses. Do not build lookups off the CSV's IDs — resolve client_id
from the API (autocomplete endpoint or the client-list row `href`) instead.

### CORS / context rule

`fetch()` to AlayaCare's API only succeeds from a context that holds `host_permissions`
for the AlayaCare domain — i.e. the extension/side-panel context or a content script
running **on an AlayaCare page**. A content script injected into a *different* origin
(e.g. an accounting system) calling AlayaCare's API will be blocked by CORS. Route those
calls through the extension context, not the foreign page.

---

## 2. SPA timing — the #1 source of flaky DOM automation

AlayaCare is a Vue/Angular single-page app on a hash router. The browser's document
lifecycle does **not** tell you when the app is ready:

- `DOMContentLoaded`, `window.onload`, and `chrome.tabs.onUpdated` with
  `status === 'complete'` all fire when the **HTML document** loads — before the
  framework has rendered any app content. A synchronous `querySelector` at these events
  returns `null`.
- **Hash navigation** (`/#/clients/list` → `/#/clients/123/expenses`) does **not**
  trigger a document load at all. `onUpdated` fires immediately on the already-loaded
  page with zero render delay.

The sibling project burned a whole release "cleaning up" a working `4000ms` wait into an
`onUpdated` listener — it broke client search entirely and had to be reverted. Lesson:

**Correct pattern for waiting on AlayaCare content:**
1. A flat, empirically-derived nav wait (they used `4000ms`) to cover navigation,
   **plus**
2. a retry loop targeting the *specific element* that signals readiness
   (they used 8 retries × 500ms),
   **or**
3. a `MutationObserver` watching for a known element to appear (preferred for modals/forms).

Neither the flat wait nor the retry loop alone covers the full timing spread. Never trust
a document-load event as an "app ready" signal.

---

## 3. Known `data-test` selectors

AlayaCare puts `data-test` attributes on form elements. These are more stable than CSS
classes or dynamic IDs, but AlayaCare **does rename them on its own release cycle** — so
build fallback chains: `data-test` → `aria-label` → placeholder/positional.

Custom billable item (expense) modal:

| Purpose | Selector |
| --- | --- |
| Modal container (readiness anchor) | `[data-test="custom-billable-item-modal"]` |
| Bill Code field (gates form init) | `[data-test="billcode-autocomplete"]` |
| Reference Date | `[data-test="reference-date"]` |
| Funding Episode (enabled when ready) | `[data-test="funder-methodology"]` |
| Amount / price per unit | `input[data-test="price-per-unit"]` |
| Creditor / supplier name | `input[data-test="supplier-organisation-name-autocomplete"]` |
| Supplier invoice number | `input[data-test="supplier-invoice-number"]` |
| Line item description | `input[data-test="invoice-item-description"]` |

Client list:

| Purpose | Selector |
| --- | --- |
| Search filter input | `input[data-test="input-search-filter"]` |
| Client name link (row) | `a[data-test="client-first-name-link"]` |

**Form-ready signal** (all three true): `billcode-autocomplete` present, `reference-date`
accessible, and `funder-methodology` present **and not** `[disabled]`.

**Rediscovering selectors after a platform update** — paste into DevTools console on the
relevant page:
```js
Array.from(document.querySelectorAll('input'))
  .filter(el => el.value.trim() !== '')
  .map(el => ({ id: el.id, value: el.value }));
```

---

## 4. Writing into framework-controlled inputs

The Vue/Angular form rejects naive `el.value = x`. Set the value **and dispatch the events
the framework listens for** so its model updates:

```js
function setVueInput(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return false;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('blur',  { bubbles: true }));
  return true;
}
```

For the search box, dispatch `input` + `change`. Note: this works for *programmatic value
injection*. OS-level synthetic **keystrokes** are rejected by the framework (that's why the
sibling credit tool dropped to an AutoHotkey macro outside the browser) — but value-set +
event-dispatch from a content script is below that barrier and works.

---

## 5. Decisions that should stay manual

Three expense-form fields require human judgment and were deliberately **not** automated —
automating them produces wrong, hard-to-reverse billing entries:

- **Bill Code** (also gates form initialization)
- **Funding Episode**
- **Reference Date** (PrimeVue calendar picker — also the least reliable to auto-fill)

Likewise, **duplicate client resolution** (multiple clients with the same name) was handled
by surfacing a picker for a single human click, not by auto-selecting the first match.
Rule of thumb: automate the *mechanical* steps (transcription, navigation, field-fill),
build a clean low-friction pause for the *judgment* steps.

---

## 6. Cross-step / cross-tab data handoff

For workflows that span tabs or survive a service-worker restart (MV3 kills idle workers),
use `chrome.storage.local` as the data bridge rather than in-memory state or message
passing. ACtools already uses it for the availability draft and surface/theme settings; the
same pattern carries any multi-step invoice/expense data between extraction and autofill.

---

*Source: sibling project `Alayacare-AP-Automation` (documentation-only portfolio repo,
code sanitized out). Confirm endpoints/selectors against the live app before relying on
them — AlayaCare ships changes on its own schedule.*
