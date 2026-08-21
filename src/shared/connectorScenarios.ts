export type ConnectorScenarioSource = "draft" | "published";

export interface ConnectorBlueprintModule {
  id?: number | string;
  module?: string;
  version?: number;
  parameters?: Record<string, unknown>;
  mapper?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  routes?: Array<{
    disabled?: boolean;
    flow?: ConnectorBlueprintModule[];
  }>;
  onerror?: ConnectorBlueprintModule[];
  [key: string]: unknown;
}

export interface ConnectorBlueprint {
  name?: string;
  flow: ConnectorBlueprintModule[];
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ConnectorScenarioMetadata {
  id: number;
  name: string;
  teamId: number;
  description?: string;
  folderId?: number | null;
  concept?: boolean;
  isPaused?: boolean;
  isActive?: boolean;
  created?: string;
  lastEdit?: string;
  usedPackages: string[];
}

export interface ConnectorScenarioListItem extends ConnectorScenarioMetadata {
  isInvalid?: boolean;
  isLocked?: boolean;
  isWaiting?: boolean;
  scheduling?: unknown;
  nextExec?: string;
  dlqCount?: number;
  allDlqCount?: number;
  operations?: number;
  transfer?: number;
}

export interface ConnectorScenarioListResult {
  teamId: number;
  teamName?: string;
  organizationId?: number;
  activeScenarioId?: number;
  scenarios: ConnectorScenarioListItem[];
}

export interface ConnectorScenarioSummary {
  moduleCount: number;
  routeCount: number;
  errorHandlerCount: number;
  moduleTypes: string[];
  packages: string[];
}

export interface ConnectorScenarioSnapshot {
  schemaVersion: 1;
  exportedAt: string;
  tenantOrigin: string;
  sourceUrl: string;
  scenarioId: number;
  teamId: number;
  source: ConnectorScenarioSource;
  serverDraftAvailable: boolean;
  scenario: ConnectorScenarioMetadata;
  blueprint: ConnectorBlueprint;
  scheduling?: unknown;
  scenarioMetadata?: unknown;
  idSequence?: number;
  lastEdit?: string;
  summary: ConnectorScenarioSummary;
}

export interface ConnectorScenarioBundle {
  schemaVersion: 1;
  exportedAt: string;
  tenantOrigin: string;
  sourceUrl: string;
  scenarioId: number;
  teamId: number;
  scenario: ConnectorScenarioMetadata;
  published: ConnectorScenarioSnapshot;
  draft: ConnectorScenarioSnapshot;
}

export interface ConnectorScenarioSaveRequest {
  scenarioId?: number;
  blueprint: ConnectorBlueprint;
  expectedLastEdit?: string;
}

export interface ConnectorScenarioSaveResult {
  scenarioId: number;
  savedAt: string;
  snapshot: ConnectorScenarioSnapshot;
}

export interface ConnectorScenarioBulkDownloadResult {
  filename: string;
  scenarioCount: number;
  failedCount: number;
  failures: Array<{ scenarioId: number; name: string; error: string }>;
}

export interface ConnectorTemplateReference {
  id: number;
  name: string;
  description?: string;
  url?: string;
  usedApps: string[];
  usage?: number;
}

export interface ConnectorConnectionReference {
  id: number;
  name: string;
  accountLabel?: string;
  packageName?: string;
  theme?: string;
  accountType?: string;
  scoped?: boolean;
  editable?: boolean;
  upgradeable?: boolean;
}

export interface ConnectorWebhookReference {
  id: number;
  name: string;
  type?: string;
  packageName?: string;
  theme?: string;
  enabled?: boolean;
  editable?: boolean;
  gone?: boolean;
  queueCount?: number;
  queueLimit?: number;
  typeName?: string;
  typeAppName?: string;
  scenarioId?: number;
  scenarioName?: string;
  scenarioIsActive?: boolean;
  hasWebhookUrl: boolean;
}

export interface ConnectorFunctionReference {
  id: number;
  name: string;
  args?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConnectorKeyReference {
  id: number;
  name: string;
  packageName?: string;
  theme?: string;
  typeName?: string;
}

export interface ConnectorDataStoreReference {
  id: number;
  name: string;
  records?: number;
  size?: number;
  maxSize?: number;
  dataStructureId?: number;
}

export interface ConnectorDataStructureReference {
  id: number;
  name: string;
}

export interface ConnectorReferenceCatalog {
  schemaVersion: 1;
  exportedAt: string;
  tenantOrigin: string;
  teamId: number;
  organizationId?: number;
  templates: ConnectorTemplateReference[];
  connections: ConnectorConnectionReference[];
  webhooks: ConnectorWebhookReference[];
  functions: ConnectorFunctionReference[];
  keys: ConnectorKeyReference[];
  dataStores: ConnectorDataStoreReference[];
  dataStructures: ConnectorDataStructureReference[];
}

export interface ConnectorScenarioRun {
  id?: string;
  started?: string;
  status?: string;
  duration?: number;
  operations?: number;
  transfer?: number;
  kind?: string;
}

export interface ConnectorScenarioHealth {
  schemaVersion: 1;
  checkedAt: string;
  tenantOrigin: string;
  teamId: number;
  scenario: ConnectorScenarioListItem;
  incompleteExecutionCount: number;
  runs: ConnectorScenarioRun[];
  historyUrl: string;
}

export type ConnectorAuditSeverity = "danger" | "warning" | "info";

export interface ConnectorBlueprintAuditFinding {
  id: string;
  severity: ConnectorAuditSeverity;
  title: string;
  detail: string;
  moduleId?: string;
  moduleType?: string;
}

export interface ConnectorBlueprintComparison {
  changed: boolean;
  draftModules: number;
  publishedModules: number;
  draftRoutes: number;
  publishedRoutes: number;
  draftBytes: number;
  publishedBytes: number;
}

export interface ConnectorBlueprintAuditReport {
  score: number;
  findings: ConnectorBlueprintAuditFinding[];
  counts: Record<ConnectorAuditSeverity, number>;
  comparison?: ConnectorBlueprintComparison;
}

export interface ConnectorErrorDiagnostic {
  match: string;
  category: string;
  likelyCause: string;
  nextStep: string;
}

export const CONNECTOR_ERROR_DIAGNOSTICS: ConnectorErrorDiagnostic[] = [
  { match: "401 / 403", category: "Authentication", likelyCause: "Expired, missing, or insufficient connection authorization.", nextStep: "Open the connection, reauthorize it, and confirm the account has access to the target resource." },
  { match: "400 / 404", category: "Request or mapping", likelyCause: "A required value, identifier, path, or mapped field is invalid.", nextStep: "Inspect the failed module input and compare it with the app/API contract." },
  { match: "429", category: "Rate limit", likelyCause: "The app or API received too many requests in a short period.", nextStep: "Reduce scheduling frequency, add throttling, or process items in smaller batches." },
  { match: "502–504", category: "Upstream service", likelyCause: "The remote service or its gateway is unavailable.", nextStep: "Retry with a bounded backoff and check the service status before changing mappings." },
  { match: "Timeout", category: "Runtime", likelyCause: "A request or scenario path took longer than its allowed execution window.", nextStep: "Split long work, reduce bundle volume, and inspect slow modules." },
  { match: "Incomplete execution", category: "Recovery", likelyCause: "A Break handler or interrupted run stored work for later resolution.", nextStep: "Review the incomplete execution in Connector and decide whether its operations are safe to retry." },
  { match: "Operation / data limit", category: "Capacity", likelyCause: "A loop, router, or large payload consumed more operations or transfer than expected.", nextStep: "Add filters before iterators, constrain searches, and aggregate only what downstream modules need." },
  { match: "Duplicate / inconsistency", category: "Data integrity", likelyCause: "A retry or partially completed run created conflicting state.", nextStep: "Check idempotency keys and search for an existing record before creating another." }
];

export interface ConnectorBlueprintValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary: ConnectorScenarioSummary;
}

export function summarizeConnectorBlueprint(
  blueprint: ConnectorBlueprint,
  usedPackages: string[] = []
): ConnectorScenarioSummary {
  const moduleTypes = new Set<string>();
  const packages = new Set(usedPackages);
  let moduleCount = 0;
  let routeCount = 0;
  let errorHandlerCount = 0;

  const visit = (flow: ConnectorBlueprintModule[] | undefined): void => {
    if (!Array.isArray(flow)) {
      return;
    }

    for (const item of flow) {
      moduleCount += 1;
      if (typeof item.module === "string" && item.module.trim()) {
        moduleTypes.add(item.module);
        const packageName = item.module.split(":", 1)[0]?.trim();
        if (packageName) {
          packages.add(packageName);
        }
      }

      if (Array.isArray(item.routes)) {
        routeCount += item.routes.length;
        item.routes.forEach((route) => visit(route.flow));
      }

      if (Array.isArray(item.onerror)) {
        errorHandlerCount += 1;
        visit(item.onerror);
      }
    }
  };

  visit(blueprint.flow);

  return {
    moduleCount,
    routeCount,
    errorHandlerCount,
    moduleTypes: Array.from(moduleTypes).sort(),
    packages: Array.from(packages).sort()
  };
}

export function validateConnectorBlueprint(value: unknown): ConnectorBlueprintValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();

