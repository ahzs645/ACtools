import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {INTERFACE_COMMAND} from '../packages/ac-core/src/shared/interface-capture.mjs';
const compiled=await build({entryPoints:['src/content/interface-capture.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
function harness(html){
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://uat.alayacare.ca/#/home'});const w=dom.window;
 let listener;w.crypto.randomUUID=()=>crypto.randomUUID();w.HTMLElement.prototype.getClientRects=()=>[{width:100,height:20}];
 w.chrome={runtime:{id:'test',onMessage:{addListener:fn=>listener=fn}}};w.eval(compiled.outputFiles[0].text);
 const command=(action,payload={})=>new Promise(resolve=>listener({type:INTERFACE_COMMAND,action,captureMode:'test-full',...payload},{id:'test'},resolve));
 return {w,dom,command};
}
test('content navigation clicks the native anchor and captures the newly rendered full test values',async()=>{
 const h=harness('<main><h1>Home</h1><a href="/#/system-settings/forms">Forms</a></main>');let clicked=false;
 h.w.document.querySelector('a').onclick=event=>{event.preventDefault();clicked=true;h.w.location.hash='#/system-settings/forms';h.w.document.querySelector('main').innerHTML='<h1>Forms</h1><label>Form name<input value="TRAINING form"></label>';};
 const result=await h.command('navigate',{route:'#/system-settings/forms'});assert.equal(result.ok,true);assert.equal(clicked,true);assert.equal(result.data.navigation,'dom');assert.deepEqual(Array.from(result.data.screen.headings),['Forms']);assert.ok(result.data.screen.controls.some(x=>x.value==='TRAINING form'));h.dom.window.close();
});
test('content navigation falls back to the hash router when no visible native anchor exists',async()=>{
 const h=harness('<main><h1>Home</h1></main>');h.w.addEventListener('hashchange',()=>h.w.document.querySelector('main').innerHTML='<h1>Templates</h1>');
 const result=await h.command('navigate',{route:'#/system-settings/templates'});assert.equal(result.ok,true);assert.equal(result.data.navigation,'hash');assert.deepEqual(Array.from(result.data.screen.headings),['Templates']);h.dom.window.close();
});
test('content navigation refuses to carry an open native Task drawer into another route',async()=>{
 const h=harness('<main><h1>Home</h1></main><div class="acds-dock-modal">Create Task<button>Cancel</button></div>');
 const result=await h.command('navigate',{route:'#/system-settings/forms'});assert.equal(result.ok,false);assert.match(result.error,/native dialog is still open/);assert.equal(h.w.location.hash,'#/home');h.dom.window.close();
});

test('a changed hash over unchanged native content is a failed capture',async()=>{
 const h=harness('<main><h1>Home</h1></main>');let tick=0;h.w.Date.now=()=>tick+=1100;
 const result=await h.command('navigate',{route:'#/system-settings/forms'});assert.equal(result.ok,false);assert.match(result.error,/retained the previous page content/);h.dom.window.close();
});
test('a quiet application shell is never accepted as a rendered page',async()=>{
 const h=harness('<div id="single-spa-application:shell_layout_blocks/TopBar">Header</div><div id="app"></div>');let tick=0;h.w.Date.now=()=>tick+=1100;
 const result=await h.command('capture');assert.equal(result.ok,false);assert.match(result.error,/only the application shell/);h.dom.window.close();
});

test('native input-submit captions and per-edge border styles survive capture',async()=>{
 const h=harness('<main><h1>Risks</h1><input type="submit" value="SAVE" style="border-bottom:2px solid red"></main>');
 const result=await h.command('capture');assert.equal(result.ok,true);assert.equal(result.data.screen.controls[0].label,'SAVE');
 const find=node=>node?.tag==='input'?node:node?.children.map(find).find(Boolean);assert.match(find(result.data.screen.tree).styles['border-bottom'],/2px/);h.dom.window.close();
});

test('navigation tabs alone are incomplete until their native content slot mounts',async()=>{
 const h=harness('<div id="app"><h1>Employees</h1><nav>Employee List Departments</nav><div class="tabs__content"></div></div>');
 const {interfacePageReadiness}=await import('../packages/ac-core/src/shared/interface-navigation.mjs');
 assert.equal(interfacePageReadiness(h.w.document).ready,false);
 h.w.document.querySelector('.tabs__content').innerHTML='<div id="single-spa-application:parcel-4"><table><tr><th>Employee</th></tr><tr><td>TRAINING</td></tr></table></div>';
 assert.equal(interfacePageReadiness(h.w.document).ready,true);h.dom.window.close();
});
test('native styled hidden checkbox retains its row label and checked state',async()=>{
 const h=harness('<main><h1>Settings</h1><div class="formRow"><div class="grid4"><label>Automatically Complete Tasks When the Form Is Submitted</label></div><div class="grid8"><label><input type="checkbox" checked style="display:none"><span>Toggle</span></label></div></div></main>');
 const input=h.w.document.querySelector('input');input.getClientRects=()=>[];
 const result=await h.command('capture');assert.equal(result.ok,true);const field=result.data.screen.controls.find(c=>c.type==='checkbox');assert.equal(field.checked,true);assert.match(field.label,/Automatically Complete Tasks/);h.dom.window.close();
});
test('native global loading indicator gates otherwise populated content',async()=>{
 const h=harness('<main><h1>Employees</h1><table><tr><th>Name</th></tr></table></main><span class="loading-global">Loading...</span>');
 const {interfacePageReadiness}=await import('../packages/ac-core/src/shared/interface-navigation.mjs');
 assert.equal(interfacePageReadiness(h.w.document).ready,false);h.w.document.querySelector('.loading-global').remove();assert.equal(interfacePageReadiness(h.w.document).ready,true);h.dom.window.close();
});
