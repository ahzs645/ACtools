import type { EmployeeListResult } from "../../../shared/employees";

const CACHE_PREFIX = "ac-tools-employee-cache:";
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedEmployees {
  timestamp: number;
  result: EmployeeListResult;
}

function key(origin: string, status: string): string {
  return `${CACHE_PREFIX}${origin}:${status}`;
}

export async function loadCachedEmployees(
  origin: string,
  status: string
): Promise<EmployeeListResult | null> {
  if (!origin) {
    return null;
  }
  const storageKey = key(origin, status);
  const stored = await chrome.storage.session.get(storageKey);
  const cached = stored[storageKey] as CachedEmployees | undefined;
  if (!cached || Date.now() - cached.timestamp > CACHE_TTL_MS) {
    if (cached) {
      await chrome.storage.session.remove(storageKey);
    }
    return null;
  }
  return cached.result;
}

export async function cacheEmployees(
  origin: string,
  status: string,
  result: EmployeeListResult
): Promise<void> {
  if (!origin) {
    return;
  }
  await chrome.storage.session.set({
    [key(origin, status)]: { timestamp: Date.now(), result } satisfies CachedEmployees
  });
}

export async function clearEmployeeCaches(origin: string): Promise<void> {
  const stored = await chrome.storage.session.get(null);
  const prefix = `${CACHE_PREFIX}${origin}:`;
  const keys = Object.keys(stored).filter((storageKey) => storageKey.startsWith(prefix));
  if (keys.length > 0) {
    await chrome.storage.session.remove(keys);
  }
}