  if (!isRecord(value)) {
    return {
      valid: false,
      errors: ["The JSON root must be an object."],
      warnings,
      summary: emptySummary()
    };
  }

  if (!Array.isArray(value.flow)) {
    errors.push('The blueprint must contain a "flow" array.');
  }

  if (value.name !== undefined && typeof value.name !== "string") {
    errors.push('"name" must be a string when present.');
  }

  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    errors.push('"metadata" must be an object when present.');
  }

  const validateFlow = (flow: unknown, path: string): void => {
    if (!Array.isArray(flow)) {
      errors.push(`${path} must be an array.`);
      return;
    }

    flow.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (!isRecord(item)) {
        errors.push(`${itemPath} must be an object.`);
        return;
      }

      if (typeof item.module !== "string" || !item.module.trim()) {
        errors.push(`${itemPath}.module must be a non-empty string.`);
      }

      if (item.id === undefined || (typeof item.id !== "number" && typeof item.id !== "string")) {
        warnings.push(`${itemPath} has no numeric or string id.`);
      } else {
        const id = String(item.id);
        if (ids.has(id)) {
          errors.push(`Duplicate module id ${id} at ${itemPath}.`);
        }
        ids.add(id);
      }

      if (item.routes !== undefined) {
        if (!Array.isArray(item.routes)) {
          errors.push(`${itemPath}.routes must be an array.`);
        } else {
          item.routes.forEach((route, routeIndex) => {
            if (!isRecord(route)) {
              errors.push(`${itemPath}.routes[${routeIndex}] must be an object.`);
              return;
            }
            validateFlow(route.flow, `${itemPath}.routes[${routeIndex}].flow`);
          });
        }
      }

      if (item.onerror !== undefined) {
        validateFlow(item.onerror, `${itemPath}.onerror`);
      }
    });
  };

  if (Array.isArray(value.flow)) {
    validateFlow(value.flow, "flow");
  }

  if (Array.isArray(value.flow) && value.flow.length === 0) {
    warnings.push("The blueprint flow is empty.");
  }

  const blueprint = value as unknown as ConnectorBlueprint;
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: Array.isArray(value.flow) ? summarizeConnectorBlueprint(blueprint) : emptySummary()
  };
}

