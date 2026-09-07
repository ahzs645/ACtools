import { app, ipcMain, type BrowserWindow } from "electron";

import { MemoryStore } from "@ac-core/platform";
import { createPopupRouter, type PopupMessage } from "@ac-core/router";
import { dispatchSessionMessage } from "@ac-core/session/dispatch";
import { formatError } from "@ac-core/shared/errors";
import type { CommandResult, RuntimeMessage } from "@ac-core/shared/messages";
import { isPopupMessage, isRuntimeMessage } from "@ac-core/shared/messages";

import { FileStore } from "./stores";
import { TenantSessions } from "./tenantSessions";

export interface StorageRequest {
  tier: "local" | "session";
  op: "get" | "set" | "remove" | "keys";
  key?: string;
  keys?: string | string[];
  value?: unknown;
}

/**
 * Wires the AC Tools panel (renderer) to the shared core (main).
 *
 * The panel sends the same `ac/popup/*` messages it sends to the extension's
 * background worker. Desktop-only tenant-session messages are answered here;
 * everything else goes to the router from `@ac-core`, which treats the
 * selected tenant as "the current tenant" and runs session commands against
 * that tenant's Electron session.
 */
export function registerIpc(getMainWindow: () => BrowserWindow | null): void {
  const local = FileStore.forUserData("ac-tools-local.json");
  const sessionStore = new MemoryStore();

  // Declared before the router closes over it; assigned right after.
  let tenants: TenantSessions;

  const router = createPopupRouter({
    platform: {
      local,
      session: sessionStore,
      // API keys go over Node's fetch: no cookies, no CORS.
      fetch: (input, init) => fetch(input, init)
    },
    getActiveOrigin: () => tenants.getActiveOrigin(),
    sendSessionMessage: async (message) => {
      const origin = await tenants.getActiveOrigin();
      return dispatchSessionMessage(tenants.clientFor(origin), message);
    }
  });
  tenants = new TenantSessions(router.employees.environments, local, getMainWindow);

  ipcMain.handle("ac:message", async (_event, message: unknown): Promise<CommandResult<unknown>> => {
    if (!isRuntimeMessage(message) || !isPopupMessage(message)) {
      return { ok: false, error: "Unsupported message." };
    }
    try {
      const desktopResult = await handleDesktopMessage(message, tenants);
      return desktopResult ?? (await router.handle(message as PopupMessage));
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  });

  ipcMain.handle("ac:storage", async (_event, request: StorageRequest) => {
    const store = request.tier === "session" ? sessionStore : local;
    switch (request.op) {
      case "get":
        return store.get(String(request.key));
      case "set":
        await store.set(String(request.key), request.value);
        return undefined;
      case "remove":
        await store.remove(request.keys ?? String(request.key));
        return undefined;
      case "keys":
        return store.keys();
      default:
        throw new Error(`Unsupported storage operation: ${String(request.op)}`);
    }
  });

  ipcMain.handle("ac:version", () => app.getVersion());
}

async function handleDesktopMessage(
  message: RuntimeMessage,
  tenants: TenantSessions
): Promise<CommandResult<unknown> | null> {
  switch (message.type) {
    case "ac/popup/desktop/get-session-state":
      return { ok: true, data: await tenants.getState() };
    case "ac/popup/desktop/select-tenant":
      return { ok: true, data: await tenants.selectTenant(message.payload.origin) };
    case "ac/popup/desktop/sign-in":
      return { ok: true, data: await tenants.signIn(message.payload.origin) };
    case "ac/popup/desktop/sign-out":
      return { ok: true, data: await tenants.signOut(message.payload.origin) };
    case "ac/popup/set-surface":
      // The desktop app has exactly one surface; accept and ignore.
      return { ok: true };
    default:
      return null;
  }
}
