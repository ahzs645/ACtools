export type ToastTone = "success" | "error" | "warning" | "info";

export function showToast(
  tone: ToastTone,
  title: string,
  message: string,
  duration = tone === "error" ? 8000 : 4500
): void {
  const region = document.querySelector<HTMLElement>("#toast-region");
  if (!region) {
    return;
  }
  const toast = document.createElement("div");
  toast.className = `toast toast--${tone}`;
  toast.setAttribute("role", tone === "error" ? "alert" : "status");
  const heading = document.createElement("strong");
  heading.textContent = title;
  const body = document.createElement("span");
  body.textContent = message;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast__close";
  close.setAttribute("aria-label", "Dismiss notification");
  close.textContent = "×";
  close.addEventListener("click", () => toast.remove());
  toast.append(heading, body, close);
  region.append(toast);
  if (duration > 0) {
    window.setTimeout(() => toast.remove(), duration);
  }
}
