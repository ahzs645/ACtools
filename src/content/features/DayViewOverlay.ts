import { formatError } from "../../shared/errors";
import { addMinutes, ceilTo15, floorTo15, formatHHMMInTimeZone, formatVisitDateTime, parseUtcRruleDate } from "../utils/time";
import {
  AlayaCareClient,
  type Department,
  type EmployeeRecord,
  type VisitRecord
} from "../services/AlayaCareClient";

interface ScheduleOccurrence {
  occStart: Date;
  occEnd: Date;
  timeZone?: string | null;
  type?: string;
  visitId?: number | null;
  status?: string;
  cancelCode?: string;
}

interface ScheduleRecord {
  duration?: number;
  rrule?: string;
  time_off_type?: {
    name?: string;
  };
  availability_type?: {
    name?: string;
  };
}

const COLUMN_DEFINITIONS = [
  {
    title: "1st Compare Employee",
    status: "active",
    designation: "CHW",
    key: "col-1"
  },
  {
    title: "Shift Placeholder",
    status: "on_hold",
    designation: "SHIFT",
    key: "col-2"
  },
  {
    title: "2nd Compare Employee",
    status: "active",
    designation: "CHW",
    key: "col-3"
  }
] as const;

const TOOLTIP_HIDE_DELAY_MS = 150;

export class DayViewOverlay {
  private readonly host: HTMLDivElement;
  private readonly shadowRoot: ShadowRoot;
  private readonly visitDetailsCache = new Map<string, VisitRecord>();
  private overlay: HTMLDivElement | null = null;
  private tooltip: HTMLDivElement | null = null;
  private tooltipHideTimer: number | null = null;
  private departments: Department[] = [];
  private currentDate = "";
  private initialized = false;

  constructor(private readonly client: AlayaCareClient) {
    this.host = document.createElement("div");
    this.host.id = "ac-tools-overlay-root";
    this.shadowRoot = this.host.attachShadow({ mode: "open" });
    document.body.appendChild(this.host);
  }

  async open(): Promise<void> {
    await this.ensureInitialized();

    if (!this.overlay) {
      throw new Error("Overlay did not initialize.");
    }

    this.overlay.hidden = false;
  }

