import type { AlayaCareFormContextCatalogSnapshot } from "./formContextCatalog";
import type {
  ClientChartExportSnapshot,
  ClientChartRankResponse,
  ClientChartSearchResponse
} from "./clientChart";
import type { ClientChartImportRequest, ClientChartImportResult } from "./clientChartImport";
import type {
  EmployeeApiCredentialStatus,
  EmployeeConfiguredTenant,
  EmployeeCopyRequest,
  EmployeeCopyPlanRequest,
  EmployeeCopyPlanResult,
  EmployeeCopyResult,
  EmployeeCopyTargetRequest,
  EmployeeDetail,
  EmployeeListRequest,
  EmployeeListResult,
  EmployeeStatusUpdate,
  EmployeeWriteResult
} from "./employees";
import type {
  EnvironmentConfig,
  EnvironmentHealth,
  EnvironmentRegistry
} from "./environments";
import type {
  ConnectorScenarioBundle,
  ConnectorScenarioBulkDownloadResult,
  ConnectorScenarioHealth,
  ConnectorReferenceCatalog,
  ConnectorScenarioListResult,
  ConnectorScenarioSaveRequest,
  ConnectorScenarioSaveResult,
  ConnectorScenarioSnapshot,
  ConnectorScenarioSource
} from "./connectorScenarios";

export interface AvailabilityDraft {
  employeeId: number;
  availabilityTypeId: number;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
}

export interface PageStatus {
  ready: boolean;
  location: string;
  reason?: string;
  currentUserId?: number;
  currentUserName?: string;
}

export interface AvailabilityPostResult {
  uri: string;
  status: number;
  body: unknown;
}

export interface CommandResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export type Surface = "sidepanel" | "popup";

