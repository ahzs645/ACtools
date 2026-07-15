import { formatError } from "../../shared/errors";
import type {
  EmployeeApiCredentialStatus,
  EmployeeConfiguredTenant,
  EmployeeCopyMappingSelection,
  EmployeeCopyPlanRequest,
  EmployeeCopyPlanResult,
  EmployeeCopyRequest,
  EmployeeCopyResult,
  EmployeeCopyTargetPlan,
  EmployeeCopyTargetRequest,
  EmployeeCopyTargetResult,
  EmployeeDetail,
  EmployeeMappingKind,
  EmployeeMappingRow,
  EmployeeReference,
  EmployeeWriteResult
} from "../../shared/employees";
import type { EnvironmentHealth, EnvironmentHealthCheck } from "../../shared/environments";
import type { RuntimeMessage } from "../../shared/messages";
import { getSupportedTabOrigin, normalizeSupportedOrigin } from "../alayaCareUrls";
import {
  clearStoredEmployeeApiCredentials,
  listCredentialOrigins,
  loadEmployeeApiCredentials,
  storeEmployeeApiCredentials,
  type EmployeeApiCredentials
} from "./credentialStore";
import {
  deleteEnvironment,
  ensureEnvironment,
  loadEnvironmentRegistry
} from "../environments/environmentStore";

interface ExternalList<T> {
  count?: number;
  items?: T[];
}

interface ExternalReference {
  id: number;
  name?: string;
}

export async function getEmployeeCredentialStatus(
  tabId: number,
  requestedOrigin?: string
): Promise<EmployeeApiCredentialStatus> {
  const origin = requestedOrigin
    ? normalizeSupportedOrigin(requestedOrigin)
    : await getSupportedTabOrigin(tabId);
  const stored = await loadEmployeeApiCredentials(origin);
  return { configured: Boolean(stored), origin, storage: stored?.storage ?? null };
}

export async function setEmployeeCredentials(
  tabId: number,
  input: { publicKey: string; privateKey: string; remember: boolean; origin?: string }
): Promise<EmployeeApiCredentialStatus> {
  const publicKey = input.publicKey.trim();
  const privateKey = input.privateKey.trim();
  if (!publicKey || !privateKey) {
    throw new Error("Both the public and private API keys are required.");
  }
  const origin = input.origin
    ? normalizeSupportedOrigin(input.origin)
    : await getSupportedTabOrigin(tabId);
  const credentials = { publicKey, privateKey };
  await externalApiRequest(origin, credentials, "/ext/api/v2/employees/groups?count=1", {
    method: "GET"
  });
  await storeEmployeeApiCredentials(origin, credentials, input.remember);
  await ensureEnvironment(origin);
  return getEmployeeCredentialStatus(tabId, origin);
}

export async function clearEmployeeCredentials(
  tabId: number,
  requestedOrigin?: string
): Promise<EmployeeApiCredentialStatus> {
  const origin = requestedOrigin
    ? normalizeSupportedOrigin(requestedOrigin)
    : await getSupportedTabOrigin(tabId);
  await clearStoredEmployeeApiCredentials(origin);
  return getEmployeeCredentialStatus(tabId, origin);
}

export async function removeEmployeeEnvironment(origin: string): Promise<void> {
  await clearStoredEmployeeApiCredentials(origin);
  await deleteEnvironment(origin);
}

export async function listEmployeeConfiguredTenants(): Promise<EmployeeConfiguredTenant[]> {
  const [registry, credentialOrigins] = await Promise.all([
    loadEnvironmentRegistry(),
    listCredentialOrigins()
  ]);
  const configured = registry.environments.flatMap((environment) => {
    const storage = credentialOrigins.get(environment.origin);
    return storage ? [{ origin: environment.origin, storage }] : [];
  });
  for (const [origin, storage] of credentialOrigins) {
    if (!configured.some((tenant) => tenant.origin === origin)) {
      configured.push({ origin, storage });
    }
  }
  return configured.sort((a, b) => a.origin.localeCompare(b.origin));
}

export async function synchronizeCredentialEnvironments(): Promise<void> {
  const credentialOrigins = await listCredentialOrigins();
  for (const origin of credentialOrigins.keys()) {
    await ensureEnvironment(origin);
  }
}

