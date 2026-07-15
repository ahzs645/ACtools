import { formatError } from "../shared/errors";
import type { AlayaCareFormContextCatalogSnapshot } from "../shared/formContextCatalog";
import type {
  EmployeeApiCredentialStatus,
  EmployeeConfiguredTenant,
  EmployeeCopyRequest,
  EmployeeCopyResult,
  EmployeeCopyTargetResult,
  EmployeeDetail,
  EmployeeListResult,
  EmployeeWriteResult
} from "../shared/employees";
import { getActiveTabId, sendMessageToTab } from "../shared/chrome";
import type {
  AvailabilityPostResult,
  CommandResult,
  PageStatus,
  RuntimeMessage,
  Surface
} from "../shared/messages";
import {
  DEFAULT_SURFACE,
  SURFACE_STORAGE_KEY,
  isPopupMessage,
  isRuntimeMessage
} from "../shared/messages";

const SIDE_PANEL_PATH = "sidepanel.html";
const POPUP_PATH = "sidepanel.html?surface=popup";
const EMPLOYEE_CREDENTIAL_PREFIX = "ac-tools-employee-api-credentials:";

interface EmployeeApiCredentials {
  publicKey: string;
  privateKey: string;
}

interface EmployeeApiCredentialInput extends EmployeeApiCredentials {
  remember: boolean;
}

let currentSurface: Surface = DEFAULT_SURFACE;

void initialize();

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isRuntimeMessage(message)) {
    return false;
  }

  if (!isPopupMessage(message)) {
    return false;
  }

  void handlePopupMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: formatError(error)
      } satisfies CommandResult<never>);
    });

  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (currentSurface !== "sidepanel" || !("sidePanel" in chrome)) {
    return;
  }

  if (!changeInfo.url && !tab.url) {
    return;
  }

  void syncSidePanelForTab(tabId, changeInfo.url ?? tab.url ?? "");
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (currentSurface !== "sidepanel" || !("sidePanel" in chrome)) {
    return;
  }

  void chrome.tabs
    .get(tabId)
    .then((tab) => syncSidePanelForTab(tabId, tab.url ?? ""))
    .catch(() => undefined);
});

async function initialize(): Promise<void> {
  currentSurface = await loadStoredSurface();
  await applySurface(currentSurface);
}

async function loadStoredSurface(): Promise<Surface> {
  try {
    const stored = await chrome.storage.local.get(SURFACE_STORAGE_KEY);
    const value = stored[SURFACE_STORAGE_KEY];
    return value === "popup" ? "popup" : DEFAULT_SURFACE;
  } catch {
    return DEFAULT_SURFACE;
  }
}

async function applySurface(surface: Surface): Promise<void> {
  currentSurface = surface;

  try {
    await chrome.action.setPopup({ popup: surface === "popup" ? POPUP_PATH : "" });
  } catch (error) {
    console.warn("Unable to set action popup.", error);
  }

  if (!("sidePanel" in chrome)) {
    return;
  }

  try {
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: surface === "sidepanel"
    });
  } catch (error) {
    console.warn("Unable to set side panel behavior.", error);
  }

  const tabs = await chrome.tabs.query({});
  const taggedTabs = tabs.filter(
    (tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === "number"
  );

  if (surface === "popup") {
    await Promise.all(
      taggedTabs.map((tab) =>
        chrome.sidePanel
          .setOptions({ tabId: tab.id, enabled: false })
          .catch(() => undefined)
      )
    );
    return;
  }

  await Promise.all(
    taggedTabs.map((tab) => syncSidePanelForTab(tab.id, tab.url ?? ""))
  );
}

async function handlePopupMessage(
  message: Extract<RuntimeMessage, { type: `ac/popup/${string}` }>
): Promise<
  CommandResult<
    | PageStatus
    | AvailabilityPostResult
    | AlayaCareFormContextCatalogSnapshot
    | EmployeeListResult
    | EmployeeDetail
    | EmployeeWriteResult
    | EmployeeApiCredentialStatus
    | EmployeeConfiguredTenant[]
    | EmployeeCopyResult
    | void
  >
