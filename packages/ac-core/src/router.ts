import { EmployeeService } from "./external/employeeService";
import type { CorePlatform } from "./platform";
import { formatError } from "./shared/errors";
import { disabledFeatureMessage, loadFeatureFlags, type AcFeatureFlag } from "./shared/featureFlags";
import type { CommandResult, ContentCommandData, RuntimeMessage } from "./shared/messages";
import type { SessionMessage } from "./session/dispatch";

export type PopupMessage = Extract<RuntimeMessage, { type: `ac/popup/${string}` }>;

/**
 * Popup commands that run against the signed-in session. Each maps 1:1 onto
 * the `ac/content/*` command of the same name and payload.
 */
export const SESSION_FORWARDED_COMMANDS = new Set<string>([
  "ac/popup/get-status",
  "ac/popup/open-day-view",
  "ac/popup/post-availability",
  "ac/popup/export-form-context-catalog",
  "ac/popup/search-client-charts",
  "ac/popup/rank-client-charts",
  "ac/popup/export-active-client-chart",
  "ac/popup/import-client-chart",
  "ac/popup/get-client-chart-destinations",
  "ac/popup/search-shift-service-locations",
  "ac/popup/get-connector-scenario",
  "ac/popup/list-connector-scenarios",
  "ac/popup/export-connector-scenario-bundle",
  "ac/popup/download-all-connector-scenarios",
  "ac/popup/get-connector-reference-catalog",
  "ac/popup/get-connector-scenario-health",
  "ac/popup/save-connector-scenario",
  "ac/popup/list-employees",
  "ac/popup/get-employee",
  "ac/popup/preview-employee-task-clone",
  "ac/popup/clone-employee-task"
]);

/** Popup messages that an optional tool owns, and the flag that gates them. */
export const FEATURE_GATED_MESSAGES: Record<string, AcFeatureFlag> = {
  "ac/popup/search-client-charts": "clientChartSnapshot",
  "ac/popup/rank-client-charts": "clientChartSnapshot",
  "ac/popup/export-active-client-chart": "clientChartSnapshot",
  "ac/popup/import-client-chart": "clientChartImport",
  "ac/popup/get-client-chart-destinations": "clientChartImport"
};

export interface PopupRouterDeps {
  platform: CorePlatform;
  /** The tenant the API-key pathway should use when a message names none. */
  getActiveOrigin(): Promise<string>;
  /** Runs one session command on the host's current session and returns its result. */
  sendSessionMessage(message: SessionMessage): Promise<CommandResult<ContentCommandData>>;
}

export interface PopupRouter {
  employees: EmployeeService;
  handle(message: PopupMessage): Promise<CommandResult<ContentCommandData>>;
}

/**
 * The one message router both hosts share. The extension's background worker
 * and the desktop app's main process each wrap this with their own transport
 * and their own notion of "the current session".
 */
export function createPopupRouter(deps: PopupRouterDeps): PopupRouter {
  const employees = new EmployeeService(deps.platform);
  const environments = employees.environments;

  async function refuseDisabledFeature(
    messageType: string
  ): Promise<CommandResult<ContentCommandData> | null> {
    const flag = FEATURE_GATED_MESSAGES[messageType];
    if (!flag) {
      return null;
    }
    const flags = await loadFeatureFlags(deps.platform.local);
    return flags[flag] ? null : { ok: false, error: disabledFeatureMessage(flag) };
  }

  async function originFor(requested: string | undefined): Promise<string> {
    return requested ?? (await deps.getActiveOrigin());
  }

  async function handle(message: PopupMessage): Promise<CommandResult<ContentCommandData>> {
    const refusal = await refuseDisabledFeature(message.type);
    if (refusal) {
      return refusal;
    }

    if (SESSION_FORWARDED_COMMANDS.has(message.type)) {
      const forwarded = {
        ...message,
        type: message.type.replace("ac/popup/", "ac/content/")
      } as SessionMessage;
      return deps.sendSessionMessage(forwarded);
    }

    switch (message.type) {
      case "ac/popup/get-employee-api-credential-status":
        return {
          ok: true,
          data: await employees.getCredentialStatus(await originFor(message.payload?.origin))
        };
      case "ac/popup/set-employee-api-credentials":
        return {
          ok: true,
          data: await employees.setCredentials(await originFor(message.payload.origin), message.payload)
        };
      case "ac/popup/clear-employee-api-credentials":
        return {
          ok: true,
          data: await employees.clearCredentials(await originFor(message.payload?.origin))
        };
      case "ac/popup/list-employee-configured-tenants":
        return { ok: true, data: await employees.listConfiguredTenants() };
      case "ac/popup/plan-employee-copy":
        return { ok: true, data: await employees.planCopy(message.payload) };
      case "ac/popup/copy-employee-target":
        return {
          ok: true,
          data: await employees.copyTarget(message.payload.sourceOrigin, message.payload)
        };
      case "ac/popup/copy-employee":
        return {
          ok: true,
          data: await employees.copyLegacy(await deps.getActiveOrigin(), message.payload)
        };
      case "ac/popup/update-employee-status":
        return {
          ok: true,
          data: await employees.updateStatus(await deps.getActiveOrigin(), message.payload)
        };
      case "ac/popup/get-environment-registry":
        await employees.synchronizeCredentialEnvironments();
        return { ok: true, data: await environments.load() };
      case "ac/popup/save-environment":
        return { ok: true, data: await environments.save(message.payload) };
      case "ac/popup/delete-environment":
        await employees.removeEnvironment(message.payload.origin);
        return { ok: true, data: await environments.load() };
      case "ac/popup/set-default-environment":
        return { ok: true, data: await environments.setDefault(message.payload.origin) };
      case "ac/popup/import-environments":
        return { ok: true, data: await environments.import(message.payload) };
      case "ac/popup/check-environment-health":
        return { ok: true, data: await employees.checkEnvironmentHealth(message.payload.origin) };
      default:
        return { ok: false, error: "Unsupported popup action." };
    }
  }

  return {
    employees,
    handle: async (message) => {
      try {
        return await handle(message);
      } catch (error) {
        return { ok: false, error: formatError(error) };
      }
    }
  };
}