  close(): void {
    if (this.overlay) {
      this.overlay.hidden = true;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const context = await this.client.getUserContext();

    if (!context.status.ready) {
      throw new Error(context.status.reason ?? "Page is not ready.");
    }

    this.departments = context.departments;
    this.renderShell();
    this.initialized = true;
  }

  private renderShell(): void {
    this.shadowRoot.innerHTML = `
      <style>
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
          padding: 1px 8px;
          border-radius: var(--ac-radius-small);
          color: var(--ac-brand-fg-1);
          text-decoration: underline;
          font-weight: 600;
        }

        .tooltip-link--scheduled,
        .tooltip-link--pending,
        .tooltip-link--booked {
          background: #ebf3fc;
          color: #115ea3;
        }

        .tooltip-link--confirmed,
        .tooltip-link--accepted {
          background: #cfe4fa;
          color: #0c3b5e;
        }

        .tooltip-link--in-progress,
        .tooltip-link--in-route,
        .tooltip-link--clocked-in,
        .tooltip-link--started {
          background: #f3e8ff;
          color: #5c2e91;
        }

        .tooltip-link--completed,
        .tooltip-link--complete,
        .tooltip-link--done,
        .tooltip-link--clocked-out {
          background: #dff6dd;
          color: #0e700e;
        }

        .tooltip-link--cancelled,
        .tooltip-link--canceled,
        .tooltip-link--declined,
        .tooltip-link--rejected {
          background: #fde7e9;
          color: #b10e1c;
        }

        .tooltip-link--no-show,
        .tooltip-link--missed,
        .tooltip-link--late {
          background: #fff4ce;
          color: #835b00;
        }

        @media (prefers-color-scheme: dark) {
          .tooltip-link--scheduled,
          .tooltip-link--pending,
          .tooltip-link--booked {
            background: #082338;
            color: #62abf5;
          }

          .tooltip-link--confirmed,
          .tooltip-link--accepted {
            background: #0c3b5e;
            color: #9bc7f0;
          }

          .tooltip-link--in-progress,
          .tooltip-link--in-route,
          .tooltip-link--clocked-in,
          .tooltip-link--started {
            background: #2b1a47;
            color: #c3a5e8;
          }

          .tooltip-link--completed,
          .tooltip-link--complete,
          .tooltip-link--done,
          .tooltip-link--clocked-out {
            background: #052505;
            color: #54b054;
          }

          .tooltip-link--cancelled,
          .tooltip-link--canceled,
          .tooltip-link--declined,
          .tooltip-link--rejected {
            background: #3b1a1d;
            color: #f1707b;
          }

          .tooltip-link--no-show,
          .tooltip-link--missed,
          .tooltip-link--late {
            background: #3d2e00;
            color: #fce100;
          }
        }
      </style>
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

    this.overlay = this.shadowRoot.querySelector(".overlay");
    this.tooltip = this.shadowRoot.querySelector(".tooltip");

    const closeButton = this.shadowRoot.querySelector(".close-button");
    const dateInput = this.shadowRoot.querySelector(".date-input");

    if (!(this.overlay instanceof HTMLDivElement) || !(this.tooltip instanceof HTMLDivElement)) {
      throw new Error("Failed to create overlay shell.");
    }

    this.overlay.addEventListener("click", (event) => {
      if (event.target === this.overlay) {
        this.close();
      }
    });

    if (closeButton instanceof HTMLButtonElement) {
      closeButton.addEventListener("click", () => this.close());
    }

    this.tooltip.addEventListener("mouseenter", () => {
      this.cancelHideTooltip();
    });
    this.tooltip.addEventListener("mouseleave", () => {
      this.scheduleHideTooltip();
    });

    if (dateInput instanceof HTMLInputElement) {
      dateInput.value = new Date().toISOString().slice(0, 10);
      this.currentDate = dateInput.value;
      dateInput.addEventListener("change", () => {
        this.currentDate = dateInput.value;
        void this.renderColumns();
      });
    }

    void this.renderColumns();
  }

  private async renderColumns(): Promise<void> {
    const columns = this.shadowRoot.querySelector(".columns");
    if (!(columns instanceof HTMLDivElement)) {
      return;
    }

    columns.innerHTML = "";
    this.setError("");

    if (!this.currentDate) {
      return;
    }

    if (this.departments.length === 0) {
      columns.innerHTML = `<div class="muted">No departments were returned for the current user.</div>`;
      return;
    }

    for (const definition of COLUMN_DEFINITIONS) {
      columns.appendChild(this.createColumn(definition.title, definition.status, definition.designation, definition.key));
    }
  }

  private createColumn(title: string, status: string, designation: string, key: string): HTMLElement {
    const column = document.createElement("section");
    column.className = "column";
    column.innerHTML = `
      <div class="column-header">
        <strong>${title}</strong>
        <select></select>
      </div>
      <div class="employee-list"></div>
    `;

    const select = column.querySelector("select");
    const list = column.querySelector(".employee-list");

    if (!(select instanceof HTMLSelectElement) || !(list instanceof HTMLDivElement)) {
      return column;
    }

    for (const department of this.departments) {
      select.appendChild(new Option(department.name, String(department.id)));
    }

    select.value = String(this.departments[0].id);
    void this.loadEmployees(list, select.value, status, designation, key);

    select.addEventListener("change", () => {
      void this.loadEmployees(list, select.value, status, designation, key);
    });

    return column;
  }

  private async loadEmployees(
    container: HTMLDivElement,
    departmentId: string,
    status: string,
    designation: string,
    key: string
  ): Promise<void> {
    container.innerHTML = `<div class="muted">Loading employees...</div>`;

    try {
      const employees = await this.client.getEmployees(departmentId, status, designation);

      if (employees.length === 0) {
        container.innerHTML = `<div class="muted">No employees found.</div>`;
        return;
      }

      container.innerHTML = "";

      for (const employee of employees) {
        container.appendChild(this.createEmployeeRow(container, employee, key));
      }
    } catch (error) {
      container.innerHTML = `<div class="muted">${formatError(error)}</div>`;
    }
  }

  private createEmployeeRow(container: HTMLDivElement, employee: EmployeeRecord, key: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "employee-row";

    const employeeIdFromLink = employee._link?.split("/").pop();
    const scheduleHref = employeeIdFromLink
      ? employee._link?.replace(/#\/.*/, `#/employees/${employeeIdFromLink}/schedule`)
      : employee._link ?? "#";
    const name = `${employee.last_name ?? ""}, ${employee.first_name ?? ""}`.replace(/^,\s*/, "");

    row.innerHTML = `
      <div class="employee-header">
        <input type="radio" name="employee-${key}" />
        <a class="employee-link" href="${scheduleHref}" target="_blank" rel="noreferrer">${name || "Unknown employee"}</a>
      </div>
      <div class="employee-details" hidden></div>
    `;

    const radio = row.querySelector("input");
    const details = row.querySelector(".employee-details");

    if (radio instanceof HTMLInputElement && details instanceof HTMLDivElement) {
      radio.addEventListener("change", () => {
        container.prepend(row);
        void this.loadEmployeeDetails(employee, details);
      });
    }

    return row;
  }

  private async loadEmployeeDetails(employee: EmployeeRecord, details: HTMLDivElement): Promise<void> {
    details.hidden = false;
    details.innerHTML = `
      <div class="schedule-card">
        <strong>Schedule Mix</strong>
        <table>
          <thead>
            <tr>
              <th>Start</th>
              <th>End</th>
              <th>Visits</th>
              <th>Avail</th>
              <th>Unavail</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colspan="5" class="muted">Loading schedule...</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    const tbody = details.querySelector("tbody");
    if (!(tbody instanceof HTMLTableSectionElement)) {
      return;
    }

    try {
      const schedule = await this.client.getSchedule(
        employee.id,
        employee.alayacare_employee_id ?? employee.id,
        this.currentDate
      );

      const availabilities = schedule.availabilities
        .map((item) => getDailyOccurrenceForDate(item, this.currentDate))
        .filter(Boolean) as ScheduleOccurrence[];
      const unavailabilities = schedule.unavailabilities
        .map((item) => getDailyOccurrenceForDate(item, this.currentDate))
        .filter(Boolean) as ScheduleOccurrence[];
      const visits = schedule.visits
        .map((item) => getVisitOccurrenceForDate(item, this.currentDate))
        .filter(Boolean) as ScheduleOccurrence[];

      const allOccurrences = [...availabilities, ...unavailabilities, ...visits];

      if (allOccurrences.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" class="muted">No visits, availabilities, or unavailabilities for this date.</td>
          </tr>
        `;
        return;
      }

      const minStart = new Date(Math.min(...allOccurrences.map((item) => item.occStart.getTime())));
      const maxEnd = new Date(Math.max(...allOccurrences.map((item) => item.occEnd.getTime())));
      const windowStart = floorTo15(addMinutes(minStart, -30));
      const windowEnd = ceilTo15(addMinutes(maxEnd, 30));
      const slots = generate15MinuteSlots(windowStart, windowEnd);

      tbody.innerHTML = "";

      for (const slotStart of slots) {
        const slotEnd = addMinutes(slotStart, 15);
        const row = document.createElement("tr");

        const timeZone =
          allOccurrences.find((item) => item.timeZone)?.timeZone ??
          Intl.DateTimeFormat().resolvedOptions().timeZone;

        row.appendChild(cell(formatHHMMInTimeZone(slotStart, timeZone)));
        row.appendChild(cell(formatHHMMInTimeZone(slotEnd, timeZone)));
        row.appendChild(this.buildVisitsCell(visits, slotStart, slotEnd));
        row.appendChild(cell(textForSlot(availabilities, slotStart, slotEnd)));
        row.appendChild(cell(textForSlot(unavailabilities, slotStart, slotEnd)));
        tbody.appendChild(row);
      }
    } catch (error) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="muted">${formatError(error)}</td>
        </tr>
      `;
    }
  }

  private buildVisitsCell(visits: ScheduleOccurrence[], slotStart: Date, slotEnd: Date): HTMLTableCellElement {
    const visitMap = new Map<number, ScheduleOccurrence>();

    for (const visit of visits) {
      if (visit.occStart < slotEnd && visit.occEnd > slotStart && visit.visitId) {
        visitMap.set(visit.visitId, visit);
      }
    }

    const visitsCell = document.createElement("td");

    for (const visit of visitMap.values()) {
      const icon = document.createElement("button");
      icon.type = "button";
      icon.className = "visit-icon";
      icon.textContent = "🕐";
      icon.title = [visit.status, visit.cancelCode].filter(Boolean).join(" - ") || "Visit";
      icon.addEventListener("mouseenter", (event) => {
        this.cancelHideTooltip();
        void this.showVisitTooltip(String(visit.visitId), event);
      });
      icon.addEventListener("mousemove", (event) => {
        this.positionTooltip(event);
      });
      icon.addEventListener("mouseleave", () => {
        this.scheduleHideTooltip();
      });
      visitsCell.appendChild(icon);
    }

    return visitsCell;
  }

  private async showVisitTooltip(visitId: string, event: MouseEvent): Promise<void> {
    if (!(this.tooltip instanceof HTMLDivElement)) {
      return;
    }

    this.positionTooltip(event);
    this.tooltip.hidden = false;
    this.tooltip.innerHTML = `<div class="tooltip-row">Loading visit ${visitId}...</div>`;

    try {
      const data = await this.getVisitDetails(visitId);
      this.tooltip.innerHTML = "";
      this.tooltip.appendChild(
        tooltipRow(
          "Client",
          buildVisitAnchor(data.client?.full_name ?? "Unknown client", visitId, data.status ?? "")
        )
      );
      this.tooltip.appendChild(tooltipRow("Start", document.createTextNode(formatVisitDateTime(data.start_at ?? ""))));
      this.tooltip.appendChild(tooltipRow("Status", document.createTextNode(data.status ?? "")));
      this.tooltip.appendChild(tooltipRow("Service", document.createTextNode(data.service?.name ?? "")));
      this.tooltip.appendChild(tooltipRow("Code", document.createTextNode(data.service?.service_code_name ?? "")));
    } catch (error) {
      this.tooltip.innerHTML = `<div class="tooltip-row">${formatError(error)}</div>`;
    }
  }

  private positionTooltip(event: MouseEvent): void {
    if (!(this.tooltip instanceof HTMLDivElement)) {
      return;
    }

    const pad = 12;
    const width = this.tooltip.offsetWidth || 320;
    const height = this.tooltip.offsetHeight || 120;
    let left = event.clientX + pad;
    let top = event.clientY + pad;

    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, event.clientX - width - pad);
    }

    if (top + height > window.innerHeight - 12) {
      top = Math.max(12, event.clientY - height - pad);
    }

    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  private hideTooltip(): void {
    this.cancelHideTooltip();
    if (this.tooltip) {
      this.tooltip.hidden = true;
    }
  }

  private scheduleHideTooltip(): void {
    this.cancelHideTooltip();
    this.tooltipHideTimer = window.setTimeout(() => {
      this.tooltipHideTimer = null;
      if (this.tooltip) {
        this.tooltip.hidden = true;
      }
    }, TOOLTIP_HIDE_DELAY_MS);
  }

  private cancelHideTooltip(): void {
    if (this.tooltipHideTimer !== null) {
      window.clearTimeout(this.tooltipHideTimer);
      this.tooltipHideTimer = null;
    }
  }

  private async getVisitDetails(visitId: string): Promise<VisitRecord> {
    const cached = this.visitDetailsCache.get(visitId);
    if (cached) {
      return cached;
    }

    const record = await this.client.getVisitDetails(visitId);
    this.visitDetailsCache.set(visitId, record);
    return record;
  }

  private setError(message: string): void {
    const errorElement = this.shadowRoot.querySelector(".error-text");

    if (!(errorElement instanceof HTMLDivElement)) {
      return;
    }

    errorElement.textContent = message;
    errorElement.hidden = message.length === 0;
  }
}

function cell(value: string): HTMLTableCellElement {
  const output = document.createElement("td");
  output.textContent = value;
  return output;
}

function tooltipRow(label: string, value: Node): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "tooltip-row";

  const labelElement = document.createElement("span");
  labelElement.className = "tooltip-label";
  labelElement.textContent = `${label}: `;
  row.append(labelElement, value);
  return row;
}

function buildVisitAnchor(fullName: string, visitId: string, status: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = `/#/scheduling/shift/edit/id/${encodeURIComponent(visitId)}/form_type/client?new_modal=true&force_dialog=true`;
  link.target = "_blank";
  link.rel = "noreferrer";
  const normalized = status.trim().toLowerCase().replace(/[\s_]+/g, "-");
  link.className = normalized
    ? `tooltip-link tooltip-link--${normalized}`
    : "tooltip-link";
  link.textContent = fullName;
  return link;
}