export function extractConnectorBlueprint(value: unknown): ConnectorBlueprint | null {
  if (!isRecord(value)) {
    return null;
  }

  if (Array.isArray(value.flow)) {
    return value as unknown as ConnectorBlueprint;
  }

  if (isRecord(value.blueprint) && Array.isArray(value.blueprint.flow)) {
    return value.blueprint as unknown as ConnectorBlueprint;
  }

  for (const key of ["draft", "published"] as const) {
    const candidate = value[key];
    if (isRecord(candidate) && isRecord(candidate.blueprint) && Array.isArray(candidate.blueprint.flow)) {
      return candidate.blueprint as unknown as ConnectorBlueprint;
    }
  }

  return null;
}

export function auditConnectorBlueprint(
  blueprint: ConnectorBlueprint,
  published?: ConnectorBlueprint
): ConnectorBlueprintAuditReport {
  const findings: ConnectorBlueprintAuditFinding[] = [];
  let hasIterator = false;
  let hasRouter = false;

  const add = (
    severity: ConnectorAuditSeverity,
    id: string,
    title: string,
    detail: string,
    module?: ConnectorBlueprintModule
  ): void => {
    findings.push({
      id: `${id}-${findings.length + 1}`,
      severity,
      title,
      detail,
      moduleId: module?.id === undefined ? undefined : String(module.id),
      moduleType: module?.module
    });
  };

  const visit = (flow: ConnectorBlueprintModule[] | undefined, inErrorHandler = false): void => {
    for (const module of flow ?? []) {
      const type = (module.module ?? "").toLowerCase();
      const label = module.module || "Unnamed module";
      if (/delete|remove|destroy/.test(type)) {
        add("danger", "destructive", "Destructive operation", `${label} can remove remote data. Confirm filters and recovery steps before activation.`, module);
      } else if (/create|update|write|patch|put|post/.test(type)) {
        add("warning", "write", "Write operation", `${label} changes remote state. Verify retry and duplicate-prevention behavior.`, module);
      }
      if (/http|request|api/.test(type)) {
        add("info", "universal-api", "Universal API module", `${label} depends on an external API contract that Connector cannot fully validate.`, module);
      }
      if (/iterator/.test(type)) {
        hasIterator = true;
      }
      if (/router/.test(type) || (module.routes?.length ?? 0) > 1) {
        hasRouter = true;
      }
      if (inErrorHandler && /ignore/.test(type)) {
        add("warning", "ignore-handler", "Ignore error handler", "Ignored errors can make a run appear successful while dropping a bundle.", module);
      }
      if (inErrorHandler && /break/.test(type)) {
        add("info", "break-handler", "Break error handler", "Break handlers can create incomplete executions that require an operator decision.", module);
      }

      const sensitivePaths = findSensitivePaths({ parameters: module.parameters, mapper: module.mapper });
      if (sensitivePaths.length) {
        add("warning", "static-secret", "Possible static secret", `Review ${sensitivePaths.slice(0, 3).join(", ")} and move credentials into a Connector connection or key. Values were not read or included.`, module);
      }

      module.routes?.forEach((route) => visit(route.flow, inErrorHandler));
      if (module.onerror?.length) {
        visit(module.onerror, true);
      } else if (/create|update|write|delete|remove|http|request|api/.test(type)) {
        add("info", "missing-handler", "No module error handler", `${label} has no local error-handler route. Confirm the scenario-level recovery behavior is intentional.`, module);
      }
    }
  };

  visit(blueprint.flow);
  if (hasIterator && hasRouter) {
    add("warning", "operation-growth", "Operation multiplication risk", "This blueprint combines iteration and routing. Filters placed after those modules can multiply operations quickly.");
  } else if (hasIterator) {
    add("info", "iterator-growth", "Iterator operation growth", "Each bundle produced by an iterator can add downstream operations. Constrain input before iteration where possible.");
  }

  const counts: Record<ConnectorAuditSeverity, number> = { danger: 0, warning: 0, info: 0 };
  findings.forEach((finding) => { counts[finding.severity] += 1; });
  const score = Math.max(0, 100 - counts.danger * 25 - counts.warning * 10 - counts.info * 2);
  return {
    score,
    findings,
    counts,
    comparison: published ? compareConnectorBlueprints(blueprint, published) : undefined
  };
}

