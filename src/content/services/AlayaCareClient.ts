import type { AvailabilityDraft, AvailabilityPostResult, PageStatus } from "../../shared/messages";
import type {
  EmployeeDetail,
  EmployeeListRequest,
  EmployeeListResult
} from "../../shared/employees";
import {
  buildAlayaCareFormContextCatalog,
  type AlayaCareFormContextCatalogSnapshot
} from "../../shared/formContextCatalog";
import {
  ALAYACARE_CLIENT_CHART_EXPORT_KIND,
  ALAYACARE_CLIENT_CHART_EXPORT_SCHEMA_VERSION,
  readActiveClientRoute,
  type ClientChartExportSnapshot,
  type ClientChartRankedResult,
  type ClientChartRankResponse,
  type ClientChartSearchResponse,
  type ClientChartSearchResult,
  type ClientChartSection
} from "../../shared/clientChart";
import {
  ALAYACARE_CLIENT_CHART_IMPORT_SCHEMA_VERSION,
  isSyntheticClientName,
  sanitizeMedicalHistoryForImport,
  sanitizeMedicationsForImport,
  sanitizeProgressNotesForImport,
  sanitizeRiskAssessmentForImport,
  type ClientChartDestinationCatalog,
  type ClientChartDestinationCostCentre,
  type ClientChartDestinationGroup,
  type ClientChartMedicationImport,
  type ClientChartProgressNoteImport,
  type ClientChartImportRequest,
  type ClientChartImportResult,
  type ClientChartImportStepResult
} from "../../shared/clientChartImport";
import type {
  ShiftServiceLocation,
  ShiftServiceLocationSearchResponse
} from "../../shared/shiftLab";
import type {
  ConnectorBlueprint,
  ConnectorConnectionReference,
  ConnectorDataStoreReference,
  ConnectorDataStructureReference,
  ConnectorFunctionReference,
  ConnectorKeyReference,
  ConnectorReferenceCatalog,
  ConnectorScenarioHealth,
  ConnectorScenarioRun,
  ConnectorScenarioBundle,
  ConnectorScenarioBulkDownloadResult,
  ConnectorScenarioListItem,
  ConnectorScenarioListResult,
  ConnectorScenarioMetadata,
  ConnectorScenarioSaveRequest,
  ConnectorScenarioSaveResult,
  ConnectorScenarioSnapshot,
  ConnectorScenarioSource,
  ConnectorTemplateReference,
  ConnectorWebhookReference
} from "../../shared/connectorScenarios";
import { summarizeConnectorBlueprint, validateConnectorBlueprint } from "../../shared/connectorScenarios";
import { strToU8, zipSync } from "fflate";
import { buildDailyRrule, getLocalDayUtcRange, minutesBetween } from "../utils/time";

interface StoreConfigResponse {
  currentBranch?: {
    id?: number | string;
  };
  current_user?: {
    id?: number;
    first_name?: string;
    last_name?: string;
  };
}

export interface Department {
  id?: number | string;
  department_id?: number | string;
  name: string;
}

export interface EmployeeRecord {
  id: number;
  first_name?: string;
  last_name?: string;
  _link?: string;
  alayacare_employee_id?: number;
  status?: string;
  designation?: string;
  departments?: Department[];
}

interface PagedResponse<T> {
  count?: number;
  items?: T[];
}

interface ClientChartOverviewRecord extends Record<string, unknown> {
  id?: number;
  guid?: number;
  profile_id?: number;
  branch_id?: number;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  preferred_name?: string;
  status?: string;
  external_id?: string | null;
}

interface ClientChartPagination {
  items: Record<string, unknown>[];
  reportedCount?: number;
  totalPages: number;
  totalVerified: boolean;
}

interface ClientChartHtmlTable {
  title?: string;
  columns: string[];
  rows: string[][];
}

interface ClientSearchAssociate {
  entity_id?: number;
  guid_to?: number;
  profile_id?: number;
  subtype?: string;
}

interface ClientSearchApiItem {
  demographics?: Record<string, unknown>;
  patient_status?: string;
  profile_id?: number;
  branch_name?: string;
  associates?: ClientSearchAssociate[];
  client_groups?: Array<{ name?: string }>;
}

interface ClientSearchApiResponse {
  count?: number;
  items?: ClientSearchApiItem[];
}

interface ClientListApiItem {
  id?: number;
  guid?: number;
  branch_id?: number;
  first_name?: string;
  last_name?: string;
  preferred_name?: string;
  birthday?: string;
  status?: string;
  external_id?: string | null;
  emergency_response_level?: string;
  address?: string;
  phone_main?: string;
  phone_personal?: string;
  phone_other?: string;
  groups?: string[];
  tags_v2?: string[];
}

interface ClientListApiResponse {
  count?: number;
  items?: ClientListApiItem[];
}

interface ClientCreateApiResponse extends Record<string, unknown> {
  id?: number | string;
}

interface ShiftLocationAutocompleteItem extends Record<string, unknown> {
  id?: number | string;
  value?: number | string;
  branch_id?: number | string;
  label?: string;
  type?: string;
}

interface ScheduleRecord {
  duration?: number;
  rrule?: string;
  time_off_type?: {
    name?: string;
  };
  availability_type?: {
    name?: string;
  };
}

interface ConnectorScenarioApiRecord {
  id?: number;
  name?: string;
  teamId?: number;
  description?: string;
  folderId?: number | null;
  concept?: boolean;
  isPaused?: boolean;
  isActive?: boolean;
  iswaiting?: boolean;
  scheduling?: unknown;
  nextExec?: string;
  dlqCount?: number | string;
  allDlqCount?: number | string;
  created?: string;
  lastEdit?: string;
  usedPackages?: string[];
  isinvalid?: boolean;
  islocked?: boolean;
  operations?: number | string;
  transfer?: number | string;
}

interface ConnectorScenarioApiResponse {
  scenario?: ConnectorScenarioApiRecord;
}

interface ConnectorBlueprintApiResponse {
  blueprint?: ConnectorBlueprint | null;
  scheduling?: unknown;
  metadata?: unknown;
  idSequence?: number;
  last_edit?: string;
}

interface ConnectorTeamApiResponse {
  team?: {
    id?: number;
    name?: string;
    organizationId?: number;
  };
}

interface ConnectorScenarioListApiResponse {
  scenarios?: ConnectorScenarioApiRecord[];
}

export interface ClientRecord {
  id?: number | string;
  full_name?: string;
}

export interface VisitRecord {
  start_at?: string;
  end_at?: string;
  status?: string;
  alayacare_visit_id?: number;
  visit_id?: number;
  cancel_code?: {
    code?: string;
  };
  client?: ClientRecord;
  service?: {
    name?: string;
    service_code_name?: string;
  };
}

export interface UserContext {
  status: PageStatus;
  departments: Department[];
}

export interface ScheduleBundle {
  availabilities: ScheduleRecord[];
  unavailabilities: ScheduleRecord[];
  visits: VisitRecord[];
}

export class AlayaCareClient {
  private userContextPromise: Promise<UserContext> | null = null;

  async getStatus(): Promise<PageStatus> {
    if (window.location.hostname.toLowerCase().startsWith("connector.")) {
      try {
        const teamMatch = /^\/(\d+)(?:\/|$)/.exec(window.location.pathname);
        const probeUrl = teamMatch
          ? `/api/v2/teams/${Number(teamMatch[1])}`
          : "/api/v2/users/me?cols%5B0%5D=id&cols%5B1%5D=name";
        await this.fetchConnectorJson<unknown>(probeUrl);
        return {
          ready: true,
          location: window.location.origin
        };
      } catch {
        return {
          ready: false,
          location: window.location.origin,
          reason: "Connector is open, but the current browser session could not be verified."
        };
      }
    }

    try {
      const config = await this.fetchJson<StoreConfigResponse>("/app/storeConfig");
      const firstName = config.current_user?.first_name?.trim() ?? "";
      const lastName = config.current_user?.last_name?.trim() ?? "";
      const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

      return {
        ready: true,
        location: window.location.origin,
        currentUserId: config.current_user?.id,
        currentUserName: fullName || undefined
      };
    } catch {
      return {
        ready: false,
        location: window.location.origin,
        reason: "This page does not look like an authenticated AlayaCare session."
      };
    }
  }

  async getUserContext(): Promise<UserContext> {
    if (!this.userContextPromise) {
      this.userContextPromise = this.loadUserContext();
    }

    return this.userContextPromise;
  }

  async getEmployees(departmentId: string, status: string, designation: string): Promise<EmployeeRecord[]> {
    const response = await this.fetchJson<PagedResponse<EmployeeRecord>>(
      `/api/v2/employees/employees?${new URLSearchParams({
        status,
        department: departmentId,
        designation
      }).toString()}`
    );

    return (response.items ?? []).slice().sort(compareEmployees);
  }

  async getSchedule(employeeId: number, visitEmployeeId: number, date: string): Promise<ScheduleBundle> {
    const [availabilities, unavailabilities, visits] = await Promise.all([
      this.fetchSchedule(`/api/v2/employees/employee/${employeeId}/availabilities`, date),
      this.fetchSchedule(`/api/v2/employees/employee/${employeeId}/unavailabilities`, date),
      this.fetchVisits(visitEmployeeId, date)
    ]);

    return {
      availabilities,
      unavailabilities,
      visits
    };
  }

  async getVisitDetails(visitId: string): Promise<VisitRecord> {
    return this.fetchJson<VisitRecord>(`/api/v2/scheduler/visits/${encodeURIComponent(visitId)}`);
  }

  async listEmployees(request: EmployeeListRequest): Promise<EmployeeListResult> {
    const count = Math.min(Math.max(request.count ?? 500, 1), 2000);
    const params = new URLSearchParams({ count: String(count) });
    if (request.status && request.status !== "all") {
      params.set("status", request.status);
    }

    const response = await this.fetchJson<PagedResponse<EmployeeDetail>>(
      `/ext/api/v2/employees/employees/?${params.toString()}`
    );
    const items = (response.items ?? []).slice().sort(compareEmployees);

    return {
      items,
      count: response.count ?? items.length
    };
  }

