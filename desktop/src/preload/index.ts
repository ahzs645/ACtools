import { contextBridge, ipcRenderer } from "electron";

/**
 * `window.acBridge`: the desktop host contract the AC Tools panel looks for
 * (see `src/popup/platform.ts`). It exists before any page script runs,
 * which is also how `surface-bootstrap.js` switches to the desktop surface.
 */
type Tier = "local" | "session";

function storage(tier: Tier) {
  return {
    get: (key: string) => ipcRenderer.invoke("ac:storage", { tier, op: "get", key }),
    set: (key: string, value: unknown) =>
      ipcRenderer.invoke("ac:storage", { tier, op: "set", key, value }),
    remove: (keys: string | string[]) =>
      ipcRenderer.invoke("ac:storage", { tier, op: "remove", keys }),
    keys: () => ipcRenderer.invoke("ac:storage", { tier, op: "keys" })
  };
}

contextBridge.exposeInMainWorld("acBridge", {
  sendMessage: (message: unknown) => ipcRenderer.invoke("ac:message", message),
  storage: {
    local: storage("local"),
    session: storage("session")
  },
  getVersion: () => ipcRenderer.invoke("ac:version")
});
