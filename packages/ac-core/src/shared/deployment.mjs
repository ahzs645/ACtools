import { UAT_ORIGIN, FORM_PATH } from './capture.mjs';
export const DEPLOYMENT_FORMAT = 'webforms-alayacare-draft-deployment';
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const id = value => Number.isSafeInteger(value) && value > 0;
const key = value => typeof value === 'string' && /^[\w.:-]{1,160}$/.test(value);
export const FORM_WRITE_KEYS = ['name','instructions','form_type','language_code','clinical_event_name','dispatchable_event_type','requires_clock_in','display_report','exclude_from_shift_report','pre_populate','approve_automatically','admin_eyes_only','notify_alert_queue','visit_link_required','display_instructions_in_pdf','category_id','restrict_submit_to','restrict_view_to','branch'];
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value[k] !== undefined).map(k => [k, structuredClone(value[k])]));
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
}
export async function deploymentDigest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2,'0')).join('');
}
export function sourceSnapshot(value) {
  const { create_user: _createUser, update_user: _updateUser, create_user_id: _createUserId, update_user_id: _updateUserId, sourceDefinitions: _context, ...source } = value;
  return structuredClone(source);
}
export function remapLogic(rule, mapping) {
  if (Array.isArray(rule)) return rule.map(value => remapLogic(value, mapping));
  if (!object(rule)) return rule;
  return Object.fromEntries(Object.entries(rule).map(([name,value]) => {
    if (name !== 'var') return [name,remapLogic(value,mapping)];
    const variable = Array.isArray(value) ? value[0] : value;
    if (!(typeof variable === 'number' || typeof variable === 'string' && /^\d+$/.test(variable))) return [name,structuredClone(value)];
    const replacement = mapping[Number(variable)];
    if (!id(replacement)) throw new Error(`Unresolved question reference ${variable}.`);
    const mapped = typeof variable === 'string' ? String(replacement) : replacement;
    return [name,Array.isArray(value) ? [mapped,...structuredClone(value.slice(1))] : mapped];
  }));
}

/** NH UAT rejects a score whose linked score already links another score (2026-10-08). */
export function nativeScoreGraphProblems(fields) {
  const scores = new Map(fields.filter(field => field.field_type === 'score').map(field => [String(field.id), field]));
  const depth = (key, path = new Set()) => {
    if (path.has(key)) return Infinity;
    const field = scores.get(key);
    if (!field) return 0;
    const next = new Set(path); next.add(key);
    return 1 + Math.max(0, ...(field.settings?.linked_field_ids ?? []).map(id => depth(String(id), next)));
  };
  return [...scores.values()].flatMap(field => {
    const count = depth(String(field.id));
    return count > 2 ? [{ fieldId: field.id, reason: Number.isFinite(count)
      ? 'AlayaCare allows at most two score stages: a linked score cannot itself link another score. Reorder or algebraically flatten this calculation before upload.'
      : 'This score contains a circular calculation dependency. Remove the cycle before export.' }] : [];
  });
}

/** Native scores inline the linked score's formula and null-check direct answers only. */
export function expandedNativeScoreFormula(field, fields) {
  const byId = new Map(fields.map(item => [String(item.id), item]));
  const raw = field.settings?.expanded_formula;
  if (raw == null) return raw;
  const formula = typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw);
  const scoreIds = new Set((field.settings?.linked_field_ids ?? []).filter(id => byId.get(String(id))?.field_type === 'score').map(String));
  if (!scoreIds.size) return raw;
  const variable = value => { const id = value?.var; return String(Array.isArray(id) ? id[0] : id); };
  if (formula?.if?.[0]?.and) formula.if[0].and = formula.if[0].and.filter(condition => !scoreIds.has(variable(condition?.['===']?.[0])));
  const expand = value => {
    if (Array.isArray(value)) return value.map(expand);
    if (!object(value)) return value;
    if ('var' in value && scoreIds.has(variable(value))) return expandedNativeScoreFormula(byId.get(variable(value)), fields);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expand(child)]));
  };
  const result = expand(formula);
  return typeof raw === 'string' ? JSON.stringify(result) : result;
}
function scoreDependencyOrder(fields) {
  const result = [], visited = new Set(), byId = new Map(fields.map(field => [field.id,field]));
  const visit = field => {
    if (visited.has(field.id)) return;
    visited.add(field.id);
    if (field.field_type === 'score') for (const id of field.settings?.linked_field_ids ?? []) { const dependency = byId.get(id); if (dependency) visit(dependency); }
    result.push(field);
  };
  fields.forEach(visit); return result;
}

