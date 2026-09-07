import {
  APP_PREFERENCES_STORAGE_KEY,
  DEFAULT_APP_PREFERENCES,
  type AppPreferences
} from "@ac-core/shared/environments";
import { popupStorage } from "../platform";

export async function loadAppPreferences(): Promise<AppPreferences> {
  const stored = await popupStorage.local.get<Partial<AppPreferences>>(APP_PREFERENCES_STORAGE_KEY);
  return sanitizePreferences(stored);
}

export async function saveAppPreferences(preferences: AppPreferences): Promise<AppPreferences> {
  const sanitized = sanitizePreferences(preferences);
  await popupStorage.local.set(APP_PREFERENCES_STORAGE_KEY, sanitized);
  return sanitized;
}

export async function resetAppPreferences(): Promise<AppPreferences> {
  await popupStorage.local.remove(APP_PREFERENCES_STORAGE_KEY);
  return { ...DEFAULT_APP_PREFERENCES, employeeStatuses: [...DEFAULT_APP_PREFERENCES.employeeStatuses] };
}

function sanitizePreferences(input?: Partial<AppPreferences>): AppPreferences {
  const defaultTimezone = input?.defaultTimezone?.trim() || DEFAULT_APP_PREFERENCES.defaultTimezone;
  const statuses = [...new Set(
    (input?.employeeStatuses ?? DEFAULT_APP_PREFERENCES.employeeStatuses)
      .map((status) => status.trim().toLocaleLowerCase().replace(/\s+/g, "_"))
      .filter(Boolean)
  )];
  return {
    defaultTimezone,
    employeeStatuses: statuses.length > 0 ? statuses : [...DEFAULT_APP_PREFERENCES.employeeStatuses]
  };
}
