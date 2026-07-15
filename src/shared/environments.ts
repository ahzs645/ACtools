export const DEFAULT_SUPPORT_URL = "https://healthbc.service-now.com/";
export const ENVIRONMENT_REGISTRY_STORAGE_KEY = "ac-tools-environment-registry";
export const APP_PREFERENCES_STORAGE_KEY = "ac-tools-app-preferences";

export interface EnvironmentConfig {
  origin: string;
  name: string;
  supportUrl: string;
}

export interface EnvironmentRegistry {
  defaultOrigin: string | null;
  environments: EnvironmentConfig[];
}

export interface EnvironmentHealthCheck {
  id: "authentication" | "groups" | "roles" | "departments" | "employment_types";
  label: string;
  ok: boolean;
  status?: number;
  count?: number;
  error?: string;
}

export interface EnvironmentHealth {
  origin: string;
  checkedAt: string;
  configured: boolean;
  healthy: boolean;
  checks: EnvironmentHealthCheck[];
}

export interface AppPreferences {
  defaultTimezone: string;
  employeeStatuses: string[];
}

export const DEFAULT_EMPLOYEE_STATUSES = [
  "active",
  "applicant",
  "pending",
  "on_hold",
  "suspended",
  "terminated",
  "rejected"
];

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  defaultTimezone: "America/Vancouver",
  employeeStatuses: DEFAULT_EMPLOYEE_STATUSES
};

export function emptyEnvironmentRegistry(): EnvironmentRegistry {
  return { defaultOrigin: null, environments: [] };
}
