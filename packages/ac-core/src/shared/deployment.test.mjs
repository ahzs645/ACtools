import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEPLOYMENT_FORMAT,parseDraftDeployment,previewDraftDeployment,executeDraftDeployment,remapLogic,nativeDisplayRule} from './deployment.mjs';
import {nativeFormRequest} from './native-transport.mjs';
import {UAT_ORIGIN,FORM_PATH} from './capture.mjs';
const field=(id,label,type='text',extra={})=>({id,label,field_type:type,parent_id:0,rank:id,required:false,instructions:'',task_field:false,json_logic:{},settings:{},...extra});
function bundle(){return {format:DEPLOYMENT_FORMAT,formatVersion:1,packageId:'test-package',createdAt:'2026-10-08T00:00:00Z',targetOrigin:UAT_ORIGIN,parentKey:'parent',notes:[],forms:[{key:'parent',definition:{name:'Parent',form_type:'form_regular',fields:[field(1,'Section','section'),field(2,'Rows','subform',{parent_id:1}),field(3,'Condition','text',{parent_id:1,json_logic:{'==':[{var:4},'yes']}}),field(4,'Controller')]},links:[{fieldId:2,formKey:'child'}]},{key:'child',definition:{name:'Row',form_type:'subform',fields:[field(1,'Row text','text',{required:true}),field(2,'Row number','number'),field(3,'Second row number','number'),field(4,'Row score','score',{settings:{operator:'+',linked_field_ids:[2,3],expanded_formula:{'+':[{var:'2'},{var:3}]}}})]},links:[]}]};}
function server({fail,corrupt}={}){let nextForm=200,nextField=2000;const forms=new Map(),receipts=new Map(),calls=[];return {forms,receipts,calls,request:async(method,path,body)=>{calls.push({method,path,body:structuredClone(body)});if(fail?.(method,path,body))throw new Error('Synthetic network failure');if(method==='POST'&&path===FORM_PATH){const form={...structuredClone(body),id:++nextForm,status:'draft',fields:[]};forms.set(form.id,form);return structuredClone(form);}const parts=path.slice(FORM_PATH.length+1).split('/');const form=forms.get(Number(parts[0]));if(method==='GET')return corrupt?corrupt(structuredClone(form)):structuredClone(form);if(method==='POST'){const field={...structuredClone(body),id:++nextField};form.fields.push(field);return structuredClone(field);}if(method==='PUT'){const field=form.fields.find(field=>field.id===Number(parts[2]));Object.assign(field,structuredClone(body));return structuredClone(field);}throw new Error('Unknown path');},load:async id=>receipts.get(id),save:async(id,value)=>receipts.set(id,structuredClone(value))};}
test('creates child first, maps parent sections and rules, and verifies each draft',async()=>{const pkg=bundle(),io=server();const preview=await previewDraftDeployment(pkg,io.request);assert.deepEqual(preview.forms.map(form=>form.key),['child','parent']);const receipt=await executeDraftDeployment(pkg,preview.digest,io);assert.equal(receipt.status,'verified');assert.deepEqual(receipt.verifiedForms,['child','parent']);const parent=io.forms.get(receipt.formIds.parent),child=io.forms.get(receipt.formIds.child);assert.equal(parent.fields.find(field=>field.label==='Rows').settings.subform_id,child.id);assert.equal(parent.fields.find(field=>field.label==='Rows').parent_id,receipt.fieldIds.parent[1]);assert.deepEqual(parent.fields.find(field=>field.label==='Condition').json_logic,{and:[{'==':[{var:receipt.fieldIds.parent[4]},'yes']}]});assert.deepEqual(child.fields[3].settings.expanded_formula,{'+':[{var:String(receipt.fieldIds.child[2])},{var:receipt.fieldIds.child[3]}]});assert.deepEqual(child.fields[3].settings.linked_field_ids,[receipt.fieldIds.child[2],receipt.fieldIds.child[3]]);assert(io.calls.every(call=>!call.path.includes('publish')&&!call.path.includes('delete')));assert(io.calls.filter(call=>call.method==='PUT').every(call=>call.path.includes('/201/')||call.path.includes('/202/')));});
test('stale source and changed reviewed package perform no writes',async()=>{const pkg=bundle();pkg.forms[0].source={id:10,definition:{id:10,name:'Baseline',fields:[]}};const io=server();io.forms.set(10,{id:10,name:'Changed',fields:[]});await assert.rejects(previewDraftDeployment(pkg,path=>io.request('GET',path)),/changed since capture/);assert.equal(io.calls.filter(call=>call.method!=='GET').length,0);delete pkg.forms[0].source;const preview=await previewDraftDeployment(pkg,io.request);pkg.forms[0].definition.name='Edited after review';await assert.rejects(executeDraftDeployment(pkg,preview.digest,io),/changed after review/);assert.equal(io.forms.size,1);});
test('partial creation is recorded and automatic replay is refused',async()=>{const pkg=bundle(),io=server({fail:(method,path,body)=>method==='POST'&&body?.label==='Row number'});const preview=await previewDraftDeployment(pkg,io.request);const receipt=await executeDraftDeployment(pkg,preview.digest,io);assert.equal(receipt.status,'partial');assert.equal(receipt.formIds.child,201);assert.equal(receipt.fieldIds.child[1],2001);assert.equal(receipt.formIds.parent,undefined);assert.match(receipt.errors[0].operation,/Row number/);const before=io.calls.length;await assert.rejects(executeDraftDeployment(pkg,preview.digest,io),/already has a deployment receipt/);assert.equal(io.calls.length,before);});
test('readback mismatch is partial, not a false success',async()=>{const pkg=bundle(),io=server({corrupt:form=>({...form,fields:form.fields.map(field=>({...field,required:false}))})});const preview=await previewDraftDeployment(pkg,io.request);assert.equal((await executeDraftDeployment(pkg,preview.digest,io)).status,'partial');});
test('rejects missing links, dangling rules, section cycles, unrelated definitions and wrong origin',()=>{let pkg=bundle();pkg.forms[0].links=[];assert.throws(()=>parseDraftDeployment(pkg),/needs a captured/);pkg=bundle();pkg.forms[0].definition.fields[2].json_logic={var:999};assert.throws(()=>parseDraftDeployment(pkg),/Unresolved/);pkg=bundle();pkg.forms[0].definition.fields[0].parent_id=1;assert.throws(()=>parseDraftDeployment(pkg),/Cyclic section/);pkg=bundle();pkg.forms[1].definition.fields.push(field(9,'Loop','subform'));pkg.forms[1].links.push({fieldId:9,formKey:'parent'});assert.throws(()=>parseDraftDeployment(pkg),/Cyclic subform/);assert.throws(()=>parseDraftDeployment({...bundle(),targetOrigin:'https://other.alayacare.ca'}));});
test('remaps numeric variables, preserves chart variables and fallback values',()=>{assert.deepEqual(remapLogic({and:[{var:['10',false]},{var:'chart.sex'}]}, {10:100}),{and:[{var:['100',false]},{var:'chart.sex'}]});});
test('native transport uses configured AJAX without extracting session secrets',async()=>{const calls=[];const host={location:{origin:UAT_ORIGIN,hash:'#/system-settings/forms'},jQuery:{ajax:async options=>{calls.push(options);return {id:1};}}};await nativeFormRequest('POST',FORM_PATH,{name:'Synthetic'},host);assert.equal(calls[0].contentType,'application/json');assert.equal(calls[0].headers,undefined);await assert.rejects(nativeFormRequest('PUT',`${FORM_PATH}/1/publish`,{},host));await assert.rejects(nativeFormRequest('POST',`${FORM_PATH}?url=other`,{},host));await assert.rejects(nativeFormRequest('POST',FORM_PATH,{}, {...host,location:{origin:'https://other.alayacare.ca',hash:host.location.hash}}));await assert.rejects(nativeFormRequest('GET',`${FORM_PATH}/1`,undefined,{...host,jQuery:{ajax:async()=>{throw {status:403,responseText:'SECRET'};}}}),error=>error.message.includes('403')&&!error.message.includes('SECRET'));});