> {
  if (message.type === "ac/popup/set-surface") {
    try {
      await chrome.storage.local.set({ [SURFACE_STORAGE_KEY]: message.payload });
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }

    await applySurface(message.payload);
    return { ok: true };
  }

  const tabId = await getActiveTabId();

  switch (message.type) {
    case "ac/popup/get-status":
      return sendMessageToTab<PageStatus>(tabId, { type: "ac/content/get-status" });
    case "ac/popup/open-day-view":
      return sendMessageToTab<void>(tabId, { type: "ac/content/open-day-view" });
    case "ac/popup/post-availability":
      return sendMessageToTab<AvailabilityPostResult>(tabId, {
        type: "ac/content/post-availability",
        payload: message.payload
      });
    case "ac/popup/export-form-context-catalog":
      return sendMessageToTab<AlayaCareFormContextCatalogSnapshot>(tabId, {
        type: "ac/content/export-form-context-catalog"
      });
    case "ac/popup/list-employees":
      return sendMessageToTab<EmployeeListResult>(tabId, {
        type: "ac/content/list-employees",
        payload: message.payload
      });
    case "ac/popup/get-employee":
      return sendMessageToTab<EmployeeDetail>(tabId, {
        type: "ac/content/get-employee",
        payload: message.payload
      });
    case "ac/popup/get-employee-api-credential-status":
      return {
        ok: true,
        data: await getEmployeeApiCredentialStatus(tabId)
      };
    case "ac/popup/set-employee-api-credentials":
      await setEmployeeApiCredentials(tabId, message.payload);
      return {
        ok: true,
        data: await getEmployeeApiCredentialStatus(tabId)
      };
    case "ac/popup/clear-employee-api-credentials":
      await clearEmployeeApiCredentials(tabId);
      return {
        ok: true,
        data: await getEmployeeApiCredentialStatus(tabId)
      };
    case "ac/popup/list-employee-configured-tenants":
      return {
        ok: true,
        data: await listEmployeeConfiguredTenants()
      };
    case "ac/popup/copy-employee":
      return {
        ok: true,
        data: await copyEmployee(tabId, message.payload)
      };
    case "ac/popup/update-employee-status":
      return {
        ok: true,
        data: await updateEmployeeStatus(tabId, message.payload)
      };
    default:
      return {
        ok: false,
        error: "Unsupported popup action."
      };
  }
}

async function getEmployeeApiCredentialStatus(
  tabId: number
): Promise<EmployeeApiCredentialStatus> {
  const origin = await getSupportedTabOrigin(tabId);
  const stored = await loadEmployeeApiCredentials(origin);
  return { configured: Boolean(stored), origin, storage: stored?.storage ?? null };
}

async function setEmployeeApiCredentials(
  tabId: number,
  credentials: EmployeeApiCredentialInput
): Promise<void> {
  const publicKey = credentials.publicKey.trim();
  const privateKey = credentials.privateKey.trim();
  if (!publicKey || !privateKey) {
    throw new Error("Both the public and private API keys are required.");
  }

  const origin = await getSupportedTabOrigin(tabId);
  const normalized = { publicKey, privateKey };

  await externalApiRequest(origin, normalized, "/ext/api/v2/employees/groups?count=1", {
    method: "GET"
  });

  const key = `${EMPLOYEE_CREDENTIAL_PREFIX}${origin}`;
  if (credentials.remember) {
    await chrome.storage.local.set({ [key]: normalized });
    await chrome.storage.session.remove(key);
  } else {
    await chrome.storage.session.set({ [key]: normalized });
    await chrome.storage.local.remove(key);
  }
}

async function clearEmployeeApiCredentials(tabId: number): Promise<void> {
  const origin = await getSupportedTabOrigin(tabId);
  const key = `${EMPLOYEE_CREDENTIAL_PREFIX}${origin}`;
  await Promise.all([chrome.storage.session.remove(key), chrome.storage.local.remove(key)]);
}

async function loadEmployeeApiCredentials(
  origin: string
): Promise<(EmployeeApiCredentials & { storage: "session" | "local" }) | null> {
  const key = `${EMPLOYEE_CREDENTIAL_PREFIX}${origin}`;
  const sessionStored = await chrome.storage.session.get(key);
  const sessionValue = sessionStored[key] as Partial<EmployeeApiCredentials> | undefined;
  if (sessionValue?.publicKey && sessionValue.privateKey) {
    return {
      publicKey: sessionValue.publicKey,
      privateKey: sessionValue.privateKey,
      storage: "session"
    };
  }

  const localStored = await chrome.storage.local.get(key);
  const localValue = localStored[key] as Partial<EmployeeApiCredentials> | undefined;
  if (localValue?.publicKey && localValue.privateKey) {
    return {
      publicKey: localValue.publicKey,
      privateKey: localValue.privateKey,
      storage: "local"
    };
  }
  return null;
}

