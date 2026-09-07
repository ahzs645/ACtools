import { formatError } from "../shared/errors";
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
  EmployeeWriteResult,
} from "../shared/employees";
import type {
  EnvironmentHealth,
  EnvironmentHealthCheck,
} from "../shared/environments";
import type { EmployeeStatusUpdate } from "../shared/employees";
import { normalizeSupportedOrigin } from "../alayaCareUrls";
import type { CorePlatform } from "../platform";
import {
  CredentialStore,
  type EmployeeApiCredentials,
} from "./credentialStore";
import { EnvironmentStore } from "./environmentStore";

interface ExternalList<T> {
  count?: number;
  items?: T[];
}

interface ExternalReference {
  id: number;
  name?: string;
}

/**
 * External ("ext") API pathway: everything AC Tools does with tenant API keys.
 *
 * Every method takes an explicit tenant origin. Hosts resolve "the current
 * tenant" themselves (the active tab in the extension, the selected tenant in
 * the desktop app) before calling in.
 */
export class EmployeeService {
  readonly credentials: CredentialStore;
  readonly environments: EnvironmentStore;

  constructor(private readonly platform: CorePlatform) {
    this.credentials = new CredentialStore(platform);
    this.environments = new EnvironmentStore(platform.local);
  }

  async getCredentialStatus(
    originValue: string,
  ): Promise<EmployeeApiCredentialStatus> {
    const origin = normalizeSupportedOrigin(originValue);
    const stored = await this.credentials.load(origin);
    return {
      configured: Boolean(stored),
      origin,
      storage: stored?.storage ?? null,
    };
  }

  async setCredentials(
    origin: string,
    input: { publicKey: string; privateKey: string; remember: boolean },
  ): Promise<EmployeeApiCredentialStatus> {
    const publicKey = input.publicKey.trim();
    const privateKey = input.privateKey.trim();
    if (!publicKey || !privateKey) {
      throw new Error("Both the public and private API keys are required.");
    }
    const normalizedOrigin = normalizeSupportedOrigin(origin);
    const credentials = { publicKey, privateKey };
    await this.request(
      normalizedOrigin,
      credentials,
      "/ext/api/v2/employees/groups?count=1",
      {
        method: "GET",
      },
    );
    await this.credentials.store(normalizedOrigin, credentials, input.remember);
    await this.environments.ensure(normalizedOrigin);
    return this.getCredentialStatus(normalizedOrigin);
  }

  async clearCredentials(
    originValue: string,
  ): Promise<EmployeeApiCredentialStatus> {
    const origin = normalizeSupportedOrigin(originValue);
    await this.credentials.clear(origin);
    return this.getCredentialStatus(origin);
  }

  async removeEnvironment(origin: string): Promise<void> {
    await this.credentials.clear(origin);
    await this.environments.delete(origin);
  }

  async listConfiguredTenants(): Promise<EmployeeConfiguredTenant[]> {
    const [registry, credentialOrigins] = await Promise.all([
      this.environments.load(),
      this.credentials.listOrigins(),
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

  async synchronizeCredentialEnvironments(): Promise<void> {
    const credentialOrigins = await this.credentials.listOrigins();
    for (const origin of credentialOrigins.keys()) {
      await this.environments.ensure(origin);
    }
  }

  async checkEnvironmentHealth(
    originValue: string,
  ): Promise<EnvironmentHealth> {
    const origin = normalizeSupportedOrigin(originValue);
    const credentials = await this.credentials.load(origin);
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
            error: "API credentials are not configured.",
          },
        ],
      };
    }