function hasWeightedScoreArithmetic(value, operator = '+') {
  if (Array.isArray(value)) return value.some(child => hasWeightedScoreArithmetic(child, operator));
  return object(value) && Object.entries(value).some(([name,child]) => ['*','/','-'].includes(name) && name !== operator || name === '*' && Array.isArray(child) && child.some(term => typeof term === 'number') || hasWeightedScoreArithmetic(child, operator));
}

function remapSettings(settings, mapping) {
  const result = structuredClone(settings ?? {});
  for (const key of ['original_size_id','current_size_id']) if (result[key] != null) {
    const target = mapping[Number(result[key])];
    if (!id(target)) throw new Error(`Unresolved wound-size question ${result[key]}.`);
    result[key] = target;
  }
  if (result.linked_field_ids != null) {
    if (!Array.isArray(result.linked_field_ids)) throw new Error('Invalid linked score questions.');
    result.linked_field_ids = result.linked_field_ids.map(source => {
      if (!id(mapping[Number(source)])) throw new Error(`Unresolved score question ${source}.`);
      return mapping[Number(source)];
    });
  }
  if (result.expanded_formula != null) {
    let formula = result.expanded_formula;
    const encoded = typeof formula === 'string';
    if (encoded) {
      try { formula = JSON.parse(formula); } catch { throw new Error('A legacy formula cannot be remapped. Convert it to a supported formula before pushing.'); }
    }
    const mapped = remapLogic(formula,mapping);
    result.expanded_formula = encoded ? JSON.stringify(mapped) : mapped;
  }
  return result;
}
export function orderedDeploymentForms(packageValue) {
  const forms = new Map(packageValue.forms.map(form => [form.key,form]));
  const visited = new Set(), active = new Set(), ordered = [];
  function visit(formKey) {
    if (active.has(formKey)) throw new Error('Cyclic subform links cannot be deployed.');
    if (visited.has(formKey)) return;
    const form = forms.get(formKey);
    if (!form) throw new Error(`Missing child form ${formKey}.`);
    active.add(formKey);
    for (const link of form.links) visit(link.formKey);
    active.delete(formKey); visited.add(formKey); ordered.push(form);
  }
  visit(packageValue.parentKey);
  if (ordered.length !== forms.size) throw new Error('The package contains unrelated forms.');
  return ordered;
}
function orderedFields(fields) {
  const byId = new Map(fields.map(field => [field.id,field]));
  const result = [], visited = new Set(), active = new Set();
  function visit(field) {
    if (visited.has(field.id)) return;
    if (active.has(field.id)) throw new Error('Cyclic section structure.');
    active.add(field.id);
    if (field.parent_id) {
      const parent = byId.get(field.parent_id);
      if (!parent || !['section','subsection'].includes(parent.field_type)) throw new Error(`Question ${field.label} has an invalid section.`);
      visit(parent);
    }
    active.delete(field.id); visited.add(field.id); result.push(field);
  }
  [...fields].sort((a,b)=>a.rank-b.rank).forEach(visit);
  return result;
}
export function parseDraftDeployment(value) {
  if (!object(value) || value.format !== DEPLOYMENT_FORMAT || value.formatVersion !== 1 || value.targetOrigin !== UAT_ORIGIN || !key(value.packageId) || !key(value.parentKey) || !Array.isArray(value.forms) || !value.forms.length || value.forms.length > 50) throw new Error('Choose a Webforms draft-deployment package for Northern Health UAT.');
  if (JSON.stringify(value).length > 50_000_000) throw new Error('Choose a deployment package under 50 MB.');
  if (!Array.isArray(value.notes) || !value.notes.every(note => typeof note === 'string') || typeof value.createdAt !== 'string') throw new Error('Invalid deployment notes or timestamp.');
  const keys = new Set(); let total = 0;
  for (const form of value.forms) {
    if (!object(form) || !key(form.key) || keys.has(form.key) || !object(form.definition) || typeof form.definition.name !== 'string' || !form.definition.name.trim() || !Array.isArray(form.definition.fields) || !Array.isArray(form.links)) throw new Error('Invalid or duplicate deployment form.');
    if (!['form_regular','intake','task','event_task','ticket','visit_task','in_out','marketplace','family_portal','subform'].includes(form.definition.form_type)) throw new Error('Unsupported native form type.');
    keys.add(form.key);
    if (form.key !== value.parentKey && form.definition.form_type !== 'subform') throw new Error('A linked child must be a native subform.');
    if (form.source && (!id(form.source.id) || !object(form.source.definition) || form.source.definition.id !== form.source.id)) throw new Error('Invalid source baseline.');
    const fields = new Set(), links = new Map();
    for (const field of form.definition.fields) {
      if (!object(field) || !id(field.id) || fields.has(field.id) || !Number.isSafeInteger(field.parent_id) || field.parent_id < 0 || !Number.isSafeInteger(field.rank) || field.rank < 0 || typeof field.field_type !== 'string' || typeof field.label !== 'string' || (field.settings != null && !object(field.settings)) || (field.json_logic != null && !object(field.json_logic))) throw new Error('Invalid or duplicate deployment question.');
      fields.add(field.id);
      if (field.field_type === 'subsection') throw new Error('NH UAT permits native subsections only in OASIS. Convert this ordinary-form subsection to an information heading before deployment.');
    }
    total += fields.size;
    if (total > 10000) throw new Error('A deployment may contain at most 10,000 questions.');
    for (const link of form.links) {
      if (!object(link) || !id(link.fieldId) || !key(link.formKey) || links.has(link.fieldId) || !form.definition.fields.some(field=>field.id===link.fieldId && field.field_type==='subform')) throw new Error('Invalid subform link.');
      links.set(link.fieldId,link.formKey);
    }
    const identity = Object.fromEntries([...fields].map(fieldId=>[fieldId,fieldId]));
    for (const field of form.definition.fields) {
      if (field.field_type === 'score' && (!Array.isArray(field.settings?.linked_field_ids) || new Set(field.settings.linked_field_ids).size < 2 || field.settings.expanded_formula == null)) throw new Error(`Score “${field.label}” must link at least two questions and have a supported formula before pushing.`);
      if (field.field_type === 'score') {
        const rawFormula = field.settings.expanded_formula;
        const formula = typeof rawFormula === 'string' ? JSON.parse(rawFormula) : rawFormula;
        if (!['+','*'].includes(field.settings.operator) || hasWeightedScoreArithmetic(formula, field.settings.operator)) throw new Error(`Score “${field.label}” needs native calculation review. Draft push preserves native addition or multiplication of linked answers; the server regenerates coefficient-weighted formulas.`);
      }
      if (field.field_type === 'subform' && !links.has(field.id)) throw new Error(`Subform ${field.label} needs a captured or authored child definition.`);
      remapLogic(field.json_logic ?? {},identity); remapSettings(field.settings,identity);
    }
    const graphProblems = nativeScoreGraphProblems(form.definition.fields);
    if (graphProblems.length) throw new Error(graphProblems[0].reason);
    orderedFields(form.definition.fields);
  }
  orderedDeploymentForms(value);
  return value;
}
export async function previewDraftDeployment(value, read) {
  const packageValue = parseDraftDeployment(value);
  for (const form of packageValue.forms) {
    if (!form.source) continue;
    const fresh = await read(`${FORM_PATH}/${form.source.id}`);
    if (fresh?.id !== form.source.id || await deploymentDigest(sourceSnapshot(fresh)) !== await deploymentDigest(sourceSnapshot(form.source.definition))) throw new Error(`Source form ${form.source.id} changed since capture. Export it again before pushing edits.`);
  }
  return { packageId:packageValue.packageId, digest:await deploymentDigest(packageValue), targetOrigin:UAT_ORIGIN, forms:orderedDeploymentForms(packageValue).map(form=>({key:form.key,name:form.definition.name,type:form.definition.form_type,questions:form.definition.fields.length,sourceId:form.source?.id})), mode:'Create new draft copies; leave publication to the native workflow' };
}
/** Native builder conversion expects an and/or group even for a single comparison. */
export function nativeDisplayRule(rule) {
  const normalized = (value) => {
    if (Array.isArray(value)) return value.map(normalized);
    if (!object(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === 'var' && typeof child === 'string' && /^\d+$/.test(child) ? Number(child) : normalized(child)]));
  };
  const result = normalized(rule ?? {});
  const operation = Object.keys(result)[0];
  return operation && !['and', 'or'].includes(operation) ? {and:[result]} : result;
}
function fieldBody(field, mapping, links, formIds, forms, withRules) {
  const body = pick(field,['rank','field_type','label','instructions','required','task_field','field_tag']);
  body.parent_id = field.parent_id ? mapping[field.parent_id] : 0;
  if (field.parent_id && !id(body.parent_id)) throw new Error('Missing deployed section.');
  body.json_logic = withRules ? nativeDisplayRule(remapLogic(field.json_logic ?? {},mapping)) : {};
  // All question IDs exist before score formulas / conditions are assigned.
  const settings = structuredClone(field.settings ?? {});
  if (withRules && field.field_type === 'score') {
    const ownForm = [...forms.values()].find(form => form.definition.fields.includes(field));
    if (ownForm) settings.expanded_formula = expandedNativeScoreFormula(field, ownForm.definition.fields);
  }
  body.settings = withRules ? remapSettings(settings,mapping) : settings;
  if (!withRules) { delete body.settings.expanded_formula; delete body.settings.linked_field_ids; delete body.settings.original_size_id; delete body.settings.current_size_id; }
  const linkedKey = links.get(field.id);
  if (linkedKey) {
    if (!id(formIds[linkedKey])) throw new Error('Child form was not created.');
    body.settings.subform_id = formIds[linkedKey];
    body.settings.subform_name = forms.get(linkedKey).definition.name;
  }
  return body;
}
function contains(actual, expected) {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value,index)=>contains(actual[index],value));
  if (object(expected)) return object(actual) && Object.entries(expected).every(([name,value])=>contains(actual[name],value));
  return actual === expected;
}
export async function executeDraftDeployment(value, approvedDigest, io) {
  const packageValue = parseDraftDeployment(value);
  const preview = await previewDraftDeployment(packageValue,path=>io.request('GET',path));
  if (preview.digest !== approvedDigest) throw new Error('The package changed after review. Preview it again.');
  const prior = await io.load(packageValue.packageId);
  if (prior) throw new Error('This package already has a deployment receipt. Inspect it before creating another package; automatic replay is disabled.');
  const receipt = { packageId:packageValue.packageId,digest:preview.digest,targetOrigin:UAT_ORIGIN,status:'running',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),formIds:{},fieldIds:{},verifiedForms:[],errors:[] };
  const checkpoint = async () => {receipt.updatedAt=new Date().toISOString(); await io.save(packageValue.packageId,structuredClone(receipt));};
  await checkpoint();
  let operation = 'Create drafts';
  try {
    const forms = new Map(packageValue.forms.map(form=>[form.key,form]));
    for (const form of orderedDeploymentForms(packageValue)) {
      operation = `Create draft ${form.definition.name}`;
      const metadata = pick(form.definition,FORM_WRITE_KEYS);
      const created = await io.request('POST',FORM_PATH,metadata);
      if (!id(created?.id)) throw new Error('A draft create response did not return a valid ID. Its outcome is uncertain; check the native form list.');
      receipt.formIds[form.key]=created.id; receipt.fieldIds[form.key]={}; await checkpoint();
      if (created.status !== 'draft') throw new Error('The server did not create a draft. Inspect the recorded form before continuing.');
      const mapping = receipt.fieldIds[form.key], links = new Map(form.links.map(link=>[link.fieldId,link.formKey]));
      for (const field of orderedFields(form.definition.fields)) {
        operation = `Create ${form.definition.name}: ${field.label}`;
        const createdField = await io.request('POST',`${FORM_PATH}/${created.id}/fields`,fieldBody(field,mapping,links,receipt.formIds,forms,false));
        if (!id(createdField?.id)) throw new Error('A question create response did not return a valid ID. Check the draft before any retry.');
        mapping[field.id]=createdField.id; await checkpoint();
      }
      for (const field of scoreDependencyOrder(form.definition.fields)) {
        operation = `Set rules for ${form.definition.name}: ${field.label}`;
        const body = {id:mapping[field.id],...fieldBody(field,mapping,links,receipt.formIds,forms,true)};
        await io.request('PUT',`${FORM_PATH}/${created.id}/fields/${mapping[field.id]}`,body);
      }
      operation = `Verify ${form.definition.name}`;
      const actual = await io.request('GET',`${FORM_PATH}/${created.id}`);
      if (actual?.id !== created.id || actual.status !== 'draft' || !contains(actual,metadata) || !Array.isArray(actual.fields) || actual.fields.length !== form.definition.fields.length) throw new Error('Draft read-back did not match its planned configuration.');
      for (const field of form.definition.fields) {
        const expected = fieldBody(field,mapping,links,receipt.formIds,forms,true);
        if (expected.field_tag == null) delete expected.field_tag; // The server generates missing tags.
        if (!contains(actual.fields.find(candidate=>candidate.id===mapping[field.id]),expected)) throw new Error(`Question ${field.label} did not match its read-back.`);
      }
      receipt.verifiedForms.push(form.key); await checkpoint();
    }
    receipt.status='verified';
  } catch (error) {
    receipt.status='partial';
    receipt.errors.push({operation,reason:error instanceof Error ? error.message : 'The operation failed. Inspect recorded drafts before retrying.'});
  }
  await checkpoint();
  return receipt;
}
