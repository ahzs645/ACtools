import type { AcHostBridge } from "../popup/platform";
import type { CommandResult, RuntimeMessage } from "@ac-core/shared/messages";

/**
 * Sends a popup command to whichever host is running the panel: the desktop
 * bridge when it is present, otherwise the extension's background worker.
 */
export async function sendRuntimeMessage<T>(message: RuntimeMessage): Promise<CommandResult<T>> {
  const bridge = typeof window !== "undefined" ? window.acBridge : undefined;
  if (bridge) {
    return bridge.sendMessage<T>(message);
  }
  return chrome.runtime.sendMessage(message) as Promise<CommandResult<T>>;
}

export async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  return tab.id;
}

export async function sendMessageToTab<T>(tabId: number, message: RuntimeMessage): Promise<CommandResult<T>> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<CommandResult<T>>;
}
