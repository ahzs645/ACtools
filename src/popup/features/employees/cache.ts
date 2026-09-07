import type { EmployeeListResult } from "@ac-core/shared/employees";
import { popupStorage } from "../../platform";

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
  const cached = await popupStorage.session.get<CachedEmployees>(storageKey);
  if (!cached || Date.now() - cached.timestamp > CACHE_TTL_MS) {
    if (cached) {
      await popupStorage.session.remove(storageKey);
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
  await popupStorage.session.set(key(origin, status), {
    timestamp: Date.now(),
    result
  } satisfies CachedEmployees);
}

export async function clearEmployeeCaches(origin: string): Promise<void> {
  const prefix = `${CACHE_PREFIX}${origin}:`;
  const keys = (await popupStorage.session.keys()).filter((storageKey) => storageKey.startsWith(prefix));
  if (keys.length > 0) {
    await popupStorage.session.remove(keys);
  }
}
