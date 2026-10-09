// Definition GET routes observed in NH UAT on 2026-10-08. No write routes.
export const UAT_ORIGIN = "https://northernhealth.uat.alayacare.ca";
export const FORM_PATH = "/api/v1/tasks/forms20/forms";
export const CAPTURE_FORMAT = "webforms-alayacare-definition-capture";
export const TENANT_CONFIGURATION_PATHS = ['/api/v1/employees/roles','/api/v1/tasks/forms20/formcategories','/api/v1/config/?sections=progress_note_types','/api/v1/config/profile_attributes?context=Patient&forms20_compatible=true&pagination=False','/api/v1/tasks/forms20/entity_definitions/medical_history','/api/v1/tasks/forms20/entity_definitions/medication','/api/v1/tasks/forms20/entity_definitions/vital','/api/v1/clinical/medication/form_fields'];

/** Definition metadata only. Role permission bodies and employee/client directories are excluded. */
export async function captureTenantConfiguration(read) {
  const failures = [], responses = [];
  for (const path of TENANT_CONFIGURATION_PATHS) {
    try {
      let response = await read(path);
      if (path === TENANT_CONFIGURATION_PATHS[0] || path === TENANT_CONFIGURATION_PATHS[1]) {
        if (!Array.isArray(response.items) || !Number.isSafeInteger(response.total_pages) || response.total_pages < 0 || response.total_pages > 100) throw new Error();
        const items = [...response.items];
        for (let page=2;page<=response.total_pages;page++) { const next=await read(`${path}?page=${page}`); if (!Array.isArray(next.items) || next.count !== response.count || next.total_pages !== response.total_pages) throw new Error(); items.push(...next.items); }
        if (items.length !== response.count || new Set(items.map(item=>item.id)).size !== items.length || !items.every(item=>Number.isSafeInteger(item.id)&&item.id>0)) throw new Error();
        response = items.map(item => ({id:item.id,label:String(item.name ?? item.description ?? item.code ?? item.id)}));
      }
      if (path === TENANT_CONFIGURATION_PATHS[2]) {
        const groups = Array.isArray(response) ? response : [response];
        if (!groups.length || !groups.every(item=>item?.progress_note_types && typeof item.progress_note_types === 'object' && Object.values(item.progress_note_types).every(value=>typeof value==='string'))) throw new Error();
      } else if (path === TENANT_CONFIGURATION_PATHS[3]) {
        if (!Array.isArray(response?.items) || response.items.length !== response.count || !response.items.every(item=>item && typeof item.tag==='string' && typeof item.input_type==='string')) throw new Error();
      } else if (path.includes('/entity_definitions/')) {
        if (!Array.isArray(response) || !response.every(item=>item && Array.isArray(item.fields))) throw new Error();
      } else if (path === TENANT_CONFIGURATION_PATHS[7] && (!response || typeof response !== 'object' || Array.isArray(response))) throw new Error();
      responses.push(response);
    } catch { failures.push({path,reason:'Tenant definition catalog unavailable or incomplete.'}); responses.push(null); }
  }
  return { capturedAt:new Date().toISOString(), complete:failures.length===0, roles:responses[0]??[], categories:responses[1]??[], progressNoteTypes:Object.assign({}, ...(Array.isArray(responses[2]) ? responses[2] : [responses[2]]).map(item=>item?.progress_note_types??{})), profileAttributes:responses[3]?.items??[], clinicalEntities:{medical_history:responses[4]??[],medication:responses[5]??[],vital:responses[6]??[]},medicationFields:responses[7]??{}, failures };
}

export function formId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid form ID.");
  return id;
}

export function indexPath(page = 1, { includeArchived = false } = {}) {
  const query = new URLSearchParams({
    show_latest_version_only: "true", count: "100", page: String(formId(page)),
    disable_restrict_submit_to: "true", include_subform: "true", display_count: "true",
    sort_by: "name", asc: "true",
  });
  query.append("status[]", "draft");
  query.append("status[]", "active");
  if (includeArchived) query.append("status[]", "archived");
  return `${FORM_PATH}?${query}`;
}
export function versionsPath(schemaId) {
  if (typeof schemaId !== "string" || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(schemaId)) throw new Error("Invalid form schema ID.");
  return `${FORM_PATH}?${new URLSearchParams({ schema_id: schemaId, include_subform: "true", include_order: "true", asc: "false", with_subforms: "false", count: "200" })}`;
}

