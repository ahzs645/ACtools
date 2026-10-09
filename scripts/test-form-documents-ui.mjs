import {deploymentDigest} from '../packages/ac-core/src/shared/deployment.mjs';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const temporary=await mkdtemp(join(tmpdir(),'ac-tools-document-ui-'));
try{
 const output=join(temporary,'ui.mjs');
 await build({stdin:{contents:`export {FormDocumentsController} from './src/popup/features/formDefinitions/documentsController';export {FormDeploymentController} from './src/popup/features/formDefinitions/deploymentController';`,resolveDir:process.cwd()},outfile:output,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
 const {FormDocumentsController,FormDeploymentController}=await import(pathToFileURL(output).href);
 const dom=new JSDOM(await readFile('src/popup/html/panels/form-context-catalog.html','utf8'),{url:'https://extension.example'});
 globalThis.document=dom.window.document;globalThis.localStorage=dom.window.localStorage;
 const el=id=>document.getElementById(id),tick=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setTimeout(resolve,0));};
 const choices=[{id:3,name:'Standard',isDefault:true},{id:65,name:'Custom',isDefault:false}],schemaId=crypto.randomUUID(),calls=[];
 const send=async message=>{calls.push(message);const p=message.payload;
  if(p.action==='templates')return{ok:true,data:{formId:p.formId,name:'Entries',schemaId,templates:choices}};
  if(p.action==='upload')return{ok:true,data:{operationId:p.operationId,kind:'upload',formId:p.formId,templateId:66,status:'verified',errors:[]}};
  if(p.action==='review-print')return{ok:true,data:{parentSubmissionId:141,digest:'digest',entries:[142,143].map(submissionId=>({submissionId,formId:100,formName:'Entries',schemaId,templates:choices}))}};
  if(p.action==='start-print')return{ok:true,data:{operationId:p.operationId,kind:'print',status:'running',errors:[],jobs:p.choices.map(item=>({...item,formId:100,status:'pending'}))}};
  if(p.action==='receipt')return{ok:true,data:{operationId:p.operationId,kind:'print',status:'verified',errors:[],jobs:[142,143].map(submissionId=>({submissionId,formId:100,templateId:65,status:'ready',url:`https://northernhealth.uat.alayacare.ca/api/v1/files/tasks/form_submissions/${crypto.randomUUID()}.pdf`}))}};
  return {ok:true};
 };
 new FormDocumentsController({send,download:()=>{}});
 assert(el('upload-document-template').disabled);el('document-form-id').value='100';el('load-document-templates').click();await tick();assert.match(el('document-template-target').textContent,/Entries/);
 const file={name:'Entry.docx',size:6,arrayBuffer:async()=>Uint8Array.from([80,75,3,4,1,2]).buffer};Object.defineProperty(el('document-template-file'),'files',{value:[file],configurable:true});el('document-template-file').dispatchEvent(new dom.window.Event('change'));assert(!el('upload-document-template').disabled);el('upload-document-template').click();await tick();assert.match(el('document-status').textContent,/upload verified/);assert(el('upload-document-template').disabled);
 el('document-parent-submission').value='141';el('review-child-print').click();await tick();assert.equal(el('child-print-plan').querySelectorAll('select').length,2);for(const select of el('child-print-plan').querySelectorAll('select'))select.value='65';el('start-child-print').click();await tick();assert.match(el('document-status').textContent,/print verified/);assert.equal(el('document-print-results').querySelectorAll('a').length,2);assert(el('start-child-print').disabled);assert(calls.find(item=>item.payload.action==='start-print').payload.choices.every(item=>item.templateId===65));
 // Invalid template manifests cannot leave a runnable draft package behind.
 new FormDeploymentController({send,download:()=>{}});
 const raw={format:'webforms-alayacare-draft-deployment',formatVersion:1,packageId:'ui-test',targetOrigin:'https://northernhealth.uat.alayacare.ca',createdAt:new Date().toISOString(),parentKey:'parent',notes:[],forms:[{key:'parent',definition:{name:'Test',form_type:'form_regular',fields:[]},links:[]}],templates:[{formKey:'foreign',fileName:'Entry.docx',base64:Buffer.from([80,75,3,4,1,2]).toString('base64')}]};
 Object.defineProperty(el('form-draft-package'),'files',{value:[{size:100,text:async()=>JSON.stringify(raw)}]});el('form-draft-package').dispatchEvent(new dom.window.Event('change'));await tick();assert(el('review-form-drafts').disabled);assert.match(el('form-draft-status').textContent,/invalid form key/);
 const fresh=new JSDOM(await readFile('src/popup/html/panels/form-context-catalog.html','utf8'),{url:'https://extension.example'});globalThis.document=fresh.window.document;globalThis.localStorage=fresh.window.localStorage;
 const saved=new Map(),uploads=[];
 const deployed={packageId:'ui-test',status:'verified',formIds:{parent:201},verifiedForms:['parent'],errors:[]};
 const packageSend=async message=>{
  if(message.type==='ac/popup/get-form-draft-receipt')return{ok:true,data:deployed};
  const p=message.payload;
  if(p.action==='receipt')return{ok:true,data:saved.get(p.operationId)};
  if(p.action==='templates')return{ok:true,data:{formId:201,name:'New draft',schemaId,templates:choices}};
  if(p.action==='upload'){uploads.push(p);const data={operationId:p.operationId,kind:'upload',status:'verified',templateId:67,formId:p.formId,fileName:p.fileName,errors:[]};saved.set(p.operationId,data);return{ok:true,data};}
  throw new Error('Unexpected package UI command');
 };
 new FormDeploymentController({send:packageSend,download:()=>{}});raw.templates[0].formKey='parent';deployed.digest=await deploymentDigest(raw);
 Object.defineProperty(el('form-draft-package'),'files',{value:[{size:100,text:async()=>JSON.stringify(raw)}]});el('form-draft-package').dispatchEvent(new fresh.window.Event('change'));await tick();assert(!el('upload-packaged-templates').disabled);el('upload-packaged-templates').click();await tick();assert.equal(uploads[0].formId,201);assert.match(el('form-draft-status').textContent,/All packaged templates uploaded/);el('upload-packaged-templates').click();await tick();assert.equal(uploads.length,1);raw.forms[0].definition.name='Edited after deployment';el('form-draft-package').dispatchEvent(new fresh.window.Event('change'));await tick();el('upload-packaged-templates').click();await tick();assert.equal(uploads.length,1);assert.match(el('form-draft-status').textContent,/changed since draft verification/);
 console.log('Document UI passed: upload target, template choice per entry, generated PDF links, consumed reviews and invalid package rejection.');
}finally{await rm(temporary,{recursive:true,force:true});}
