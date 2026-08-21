function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Detail header element ${selector} is missing.`);
  }
  return element;
}

const titleElement = requireElement("#detail-title");
const subtitleElement = requireElement("#detail-subtitle");

export function setDetailHeader(title: string, subtitle: string): void {
  titleElement.textContent = title;
  subtitleElement.textContent = subtitle;
}

export function setDetailSubtitle(subtitle: string): void {
  subtitleElement.textContent = subtitle;
}
