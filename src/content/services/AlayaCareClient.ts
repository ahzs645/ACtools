import type { AvailabilityDraft, AvailabilityPostResult, PageStatus } from "../../shared/messages";
import { buildDailyRrule, getLocalDayUtcRange, minutesBetween } from "../utils/time";

interface StoreConfigResponse {
  current_user?: {
    id?: number;
    first_name?: string;
    last_name?: string;
  };
}

export interface Department {
  id?: number | string;
  department_id?: number | string;
  name: string;
}

export interface Group {
  id?: number | string;
  group_id?: number | string;
  name?: string;
}

interface VisibilityScopedEntity {
  departments?: Department[];
  department_ids?: Array<number | string>;
  groups?: Group[];
  group_ids?: Array<number | string>;
}

export interface EmployeeRecord extends VisibilityScopedEntity {
  id: number;
  first_name?: string;
  last_name?: string;
  _link?: string;
  alayacare_employee_id?: number;
  status?: string;
  designation?: string;
}

interface PagedResponse<T> {
  items?: T[];
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

export interface ClientRecord extends VisibilityScopedEntity {
  id?: number | string;
  full_name?: string;
}

export interface VisitRecord {
  start_at?: string;
  end_at?: string;
  status?: string;
  alayacare_visit_id?: number;
  visit_id?: number;
  cancel_code?: {
    code?: string;
  };
  client?: ClientRecord;
  service?: {
    name?: string;
    service_code_name?: string;
  };
}

export interface UserContext {
  status: PageStatus;
  departments: Department[];
  groups: Group[];
  groupFilteringAvailable: boolean;
}

export interface ScheduleBundle {
  availabilities: ScheduleRecord[];
  unavailabilities: ScheduleRecord[];
  visits: VisitRecord[];
}

export class AlayaCareClient {
  private userContextPromise: Promise<UserContext> | null = null;

  async getStatus(): Promise<PageStatus> {
    try {
      const config = await this.fetchJson<StoreConfigResponse>("/app/storeConfig");
      const firstName = config.current_user?.first_name?.trim() ?? "";
      const lastName = config.current_user?.last_name?.trim() ?? "";
      const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

      return {
        ready: true,
        location: window.location.origin,
        currentUserId: config.current_user?.id,
        currentUserName: fullName || undefined
      };
    } catch {
      return {
        ready: false,
        location: window.location.origin,
        reason: "This page does not look like an authenticated AlayaCare session."
      };
    }
  }

  async getUserContext(): Promise<UserContext> {
    if (!this.userContextPromise) {
      this.userContextPromise = this.loadUserContext();
    }

    return this.userContextPromise;
  }

  async getEmployees(departmentId: string, status: string, designation: string): Promise<EmployeeRecord[]> {
    const [context, response] = await Promise.all([
      this.getUserContext(),
      this.fetchJson<PagedResponse<EmployeeRecord>>(
        `/api/v2/employees/employees?${new URLSearchParams({
          status,
          department: departmentId,
          designation
        }).toString()}`
      )
    ]);

    return (response.items ?? [])
      .filter((employee) => sharesDepartment(context.departments, employee, departmentId))
      .filter((employee) => sharesGroup(context.groups, employee))
      .slice()
      .sort(compareEmployees);
  }

  async getSchedule(employeeId: number, visitEmployeeId: number, date: string): Promise<ScheduleBundle> {
    const [context, availabilities, unavailabilities, visits] = await Promise.all([
      this.getUserContext(),
      this.fetchSchedule(`/api/v2/employees/employee/${employeeId}/availabilities`, date),
      this.fetchSchedule(`/api/v2/employees/employee/${employeeId}/unavailabilities`, date),
      this.fetchVisits(visitEmployeeId, date)
    ]);

    return {
      availabilities,
      unavailabilities,
      visits: visits.filter((visit) => sharesGroup(context.groups, visit.client))
    };
  }

  async getVisitDetails(visitId: string): Promise<VisitRecord> {
    return this.fetchJson<VisitRecord>(`/api/v2/scheduler/visits/${encodeURIComponent(visitId)}`);
  }

