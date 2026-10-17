import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {expandHtml} from './html-include.mjs';
import {createInterfaceCapture} from '../packages/ac-core/src/shared/interface-capture.mjs';
import {readInterfaceArchive} from '../packages/ac-core/src/shared/interface-archive-file.mjs';
const compiled=await build({entryPoints:['src/popup/features/interfaceCapture/controller.ts'],bundle:true,write:false,format:'iife',globalName:'InterfaceTest',platform:'browser'});
const html=expandHtml(await readFile('src/popup/html/panels/form-context-catalog.html','utf8'),process.cwd());
const screen={id:'one',route:'#/dashboard/v2/tasks',state:'page',capturedAt:'now',headings:['Tasks'],columns:['Name'],controls:[],links:[],tree:null,truncated:false,assets:[]};
const flush=async()=>{await new Promise(r=>setTimeout(r,30));};
function harness({visualAssets=[],screenshotFails=false,links=[],includeKnown=false,navigationFailure,storageGet=async()=>({})}={}){
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://extension.example.test'});
 const w=dom.window;w.document.querySelector('#interface-collection-depth').value='deep';w.document.querySelector('#interface-screenshot-source').checked=false;w.document.querySelector('#interface-known-routes').checked=includeKnown;w.document.querySelector('#interface-auto-dialogs').checked=false;w.document.querySelector('#interface-current-chart').checked=false;w.Blob=Blob;w.structuredClone=structuredClone;w.crypto.randomUUID=()=>crypto.randomUUID();const blobs=[];w.URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:practice';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=()=>{};
 const removed=[],commands=[],storageWrites=[];let route='#/dashboard/v2/tasks';let activeId=1;let screenshots=0;
 w.chrome={runtime:{getManifest:()=>({version:'test'}),getURL:path=>'chrome-extension://test/'+path},storage:{local:{get:storageGet,set:async value=>storageWrites.push(value)}},tabs:{query:async()=>[{id:activeId,windowId:1,url:'https://uat.alayacare.ca/'+route}],get:async()=>({url:'https://uat.alayacare.ca/'+route}),captureVisibleTab:async()=>{screenshots++;if(screenshotFails)throw new Error(typeof screenshotFails==='string'?screenshotFails:'Unavailable');return 'data:image/png;base64,YQ==';},create:async({url})=>{route=new URL(url).hash;activeId=2;return {id:2,windowId:1};},update:async(id,{url,active})=>{if(url)route=new URL(url).hash;if(active)activeId=id;},remove:async id=>removed.push(id),sendMessage:async(_id,{action,route:target})=>{commands.push(action);if(action==='navigate'){route=target;const error=navigationFailure?.(route);if(error)return {ok:false,error};}return {ok:true,data:action==='stop'?{requests:[{path:'/api/tasks',shape:'array'}],screens:[{...screen,id:'two',state:'Task dialog'}]}:action==='explore'?{screens:[{...screen,id:'dialog',state:'Add Form / opened'}],transitions:[],report:[]}:action==='chart-routes'?{routes:[]}:action==='visual-assets'?{visualAssets}:action==='assets'?{assets:[],failures:[]}:action==='start'?{}:{screen:{...screen,route,links},navigation:'dom'}};}}};
 const api=w.eval(compiled.outputFiles[0].text+';InterfaceTest;');const downloads=[];new api.InterfaceCaptureController((content,type,name)=>downloads.push({content,type,name}));
 const click=id=>w.document.querySelector('#'+id).click();return {dom,w,click,downloads,blobs,removed,commands,storageWrites,screenshotCount:()=>screenshots};
}
test('manual capture exports gzip and keeps structure if screenshot capture fails',async()=>{
 const h=harness({screenshotFails:true});h.w.document.querySelector('#interface-include-screenshot').checked=true;h.click('capture-interface-state');await flush();assert.match(h.w.document.querySelector('#interface-capture-status').textContent,/Structure saved/);h.click('export-interface-capture');await flush();const capture=readInterfaceArchive(new Uint8Array(await h.blobs[0].arrayBuffer()));assert.equal(capture.screens.length,1);assert.ok(h.commands.includes('hide-extension-ui'));assert.ok(h.commands.includes('restore-extension-ui'));h.dom.window.close();
});
test('passive recording adds dialog states and refuses export until stopped',async()=>{
 const h=harness();h.click('record-interface-requests');await flush();h.click('export-interface-capture');await flush();assert.equal(h.blobs.length,0);h.click('record-interface-requests');await flush();h.click('export-interface-capture');await flush();const capture=readInterfaceArchive(new Uint8Array(await h.blobs[0].arrayBuffer()));assert.equal(capture.screens[0].state,'Task dialog');assert.equal(capture.requests.length,1);h.dom.window.close();
});
test('route walk visits safe navigation only and closes its temporary tab',async()=>{
 const h=harness({links:[{label:'Accounting',route:'#/accounting/billing'},{label:'Create',route:'#/clients/create'},{label:'New employee',route:'#/employee/default/createNew'}]});h.click('capture-interface-routes');await flush();assert.deepEqual(h.removed,[2]);h.click('export-interface-capture');await flush();const capture=readInterfaceArchive(new Uint8Array(await h.blobs[0].arrayBuffer()));assert.deepEqual(capture.coverage.routes,['#/dashboard/v2/tasks','#/home','#/accounting/billing']);h.dom.window.close();
});