test('blocks score weights before any native creation',()=>{const pkg=bundle();pkg.forms[1].definition.fields[3].settings.expanded_formula={'*':[{var:2},2]};assert.throws(()=>parseDraftDeployment(pkg),/server regenerates coefficient-weighted/);});

test('remaps wound references and accepts native products with no coefficients',async()=>{
 const pkg=bundle();pkg.forms[1].definition.fields[3].settings={operator:'*',linked_field_ids:[2,3],expanded_formula:{'*':[{var:['2',1]},{var:['3',1]}]}};
 pkg.forms[1].definition.fields.push(field(5,'Wound','wound_healing',{settings:{original_size_id:2,current_size_id:3,expanded_formula:{'*':[{ '/':[{ '-':[{var:'2'},{var:'3'}]},{var:'2'}]},100]}}}));
 const io=server(),preview=await previewDraftDeployment(pkg,io.request),receipt=await executeDraftDeployment(pkg,preview.digest,io);
 assert.equal(receipt.status,'verified');const wound=io.forms.get(receipt.formIds.child).fields.find(field=>field.label==='Wound');
 assert.equal(wound.settings.original_size_id,receipt.fieldIds.child[2]);assert.equal(wound.settings.current_size_id,receipt.fieldIds.child[3]);
});

test('blocks OASIS-only subsections in ordinary draft packages before writing',()=>{
 const pkg=bundle();pkg.forms[1].definition.fields.push(field(5,'Restricted','subsection'));assert.throws(()=>parseDraftDeployment(pkg),/only in OASIS/);
});


