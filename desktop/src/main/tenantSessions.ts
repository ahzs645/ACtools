import { BrowserWindow, dialog, session, type Session } from "electron";
import { writeFile } from "node:fs/promises";

import { normalizeSupportedOrigin } from "@ac-core/alayaCareUrls";
import type { EnvironmentStore } from "@ac-core/external/environmentStore";
import type { KeyValueStore, SessionContext } from "@ac-core/platform";
import type { DesktopSessionState, DesktopTenantSession } from "@ac-core/shared/messages";
import { AlayaCareClient } from "@ac-core/session/AlayaCareClient";

const ACTIVE_TENANT_KEY = "ac-tools-desktop-active-tenant";

/**
 * The desktop app's answer to "which AlayaCare page is this running on".
 *
 * Every configured tenant gets its own persistent Electron session
 * (`persist:ac-<host>`), so cookies never leak between tenants and a sign-in
 * survives restarts. Session-pathway commands run through `Session.fetch`,
 * which attaches that session's cookies without any CORS involvement.
 */
export class TenantSessions {
  private readonly signedIn = new Map<string, DesktopTenantSession>();
  private readonly loginWindows = new Map<string, BrowserWindow>();

  constructor(
    private readonly environments: EnvironmentStore,
    private readonly local: KeyValueStore,
    private readonly getParentWindow: () => BrowserWindow | null
  ) {}

  async getActiveOrigin(): Promise<string> {
    const origin = await this.readActiveOrigin();
    if (!origin) {
      throw new Error("Select a tenant in the tenant bar first.");
    }
    return origin;
  }

  async getState(): Promise<DesktopSessionState> {
    const registry = await this.environments.load();
    let activeOrigin = await this.readActiveOrigin();
    if (!activeOrigin || !registry.environments.some((item) => item.origin === activeOrigin)) {
      activeOrigin = registry.defaultOrigin ?? registry.environments[0]?.origin ?? null;
      if (activeOrigin) {
        await this.local.set(ACTIVE_TENANT_KEY, activeOrigin);
      }
    }
    return {
      activeOrigin,
      tenants: registry.environments.map((environment) => ({
        origin: environment.origin,
        name: environment.name,
        signedIn: this.signedIn.get(environment.origin)?.signedIn ?? false,
        currentUserName: this.signedIn.get(environment.origin)?.currentUserName
      }))
    };
  }

  async selectTenant(originValue: string): Promise<DesktopSessionState> {
    const origin = normalizeSupportedOrigin(originValue);
    const registry = await this.environments.load();
    if (!registry.environments.some((item) => item.origin === origin)) {
      throw new Error("Add the tenant in Environment Manager before selecting it.");
    }
    await this.local.set(ACTIVE_TENANT_KEY, origin);
    await this.probe(origin);
    return this.getState();
  }

  /** Builds a session client for a tenant; `getHref` is the tenant root since there is no page. */
  clientFor(originValue: string): AlayaCareClient {
    const origin = normalizeSupportedOrigin(originValue);
    return new AlayaCareClient(this.contextFor(origin));
  }

  contextFor(origin: string): SessionContext {
    const tenantSession = this.sessionFor(origin);
    return {
      origin,
      getHref: () => `${origin}/`,
      fetch: (input, init) =>
        tenantSession.fetch(input instanceof URL ? input.toString() : input, {
          ...init,
          // Session.fetch only sends the tenant's cookies when asked to.
          credentials: "include"
        }),
      saveFile: (content, _type, filename) => this.saveFile(content, filename)
    };
  }

  /**
   * Opens the tenant in a window that shares the tenant's session, lets the
   * user complete whatever sign-in the tenant uses, and resolves once
   * AlayaCare reports a signed-in user or the window is closed.
   */
  async signIn(originValue: string): Promise<DesktopSessionState> {
    const origin = normalizeSupportedOrigin(originValue);
    const existing = this.loginWindows.get(origin);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return this.getState();
    }

    const tenantSession = this.sessionFor(origin);
    const parent = this.getParentWindow();
    const loginWindow = new BrowserWindow({
      width: 1100,
      height: 800,
      title: `Sign in: ${new URL(origin).hostname}`,
      ...(parent ? { parent } : {}),
      webPreferences: {
        session: tenantSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    this.loginWindows.set(origin, loginWindow);

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      loginWindow.on("closed", () => {
        this.loginWindows.delete(origin);
        finish();
      });
      loginWindow.webContents.on("did-finish-load", () => {
        void this.probe(origin).then((state) => {
          if (state.signedIn && !loginWindow.isDestroyed()) {
            loginWindow.close();
          }
        });
      });
      void loginWindow.loadURL(`${origin}/`);
    });

    await this.probe(origin);
    return this.getState();
  }

  async signOut(originValue: string): Promise<DesktopSessionState> {
    const origin = normalizeSupportedOrigin(originValue);
    const loginWindow = this.loginWindows.get(origin);
    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.close();
    }
    await this.sessionFor(origin).clearStorageData();
    this.signedIn.set(origin, { origin, name: "", signedIn: false });
    return this.getState();
  }

  /** Asks the tenant who is signed in, and remembers the answer for the tenant bar. */
  async probe(origin: string): Promise<DesktopTenantSession> {
    let state: DesktopTenantSession = { origin, name: "", signedIn: false };
    try {
      const status = await this.clientFor(origin).getStatus();
      state = {
        origin,
        name: "",
        signedIn: status.ready,
        currentUserName: status.currentUserName ?? status.currentUserId?.toString()
      };
    } catch {
      // Not reachable or not signed in; both read as "not signed in".
    }
    this.signedIn.set(origin, state);
    return state;
  }

  private async readActiveOrigin(): Promise<string | null> {
    const stored = await this.local.get<string>(ACTIVE_TENANT_KEY);
    if (!stored) {
      return null;
    }
    try {
      return normalizeSupportedOrigin(stored);
    } catch {
      return null;
    }
  }

  private sessionFor(origin: string): Session {
    const host = new URL(origin).hostname.replace(/[^a-z0-9.-]/gi, "-");
    const tenantSession = session.fromPartition(`persist:ac-${host}`);
    // Identity providers sometimes refuse embedded browsers by user agent;
    // present the plain Chromium string the tenant would see from Chrome.
    const userAgent = tenantSession
      .getUserAgent()
      .replace(/ Electron\/\S+/, "")
      .replace(/ ac-tools-desktop\/\S+/i, "");
    tenantSession.setUserAgent(userAgent);
    return tenantSession;
  }

  private async saveFile(content: Uint8Array, filename: string): Promise<void> {
    const parent = this.getParentWindow();
    const options = { title: "Save export", defaultPath: filename };
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      throw new Error("Save cancelled.");
    }
    await writeFile(result.filePath, content);
  }
}