function generate15MinuteSlots(start: Date, end: Date): Date[] {
  const slots: Date[] = [];
  let cursor = new Date(start.getTime());

  while (cursor < end) {
    slots.push(new Date(cursor.getTime()));
    cursor = addMinutes(cursor, 15);
  }

  return slots;
}

function textForSlot(occurrences: ScheduleOccurrence[], slotStart: Date, slotEnd: Date): string {
  const values = new Set<string>();

  for (const occurrence of occurrences) {
    if (occurrence.occStart < slotEnd && occurrence.occEnd > slotStart && occurrence.type) {
      values.add(occurrence.type);
    }
  }

  return Array.from(values).join(" / ");
}

function getDailyOccurrenceForDate(item: ScheduleRecord, targetDate: string): ScheduleOccurrence | null {
  const rrule = item.rrule;
  if (!rrule || !targetDate) {
    return null;
  }

  const parts = Object.fromEntries(rrule.split(";").map((part) => part.split("=")));
  if (parts.FREQ !== "DAILY" || !parts.DTSTART) {
    return null;
  }

  const intervalDays = Number.parseInt(parts.INTERVAL ?? "1", 10);
  const stepMs = intervalDays * 24 * 60 * 60 * 1000;
  const dtStart = parseUtcRruleDate(parts.DTSTART);
  const untilStart = parseUtcRruleDate(parts.UNTIL);

  if (!dtStart) {
    return null;
  }

  const dayStart = new Date(`${targetDate}T00:00:00`);
  const dayEnd = new Date(`${targetDate}T23:59:59.999`);
  const diffToEnd = dayEnd.getTime() - dtStart.getTime();

  if (diffToEnd < 0) {
    return null;
  }

  const kMax = Math.floor(diffToEnd / stepMs);
  const durationMs = getDurationMs(item, parts);

  for (let index = Math.max(0, kMax - 1); index <= kMax; index += 1) {
    const occStart = new Date(dtStart.getTime() + index * stepMs);

    if (untilStart && occStart > untilStart) {
      continue;
    }

    const occEnd = new Date(occStart.getTime() + durationMs);

    if (occStart <= dayEnd && occEnd >= dayStart) {
      return {
        occStart,
        occEnd,
        timeZone: parts.TIMEZONE ?? null,
        type: item.time_off_type?.name ?? item.availability_type?.name ?? "None"
      };
    }
  }

  return null;
}

