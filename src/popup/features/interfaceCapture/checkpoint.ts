import {validateInterfaceCapture,type InterfaceCapture,type CapturedScreen} from '@ac-core/shared/interface-capture.mjs';

type Slot='current'|'baseline';
type Index={capture:Omit<InterfaceCapture,'screens'|'visualAssets'>;screens:string[];visuals:string[]};
const request=<T>(req:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
const complete=(tx:IDBTransaction)=>new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('Checkpoint transaction aborted.'));});
/** Incremental, atomic snapshots. Full trees/pixels never pass through storage.local or base64/gzip. */
export class InterfaceCheckpoint {
  private db:Promise<IDBDatabase>|undefined;
  private queue:Promise<void>=Promise.resolve();
  private screens=new Map<string,CapturedScreen>();
  private visuals=new Map<string,unknown>();
  constructor(private factory:IDBFactory=globalThis.indexedDB,private name='ac-interface-checkpoints-v2'){}
  private open(){return this.db??=new Promise<IDBDatabase>((resolve,reject)=>{if(!this.factory){reject(new Error('IndexedDB is unavailable. Export before closing this workspace.'));return;}const req=this.factory.open(this.name,1);req.onupgradeneeded=()=>{for(const store of ['index','screens','visuals'])req.result.createObjectStore(store);};req.onerror=()=>reject(req.error);req.onsuccess=()=>resolve(req.result);req.onblocked=()=>reject(new Error('Close the other capture workspace to upgrade local checkpoints.'));});}
  async close(){await this.queue;const db=await this.db;db?.close();this.db=undefined;this.screens.clear();this.visuals.clear();}
  async load(slot:Slot):Promise<InterfaceCapture|null>{
    const db=await this.open();const tx=db.transaction(['index','screens','visuals'],'readonly');const done=complete(tx);
    const index=await request(tx.objectStore('index').get(slot)) as Index|undefined;
    if(!index){await done;return null;}
    const screenRequests=index.screens.map(key=>request(tx.objectStore('screens').get(key)));
    const visualRequests=index.visuals.map(key=>request(tx.objectStore('visuals').get(key)));
    const [screens,visualAssets]=await Promise.all([Promise.all(screenRequests),Promise.all(visualRequests)]);await done;
    const capture=validateInterfaceCapture({...index.capture,screens,visualAssets});
    index.screens.forEach((key,i)=>this.screens.set(key,capture.screens[i]));index.visuals.forEach((key,i)=>this.visuals.set(key,capture.visualAssets![i]));return capture;
  }
  save(slot:Slot,capture:InterfaceCapture|null):Promise<void>{
    // Serialize saves so an earlier asynchronous transaction never wins over a newer run.
    const operation=this.queue.then(()=>this.write(slot,capture));this.queue=operation.catch(()=>undefined);return operation;
  }
  private async write(slot:Slot,capture:InterfaceCapture|null){
    const db=await this.open();const tx=db.transaction(['index','screens','visuals'],'readwrite');const done=complete(tx);
    const store=tx.objectStore('index');const old=await request(store.get(slot)) as Index|undefined;
    const screenKeys=capture?.screens.map(s=>`${slot}:${s.id}`)??[];const visualKeys=capture?.visualAssets?.map(a=>`${slot}:${a.url}`)??[];
    const nextScreens=new Set(screenKeys),nextVisuals=new Set(visualKeys);
    try{
    for(const key of old?.screens??[])if(!nextScreens.has(key))tx.objectStore('screens').delete(key);
    for(const key of old?.visuals??[])if(!nextVisuals.has(key))tx.objectStore('visuals').delete(key);
    capture?.screens.forEach((screen,i)=>{if(this.screens.get(screenKeys[i])!==screen)tx.objectStore('screens').put(screen,screenKeys[i]);});
    capture?.visualAssets?.forEach((asset,i)=>{if(this.visuals.get(visualKeys[i])!==asset)tx.objectStore('visuals').put(asset,visualKeys[i]);});
    if(capture){const {screens:_screens,visualAssets:_visuals,...metadata}=capture;store.put({capture:metadata,screens:screenKeys,visuals:visualKeys} satisfies Index,slot);}else store.delete(slot);
    }catch(error){tx.abort();await done.catch(()=>undefined);throw error;}
    await done;
    for(const key of old?.screens??[])if(!nextScreens.has(key))this.screens.delete(key);
    for(const key of old?.visuals??[])if(!nextVisuals.has(key))this.visuals.delete(key);
    capture?.screens.forEach((screen,i)=>this.screens.set(screenKeys[i],screen));capture?.visualAssets?.forEach((asset,i)=>this.visuals.set(visualKeys[i],asset));
  }
}