export function compareConnectorBlueprints(
  draft: ConnectorBlueprint,
  published: ConnectorBlueprint
): ConnectorBlueprintComparison {
  const draftJson = stableJson(draft);
  const publishedJson = stableJson(published);
  const draftSummary = summarizeConnectorBlueprint(draft);
  const publishedSummary = summarizeConnectorBlueprint(published);
  return {
    changed: draftJson !== publishedJson,
    draftModules: draftSummary.moduleCount,
    publishedModules: publishedSummary.moduleCount,
    draftRoutes: draftSummary.routeCount,
    publishedRoutes: publishedSummary.routeCount,
    draftBytes: new Blob([draftJson]).size,
    publishedBytes: new Blob([publishedJson]).size
  };
}

function findSensitivePaths(value: unknown, path = "module", depth = 0): string[] {
  if (depth > 7 || !isRecord(value)) {
    return [];
  }
  const matches: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (/password|secret|token|api.?key|authorization|private.?key/i.test(key) && typeof child === "string" && child.trim()) {
      matches.push(childPath);
    } else if (isRecord(child)) {
      matches.push(...findSensitivePaths(child, childPath, depth + 1));
    } else if (Array.isArray(child)) {
      child.forEach((item, index) => {
        if (isRecord(item)) {
          matches.push(...findSensitivePaths(item, `${childPath}[${index}]`, depth + 1));
        }
      });
    }
  }
  return matches;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function emptySummary(): ConnectorScenarioSummary {
  return {
    moduleCount: 0,
    routeCount: 0,
    errorHandlerCount: 0,
    moduleTypes: [],
    packages: []
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
