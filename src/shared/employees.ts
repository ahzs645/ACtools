export interface EmployeeSummary {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  status?: string;
  designation?: string;
}

export interface EmployeeReference {
  id: number;
  name?: string;
  description?: string;
}

export interface EmployeeDetail extends EmployeeSummary {
  username?: string;
  payroll_number?: string;
  timezone?: string;
  branch_id?: number;
  demographics?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone_main?: string;
    salutation?: string;
    gender?: string;
    address?: string;
    city?: string;
    country?: string;
    state?: string;
    zip?: string;
  };
  roles?: EmployeeReference[];
  groups?: EmployeeReference[];
  departments?: EmployeeReference[];
  employment_type?: EmployeeReference;
  seniority?: string;
  max_weekly_capacity?: string;
  min_weekly_capacity?: string;
  max_daily_capacity?: string;
  min_daily_capacity?: string;
  default_availability?: string;
}

export interface EmployeeListRequest {
  count?: number;
  status?: string;
}

export interface EmployeeListResult {
  items: EmployeeSummary[];
  count: number;
}

export interface EmployeeStatusUpdate {
  employeeId: number;
  status: string;
  comment: string;
}

export interface EmployeeWriteResult {
  employeeId: number;
  status: number;
  noteStatus?: number;
}

export interface EmployeeApiCredentialStatus {
  configured: boolean;
  origin: string;
  storage: "session" | "local" | null;
}

export interface EmployeeConfiguredTenant {
  origin: string;
  storage: "session" | "local";
}

export interface EmployeeCopyRequest {
  employee: EmployeeDetail;
  targetOrigins: string[];
  ticket: string;
}

export type EmployeeMappingKind = "groups" | "roles" | "departments" | "employment_type";

export interface EmployeeMappingOption {
  id: number;
  name: string;
}

export interface EmployeeMappingRow {
  kind: EmployeeMappingKind;
  sourceId: number;
  sourceName: string;
  targetId: number | null;
  exactMatch: boolean;
  options: EmployeeMappingOption[];
}

export interface EmployeeCopyTargetPlan {
  origin: string;
  duplicateEmployee?: { id: number; name: string; email?: string };
  mappings: EmployeeMappingRow[];
  ready: boolean;
  error?: string;
}

export interface EmployeeCopyPlanRequest {
  employee: EmployeeDetail;
  targetOrigins: string[];
}

export interface EmployeeCopyPlanResult {
  sourceEmployeeId: number;
  plans: EmployeeCopyTargetPlan[];
}

export interface EmployeeCopyMappingSelection {
  kind: EmployeeMappingKind;
  sourceId: number;
  targetId: number;
}

export interface EmployeeCopyTargetRequest {
  employee: EmployeeDetail;
  sourceOrigin: string;
  targetOrigin: string;
  ticket: string;
  mappings: EmployeeCopyMappingSelection[];
}

export interface EmployeeCopyTargetResult {
  origin: string;
  ok: boolean;
  employeeId?: number;
  noteStatus?: number;
  error?: string;
}

export interface EmployeeCopyResult {
  sourceEmployeeId: number;
  results: EmployeeCopyTargetResult[];
}