function getVisitOccurrenceForDate(item: VisitRecord, targetDate: string): ScheduleOccurrence | null {
  const startAt = item.start_at ? new Date(item.start_at) : null;
  const endAt = item.end_at ? new Date(item.end_at) : null;

  if (!startAt || !endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return null;
  }

  const dayStart = new Date(`${targetDate}T00:00:00`);
  const dayEnd = new Date(`${targetDate}T23:59:59.999`);

  if (startAt > dayEnd || endAt < dayStart) {
    return null;
  }

  return {
    occStart: startAt,
    occEnd: endAt,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    visitId: item.alayacare_visit_id ?? item.visit_id ?? null,
    status: item.status ?? "",
    cancelCode: item.cancel_code?.code ?? ""
  };
}

function getDurationMs(item: ScheduleRecord, parts: Record<string, string>): number {
  const durationMinutes = Number(item.duration);
  if (!Number.isNaN(durationMinutes) && durationMinutes > 0) {
    return durationMinutes * 60_000;
  }

  if (!parts.DTSTART || !parts.UNTIL || !parts.DTSTART.includes("T") || !parts.UNTIL.includes("T")) {
    return 0;
  }

  const startHour = Number.parseInt(parts.DTSTART.slice(9, 11), 10);
  const startMinute = Number.parseInt(parts.DTSTART.slice(11, 13), 10);
  const endHour = Number.parseInt(parts.UNTIL.slice(9, 11), 10);
  const endMinute = Number.parseInt(parts.UNTIL.slice(11, 13), 10);

  const startTotalMinutes = startHour * 60 + startMinute;
  let endTotalMinutes = endHour * 60 + endMinute;

  if (endTotalMinutes <= startTotalMinutes) {
    endTotalMinutes += 24 * 60;
  }

  return (endTotalMinutes - startTotalMinutes) * 60_000;
}
