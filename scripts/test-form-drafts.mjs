import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {DEPLOYMENT_FORMAT} from '../packages/ac-core/src/shared/deployment.mjs';
const temporary=await mkdtemp(join(tmpdir(),'ac-tools-form-drafts-'));
try {
  const output=join(temporary,'client.mjs');
  await build({stdin:{contents:`export {AlayaCareClient} from './packages/ac-core/src/session/AlayaCareClient'; export {dispatchSessionMessage} from './packages/ac-core/src/session/dispatch'; export {MemoryStore} from './packages/ac-core/src/platform'; export {createPopupRouter} from './packages/ac-core/src/router';`,resolveDir:process.cwd()},outfile:output,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
  const {AlayaCareClient,dispatchSessionMessage,MemoryStore,createPopupRouter}=await import(pathToFileURL(output).href);
  const origin='https://northernhealth.uat.alayacare.ca',base='/api/v1/tasks/forms20/forms',store=new MemoryStore();
  const value={format:DEPLOYMENT_FORMAT,formatVersion:1,packageId:'integration-package',targetOrigin:origin,createdAt:new Date().toISOString(),parentKey:'parent',notes:[],forms:[{key:'parent',definition:{name:'Integration draft',form_type:'form_regular',fields:[{id:1,parent_id:0,rank:0,field_type:'section',label:'Section',settings:{},json_logic:{}},{id:2,parent_id:1,rank:0,field_type:'text',label:'Required answer',required:true,settings:{},json_logic:{}}]},links:[]}]};
  let nativeForm,nextField=100,calls=[];
  const context={origin,getHref:()=>`${origin}/#/system-settings/forms`,formDraftStore:store,fetch:async()=>{throw new Error('Unexpected fallback request');},formDraftRequest:async(method,path,body)=>{calls.push({method,path});if(method==='POST'&&path===base){nativeForm={...structuredClone(body),id:50,status:'draft',fields:[]};return structuredClone(nativeForm);}if(method==='GET')return structuredClone(nativeForm);if(method==='POST'){const field={...structuredClone(body),id:++nextField};nativeForm.fields.push(field);return structuredClone(field);}if(method==='PUT'){Object.assign(nativeForm.fields.find(field=>field.id===body.id),body);return structuredClone(body);}throw new Error('Unexpected native write');}};
  const client=new AlayaCareClient(context),preview=await dispatchSessionMessage(client,{type:'ac/content/preview-form-drafts',payload:{package:value}});
  assert.equal(preview.ok,true);
  const result=await dispatchSessionMessage(client,{type:'ac/content/push-form-drafts',payload:{package:value,approvedDigest:preview.data.digest}});
  assert.equal(result.data.status,'verified');assert.equal(nativeForm.fields[1].parent_id,101);
  const fetched=await dispatchSessionMessage(new AlayaCareClient(context),{type:'ac/content/get-form-draft-receipt',payload:{packageId:value.packageId}});
  assert.equal(fetched.data.formIds.parent,50);
  await assert.rejects(new AlayaCareClient(context).pushFormDrafts(value,preview.data.digest),/already has a deployment receipt/);
  assert(calls.every(call=>call.path.startsWith(base)&&!call.path.includes('publish')));
  await assert.rejects(new AlayaCareClient({...context,formDraftStore:undefined}).pushFormDrafts(value,preview.data.digest),/durable receipt storage/);
  await assert.rejects(new AlayaCareClient({...context,origin:'https://other.alayacare.ca'}).previewFormDrafts(value),/Northern Health UAT/);
  await assert.rejects(new AlayaCareClient({...context,getHref:()=>`${origin}/#/clients/list`}).pushFormDrafts(value,preview.data.digest),/Form Settings/);
  let finishForward;
  const gate=new Promise(resolve=>{finishForward=resolve;});
  const router=createPopupRouter({platform:{local:new MemoryStore(),session:new MemoryStore(),fetch},getActiveOrigin:async()=>origin,sendSessionMessage:async message=>{assert.equal(message.type,'ac/content/push-form-drafts');await gate;return result;}});
  const first=router.handle({type:'ac/popup/push-form-drafts',payload:{package:value,approvedDigest:preview.data.digest}});
  // The router runs one async feature check before it acquires the execution lock.
  await new Promise(resolve=>setTimeout(resolve,0));
  const concurrent=await router.handle({type:'ac/popup/push-form-drafts',payload:{package:value,approvedDigest:preview.data.digest}});
  assert.equal(concurrent.ok,false);assert.match(concurrent.error,/already running/);finishForward();await first;
  console.log('Draft integration passed: session routing, native-only writes, durable receipts, replay and concurrency guards, origin/hash restrictions.');
}finally{await rm(temporary,{recursive:true,force:true});}