  async postAvailability(draft: AvailabilityDraft): Promise<AvailabilityPostResult> {
    const uri = `/api/v2/employees/employee/${draft.employeeId}/availabilities`;
    const payload = {
      availability_type_id: draft.availabilityTypeId,
      description: draft.description,
      duration: minutesBetween(draft.date, draft.startTime, draft.endTime),
      all_day: false,
      rrule: buildDailyRrule(draft.date, draft.startTime, draft.endTime)
    };

    const response = await fetch(uri, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const body = await parseResponseBody(response);

    if (!response.ok) {
      throw new Error(`Availability POST failed (${response.status}): ${JSON.stringify(body)}`);
    }

    return {
      uri,
      status: response.status,
      body
    };
  }

  private async fetchSchedule(baseUrl: string, date: string): Promise<ScheduleRecord[]> {
    const params = new URLSearchParams({
      end_date_from: date,
      start_date_to: date,
      order_by: "start_at",
      count: "50"
    });

    const response = await this.fetchJson<PagedResponse<ScheduleRecord>>(`${baseUrl}?${params.toString()}`);
    return response.items ?? [];
  }

  private async fetchVisits(employeeId: number, date: string): Promise<VisitRecord[]> {
    const { startUtc, endUtc } = getLocalDayUtcRange(date);
    const params = new URLSearchParams({
      alayacare_employee_id: String(employeeId),
      start_date_from: startUtc,
      start_date_to: endUtc,
      count: "100"
    });

    const response = await this.fetchJson<PagedResponse<VisitRecord>>(`/api/v2/scheduler/visits?${params.toString()}`);
    return response.items ?? [];
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { credentials: "include" });

    if (!response.ok) {
      throw new Error(`Request failed (${response.status}) for ${url}`);
    }

    return response.json() as Promise<T>;
  }

  private async loadUserContext(): Promise<UserContext> {
    const status = await this.getStatus();

    if (!status.ready || !status.currentUserId) {
      return {
        status,
        departments: [],
        groups: [],
        groupFilteringAvailable: false
      };
    }

    const me = await this.fetchJson<EmployeeRecord>(`/api/v2/employees/employees/${status.currentUserId}`);
    const groups = me.groups ?? [];

    return {
      status,
      departments: me.departments ?? [],
      groups,
      groupFilteringAvailable: Array.isArray(me.groups) || Array.isArray(me.group_ids)
    };
  }
}

function compareEmployees(left: EmployeeRecord, right: EmployeeRecord): number {
  const leftLastName = (left.last_name ?? "").toLowerCase();
  const rightLastName = (right.last_name ?? "").toLowerCase();

  if (leftLastName !== rightLastName) {
    return leftLastName.localeCompare(rightLastName);
  }

  const leftFirstName = (left.first_name ?? "").toLowerCase();
  const rightFirstName = (right.first_name ?? "").toLowerCase();
  return leftFirstName.localeCompare(rightFirstName);
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function sharesDepartment(
  viewerDepartments: Department[],
  entity: VisibilityScopedEntity | undefined,
  selectedDepartmentId?: string
): boolean {
  const entityDepartmentIds = extractIdSet(entity?.departments, entity?.department_ids, ["id", "department_id"]);

  if (entityDepartmentIds.size === 0) {
    return true;
  }

  if (selectedDepartmentId) {
    return entityDepartmentIds.has(String(selectedDepartmentId));
  }

  const viewerDepartmentIds = extractIdSet(viewerDepartments, undefined, ["id", "department_id"]);
  return hasIntersection(viewerDepartmentIds, entityDepartmentIds);
}

function sharesGroup(viewerGroups: Group[], entity: VisibilityScopedEntity | undefined): boolean {
  const entityGroupIds = extractIdSet(entity?.groups, entity?.group_ids, ["id", "group_id"]);
  if (entityGroupIds.size === 0) {
    return true;
  }

  const viewerGroupIds = extractIdSet(viewerGroups, undefined, ["id", "group_id"]);
  if (viewerGroupIds.size === 0) {
    return true;
  }

  return hasIntersection(viewerGroupIds, entityGroupIds);
}

function extractIdSet<T extends object>(
  items: T[] | undefined,
  fallbackIds: Array<number | string> | undefined,
  keys: string[]
): Set<string> {
  const values = new Set<string>();

  if (Array.isArray(items)) {
    for (const item of items) {
      for (const key of keys) {
        const candidate = (item as Record<string, unknown>)[key];
        if (candidate !== undefined && candidate !== null && candidate !== "") {
          values.add(String(candidate));
        }
      }
    }
  }

  if (Array.isArray(fallbackIds)) {
    for (const id of fallbackIds) {
      if (id !== undefined && id !== null && id !== "") {
        values.add(String(id));
      }
    }
  }

  return values;
}

function hasIntersection(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
}