test('successive recordings retain earlier response evidence',async()=>{
 const h=harness();for(let i=0;i<2;i++){h.click('record-interface-requests');await flush();h.click('record-interface-requests');await flush();}
 h.click('export-interface-capture');await flush();const capture=readInterfaceArchive(new Uint8Array(await h.blobs[0].arrayBuffer()));assert.equal(capture.requests.length,2);h.dom.window.close();
});

test('update bundle exports an importable ZIP with capture and coverage',async()=>{
 const h=harness();h.click('capture-interface-state');await flush();h.click('export-interface-bundle');await flush();const capture=readInterfaceArchive(new Uint8Array(await h.blobs[0].arrayBuffer()));assert.equal(capture.screens.length,1);h.dom.window.close();
});
test('discovery attempts previously observed routes and writes coverage',async()=>{
 const h=harness({includeKnown:true});h.click('capture-interface-routes');await flush();h.click('export-interface-capture');await flush();const capture=readInterfaceArchive(new Uint8Array(await h.blobs[0].arrayBuffer()));assert.ok(capture.coverage.discovery.attempts.length>50);assert.ok(capture.coverage.discovery.attempts.every(a=>a.status==='captured'));assert.equal(capture.coverage.discovery.pending.length,0);h.dom.window.close();
});

test('automatic dialog capture imports states without losing earlier archive evidence',async()=>{
 const h=harness();h.click('capture-interface-state');await flush();h.click('capture-interface-dialogs');await flush();h.click('export-interface-bundle');await flush();const capture=readInterfaceArchive(new Uint8Array(await h.blobs[0].arrayBuffer()));assert.equal(capture.screens.length,2);assert.equal(capture.screens[1].state,'Add Form / opened');h.dom.window.close();
});

// Delayed storage must not replace a newly captured session.
test('checkpoint restoration cannot overwrite captures made while storage was loading',async()=>{
 const saved=createInterfaceCapture('https://uat.alayacare.ca',[{...screen,id:'old',state:'Old saved state'}]);
 const {gzipSync,strToU8}=await import('fflate');let resolveStorage;
 const encoded=Buffer.from(gzipSync(strToU8(JSON.stringify(saved)))).toString('base64');
 const h=harness({storageGet:()=>new Promise(resolve=>{resolveStorage=resolve;})});
 h.click('capture-interface-state');await flush();resolveStorage({'ac-interface-checkpoint':encoded});await flush();h.click('export-interface-capture');await flush();
 const actual=readInterfaceArchive(new Uint8Array(await h.blobs[0].arrayBuffer()));assert.equal(actual.screens[0].state,'page');h.dom.window.close();
});
test('dialog captures persist as an importable checkpoint and restore on reopening the panel',async()=>{
 const h=harness();h.click('capture-interface-dialogs');await flush();assert.equal(h.storageWrites.length,1);
 const saved=h.storageWrites[0];assert.equal(readInterfaceArchive(Buffer.from(saved['ac-interface-checkpoint'],'base64')).screens[0].state,'Add Form / opened');h.dom.window.close();
 const restored=harness({storageGet:async()=>saved});await flush();restored.click('export-interface-capture');await flush();
 const capture=readInterfaceArchive(new Uint8Array(await restored.blobs[0].arrayBuffer()));assert.equal(capture.screens[0].state,'Add Form / opened');restored.dom.window.close();
});

test('discovery also explores the initial route rather than skipping its dialogs',async()=>{
 const h=harness();h.w.document.querySelector('#interface-auto-dialogs').checked=true;h.click('capture-interface-routes');await flush();assert.ok(h.commands.includes('explore'));h.click('export-interface-capture');await flush();const capture=readInterfaceArchive(new Uint8Array(await h.blobs[0].arrayBuffer()));assert.ok(capture.screens.some(s=>s.state==='Add Form / opened'));assert.deepEqual(h.removed,[2]);h.dom.window.close();
});


