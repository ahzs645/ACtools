# Feature sketch — credit-void & expenses-autofill in ACtools

How the two sibling AlayaCare automations would slot into ACtools' existing architecture
without bolting on a parallel system. See [alayacare-platform-notes.md](./alayacare-platform-notes.md)
for the endpoints/selectors/timing these rely on.

ACtools today is: side-panel UI (tool tiles in `src/popup/main.ts`) → `RuntimeMessage`
protocol (`src/shared/messages.ts`) → content script (`src/content/index.ts`) →
`AlayaCareClient` (`src/content/services/AlayaCareClient.ts`) doing API calls on the
AlayaCare page. Both new features fit that same spine — they're new tiles + new message
types + new client/feature methods. No new architecture.

---

## Where each piece lands

| Layer | File | What's added |
| --- | --- | --- |
| UI tile | `src/popup/main.ts` + `sidepanel.html` | "Credit Void" and "Expenses" tiles + their detail panels |
| Message protocol | `src/shared/messages.ts` | new `ac/popup/*` and `ac/content/*` variants + payload/result types |
| Content router | `src/content/index.ts` | new `case`s in `handleContentMessage` |
| API logic | `src/content/services/AlayaCareClient.ts` | `resolveClientId`, `voidCharge`, etc. |
| DOM logic (expenses only) | `src/content/features/expenses/` | `FormStateDetector` (MutationObserver) + autofill |

The message naming already follows `ac/<surface>/<verb>` — keep that. The
`CommandResult<T>` envelope and the `isContentMessage`/`isPopupMessage` guards already
handle dispatch, so each feature is purely additive.

---

## Feature 1 — Credit Void (API-first, the easy win)

The sibling project's credit tool was a bookmarklet + OS macro **only because IT forbade
installing software and they thought there was no API**. ACtools has neither constraint:
it's already an installed extension making authenticated `/api/v2` calls. So the 12-sec/
invoice macro dance collapses into direct API calls — this is the higher-leverage port.

**Flow:** operator pastes/loads a batch (client name or account code + visit date +
amount) → for each row: resolve `client_id` → find the matching visit/charge → POST the
correction (rate = 0). The dual-field match (visit ID **and** amount) guards against
duplicate-amount false positives — keep that check.

**New client methods** (mirror the existing `postAvailability` style):
```ts
// AlayaCareClient.ts
async resolveClientId(accountCodeOrName: string): Promise<ClientRecord[]>   // autocomplete endpoint
async findCharge(clientId, visitDate, amount): Promise<VisitRecord | VisitRecord[]>
async voidCharge(chargeId): Promise<CommandResult<...>>   // the rate=0 correction POST
```

**New messages:**
```ts
| { type: "ac/popup/void-credits";  payload: CreditBatch }
| { type: "ac/content/void-credits"; payload: CreditBatch }
```

**Judgment pause:** when `resolveClientId` / `findCharge` returns >1 candidate, don't
auto-pick — surface the matches in the side panel for a click (same principle as the
expenses duplicate picker). Everything unambiguous runs unattended.

**Open item:** confirm the correction endpoint shape in the Network tab (the sibling repo
only proved the *lookup* endpoint via API; the void itself was done through the UI macro).
If the void has no API endpoint, fall back to Feature 2's DOM-autofill mechanism for that
one field.

---

## Feature 2 — Expenses Autofill (DOM-driven, needs the timing patterns)

AlayaCare's expense form has **no submission API**, so this one is irreducibly DOM-based.
This is where the SPA-timing and `setVueInput` knowledge from the platform notes earns its
keep.

**Flow:** invoice data arrives (manual entry in the panel, or extracted from a source tab)
→ stored in `chrome.storage.local` → navigate to the client's expense page → `Add Expense`
→ `FormStateDetector` waits for form-ready → autofill the 4 mechanical fields → operator
fills the 3 judgment fields and submits.

**New feature module** `src/content/features/expenses/`:
```ts
// FormStateDetector.ts — MutationObserver on [data-test="custom-billable-item-modal"]
//   fires triggerAutofill() once billcode-autocomplete + reference-date + funder-methodology
//   (enabled) are all present. autoFillTriggered guard prevents double-fire.
// autofill.ts — setVueInput() into price-per-unit, supplier-organisation-name-autocomplete,
//   supplier-invoice-number, invoice-item-description (value + input/blur dispatch).
```

**Navigation** uses the platform-notes timing pattern: flat nav wait **+** retry loop (or
MutationObserver) targeting `input[data-test="input-search-filter"]` — never an
`onUpdated`-only wait.

**Deliberately manual:** Bill Code, Funding Episode, Reference Date. The detector *waits on*
Bill Code as the readiness gate but does not set it. Duplicate clients → picker modal, one
click.

**Data bridge:** `chrome.storage.local` (ACtools already uses it for the availability draft)
carries invoice data across the navigation/tab boundary and survives MV3 worker restarts.
A pipe-delimited string works, but a typed `ExpenseDraft` object is cleaner here.

---

## Suggested order

1. **Expenses-autofill first if the goal is the bigger time sink** — but it's the harder
   one (DOM, timing, MutationObserver).
2. **Credit-void first if the goal is a quick high-value win** — assuming the correction
   endpoint exists, it's nearly all API code in the layer ACtools already has, reusing the
   `postAvailability` pattern almost verbatim.

Recommendation: spike the credit-void **endpoint discovery** in the Network tab first (one
Network-tab session answers whether Feature 1 is pure-API or needs DOM). That single
finding decides how much of the harder DOM machinery you need to build at all.
