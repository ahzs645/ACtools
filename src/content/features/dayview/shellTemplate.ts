export const SHADOW_STYLES = `
  :host {
    all: initial;

    --ac-font-family: "Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;

    --ac-radius-small: 2px;
    --ac-radius-medium: 4px;
    --ac-radius-large: 6px;
    --ac-radius-xlarge: 8px;
    --ac-radius-circular: 9999px;

    --ac-bg-canvas: #f5f5f5;
    --ac-bg-1: #ffffff;
    --ac-bg-1-hover: #f5f5f5;
    --ac-bg-1-pressed: #e0e0e0;
    --ac-bg-2: #fafafa;
    --ac-bg-3: #f0f0f0;

    --ac-fg-1: #242424;
    --ac-fg-2: #424242;
    --ac-fg-3: #616161;
    --ac-fg-4: #707070;

    --ac-stroke-1: #d1d1d1;
    --ac-stroke-2: #e0e0e0;
    --ac-stroke-subtle: #ebebeb;
    --ac-stroke-accessible: #616161;

    --ac-brand-bg: #0f6cbd;
    --ac-brand-bg-hover: #115ea3;
    --ac-brand-bg-pressed: #0c3b5e;
    --ac-brand-bg-2: #ebf3fc;
    --ac-brand-bg-2-hover: #cfe4fa;
    --ac-brand-fg-1: #0f6cbd;
    --ac-brand-stroke-1: #0f6cbd;

    --ac-danger-bg: #fde7e9;
    --ac-danger-fg: #b10e1c;
    --ac-danger-stroke: #b10e1c;

    --ac-shadow-2: 0 0 2px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.14);
    --ac-shadow-4: 0 0 2px rgba(0, 0, 0, 0.12), 0 2px 4px rgba(0, 0, 0, 0.14);
    --ac-shadow-16: 0 0 2px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.14);
    --ac-shadow-28: 0 0 8px rgba(0, 0, 0, 0.12), 0 14px 28px rgba(0, 0, 0, 0.24);
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --ac-bg-canvas: #141414;
      --ac-bg-1: #292929;
      --ac-bg-1-hover: #3d3d3d;
      --ac-bg-1-pressed: #1f1f1f;
      --ac-bg-2: #1f1f1f;
      --ac-bg-3: #333333;

      --ac-fg-1: #ffffff;
      --ac-fg-2: #d6d6d6;
      --ac-fg-3: #adadad;
      --ac-fg-4: #757575;

      --ac-stroke-1: #666666;
      --ac-stroke-2: #525252;
      --ac-stroke-subtle: #3d3d3d;
      --ac-stroke-accessible: #adadad;

      --ac-brand-bg: #115ea3;
      --ac-brand-bg-hover: #2886de;
      --ac-brand-bg-pressed: #0c3b5e;
      --ac-brand-bg-2: #082338;
      --ac-brand-bg-2-hover: #0c3b5e;
      --ac-brand-fg-1: #479ef5;
      --ac-brand-stroke-1: #479ef5;

      --ac-danger-bg: #3b1a1d;
      --ac-danger-fg: #f1707b;
      --ac-danger-stroke: #f1707b;

      --ac-shadow-2: 0 0 2px rgba(0, 0, 0, 0.24), 0 1px 2px rgba(0, 0, 0, 0.28);
      --ac-shadow-4: 0 0 2px rgba(0, 0, 0, 0.24), 0 2px 4px rgba(0, 0, 0, 0.28);
      --ac-shadow-16: 0 0 2px rgba(0, 0, 0, 0.24), 0 8px 16px rgba(0, 0, 0, 0.28);
      --ac-shadow-28: 0 0 8px rgba(0, 0, 0, 0.24), 0 14px 28px rgba(0, 0, 0, 0.4);
    }
  }

  *, *::before, *::after {
    box-sizing: border-box;
  }

  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    display: flex;
    background: rgba(0, 0, 0, 0.4);
    font-family: var(--ac-font-family);
    color: var(--ac-fg-1);
    font-size: 14px;
    line-height: 20px;
  }

  .overlay[hidden] {
    display: none;
  }

  .panel {
    position: absolute;
    inset: 4% 4%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-radius: var(--ac-radius-xlarge);
    background: var(--ac-bg-canvas);
    border: 1px solid var(--ac-stroke-subtle);
    box-shadow: var(--ac-shadow-28);
    overflow: hidden;
  }

  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 20px;
    background: var(--ac-bg-1);
    border-bottom: 1px solid var(--ac-stroke-subtle);
  }

  .header__brand {
    display: flex;
    align-items: stretch;
    gap: 12px;
    min-width: 0;
  }

  .header__accent {
    width: 4px;
    align-self: stretch;
    border-radius: var(--ac-radius-small);
    background: var(--ac-brand-bg);
  }

  .header__text {
    min-width: 0;
  }

  .header__text h1 {
    margin: 0 0 4px;
    font-size: 20px;
    line-height: 28px;
    font-weight: 600;
    color: var(--ac-fg-1);
  }

  .header__text p {
    margin: 0;
    max-width: 760px;
    font-size: 12px;
    line-height: 16px;
    color: var(--ac-fg-3);
  }

  .close-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--ac-radius-medium);
    background-color: transparent;
    color: var(--ac-fg-2);
    cursor: pointer;
    font: inherit;
    transition: background-color 100ms cubic-bezier(0.33, 0, 0.67, 1);
    flex-shrink: 0;
  }

  .close-button:hover {
    background-color: var(--ac-bg-1-hover);
    color: var(--ac-fg-1);
  }

  .close-button:focus-visible {
    outline: 2px solid var(--ac-brand-stroke-1);
    outline-offset: 1px;
  }

  .close-button svg {
    width: 16px;
    height: 16px;
  }

  .toolbar {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 16px;
    padding: 12px 20px;
    background: var(--ac-bg-1);
    border-bottom: 1px solid var(--ac-stroke-subtle);
  }

  .toolbar label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ac-fg-1);
  }

  .toolbar input[type="date"] {
    min-width: 220px;
    height: 32px;
    border: 1px solid var(--ac-stroke-1);
    border-bottom-color: var(--ac-stroke-accessible);
    border-radius: var(--ac-radius-medium);
    padding: 0 12px;
    font: inherit;
    font-size: 14px;
    color: var(--ac-fg-1);
    background: var(--ac-bg-1);
    color-scheme: light dark;
  }

  .toolbar input[type="date"]:focus {
    outline: none;
    border-color: var(--ac-brand-stroke-1);
    border-bottom-width: 2px;
    padding-bottom: 0;
  }

  .toolbar .muted {
    flex: 1;
    min-width: 200px;
  }

  .muted {
    color: var(--ac-fg-3);
    font-size: 12px;
    line-height: 16px;
  }

  .error-text {
    color: var(--ac-danger-fg);
    background: var(--ac-danger-bg);
    border: 1px solid var(--ac-danger-stroke);
    border-radius: var(--ac-radius-medium);
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 600;
    white-space: pre-wrap;
  }

  .columns {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    padding: 16px 20px 20px;
    min-height: 0;
    flex: 1;
    overflow: auto;
    background: var(--ac-bg-canvas);
  }

  .column {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--ac-bg-1);
    border: 1px solid var(--ac-stroke-subtle);
    border-radius: var(--ac-radius-large);
    overflow: hidden;
    box-shadow: var(--ac-shadow-2);
  }

  .column-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--ac-stroke-subtle);
    background: var(--ac-bg-2);
  }

  .column-header strong {
    font-size: 14px;
    line-height: 20px;
    font-weight: 600;
    color: var(--ac-fg-1);
  }

  .column-header select {
    width: 100%;
    height: 32px;
    border: 1px solid var(--ac-stroke-1);
    border-bottom-color: var(--ac-stroke-accessible);
    border-radius: var(--ac-radius-medium);
    padding: 0 8px;
    font: inherit;
    font-size: 14px;
    background: var(--ac-bg-1);
    color: var(--ac-fg-1);
  }

  .column-header select:focus {
    outline: none;
    border-color: var(--ac-brand-stroke-1);
    border-bottom-width: 2px;
  }

  .employee-list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px;
  }

  .employee-row {
    border: 1px solid var(--ac-stroke-subtle);
    border-radius: var(--ac-radius-medium);
    padding: 8px 12px;
    background: var(--ac-bg-1);
    transition: background-color 100ms cubic-bezier(0.33, 0, 0.67, 1),
      border-color 100ms cubic-bezier(0.33, 0, 0.67, 1);
  }

  .employee-row:hover {
    background: var(--ac-bg-1-hover);
    border-color: var(--ac-stroke-1);
  }

  .employee-row + .employee-row {
    margin-top: 6px;
  }

  .employee-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
  }

  .employee-header input[type="radio"] {
    accent-color: var(--ac-brand-bg);
  }

  .employee-link {
    color: var(--ac-brand-fg-1);
    text-decoration: none;
  }

  .employee-link:hover {
    text-decoration: underline;
  }

  .employee-details {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--ac-stroke-subtle);
  }

  .schedule-card {
    overflow: auto;
    border: 1px solid var(--ac-stroke-subtle);
    border-radius: var(--ac-radius-medium);
    background: var(--ac-bg-2);
  }

  .schedule-card strong {
    display: block;
    padding: 8px 12px 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--ac-fg-3);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  thead th {
    position: sticky;
    top: 0;
    background: var(--ac-bg-1);
    z-index: 1;
    text-align: left;
    padding: 8px 10px;
    color: var(--ac-fg-3);
    font-weight: 600;
    border-bottom: 1px solid var(--ac-stroke-subtle);
  }

  tbody td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--ac-stroke-subtle);
    vertical-align: top;
    color: var(--ac-fg-2);
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  .visit-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    margin-right: 4px;
    border: 1px solid var(--ac-brand-stroke-1);
    border-radius: var(--ac-radius-circular);
    background: var(--ac-brand-bg-2);
    color: var(--ac-brand-fg-1);
    cursor: pointer;
    font-size: 11px;
    transition: background-color 100ms cubic-bezier(0.33, 0, 0.67, 1);
  }

  .visit-icon:hover {
    background: var(--ac-brand-bg-2-hover);
  }

  .tooltip {
    position: fixed;
    z-index: 2147483647;
    min-width: 260px;
    max-width: 420px;
    padding: 12px 14px;
    border: 1px solid var(--ac-stroke-1);
    border-radius: var(--ac-radius-large);
    background: var(--ac-bg-1);
    box-shadow: var(--ac-shadow-16);
    color: var(--ac-fg-1);
    font-family: var(--ac-font-family);
    font-size: 12px;
    line-height: 16px;
  }

  .tooltip-row + .tooltip-row {
    margin-top: 4px;
  }

  .tooltip-label {
    font-weight: 600;
    color: var(--ac-fg-3);
  }

  .tooltip-link {
    display: inline-block;
    padding: 2px 8px;
    border-radius: var(--ac-radius-small);
    color: var(--ac-brand-fg-1);
    text-decoration: none;
    font-weight: 600;
  }

  .tooltip-link:hover {
    text-decoration: underline;
  }

  .tooltip-link--vacant {
    background: #b90303;
    color: #ffffff;
  }

  .tooltip-link--on-hold {
    background: #9fa9b7;
    color: #ffffff;
  }

  .tooltip-link--cancelled,
  .tooltip-link--canceled {
    background: #797979;
    color: #ffffff;
  }

  .tooltip-link--offered {
    background: #ee6004;
    color: #ffffff;
  }

  .tooltip-link--scheduled {
    background: #4292b6;
    color: #ffffff;
  }

  .tooltip-link--clocked {
    background: #84b840;
    color: #ffffff;
  }

  .tooltip-link--late {
    background: #6543b3;
    color: #ffffff;
  }

  .tooltip-link--completed {
    background: #162a62;
    color: #ffffff;
  }

  .tooltip-link--missed {
    background: #f5a623;
    color: #ffffff;
  }

  .tooltip-link--approved {
    background: #386238;
    color: #ffffff;
  }
`;

export const SHADOW_HTML = `
  <div class="overlay" hidden>
    <div class="panel">
      <div class="header">
        <div class="header__brand">
          <span class="header__accent" aria-hidden="true"></span>
          <div class="header__text">
            <h1>Day View</h1>
            <p>Please choose a date to compare employees, shift placeholders, visits, availabilities, and unavailabilities.</p>
          </div>
        </div>
        <button class="close-button" type="button" aria-label="Close" title="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 6l12 12" />
            <path d="M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div class="toolbar">
        <label>
          Compare date
          <input class="date-input" type="date" />
        </label>
        <div class="error-text" hidden></div>
      </div>
      <div class="columns"></div>
    </div>
  </div>
  <div class="tooltip" hidden></div>
`;

export const SHADOW_TEMPLATE = `<style>${SHADOW_STYLES}</style>${SHADOW_HTML}`;
