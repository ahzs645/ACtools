import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const temporary=await mkdtemp(join(tmpdir(),'ac-tools-documents-'));
try {
 const output=join(temporary,'client.mjs');
 await build({stdin:{contents:`export {AlayaCareClient} from './packages/ac-core/src/session/AlayaCareClient'; export {dispatchSessionMessage} from './packages/ac-core/src/session/dispatch'; export {MemoryStore} from './packages/ac-core/src/platform'; export {createPopupRouter} from './packages/ac-core/src/router';`,resolveDir:process.cwd()},outfile:output,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
 const {AlayaCareClient,dispatchSessionMessage,MemoryStore,createPopupRouter}=await import(pathToFileURL(output).href);
 const origin='https://northernhealth.uat.alayacare.ca',schema='9d10200e-a554-4e3e-84ed-47e5a60bfc6d',operationId=crypto.randomUUID(),store=new MemoryStore();
 const templates=[{id:3,entity_id:null,entity_type:'form',is_ac_template:true,template_name:'Standard'}];
 const request=async(m,p,b)=>{if(p.endsWith('/forms/100'))return{id:100,schema_id:schema,name:'Entries'};if(m==='GET'&&p.includes('custom_templates'))return{items:templates,total_pages:1};if(m==='POST'&&p.endsWith('custom_templates')){const value={id:65,entity_id:schema,entity_type:'form',template_name:b.fileName};templates.push(value);return value;}throw new Error('Unexpected request');};
 const context={origin,getHref:()=>`${origin}/#/system-settings/forms`,fetch,formDraftRequest:request,formDraftStore:store};
 const client=new AlayaCareClient(context);
 const payload={action:'upload',formId:100,schemaId:schema,fileName:'Entry.docx',base64:Buffer.from([80,75,3,4,1,2]).toString('base64'),operationId};
 const result=await dispatchSessionMessage(client,{type:'ac/content/form-documents',payload});assert.equal(result.data.status,'verified');
 const receipt=await dispatchSessionMessage(new AlayaCareClient(context),{type:'ac/content/form-documents',payload:{action:'receipt',operationId}});assert.equal(receipt.data.templateId,65);
 await assert.rejects(client.formDocuments(payload),/receipt/);
 await assert.rejects(new AlayaCareClient({...context,getHref:()=>`${origin}/#/dashboard/client-forms/141`}).formDocuments(payload),/Form Settings/);
 await assert.rejects(new AlayaCareClient({...context,formDraftStore:undefined}).formDocuments(payload),/durable/);
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const router=createPopupRouter({platform:{local:new MemoryStore(),session:new MemoryStore(),fetch},getActiveOrigin:async()=>origin,sendSessionMessage:async message=>{assert.equal(message.type,'ac/content/form-documents');await gate;return result;}});
 const first=router.handle({type:'ac/popup/form-documents',payload});await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal((await router.handle({type:'ac/popup/form-documents',payload})).ok,false);release();assert.equal((await first).data.status,'verified');
 console.log('Document integration passed: routed uploads, schema target, durable receipt recovery, replay and concurrency guards, route restrictions.');
}finally{await rm(temporary,{recursive:true,force:true});}