/** Self-contained because Chrome serializes this function into the clicked tab. */
export async function readDefinitionInPage(path) {
  const origin = "https://northernhealth.uat.alayacare.ca";
  const base = "/api/v1/tasks/forms20/forms";
  if (location.origin !== origin || !location.hash.startsWith("#/system-settings/forms")) {
    throw new Error("Open Northern Health UAT Form Settings first.");
  }
  if (typeof path !== "string") throw new Error("Unsupported definition route.");
  const url = new URL(path, origin);
  if (url.origin !== origin || url.hash || url.username || url.password) throw new Error("Unsupported definition route.");
  const isDetail = /^\/api\/v1\/tasks\/forms20\/forms\/[1-9]\d*$/.test(url.pathname) && !url.search;
  const catalogPaths = ['/api/v1/employees/roles','/api/v1/tasks/forms20/formcategories','/api/v1/config/?sections=progress_note_types','/api/v1/config/profile_attributes?context=Patient&forms20_compatible=true&pagination=False','/api/v1/tasks/forms20/entity_definitions/medical_history','/api/v1/tasks/forms20/entity_definitions/medication','/api/v1/tasks/forms20/entity_definitions/vital','/api/v1/clinical/medication/form_fields'];
  const isCatalog = catalogPaths.includes(path) || /^\/api\/v1\/(employees\/roles|tasks\/forms20\/formcategories)\?page=[1-9]\d*$/.test(path);
  const expected = {
    show_latest_version_only: ["true"], count: ["100"],
    disable_restrict_submit_to: ["true"], include_subform: ["true"],
    display_count: ["true"], sort_by: ["name"], asc: ["true"],
    "status[]": ["draft", "active"],
  };
  const keys = [...new Set(url.searchParams.keys())];
  const isIndex = url.pathname === base && keys.length === Object.keys(expected).length + 1 &&
    keys.every(key => key === "page" || Object.hasOwn(expected, key)) &&
    /^[1-9]\d*$/.test(url.searchParams.get("page") ?? "") &&
    url.searchParams.getAll("page").length === 1 &&
    Object.entries(expected).every(([key, values]) => {
      const actual = url.searchParams.getAll(key);
      return JSON.stringify(actual) === JSON.stringify(values) || key === "status[]" && JSON.stringify(actual) === JSON.stringify(["draft", "active", "archived"]);
    });
  const historyExpected = { include_subform: "true", include_order: "true", asc: "false", with_subforms: "false", count: "200" };
  const isHistory = url.pathname === base && keys.length === 6 && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(url.searchParams.get("schema_id") ?? "") && url.searchParams.getAll("schema_id").length === 1 && Object.entries(historyExpected).every(([key, value]) => JSON.stringify(url.searchParams.getAll(key)) === JSON.stringify([value]));
  if (!isDetail && !isIndex && !isHistory && !isCatalog) throw new Error("Unsupported definition route.");
  const response = await fetch(url.href, { method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store" });
  if (!response.ok) throw new Error(`Definition request failed (HTTP ${response.status}).`);
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) throw new Error("Expected a JSON definition. Check your login.");
  return response.json();
}

export async function loadFormIndex(read, options = {}) {
  const items = new Map();
  let expectedCount;
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page += 1) {
    const response = await read(indexPath(page, options));
    if (!Array.isArray(response?.items) || !Number.isSafeInteger(response.total_pages) || response.total_pages < 0 || response.total_pages > 1000 || !Number.isSafeInteger(response.count) || response.count < 0) {
      throw new Error("Unexpected form index format.");
    }
    if (page === 1) { totalPages = Math.max(1, response.total_pages); expectedCount = response.count; }
    if (response.count !== expectedCount || Math.max(1, response.total_pages) !== totalPages) throw new Error("The form library changed during capture. Reload its list.");
    for (const item of response.items) {
      const id = formId(item?.id);
      if (typeof item.name !== "string") throw new Error("Unexpected form index entry.");
      items.set(id, { id, name: item.name, status: item.status, schemaVersion: item.schema_version });
    }
  }
  if (items.size !== expectedCount) throw new Error("The form index is incomplete. Reload its list.");
  return [...items.values()];
}

