import { formatError } from "../../shared/errors";
import { addMinutes, ceilTo15, floorTo15, formatHHMMInTimeZone, formatVisitDateTime, parseUtcRruleDate } from "../utils/time";
import { AlayaCareClient } from "../services/AlayaCareClient";

interface Department {
  id: number;
  name: string;
}

interface EmployeeRecord {
  id: number;
  first_name?: string;
  last_name?: string;
  _link?: string;
  alayacare_employee_id?: number;
}

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

interface VisitRecord {
  start_at?: string;
  end_at?: string;
  status?: string;
  alayacare_visit_id?: number;
  visit_id?: number;
  cancel_code?: {
    code?: string;
  };
  client?: {
    full_name?: string;
  };
  service?: {
    name?: string;
    service_code_name?: string;
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

export class DayViewOverlay {
  private readonly host: HTMLDivElement;
  private readonly shadowRoot: ShadowRoot;
  private readonly visitDetailsCache = new Map<string, VisitRecord>();
  private overlay: HTMLDivElement | null = null;
  private tooltip: HTMLDivElement | null = null;
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
        }

        *, *::before, *::after {
          box-sizing: border-box;
        }

        .overlay {
          position: fixed;
          inset: 0;
          z-index: 2147483646;
          display: flex;
          background: rgba(8, 18, 30, 0.2);
          font-family: Inter, "Segoe UI", sans-serif;
          color: #0f1720;
        }

        .panel {
          position: absolute;
          inset: 4% 4%;
          display: flex;
          flex-direction: column;
          min-height: 0;
          border-radius: 20px;
          background: #fcfdfd;
          border: 1px solid rgba(23, 74, 139, 0.18);
          box-shadow: 0 20px 60px rgba(15, 23, 32, 0.22);
          overflow: hidden;
        }

        .header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 20px;
          background: linear-gradient(135deg, #133b70, #215aa5 68%, #3c7fbe);
          color: #ffffff;
        }

        .header h1 {
          margin: 0 0 6px;
          font-size: 20px;
          line-height: 1.2;
        }

        .header p {
          margin: 0;
          max-width: 760px;
          font-size: 13px;
          line-height: 1.5;
          opacity: 0.88;
        }

        .close-button {
          border: none;
          border-radius: 999px;
          padding: 10px 14px;
          height: fit-content;
          cursor: pointer;
          background: rgba(255, 255, 255, 0.16);
          color: #ffffff;
          font-weight: 600;
        }

        .toolbar {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 20px;
          border-bottom: 1px solid #dbe4ec;
          background: #ffffff;
        }

        .toolbar label {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
          color: #35506e;
        }

        .toolbar input[type="date"] {
          min-width: 220px;
          border: 1px solid #bfcddd;
          border-radius: 10px;
          padding: 9px 10px;
          font: inherit;
        }

        .error-text {
          color: #b42318;
          font-size: 12px;
          font-weight: 600;
          white-space: pre-wrap;
        }

        .columns {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          padding: 16px 20px 20px;
          min-height: 0;
          flex: 1;
          overflow: auto;
          background:
            radial-gradient(circle at top right, rgba(33, 90, 165, 0.06), transparent 30%),
            linear-gradient(180deg, #f7fafc, #eef4f8);
        }

        .column {
          display: flex;
          flex-direction: column;
          min-height: 0;
          background: rgba(255, 255, 255, 0.92);
          border: 1px solid #d6e2ec;
          border-radius: 18px;
          overflow: hidden;
          box-shadow: 0 12px 32px rgba(14, 23, 32, 0.06);
        }

        .column-header {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 14px 16px;
          border-bottom: 1px solid #dbe4ec;
          background: #f9fbfd;
        }

        .column-header strong {
          font-size: 15px;
        }

        .column-header select {
          width: 100%;
          border: 1px solid #bfcddd;
          border-radius: 10px;
          padding: 8px 10px;
          font: inherit;
          background: #ffffff;
        }

        .employee-list {
          flex: 1;
          min-height: 0;
          overflow: auto;
          padding: 10px 12px 14px;
        }

        .employee-row {
          border: 1px solid #dbe4ec;
          border-radius: 14px;
          padding: 10px 12px;
          background: #ffffff;
        }

        .employee-row + .employee-row {
          margin-top: 10px;
        }

        .employee-header {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 600;
        }

        .employee-link {
          color: #174a8b;
          text-decoration: none;
        }

        .employee-link:hover {
          text-decoration: underline;
        }

        .employee-details {
          margin-top: 10px;
          border-top: 1px solid #e6eef5;
          padding-top: 10px;
        }

        .schedule-card {
          overflow: auto;
          border: 1px solid #dbe4ec;
          border-radius: 12px;
          background: #fbfdff;
        }

        .schedule-card strong {
          display: block;
          padding: 10px 12px 0;
          font-size: 12px;
          color: #35506e;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
        }

        thead th {
          position: sticky;
          top: 0;
          background: #eff5fb;
          z-index: 1;
          text-align: left;
          padding: 8px 10px;
          color: #35506e;
          border-bottom: 1px solid #dbe4ec;
        }

        tbody td {
          padding: 6px 10px;
          border-bottom: 1px solid #edf2f7;
          vertical-align: top;
        }

        tbody tr:nth-child(even) {
          background: #f8fbfd;
        }

        .visit-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          margin-right: 4px;
          border: 1px solid #aac1dc;
          border-radius: 999px;
          background: #e9f2ff;
          cursor: pointer;
          font-size: 11px;
        }

        .tooltip {
          position: fixed;
          z-index: 2147483647;
          min-width: 260px;
          max-width: 420px;
          padding: 10px 12px;
          border: 1px solid #9eb7d0;
          border-radius: 12px;
          background: #ffffff;
          box-shadow: 0 18px 42px rgba(15, 23, 32, 0.22);
          color: #102033;
          font-size: 12px;
          line-height: 1.45;
        }

        .tooltip-row + .tooltip-row {
          margin-top: 4px;
        }

        .tooltip-label {
          font-weight: 700;
          color: #35506e;
        }

        .muted {
          color: #63788e;
          font-size: 12px;
        }
      </style>
      <div class="overlay" hidden>
        <div class="panel">
          <div class="header">
            <div>
              <h1>Ramona Day View</h1>
              <p>Please choose a date to compare employees, shift placeholders, visits, availabilities, and unavailabilities.</p>
            </div>
            <button class="close-button" type="button">Close</button>
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
        void this.showVisitTooltip(String(visit.visitId), event);
      });
      icon.addEventListener("mousemove", (event) => {
        this.positionTooltip(event);
      });
      icon.addEventListener("mouseleave", () => {
        this.hideTooltip();
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
      this.tooltip.appendChild(tooltipRow("Client", buildVisitAnchor(data.client?.full_name ?? "Unknown client", visitId)));
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
    if (this.tooltip) {
      this.tooltip.hidden = true;
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

function buildVisitAnchor(fullName: string, visitId: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = `/#/scheduling/shift/edit/id/${encodeURIComponent(visitId)}/form_type/client?new_modal=true&force_dialog=true`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = fullName;
  link.style.color = "#174a8b";
  link.style.textDecoration = "underline";
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

