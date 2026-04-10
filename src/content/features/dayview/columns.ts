import { formatError } from "../../../shared/errors";
import { addMinutes, ceilTo15, floorTo15, formatHHMMInTimeZone } from "../../utils/time";
import type { AlayaCareClient, Department, EmployeeRecord } from "../../services/AlayaCareClient";
import {
  cell,
  generate15MinuteSlots,
  getDailyOccurrenceForDate,
  getVisitOccurrenceForDate,
  textForSlot,
  type ScheduleOccurrence
} from "./scheduleMath";
import type { VisitTooltip } from "./VisitTooltip";

export interface ColumnContext {
  columnsContainer: HTMLDivElement;
  departments: Department[];
  client: AlayaCareClient;
  tooltip: VisitTooltip;
  getDate: () => string;
  setError: (message: string) => void;
}

interface ColumnDefinition {
  readonly title: string;
  readonly status: string;
  readonly designation: string;
  readonly key: string;
}

const COLUMN_DEFINITIONS: readonly ColumnDefinition[] = [
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
];

export function renderColumns(ctx: ColumnContext): void {
  ctx.columnsContainer.innerHTML = "";
  ctx.setError("");

  if (!ctx.getDate()) {
    return;
  }

  if (ctx.departments.length === 0) {
    ctx.columnsContainer.innerHTML = `<div class="muted">No departments were returned for the current user.</div>`;
    return;
  }

  for (const definition of COLUMN_DEFINITIONS) {
    ctx.columnsContainer.appendChild(createColumn(ctx, definition));
  }
}

function createColumn(ctx: ColumnContext, definition: ColumnDefinition): HTMLElement {
  const column = document.createElement("section");
  column.className = "column";
  column.innerHTML = `
    <div class="column-header">
      <strong></strong>
      <select></select>
    </div>
    <div class="employee-list"></div>
  `;

  const titleElement = column.querySelector("strong");
  const select = column.querySelector("select");
  const list = column.querySelector(".employee-list");

  if (titleElement) {
    titleElement.textContent = definition.title;
  }

  if (!(select instanceof HTMLSelectElement) || !(list instanceof HTMLDivElement)) {
    return column;
  }

  for (const department of ctx.departments) {
    select.appendChild(new Option(department.name, String(department.id)));
  }

  select.value = String(ctx.departments[0].id);
  void loadEmployees(ctx, list, select.value, definition);

  select.addEventListener("change", () => {
    void loadEmployees(ctx, list, select.value, definition);
  });

  return column;
}

async function loadEmployees(
  ctx: ColumnContext,
  container: HTMLDivElement,
  departmentId: string,
  definition: ColumnDefinition
): Promise<void> {
  container.innerHTML = `<div class="muted">Loading employees\u2026</div>`;

  try {
    const employees = await ctx.client.getEmployees(
      departmentId,
      definition.status,
      definition.designation
    );

    if (employees.length === 0) {
      container.innerHTML = `<div class="muted">No employees found.</div>`;
      return;
    }

    container.innerHTML = "";

    for (const employee of employees) {
      container.appendChild(createEmployeeRow(ctx, container, employee, definition.key));
    }
  } catch (error) {
    container.innerHTML = `<div class="muted">${formatError(error)}</div>`;
  }
}

function createEmployeeRow(
  ctx: ColumnContext,
  container: HTMLDivElement,
  employee: EmployeeRecord,
  key: string
): HTMLElement {
  const row = document.createElement("div");
  row.className = "employee-row";

  const employeeIdFromLink = employee._link?.split("/").pop();
  const scheduleHref = employeeIdFromLink
    ? employee._link?.replace(/#\/.*/, `#/employees/${employeeIdFromLink}/schedule`)
    : employee._link ?? "#";
  const name = `${employee.last_name ?? ""}, ${employee.first_name ?? ""}`.replace(/^,\s*/, "");

  const header = document.createElement("div");
  header.className = "employee-header";

  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = `employee-${key}`;

  const link = document.createElement("a");
  link.className = "employee-link";
  link.href = scheduleHref ?? "#";
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = name || "Unknown employee";

  header.append(radio, link);

  const details = document.createElement("div");
  details.className = "employee-details";
  details.hidden = true;

  row.append(header, details);

  radio.addEventListener("change", () => {
    container.prepend(row);
    void loadEmployeeDetails(ctx, employee, details);
  });

  return row;
}

async function loadEmployeeDetails(
  ctx: ColumnContext,
  employee: EmployeeRecord,
  details: HTMLDivElement
): Promise<void> {
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
            <td colspan="5" class="muted">Loading schedule\u2026</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  const tbody = details.querySelector("tbody");
  if (!(tbody instanceof HTMLTableSectionElement)) {
    return;
  }

  const currentDate = ctx.getDate();

  try {
    const schedule = await ctx.client.getSchedule(
      employee.id,
      employee.alayacare_employee_id ?? employee.id,
      currentDate
    );

    const availabilities = schedule.availabilities
      .map((item) => getDailyOccurrenceForDate(item, currentDate))
      .filter(Boolean) as ScheduleOccurrence[];
    const unavailabilities = schedule.unavailabilities
      .map((item) => getDailyOccurrenceForDate(item, currentDate))
      .filter(Boolean) as ScheduleOccurrence[];
    const visits = schedule.visits
      .map((item) => getVisitOccurrenceForDate(item, currentDate))
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
      row.appendChild(buildVisitsCell(ctx, visits, slotStart, slotEnd));
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

function buildVisitsCell(
  ctx: ColumnContext,
  visits: ScheduleOccurrence[],
  slotStart: Date,
  slotEnd: Date
): HTMLTableCellElement {
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
    icon.textContent = "\u{1f550}";
    icon.title = [visit.status, visit.cancelCode].filter(Boolean).join(" - ") || "Visit";
    ctx.tooltip.attachToVisitIcon(icon, String(visit.visitId));
    visitsCell.appendChild(icon);
  }

  return visitsCell;
}