    const definitions: Array<{
      id: EnvironmentHealthCheck["id"];
      label: string;
      path: string;
    }> = [
      {
        id: "authentication",
        label: "Authentication",
        path: "/ext/api/v2/employees/employees/?count=1",
      },
      {
        id: "groups",
        label: "Groups",
        path: "/ext/api/v2/employees/groups?count=1",
      },
      {
        id: "roles",
        label: "Roles",
        path: "/ext/api/v2/employees/roles?count=1",
      },
      {
        id: "departments",
        label: "Departments",
        path: "/ext/api/v2/employees/departments?count=1",
      },
      {
        id: "employment_types",
        label: "Employment types",
        path: "/ext/api/v2/employees/employment_types?count=1",
      },
    ];
    const checks = await Promise.all(
      definitions.map(async (definition): Promise<EnvironmentHealthCheck> => {
        try {
          const response = await this.request(
            origin,
            credentials,
            definition.path,
            {
              method: "GET",
            },
          );
          const body = (await response.json()) as ExternalList<unknown>;
          return {
            id: definition.id,
            label: definition.label,
            ok: true,
            status: response.status,
            count: body.count ?? body.items?.length,
          };
        } catch (error) {
          return {
            id: definition.id,
            label: definition.label,
            ok: false,
            error: formatError(error),
          };
        }
      }),
    );
    return {
      origin,
      checkedAt: new Date().toISOString(),
      configured: true,
      healthy: checks.every((check) => check.ok),
      checks,
    };
  }

  async planCopy(
    request: EmployeeCopyPlanRequest,
  ): Promise<EmployeeCopyPlanResult> {
    const targetOrigins = [...new Set(request.targetOrigins)].map(
      normalizeSupportedOrigin,
    );
    const plans: EmployeeCopyTargetPlan[] = [];
    for (const origin of targetOrigins) {
      try {
        plans.push(await this.planCopyTarget(request.employee, origin));
      } catch (error) {
        plans.push({
          origin,
          mappings: [],
          ready: false,
          error: formatError(error),
        });
      }
    }
    return { sourceEmployeeId: request.employee.id, plans };
  }

  private async planCopyTarget(
    employee: EmployeeDetail,
    origin: string,
  ): Promise<EmployeeCopyTargetPlan> {
    const credentials = await this.requireCredentials(origin);
    const catalogs = await this.loadTargetCatalogs(origin, credentials);
    const mappings = [
      ...buildMappingRows("groups", employee.groups, catalogs.groups),
      ...buildMappingRows("roles", employee.roles, catalogs.roles),
      ...buildMappingRows(
        "departments",
        employee.departments,
        catalogs.departments,
      ),
      ...buildMappingRows(
        "employment_type",
        employee.employment_type ? [employee.employment_type] : [],
        catalogs.employmentTypes,
      ),
    ];
    const duplicateEmployee = await this.findDuplicateEmployee(
      origin,
      credentials,
      employee,
    );
    return {
      origin,
      duplicateEmployee: duplicateEmployee ?? undefined,
      mappings,
      ready:
        !duplicateEmployee &&
        mappings.every((mapping) => mapping.targetId !== null),
    };
  }

  async copyTarget(
    sourceOriginValue: string,
    request: EmployeeCopyTargetRequest,
  ): Promise<EmployeeCopyTargetResult> {
    const sourceOrigin = normalizeSupportedOrigin(sourceOriginValue);
    const targetOrigin = normalizeSupportedOrigin(request.targetOrigin);
    if (targetOrigin === sourceOrigin) {
      throw new Error("The source tenant cannot also be a copy target.");
    }
    const ticket = request.ticket.trim();
    if (ticket.length < 5) {
      throw new Error(
        "Enter a ticket number or change reference with at least 5 characters.",
      );
    }
    const credentials = await this.requireCredentials(targetOrigin);
    const duplicate = await this.findDuplicateEmployee(
      targetOrigin,
      credentials,
      request.employee,
    );
    if (duplicate) {
      throw new Error(
        `Employee #${duplicate.id} already uses this email or username in the target tenant.`,
      );
    }
    const catalogs = await this.loadTargetCatalogs(targetOrigin, credentials);
    validateMappingSelections(request.employee, request.mappings, catalogs);
    return this.createEmployeeFromMappings(
      request.employee,
      sourceOrigin,
      targetOrigin,
      ticket,
      request.mappings,
      credentials,
    );
  }

  async copyLegacy(
    sourceOriginValue: string,
    request: EmployeeCopyRequest,
  ): Promise<EmployeeCopyResult> {
    const sourceOrigin = normalizeSupportedOrigin(sourceOriginValue);
    const plan = await this.planCopy({
      employee: request.employee,
      targetOrigins: request.targetOrigins,
    });
    const results: EmployeeCopyTargetResult[] = [];
    for (const targetPlan of plan.plans) {
      if (!targetPlan.ready) {
        results.push({
          origin: targetPlan.origin,
          ok: false,
          error:
            targetPlan.error ??
            (targetPlan.duplicateEmployee
              ? "A duplicate employee exists."
              : "Mappings are incomplete."),
        });
        continue;
      }
      try {
        results.push(
          await this.copyTarget(sourceOrigin, {
            employee: request.employee,
            sourceOrigin,
            targetOrigin: targetPlan.origin,
            ticket: request.ticket,
            mappings: targetPlan.mappings.map((mapping) => ({
              kind: mapping.kind,
              sourceId: mapping.sourceId,
              targetId: mapping.targetId!,
            })),
          }),
        );
      } catch (error) {
        results.push({
          origin: targetPlan.origin,
          ok: false,
          error: formatError(error),
        });
      }
    }
    return { sourceEmployeeId: request.employee.id, results };
  }

  async updateStatus(
    originValue: string,
    update: EmployeeStatusUpdate,
  ): Promise<EmployeeWriteResult> {
    const origin = normalizeSupportedOrigin(originValue);
    const credentials = await this.requireCredentials(origin);
    const payload: Record<string, string> = { status: update.status };
    if (update.comment.trim()) {
      payload.comment = update.comment.trim();
    }
    const statusResponse = await this.request(
      origin,
      credentials,
      `/ext/api/v2/employees/employees/${encodeURIComponent(update.employeeId)}/status`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    let noteStatus: number | undefined;
    if (update.comment.trim()) {
      const noteResponse = await this.request(
        origin,
        credentials,
        `/ext/api/v2/employees/employee_notes/${encodeURIComponent(update.employeeId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "active",
            note_type: "employee_administrative",
            content: `AC Tools: ${update.comment.trim()} Employee status updated to ${update.status}.`,
          }),
        },
      );
      noteStatus = noteResponse.status;
    }
    return {
      employeeId: update.employeeId,
      status: statusResponse.status,
      noteStatus,
    };
  }

  private async loadTargetCatalogs(
    origin: string,
    credentials: EmployeeApiCredentials,
  ): Promise<TargetCatalogs> {
    const [groups, roles, departments, employmentTypes] = await Promise.all([
      this.json<ExternalList<ExternalReference>>(
        origin,
        credentials,
        "/ext/api/v2/employees/groups?count=9999999",
      ),
      this.json<ExternalList<ExternalReference>>(
        origin,
        credentials,
        "/ext/api/v2/employees/roles?count=9999999",
      ),
      this.json<ExternalList<ExternalReference>>(
        origin,
        credentials,
        "/ext/api/v2/employees/departments?count=9999999",
      ),
      this.json<ExternalList<ExternalReference>>(
        origin,
        credentials,
        "/ext/api/v2/employees/employment_types?count=9999999",
      ),
    ]);
    return {
      groups: groups.items ?? [],
      roles: roles.items ?? [],
      departments: departments.items ?? [],
      employmentTypes: employmentTypes.items ?? [],
    };
  }

  private async findDuplicateEmployee(
    origin: string,
    credentials: EmployeeApiCredentials,
    employee: EmployeeDetail,
  ): Promise<{ id: number; name: string; email?: string } | null> {
    const email = (employee.demographics?.email ?? employee.email ?? "")
      .trim()
      .toLocaleLowerCase();
    const username = (employee.username ?? "").trim().toLocaleLowerCase();
    if (!email && !username) {
      return null;
    }
    const response = await this.json<ExternalList<EmployeeDetail>>(
      origin,
      credentials,
      "/ext/api/v2/employees/employees/?count=9999999",
    );
    const duplicate = (response.items ?? []).find((candidate) => {
      const candidateEmail = (
        candidate.demographics?.email ??
        candidate.email ??
        ""
      )
        .trim()
        .toLocaleLowerCase();
      const candidateUsername = (candidate.username ?? "")
        .trim()
        .toLocaleLowerCase();
      return Boolean(
        (email && candidateEmail === email) ||
        (username && candidateUsername === username),
      );
    });
    if (!duplicate) {
      return null;
    }
    const name =
      [
        duplicate.demographics?.first_name ?? duplicate.first_name,
        duplicate.demographics?.last_name ?? duplicate.last_name,
      ]
        .filter(Boolean)
        .join(" ") || `Employee #${duplicate.id}`;
    return {
      id: duplicate.id,
      name,
      email: duplicate.demographics?.email ?? duplicate.email,
    };
  }

  private async createEmployeeFromMappings(
    employee: EmployeeDetail,
    sourceOrigin: string,
    targetOrigin: string,
    ticket: string,
    selections: EmployeeCopyMappingSelection[],
    credentials: EmployeeApiCredentials,
  ): Promise<EmployeeCopyTargetResult> {
    const select = (kind: EmployeeMappingKind, sourceId: number) => ({
      id: selections.find(
        (item) => item.kind === kind && item.sourceId === sourceId,
      )!.targetId,
    });
    const demographics = {
      ...employee.demographics,
      first_name:
        employee.demographics?.first_name ?? employee.first_name ?? "",
      last_name: employee.demographics?.last_name ?? employee.last_name ?? "",
      email: employee.demographics?.email ?? employee.email ?? "",
    };
    const payload = removeUndefined({
      demographics,
      username: employee.username || demographics.email,
      roles: (employee.roles ?? []).map((item) => select("roles", item.id)),
      groups: (employee.groups ?? []).map((item) => select("groups", item.id)),
      departments: (employee.departments ?? []).map((item) =>
        select("departments", item.id),
      ),
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
      status: employee.status || "active",
    });
    const created = await this.json<{ id?: number }>(
      targetOrigin,
      credentials,
      "/ext/api/v2/employees/employees/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!created.id) {
      throw new Error("The target tenant created no employee ID.");
    }
    const noteResponse = await this.request(
      targetOrigin,
      credentials,
      `/ext/api/v2/employees/employee_notes/${encodeURIComponent(created.id)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "active",
          note_type: "employee_administrative",
          content: `Ticket ${ticket}, employee copied from ${sourceOrigin} by AC Tools.`,
        }),
      },
    );
    return {
      origin: targetOrigin,
      ok: true,
      employeeId: created.id,
      noteStatus: noteResponse.status,
    };
  }

  private async requireCredentials(
    origin: string,
  ): Promise<EmployeeApiCredentials> {
    const credentials = await this.credentials.load(origin);
    if (!credentials) {
      throw new Error("No API credentials are configured for this tenant.");
    }
    return credentials;
  }

  private async json<T>(
    origin: string,
    credentials: EmployeeApiCredentials,
    path: string,
    init: RequestInit = { method: "GET" },
  ): Promise<T> {
    const response = await this.request(origin, credentials, path, init);
    return response.json() as Promise<T>;
  }

  private async request(
    origin: string,
    credentials: EmployeeApiCredentials,
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    const response = await this.platform.fetch(
      new URL(path, origin).toString(),
      {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Basic ${btoa(`${credentials.publicKey}:${credentials.privateKey}`)}`,
        },
      },
    );
    if (!response.ok) {
      const body = (await response.text()).slice(0, 1000);
      throw new Error(
        `External API request failed (${response.status}): ${body}`,
      );
    }
    return response;
  }
}

