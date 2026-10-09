import test from "node:test";
import assert from "node:assert/strict";
import { captureDefinitions, definitionHash, formId, indexPath, loadFormIndex, readDefinitionInPage, UAT_ORIGIN } from "./capture.mjs";

const definition = (id, extra = {}) => ({ id, name: `Synthetic form ${id}`, fields: [], subforms: [], ...extra });

test("captures linked definitions, preserves unknown settings, removes author identities and deduplicates cycles", async () => {
  const parent = definition(1, {
    schema_version: 2, category_id: 12, restrict_submit_to: [3], future_flag: { value: true },
    create_user: { name: "Synthetic author" }, update_user_id: 10,
    fields: [{ id: 10, field_type: "subform", settings: { subform_id: 2, number_of_entries: 2, allow_entry_sharing: false } }],
    subforms: [{ id: 2, name: "Child", fields: [{ id: 20, field_type: "number" }] }],
  });
  const child = definition(2, { fields: [{ id: 20, field_type: "number", settings: { min: 1, max: 5 } }, { id: 21, field_type: "subform", settings: { subform_id: 1 } }] });
  const calls = [];
  const bundle = await captureDefinitions([1, 1], async path => {
    calls.push(path);
    return structuredClone(path.endsWith("/1") ? parent : child);
  });
  assert.deepEqual(calls, ["/api/v1/tasks/forms20/forms/1", "/api/v1/tasks/forms20/forms/2"]);
  assert.deepEqual(bundle.rootFormIds, [1]);
  assert.equal(bundle.coverage.selectedDefinitionsComplete, true);
  assert.deepEqual(bundle.forms[0].definition.subforms, parent.subforms);
  assert.deepEqual(bundle.forms[0].definition.fields, parent.fields);
  assert.deepEqual(bundle.forms[0].definition.future_flag, parent.future_flag);
  assert.deepEqual(bundle.forms[0].definition.restrict_submit_to, [3]);
  assert.equal("create_user" in bundle.forms[0].definition, false);
  assert.equal("update_user_id" in bundle.forms[0].definition, false);
  assert.equal(bundle.forms[0].sha256, await definitionHash(bundle.forms[0].definition));
  assert.notEqual(bundle.forms[0].sha256, await definitionHash({ ...bundle.forms[0].definition, schema_version: 3 }));
});

test("keeps a partial capture explicit when a referenced form is unavailable", async () => {
  const bundle = await captureDefinitions([1], async path => {
    if (path.endsWith("/2")) throw new Error("Private server body that must not be recorded");
    return definition(1, { fields: [{ field_type: "subform", settings: { subform_id: 2 } }] });
  });
  assert.equal(bundle.coverage.selectedDefinitionsComplete, false);
  assert.deepEqual(bundle.coverage.unresolvedSubformIds, [2]);
  assert.equal(bundle.failures.length, 1);
  assert.equal(JSON.stringify(bundle).includes("Private server body"), false);
});

test("does not accept a mismatched detail response as the selected definition", async () => {
  const bundle = await captureDefinitions([1], async () => definition(3));
  assert.equal(bundle.forms.length, 0);
  assert.equal(bundle.coverage.selectedDefinitionsComplete, false);
});

test("index pagination checks its count and avoids retaining author metadata", async () => {
  const calls = [];
  const items = await loadFormIndex(async path => {
    calls.push(path);
    const page = Number(new URL(path, UAT_ORIGIN).searchParams.get("page"));
    return { count: 2, total_pages: 2, items: [{ ...definition(page), status: "draft", create_user: { name: "Author" } }] };
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(items.map(item => item.id), [1, 2]);
  assert.equal("create_user" in items[0], false);
  await assert.rejects(loadFormIndex(async () => ({ count: 2, total_pages: 1, items: [definition(1)] })), /incomplete/);
  await assert.rejects(loadFormIndex(async path => ({ count: path.includes("page=1") ? 2 : 3, total_pages: 2, items: [definition(1)] })), /changed/);
});

test("page bridge only reads the exact UAT definition routes", async t => {
  const previousLocation = globalThis.location;
  globalThis.location = { origin: UAT_ORIGIN, hash: "#/system-settings/forms" };
  t.after(() => { if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation; });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return { ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => definition(1) };
  });
  await readDefinitionInPage("/api/v1/tasks/forms20/forms/1");
  await readDefinitionInPage(indexPath());
  for (const path of ["https://example.com/", "/api/v1/patients/1", "/api/v1/tasks/forms20/forms/1/submissions", "/api/v1/tasks/forms20/forms/1?anything=true", `${indexPath()}&status[]=deleted`, `${indexPath()}&page=2`]) {
    await assert.rejects(readDefinitionInPage(path), /Unsupported/);
  }
  globalThis.location.origin = "https://northernhealth.alayacare.ca";
  await assert.rejects(readDefinitionInPage("/api/v1/tasks/forms20/forms/1"), /Open Northern Health UAT/);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.credentials, "same-origin");
  assert.equal(requests[0].options.redirect, "error");
  assert.equal("headers" in requests[0].options, false);
});

