import { addMinutes, parseUtcRruleDate } from "../../utils/time";
import type { VisitRecord } from "../../services/AlayaCareClient";

export interface ScheduleOccurrence {
  occStart: Date;
  occEnd: Date;
  timeZone?: string | null;
  type?: string;
  visitId?: number | null;
  status?: string;
  cancelCode?: string;
}

export interface ScheduleRecord {
  duration?: number;
  rrule?: string;
  time_off_type?: {
    name?: string;
  };
  availability_type?: {
    name?: string;
  };
}

export function cell(value: string): HTMLTableCellElement {
  const output = document.createElement("td");
  output.textContent = value;
  return output;
}

export function generate15MinuteSlots(start: Date, end: Date): Date[] {
  const slots: Date[] = [];
  let cursor = new Date(start.getTime());

  while (cursor < end) {
    slots.push(new Date(cursor.getTime()));
    cursor = addMinutes(cursor, 15);
  }

  return slots;
}

export function textForSlot(
  occurrences: ScheduleOccurrence[],
  slotStart: Date,
  slotEnd: Date
): string {
  const values = new Set<string>();

  for (const occurrence of occurrences) {
    if (occurrence.occStart < slotEnd && occurrence.occEnd > slotStart && occurrence.type) {
      values.add(occurrence.type);
    }
  }

  return Array.from(values).join(" / ");
}

export function getDailyOccurrenceForDate(
  item: ScheduleRecord,
  targetDate: string
): ScheduleOccurrence | null {
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

export function getVisitOccurrenceForDate(
  item: VisitRecord,
  targetDate: string
): ScheduleOccurrence | null {
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