export type RuntimeMessage =
  | {
      type: "ac/popup/get-status";
    }
  | {
      type: "ac/popup/open-day-view";
    }
  | {
      type: "ac/popup/post-availability";
      payload: AvailabilityDraft;
    }
  | {
      type: "ac/popup/export-form-context-catalog";
    }
  | {
      type: "ac/popup/search-client-charts";
      payload: { query: string; confirmedSynthetic: boolean };
    }
  | {
      type: "ac/popup/rank-client-charts";
      payload: { limit: 10 | 25; confirmedSynthetic: boolean };
    }
  | {
      type: "ac/popup/export-active-client-chart";
      payload: { confirmedSynthetic: boolean; clientId?: number };
    }
  | {
      type: "ac/popup/import-client-chart";
      payload: ClientChartImportRequest;
    }
  | {
      type: "ac/popup/get-connector-scenario";
      payload: { source: ConnectorScenarioSource; scenarioId?: number };
    }
  | {
      type: "ac/popup/list-connector-scenarios";
    }
  | {
      type: "ac/popup/export-connector-scenario-bundle";
      payload?: { scenarioId?: number };
    }
  | {
      type: "ac/popup/download-all-connector-scenarios";
    }
  | {
      type: "ac/popup/get-connector-reference-catalog";
    }
  | {
      type: "ac/popup/get-connector-scenario-health";
      payload: { scenarioId: number };
    }
  | {
      type: "ac/popup/save-connector-scenario";
      payload: ConnectorScenarioSaveRequest;
    }
  | {
      type: "ac/popup/list-employees";
      payload: EmployeeListRequest;
    }
  | {
      type: "ac/popup/get-employee";
      payload: { employeeId: number };
    }
  | {
      type: "ac/popup/update-employee-status";
      payload: EmployeeStatusUpdate;
    }
  | {
      type: "ac/popup/get-employee-api-credential-status";
      payload?: { origin?: string };
    }
  | {
      type: "ac/popup/set-employee-api-credentials";
      payload: { publicKey: string; privateKey: string; remember: boolean; origin?: string };
    }
  | {
      type: "ac/popup/clear-employee-api-credentials";
      payload?: { origin?: string };
    }
  | {
      type: "ac/popup/list-employee-configured-tenants";
    }
  | {
      type: "ac/popup/copy-employee";
      payload: EmployeeCopyRequest;
    }
  | {
      type: "ac/popup/plan-employee-copy";
      payload: EmployeeCopyPlanRequest;
    }
  | {
      type: "ac/popup/copy-employee-target";
      payload: EmployeeCopyTargetRequest;
    }
  | {
      type: "ac/popup/get-environment-registry";
    }
  | {
      type: "ac/popup/save-environment";
      payload: EnvironmentConfig;
    }
  | {
      type: "ac/popup/delete-environment";
      payload: { origin: string };
    }
  | {
      type: "ac/popup/set-default-environment";
      payload: { origin: string | null };
    }
  | {
      type: "ac/popup/import-environments";
      payload: EnvironmentRegistry;
    }
  | {
      type: "ac/popup/check-environment-health";
      payload: { origin: string };
    }
  | {
      type: "ac/popup/set-surface";
      payload: Surface;
    }
  | {
      type: "ac/content/get-status";
    }
  | {
      type: "ac/content/open-day-view";
    }
  | {
      type: "ac/content/post-availability";
      payload: AvailabilityDraft;
    }
  | {
      type: "ac/content/export-form-context-catalog";
    }
  | {
      type: "ac/content/search-client-charts";
      payload: { query: string; confirmedSynthetic: boolean };
    }
  | {
      type: "ac/content/rank-client-charts";
      payload: { limit: 10 | 25; confirmedSynthetic: boolean };
    }
  | {
      type: "ac/content/export-active-client-chart";
      payload: { confirmedSynthetic: boolean; clientId?: number };
    }
  | {
      type: "ac/content/import-client-chart";
      payload: ClientChartImportRequest;
    }
  | {
      type: "ac/content/get-connector-scenario";
      payload: { source: ConnectorScenarioSource; scenarioId?: number };
    }
  | {
      type: "ac/content/list-connector-scenarios";
    }
  | {
      type: "ac/content/export-connector-scenario-bundle";
      payload?: { scenarioId?: number };
    }
  | {
      type: "ac/content/download-all-connector-scenarios";
    }
  | {
      type: "ac/content/get-connector-reference-catalog";
    }
  | {
      type: "ac/content/get-connector-scenario-health";
      payload: { scenarioId: number };
    }
  | {
      type: "ac/content/save-connector-scenario";
      payload: ConnectorScenarioSaveRequest;
    }
  | {
      type: "ac/content/list-employees";
      payload: EmployeeListRequest;
    }
  | {
      type: "ac/content/get-employee";
      payload: { employeeId: number };
    };

export type ContentCommandData =
  | PageStatus
  | AvailabilityPostResult
  | AlayaCareFormContextCatalogSnapshot
  | ClientChartExportSnapshot
  | ClientChartSearchResponse
  | ClientChartRankResponse
  | ClientChartImportResult
  | ConnectorScenarioSnapshot
  | ConnectorScenarioBundle
  | ConnectorScenarioBulkDownloadResult
  | ConnectorScenarioListResult
  | ConnectorReferenceCatalog
  | ConnectorScenarioHealth
  | ConnectorScenarioSaveResult
  | EmployeeListResult
  | EmployeeDetail
  | EmployeeWriteResult
  | EmployeeApiCredentialStatus
  | EmployeeConfiguredTenant[]
  | EmployeeCopyResult
  | EmployeeCopyPlanResult
  | EnvironmentRegistry
  | EnvironmentHealth
  | void;

export const POPUP_FORM_STORAGE_KEY = "ac-tools-availability-draft";
export const SURFACE_STORAGE_KEY = "ac-tools-surface";
export const DEFAULT_SURFACE: Surface = "sidepanel";

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeType = (value as { type?: unknown }).type;
  return typeof maybeType === "string" && maybeType.startsWith("ac/");
}

export function isPopupMessage(
  value: RuntimeMessage
): value is Extract<RuntimeMessage, { type: `ac/popup/${string}` }> {
  return value.type.startsWith("ac/popup/");
}

export function isContentMessage(
  value: RuntimeMessage
): value is Extract<RuntimeMessage, { type: `ac/content/${string}` }> {
  return value.type.startsWith("ac/content/");
}
