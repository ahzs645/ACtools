import {
  APP_PREFERENCES_STORAGE_KEY,
  DEFAULT_APP_PREFERENCES,
  type AppPreferences
} from "../../shared/environments";

export async function loadAppPreferences(): Promise<AppPreferences> {
  const stored = await chrome.storage.local.get(APP_PREFERENCES_STORAGE_KEY);
  return sanitizePreferences(stored[APP_PREFERENCES_STORAGE_KEY] as Partial<AppPreferences> | undefined);
}

export async function saveAppPreferences(preferences: AppPreferences): Promise<AppPreferences> {
  const sanitized = sanitizePreferences(preferences);
  await chrome.storage.local.set({ [APP_PREFERENCES_STORAGE_KEY]: sanitized });
  return sanitized;
}

export async function resetAppPreferences(): Promise<AppPreferences> {
  await chrome.storage.local.remove(APP_PREFERENCES_STORAGE_KEY);
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
