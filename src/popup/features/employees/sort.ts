import type { EmployeeSummary } from "../../../shared/employees";

export type EmployeeSortField = "id" | "first_name" | "last_name" | "status" | "email";
export type SortDirection = "asc" | "desc";

export function sortEmployees(
  employees: EmployeeSummary[],
  field: EmployeeSortField,
  direction: SortDirection
): EmployeeSummary[] {
  const factor = direction === "asc" ? 1 : -1;
  return employees.slice().sort((left, right) => {
    if (field === "id") {
      return (left.id - right.id) * factor;
    }
    return String(left[field] ?? "").localeCompare(String(right[field] ?? ""), undefined, {
      numeric: true,
      sensitivity: "base"
    }) * factor;
  });
}