export async function checkEnvironmentHealth(originValue: string): Promise<EnvironmentHealth> {
  const origin = normalizeSupportedOrigin(originValue);
  const credentials = await loadEmployeeApiCredentials(origin);
  if (!credentials) {
    return {
      origin,
      checkedAt: new Date().toISOString(),
      configured: false,
      healthy: false,
      checks: [
        {
          id: "authentication",
          label: "Authentication",
          ok: false,
          error: "API credentials are not configured."
        }
      ]
    };
  }

  const definitions: Array<{
    id: EnvironmentHealthCheck["id"];
    label: string;
    path: string;
  }> = [
    { id: "authentication", label: "Authentication", path: "/ext/api/v2/employees/employees/?count=1" },
    { id: "groups", label: "Groups", path: "/ext/api/v2/employees/groups?count=1" },
    { id: "roles", label: "Roles", path: "/ext/api/v2/employees/roles?count=1" },
    { id: "departments", label: "Departments", path: "/ext/api/v2/employees/departments?count=1" },
    { id: "employment_types", label: "Employment types", path: "/ext/api/v2/employees/employment_types?count=1" }
  ];
  const checks = await Promise.all(
    definitions.map(async (definition): Promise<EnvironmentHealthCheck> => {
      try {
        const response = await externalApiRequest(origin, credentials, definition.path, {
          method: "GET"
        });
        const body = (await response.json()) as ExternalList<unknown>;
        return {
          id: definition.id,
          label: definition.label,
          ok: true,
          status: response.status,
          count: body.count ?? body.items?.length
        };
      } catch (error) {
        return { id: definition.id, label: definition.label, ok: false, error: formatError(error) };
      }
    })
  );
  return {
    origin,
    checkedAt: new Date().toISOString(),
    configured: true,
    healthy: checks.every((check) => check.ok),
    checks
  };
}

export async function planEmployeeCopy(
  request: EmployeeCopyPlanRequest
): Promise<EmployeeCopyPlanResult> {
  const targetOrigins = [...new Set(request.targetOrigins)].map(normalizeSupportedOrigin);
  const plans: EmployeeCopyTargetPlan[] = [];
  for (const origin of targetOrigins) {
    try {
      plans.push(await planEmployeeCopyTarget(request.employee, origin));
    } catch (error) {
      plans.push({ origin, mappings: [], ready: false, error: formatError(error) });
    }
  }
  return { sourceEmployeeId: request.employee.id, plans };
}

async function planEmployeeCopyTarget(
  employee: EmployeeDetail,
  origin: string
): Promise<EmployeeCopyTargetPlan> {
  const credentials = await requireCredentials(origin);
  const catalogs = await loadTargetCatalogs(origin, credentials);
  const mappings = [
    ...buildMappingRows("groups", employee.groups, catalogs.groups),
    ...buildMappingRows("roles", employee.roles, catalogs.roles),
    ...buildMappingRows("departments", employee.departments, catalogs.departments),
    ...buildMappingRows(
      "employment_type",
      employee.employment_type ? [employee.employment_type] : [],
      catalogs.employmentTypes
    )
  ];
  const duplicateEmployee = await findDuplicateEmployee(origin, credentials, employee);
  return {
    origin,
    duplicateEmployee: duplicateEmployee ?? undefined,
    mappings,
    ready: !duplicateEmployee && mappings.every((mapping) => mapping.targetId !== null)
  };
}

export async function copyEmployeeTarget(
  sourceOriginValue: string,
  request: EmployeeCopyTargetRequest
): Promise<EmployeeCopyTargetResult> {
  const sourceOrigin = normalizeSupportedOrigin(sourceOriginValue);
  const targetOrigin = normalizeSupportedOrigin(request.targetOrigin);
  if (targetOrigin === sourceOrigin) {
    throw new Error("The source tenant cannot also be a copy target.");
  }
  const ticket = request.ticket.trim();
  if (ticket.length < 5) {
    throw new Error("Enter a ticket number or change reference with at least 5 characters.");
  }
  const credentials = await requireCredentials(targetOrigin);
  const duplicate = await findDuplicateEmployee(targetOrigin, credentials, request.employee);
  if (duplicate) {
    throw new Error(`Employee #${duplicate.id} already uses this email or username in the target tenant.`);
  }
  const catalogs = await loadTargetCatalogs(targetOrigin, credentials);
  validateMappingSelections(request.employee, request.mappings, catalogs);
  return createEmployeeFromMappings(
    request.employee,
    sourceOrigin,
    targetOrigin,
    ticket,
    request.mappings,
    credentials
  );
}

