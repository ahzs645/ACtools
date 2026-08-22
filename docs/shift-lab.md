# Shift Lab

## Purpose

Shift Lab turns the Shift Creation and Shift Ruleset Creation scenarios into inspectable UAT
test-data records. It resolves real service-location identifiers from the active authenticated
AlayaCare UAT tenant, validates the supplied fixture, and stores the resulting rulesets and shifts
locally in the AC Tools Chrome profile.

Shift Lab does **not** create a native AlayaCare visit or ruleset. The deployed AlayaCare scheduler
models a shift as a client/service visit and does not expose the requested Shift or Ruleset fields.
Every exported shift therefore includes:

```json
{
  "storageScope": "extension-local",
  "alayaCareNativeRecordCreated": false
}
```

The interface labels this operating mode as **Local fixture** and keeps native readiness separate
from local validation, so a valid fixture is never presented as a created AlayaCare record.

## Relationship notation

The scenario notation is interpreted as follows:

| Notation | Meaning | Shift Lab behavior |
| --- | --- | --- |
| `{||}` | Exactly one | Scheduling office and selected service location are required. |
| `{O|}` | Zero or one | Cost center and ruleset are optional single values. |
| `{O<}` | Zero or many | Client cohorts, client visits, employee cohorts, availability, assignments, and ruleset rules initialize as empty arrays. |

## UAT discovery

Read-only inspection of the Northern Health UAT scheduling application established that:

- the native creation endpoint is `POST /api/v1/scheduler/`;
- the native payload represents a client/service visit and requires scheduling identifiers such as
  `patient_id`, `service_id`, `start_at`, and `end_at`;
- the deployed API does not expose Shift Name, Occurrence ID, Pay Duration, OT Eligibility,
  Pattern, Expiry, Shift Code, Shift Ruleset, or the supplied intake/change audit fields;
- `Heritage Heights` currently resolves to four active `CustomerStaffingPosition` records:
  `zz WB Test - HERITAGE HEIGHTS AM`, `LUNCH`, `PM`, and `SUPPER`;
- the inspected AM account returned no active client service for the supplied September 1, 2026
  fixture, so attempting a native visit creation would not reproduce the requested scenario.

The service-location lookup uses authenticated, read-only GET requests to:

- `/api/autocomplete/patientsFacilities`
- `/api/autocomplete/staffings`

No POST, PUT, PATCH, or DELETE request was made during discovery or testing.

## Shift Ruleset mapping

| Scenario field | Stored field | Validation/default |
| --- | --- | --- |
| `Ruleset_Name` | `name` | Required; default `Approved`. |
| `Ruleset_ID` | `rulesetId` | `R` followed by exactly 10 digits; locally unique. |
| `Ruleset_OT_Approved` | `overtimeApproved` | Boolean; default `true`. |
| `Ruleset_Ignore_Capacity` | `ignoreCapacity` | Boolean; default `false`. |
| `Ruleset_Ignore_Fatigue` | `ignoreFatigue` | Boolean; default `false`. |
| `Ruleset_Can_ShiftSwap` | `canShiftSwap` | Boolean; default `true`. |
| Related shift rules | `rules` | Empty array in this version. |

## Shift mapping

| Scenario field | Stored field | Validation/default |
| --- | --- | --- |
| `Shift_Name` | `shiftName` | Required familiar form such as `D SHIFT (730-16)`. |
| `Shift_Occurance` | `occurrenceId` | `S` followed by exactly 10 digits; locally unique. The source spelling is retained here, while the JSON uses “occurrence.” |
| `Shift_Office` | `office` | Required; default `DAW Community`. |
| `Service_Location` | `serviceLocation` | Required selection from live UAT results, including tenant, account, staffing, and branch identifiers. |
| `Cost_Center` | `costCenter` | Optional. |
| `Shift_Ruleset` | `rulesetId` | Optional reference to a locally saved ruleset. |
| `Shift_Start` | `startLocal` | Required local date/time. |
| `Shift_End` | `endLocal` | Must be after start and no more than 24 hours later. |
| `Shift_Duration` | `durationHours` | Calculated from start/end; 07:30–16:00 produces `8.5`. |
| `Shift_Pay_Duration` | `payDurationHours` | Greater than zero and no greater than calculated duration. |
| `Shift_Eligable_OT` | `overtimeEligibility` | `Approved`, `Not approved`, or `Ruleset`. The source spelling is retained here, while the JSON uses “eligibility.” |
| `Shift_TMZ` | `timezone` | Required; default `GMT-7`. |
| `Shift_Pattern` | `pattern` | Required; default `WX`. |
| `Shift_Expire_After` | `expiresAfter` | Must be on or after the shift start date. |
| `Shift_Code` | `shiftCode` | Required; default `Day8c`. |
| `Shift_Swap_Event` | `swapEvent` | Optional. |
| Intake/change fields | `audit` | Stored as explicit test-fixture values. |

