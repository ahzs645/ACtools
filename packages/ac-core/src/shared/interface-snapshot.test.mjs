import test from 'node:test';
import assert from 'node:assert/strict';
import {createInterfaceCapture,compareScreen} from './interface-capture.mjs';
import {snapshotInventory,snapshotReviewFiles} from './interface-snapshot.mjs';
const screen={id:'1',route:'#/home',state:'page',capturedAt:'2026-10-16T20:00:01Z',headings:['Home'],columns:[],controls:[],tree:null,assets:[],truncated:false,links:[],viewport:{width:1200,height:800}};
const capture=screens=>({...createInterfaceCapture('https://uat.alayacare.ca',screens),run:{id:'run-1',startedAt:'2026-10-16T20:00:00Z',extensionVersion:'test',label:'UAT review'}});
test('stale checkpoints and uncovered baseline states never count as freshly recaptured',()=>{
 const baseline=capture([screen,{...screen,id:'2',state:'Dialog'}]);
 const current=capture([{...screen,capturedAt:'2026-10-15T20:00:00Z'}]);
 const report=snapshotInventory(current,baseline);assert.equal(report.summary.fresh,0);assert.equal(report.summary.stale,1);assert.equal(report.summary.notRecaptured,1);
});
test('data-only changes are distinguished from control structure and viewport changes',()=>{
 const control={id:'c0',tag:'input',role:'',label:'Risk',type:'text',options:[],required:true,disabled:false,value:'TRAINING one'};
 const changes=compareScreen({...screen,controls:[control]},{...screen,controls:[{...control,id:'c4',value:'TRAINING two'}],viewport:{width:900,height:700}});
 assert.deepEqual(changes.map(change=>change.kind),['control-value','viewport']);
 assert.ok(snapshotInventory(capture([screen]),capture([{...screen,viewport:{width:900,height:700}}])).warnings.some(warning=>warning.includes('Viewport')));
});
test('offline review escapes content, never executes vendor code and shows captured test answers',()=>{
 const full={...screen,captureMode:'test-full',tree:{tag:'input',role:'',label:'Risk',text:'',value:'<script>bad()</script>',styles:{color:'red'},children:[]}};
 const files=snapshotReviewFiles(capture([full]));assert.ok(files['index.html'].includes('screens/001.html'));assert.ok(files['screens/001.html'].includes('&lt;script&gt;'));assert.ok(!files['screens/001.html'].includes('<script>'));assert.ok(files['screens/001.html'].includes("default-src 'none'"));
});

test('a richer collector baseline is not mistaken for a verified vendor redesign',()=>{const before=capture([screen]);before.run.extensionVersion='older';const after=capture([screen]);after.run.extensionVersion='0.7.7';after.visualAssets=[{url:'https://uat.alayacare.ca/icons.woff',kind:'font',fontFamily:'Phosphor',data:'data:font/woff;base64,YQ==',sha256:'a'.repeat(64)}];const report=snapshotInventory(after,before);assert.ok(report.warnings.some(w=>w.includes('Collector version differs')));assert.ok(report.warnings.some(w=>w.includes('added evidence')));});
