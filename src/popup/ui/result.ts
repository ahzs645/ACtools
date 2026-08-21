import { formatError } from "../../shared/errors";
import { showToast } from "./toasts";

const DEFAULT_MESSAGE = "Ready.";
const WORKING_MESSAGE = "Working…";

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Result element ${selector} is missing.`);
  }
  return element;
}

const container = requireElement("#result-container");
const label = requireElement("#result-label");
const output = requireElement("#result-text");

/**
 * Results are kept per section so switching tools never shows the previous
 * tool's output. A section that renders its own result block hides this one.
 */
const messages = new Map<string, string>();
let activeScope: string | null = null;

export function showResultScope(scope: string, sectionLabel: string): void {
  activeScope = scope;
  label.textContent = sectionLabel ? `Result · ${sectionLabel}` : "Result";
  output.textContent = messages.get(scope) ?? DEFAULT_MESSAGE;
  container.hidden = false;
}

export function hideResultScope(): void {
  activeScope = null;
  container.hidden = true;
}

export function setResult(message: string): void {
  if (activeScope) {
    messages.set(activeScope, message);
  }
  output.textContent = message;
}

export function resetResult(): void {
  setResult(DEFAULT_MESSAGE);
}

export function setResultWorking(): void {
  setResult(WORKING_MESSAGE);
}

export async function withResult(action: () => Promise<string>): Promise<void> {
  setResultWorking();

  try {
    const message = await action();
    setResult(message);
    showToast("success", "Completed", message.length > 240 ? `${message.slice(0, 237)}…` : message);
  } catch (error) {
    const message = formatError(error);
    setResult(message);
    showToast("error", "Action failed", message);
  }
}