test("form IDs reject arbitrary paths", () => {
  for (const id of [0, -1, "../submissions", 1.2, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => formId(id));
});
test("optional version capture reads each schema once and captures older IDs", async () => {
  const schema = "12345678-1234-1234-1234-123456789012";
  const calls = [];
  const capture = await captureDefinitions([2], async path => {
    calls.push(path);
    if (path.includes("schema_id=")) return { count: 2, total_pages: 1, items: [{ id: 1, schema_id: schema }, { id: 2, schema_id: schema }] };
    return definition(path.endsWith("/2") ? 2 : 1, { schema_id: schema });
  }, undefined, { includeVersions: true, includeArchived: true });
  assert.deepEqual(capture.forms.map(form => form.id), [2, 1]);
  assert.equal(calls.filter(path => path.includes("schema_id=")).length, 1);
  assert.equal(capture.coverage.selectedDefinitionsComplete, true);
  assert.equal(capture.coverage.excluded.includes("Older form versions"), false);
  const partial = await captureDefinitions([2], async path => path.includes("schema_id=") ? { count: 201, total_pages: 2, items: [] } : definition(2, { schema_id: schema }), undefined, { includeVersions: true });
  assert.equal(partial.coverage.selectedDefinitionsComplete, false);
  assert.match(partial.failures[0].reason, /Version history/);
});

test('captures tenant choices, strips role permissions and fingerprints clinical schemas',async()=>{
 const {captureTenantConfiguration,TENANT_CONFIGURATION_PATHS}=await import('./capture.mjs');
 const read=async path=>{
  if(path.includes('/employees/roles'))return {items:[{id:1,description:'Nurse',permissions:['SECRET_PERMISSION_BODY']}],count:1,total_pages:1};
  if(path.includes('formcategories'))return {items:[{id:2,name:'Clinical'}],count:1,total_pages:1};
  if(path.includes('progress_note_types'))return [{progress_note_types:{nursing:'Nursing'}}];
  if(path.includes('profile_attributes'))return {items:[{tag:'custom',input_type:'text'}],count:1};
  if(path.includes('entity_definitions'))return [{fields:[{field_key:'name',field_type:'text'}]}];
  if(path.includes('medication/form_fields'))return {routes:[{name:'oral'}]};
  return definition(7);
 };
 const config=await captureTenantConfiguration(read);
 assert.equal(config.complete,true);assert.deepEqual(config.roles,[{id:1,label:'Nurse'}]);assert.equal(JSON.stringify(config).includes('SECRET_PERMISSION_BODY'),false);
 assert.equal(config.clinicalEntities.vital.length,1);
 const capture=await captureDefinitions([7],read,undefined,{includeTenantConfiguration:true});
 assert.equal(capture.tenantConfigurationSha256,await definitionHash(capture.tenantConfiguration));
 const incomplete=await captureTenantConfiguration(async path=>path===TENANT_CONFIGURATION_PATHS[3]?{items:[],count:1}:read(path));
 assert.equal(incomplete.complete,false);assert.equal(incomplete.failures.length,1);
});

test('tenant catalogs reject duplicate IDs and incomplete pagination',async()=>{
 const {captureTenantConfiguration}=await import('./capture.mjs');
 const result=await captureTenantConfiguration(async()=>({items:[{id:1,description:'One'}],count:2,total_pages:1}));
 assert.equal(result.complete,false);assert.equal(result.roles.length,0);assert.equal(result.categories.length,0);
});