The record also sets `allowsServiceLocationOverlap` to `true` and creates empty arrays for every
client/employee relationship required to be unassigned.

## User workflow

1. Open an authenticated AlayaCare UAT tenant and open **Shift Lab** in AC Tools.
2. Confirm **UAT test data only**.
3. Search for a service location and select the exact staffing-position card.
4. Optionally create a local ruleset.
5. Review the prefilled shift fixture and select an optional local ruleset.
6. Select **Save local shift scenario**.
7. Review the local evaluation and native-readiness results.
8. Inspect, duplicate, copy, or delete a saved local record, or download the last shift JSON or the
   full registry.

## Evaluation and readiness

Shift Lab now provides two deliberately separate assessments:

- **Local fixture evaluation** checks duration/pay consistency, resolves overtime through the
  selected local ruleset, reports swap behavior, and verifies that the fixture remains unassigned.
  Capacity and fatigue are marked **Not evaluated** when their live data has not been loaded; the
  utility does not manufacture a pass result.
- **Native AlayaCare visit readiness** shows whether the selected service location and visit times
  can map to the scheduler, and identifies the unresolved client and active-service identifiers as
  blockers. Shift-specific fields with no scheduler mapping are labelled local-only.

There is no native-create button in this version. Even a future readiness result of “Ready” would
require a separate preview and explicit confirmation before any UAT write.

Saved rulesets have **Use**, **Copy JSON**, and guarded **Delete** actions. Saved shifts have **View
JSON**, **Duplicate**, **Copy JSON**, and guarded **Delete** actions. A ruleset referenced by a saved
shift cannot be deleted until that shift is removed.

## Local storage and export

The registry uses Chrome local extension storage under `ac-tools-shift-lab-registry`. Its schema
version is `1`, with separate `rulesets` and `shifts` arrays. Data stays in the current Chrome
profile until the extension or its storage is removed. Exporting JSON is an explicit local download.

## Validation and test coverage

Run the focused checks with:

```bash
npm run test:shift-lab
```

Run the complete compile/build checks with:

```bash
npm run typecheck
npm run build
```

The focused test covers:

- the supplied 07:30–16:00 fixture calculating to 8.5 hours;
- `S0000000032` and `R0000000032` format validation;
- next-identifier generation to `S0000000033` and `R0000000033`;
- rejection of malformed identifiers and invalid durations;
- registry schema parsing and fallback behavior;
- ruleset-driven overtime evaluation and honest unevaluated capacity/fatigue results;
- native-visit readiness blocking and ready states;
- required Shift Lab HTML controls and duplicate-ID detection.

The authenticated UAT lookup was also tested read-only and returned the four Heritage Heights
staffing positions listed above. Native Shift/Ruleset creation was intentionally not tested because
the deployed API does not represent this data model and the selected location lacked an active
service for the fixture.

## Known limitations

- Records are local test fixtures, not server-side AlayaCare records.
- Scheduling office and cost center are fixture values rather than resolved tenant entities.
- Rulesets cannot yet contain individual rule records.
- Capacity and fatigue cannot be evaluated until matching live data is loaded.
- Local records cannot assign care workers; assignment collections are deliberately empty.
- Native client and active-service lookup is not yet wired into Shift Lab, so native readiness stays
  blocked and no UAT write is offered.
- The registry can be exported but not imported through Shift Lab yet.
