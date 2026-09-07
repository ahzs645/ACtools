import type { CommandResult, ContentCommandData, RuntimeMessage } from "../shared/messages";
import type { AlayaCareClient } from "./AlayaCareClient";

export type SessionMessage = Extract<RuntimeMessage, { type: `ac/content/${string}` }>;

/** Hooks for the few session commands that need the host's UI rather than the API. */
export interface SessionDispatchHooks {
  /** Opens the Day View overlay on the page. Absent on hosts without an AlayaCare page. */
  openDayView?: () => Promise<void>;
}

/**
 * Routes one `ac/content/*` message to the session client.
 *
 * The extension calls this from the content script; the desktop app calls it
 * from the main process with a client bound to the selected tenant session.
 */
export async function dispatchSessionMessage(
  client: AlayaCareClient,
  message: SessionMessage,
  hooks: SessionDispatchHooks = {}
): Promise<CommandResult<ContentCommandData>> {
  switch (message.type) {
    case "ac/content/get-status":
      return { ok: true, data: await client.getStatus() };
    case "ac/content/open-day-view":
      if (!hooks.openDayView) {
        return { ok: false, error: "Day View needs an open AlayaCare tab; it is not available here." };
      }
      await hooks.openDayView();
      return { ok: true };
    case "ac/content/post-availability":
      return { ok: true, data: await client.postAvailability(message.payload) };
    case "ac/content/export-form-context-catalog":
      return { ok: true, data: await client.exportFormContextCatalog() };
    case "ac/content/search-client-charts":
      return {
        ok: true,
        data: await client.searchClientCharts(message.payload.query, message.payload.confirmedSynthetic)
      };
    case "ac/content/rank-client-charts":
      return {
        ok: true,
        data: await client.rankClientCharts(message.payload.limit, message.payload.confirmedSynthetic)
      };
    case "ac/content/export-active-client-chart":
      return {
        ok: true,
        data: await client.exportActiveClientChart(
          message.payload.confirmedSynthetic,
          message.payload.clientId
        )
      };
    case "ac/content/import-client-chart":
      return { ok: true, data: await client.importClientChart(message.payload) };
    case "ac/content/get-client-chart-destinations":
      return {
        ok: true,
        data: await client.getClientChartWriteDestinations(message.payload.confirmedSynthetic)
      };
    case "ac/content/search-shift-service-locations":
      return {
        ok: true,
        data: await client.searchShiftServiceLocations(message.payload.query, message.payload.confirmedUat)
      };
    case "ac/content/get-connector-scenario":
      return {
        ok: true,
        data: await client.getConnectorScenario(message.payload.source, message.payload.scenarioId)
      };
    case "ac/content/list-connector-scenarios":
      return { ok: true, data: await client.listConnectorScenarios() };
    case "ac/content/export-connector-scenario-bundle":
      return { ok: true, data: await client.exportConnectorScenarioBundle(message.payload?.scenarioId) };
    case "ac/content/download-all-connector-scenarios":
      return { ok: true, data: await client.downloadAllConnectorScenarios() };
    case "ac/content/get-connector-reference-catalog":
      return { ok: true, data: await client.getConnectorReferenceCatalog() };
    case "ac/content/get-connector-scenario-health":
      return { ok: true, data: await client.getConnectorScenarioHealth(message.payload.scenarioId) };
    case "ac/content/save-connector-scenario":
      return { ok: true, data: await client.saveConnectorScenario(message.payload) };
    case "ac/content/list-employees":
      return { ok: true, data: await client.listEmployees(message.payload) };
    case "ac/content/get-employee":
      return { ok: true, data: await client.getEmployeeDetail(message.payload.employeeId) };
    case "ac/content/preview-employee-task-clone":
      return { ok: true, data: await client.previewEmployeeTaskClone(message.payload) };
    case "ac/content/clone-employee-task":
      return { ok: true, data: await client.cloneEmployeeTask(message.payload) };
    default:
      return { ok: false, error: "Unsupported content action." };
  }
}
