import { sendRuntimeMessage } from "../../../shared/chrome";
import { formatError } from "@ac-core/shared/errors";
import type { DesktopSessionState } from "@ac-core/shared/messages";
import { isDesktopHost } from "../../platform";
import { showToast } from "../../ui/toasts";

interface TenantBarElements {
  bar: HTMLElement;
  select: HTMLSelectElement;
  signIn: HTMLButtonElement;
  signOut: HTMLButtonElement;
  status: HTMLElement;
}

/**
 * Desktop-only tenant switcher.
 *
 * The extension's session is whatever AlayaCare tab is active. The desktop
 * app has no tabs, so the user picks a configured environment here and signs
 * into it in a window owned by the app; every session-pathway command then
 * runs against that tenant's cookies.
 */
export class DesktopTenantBar {
  private state: DesktopSessionState = { activeOrigin: null, tenants: [] };

  constructor(private readonly onTenantChanged: () => void | Promise<void>) {}

  get enabled(): boolean {
    return isDesktopHost();
  }

  async init(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    const elements = this.elements();
    elements.bar.hidden = false;
    elements.select.addEventListener("change", () => void this.selectTenant(elements.select.value));
    elements.signIn.addEventListener("click", () => void this.signIn());
    elements.signOut.addEventListener("click", () => void this.signOut());
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    try {
      const response = await sendRuntimeMessage<DesktopSessionState>({
        type: "ac/popup/desktop/get-session-state"
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Unable to read tenant sessions.");
      }
      this.state = response.data;
    } catch (error) {
      this.state = { activeOrigin: null, tenants: [] };
      this.elements().status.textContent = formatError(error);
    }
    this.render();
  }

  private render(): void {
    const elements = this.elements();
    elements.select.replaceChildren(
      ...this.state.tenants.map((tenant) => {
        const option = document.createElement("option");
        option.value = tenant.origin;
        option.textContent = `${tenant.name} — ${tenant.origin}`;
        return option;
      })
    );
    if (this.state.tenants.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Add an environment in Environment Manager";
      elements.select.append(option);
    }
    elements.select.value = this.state.activeOrigin ?? "";
    const active = this.state.tenants.find((tenant) => tenant.origin === this.state.activeOrigin);
    elements.signIn.disabled = !active;
    elements.signOut.disabled = !active?.signedIn;
    elements.status.textContent = !active
      ? "No tenant selected."
      : active.signedIn
        ? `Signed in${active.currentUserName ? ` as ${active.currentUserName}` : ""}.`
        : "Not signed in. Session tools need a sign-in; API-key tools work without one.";
  }

  private async selectTenant(origin: string): Promise<void> {
    if (!origin) {
      return;
    }
    const response = await sendRuntimeMessage<DesktopSessionState>({
      type: "ac/popup/desktop/select-tenant",
      payload: { origin }
    });
    if (!response.ok || !response.data) {
      showToast("error", "Tenant not selected", response.error ?? "Unknown error");
      return;
    }
    this.state = response.data;
    this.render();
    await this.onTenantChanged();
  }

  private async signIn(): Promise<void> {
    const origin = this.state.activeOrigin;
    if (!origin) {
      return;
    }
    const elements = this.elements();
    elements.signIn.disabled = true;
    elements.status.textContent = "Complete the sign-in in the window that opened…";
    try {
      const response = await sendRuntimeMessage<DesktopSessionState>({
        type: "ac/popup/desktop/sign-in",
        payload: { origin }
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Sign-in did not complete.");
      }
      this.state = response.data;
      this.render();
      await this.onTenantChanged();
    } catch (error) {
      showToast("error", "Sign-in failed", formatError(error));
      this.render();
    }
  }

  private async signOut(): Promise<void> {
    const origin = this.state.activeOrigin;
    if (!origin) {
      return;
    }
    const response = await sendRuntimeMessage<DesktopSessionState>({
      type: "ac/popup/desktop/sign-out",
      payload: { origin }
    });
    if (!response.ok || !response.data) {
      showToast("error", "Sign-out failed", response.error ?? "Unknown error");
      return;
    }
    this.state = response.data;
    this.render();
    await this.onTenantChanged();
  }

  private elements(): TenantBarElements {
    return {
      bar: required("#desktop-tenant-bar"),
      select: required("#desktop-tenant-select"),
      signIn: required("#desktop-tenant-sign-in"),
      signOut: required("#desktop-tenant-sign-out"),
      status: required("#desktop-tenant-status")
    };
  }
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing tenant bar element: ${selector}`);
  }
  return element;
}