test('route traversal uses native navigation commands and stops repeated screenshot permission failures',async()=>{
 const h=harness({screenshotFails:'Either activeTab or all_urls permission is required.',links:[{label:'Forms',route:'#/system-settings/forms'},{label:'Templates',route:'#/system-settings/templates'}]});
 h.click('capture-interface-routes');await flush();assert.equal(h.screenshotCount(),1);assert.equal(h.commands.filter(x=>x==='navigate').length,2);
 h.click('export-interface-capture');await flush();const capture=readInterfaceArchive(new Uint8Array(await h.blobs[0].arrayBuffer()));
 assert.equal(capture.coverage.discovery.strategy,'dom-v2');assert.equal(capture.workflowReport.filter(x=>x.action==='Viewport screenshot').length,1);
 assert.ok(capture.coverage.discovery.attempts.filter(x=>x.navigation!=='initial').every(x=>x.navigation==='dom'&&x.durationMs>=0));h.dom.window.close();
});
test('three empty native pages stop traversal with explicit pending coverage',async()=>{
 const h=harness({links:['one','two','three','four'].map(label=>({label,route:'#/settings/'+label})),navigationFailure:()=> 'No rendered native page content; only the application shell or an empty mount is present.'});
 h.click('capture-interface-routes');await flush();h.click('export-interface-capture');await flush();const capture=readInterfaceArchive(new Uint8Array(await h.blobs[0].arrayBuffer()));
 assert.equal(capture.screens.length,2);assert.equal(capture.coverage.discovery.stopped,true);assert.equal(capture.coverage.discovery.attempts.filter(x=>x.status==='failed').length,3);assert.deepEqual(capture.coverage.discovery.pending,['#/settings/four']);assert.deepEqual(h.removed,[2]);h.dom.window.close();
});
test('legacy employee and facility record links are not added to the traversal queue',async()=>{
 const h=harness({links:[{label:'Employee',route:'#/employee/default/view/id/9j/'},{label:'Facility',route:'#/facilities/1ab'},{label:'Forms',route:'#/system-settings/forms'},{label:'Account setup',route:'#/login/setup-account'}]});
 h.click('capture-interface-routes');await flush();h.click('export-interface-capture');await flush();const capture=readInterfaceArchive(new Uint8Array(await h.blobs[0].arrayBuffer()));
 assert.deepEqual(capture.coverage.routes,['#/dashboard/v2/tasks','#/home','#/system-settings/forms']);h.dom.window.close();
});

test('update bundle embeds font evidence once and lists missing visual resources',async()=>{
 const font={url:'https://uat.alayacare.ca/assets/icons.woff',kind:'font',fontFamily:'Phosphor',data:'data:font/woff;base64,d09GRg==',sha256:'a'.repeat(64)};
 const h=harness({visualAssets:[font,{...font,url:'https://uat.alayacare.ca/assets/missing.woff',data:undefined,sha256:undefined,error:'HTTP 404'}]});
 h.click('capture-interface-state');await flush();h.click('export-interface-bundle');await flush();
 const bytes=new Uint8Array(await h.blobs[0].arrayBuffer());const {unzipSync,strFromU8}=await import('fflate');const files=unzipSync(bytes);const capture=readInterfaceArchive(bytes);
 assert.equal(capture.visualAssets.length,2);assert.equal(capture.visualAssets[0].data,font.data);assert.ok(files['visual-assets/'+font.sha256+'.woff']);
 const review=JSON.parse(strFromU8(files['snapshot-review.json']));assert.equal(review.summary.embeddedVisualAssets,1);assert.equal(review.summary.missingVisualAssets,1);h.dom.window.close();
});
test('resume pending routes retains completed pages and the original run identity',async()=>{
 const h=harness({links:['one','two','three','four'].map(label=>({label,route:'#/settings/'+label})),navigationFailure:route=>route.endsWith('four')?undefined:'No rendered native page content; only the application shell or an empty mount is present.'});
 h.click('capture-interface-routes');await flush();h.click('export-interface-capture');await flush();const first=readInterfaceArchive(new Uint8Array(await h.blobs[0].arrayBuffer()));
 h.click('resume-interface-routes');await flush();h.click('export-interface-capture');await flush();const after=readInterfaceArchive(new Uint8Array(await h.blobs[1].arrayBuffer()));
 assert.equal(after.run.id,first.run.id);assert.ok(after.screens.some(s=>s.route==='#/settings/four'));assert.equal(after.coverage.discovery.pending.length,0);h.dom.window.close();
});

test('screenshot mode uses the toolbar-authorized source tab and restores it without closing it',async()=>{
 const h=harness({links:[{label:'Forms',route:'#/system-settings/forms'}]});h.w.document.querySelector('#interface-screenshot-source').checked=true;
 h.click('capture-interface-routes');await flush();assert.equal(h.removed.length,0);assert.ok(h.screenshotCount()>=2);h.click('export-interface-capture');await flush();
 const capture=readInterfaceArchive(new Uint8Array(await h.blobs[0].arrayBuffer()));assert.ok(capture.screens.some(s=>s.screenshot));assert.ok(h.commands.includes('navigate'));h.dom.window.close();
});

test('fast inventory skips dialog expansion even when its deeper-mode option is checked',async()=>{
 const h=harness();h.w.document.querySelector('#interface-collection-depth').value='inventory';h.w.document.querySelector('#interface-auto-dialogs').checked=true;
 h.click('capture-interface-routes');await flush();assert.ok(!h.commands.includes('explore'));h.dom.window.close();
});
