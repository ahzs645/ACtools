import type { KeyValueStore } from "@ac-core/platform";
import type { CommandResult, RuntimeMessage } from "@ac-core/shared/messages";

/**
 * What a non-Chrome host (the Alayaduck desktop app) injects before the side
 * panel loads. When it is absent the panel is running as a Chrome extension.
 */
export interface AcHostBridge {
  sendMessage<T>(message: RuntimeMessage): Promise<CommandResult<T>>;
  storage: {
    local: KeyValueStore;
    session: KeyValueStore;
  };
  getVersion(): Promise<string>;
}

declare global {
  interface Window {
    acBridge?: AcHostBridge;
  }
}

export function getHostBridge(): AcHostBridge | undefined {
  return typeof window === "undefined" ? undefined : window.acBridge;
}

export function isDesktopHost(): boolean {
  return Boolean(getHostBridge());
}

function chromeStore(area: chrome.storage.StorageArea): KeyValueStore {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const stored = await area.get(key);
      return stored[key] as T | undefined;
    },
    async set(key, value) {
      await area.set({ [key]: value });
    },
    async remove(keys) {
      await area.remove(keys);
    },
    async keys() {
      return Object.keys(await area.get(null));
    }
  };
}

const bridge = getHostBridge();

/** Persistent (`local`) and process-lifetime (`session`) storage for the panel. */
export const popupStorage: { local: KeyValueStore; session: KeyValueStore } = bridge
  ? bridge.storage
  : {
      local: chromeStore(chrome.storage.local),
      session: chromeStore(chrome.storage.session)
    };

export async function getAppVersion(): Promise<string> {
  if (bridge) {
    return bridge.getVersion();
  }
  return chrome.runtime.getManifest().version;
}