async function listEmployeeConfiguredTenants(): Promise<EmployeeConfiguredTenant[]> {
  const [sessionStored, localStored] = await Promise.all([
    chrome.storage.session.get(null),
    chrome.storage.local.get(null)
  ]);
  const tenants = new Map<string, EmployeeConfiguredTenant>();

  for (const key of Object.keys(localStored)) {
    if (!key.startsWith(EMPLOYEE_CREDENTIAL_PREFIX)) {
      continue;
    }
    const origin = key.slice(EMPLOYEE_CREDENTIAL_PREFIX.length);
    if (isSupportedOrigin(origin)) {
      tenants.set(origin, { origin, storage: "local" });
    }
  }
  for (const key of Object.keys(sessionStored)) {
    if (!key.startsWith(EMPLOYEE_CREDENTIAL_PREFIX)) {
      continue;
    }
    const origin = key.slice(EMPLOYEE_CREDENTIAL_PREFIX.length);
    if (isSupportedOrigin(origin)) {
      tenants.set(origin, { origin, storage: "session" });
    }
  }

  return [...tenants.values()].sort((a, b) => a.origin.localeCompare(b.origin));
}

interface ExternalList<T> {
  items?: T[];
}

interface ExternalReference {
  id: number;
  name?: string;
}

async function copyEmployee(
  tabId: number,
  request: EmployeeCopyRequest
): Promise<EmployeeCopyResult> {
  const sourceOrigin = await getSupportedTabOrigin(tabId);
  const ticket = request.ticket.trim();
  if (ticket.length < 5) {
    throw new Error("Enter a ticket number or change reference with at least 5 characters.");
  }

  const targetOrigins = [...new Set(request.targetOrigins)]
    .map(normalizeSupportedOrigin)
    .filter((origin) => origin !== sourceOrigin);
  if (targetOrigins.length === 0) {
    throw new Error("Select at least one configured target tenant.");
  }

  const results: EmployeeCopyTargetResult[] = [];
  for (const origin of targetOrigins) {
    try {
      results.push(await copyEmployeeToTarget(request.employee, sourceOrigin, origin, ticket));
    } catch (error) {
      results.push({ origin, ok: false, error: formatError(error) });
    }
  }

  return { sourceEmployeeId: request.employee.id, results };
}

async function copyEmployeeToTarget(
  employee: EmployeeDetail,
  sourceOrigin: string,
  targetOrigin: string,
  ticket: string
): Promise<EmployeeCopyTargetResult> {
  const credentials = await loadEmployeeApiCredentials(targetOrigin);
  if (!credentials) {
    throw new Error("No API credentials are configured for this target tenant.");
  }

  const [groups, roles, departments, employmentTypes] = await Promise.all([
    externalApiJson<ExternalList<ExternalReference>>(
      targetOrigin,
      credentials,
      "/ext/api/v2/employees/groups?count=9999999"
    ),
    externalApiJson<ExternalList<ExternalReference>>(
      targetOrigin,
      credentials,
      "/ext/api/v2/employees/roles?count=9999999"
    ),
    externalApiJson<ExternalList<ExternalReference>>(
      targetOrigin,
      credentials,
      "/ext/api/v2/employees/departments?count=9999999"
    ),
    externalApiJson<ExternalList<ExternalReference>>(
      targetOrigin,
      credentials,
      "/ext/api/v2/employees/employment_types?count=9999999"
    )
  ]);

  const mappedGroups = mapReferencesByName(employee.groups, groups.items, "group");
  const mappedRoles = mapReferencesByName(employee.roles, roles.items, "role");
  const mappedDepartments = mapReferencesByName(
    employee.departments,
    departments.items,
    "department"
  );
  const mappedEmploymentType = employee.employment_type
    ? mapSingleReferenceByName(employee.employment_type, employmentTypes.items, "employment type")
    : undefined;

  const demographics = {
    ...employee.demographics,
    first_name: employee.demographics?.first_name ?? employee.first_name ?? "",
    last_name: employee.demographics?.last_name ?? employee.last_name ?? "",
    email: employee.demographics?.email ?? employee.email ?? ""
  };
  const createPayload = removeUndefined({
    demographics,
    username: employee.username || demographics.email,
    roles: mappedRoles,
    groups: mappedGroups,
    departments: mappedDepartments,
    designation: employee.designation,
    payroll_number: employee.payroll_number,
    seniority: employee.seniority,
    max_weekly_capacity: employee.max_weekly_capacity,
    min_weekly_capacity: employee.min_weekly_capacity,
    max_daily_capacity: employee.max_daily_capacity,
    min_daily_capacity: employee.min_daily_capacity,
    default_availability: employee.default_availability,
    employment_type: mappedEmploymentType,
    timezone: employee.timezone,
    branch_id: employee.branch_id,
    status: employee.status || "active"
  });

  const created = await externalApiJson<{ id?: number }>(
    targetOrigin,
    credentials,
    "/ext/api/v2/employees/employees/",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload)
    }
  );
  if (!created.id) {
    throw new Error("The target tenant created no employee ID.");
  }

  const noteResponse = await externalApiRequest(
    targetOrigin,
    credentials,
    `/ext/api/v2/employees/employee_notes/${encodeURIComponent(created.id)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "active",
        note_type: "employee_administrative",
        content: `Ticket ${ticket}, employee copied from ${sourceOrigin} by AC Tools.`
      })
    }
  );

  return {
    origin: targetOrigin,
    ok: true,
    employeeId: created.id,
    noteStatus: noteResponse.status
  };
}

function mapReferencesByName(
  source: Array<{ id: number; name?: string }> | undefined,
  targets: ExternalReference[] | undefined,
  label: string
): Array<{ id: number }> {
  return (source ?? []).map((reference) => mapSingleReferenceByName(reference, targets, label));
}

function mapSingleReferenceByName(
  source: { id: number; name?: string },
  targets: ExternalReference[] | undefined,
  label: string
): { id: number } {
  const sourceName = source.name?.trim();
  if (!sourceName) {
    throw new Error(`Cannot map ${label} #${source.id} because its source name is missing.`);
  }
  const match = (targets ?? []).find(
    (target) => target.name?.trim().toLocaleLowerCase() === sourceName.toLocaleLowerCase()
  );
  if (!match) {
    throw new Error(`Target tenant is missing ${label} “${sourceName}”. No employee was created.`);
  }
  return { id: match.id };
}

function removeUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function externalApiJson<T>(
  origin: string,
  credentials: EmployeeApiCredentials,
  path: string,
  init: RequestInit = { method: "GET" }
): Promise<T> {
  const response = await externalApiRequest(origin, credentials, path, init);
  return response.json() as Promise<T>;
}

async function updateEmployeeStatus(
  tabId: number,
  update: Extract<RuntimeMessage, { type: "ac/popup/update-employee-status" }>["payload"]
): Promise<EmployeeWriteResult> {
  const origin = await getSupportedTabOrigin(tabId);
  const credentials = await loadEmployeeApiCredentials(origin);
  if (!credentials) {
    throw new Error("Configure the tenant API keys for this browser session before making changes.");
  }

  const payload: Record<string, string> = { status: update.status };
  if (update.comment.trim()) {
    payload.comment = update.comment.trim();
  }

  const statusResponse = await externalApiRequest(
    origin,
    credentials,
    `/ext/api/v2/employees/employees/${encodeURIComponent(update.employeeId)}/status`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  let noteStatus: number | undefined;
  if (update.comment.trim()) {
    const noteResponse = await externalApiRequest(
      origin,
      credentials,
      `/ext/api/v2/employees/employee_notes/${encodeURIComponent(update.employeeId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "active",
          note_type: "employee_administrative",
          content: `AC Tools: ${update.comment.trim()} Employee status updated to ${update.status}.`
        })
      }
    );
    noteStatus = noteResponse.status;
  }

  return { employeeId: update.employeeId, status: statusResponse.status, noteStatus };
}

async function externalApiRequest(
  origin: string,
  credentials: EmployeeApiCredentials,
  path: string,
  init: RequestInit
): Promise<Response> {
  const response = await fetch(new URL(path, origin).toString(), {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Basic ${btoa(`${credentials.publicKey}:${credentials.privateKey}`)}`
    }
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 1000);
    throw new Error(`External API request failed (${response.status}): ${body}`);
  }

  return response;
}

async function getSupportedTabOrigin(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? "";
  if (!isSupportedHost(url)) {
    throw new Error("The active tab is not a supported AlayaCare tenant.");
  }
  return new URL(url).origin;
}

async function syncSidePanelForTab(tabId: number, url: string): Promise<void> {
  if (!("sidePanel" in chrome)) {
    return;
  }

  if (currentSurface !== "sidepanel") {
    return;
  }

  await chrome.sidePanel.setOptions({
    tabId,
    path: SIDE_PANEL_PATH,
    enabled: isSupportedHost(url)
  });
}

function isSupportedHost(url: string): boolean {
  if (!url) {
    return false;
  }

  return (
    /^https:\/\/[^/]+\.alayacare\.(ca|com|cloud)\//i.test(url) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url)
  );
}

function normalizeSupportedOrigin(value: string): string {
  let origin: string;
  try {
    origin = new URL(value).origin;
  } catch {
    throw new Error(`Invalid AlayaCare tenant URL: ${value}`);
  }
  if (!isSupportedOrigin(origin)) {
    throw new Error(`Unsupported AlayaCare tenant URL: ${value}`);
  }
  return origin;
}

function isSupportedOrigin(origin: string): boolean {
  return isSupportedHost(`${origin}/`);
}