export function linkedFormIds(definition) {
  const ids = new Set();
  for (const field of definition.fields) {
    if (field?.field_type === "subform" && field.settings?.subform_id != null) ids.add(formId(field.settings.subform_id));
  }
  for (const linked of definition.subforms ?? []) ids.add(formId(linked.id));
  return [...ids];
}

function definitionWithoutActors(raw) {
  // Form author identities are not needed to reconstruct the definition.
  const { create_user, update_user, create_user_id, update_user_id, ...definition } = raw;
  return structuredClone(definition);
}

export async function definitionHash(definition) {
  const bytes = new TextEncoder().encode(JSON.stringify(definition));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function captureDefinitions(rootIds, read, onProgress = () => {}, options = {}) {
  const roots = [...new Set(rootIds.map(formId))];
  if (!roots.length) throw new Error("Select at least one form.");
  const pending = [...roots];
  const visited = new Set();
  const visitedSchemas = new Set();
  const forms = [];
  const failures = [];
  while (pending.length) {
    const id = pending.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    onProgress({ id, completed: forms.length, pending: pending.length });
    try {
      const raw = await read(`${FORM_PATH}/${id}`);
      if (raw?.id !== id || typeof raw.name !== "string" || !Array.isArray(raw.fields) || (raw.subforms != null && !Array.isArray(raw.subforms))) {
        throw new Error("Unexpected form definition format.");
      }
      const dependencies = linkedFormIds(raw);
      const definition = definitionWithoutActors(raw);
      forms.push({ id, sourcePath: `${FORM_PATH}/${id}`, capturedAt: new Date().toISOString(), sha256: await definitionHash(definition), dependencies, definition });
      pending.push(...dependencies.filter(dependency => !visited.has(dependency)));
      if (options.includeVersions && raw.schema_id != null && !visitedSchemas.has(raw.schema_id)) {
        visitedSchemas.add(raw.schema_id);
        try {
          const history = await read(versionsPath(raw.schema_id));
          if (!Array.isArray(history?.items) || !Number.isSafeInteger(history.count) || history.count !== history.items.length || !Number.isSafeInteger(history.total_pages) || history.total_pages < 0 || history.total_pages > 1) throw new Error("Incomplete version index.");
          for (const version of history.items) {
            if (version.schema_id !== raw.schema_id) throw new Error("Unexpected schema in version index.");
            const versionId = formId(version.id);
            if (!visited.has(versionId)) pending.push(versionId);
          }
        } catch {
          failures.push({ id, reason: "Version history could not be fully captured; the observed history endpoint is limited to 200 versions per schema." });
        }
      }
    } catch {
      // Do not place arbitrary server error bodies or credentials in the archive.
      failures.push({ id, reason: "Definition could not be captured or its structure was unexpected." });
    }
  }
  const captured = new Set(forms.map(form => form.id));
  const unresolved = [...new Set(forms.flatMap(form => form.dependencies).filter(id => !captured.has(id)))];
  const tenantConfiguration = options.includeTenantConfiguration ? await captureTenantConfiguration(read) : undefined;
  return {
    format: CAPTURE_FORMAT, formatVersion: 1,
    sourceOrigin: UAT_ORIGIN, capturedAt: new Date().toISOString(), rootFormIds: roots,
    coverage: {
      selectedDefinitionsComplete: roots.every(id => captured.has(id)) && failures.length === 0 && unresolved.length === 0,
      scope: "Selected form definitions and recursively referenced subforms, with the requested version/status scope",
      includeArchived: Boolean(options.includeArchived), includeVersions: Boolean(options.includeVersions),
      excluded: [...(!options.includeArchived ? ["Archived root forms"] : []), ...(!options.includeVersions ? ["Older form versions"] : []), "Document templates and attachments", "Patient submissions and chart data", ...(!tenantConfiguration ? ["Role/category directory definitions"] : ["Role permission bodies and employee/client directory records"]), "Form author identities (create_user, update_user, create_user_id, update_user_id)"],
      unresolvedSubformIds: unresolved,
    },
    forms, failures,
    ...(tenantConfiguration ? {tenantConfiguration,tenantConfigurationSha256:await definitionHash(tenantConfiguration)} : {}),
  };
}