test('writes score dependencies first and verifies an inlined two-stage native formula', async()=>{
 const pkg=bundle(), fields=pkg.forms[1].definition.fields;
 const sum=fields.find(field=>field.field_type==='score');
 sum.settings.expanded_formula={if:[{and:[{'===':[{var:2},null]},{'===':[{var:3},null]}]},0,{'+':[{var:['2',0]},{var:['3',0]}]}]};
 const product=field(5,'Two stage','score',{settings:{operator:'*',linked_field_ids:[4,2],expanded_formula:{if:[{and:[{'===':[{var:4},null]},{'===':[{var:2},null]}]},0,{'*':[{var:['4',1]},{var:['2',1]}]}]}}});
 fields.unshift(product);
 const io=server(),preview=await previewDraftDeployment(pkg,io.request),receipt=await executeDraftDeployment(pkg,preview.digest,io);
 assert.equal(receipt.status,'verified');
 const puts=io.calls.filter(call=>call.method==='PUT'&&call.path.includes('/'+receipt.formIds.child+'/'));
 assert(puts.findIndex(call=>call.body.label==='Row score')<puts.findIndex(call=>call.body.label==='Two stage'));
 const actual=io.forms.get(receipt.formIds.child).fields.find(field=>field.label==='Two stage');
 assert.equal(actual.settings.expanded_formula.if[0].and.length,1);
 assert.deepEqual(actual.settings.expanded_formula.if[2]['*'][0],io.forms.get(receipt.formIds.child).fields.find(field=>field.label==='Row score').settings.expanded_formula);
 fields.push(field(6,'Third stage','score',{settings:{operator:'+',linked_field_ids:[5,2],expanded_formula:{'+':[{var:5},{var:2}]}}}));
 assert.throws(()=>parseDraftDeployment(pkg),/two score stages/);
});

// NH UAT accepts a bare comparison but its builder crashes while reopening it.
test('uses native grouped display rules with numeric question IDs without changing formulas',()=>{
 const comparison={'==':[{var:'10'},true]};
 assert.deepEqual(nativeDisplayRule(comparison),{and:[{'==':[{var:10},true]}]});
 assert.deepEqual(nativeDisplayRule({and:[comparison]}),{and:[{'==':[{var:10},true]}]});
 assert.deepEqual(nativeDisplayRule({arrayEquals:[{var:'10'},['yes']]}),{and:[{arrayEquals:[{var:10},['yes']]}]});
 assert.deepEqual(nativeDisplayRule({}),{});
 assert.deepEqual(comparison,{'==':[{var:'10'},true]});
});
