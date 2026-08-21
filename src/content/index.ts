import type { CommandResult, ContentCommandData, RuntimeMessage } from "../shared/messages";
import { isContentMessage, isRuntimeMessage } from "../shared/messages";
import { formatError } from "../shared/errors";
import { DayViewOverlay } from "./features/dayview";
import { PageActionButton } from "./features/PageActionButton";
import { AlayaCareClient } from "./services/AlayaCareClient";

const client = new AlayaCareClient();
const overlay = new DayViewOverlay(client);
const pageActionButton = new PageActionButton(() => {
  void overlay.open().catch(console.error);
});

pageActionButton.start();

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isRuntimeMessage(message)) {
    return false;
  }

  if (!isContentMessage(message)) {
    return false;
  }

  void handleContentMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: formatError(error)
      } satisfies CommandResult<never>);
    });

  return true;
});

async function handleContentMessage(
  message: Extract<RuntimeMessage, { type: `ac/content/${string}` }>
): Promise<CommandResult<ContentCommandData>> {
  switch (message.type) {
    case "ac/content/get-status":
      return {
        ok: true,
        data: await client.getStatus()
      };
    case "ac/content/open-day-view":
      await overlay.open();
      return { ok: true };
    case "ac/content/post-availability":
      return {
        ok: true,
        data: await client.postAvailability(message.payload)
      };
    case "ac/content/export-form-context-catalog":
      return {
        ok: true,
        data: await client.exportFormContextCatalog()
      };
    case "ac/content/search-client-charts":
      return {
        ok: true,
        data: await client.searchClientCharts(
          message.payload.query,
          message.payload.confirmedSynthetic
        )
      };
    case "ac/content/rank-client-charts":
      return {
        ok: true,
        data: await client.rankClientCharts(
          message.payload.limit,
          message.payload.confirmedSynthetic
        )
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
      return {
        ok: true,
        data: await client.importClientChart(message.payload)
      };
    case "ac/content/get-connector-scenario":
      return {
        ok: true,
        data: await client.getConnectorScenario(message.payload.source, message.payload.scenarioId)
      };
    case "ac/content/list-connector-scenarios":
      return {
        ok: true,
        data: await client.listConnectorScenarios()
      };
    case "ac/content/export-connector-scenario-bundle":
      return {
        ok: true,
        data: await client.exportConnectorScenarioBundle(message.payload?.scenarioId)
      };
    case "ac/content/download-all-connector-scenarios":
      return {
        ok: true,
        data: await client.downloadAllConnectorScenarios()
      };
    case "ac/content/get-connector-reference-catalog":
      return {
        ok: true,
        data: await client.getConnectorReferenceCatalog()
      };
    case "ac/content/get-connector-scenario-health":
      return {
        ok: true,
        data: await client.getConnectorScenarioHealth(message.payload.scenarioId)
      };
    case "ac/content/save-connector-scenario":
      return {
        ok: true,
        data: await client.saveConnectorScenario(message.payload)
      };
    case "ac/content/list-employees":
      return {
        ok: true,
        data: await client.listEmployees(message.payload)
      };
    case "ac/content/get-employee":
      return {
        ok: true,
        data: await client.getEmployeeDetail(message.payload.employeeId)
      };
    default:
      return {
        ok: false,
        error: "Unsupported content action."
      };
  }
}
