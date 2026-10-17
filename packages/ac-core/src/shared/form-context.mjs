export const FORM_CONTEXT_FORMAT = 'webforms-alayacare-form-context';
export const FORM_CONTEXT_DEPLOYMENT_FORMAT = 'webforms-alayacare-form-context-deployment';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const items = value => Array.isArray(value) ? value : record(value) && Array.isArray(value.items) ? value.items : null;
function completeItems(value, label) {
 const result=items(value);
 if(!result||result.some(item=>!record(item))||result.length>2500)throw new Error(`${label} definition list is invalid or exceeds capture limit.`);
 if(record(value)){
  for(const key of ['total_pages','totalPages','page'])if(value[key]!==undefined&&(!Number.isSafeInteger(Number(value[key]))||Number(value[key])!==1))throw new Error(`${label} definition list is incomplete (pagination).`);
  for(const key of ['count','total','total_count','totalCount'])if(value[key]!==undefined&&(!Number.isSafeInteger(Number(value[key]))||Number(value[key])<0||Number(value[key])!==result.length))throw new Error(`${label} definition list is incomplete (declared count).`);
  if(value.next_page||value.next||record(value.links)&&value.links.next)throw new Error(`${label} definition list is incomplete (next page).`);
 }
 return result;
}
const stable = value => Array.isArray(value) ? value.map(stable) : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export async function definitionHash(value) { const data = new TextEncoder().encode(JSON.stringify(stable(value))); return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), byte => byte.toString(16).padStart(2, '0')).join(''); }
const unsigned = value => { const { sha256, ...rest } = value; return rest; };
function origin(value) { const url = new URL(value); if (url.protocol !== 'https:' || url.origin !== value || !url.hostname.endsWith('.alayacare.ca')) throw new Error('Choose an HTTPS AlayaCare tenant origin.'); return value; }
function records(value, name, max = 2500) { if (!Array.isArray(value) || value.length > max || value.some(item => !record(item))) throw new Error(`Invalid ${name} definitions.`); return value; }
function base(value, format) { if (!record(value) || value.format !== format || value.formatVersion !== 1 || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('Invalid Form Context package.'); origin(value.sourceOrigin); if (JSON.stringify(value).length > 20_000_000) throw new Error('Form Context package exceeds 20 MB.'); }
export function parseFormContextArchive(value) { base(value, FORM_CONTEXT_FORMAT); for (const key of ['contexts','fields','roles','families','fieldTypes','profileAttributes']) records(value[key], key); if(value.optionCatalogs!==undefined){if(!record(value.optionCatalogs)||Object.keys(value.optionCatalogs).some(key=>!['countries','genders'].includes(key)))throw new Error('Invalid option catalogs.');records(value.optionCatalogs.countries,'countries');records(value.optionCatalogs.genders,'genders');} if (typeof value.complete !== 'boolean' || !Array.isArray(value.failures) || value.failures.length > 10000 || value.failures.some(item => !record(item) || typeof item.path !== 'string' || typeof item.reason !== 'string') || typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt))) throw new Error('Invalid archive coverage.'); if (value.complete && value.failures.length) throw new Error('Complete archive cannot contain failed reads.'); return clone(value); }
export async function verifyFormContextArchive(value) { const archive = parseFormContextArchive(value); if (archive.sha256 !== await definitionHash(unsigned(archive))) throw new Error('Form Context archive digest does not match.'); return archive; }
export async function captureFormContextArchive(read, sourceOrigin) {
 origin(sourceOrigin);
 const failures = [];
 async function get(path, list = false) { try { const value = await read(path); if (list) { return clone(completeItems(value,path)); } if (!record(value)) throw new Error('Expected a native definition.'); return clone(value); } catch(error) { failures.push({path, reason: error instanceof Error ? error.message : 'Read failed.'}); return list ? [] : null; } }
 const contexts = await get('/api/v1/agency/form-context/contexts', true);
 const index = await get('/api/v1/agency/form-context/fields?include_contexts=true', true);
 const roles = await get('/api/v1/employees/roles', true);
 const families = await get('/api/v1/agency/form-context/families', true);
 const fieldTypes = await get('/api/v1/agency/form-context/field-types', true);
 const profileAttributes = await get('/api/v1/config/profile_attributes', true);
 const countries = await get('/api/v1/config/countries?only_supported=true&include_subdivisions=false',true);
 let genders=[];
 try{const configuration=await read('/api/v1/config/');const values=completeItems(record(configuration)?configuration.genders:undefined,'Genders');genders=clone(values);}catch(error){failures.push({path:'/api/v1/config/ (genders only)',reason:error instanceof Error?error.message:'Read failed.'});}
 const fields = new Array(index.length);
 let nextIndex=0;
 const captureField=async (entry, indexPosition) => {
   if (!Number.isSafeInteger(Number(entry.id)) || Number(entry.id) < 1) { failures.push({path:'fields',reason:'Field has no valid native ID; detailed read missing.'}); fields[indexPosition]=entry; return; }
   const path = `/api/v1/agency/form-context/fields/${entry.id}`;
   let detail = await get(path);
   if(detail && Number(detail.id)!==Number(entry.id)){failures.push({path,reason:'Native detail returned a different or missing field ID.'});detail=null;}
   const field = detail ? {...entry, ...detail} : entry;
   const nativeAssignments = Array.isArray(field.contexts) ? field.contexts : Array.isArray(entry.contexts) ? entry.contexts : null;
   const assignments = nativeAssignments?.length<=64 ? nativeAssignments : null;
   if (!assignments) failures.push({path,reason:'Assigned context list missing.'});
   field.contexts = [];
   for (const assignment of assignments ?? []) {
     const name = typeof assignment.context === 'string' ? assignment.context : record(assignment.context) ? assignment.context.name : assignment.context_name;
     if (typeof name !== 'string' || !/^[A-Za-z_]{1,100}$/.test(name)) { failures.push({path,reason:'Assigned native context code is invalid.'}); field.contexts.push(assignment); continue; }
     let override = await get(`${path}/contexts/${encodeURIComponent(name)}`);
     if(override && override.context!==name){failures.push({path:`${path}/contexts/${encodeURIComponent(name)}`,reason:'Native override returned a different or missing context code.'});override=null;}
     field.contexts.push(override ? {...assignment, ...override} : assignment);
   }
   fields[indexPosition]=field;
 };
 await Promise.all(Array.from({length:Math.min(4,index.length)},async()=>{while(nextIndex<index.length){const indexPosition=nextIndex++;await captureField(index[indexPosition],indexPosition);}}));
 const archive = {format:FORM_CONTEXT_FORMAT,formatVersion:1,sourceOrigin,capturedAt:new Date().toISOString(),complete:failures.length===0,failures,contexts,fields,roles,families,fieldTypes,profileAttributes,optionCatalogs:{countries,genders}};
 return {...archive,sha256:await definitionHash(archive)};
}
function validateFields(fields) { records(fields, 'proposed fields', 100); if (!fields.length) throw new Error('Select at least one new field.'); const tags = new Set(); for(const field of fields) { if (field.id !== undefined) throw new Error('Only new fields can be deployed; remove native IDs.'); if (typeof field.tag !== 'string' || !/^[a-z][a-z0-9_]{1,99}$/.test(field.tag) || tags.has(field.tag)) throw new Error('New fields need unique stable lowercase tags.'); tags.add(field.tag); if(typeof field.description !== 'string' || !field.description.trim() || typeof field.type !== 'string' || !field.type || field.family === undefined) throw new Error('Description, input type and family are required.'); records(field.contexts ?? [],'field contexts',12); if(new Set((field.contexts??[]).map(assignment=>assignment.context)).size!==(field.contexts??[]).length)throw new Error('Each proposed field can assign a context only once.'); } }
export async function prepareFormContextDeployment(value, fields) { const archive = await verifyFormContextArchive(value); if(!archive.complete) throw new Error('Capture all native definitions before preparing deployment.'); fields=clone(fields); for(const field of fields){if(record(field.family)&&field.family.id===undefined&&typeof field.family.name==='string'){const matches=archive.families.filter(family=>family.name===field.family.name);if(matches.length!==1)throw new Error('The offline family name has no unique captured native ID.');field.family={...matches[0],...field.family,id:matches[0].id};}} validateFields(fields); for(const field of fields) { if (archive.fields.some(existing => existing.tag === field.tag)) throw new Error(`Tag ${field.tag} already exists; existing fields are not changed.`); for(const assignment of field.contexts ?? []) { if(typeof assignment.context !== 'string' || !archive.contexts.some(context => (context.context ?? context.name) === assignment.context)) throw new Error('Choose a captured native context.'); } } const packageValue = {format:FORM_CONTEXT_DEPLOYMENT_FORMAT,formatVersion:1,sourceOrigin:archive.sourceOrigin,archiveSha256:archive.sha256,preparedAt:new Date().toISOString(),mode:'create-only',fields:clone(fields)}; return {...packageValue,sha256:await definitionHash(packageValue)}; }
export function parseFormContextDeployment(value) { base(value,FORM_CONTEXT_DEPLOYMENT_FORMAT); if(value.mode !== 'create-only' || typeof value.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.archiveSha256) || typeof value.preparedAt !== 'string' || !Number.isFinite(Date.parse(value.preparedAt))) throw new Error('Invalid create-only deployment.'); validateFields(value.fields); return clone(value); }
export async function verifyFormContextDeployment(value) { const packageValue = parseFormContextDeployment(value); if(packageValue.sha256 !== await definitionHash(unsigned(packageValue))) throw new Error('Deployment digest does not match.'); return packageValue; }
const CREATE_KEYS = new Set(['tag','description','type','family','is_required','enabled_for_mobile','include_in_global_search','help_text','options','minimum_length','maximum_length']);
const SERVER_KEYS = new Set(['is_default','is_readonly','is_readonly_value','sort_order','context_restrictions']);
function createBody(field) {
 for(const [key,value] of Object.entries(field)) { if(key==='contexts'||CREATE_KEYS.has(key)) continue; if(SERVER_KEYS.has(key)) { if((key==='context_restrictions' && Array.isArray(value) && !value.length) || key==='sort_order' || value===false) continue; } if(['mask','minimum_length','maximum_length','minimum_value','maximum_value','multiple_of'].includes(key) && value==null) continue; throw new Error(`Native creation of ${key} has not been verified; keep it in the archive and remove it from this proposed creation.`); }
 const body=Object.fromEntries(Object.entries(field).filter(([key])=>CREATE_KEYS.has(key)));
 body.family=record(body.family)?body.family.id:body.family;
 if(!Number.isSafeInteger(body.family)||body.family<0)throw new Error('Choose a captured numeric family ID.');
 return body;
}
function assignmentBody(assignment) { for(const key of Object.keys(assignment)) if(!['context','exclude_from_roles','is_required','label'].includes(key)) throw new Error(`Native context override ${key} has not been verified.`); if(!Array.isArray(assignment.exclude_from_roles)||assignment.exclude_from_roles.some(value=>!Number.isSafeInteger(value)||value<1))throw new Error('Context role exclusions must be explicit native role IDs.'); if(assignment.is_required!==undefined && assignment.is_required!==null && typeof assignment.is_required!=='boolean')throw new Error('Required override must be null, true or false.'); if(assignment.label!==undefined && assignment.label!==null && typeof assignment.label!=='string')throw new Error('Invalid context label.'); return {context:assignment.context,exclude_from_roles:[...assignment.exclude_from_roles],is_required:assignment.is_required??null,label:assignment.label??null}; }
function sameRequested(expected,actual) { return record(actual) && Object.entries(expected).every(([key,value])=>JSON.stringify(stable(value))===JSON.stringify(stable(key==='family'?record(actual.family)?actual.family.id:actual.family:actual[key]))); }
async function deploymentPreflight(value,io,existingReceipt=false) {
 const packageValue=await verifyFormContextDeployment(value);
 if(packageValue.sourceOrigin!==io.sourceOrigin)throw new Error('Deployment belongs to a different tenant.');
 const index=completeItems(await io.read('/api/v1/agency/form-context/fields?include_contexts=true'),'Fields');
 const contexts=completeItems(await io.read('/api/v1/agency/form-context/contexts'),'Contexts'); const types=completeItems(await io.read('/api/v1/agency/form-context/field-types'),'Field types');const families=completeItems(await io.read('/api/v1/agency/form-context/families'),'Families');const roles=completeItems(await io.read('/api/v1/employees/roles'),'Roles');
 if(!contexts||!types||!families||!roles)throw new Error('Current native configuration catalogs unavailable.');
 for(const field of packageValue.fields) { const body=createBody(field);if(!types.some(type=>type.name===body.type)||!families.some(family=>family.id===body.family))throw new Error('The selected native input type or family no longer exists.');if(!existingReceipt&&index.some(existing=>existing.tag===field.tag))throw new Error(`Tag ${field.tag} already exists; existing fields are never changed.`);for(const override of field.contexts??[]){const assignment=assignmentBody(override);if(!contexts.some(context=>(context.context??context.name)===assignment.context))throw new Error('Native context no longer exists.');if(assignment.exclude_from_roles.some(id=>!roles.some(role=>role.id===id)))throw new Error('Excluded role no longer exists.');if(Array.isArray(field.context_restrictions)&&field.context_restrictions.length&&!field.context_restrictions.includes(assignment.context))throw new Error('Context violates field restrictions.');}}
 return {packageValue,index};
}
export async function previewFormContextDeployment(value,io){const parsed=await verifyFormContextDeployment(value);const prior=await readFormContextReceipt(parsed.sha256,io);const {packageValue}=await deploymentPreflight(value,io,!!prior);return {digest:packageValue.sha256,sourceOrigin:io.sourceOrigin,fields:packageValue.fields.map(field=>({tag:field.tag,description:field.description,contexts:(field.contexts??[]).map(assignment=>assignment.context)})),mode:'Create new tenant configuration only; existing fields are never changed.'};}
const receiptKey=(origin,digest)=>`ac-tools-form-context:${origin}:${digest}`;
export async function readFormContextReceipt(digest,io){if(!/^[a-f0-9]{64}$/.test(digest))throw new Error('Invalid receipt digest.');return io.store.get(receiptKey(io.sourceOrigin,digest));}
export async function executeFormContextDeployment(value,approvedDigest,io){
 const packageValue=await verifyFormContextDeployment(value);if(packageValue.sha256!==approvedDigest||packageValue.sourceOrigin!==io.sourceOrigin)throw new Error('Review the exact package in this tenant before applying.');
 let receipt=await readFormContextReceipt(approvedDigest,io);
 if(receipt&&(receipt.digest!==approvedDigest||receipt.sourceOrigin!==io.sourceOrigin))throw new Error('Receipt tenant/digest mismatch.');
 if(receipt?.status==='verified')return receipt;
 const {index}=await deploymentPreflight(packageValue,io,!!receipt);
 const save=async()=>{receipt.updatedAt=new Date().toISOString();await io.store.set(receiptKey(io.sourceOrigin,approvedDigest),receipt);};
 if(!receipt){receipt={digest:approvedDigest,sourceOrigin:io.sourceOrigin,status:'running',steps:packageValue.fields.map(field=>({tag:field.tag,state:'pending',contexts:[]})),updatedAt:new Date().toISOString()};await save();}
 if(receipt.steps.length!==packageValue.fields.length||receipt.steps.some((step,i)=>step.tag!==packageValue.fields[i].tag))throw new Error('Receipt does not match proposed field order.');
 for(let i=0;i<packageValue.fields.length;i++){
  const field=packageValue.fields[i],step=receipt.steps[i];if(step.state==='verified')continue;
  const body=createBody(field);let fieldId=step.fieldId;
  try{
   if(!fieldId && step.state==='failed')throw new Error('Creation was not dispatched. This failed step cannot adopt an existing field; prepare a new package after native review.');
   if(!fieldId && step.state!=='pending'){
    const fresh=completeItems(await io.read('/api/v1/agency/form-context/fields?include_contexts=true'),'Fields');const matches=fresh?.filter(candidate=>candidate.tag===field.tag)??[];
    if(matches.length!==1)throw new Error('Creation outcome is uncertain. No unique stable tag was found; automatic repost is disabled.');
    const detail=await io.read(`/api/v1/agency/form-context/fields/${matches[0].id}`);
    if(!sameRequested(body,detail))throw new Error('The stable tag exists with different settings; automatic overwrite is disabled.');
    fieldId=matches[0].id;step.fieldId=fieldId;step.state='created';await save();
   }
   if(!fieldId){
    const fresh=completeItems(await io.read('/api/v1/agency/form-context/fields?include_contexts=true'),'Fields');if(!fresh||fresh.some(candidate=>candidate.tag===field.tag))throw new Error('Stable tag became unavailable; no existing field will be changed.');
    step.state='creating';await save();
    const created=await io.request('POST','/api/v1/agency/form-context/fields',body);
    if(!record(created)||!Number.isSafeInteger(created.id)||created.id<1)throw new Error('Native creation returned no valid ID.');
    fieldId=created.id;step.fieldId=fieldId;step.state='created';await save();
   }
   const detail=await io.read(`/api/v1/agency/form-context/fields/${fieldId}`);if(!sameRequested(body,detail))throw new Error('Created field read-back does not match requested settings.');
   for(const override of field.contexts??[]){
    const assignment=assignmentBody(override);if(step.contexts.includes(assignment.context))continue;
    const path=`/api/v1/agency/form-context/fields/${fieldId}/contexts`,contextPath=`${path}/${encodeURIComponent(assignment.context)}`;
    const latest=await io.read(`/api/v1/agency/form-context/fields/${fieldId}`);const existing=Array.isArray(latest.contexts)?latest.contexts.find(item=>item.context===assignment.context):undefined;
    if(!existing){
     if(step.state==='assigning'||step.state==='uncertain')throw new Error('Context creation outcome is uncertain; automatic repost is disabled.');
     step.state='assigning';await save();await io.request('POST',path,{context:assignment.context,exclude_from_roles:assignment.exclude_from_roles});
    }
    const current=await io.read(contextPath);
    if(JSON.stringify(stable(current.exclude_from_roles))!==JSON.stringify(stable(assignment.exclude_from_roles)))throw new Error('Native role exclusions differ; this workflow cannot expand or change existing access.');
    if(!sameRequested(assignment,current)){step.state='assigning';await save();await io.request('PUT',contextPath,{is_required:assignment.is_required,label:assignment.label});}
    const actual=await io.read(contextPath);if(!sameRequested(assignment,actual))throw new Error('Assigned context read-back does not match label, required override or role exclusions.');
    step.contexts.push(assignment.context);step.state='created';await save();
   }
   step.state='verified';await save();
  }catch(error){step.error=error instanceof Error?error.message:'Native operation failed.';step.state=step.state==='creating'||step.state==='assigning'||step.state==='uncertain'?'uncertain':'failed';receipt.status=step.state==='uncertain'?'uncertain':'failed';await save();return receipt;}
 }
 receipt.status='verified';await save();return receipt;
}