  async getEmployeeDetail(employeeId: number): Promise<EmployeeDetail> {
    return this.fetchJson<EmployeeDetail>(
      `/ext/api/v2/employees/employees/${encodeURIComponent(employeeId)}`
    );
  }

  async exportFormContextCatalog(): Promise<AlayaCareFormContextCatalogSnapshot> {
    const [contexts, fields, profileAttributes, configuration, countries] = await Promise.all([
      this.fetchJson<unknown>("/api/v1/agency/form-context/contexts"),
      this.fetchJson<unknown>("/api/v1/agency/form-context/fields?include_contexts=true"),
      this.fetchJson<unknown>("/api/v1/config/profile_attributes"),
      this.fetchJson<unknown>("/api/v1/config/"),
      this.fetchJson<unknown>(
        "/api/v1/config/countries?only_supported=true&include_subdivisions=false"
      )
    ]);

    return buildAlayaCareFormContextCatalog({
      tenantOrigin: window.location.origin,
      contexts,
      fields,
      profileAttributes,
      configuration,
      countries
    });
  }

  async searchClientCharts(
    query: string,
    confirmedSynthetic: boolean
  ): Promise<ClientChartSearchResponse> {
    this.assertSyntheticUatClientChartAccess(confirmedSynthetic);
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      throw new Error("Enter at least two characters to search for a synthetic UAT client.");
    }
    if (normalizedQuery.length > 100) {
      throw new Error("Client search is limited to 100 characters.");
    }

    const source = withRepeatedQuery("/api/v1/patients/contacts/autocomplete", [
      ["count", "20"],
      ["is_enabled", "true"],
      ["term", normalizedQuery],
      ["subtype", "GtAccount"],
      ["subtype", "CustomerAccount"],
      ["profile_type", "all"]
    ]);
    const response = await this.fetchJson<ClientSearchApiResponse>(source);
    const byClientId = new Map<number, ClientChartSearchResult>();
    for (const item of response.items ?? []) {
      const associate = item.associates?.find((candidate) =>
        candidate.subtype === "GtAccount" || candidate.subtype === "CustomerAccount"
      );
      if (!associate) continue;
      const clientId = readPositiveInteger(associate?.entity_id);
      const guid = readPositiveInteger(associate?.guid_to);
      if (!clientId || !guid || byClientId.has(clientId)) continue;

      const demographics = item.demographics ?? {};
      const firstName = readNonEmptyString(demographics.first_name);
      const lastName = readNonEmptyString(demographics.last_name);
      const fullName = [firstName, lastName].filter(Boolean).join(" ") || `Client ${clientId}`;
      byClientId.set(clientId, {
        clientId,
        routeId: clientId.toString(36),
        guid,
        profileId:
          readPositiveInteger(associate.profile_id) ?? readPositiveInteger(item.profile_id),
        fullName,
        preferredName: readNonEmptyString(demographics.preferred_name),
        status: readNonEmptyString(item.patient_status),
        alayaCareId: `AC${String(guid).padStart(9, "0")}`,
        dateOfBirth: readNonEmptyString(demographics.birthday),
        branchName: readNonEmptyString(item.branch_name),
        clientGroups: (item.client_groups ?? [])
          .map((group) => readNonEmptyString(group.name))
          .filter((name): name is string => Boolean(name))
      });
    }

