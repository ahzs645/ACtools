import type { CorePlatform, KeyValueStore } from "@ac-core/platform";

/** Adapts one `chrome.storage` area to the core's key/value contract. */
export function chromeStore(area: chrome.storage.StorageArea): KeyValueStore {
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

export const chromePlatform: CorePlatform = {
  local: chromeStore(chrome.storage.local),
  session: chromeStore(chrome.storage.session),
  fetch: (input, init) => fetch(input, init)
};