export async function copyEmployeeLegacy(
  tabId: number,
  request: EmployeeCopyRequest
): Promise<EmployeeCopyResult> {
  const sourceOrigin = await getSupportedTabOrigin(tabId);
  const plan = await planEmployeeCopy({ employee: request.employee, targetOrigins: request.targetOrigins });
  const results: EmployeeCopyTargetResult[] = [];
  for (const targetPlan of plan.plans) {
    if (!targetPlan.ready) {
      results.push({
        origin: targetPlan.origin,
        ok: false,
        error: targetPlan.error ?? (targetPlan.duplicateEmployee ? "A duplicate employee exists." : "Mappings are incomplete.")
      });
      continue;
    }
    try {
      results.push(
        await copyEmployeeTarget(sourceOrigin, {
          employee: request.employee,
          sourceOrigin,
          targetOrigin: targetPlan.origin,
          ticket: request.ticket,
          mappings: targetPlan.mappings.map((mapping) => ({
            kind: mapping.kind,
            sourceId: mapping.sourceId,
            targetId: mapping.targetId!
          }))
        })
      );
    } catch (error) {
      results.push({ origin: targetPlan.origin, ok: false, error: formatError(error) });
    }
  }
  return { sourceEmployeeId: request.employee.id, results };
}

export async function updateEmployeeStatus(
  tabId: number,
  update: Extract<RuntimeMessage, { type: "ac/popup/update-employee-status" }>["payload"]
): Promise<EmployeeWriteResult> {
  const origin = await getSupportedTabOrigin(tabId);
  const credentials = await requireCredentials(origin);
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

interface TargetCatalogs {
  groups: ExternalReference[];
  roles: ExternalReference[];
  departments: ExternalReference[];
  employmentTypes: ExternalReference[];
}

async function loadTargetCatalogs(
  origin: string,
  credentials: EmployeeApiCredentials
): Promise<TargetCatalogs> {
  const [groups, roles, departments, employmentTypes] = await Promise.all([
    externalApiJson<ExternalList<ExternalReference>>(origin, credentials, "/ext/api/v2/employees/groups?count=9999999"),
    externalApiJson<ExternalList<ExternalReference>>(origin, credentials, "/ext/api/v2/employees/roles?count=9999999"),
    externalApiJson<ExternalList<ExternalReference>>(origin, credentials, "/ext/api/v2/employees/departments?count=9999999"),
    externalApiJson<ExternalList<ExternalReference>>(origin, credentials, "/ext/api/v2/employees/employment_types?count=9999999")
  ]);
  return {
    groups: groups.items ?? [],
    roles: roles.items ?? [],
    departments: departments.items ?? [],
    employmentTypes: employmentTypes.items ?? []
  };
}

function buildMappingRows(
  kind: EmployeeMappingKind,
  sources: EmployeeReference[] | undefined,
  targets: ExternalReference[]
): EmployeeMappingRow[] {
  const options = targets
    .filter((target): target is ExternalReference & { name: string } => Boolean(target.name?.trim()))
    .map((target) => ({ id: target.id, name: target.name.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (sources ?? []).map((source) => {
    const sourceName = source.name?.trim() || `#${source.id}`;
    const exact = options.find(
      (option) => option.name.toLocaleLowerCase() === sourceName.toLocaleLowerCase()
    );
    return {
      kind,
      sourceId: source.id,
      sourceName,
      targetId: exact?.id ?? null,
      exactMatch: Boolean(exact),
      options
    };
  });
}

async function findDuplicateEmployee(
  origin: string,
  credentials: EmployeeApiCredentials,
  employee: EmployeeDetail
): Promise<{ id: number; name: string; email?: string } | null> {
  const email = (employee.demographics?.email ?? employee.email ?? "").trim().toLocaleLowerCase();
  const username = (employee.username ?? "").trim().toLocaleLowerCase();
  if (!email && !username) {
    return null;
  }
  const response = await externalApiJson<ExternalList<EmployeeDetail>>(
    origin,
    credentials,
    "/ext/api/v2/employees/employees/?count=9999999"
  );
  const duplicate = (response.items ?? []).find((candidate) => {
    const candidateEmail = (candidate.demographics?.email ?? candidate.email ?? "").trim().toLocaleLowerCase();
    const candidateUsername = (candidate.username ?? "").trim().toLocaleLowerCase();
    return Boolean((email && candidateEmail === email) || (username && candidateUsername === username));
  });
  if (!duplicate) {
    return null;
  }
  const name = [
    duplicate.demographics?.first_name ?? duplicate.first_name,
    duplicate.demographics?.last_name ?? duplicate.last_name
  ].filter(Boolean).join(" ") || `Employee #${duplicate.id}`;
  return { id: duplicate.id, name, email: duplicate.demographics?.email ?? duplicate.email };
}

function validateMappingSelections(
  employee: EmployeeDetail,
  selections: EmployeeCopyMappingSelection[],
  catalogs: TargetCatalogs
): void {
  const expected: Array<[EmployeeMappingKind, EmployeeReference[] | undefined, ExternalReference[]]> = [
    ["groups", employee.groups, catalogs.groups],
    ["roles", employee.roles, catalogs.roles],
    ["departments", employee.departments, catalogs.departments],
    ["employment_type", employee.employment_type ? [employee.employment_type] : [], catalogs.employmentTypes]
  ];
  for (const [kind, sources, targets] of expected) {
    for (const source of sources ?? []) {
      const selection = selections.find((item) => item.kind === kind && item.sourceId === source.id);
      if (!selection || !targets.some((target) => target.id === selection.targetId)) {
        throw new Error(`The ${kind.replace("_", " ")} mapping for ${source.name ?? source.id} is missing or invalid.`);
      }
    }
  }
}

async function createEmployeeFromMappings(
  employee: EmployeeDetail,
  sourceOrigin: string,
  targetOrigin: string,
  ticket: string,
  selections: EmployeeCopyMappingSelection[],
  credentials: EmployeeApiCredentials
): Promise<EmployeeCopyTargetResult> {
  const select = (kind: EmployeeMappingKind, sourceId: number) => ({
    id: selections.find((item) => item.kind === kind && item.sourceId === sourceId)!.targetId
  });
  const demographics = {
    ...employee.demographics,
    first_name: employee.demographics?.first_name ?? employee.first_name ?? "",
    last_name: employee.demographics?.last_name ?? employee.last_name ?? "",
    email: employee.demographics?.email ?? employee.email ?? ""
  };
  const payload = removeUndefined({
    demographics,
    username: employee.username || demographics.email,
    roles: (employee.roles ?? []).map((item) => select("roles", item.id)),
    groups: (employee.groups ?? []).map((item) => select("groups", item.id)),
    departments: (employee.departments ?? []).map((item) => select("departments", item.id)),
    designation: employee.designation,
    payroll_number: employee.payroll_number,
    seniority: employee.seniority,
    max_weekly_capacity: employee.max_weekly_capacity,
    min_weekly_capacity: employee.min_weekly_capacity,
    max_daily_capacity: employee.max_daily_capacity,
    min_daily_capacity: employee.min_daily_capacity,
    default_availability: employee.default_availability,
    employment_type: employee.employment_type
      ? select("employment_type", employee.employment_type.id)
      : undefined,
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
      body: JSON.stringify(payload)
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
  return { origin: targetOrigin, ok: true, employeeId: created.id, noteStatus: noteResponse.status };
}

async function requireCredentials(origin: string) {
  const credentials = await loadEmployeeApiCredentials(origin);
  if (!credentials) {
    throw new Error("No API credentials are configured for this tenant.");
  }
  return credentials;
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

function removeUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