    return {
      query: normalizedQuery,
      total: response.count ?? byClientId.size,
      items: [...byClientId.values()]
    };
  }

  async rankClientCharts(
    limit: 10 | 25,
    confirmedSynthetic: boolean
  ): Promise<ClientChartRankResponse> {
    this.assertSyntheticUatClientChartAccess(confirmedSynthetic);
    if (limit !== 10 && limit !== 25) {
      throw new Error("Chart ranking is limited to 10 or 25 deep-scan candidates.");
    }

    const config = await this.fetchJson<StoreConfigResponse>("/app/storeConfig");
    const branchId = readPositiveInteger(config.currentBranch?.id);
    if (!branchId) throw new Error("Unable to determine the current AlayaCare branch.");

    const source = withQuery("/api/v1/patients/clients/list", {
      page: "1",
      count: "200",
      asc: "true",
      order: "last_name",
      full_text: "",
      filter_type: "0",
      client_statuses: "active",
      include_children_branches: "true",
      active: "false",
      branch_id: String(branchId)
    });
    const response = await this.fetchJson<ClientListApiResponse>(source);
    const candidates = (response.items ?? [])
      .map((item) => ({ item, result: clientListItemToSearchResult(item) }))
      .filter(
        (candidate): candidate is { item: ClientListApiItem; result: ClientChartSearchResult } =>
          candidate.result !== null
      )
      .sort(
        (left, right) =>
          metadataCandidateScore(right.item) - metadataCandidateScore(left.item) ||
          right.result.clientId - left.result.clientId
      )
      .slice(0, limit);

    const ranked = await mapWithConcurrency(candidates, 2, async (candidate) => {
      try {
        const sections: Record<string, ClientChartSection> = {};
        await Promise.all(
          buildClientChartScoreRequests(
            candidate.result.clientId,
            candidate.result.guid,
            branchId
          ).map(async ([name, sectionSource]) => {
            sections[name] = await this.fetchClientChartSection(sectionSource, 7_000);
          })
        );
        return { ...candidate.result, ...scoreClientChartSections(sections) } satisfies ClientChartRankedResult;
      } catch {
        return {
          ...candidate.result,
          fullnessScore: 0,
          populatedSections: 0,
          totalSections: SCORABLE_CLIENT_CHART_SECTIONS.length,
          recordCount: 0,
          failedSections: SCORABLE_CLIENT_CHART_SECTIONS.length
        } satisfies ClientChartRankedResult;
      }
    });
    ranked.sort(
      (left, right) =>
        right.fullnessScore - left.fullnessScore ||
        left.fullName.localeCompare(right.fullName)
    );

    return {
      candidatePool: response.count ?? response.items?.length ?? 0,
      deepScanned: ranked.length,
      items: ranked,
      methodology:
        "Active clients are preselected by lightweight list metadata, then ranked by populated patient-chart sections and capped record counts."
    };
  }

  async exportActiveClientChart(
    confirmedSynthetic: boolean,
    requestedClientId?: number
  ): Promise<ClientChartExportSnapshot> {
    this.assertSyntheticUatClientChartAccess(confirmedSynthetic);
    const requestedId = readPositiveInteger(requestedClientId);
    const route = requestedId
      ? { clientId: requestedId, routeId: requestedId.toString(36) }
      : readActiveClientRoute(window.location.hash);
    if (!route) {
      throw new Error("Open a client chart or select a synthetic UAT client from search first.");
    }

    const sourceUrl = requestedId
      ? `${window.location.origin}/#/clients/${route.routeId}/overview`
      : window.location.href;

    const overviewSource = `/api/v1/patients/${route.clientId}`;
    const overview = await this.fetchJson<ClientChartOverviewRecord>(overviewSource);
    const clientId = readPositiveInteger(overview.id) ?? route.clientId;
    const guid = readPositiveInteger(overview.guid);
    if (!guid) {
      throw new Error("The active client record did not include a usable client GUID.");
    }

    const branchId = readPositiveInteger(overview.branch_id);
    const profileId = readPositiveInteger(overview.profile_id);
    const composedName = [
      readNonEmptyString(overview.first_name),
      readNonEmptyString(overview.last_name)
    ]
      .filter(Boolean)
      .join(" ");
    const fullName = (readNonEmptyString(overview.full_name) ?? composedName) || `Client ${clientId}`;
    const sections: Record<string, ClientChartSection> = {
      overview: { source: overviewSource, ok: true, status: 200, data: overview }
    };

    const requests: Array<[string, string]> = [
      ["demographics", `/api/v1/patients/${clientId}/demographics`],
      [
        "medicalHistory",
        `/api/v1/clinical/documents?type=medical_history&account_id=${clientId}`
      ],
      [
        "riskAssessment",
        `/api/v1/clinical/documents?type=risk_assessment&account_id=${clientId}`
      ],
      [
        "statusHistory",
        withQuery(`/api/v1/patients/clients/${clientId}/status_events`, {
          sort_by: "effective_date",
          sort_order: "desc",
          count: "100",
          page: "1"
        })
      ],
      [
        "contacts",
        withQuery("/api/v1/patients/contacts/", {
          is_active: "true",
          guid_to: String(guid),
          enable_fp_info: "true",
          count: "100",
          page: "1"
        })
      ],
      [
        "clientNotes",
        withQuery(`/api/v1/patients/clients/${clientId}/client-notes`, {
          count: "100",
          page: "1",
          sort_by: "created_at",
          sort_order: "desc",
          "status[]": "active"
        })
      ],
      [
        "careProviderNotes",
        withQuery(`/api/v1/patients/clients/${clientId}/care-provider-notes`, {
          count: "100",
          page: "1",
          include: "category",
          sort_by: "updated_at",
          sort_order: "desc",
          is_archived: "false"
        })
      ],
      [
        "progressNotes",
        withQuery(`/api/v3/clinical/clients/${clientId}/progress_notes`, {
          clientId: String(clientId),
          count: "100",
          page: "1",
          archived: "false",
          sort_by: "created_at",
          sort_order: "desc",
          include: "author"
        })
      ],
      [
        "services",
        withQuery("/api/v1/scheduler/services", {
          "excluded_status[]": "discharged",
          count: "100",
          page: "1",
          service_extended: "1",
          include_disabled: "true",
          client_id: String(clientId),
          form_context_fields: "true",
          funder_details: "true",
          include_last_active_budget: "true"
        })
      ],
      [
        "authorizations",
        withQuery("/api/v1/scheduler/authorizations", {
          client_id: String(clientId),
          count: "100",
          page: "1",
          sort_by: "start_date",
          sort_order: "desc"
        })
      ],
      [
        "carePlans",
        withRepeatedQuery(`/api/v1/clinical/client/${clientId}/careplans`, [
          ["count", "100"],
          ["page", "1"],
          ["sort_by", "updated_at"],
          ["order", "desc"],
          ["include_set", "minimal"],
          ["include", "users_snapshots"],
          ["include", "_links"]
        ])
      ],
      [
        "clientForms",
        withQuery("/api/v1/tasks/forms20/submissions", {
          include_draft_status: "true",
          count: "100",
          page: "1",
          sort_by: "id",
          asc: "false",
          account_id: String(clientId),
          date_type: "created_on"
        })
      ],
      [
        "documentApprovals",
        withQuery("/api/v1/clinical/document_approval", {
          client_id: String(clientId),
          sort_by: "created_at",
          count: "100",
          sort_order: "desc",
          page: "1"
        })
      ],
      [
        "medications",
        withRepeatedQuery(`/api/v3/clinical/clients/${clientId}/medications`, [
          ["include", "cms_485_status"],
          ["include", "status_reason"],
          ["count", "100"],
          ["page", "1"]
        ])
      ],
      ["attachmentMetadata", `/api/v3/files/${clientId}/`],
      [
        "visitAttachmentMetadata",
        withQuery("/api/v1/scheduler/visit_attachments", { client_id: String(clientId) })
      ],
      [
        "requiredCareSkills",
        withQuery("/api/v1/employees/employee_skills", {
          client_specific_only: "true",
          count: "100",
          page: "1",
          client_id: String(clientId)
        })
      ],
      [
        "events",
        withQuery(`/api/v1/logs/security/clients/${clientId}/events`, {
          count: "100",
          page: "1"
        })
      ]
    ];

    if (branchId) {
      requests.push([
        "patientFieldSchema",
        withQuery("/api/v1/agency/form-context/schema/Patient", {
          branch_id: String(branchId)
        })
      ]);
      requests.push([
        "openTasks",
        withRepeatedQuery("/api/v2/tasks/tasks", [
          ["page", "1"],
          ["count", "100"],
          ["sort", "due_at_ascending"],
          ["branch_id", String(branchId)],
          ["include_total_pages", "true"],
          ["statuses", "1"],
          ["statuses", "3"],
          ["statuses", "8"],
          ["contexts", `include,api.patients.client,${clientId}`]
        ])
      ]);
    }

    await Promise.all(
      requests.map(async ([name, source]) => {
        sections[name] = await this.fetchClientChartSection(source);
      })
    );

    const legacyRequests: Array<[string, string]> = [
      ["visitReports", `/patrol/customer/shiftreports/id/${route.routeId}`],
      ["associatedEmployees", `/timekeeping/customer/staff/guid/${guid}/id/${route.routeId}`],
      ["blockedEmployeeDetails", `/donotsend/default/list/guid/${guid}/id/${route.routeId}`]
    ];
    await Promise.all(
      legacyRequests.map(async ([name, source]) => {
        sections[name] = await this.fetchClientChartLegacyTables(source);
      })
    );

    const carePlanItems = readItems(sections.carePlans.data);
    if (carePlanItems.length > 0) {
      const details = await Promise.all(
        carePlanItems.flatMap((item) => {
          const carePlanId = readPositiveInteger(item.id);
          if (!carePlanId) return [];
          const source = withRepeatedQuery(`/api/v1/clinical/careplan/${carePlanId}`, [
            ["statuses", "completed"],
            ["statuses", "active"],
            ["include", "_links"],
            ["include", "versions"],
            ["include", "module_extra"],
            ["include", "users_snapshots"],
            ["include_set", "minimal"]
          ]);
          return [this.fetchClientChartSection(source)];
        })
      );
      sections.carePlanDetails = {
        source: "/api/v1/clinical/careplan/{carePlanId}",
        ok: details.every((detail) => detail.ok),
        data: details,
        error: details.some((detail) => !detail.ok)
          ? "One or more care-plan detail requests failed."
          : undefined
      };
    }

    const sectionValues = Object.values(sections);
    const successful = sectionValues.filter((section) => section.ok).length;
    const partial = sectionValues.filter(
      (section) => section.ok && section.complete === false
    ).length;
    const complete = sectionValues.filter(
      (section) => section.ok && section.complete !== false
    ).length;
    return {
      kind: ALAYACARE_CLIENT_CHART_EXPORT_KIND,
      schemaVersion: ALAYACARE_CLIENT_CHART_EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      tenantOrigin: window.location.origin,
      sourceUrl,
      client: {
        routeId: route.routeId,
        id: clientId,
        guid,
        profileId,
        branchId,
        fullName,
        preferredName: readNonEmptyString(overview.preferred_name),
        status: readNonEmptyString(overview.status),
        externalId:
          typeof overview.external_id === "string" || overview.external_id === null
            ? overview.external_id
            : undefined
      },
      scope: {
        uatOnly: true,
        attachmentBinariesIncluded: false,
        pagination: "all-reported-pages",
        knownExclusions: [
          "Contact tracking report downloads",
          "Scheduling calendar and visit instances",
          "Vitals history (the AlayaCare screen uses a date-scoped legacy request)",
          "Vitals alert configuration",
          "Assessments launched through external integrations",
          "Accounting",
          "Attachment binaries"
        ]
      },
      sections,
      counts: {
        sections: sectionValues.length,
        successful,
        failed: sectionValues.length - successful,
        complete,
        partial
      }
    };
  }

  async importClientChart(request: ClientChartImportRequest): Promise<ClientChartImportResult> {
    this.assertSyntheticUatClientChartAccess(request.confirmedSynthetic);
    if (!request.confirmedCreate) {
      throw new Error("Confirm that this operation will create a new synthetic UAT client.");
    }

    const sourceOrigin = new URL(request.sourceTenantOrigin).origin;
    if (sourceOrigin !== window.location.origin) {
      throw new Error(
        "The client-chart JSON must be imported into the same UAT tenant it was exported from."
      );
    }

    const firstName = request.targetFirstName.trim();
    const lastName = request.targetLastName.trim();
    if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
      throw new Error("Enter target first and last names of 1–100 characters each.");
    }
    if (!isSyntheticClientName(firstName, lastName)) {
      throw new Error("The target name must include Test, Synthetic, UAT, Clone, or Copy.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(request.birthday)) {
      throw new Error("Enter the new client's required date of birth in YYYY-MM-DD format.");
    }
    if (!(["M", "F", "O"] as const).includes(request.gender)) {
      throw new Error("Choose Male, Female, or Other for the required gender field.");
    }
    const healthCard = request.healthCard.trim();
    if (!healthCard || healthCard.length > 100) {
      throw new Error("Enter the required health card number (1–100 characters).");
    }
    const email = readNonEmptyString(request.email);
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      throw new Error("Enter a valid email address of at most 254 characters.");
    }
    const phoneMain = readNonEmptyString(request.phoneMain);
    if (phoneMain && phoneMain.length > 50) {
      throw new Error("The main phone number must be at most 50 characters.");
    }

    const destinationGroupIds = Array.isArray(request.destinationGroupIds)
      ? [
          ...new Set(
            request.destinationGroupIds
              .map(readPositiveInteger)
              .filter((id): id is number => id !== undefined)
          )
        ]
      : [];
    if (destinationGroupIds.length === 0) {
      throw new Error("Choose at least one care location or client group.");
    }
    if (destinationGroupIds.length > 25) {
      throw new Error("A synthetic client can be assigned to at most 25 groups in one import.");
    }

    const destinations = await this.getClientChartWriteDestinations(request.confirmedSynthetic);
    const groupsById = new Map(destinations.groups.map((group) => [group.id, group]));
    const selectedGroups = destinationGroupIds.map((id) => groupsById.get(id));
    if (selectedGroups.some((group) => !group)) {
      throw new Error("One or more selected destination groups are no longer available in UAT.");
    }
    const costCentreCode = request.costCentreCode?.trim();
    const selectedCostCentre = costCentreCode
      ? destinations.costCentres.find((costCentre) => costCentre.code === costCentreCode)
      : undefined;
    if (costCentreCode && !selectedCostCentre) {
      throw new Error("The selected cost centre is no longer available in UAT.");
    }

    const createSource = "/api/v1/patients/";
    const createResponse = await fetch(createSource, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": "true",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
        birthday: request.birthday,
        health_card: healthCard,
        gender: request.gender,
        groups: destinationGroupIds,
        ...(email ? { email } : {}),
        ...(phoneMain ? { phone_main: phoneMain } : {}),
        ...(selectedCostCentre ? { cost_centre: Number(selectedCostCentre.code) } : {})
      })
    });
    const createBody = await parseResponseBody(createResponse);
    if (!createResponse.ok) {
      throw new Error(
        `Client creation failed (${createResponse.status}): ${formatResponseError(createBody)}`
      );
    }
    const targetClientId = readPositiveInteger((createBody as ClientCreateApiResponse | null)?.id);
    if (!targetClientId) {
      throw new Error("AlayaCare created the client but did not return its client ID.");
    }

    const steps: ClientChartImportStepResult[] = [
      {
        section: "client",
        source: createSource,
        ok: true,
        status: createResponse.status
      }
    ];
    const sectionRequests: Array<Promise<ClientChartImportStepResult>> = [];
    const medicalHistoryData = sanitizeMedicalHistoryForImport(request.medicalHistoryData);
    const riskAssessmentData = sanitizeRiskAssessmentForImport(request.riskAssessmentData);
    if (medicalHistoryData) {
      sectionRequests.push(
        this.importClinicalDocument(targetClientId, "medical_history", medicalHistoryData)
      );
    }
    if (riskAssessmentData) {
      sectionRequests.push(
        this.importClinicalDocument(targetClientId, "risk_assessment", riskAssessmentData)
      );
    }
    steps.push(...(await Promise.all(sectionRequests)));
    const progressNotes = sanitizeProgressNotesForImport(request.progressNotesData);
    const medications = sanitizeMedicationsForImport(request.medicationsData);
    if (progressNotes.length > 0) {
      steps.push(...(await this.importProgressNotes(targetClientId, progressNotes)));
    }
    if (medications.length > 0) {
      steps.push(...(await this.importMedications(targetClientId, medications)));
    }

    const routeId = targetClientId.toString(36);
    const copiedSections = steps.flatMap((step) => {
      if (step.ok && step.section === "medicalHistory") return ["medicalHistory" as const];
      if (step.ok && step.section === "riskAssessment") return ["riskAssessment" as const];
      if (step.ok && step.section === "progressNotes") return ["progressNotes" as const];
      if (step.ok && step.section === "medications") return ["medications" as const];
      return [];
    });
    const uniqueCopiedSections = [...new Set(copiedSections)];
    const successful = steps.filter((step) => step.ok).length;
    const skipped = steps.filter((step) => step.skipped).length;
    return {
      schemaVersion: ALAYACARE_CLIENT_CHART_IMPORT_SCHEMA_VERSION,
      importedAt: new Date().toISOString(),
      tenantOrigin: window.location.origin,
      sourceClient: {
        id: request.sourceClientId,
        fullName: request.sourceClientName
      },
      targetClient: {
        id: targetClientId,
        routeId,
        fullName: `${firstName} ${lastName}`,
        birthday: request.birthday,
        ...(email ? { email } : {}),
        ...(phoneMain ? { phoneMain } : {}),
        url: `${window.location.origin}/#/clients/${routeId}/overview`,
        destinationGroups: selectedGroups as ClientChartDestinationGroup[],
        ...(selectedCostCentre ? { costCentre: selectedCostCentre } : {})
      },
      steps,
      counts: {
        requested: steps.length,
        successful,
        skipped,
        failed: steps.length - successful
      },
      scope: {
        syntheticUatOnly: true,
        copiedSections: uniqueCopiedSections,
        omittedSections: [
          "contacts",
          "client notes and care-provider notes",
          "services",
          "care plans",
          "forms",
          "tasks",
          "documents",
          "attachments"
        ]
      }
    };
  }

  async getClientChartWriteDestinations(
    confirmedSynthetic: boolean
  ): Promise<ClientChartDestinationCatalog> {
    this.assertSyntheticUatClientChartAccess(confirmedSynthetic);
    const groupSource = withQuery("/api/v1/patients/groups", {
      page: "1",
      count: "1000",
      sort_by: "name",
      sort_order: "asc",
      with_count: "false"
    });
    const costCentreSource = withQuery("/api/v1/accounting/costcentres", {
      pagination: "false",
      status: "enabled"
    });
    const [groupResponse, costCentreResponse] = await Promise.all([
      this.fetchJson<unknown>(groupSource),
      this.fetchJson<unknown>(costCentreSource)
    ]);

    const groups = dedupeBy(
      readCollectionRecords(groupResponse).flatMap<ClientChartDestinationGroup>((record) => {
        const id = readPositiveInteger(record.id);
        const name = readNonEmptyString(record.name) ?? readNonEmptyString(record.description);
        const status = readNonEmptyString(record.status)?.toLowerCase();
        if (!id || !name || record.is_disabled === true || status === "disabled") return [];
        const description = readNonEmptyString(record.description);
        return [{ id, name, ...(description && description !== name ? { description } : {}) }];
      }),
      (group) => group.id
    ).sort((left, right) => left.name.localeCompare(right.name));

    const costCentres = dedupeBy(
      readCollectionRecords(costCentreResponse).flatMap<ClientChartDestinationCostCentre>(
        (record) => {
          const id = readPositiveInteger(record.id);
          const code = readNonEmptyString(record.code) ?? (id ? String(id) : undefined);
          const name = readNonEmptyString(record.name) ?? readNonEmptyString(record.description);
          const status = readNonEmptyString(record.status)?.toLowerCase();
          if (!code || !name || status === "disabled") return [];
          return [{ code, name }];
        }
      ),
      (costCentre) => costCentre.code
    ).sort((left, right) => left.name.localeCompare(right.name));

    if (groups.length === 0) {
      throw new Error("No enabled client groups were returned for this UAT tenant.");
    }
    return {
      tenantOrigin: window.location.origin,
      groups,
      costCentres,
      sources: {
        groups: groupSource,
        costCentres: costCentreSource
      }
    };
  }

  async searchShiftServiceLocations(
    query: string,
    confirmedUat: boolean
  ): Promise<ShiftServiceLocationSearchResponse> {
    this.assertUatAccess(confirmedUat, "Confirm that this Shift Lab lookup is for UAT test data.");
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2 || normalizedQuery.length > 100) {
      throw new Error("Enter 2–100 characters to search service locations.");
    }

    const accountSource = withRepeatedQuery("/api/autocomplete/patientsFacilities", [
      ["term", normalizedQuery],
      ["status[]", "active"]
    ]);
    const staffingSource = withQuery("/api/autocomplete/staffings", {
      term: normalizedQuery
    });
    const [accounts, staffings] = await Promise.all([
      this.fetchJson<ShiftLocationAutocompleteItem[]>(accountSource),
      this.fetchJson<ShiftLocationAutocompleteItem[]>(staffingSource)
    ]);
    const staffingByAccount = new Map<number, number>();
    for (const item of staffings) {
      const accountId = readPositiveInteger(item.id);
      const staffingId = readPositiveInteger(item.value);
      if (accountId && staffingId) staffingByAccount.set(accountId, staffingId);
    }

    const items = accounts.flatMap<ShiftServiceLocation>((item) => {
      if (item.type !== "CustomerStaffingPosition") return [];
      const accountId = readPositiveInteger(item.id);
      const branchId = readPositiveInteger(item.branch_id);
      const label = readNonEmptyString(item.label);
      if (!accountId || !branchId || !label) return [];
      return [{
        tenantOrigin: window.location.origin,
        accountId,
        staffingId: staffingByAccount.get(accountId),
        branchId,
        label,
        type: "CustomerStaffingPosition"
      }];
    });

    return {
      query: normalizedQuery,
      tenantOrigin: window.location.origin,
      items,
      sources: [accountSource, staffingSource]
    };
  }

  async listConnectorScenarios(): Promise<ConnectorScenarioListResult> {
    const context = await this.getConnectorTeamContext();
    const response = await this.fetchConnectorJson<ConnectorScenarioListApiResponse>(
      `/api/v2/scenarios?teamId=${context.teamId}&pg%5Blimit%5D=10000`
    );
    const scenarios = (response.scenarios ?? [])
      .map((record) => this.buildConnectorScenarioListItem(context, record))
      .sort((left, right) => left.name.localeCompare(right.name));

    return {
      ...context,
      activeScenarioId: this.getActiveConnectorScenarioId(),
      scenarios
    };
  }

  async getConnectorScenario(
    source: ConnectorScenarioSource,
    scenarioId?: number
  ): Promise<ConnectorScenarioSnapshot> {
    const route = await this.getConnectorScenarioRoute(scenarioId);
    const [scenarioResponse, requestedBlueprintResponse] = await Promise.all([
      this.fetchConnectorJson<ConnectorScenarioApiResponse>(`/api/v2/scenarios/${route.scenarioId}`),
      this.fetchConnectorJson<ConnectorBlueprintApiResponse>(
        `/api/v2/scenarios/${route.scenarioId}/blueprint${source === "draft" ? "?draft=true" : ""}`
      )
    ]);

    const scenarioRecord = scenarioResponse.scenario;
    const serverDraftAvailable = source === "draft" && Boolean(requestedBlueprintResponse.blueprint);
    const blueprintResponse =
      source === "draft" && !requestedBlueprintResponse.blueprint
        ? await this.fetchConnectorJson<ConnectorBlueprintApiResponse>(
            `/api/v2/scenarios/${route.scenarioId}/blueprint`
          )
        : requestedBlueprintResponse;
    const blueprint = blueprintResponse.blueprint;
    if (!scenarioRecord || !blueprint) {
      throw new Error(`Connector did not return a ${source} blueprint for scenario ${route.scenarioId}.`);
    }

    const validation = validateConnectorBlueprint(blueprint);
    if (!validation.valid) {
      throw new Error(`Connector returned an invalid blueprint: ${validation.errors.join(" ")}`);
    }

    const scenario = this.buildConnectorScenarioMetadata(route, scenarioRecord);
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tenantOrigin: window.location.origin,
      sourceUrl: window.location.href,
      scenarioId: route.scenarioId,
      teamId: route.teamId,
      source,
      serverDraftAvailable,
      scenario,
      blueprint,
      scheduling: blueprintResponse.scheduling,
      scenarioMetadata: blueprintResponse.metadata,
      idSequence: blueprintResponse.idSequence,
      lastEdit: blueprintResponse.last_edit ?? scenario.lastEdit,
      summary: summarizeConnectorBlueprint(blueprint, scenario.usedPackages)
    };
  }

  async exportConnectorScenarioBundle(scenarioId?: number): Promise<ConnectorScenarioBundle> {
    const [published, draft] = await Promise.all([
      this.getConnectorScenario("published", scenarioId),
      this.getConnectorScenario("draft", scenarioId)
    ]);

    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tenantOrigin: window.location.origin,
      sourceUrl: window.location.href,
      scenarioId: draft.scenarioId,
      teamId: draft.teamId,
      scenario: draft.scenario,
      published,
      draft
    };
  }

  async downloadAllConnectorScenarios(): Promise<ConnectorScenarioBulkDownloadResult> {
    const list = await this.listConnectorScenarios();
    const files: Record<string, Uint8Array> = {};
    const failures: Array<{ scenarioId: number; name: string; error: string }> = [];
    const downloaded: Array<{
      scenarioId: number;
      name: string;
      path: string;
      draftAvailable: boolean;
    }> = [];

    await mapWithConcurrency(list.scenarios, 3, async (scenario) => {
      const path = `${String(scenario.id).padStart(6, "0")}-${safeFilePart(scenario.name)}`;
      try {
        const bundle = await this.exportConnectorScenarioBundle(scenario.id);
        files[`${path}/published.json`] = jsonBytes(bundle.published);
        files[`${path}/draft.json`] = jsonBytes(bundle.draft);
        files[`${path}/bundle.json`] = jsonBytes(bundle);
        downloaded.push({
          scenarioId: scenario.id,
          name: scenario.name,
          path,
          draftAvailable: bundle.draft.serverDraftAvailable
        });
      } catch (error) {
        failures.push({
          scenarioId: scenario.id,
          name: scenario.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    const exportedAt = new Date().toISOString();
    files["manifest.json"] = jsonBytes({
      schemaVersion: 1,
      exportedAt,
      tenantOrigin: window.location.origin,
      teamId: list.teamId,
      teamName: list.teamName,
      scenarioCount: downloaded.length,
      failedCount: failures.length,
      scenarios: downloaded.sort((left, right) => left.scenarioId - right.scenarioId),
      failures
    });

    const filename = `connector-team-${list.teamId}-scenarios-${exportedAt.slice(0, 10)}.zip`;
    downloadBrowserFile(zipSync(files, { level: 6 }), "application/zip", filename);
    return {
      filename,
      scenarioCount: downloaded.length,
      failedCount: failures.length,
      failures
    };
  }

  async getConnectorReferenceCatalog(): Promise<ConnectorReferenceCatalog> {
    const context = await this.getConnectorTeamContext();
    const [templateResponse, connectionResponse, webhookResponse, functionResponse, keyResponse, dataStoreResponse, dataStructureResponse] = await Promise.all([
      this.fetchConnectorJson<Record<string, unknown>>(
        "/api/v2/templates/public?includeEn=true&pg%5Blimit%5D=10000&pg%5BreturnTotalCount%5D=true"
      ),
      this.fetchConnectorJson<Record<string, unknown>>(`/api/v2/connections?teamId=${context.teamId}`),
      this.fetchConnectorJson<Record<string, unknown>>(
        `/api/v2/hooks?teamId=${context.teamId}&pg%5Blimit%5D=9999`
      ),
      this.fetchConnectorJson<Record<string, unknown>>(`/api/v2/functions?teamId=${context.teamId}`),
      this.fetchConnectorJson<Record<string, unknown>>(
        `/api/v2/keys?teamId=${context.teamId}&cols%5B0%5D=id&cols%5B1%5D=name&cols%5B2%5D=packageName&cols%5B3%5D=theme&cols%5B4%5D=typeName`
      ),
      this.fetchConnectorJson<Record<string, unknown>>(
        `/api/v2/data-stores?teamId=${context.teamId}&cols%5B0%5D=id&cols%5B1%5D=maxSize&cols%5B2%5D=name&cols%5B3%5D=records&cols%5B4%5D=size&cols%5B5%5D=teamId&cols%5B6%5D=datastructureId`
      ),
      this.fetchConnectorJson<Record<string, unknown>>(`/api/v2/data-structures?teamId=${context.teamId}`)
    ]);

    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tenantOrigin: window.location.origin,
      teamId: context.teamId,
      organizationId: context.organizationId,
      templates: readRecordArray(templateResponse.templatesPublic).map(toTemplateReference),
      connections: readRecordArray(connectionResponse.connections).map(toConnectionReference),
      webhooks: readRecordArray(webhookResponse.hooks).map(toWebhookReference),
      functions: readRecordArray(functionResponse.functions).map(toFunctionReference),
      keys: readRecordArray(keyResponse.keys).map(toKeyReference),
      dataStores: readRecordArray(dataStoreResponse.dataStores).map(toDataStoreReference),
      dataStructures: readRecordArray(dataStructureResponse.dataStructures).map(toDataStructureReference)
    };
  }

  async getConnectorScenarioHealth(scenarioId: number): Promise<ConnectorScenarioHealth> {
    const context = await this.getConnectorTeamContext();
    const [scenarioResponse, listResponse, logResponse, dlqResponse] = await Promise.all([
      this.fetchConnectorJson<ConnectorScenarioApiResponse>(`/api/v2/scenarios/${scenarioId}`),
      this.fetchConnectorJson<ConnectorScenarioListApiResponse>(
        `/api/v2/scenarios?teamId=${context.teamId}&pg%5Blimit%5D=10000`
      ),
      this.fetchConnectorJson<Record<string, unknown>>(
        `/api/v2/scenarios/${scenarioId}/logs?showCheckRuns=true&showChangeLog=true`
      ).catch(() => ({} as Record<string, unknown>)),
      this.fetchConnectorJson<Record<string, unknown>>(`/api/v2/dlqs?scenarioId=${scenarioId}`).catch(
        () => ({} as Record<string, unknown>)
      )
    ]);
    const detailRecord = scenarioResponse.scenario;
    if (!detailRecord) {
      throw new Error(`Connector did not return scenario ${scenarioId}.`);
    }
    const listRecord = listResponse.scenarios?.find((candidate) => candidate.id === scenarioId);
    const scenarioRecord = { ...detailRecord, ...listRecord };
    const scenario = this.buildConnectorScenarioListItem(context, scenarioRecord);
    const dlqs = readRecordArray(dlqResponse.dlqs);
    const runs = readRecordArray(logResponse.scenarioLogs).map(toScenarioRun);
    return {
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      tenantOrigin: window.location.origin,
      teamId: context.teamId,
      scenario,
      incompleteExecutionCount: scenario.allDlqCount ?? scenario.dlqCount ?? dlqs.length,
      runs,
      historyUrl: `${window.location.origin}/${context.teamId}/scenarios/${scenarioId}/logs?showCheckRuns=true&showChangeLog=true`
    };
  }

  async saveConnectorScenario(request: ConnectorScenarioSaveRequest): Promise<ConnectorScenarioSaveResult> {
    const route = await this.getConnectorScenarioRoute(request.scenarioId);
    const validation = validateConnectorBlueprint(request.blueprint);
    if (!validation.valid) {
      throw new Error(`Save blocked by blueprint validation: ${validation.errors.join(" ")}`);
    }

    if (request.expectedLastEdit) {
      const currentDraft = await this.getConnectorScenario("draft", route.scenarioId);
      if (currentDraft.lastEdit && currentDraft.lastEdit !== request.expectedLastEdit) {
        throw new Error(
          "The Connector scenario changed after it was loaded. Reload the draft and reapply your changes before saving."
        );
      }
    }

    await this.fetchConnectorJson<unknown>(`/api/v2/scenarios/${route.scenarioId}`, {
      method: "PATCH",
      body: JSON.stringify({ blueprint: JSON.stringify(request.blueprint) })
    });

    const snapshot = await this.getConnectorScenario("draft", route.scenarioId);
    return {
      scenarioId: route.scenarioId,
      savedAt: new Date().toISOString(),
      snapshot
    };
  }

  async postAvailability(draft: AvailabilityDraft): Promise<AvailabilityPostResult> {
    const uri = `/api/v2/employees/employee/${draft.employeeId}/availabilities`;
    const payload = {
      availability_type_id: draft.availabilityTypeId,
      description: draft.description,
      duration: minutesBetween(draft.date, draft.startTime, draft.endTime),
      all_day: false,
      rrule: buildDailyRrule(draft.date, draft.startTime, draft.endTime)
    };

    const response = await fetch(uri, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const body = await parseResponseBody(response);

    if (!response.ok) {
      throw new Error(`Availability POST failed (${response.status}): ${JSON.stringify(body)}`);
    }

    return {
      uri,
      status: response.status,
      body
    };
  }

  private async fetchSchedule(baseUrl: string, date: string): Promise<ScheduleRecord[]> {
    const params = new URLSearchParams({
      end_date_from: date,
      start_date_to: date,
      order_by: "start_at",
      count: "50"
    });

    const response = await this.fetchJson<PagedResponse<ScheduleRecord>>(`${baseUrl}?${params.toString()}`);
    return response.items ?? [];
  }

  private async fetchVisits(employeeId: number, date: string): Promise<VisitRecord[]> {
    const { startUtc, endUtc } = getLocalDayUtcRange(date);
    const params = new URLSearchParams({
      alayacare_employee_id: String(employeeId),
      start_date_from: startUtc,
      start_date_to: endUtc,
      count: "100"
    });

    const response = await this.fetchJson<PagedResponse<VisitRecord>>(`/api/v2/scheduler/visits?${params.toString()}`);
    return response.items ?? [];
  }

  private assertSyntheticUatClientChartAccess(confirmedSynthetic: boolean): void {
    this.assertUatAccess(
      confirmedSynthetic,
      "Confirm that the UAT client is synthetic or a test record first."
    );
  }

  private assertUatAccess(confirmed: boolean, confirmationMessage: string): void {
    if (!window.location.hostname.toLowerCase().includes(".uat.alayacare.")) {
      throw new Error("This utility is currently limited to AlayaCare UAT tenants.");
    }
    if (!confirmed) throw new Error(confirmationMessage);
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { credentials: "include" });

    if (!response.ok) {
      throw new Error(`Request failed (${response.status}) for ${url}`);
    }

    return response.json() as Promise<T>;
  }

  private async fetchClientChartSection(
    source: string,
    timeoutMs?: number
  ): Promise<ClientChartSection> {
    const controller = timeoutMs ? new AbortController() : undefined;
    const timeout = controller
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
    try {
      const response = await fetch(source, {
        credentials: "include",
        headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
        signal: controller?.signal
      });
      const data = await parseResponseBody(response);
      if (!response.ok) {
        return {
          source,
          ok: false,
          status: response.status,
          error: `Request failed (${response.status}).`,
          data
        };
      }
      return await this.loadRemainingClientChartPages(source, response.status, data, timeoutMs);
    } catch (error) {
      return {
        source,
        ok: false,
        error: controller?.signal.aborted
          ? `Request timed out after ${timeoutMs} ms.`
          : error instanceof Error
            ? error.message
            : String(error)
      };
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
    }
  }

  private async loadRemainingClientChartPages(
    source: string,
    status: number,
    firstPageData: unknown,
    timeoutMs?: number
  ): Promise<ClientChartSection> {
    const pagination = readClientChartPagination(firstPageData, source);
    if (!pagination) {
      const loadedCount = readCollectionRecords(firstPageData).length;
      return {
        source,
        ok: true,
        status,
        data: firstPageData,
        ...(loadedCount > 0 ? { loadedCount } : {})
      };
    }

    const warnings: string[] = [];
    const combinedItems = [...pagination.items];
    let pagesLoaded = 1;
    let complete = pagination.totalVerified;
    if (!pagination.totalVerified) {
      warnings.push(
        "The API returned a full first page without a reported record or page total; later pages cannot be verified."
      );
    }
    const maximumPages = Math.min(pagination.totalPages, 100);
    if (pagination.totalPages > maximumPages) {
      complete = false;
      warnings.push(
        `The API reported ${pagination.totalPages} pages; the safety limit is ${maximumPages} pages.`
      );
    }

    for (let page = 2; page <= maximumPages; page += 1) {
      const pageSource = setQueryPage(source, page);
      const controller = timeoutMs ? new AbortController() : undefined;
      const timeout = controller
        ? window.setTimeout(() => controller.abort(), timeoutMs)
        : undefined;
      try {
        const response = await fetch(pageSource, {
          credentials: "include",
          headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
          signal: controller?.signal
        });
        const pageData = await parseResponseBody(response);
        if (!response.ok) {
          complete = false;
          warnings.push(`Page ${page} failed with status ${response.status}.`);
          break;
        }
        const pageItems = readItems(pageData);
        combinedItems.push(...pageItems);
        pagesLoaded += 1;
        if (pageItems.length === 0 && page < pagination.totalPages) {
          complete = false;
          warnings.push(`Page ${page} was empty before the reported final page.`);
          break;
        }
      } catch (error) {
        complete = false;
        warnings.push(
          controller?.signal.aborted
            ? `Page ${page} timed out after ${timeoutMs} ms.`
            : `Page ${page} failed: ${error instanceof Error ? error.message : String(error)}`
        );
        break;
      } finally {
        if (timeout !== undefined) window.clearTimeout(timeout);
      }
    }

    if (
      pagination.reportedCount !== undefined &&
      combinedItems.length < pagination.reportedCount
    ) {
      complete = false;
      warnings.push(
        `Loaded ${combinedItems.length} of ${pagination.reportedCount} reported records.`
      );
    }

    return {
      source,
      ok: true,
      status,
      data: mergeClientChartPageItems(firstPageData, combinedItems),
      loadedCount: combinedItems.length,
      reportedCount: pagination.reportedCount,
      pagesLoaded,
      totalPages: pagination.totalPages,
      complete,
      ...(warnings.length > 0 ? { warnings } : {})
    };
  }

  private async fetchClientChartLegacyTables(source: string): Promise<ClientChartSection> {
    try {
      const response = await fetch(source, {
        credentials: "include",
        headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" }
      });
      const body = await response.text();
      if (!response.ok) {
        return {
          source,
          ok: false,
          status: response.status,
          error: `Request failed (${response.status}).`
        };
      }
      const tables = readHtmlTables(body);
      const loadedCount = tables.reduce((total, table) => total + table.rows.length, 0);
      return {
        source,
        ok: true,
        status: response.status,
        data: { format: "html-tables", tables },
        loadedCount,
        pagesLoaded: 1,
        complete: false,
        warnings: [
          "Captured the initial server-rendered table. This legacy screen does not report a verifiable total-page count."
        ]
      };
    } catch (error) {
      return {
        source,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async importClinicalDocument(
    clientId: number,
    type: "medical_history" | "risk_assessment",
    data: Record<string, unknown>
  ): Promise<ClientChartImportStepResult> {
    const section = type === "medical_history" ? "medicalHistory" : "riskAssessment";
    const lookupSource = withQuery("/api/v1/clinical/documents", {
      type,
      account_id: String(clientId)
    });
    try {
      let targetDocument: Record<string, unknown> | undefined;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const collection = await this.fetchJson<unknown>(lookupSource);
        targetDocument = readItems(collection)[0];
        if (targetDocument) break;
        if (attempt === 0) {
          const target = await this.fetchJson<Record<string, unknown>>(
            `/api/v1/patients/${clientId}`
          );
          const guid = readPositiveInteger(target.guid);
          if (guid) {
            await fetch(
              `/clinical/default/details/doc/${type}/guid/${guid}/id/${clientId.toString(36)}`,
              {
                credentials: "include",
                headers: {
                  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
                  "X-CSRF-Token": "true"
                }
              }
            );
          }
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 400));
      }
      const documentId = readNonEmptyString(targetDocument?.id);
      const schemaId = readNonEmptyString(targetDocument?.schema_id);
      if (!documentId || !schemaId) {
        throw new Error(`AlayaCare did not initialize the target ${type} document.`);
      }
      if (stableJson(targetDocument?.data) === stableJson(data)) {
        return { section, source: lookupSource, ok: true, skipped: true };
      }

      const source = `/api/v1/clinical/documents/${encodeURIComponent(documentId)}`;
      const response = await fetch(source, {
        method: "PUT",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": "true",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: JSON.stringify({
          account_id: clientId,
          schema_id: schemaId,
          type,
          data
        })
      });
      const body = await parseResponseBody(response);
      if (!response.ok) {
        throw new Error(`Request failed (${response.status}): ${formatResponseError(body)}`);
      }
      return { section, source, ok: true, status: response.status };
    } catch (error) {
      return {
        section,
        source: lookupSource,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async importProgressNotes(
    clientId: number,
    notes: ClientChartProgressNoteImport[]
  ): Promise<ClientChartImportStepResult[]> {
    const collectionSource = withQuery(`/api/v3/clinical/clients/${clientId}/progress_notes`, {
      count: "1000",
      page: "1"
    });
    let existingKeys = new Set<string>();
    try {
      const existing = await this.fetchJson<unknown>(collectionSource);
      existingKeys = new Set(
        readItems(existing).map((note) =>
          stableJson({
            type: readNonEmptyString(note.type),
            body: readNonEmptyString(note.body),
            content_type: readNonEmptyString(note.content_type) ?? "text/html"
          })
        )
      );
    } catch {
      // The per-record POST results below remain authoritative if the preflight list is unavailable.
    }

    const source = `/api/v3/clinical/clients/${clientId}/progress_notes`;
    const results: ClientChartImportStepResult[] = [];
    for (const note of notes) {
      const key = stableJson(note);
      if (existingKeys.has(key)) {
        results.push({ section: "progressNotes", source, ok: true, skipped: true });
        continue;
      }
      try {
        const response = await fetch(source, {
          method: "POST",
          credentials: "include",
          headers: authenticatedJsonWriteHeaders(),
          body: JSON.stringify({ ...note, status: "PUBLISHED" })
        });
        const body = await parseResponseBody(response);
        if (!response.ok) {
          throw new Error(`Request failed (${response.status}): ${formatResponseError(body)}`);
        }
        existingKeys.add(key);
        results.push({ section: "progressNotes", source, ok: true, status: response.status });
      } catch (error) {
        results.push({
          section: "progressNotes",
          source,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return results;
  }

  private async importMedications(
    clientId: number,
    medications: ClientChartMedicationImport[]
  ): Promise<ClientChartImportStepResult[]> {
    const collectionSource = withQuery(`/api/v3/clinical/clients/${clientId}/medications`, {
      count: "1000",
      page: "1"
    });
    let existingKeys = new Set<string>();
    try {
      const existing = await this.fetchJson<unknown>(collectionSource);
      existingKeys = new Set(
        sanitizeMedicationsForImport(readItems(existing)).map((medication) => stableJson(medication))
      );
    } catch {
      // The per-record POST results below remain authoritative if the preflight list is unavailable.
    }

    const source = `/api/v3/clinical/clients/${clientId}/medications`;
    const results: ClientChartImportStepResult[] = [];
    for (const medication of medications) {
      const key = stableJson(medication);
      if (existingKeys.has(key)) {
        results.push({ section: "medications", source, ok: true, skipped: true });
        continue;
      }
      try {
        const response = await fetch(source, {
          method: "POST",
          credentials: "include",
          headers: authenticatedJsonWriteHeaders(),
          body: JSON.stringify(medication)
        });
        const body = await parseResponseBody(response);
        if (!response.ok) {
          throw new Error(`Request failed (${response.status}): ${formatResponseError(body)}`);
        }
        existingKeys.add(key);
        results.push({ section: "medications", source, ok: true, status: response.status });
      } catch (error) {
        results.push({
          section: "medications",
          source,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return results;
  }

  private async fetchConnectorJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("imt-web-zone", "production");
    if (init.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url, {
      ...init,
      credentials: "include",
      headers
    });
    const body = await parseResponseBody(response);

    if (!response.ok) {
      const detail = getConnectorErrorDetail(body);
      throw new Error(`Connector request failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }

    return unwrapConnectorResponse(body) as T;
  }

  private getConnectorTeamId(): number {
    const hostname = window.location.hostname.toLowerCase();
    if (!hostname.startsWith("connector.") || !hostname.includes(".alayacare.")) {
      throw new Error("Open connector.alayacare.ca before using Connector Utilities.");
    }

    const match = /^\/(\d+)(?:\/|$)/.exec(window.location.pathname);
    if (!match) {
      throw new Error("Open a team page in Connector before using team utilities.");
    }

    return Number(match[1]);
  }

  private getActiveConnectorScenarioId(): number | undefined {
    const match = /^\/\d+\/scenarios\/(\d+)(?:\/|$)/.exec(window.location.pathname);
    return match ? Number(match[1]) : undefined;
  }

  private getConnectorScenarioRoute(scenarioId?: number): { scenarioId: number; teamId: number } {
    const resolvedScenarioId = scenarioId ?? this.getActiveConnectorScenarioId();
    if (!resolvedScenarioId) {
      throw new Error("Select a scenario or open a Connector scenario editor page first.");
    }

    return {
      teamId: this.getConnectorTeamId(),
      scenarioId: resolvedScenarioId
    };
  }

  private async getConnectorTeamContext(): Promise<{
    teamId: number;
    teamName?: string;
    organizationId?: number;
  }> {
    const teamId = this.getConnectorTeamId();
    const response = await this.fetchConnectorJson<ConnectorTeamApiResponse>(`/api/v2/teams/${teamId}`);
    return {
      teamId,
      teamName: response.team?.name,
      organizationId: response.team?.organizationId
    };
  }

  private buildConnectorScenarioMetadata(
    route: { scenarioId: number; teamId: number },
    record: ConnectorScenarioApiRecord
  ): ConnectorScenarioMetadata {
    return {
      id: record.id ?? route.scenarioId,
      name: record.name?.trim() || `Scenario ${route.scenarioId}`,
      teamId: record.teamId ?? route.teamId,
      description: record.description,
      folderId: record.folderId,
      concept: record.concept,
      isPaused: record.isPaused,
      isActive: record.isActive,
      created: record.created,
      lastEdit: record.lastEdit,
      usedPackages: Array.isArray(record.usedPackages) ? record.usedPackages.slice().sort() : []
    };
  }

  private buildConnectorScenarioListItem(
    context: { teamId: number },
    record: ConnectorScenarioApiRecord
  ): ConnectorScenarioListItem {
    const metadata = this.buildConnectorScenarioMetadata(
      { scenarioId: record.id ?? 0, teamId: context.teamId },
      record
    );
    return {
      ...metadata,
      isInvalid: record.isinvalid,
      isLocked: record.islocked,
      isWaiting: record.iswaiting,
      scheduling: record.scheduling,
      nextExec: record.nextExec,
      dlqCount: toOptionalNumber(record.dlqCount),
      allDlqCount: toOptionalNumber(record.allDlqCount),
      operations: toOptionalNumber(record.operations),
      transfer: toOptionalNumber(record.transfer)
    };
  }

  private async loadUserContext(): Promise<UserContext> {
    const status = await this.getStatus();

    if (!status.ready || !status.currentUserId) {
      return {
        status,
        departments: []
      };
    }

    const me = await this.fetchJson<EmployeeRecord>(`/api/v2/employees/employees/${status.currentUserId}`);
    let departments = me.departments ?? [];

    if (departments.length === 0) {
      departments = await this.fetchAllDepartments();
    }

    return {
      status,
      departments
    };
  }

  private async fetchAllDepartments(): Promise<Department[]> {
    try {
      const response = await this.fetchJson<PagedResponse<Department>>(
        "/api/v2/employees/departments?count=200"
      );
      return response.items ?? [];
    } catch {
      return [];
    }
  }
}

function compareEmployees(
  left: { first_name?: string; last_name?: string },
  right: { first_name?: string; last_name?: string }
): number {
  const leftLastName = (left.last_name ?? "").toLowerCase();
  const rightLastName = (right.last_name ?? "").toLowerCase();

  if (leftLastName !== rightLastName) {
    return leftLastName.localeCompare(rightLastName);
  }

  const leftFirstName = (left.first_name ?? "").toLowerCase();
  const rightFirstName = (right.first_name ?? "").toLowerCase();
  return leftFirstName.localeCompare(rightFirstName);
}

function withQuery(path: string, values: Record<string, string>): string {
  return withRepeatedQuery(path, Object.entries(values));
}

function withRepeatedQuery(path: string, values: Array<[string, string]>): string {
  const params = new URLSearchParams();
  values.forEach(([key, value]) => params.append(key, value));
  return `${path}?${params.toString()}`;
}

function readPositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function authenticatedJsonWriteHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-CSRF-Token": "true",
    "X-Requested-With": "XMLHttpRequest"
  };
}

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)])
    );
  };
  return JSON.stringify(normalize(value));
}

function readItems(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items)
    ? items.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}

function readNonNegativeInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function readClientChartPagination(
  value: unknown,
  source: string
): ClientChartPagination | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.items)) return null;

  const items = readItems(value);
  const sourceUrl = new URL(source, window.location.origin);
  const requestedPageSize = readPositiveInteger(sourceUrl.searchParams.get("count"));
  const pageSize =
    readPositiveInteger(record.items_per_page) ??
    readPositiveInteger(record.page_size) ??
    requestedPageSize ??
    items.length;
  const reportedCount =
    readNonNegativeInteger(record.total_count) ?? readNonNegativeInteger(record.count);
  const reportedTotalPages = readPositiveInteger(record.total_pages);
  const derivedTotalPages =
    reportedCount !== undefined && pageSize > 0
      ? Math.max(1, Math.ceil(reportedCount / pageSize))
      : undefined;
  const totalPages = reportedTotalPages ?? derivedTotalPages ?? 1;
  const totalVerified =
    reportedTotalPages !== undefined ||
    reportedCount !== undefined ||
    pageSize === 0 ||
    items.length < pageSize;

  return { items, reportedCount, totalPages, totalVerified };
}

function setQueryPage(source: string, page: number): string {
  const url = new URL(source, window.location.origin);
  url.searchParams.set("page", String(page));
  return `${url.pathname}${url.search}${url.hash}`;
}

function mergeClientChartPageItems(
  firstPageData: unknown,
  items: Record<string, unknown>[]
): unknown {
  if (!firstPageData || typeof firstPageData !== "object" || Array.isArray(firstPageData)) {
    return firstPageData;
  }
  return { ...(firstPageData as Record<string, unknown>), items };
}

function readHtmlTables(html: string): ClientChartHtmlTable[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  return Array.from(document.querySelectorAll("table")).flatMap((table) => {
    const headerCells = Array.from(table.querySelectorAll("thead th"));
    const fallbackHeaderCells = Array.from(table.querySelectorAll("tr:first-child th"));
    const columns = (headerCells.length > 0 ? headerCells : fallbackHeaderCells).map((cell) =>
      normalizeTableText(cell.textContent)
    );
    const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
    const fallbackRows = Array.from(table.querySelectorAll("tr")).filter(
      (row) => row.querySelectorAll("td").length > 0
    );
    const rows = (bodyRows.length > 0 ? bodyRows : fallbackRows)
      .map((row) =>
        Array.from(row.querySelectorAll(":scope > th, :scope > td")).map((cell) =>
          normalizeTableText(cell.textContent)
        )
      )
      .filter((row) => row.some(Boolean));
    if (columns.length === 0 && rows.length === 0) return [];

    const heading = findPrecedingTableHeading(table);
    return [
      {
        ...(heading ? { title: heading } : {}),
        columns,
        rows
      }
    ];
  });
}

function findPrecedingTableHeading(table: HTMLTableElement): string | undefined {
  let sibling: Element | null = table.previousElementSibling;
  for (let checked = 0; sibling && checked < 4; checked += 1) {
    if (/^H[1-6]$/.test(sibling.tagName) || sibling.tagName === "LEGEND") {
      return normalizeTableText(sibling.textContent) || undefined;
    }
    sibling = sibling.previousElementSibling;
  }
  return undefined;
}

function normalizeTableText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function readCollectionRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
    );
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["items", "results", "data"]) {
    const collection = record[key];
    if (Array.isArray(collection)) return readCollectionRecords(collection);
  }
  return [];
}

function dedupeBy<T, K>(items: T[], keyFor: (item: T) => K): T[] {
  const seen = new Set<K>();
  return items.filter((item) => {
    const key = keyFor(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const SCORABLE_CLIENT_CHART_SECTIONS = [
  "demographics",
  "medicalHistory",
  "riskAssessment",
  "statusHistory",
  "contacts",
  "clientNotes",
  "careProviderNotes",
  "progressNotes",
  "services",
  "authorizations",
  "carePlans",
  "clientForms",
  "documentApprovals",
  "medications",
  "attachmentMetadata",
  "visitAttachmentMetadata",
  "requiredCareSkills",
  "openTasks"
] as const;

function clientListItemToSearchResult(
  item: ClientListApiItem
): ClientChartSearchResult | null {
  const clientId = readPositiveInteger(item.id);
  const guid = readPositiveInteger(item.guid);
  if (!clientId || !guid) return null;
  const fullName = [readNonEmptyString(item.first_name), readNonEmptyString(item.last_name)]
    .filter(Boolean)
    .join(" ") || `Client ${clientId}`;
  return {
    clientId,
    routeId: clientId.toString(36),
    guid,
    fullName,
    preferredName: readNonEmptyString(item.preferred_name),
    status: readNonEmptyString(item.status),
    alayaCareId: `AC${String(guid).padStart(9, "0")}`,
    dateOfBirth: readNonEmptyString(item.birthday),
    clientGroups: (item.groups ?? []).filter((group) => Boolean(group.trim()))
  };
}

function metadataCandidateScore(item: ClientListApiItem): number {
  const scalarValues = [
    item.external_id,
    item.emergency_response_level,
    item.address,
    item.phone_main,
    item.phone_personal,
    item.phone_other,
    item.preferred_name,
    item.birthday
  ];
  return (
    scalarValues.filter((value) => typeof value === "string" && value.trim()).length +
    Math.min(item.groups?.length ?? 0, 3) +
    Math.min(item.tags_v2?.length ?? 0, 3)
  );
}

function buildClientChartScoreRequests(
  clientId: number,
  guid: number,
  branchId: number
): Array<[string, string]> {
  return [
    ["demographics", `/api/v1/patients/${clientId}/demographics`],
    ["medicalHistory", `/api/v1/clinical/documents?type=medical_history&account_id=${clientId}`],
    ["riskAssessment", `/api/v1/clinical/documents?type=risk_assessment&account_id=${clientId}`],
    [
      "statusHistory",
      withQuery(`/api/v1/patients/clients/${clientId}/status_events`, {
        count: "1",
        page: "1"
      })
    ],
    [
      "contacts",
      withQuery("/api/v1/patients/contacts/", {
        is_active: "true",
        guid_to: String(guid),
        count: "1",
        page: "1"
      })
    ],
    [
      "clientNotes",
      withQuery(`/api/v1/patients/clients/${clientId}/client-notes`, {
        count: "1",
        page: "1",
        "status[]": "active"
      })
    ],
    [
      "careProviderNotes",
      withQuery(`/api/v1/patients/clients/${clientId}/care-provider-notes`, {
        count: "1",
        page: "1",
        is_archived: "false"
      })
    ],
    [
      "progressNotes",
      withQuery(`/api/v3/clinical/clients/${clientId}/progress_notes`, {
        count: "1",
        page: "1",
        archived: "false"
      })
    ],
    [
      "services",
      withQuery("/api/v1/scheduler/services", {
        count: "1",
        page: "1",
        client_id: String(clientId),
        include_disabled: "true"
      })
    ],
    [
      "authorizations",
      withQuery("/api/v1/scheduler/authorizations", {
        client_id: String(clientId),
        count: "1",
        page: "1"
      })
    ],
    [
      "carePlans",
      withQuery(`/api/v1/clinical/client/${clientId}/careplans`, {
        count: "1",
        page: "1",
        include_set: "minimal"
      })
    ],
    [
      "clientForms",
      withQuery("/api/v1/tasks/forms20/submissions", {
        count: "1",
        page: "1",
        account_id: String(clientId),
        include_draft_status: "true"
      })
    ],
    [
      "documentApprovals",
      withQuery("/api/v1/clinical/document_approval", {
        client_id: String(clientId),
        count: "1",
        page: "1"
      })
    ],
    [
      "medications",
      withQuery(`/api/v3/clinical/clients/${clientId}/medications`, {
        count: "1",
        page: "1"
      })
    ],
    ["attachmentMetadata", `/api/v3/files/${clientId}/`],
    [
      "visitAttachmentMetadata",
      withQuery("/api/v1/scheduler/visit_attachments", { client_id: String(clientId) })
    ],
    [
      "requiredCareSkills",
      withQuery("/api/v1/employees/employee_skills", {
        client_specific_only: "true",
        count: "1",
        page: "1",
        client_id: String(clientId)
      })
    ],
    [
      "openTasks",
      withRepeatedQuery("/api/v2/tasks/tasks", [
        ["page", "1"],
        ["count", "1"],
        ["branch_id", String(branchId)],
        ["contexts", `include,api.patients.client,${clientId}`]
      ])
    ]
  ];
}

function scoreClientChartSections(sections: Record<string, ClientChartSection>): Pick<
  ClientChartRankedResult,
  "fullnessScore" | "populatedSections" | "totalSections" | "recordCount" | "failedSections"
> {
  let populatedSections = 0;
  let recordCount = 0;
  let failedSections = 0;
  for (const name of SCORABLE_CLIENT_CHART_SECTIONS) {
    const section = sections[name];
    if (!section?.ok) {
      failedSections += 1;
      continue;
    }
    const count = estimateSectionRecordCount(section.data);
    if (count > 0) populatedSections += 1;
    recordCount += Math.min(count, 100);
  }
  return {
    fullnessScore: populatedSections * 1000 + Math.min(recordCount, 999) - failedSections * 100,
    populatedSections,
    totalSections: SCORABLE_CLIENT_CHART_SECTIONS.length,
    recordCount,
    failedSections
  };
}

function estimateSectionRecordCount(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value !== "object") return 1;

  const record = value as Record<string, unknown>;
  const collectionKeys = [
    "items",
    "results",
    "documents",
    "notes",
    "services",
    "medications",
    "submissions",
    "attachments"
  ];
  const collectionCounts = collectionKeys
    .map((key) => record[key])
    .filter(Array.isArray)
    .map((items) => items.length);
  const declaredCount = toOptionalNumber(record.count);
  if (collectionCounts.length > 0 || declaredCount !== undefined) {
    return Math.max(declaredCount ?? 0, ...collectionCounts, 0);
  }
  if (record.data !== undefined) {
    const nestedCount = estimateSectionRecordCount(record.data);
    if (nestedCount > 0) return nestedCount;
  }

  const ignoredKeys = new Set([
    "page",
    "items_per_page",
    "total_pages",
    "count",
    "_links",
    "links"
  ]);
  return Object.entries(record).some(
    ([key, item]) => !ignoredKeys.has(key) && estimateSectionRecordCount(item) > 0
  )
    ? 1
    : 0;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function formatResponseError(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 500);
  if (!value || typeof value !== "object") return "Unknown response";
  const record = value as Record<string, unknown>;
  const message = readNonEmptyString(record.message) ?? readNonEmptyString(record.error);
  return message ?? JSON.stringify(value).slice(0, 500);
}

function unwrapConnectorResponse(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const response = (value as { response?: unknown }).response;
  return response !== undefined ? response : value;
}

function getConnectorErrorDetail(value: unknown): string {
  if (typeof value === "string") {
    return value.slice(0, 300);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  const record = value as Record<string, unknown>;
  for (const key of ["message", "detail", "error", "code"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().slice(0, 300);
    }
  }
  return "";
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}

function toTemplateReference(record: Record<string, unknown>): ConnectorTemplateReference {
  return {
    id: toNumber(record.id),
    name: toStringValue(record.name) || `Template ${toNumber(record.id)}`,
    description: toOptionalString(record.description),
    url: toOptionalString(record.url),
    usedApps: Array.isArray(record.usedApps)
      ? record.usedApps.map(toReferenceName).filter((value): value is string => Boolean(value))
      : [],
    usage: toOptionalNumber(record.usage)
  };
}

function toConnectionReference(record: Record<string, unknown>): ConnectorConnectionReference {
  return {
    id: toNumber(record.id),
    name: toStringValue(record.name) || `Connection ${toNumber(record.id)}`,
    accountLabel: toOptionalString(record.accountLabel),
    packageName: toReferenceName(record.packageName),
    theme: toOptionalString(record.theme),
    accountType: toOptionalString(record.accountType),
    scoped: toOptionalBoolean(record.scoped),
    editable: toOptionalBoolean(record.editable),
    upgradeable: toOptionalBoolean(record.upgradeable)
  };
}

function toWebhookReference(record: Record<string, unknown>): ConnectorWebhookReference {
  return {
    id: toNumber(record.id),
    name: toStringValue(record.name) || `Webhook ${toNumber(record.id)}`,
    type: toOptionalString(record.type),
    packageName: toReferenceName(record.packageName),
    theme: toOptionalString(record.theme),
    enabled: toOptionalBoolean(record.enabled),
    editable: toOptionalBoolean(record.editable),
    gone: toOptionalBoolean(record.gone),
    queueCount: toOptionalNumber(record.queueCount),
    queueLimit: toOptionalNumber(record.queueLimit),
    typeName: toOptionalString(record.typeName),
    typeAppName: toReferenceName(record.typeAppName),
    scenarioId: toOptionalNumber(record.scenarioId),
    scenarioName: toOptionalString(record.scenarioName),
    scenarioIsActive: toOptionalBoolean(record.scenarioIsActive),
    hasWebhookUrl: typeof record.url === "string" && Boolean(record.url)
  };
}

function toFunctionReference(record: Record<string, unknown>): ConnectorFunctionReference {
  return {
    id: toNumber(record.id),
    name: toStringValue(record.name) || `Function ${toNumber(record.id)}`,
    args: toOptionalString(record.args),
    description: toOptionalString(record.description),
    createdAt: toOptionalString(record.createdAt),
    updatedAt: toOptionalString(record.updatedAt)
  };
}

function toKeyReference(record: Record<string, unknown>): ConnectorKeyReference {
  return {
    id: toNumber(record.id),
    name: toStringValue(record.name) || `Key ${toNumber(record.id)}`,
    packageName: toReferenceName(record.packageName),
    theme: toOptionalString(record.theme),
    typeName: toOptionalString(record.typeName)
  };
}

function toDataStoreReference(record: Record<string, unknown>): ConnectorDataStoreReference {
  return {
    id: toNumber(record.id),
    name: toStringValue(record.name) || `Data store ${toNumber(record.id)}`,
    records: toOptionalNumber(record.records),
    size: toOptionalNumber(record.size),
    maxSize: toOptionalNumber(record.maxSize),
    dataStructureId: toOptionalNumber(record.datastructureId)
  };
}

function toDataStructureReference(record: Record<string, unknown>): ConnectorDataStructureReference {
  return {
    id: toNumber(record.id),
    name: toStringValue(record.name) || `Data structure ${toNumber(record.id)}`
  };
}

function toScenarioRun(record: Record<string, unknown>): ConnectorScenarioRun {
  const id = record.id ?? record.scenarioLogId ?? record.executionId;
  return {
    id: id === undefined || id === null ? undefined : String(id),
    started: firstOptionalString(record, ["started", "startedAt", "timestamp", "created", "createdAt"]),
    status: firstOptionalString(record, ["status", "state"]),
    duration: firstOptionalNumber(record, ["duration", "durationMs"]),
    operations: firstOptionalNumber(record, ["operations", "operationCount"]),
    transfer: firstOptionalNumber(record, ["transfer", "dataTransfer"]),
    kind: firstOptionalString(record, ["type", "kind", "logType"])
  };
}

function firstOptionalString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = toOptionalString(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function firstOptionalNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = toOptionalNumber(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function toReferenceName(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value || undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return toOptionalString(record.name) ?? toOptionalString(record.label);
}

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toOptionalString(value: unknown): string | undefined {
  const result = toStringValue(value);
  return result || undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function safeFilePart(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "scenario";
}

function jsonBytes(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

function downloadBrowserFile(content: Uint8Array, type: string, filename: string): void {
  const buffer = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([buffer], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  action: (item: T) => Promise<R>
): Promise<R[]> {
  let cursor = 0;
  const results = new Array<R>(items.length);
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      const item = items[index];
      cursor += 1;
      results[index] = await action(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
