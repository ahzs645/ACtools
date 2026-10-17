import test from 'node:test';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {build} from 'esbuild';
import {createInterfaceCapture} from '../packages/ac-core/src/shared/interface-capture.mjs';
const bundled=await build({entryPoints:['src/popup/features/interfaceCapture/checkpoint.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {InterfaceCheckpoint}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const screen=(id)=>({id,route:'#/home',state:'page',capturedAt:'now',headings:[],columns:[],controls:[],links:[],tree:null,truncated:false,assets:[]});
test('large screenshots survive checkpoints above the former storage.local budget',async()=>{
 const factory=new IDBFactory();const db=new InterfaceCheckpoint(factory);
 const capture=createInterfaceCapture('https://uat.alayacare.ca',[{...screen('big'),screenshot:'data:image/png;base64,'+randomBytes(6_750_000).toString('base64')}]);
 await db.save('current',capture);const restored=await new InterfaceCheckpoint(factory).load('current');assert.equal(restored.screens[0].screenshot.length,9_000_022);
});
test('serialized checkpoint replacement preserves the newest run and removes obsolete rows',async()=>{
 const factory=new IDBFactory();const db=new InterfaceCheckpoint(factory);const old=createInterfaceCapture('https://uat.alayacare.ca',[screen('old')]);const fresh=createInterfaceCapture('https://uat.alayacare.ca',[screen('new')]);
 await Promise.all([db.save('current',old),db.save('current',fresh)]);assert.equal((await new InterfaceCheckpoint(factory).load('current')).screens[0].id,'new');
 await db.save('baseline',old);await db.save('baseline',null);assert.equal(await new InterfaceCheckpoint(factory).load('baseline'),null);
});
test('incremental saves retain pixels and share stable trees while updating metadata',async()=>{
 const factory=new IDBFactory();const db=new InterfaceCheckpoint(factory);const capture=createInterfaceCapture('https://uat.alayacare.ca',[screen('one')]);await db.save('current',capture);
 capture.screens.push({...screen('two'),state:'dialog'});capture.coverage.states=2;await db.save('current',capture);
 assert.deepEqual((await new InterfaceCheckpoint(factory).load('current')).screens.map(s=>s.id),['one','two']);
});

test('a failed record write aborts replacement and preserves the last complete checkpoint',async()=>{
 const factory=new IDBFactory();const db=new InterfaceCheckpoint(factory);const before=createInterfaceCapture('https://uat.alayacare.ca',[screen('before')]);await db.save('current',before);
 const broken=createInterfaceCapture('https://uat.alayacare.ca',[{...screen('broken'),nonCloneable:()=>{}}]);await assert.rejects(db.save('current',broken));
 assert.equal((await new InterfaceCheckpoint(factory).load('current')).screens[0].id,'before');
 await db.save('current',createInterfaceCapture('https://uat.alayacare.ca',[screen('after')]));assert.equal((await new InterfaceCheckpoint(factory).load('current')).screens[0].id,'after');
});
