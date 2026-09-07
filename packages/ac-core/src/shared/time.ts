export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function floorTo15(date: Date): Date {
  const next = new Date(date.getTime());
  const flooredMinutes = next.getMinutes() - (next.getMinutes() % 15);
  next.setMinutes(flooredMinutes, 0, 0);
  return next;
}

export function ceilTo15(date: Date): Date {
  const next = new Date(date.getTime());
  const remainder = next.getMinutes() % 15;

  if (remainder !== 0) {
    next.setMinutes(next.getMinutes() + (15 - remainder), 0, 0);
  } else {
    next.setSeconds(0, 0);
  }

  return next;
}

export function formatRruleUtc(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error("Invalid date or time.");
  }

  return `${date.replace(/-/g, "")}T${time.replace(":", "")}00Z`;
}

export function buildDailyRrule(date: string, startTime: string, endTime: string): string {
  const dtStart = formatRruleUtc(date, startTime);
  const until = formatRruleUtc(date, endTime);
  return `FREQ=DAILY;DTSTART=${dtStart};UNTIL=${until};INTERVAL=1`;
}

export function minutesBetween(date: string, startTime: string, endTime: string): number {
  const start = new Date(`${date}T${startTime}:00`);
  const end = new Date(`${date}T${endTime}:00`);

  const diff = end.getTime() - start.getTime();
  if (diff <= 0) {
    throw new Error("End time must be after start time.");
  }

  return Math.round(diff / 60_000);
}

export function getLocalDayUtcRange(date: string): { startUtc: string; endUtc: string } {
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59.999`);

  return {
    startUtc: dayStart.toISOString(),
    endUtc: dayEnd.toISOString()
  };
}

export function parseUtcRruleDate(value: string | undefined): Date | null {
  if (!value || !value.includes("T")) {
    return null;
  }

  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
  return new Date(iso);
}

export function formatHHMMInTimeZone(date: Date, timeZone?: string | null): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timeZone ? { timeZone } : {})
  }).formatToParts(date);

  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

export function formatVisitDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

