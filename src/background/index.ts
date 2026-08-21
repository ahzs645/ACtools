import { getActiveTabId, sendMessageToTab } from "../shared/chrome";
import { formatError } from "../shared/errors";
import type { AlayaCareFormContextCatalogSnapshot } from "../shared/formContextCatalog";
import type {
  ClientChartExportSnapshot,
  ClientChartRankResponse,
  ClientChartSearchResponse
} from "../shared/clientChart";
import type {
  EmployeeApiCredentialStatus,
  EmployeeConfiguredTenant,
  EmployeeCopyPlanResult,
  EmployeeCopyResult,
  EmployeeCopyTargetResult,
  EmployeeDetail,
  EmployeeListResult,
  EmployeeWriteResult
} from "../shared/employees";
import type { EnvironmentHealth, EnvironmentRegistry } from "../shared/environments";
import type {
  ConnectorReferenceCatalog,
  ConnectorScenarioBundle,
  ConnectorScenarioBulkDownloadResult,
  ConnectorScenarioHealth,
  ConnectorScenarioListResult,
  ConnectorScenarioSaveResult,
  ConnectorScenarioSnapshot
} from "../shared/connectorScenarios";
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
import { getSupportedTabOrigin, isSupportedAlayaCareUrl } from "./alayaCareUrls";
import {
  importEnvironmentRegistry,
  loadEnvironmentRegistry,
  saveEnvironment,
  setDefaultEnvironment
} from "./environments/environmentStore";
import {
  checkEnvironmentHealth,
  clearEmployeeCredentials,
  copyEmployeeLegacy,
  copyEmployeeTarget,
  getEmployeeCredentialStatus,
  listEmployeeConfiguredTenants,
  planEmployeeCopy,
  removeEmployeeEnvironment,
  setEmployeeCredentials,
  synchronizeCredentialEnvironments,
  updateEmployeeStatus
} from "./employees/employeeService";

const SIDE_PANEL_PATH = "sidepanel.html";
const POPUP_PATH = "sidepanel.html?surface=popup";

type PopupResponseData =
  | PageStatus
  | AvailabilityPostResult
  | AlayaCareFormContextCatalogSnapshot
  | ClientChartExportSnapshot
  | ClientChartSearchResponse
  | ClientChartRankResponse
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
  | EmployeeCopyTargetResult
  | EnvironmentRegistry
  | EnvironmentHealth
  | void;

let currentSurface: Surface = DEFAULT_SURFACE;

void initialize();

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isRuntimeMessage(message) || !isPopupMessage(message)) {
    return false;
  }
  void handlePopupMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({ ok: false, error: formatError(error) } satisfies CommandResult<never>);
    });
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (currentSurface !== "sidepanel" || !("sidePanel" in chrome)) {
    return;
  }
  if (changeInfo.url || tab.url) {
    void syncSidePanelForTab(tabId, changeInfo.url ?? tab.url ?? "");
  }
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

