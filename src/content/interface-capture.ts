import {collectVisualAssets,fontResourcesFromCss,isVisualResourceUrl,type VisualResource} from '@ac-core/shared/interface-visuals.mjs';
import {exploreDialogs,currentChartRoutes,openDialogs} from '@ac-core/shared/interface-workflows.mjs';
import {interfacePageReadiness,interfaceNavigationLink} from '@ac-core/shared/interface-navigation.mjs';
import {captureScreen, captureRouteMatches, isInterfaceTraversalRoute,isInterfaceChartRoute,isInterfaceSourceAsset, isExtensionUI, hideExtensionUI, INTERFACE_COMMAND, safeRoute, safeRequestPath, sanitizeResponseShape, type CapturedScreen} from '@ac-core/shared/interface-capture.mjs';
const requests:unknown[]=[];let requestBytes=0;const failures:{state:string;error:string}[]=[];
let recording=false;let recordStates=true;let pendingRequests=0;let captureMode:'structure'|'test-full'='structure';
window.addEventListener('ac-interface-busy',event=>{const count=(event as CustomEvent).detail;pendingRequests=Number.isInteger(count)&&count>=0&&count<10000?count:0;});
const observedAssets=new Set<string>();
const observedVisuals=new Map<string,VisualResource>();
let visualCache:VisualResource[]=[];
const sourceAssetCache=new Map<string,{url:string;text:string;sha256:string}>();
let restoreScreenshot:(()=>void)|undefined;let screenshotTimer:ReturnType<typeof setTimeout>|undefined;let exploringStopped=false;
const states:CapturedScreen[]=[];let stateTimer:ReturnType<typeof setTimeout>|undefined;
const stateClick=(event:MouseEvent)=>{if(!recording||!recordStates)return;const el=(event.target as Element).closest('button,[role=option],[role=combobox],[role=switch],a,[role=tab]');if(!el||(captureMode!=='test-full'&&el.closest('td'))||isExtensionUI(el))return;const label=(el.getAttribute('aria-label')||el.textContent||'interaction').trim().slice(0,100);clearTimeout(stateTimer);stateTimer=setTimeout(()=>{if(!recording)return;if(states.length>=100){if(!failures.some(f=>f.error==='100-state recording limit reached.'))failures.push({state:'recording',error:'100-state recording limit reached.'});return;}void settledScreen(undefined,`After: ${label} · ${states.length+1}`).then(screen=>{const size=JSON.stringify(screen).length;if(size>1_000_000){failures.push({state:screen.state,error:'Screen exceeds the 1 MB passive recording budget. Capture it explicitly.'});return;}states.push(screen);}).catch(error=>failures.push({state:label,error:String(error)}));},800);};
document.addEventListener('click',stateClick,true);
window.addEventListener('ac-interface-response', (event)=>{
  if(!recording||requests.length>=1000)return;
  const detail=(event as CustomEvent).detail;
  // The MAIN bridge sends JSON shapes only. Validate size and reduce again so a
  // forged page event cannot inject real response values into an archive.
  if(!detail||typeof detail.path!=='string'||!detail.path.startsWith('/')||detail.path.length>300)return;
  const entry={path:safeRequestPath(detail.path),queryKeys:Array.isArray(detail.queryKeys)?detail.queryKeys.filter((k:unknown)=>typeof k==='string'&&k.length<100&&!/token|password|secret/i.test(k)):[],method:detail.method==='GET'?'GET':'write',status:Number(detail.status)||0,shape:sanitizeResponseShape(detail.shape)};
  const bytes=JSON.stringify(entry).length;if(requestBytes+bytes>8_000_000){if(!failures.some(f=>f.error==='Response-shape recording budget reached.'))failures.push({state:'requests',error:'Response-shape recording budget reached.'});return;}requestBytes+=bytes;requests.push(entry);
});
function signal(enabled:boolean){recording=enabled;window.dispatchEvent(new CustomEvent('ac-interface-record',{detail:enabled}));}
async function settledScreen(expected?:string,state?:string,previous?:ReturnType<typeof interfacePageReadiness>):Promise<CapturedScreen>{
  // Vue routes render after hash navigation. Bound settlement, and expose timeout
  // as capture failure instead of labelling a stale page with the new route.
  window.dispatchEvent(new Event('ac-interface-busy-request'));
  let changed=Date.now();const start=Date.now();const waitMs=(expected??location.hash).includes('/form-context')?30000:10000;
  const observer=new MutationObserver(()=>{changed=Date.now();});observer.observe(document.body,{subtree:true,childList:true,attributes:true});
  try{while(Date.now()-start<waitMs){await new Promise(resolve=>setTimeout(resolve,200));if(Date.now()-changed>=350&&pendingRequests===0&&![...document.querySelectorAll('[aria-busy=true],.loading-overlay,.el-loading-mask')].some(el=>el.getClientRects().length)){if(expected&&!captureRouteMatches(expected,location.hash)){if(Date.now()-start<1800)continue;throw new Error(`Navigation settled on a different route: ${safeRoute(location.hash)}`);}const readiness=interfacePageReadiness(document);if(!readiness.ready||(previous&&readiness.root===previous.root&&readiness.signature===previous.signature))continue;const screen=captureScreen(document,location.href,state,{mode:captureMode});for(const asset of screen.assets)if(isInterfaceSourceAsset(asset.url,location.origin))observedAssets.add(asset.url);for(const resource of screen.visualResources??[])observedVisuals.set(resource.url,resource);return screen;}}const readiness=interfacePageReadiness(document);if(previous&&readiness.root===previous.root&&readiness.signature===previous.signature)throw new Error('The requested route retained the previous page content; it was not counted as captured.');throw new Error(readiness.ready?`The route did not settle within ${waitMs/1000} seconds. Capture it manually after loading.`:readiness.reason);}finally{observer.disconnect();}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||message?.type!==INTERFACE_COMMAND)return false;
  void(async()=>{
    if(['capture','navigate','start','explore'].includes(message.action))captureMode=message.captureMode==='test-full'?'test-full':'structure';
    if(message.action==='navigate'){
      const route=message.route;
      if(typeof route!=='string'||!(isInterfaceTraversalRoute(route)||isInterfaceChartRoute(route)))throw new Error('Not a reviewed navigation route.');
      if(openDialogs(document).length)throw new Error('A native dialog is still open. Traversal stopped before changing pages; close it and resume.');
      const previous=captureRouteMatches(route,location.hash)?undefined:interfacePageReadiness(document);
      const link=interfaceNavigationLink(document,location.href,route);
      const navigation=link?'dom':'hash';
      if(link)link.click();else location.hash=route;
      return {screen:await settledScreen(route,'page',previous),navigation};
    }
    if(message.action==='hide-extension-ui'){restoreScreenshot?.();restoreScreenshot=hideExtensionUI(document);clearTimeout(screenshotTimer);screenshotTimer=setTimeout(()=>{restoreScreenshot?.();restoreScreenshot=undefined;},5000);await new Promise<void>(resolve=>{const timeout=setTimeout(resolve,200);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timeout);resolve();}));});return {};}
    if(message.action==='restore-extension-ui'){clearTimeout(screenshotTimer);restoreScreenshot?.();restoreScreenshot=undefined;return {};}
    if(message.action==='chart-routes')return {routes:currentChartRoutes(document,location.href)};
    if(message.action==='stop-exploration'){exploringStopped=true;return {};}
    if(message.action==='explore'){exploringStopped=false;return exploreDialogs(document,location.href,{settle:state=>settledScreen(undefined,state),isStopped:()=>exploringStopped});}
    if(message.action==='identity')return {route:safeRoute(location.hash),viewport:{width:innerWidth,height:innerHeight}};
    if(message.action==='status')return {recording,states:states.length,requests:requests.length};
    if(message.action==='start'){recordStates=message.recordStates!==false;requests.length=0;requestBytes=0;states.length=0;failures.length=0;signal(true);return {requests:[]};}
    if(message.action==='stop'){signal(false);clearTimeout(stateTimer);return {requests:[...requests],screens:[...states],failures:[...failures]};}
    if(message.action==='visual-assets'){
      for(const ref of (Array.isArray(message.references)?message.references:[]).slice(0,150))if(ref&&isVisualResourceUrl(ref.url,location.origin,ref.kind))observedVisuals.set(ref.url,{url:ref.url,kind:ref.kind,fontFamily:ref.fontFamily,fontWeight:ref.fontWeight,fontStyle:ref.fontStyle});
      const present=new Map(visualCache.filter(a=>a.data).map(a=>[a.url,a]));
      const pending=[...observedVisuals.values()].filter(a=>!present.has(a.url));
      const loaded=await collectVisualAssets(pending,location.origin);
      visualCache=[...new Map([...visualCache,...loaded].map(a=>[a.url,a])).values()];
      return {visualAssets:visualCache};
    }
    if(message.action==='assets') {
      for(const url of (Array.isArray(message.assetUrls)?message.assetUrls:[]).slice(0,1000))if(isInterfaceSourceAsset(url,location.origin))observedAssets.add(url);
      const assets:{url:string;text:string;sha256:string}[]=[];const failures:{url:string;reason:string}[]=[];let bytes=0;const deadline=Date.now()+30000;
      for(const url of [...observedAssets].sort((a,b)=>Number(/\.js(?:[?#]|$)/i.test(a))-Number(/\.js(?:[?#]|$)/i.test(b))).filter(url=>!message.stylesOnly||!/\.js(?:[?#]|$)/i.test(url)).slice(0,150))try{if(sourceAssetCache.has(url)){const cached=sourceAssetCache.get(url)!;if(bytes+cached.text.length>40_000_000)throw new Error('Asset size budget exceeded.');bytes+=cached.text.length;assets.push(cached);continue;}if(Date.now()>deadline)throw new Error('Source asset collection deadline reached; export again to retry.');const response=await fetch(url,{method:'GET',signal:AbortSignal.timeout(Math.max(1,Math.min(8000,deadline-Date.now()))),credentials:new URL(url).origin===location.origin?'same-origin':'omit',redirect:'error'});if(!response.ok)throw new Error(`HTTP ${response.status}`);const text=await response.text();for(const font of fontResourcesFromCss(text,url,location.origin))observedVisuals.set(font.url,font);if(text.length>8_000_000||bytes+text.length>40_000_000)throw new Error('Asset size budget exceeded.');bytes+=text.length;const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));const asset={url,text,sha256:[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')};sourceAssetCache.set(url,asset);assets.push(asset);}catch(error){failures.push({url,reason:String(error)});}
      return {assets,failures};
    }
    if(message.action==='capture')return {screen:await settledScreen(message.expected,message.state)};
    throw new Error('Unknown interface command.');
  })().then(data=>respond({ok:true,data}),error=>respond({ok:false,error:String(error.message??error)}));return true;
});