interface TargetCatalogs {
  groups: ExternalReference[];
  roles: ExternalReference[];
  departments: ExternalReference[];
  employmentTypes: ExternalReference[];
}

function buildMappingRows(
  kind: EmployeeMappingKind,
  sources: EmployeeReference[] | undefined,
  targets: ExternalReference[],
): EmployeeMappingRow[] {
  const options = targets
    .filter((target): target is ExternalReference & { name: string } =>
      Boolean(target.name?.trim()),
    )
    .map((target) => ({ id: target.id, name: target.name.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (sources ?? []).map((source) => {
    const sourceName = source.name?.trim() || `#${source.id}`;
    const exact = options.find(
      (option) =>
        option.name.toLocaleLowerCase() === sourceName.toLocaleLowerCase(),
    );
    return {
      kind,
      sourceId: source.id,
      sourceName,
      targetId: exact?.id ?? null,
      exactMatch: Boolean(exact),
      options,
    };
  });
}

function validateMappingSelections(
  employee: EmployeeDetail,
  selections: EmployeeCopyMappingSelection[],
  catalogs: TargetCatalogs,
): void {
  const expected: Array<
    [EmployeeMappingKind, EmployeeReference[] | undefined, ExternalReference[]]
  > = [
    ["groups", employee.groups, catalogs.groups],
    ["roles", employee.roles, catalogs.roles],
    ["departments", employee.departments, catalogs.departments],
    [
      "employment_type",
      employee.employment_type ? [employee.employment_type] : [],
      catalogs.employmentTypes,
    ],
  ];
  for (const [kind, sources, targets] of expected) {
    for (const source of sources ?? []) {
      const selection = selections.find(
        (item) => item.kind === kind && item.sourceId === source.id,
      );
      if (
        !selection ||
        !targets.some((target) => target.id === selection.targetId)
      ) {
        throw new Error(
          `The ${kind.replace("_", " ")} mapping for ${source.name ?? source.id} is missing or invalid.`,
        );
      }
    }
  }
}

function removeUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
