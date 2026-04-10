import type { CommandResult, RuntimeMessage } from "./messages";

export async function sendRuntimeMessage<T>(message: RuntimeMessage): Promise<CommandResult<T>> {
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