async function handlePopupMessage(
  message: Extract<RuntimeMessage, { type: `ac/popup/${string}` }>
): Promise<CommandResult<PopupResponseData>> {
  if (message.type === "ac/popup/set-surface") {
    await chrome.storage.local.set({ [SURFACE_STORAGE_KEY]: message.payload });
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
    case "ac/popup/search-client-charts":
      return sendMessageToTab<ClientChartSearchResponse>(tabId, {
        type: "ac/content/search-client-charts",
        payload: message.payload
      });
    case "ac/popup/rank-client-charts":
      return sendMessageToTab<ClientChartRankResponse>(tabId, {
        type: "ac/content/rank-client-charts",
        payload: message.payload
      });
    case "ac/popup/export-active-client-chart":
      return sendMessageToTab<ClientChartExportSnapshot>(tabId, {
        type: "ac/content/export-active-client-chart",
        payload: message.payload
      });
    case "ac/popup/get-connector-scenario":
      return sendMessageToTab<ConnectorScenarioSnapshot>(tabId, {
        type: "ac/content/get-connector-scenario",
        payload: message.payload
      });
    case "ac/popup/list-connector-scenarios":
      return sendMessageToTab<ConnectorScenarioListResult>(tabId, {
        type: "ac/content/list-connector-scenarios"
      });
    case "ac/popup/export-connector-scenario-bundle":
      return sendMessageToTab<ConnectorScenarioBundle>(tabId, {
        type: "ac/content/export-connector-scenario-bundle",
        payload: message.payload
      });
    case "ac/popup/download-all-connector-scenarios":
      return sendMessageToTab<ConnectorScenarioBulkDownloadResult>(tabId, {
        type: "ac/content/download-all-connector-scenarios"
      });
    case "ac/popup/get-connector-reference-catalog":
      return sendMessageToTab<ConnectorReferenceCatalog>(tabId, {
        type: "ac/content/get-connector-reference-catalog"
      });
    case "ac/popup/get-connector-scenario-health":
      return sendMessageToTab<ConnectorScenarioHealth>(tabId, {
        type: "ac/content/get-connector-scenario-health",
        payload: message.payload
      });
    case "ac/popup/save-connector-scenario":
      return sendMessageToTab<ConnectorScenarioSaveResult>(tabId, {
        type: "ac/content/save-connector-scenario",
        payload: message.payload
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
        data: await getEmployeeCredentialStatus(tabId, message.payload?.origin)
      };
    case "ac/popup/set-employee-api-credentials":
      return { ok: true, data: await setEmployeeCredentials(tabId, message.payload) };
    case "ac/popup/clear-employee-api-credentials":
      return {
        ok: true,
        data: await clearEmployeeCredentials(tabId, message.payload?.origin)
      };
    case "ac/popup/list-employee-configured-tenants":
      return { ok: true, data: await listEmployeeConfiguredTenants() };
    case "ac/popup/plan-employee-copy":
      return { ok: true, data: await planEmployeeCopy(message.payload) };
    case "ac/popup/copy-employee-target":
      return {
        ok: true,
        data: await copyEmployeeTarget(message.payload.sourceOrigin, message.payload)
      };
    case "ac/popup/copy-employee":
      return { ok: true, data: await copyEmployeeLegacy(tabId, message.payload) };
    case "ac/popup/update-employee-status":
      return { ok: true, data: await updateEmployeeStatus(tabId, message.payload) };
    case "ac/popup/get-environment-registry":
      await synchronizeCredentialEnvironments();
      return { ok: true, data: await loadEnvironmentRegistry() };
    case "ac/popup/save-environment":
      return { ok: true, data: await saveEnvironment(message.payload) };
    case "ac/popup/delete-environment":
      await removeEmployeeEnvironment(message.payload.origin);
      return { ok: true, data: await loadEnvironmentRegistry() };
    case "ac/popup/set-default-environment":
      return { ok: true, data: await setDefaultEnvironment(message.payload.origin) };
    case "ac/popup/import-environments":
      return { ok: true, data: await importEnvironmentRegistry(message.payload) };
    case "ac/popup/check-environment-health":
      return { ok: true, data: await checkEnvironmentHealth(message.payload.origin) };
    default:
      return { ok: false, error: "Unsupported popup action." };
  }
}

async function loadStoredSurface(): Promise<Surface> {
  try {
    const stored = await chrome.storage.local.get(SURFACE_STORAGE_KEY);
    return stored[SURFACE_STORAGE_KEY] === "popup" ? "popup" : DEFAULT_SURFACE;
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
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: surface === "sidepanel" });
  } catch (error) {
    console.warn("Unable to set side panel behavior.", error);
  }
  const tabs = (await chrome.tabs.query({})).filter(
    (tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === "number"
  );
  if (surface === "popup") {
    await Promise.all(
      tabs.map((tab) =>
        chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false }).catch(() => undefined)
      )
    );
  } else {
    await Promise.all(tabs.map((tab) => syncSidePanelForTab(tab.id, tab.url ?? "")));
  }
}

async function syncSidePanelForTab(tabId: number, url: string): Promise<void> {
  if (!("sidePanel" in chrome) || currentSurface !== "sidepanel") {
    return;
  }
  await chrome.sidePanel.setOptions({
    tabId,
    path: SIDE_PANEL_PATH,
    enabled: isSupportedAlayaCareUrl(url)
  });
}
