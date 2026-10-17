import {readInterfaceArchive} from '@ac-core/shared/interface-archive-file.mjs';
import {KNOWN_INTERFACE_ROUTES} from '@ac-core/shared/interface-routes.mjs';
import {snapshotInventory,snapshotReviewFiles} from '@ac-core/shared/interface-snapshot.mjs';
import {zipSync,strToU8,gzipSync} from 'fflate';
import {INTERFACE_COMMAND,createInterfaceCapture,compareScreen,compareCaptures,validateInterfaceCapture,type CapturedScreen,type InterfaceCapture,type InterfaceDiscovery,type CapturedTransition,isInterfaceTraversalRoute,isInterfaceChartRoute,safeRoute} from '@ac-core/shared/interface-capture.mjs';
export class InterfaceCaptureController {
  private screens:CapturedScreen[]=[];
  private capture:InterfaceCapture|null=null;
  private stopped=false;
  private discovery:InterfaceDiscovery|undefined;
  private busy=false;
  private explorationTab:number|undefined;
  private checkpointTimer:ReturnType<typeof setTimeout>|undefined;
  private status=document.querySelector<HTMLElement>('#interface-capture-status')!;
  private baseline:InterfaceCapture|null=null;
  private baselinePinned=false;
  private recordingTab:number|undefined;
  private collectedAssets:{origin:string;assets:{url:string;sha256:string;text:string}[];failures:{url:string;reason:string}[]}|null=null;
  constructor(private download:(content:string,type:string,name:string)=>void){
    document.querySelector('#start-interface-run')!.addEventListener('click',()=>void this.fresh());
    document.querySelector('#open-interface-workspace')!.addEventListener('click',()=>void this.openWorkspace());
    document.querySelector('#record-interface-requests')!.addEventListener('click',()=>void this.recordRequests());
    document.querySelector('#export-interface-assets')!.addEventListener('click',()=>void this.assets());
    document.querySelector('#export-interface-bundle')!.addEventListener('click',()=>void this.bundle());
    document.querySelector('#capture-interface-state')!.addEventListener('click',()=>void this.current());
    document.querySelector('#capture-interface-routes')!.addEventListener('click',()=>void this.walk());
    document.querySelector('#resume-interface-routes')?.addEventListener('click',()=>void this.walk(true));
    document.querySelector('#stop-interface-capture')!.addEventListener('click',()=>{this.stopped=true;if(this.explorationTab)void this.command(this.explorationTab,'stop-exploration');});
    document.querySelector('#capture-interface-dialogs')!.addEventListener('click',()=>void this.dialogs());
    document.querySelector('#export-interface-capture')!.addEventListener('click',()=>this.export());
    document.querySelector('#interface-baseline-file')!.addEventListener('change',event=>void this.loadBaseline(event));
    void this.restoreArchive().then(()=>this.restoreRecording());
  }
  private async restoreRecording(){try{const tab=await this.active();const data=await this.command(tab.id,'status');if(data.recording){this.recordingTab=tab.id;this.status.textContent='Recording continues in this tab. Stop to collect the saved states before export.';}}catch{/* No active AlayaCare capture is expected on other tabs. */}}
  private async active(){
    const params=new URLSearchParams(location.search);const target=params.get('tab');
    const tab=target&&/^\d+$/.test(target)?await chrome.tabs.get(Number(target)):(await chrome.tabs.query({active:true,currentWindow:true}))[0];
    if(!tab?.id||!tab.url)throw new Error('Open an AlayaCare tab first.');const origin=new URL(tab.url).origin;createInterfaceCapture(origin);
    if(target&&params.get('origin')!==origin)throw new Error('The source tab changed tenant. Reopen the capture workspace from AlayaCare.');
    return tab as chrome.tabs.Tab&{id:number,url:string};
  }
  private async openWorkspace(){try{const tab=await this.active();await chrome.tabs.create({url:chrome.runtime.getURL('interface-capture.html')+`?tab=${tab.id}&origin=${encodeURIComponent(new URL(tab.url).origin)}`,active:true});}catch(error){this.status.textContent=String(error);}}
  private beginRun(origin:string){
    if(this.capture?.screens.length&&!this.baselinePinned)this.baseline=structuredClone(this.capture);
    this.screens=[];this.collectedAssets=null;this.discovery=undefined;this.capture=createInterfaceCapture(origin);
    this.capture.run={id:crypto.randomUUID(),startedAt:this.capture.capturedAt,extensionVersion:chrome.runtime?.getManifest?.().version??'unknown',label:(document.querySelector<HTMLInputElement>('#interface-run-label')?.value??'').trim().slice(0,200)};
  }
  private async fresh(){if(this.busy||this.recordingTab){this.status.textContent='Stop capture and recording before starting a fresh snapshot.';return;}try{const tab=await this.active();this.beginRun(new URL(tab.url).origin);await this.saveArchive();this.status.textContent='Fresh snapshot started. Earlier states will not count as visits in this run; the prior archive is retained as the comparison baseline in this workspace.';}catch(error){this.status.textContent=String(error);}}
  private async screenshot(tab:chrome.tabs.Tab&{id:number},screen:CapturedScreen){
    await this.command(tab.id,'hide-extension-ui');
    try{const before=await chrome.tabs.query({active:true,windowId:tab.windowId});if(before[0]?.id!==tab.id)throw new Error('The capture tab is not active.');const screenshot=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});const after=await chrome.tabs.query({active:true,windowId:tab.windowId});if(after[0]?.id!==tab.id)throw new Error('The active tab changed during capture.');screen.screenshot=screenshot;}
    finally{await this.command(tab.id,'restore-extension-ui');}
  }
  private async command(tab:number,action:string,payload:Record<string,unknown>={}){const captureMode=document.querySelector<HTMLInputElement>('#interface-full-test-data')?.checked?'test-full':'structure';const result=await chrome.tabs.sendMessage(tab,{type:INTERFACE_COMMAND,action,captureMode,...payload});if(!result?.ok)throw new Error(result?.error??'Reload AlayaCare after updating ACtools.');if(chrome.tabs.getZoom){const zoom=await chrome.tabs.getZoom(tab);for(const screen of [result.data?.screen,...(result.data?.screens??[])].filter(Boolean))if(screen.viewport)screen.viewport.browserZoom=zoom;}return result.data;}
  private async restoreArchive(){try{if(!chrome.storage?.local)return;const data=await chrome.storage.local.get(['ac-interface-checkpoint','ac-interface-baseline-checkpoint']);if(data['ac-interface-baseline-checkpoint'])this.baseline=readInterfaceArchive(Uint8Array.from(atob(data['ac-interface-baseline-checkpoint']),c=>c.charCodeAt(0)));if(!data['ac-interface-checkpoint'])return;const saved=readInterfaceArchive(Uint8Array.from(atob(data['ac-interface-checkpoint']),c=>c.charCodeAt(0)));const tab=await this.active();if(this.capture||saved.sourceOrigin!==new URL(tab.url).origin)return;this.capture=saved;this.screens=saved.screens;this.discovery=saved.coverage.discovery;this.status.textContent=`Restored ${saved.screens.length} captured states from this tenant.`;}catch(error){this.status.textContent=`Saved archive could not be restored: ${String(error)}`;}}
  private checkpoint(){if(this.busy&&this.checkpointTimer)return;clearTimeout(this.checkpointTimer);this.checkpointTimer=setTimeout(()=>{this.checkpointTimer=undefined;void this.saveArchive();},this.busy?30000:500);}
  private async saveArchive(){if(!this.capture||!chrome.storage?.local)return;try{const bytes=gzipSync(strToU8(JSON.stringify(this.capture)),{level:6});if(bytes.length>6_000_000)throw new Error('Checkpoint exceeds local storage budget; export this archive before closing the panel.');let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));const saved:Record<string,string>={'ac-interface-checkpoint':btoa(binary)};if(this.baseline){const prior=gzipSync(strToU8(JSON.stringify(this.baseline)),{level:6});if(bytes.length+prior.length>6_000_000)throw new Error('Current and baseline checkpoints exceed the storage budget; export both snapshots.');let old='';for(let i=0;i<prior.length;i+=16384)old+=String.fromCharCode(...prior.subarray(i,i+16384));saved['ac-interface-baseline-checkpoint']=btoa(old);}await chrome.storage.local.set(saved);}catch(error){this.status.textContent=`Archive remains in this panel, but checkpoint failed: ${String(error)}`;}}
  private remember(origin:string,screen:CapturedScreen){if(!this.capture)this.beginRun(origin);if(this.capture&&this.capture.sourceOrigin!==origin)this.beginRun(origin);const old=this.screens.find(s=>s.route===screen.route&&s.state===screen.state);if(old)screen.id=old.id;this.screens=this.screens.filter(s=>s.route!==screen.route||s.state!==screen.state);if(this.screens.length>=500)throw new Error('500-state archive limit reached. Export before starting another archive.');this.screens.push(screen);const visualAssets=this.capture?.visualAssets;const transitions=this.capture?.transitions;const workflowReport=this.capture?.workflowReport;const run=this.capture?.run;const capturedAt=this.capture?.capturedAt;this.capture=createInterfaceCapture(origin,this.screens,this.capture?.requests??[]);if(run){this.capture.run=run;this.capture.capturedAt=capturedAt!;}this.capture.visualAssets=visualAssets;this.capture.transitions=transitions;this.capture.workflowReport=workflowReport;if(this.discovery)this.capture.coverage.discovery=this.discovery;this.checkpoint();this.status.textContent=`${this.screens.length} states captured across ${this.capture.coverage.routes.length} routes. ${screen.truncated?'Screen tree reached its limit. ':''}${this.diff(screen)}`;return screen.id;}
  private ingest(origin:string,data:{screens:CapturedScreen[];transitions?:CapturedTransition[];report?:NonNullable<InterfaceCapture['workflowReport']>}){const ids=new Map<string,string>();for(const screen of data.screens){const sourceId=screen.id;ids.set(sourceId,this.remember(origin,screen));}if(this.capture){this.capture.transitions=[...(this.capture.transitions??[]),...(data.transitions??[]).map(edge=>({...edge,from:ids.get(edge.from)??edge.from,to:ids.get(edge.to)??edge.to}))].slice(-2000);this.capture.workflowReport=[...(this.capture.workflowReport??[]),...(data.report??[])].slice(-2000);this.checkpoint();}}
  private async dialogs(){if(this.busy)return;this.busy=true;this.stopped=false;try{const tab=await this.active();this.explorationTab=tab.id;this.status.textContent='Opening reviewed dialogs and capturing popup/dismissal states without submitting.';const data=await this.command(tab.id,'explore');this.ingest(new URL(tab.url).origin,data);this.status.textContent=`Dialog capture finished: ${data.screens.length} states, ${data.transitions.length} transitions. Review workflow coverage in the export.`;}catch(error){this.status.textContent=String(error);}finally{this.explorationTab=undefined;this.busy=false;await this.saveArchive();}}

  private diff(screen:CapturedScreen){const before=this.baseline?.screens.find(s=>s.route===screen.route&&s.state===screen.state);return before?`${compareScreen(before,screen).length} structural changes against baseline.`:'';}
  private async current(){if(this.busy)return;this.busy=true;try{const tab=await this.active();const state=(document.querySelector<HTMLInputElement>('#interface-state-name')!.value||'page').trim();const {screen}=await this.command(tab.id,'capture',{state});if(document.querySelector<HTMLInputElement>('#interface-include-screenshot')!.checked){try{await this.screenshot(tab,screen);}catch(error){this.remember(new URL(tab.url).origin,screen);throw new Error(`Structure saved; screenshot failed: ${String(error)}`);}}this.remember(new URL(tab.url).origin,screen);}catch(error){this.status.textContent=String(error);}finally{this.busy=false;await this.saveArchive();}}
  private async walk(resume=false){
    if(this.busy)return;this.busy=true;this.stopped=false;let owned:number|undefined;let reusedSource=false;let startingRoute:string|undefined;
    const previous=resume?this.capture:null;
    if(resume&&!previous?.coverage.discovery?.pending.length){this.busy=false;this.status.textContent='No pending routes to resume. Start a fresh snapshot.';return;}
    if(previous&&previous.coverage.discovery!.attempts.length>=300){this.busy=false;this.status.textContent='The 300-attempt limit was reached. Export this run and start a smaller fresh scope.';return;}
    const discovery:InterfaceDiscovery={strategy:'dom-v2',startedAt:previous?.coverage.discovery?.startedAt??new Date().toISOString(),finishedAt:'',stopped:false,limit:300,attempts:[...(previous?.coverage.discovery?.attempts??[])],pending:[]};
    const queue:string[]=[];const queued=new Set<string>();const seen=new Set<string>();let emptyFailures=0;let runNote='';
    const key=(route:string)=>(safeRoute(route)??route).replace(/\/+$/,'');
    const chartRoutes=new Set<string>();
    const enqueue=(routes:string[])=>{for(const route of routes){if((isInterfaceTraversalRoute(route)||chartRoutes.has(route))&&!queued.has(key(route))&&queued.size<1500){queued.add(key(route));queue.push(route);}}};
    try{
      const source=await this.active();const origin=new URL(source.url).origin;
      if(previous&&previous.sourceOrigin!==origin)throw new Error('Resume must use the same tenant.');
      if(!resume)this.beginRun(origin);
      if(previous){for(const attempt of previous.coverage.discovery?.attempts??[])seen.add(key(attempt.route));for(const screen of previous.screens)if(screen.state==='page')seen.add(key(screen.route));const context=await this.command(source.id,'chart-routes');for(const route of context.routes??[])chartRoutes.add(route);const resolved=new Map([...chartRoutes].map(route=>[safeRoute(route),route]));enqueue((previous.coverage.discovery?.pending??[]).map(route=>resolved.get(route)??route));}
      const {screen}=await this.command(source.id,'capture');this.remember(origin,screen);this.discovery=discovery;
      discovery.attempts.push({route:safeRoute(new URL(source.url).hash)!,status:'captured',actualRoute:screen.route,navigation:'initial'});
      seen.add(key(screen.route));enqueue(screen.navigationRoutes??screen.links.map((l:{route:string})=>l.route));
      if(document.querySelector<HTMLInputElement>('#interface-baseline-routes')!.checked&&this.baseline)enqueue(this.baseline.coverage.routes);
      if(document.querySelector<HTMLInputElement>('#interface-known-routes')!.checked)enqueue(KNOWN_INTERFACE_ROUTES);
      if(document.querySelector<HTMLInputElement>('#interface-current-chart')!.checked){const context=await this.command(source.id,'chart-routes');for(const route of context.routes??[])chartRoutes.add(route);enqueue([...chartRoutes]);}
      let withScreenshots=document.querySelector<HTMLInputElement>('#interface-route-screenshots')!.checked;
      const takeScreenshot=async(screen:CapturedScreen,tab:chrome.tabs.Tab&{id:number})=>{if(!withScreenshots)return;try{await chrome.tabs.update(tab.id,{active:true});await this.screenshot(tab,screen);}catch(error){const reason=String(error).slice(0,1000);if(/activeTab|all_urls|permission/i.test(reason)){withScreenshots=false;runNote='Screenshots disabled after permission failure; page data capture continued.';}if(this.capture)this.capture.workflowReport=[...(this.capture.workflowReport??[]),{route:screen.route,action:'Viewport screenshot',status:'failed',reason}];}};
      // activeTab belongs to the toolbar-invoked source tab, not a new worker.
      // Try that tab once; on permission failure continue background data capture.
      if(withScreenshots&&document.querySelector<HTMLInputElement>('#interface-screenshot-source')?.checked){await takeScreenshot(screen,source);if(withScreenshots){reusedSource=true;startingRoute=new URL(source.url).hash;}}
      const tab=reusedSource?source:await chrome.tabs.create({url:origin+'/#/home',active:withScreenshots});if(!tab.id)throw new Error('Could not open a capture tab.');owned=tab.id;
      let prepared=false;for(let attempt=0;attempt<8;attempt++){try{await this.command(owned,'start');prepared=true;break;}catch(error){if(attempt===7)throw error;await new Promise(resolve=>setTimeout(resolve,400));}}
      if(!prepared)throw new Error('Capture tab did not become ready.');
      // Bootstrap the native app on Home before walking legacy client routes;
      // opening a cold client hash previously produced a blank micro-frontend.
      const initial=await this.command(owned,reusedSource?'navigate':'capture',reusedSource?{route:'#/home'}:{expected:'#/home',state:'page'});
      await takeScreenshot(initial.screen,{...tab,id:owned});this.remember(origin,initial.screen);
      if(!seen.has(key(initial.screen.route)))discovery.attempts.push({route:'#/home',status:'captured',actualRoute:initial.screen.route,navigation:'initial'});
      seen.add(key(initial.screen.route));enqueue(initial.screen.navigationRoutes??initial.screen.links.map((link:{route:string})=>link.route));
      if(document.querySelector<HTMLInputElement>('#interface-auto-dialogs')!.checked && document.querySelector<HTMLSelectElement>('#interface-collection-depth')?.value !== 'inventory'){
        this.explorationTab=owned;const result=await this.command(owned,'explore');this.ingest(origin,result);this.explorationTab=undefined;
      }
      for(let i=0;i<queue.length&&discovery.attempts.length<discovery.limit&&!this.stopped;i++){
        const route=queue[i];if(seen.has(key(route)))continue;seen.add(key(route));
        this.status.textContent=`Discovering ${discovery.attempts.length+1}/${discovery.limit}: ${route}`;
        const attemptStarted=performance.now();
        try{
          const routeStarted=performance.now();let data;
          for(let attempt=0;attempt<3;attempt++){try{data=await this.command(owned,'navigate',{route});break;}catch(error){if(attempt===2||!/receiving end|connection|message port/i.test(String(error)))throw error;await new Promise(resolve=>setTimeout(resolve,600));}}
          if(!data?.screen)throw new Error('No settled screen returned.');
          const actual=data.screen.route;await takeScreenshot(data.screen,{...tab,id:owned});this.remember(origin,data.screen);seen.add(key(actual));emptyFailures=0;
          discovery.attempts.push({route:safeRoute(route)!,status:key(safeRoute(route)!)===key(actual)?'captured':'redirected',actualRoute:actual,durationMs:Math.round(performance.now()-routeStarted),navigation:data.navigation??'hash'});
          if(document.querySelector<HTMLInputElement>('#interface-auto-dialogs')!.checked && document.querySelector<HTMLSelectElement>('#interface-collection-depth')?.value !== 'inventory'){this.explorationTab=owned;const result=await this.command(owned,'explore');this.ingest(origin,result);this.explorationTab=undefined;}
          if(chartRoutes.has(route)){const context=await this.command(owned,'chart-routes');for(const target of context.routes??[])chartRoutes.add(target);enqueue([...chartRoutes]);}
          enqueue(data.screen.navigationRoutes??data.screen.links.map((l:{route:string})=>l.route));
        }catch(error){discovery.attempts.push({route:safeRoute(route)!,status:'failed',error:String(error).slice(0,1000),durationMs:Math.round(performance.now()-attemptStarted)});if(/only the application shell|empty mount|retained the previous page content/i.test(String(error)))emptyFailures++;else emptyFailures=0;if(emptyFailures>=3||/native dialog is still open/i.test(String(error))){this.stopped=true;runNote=emptyFailures>=3?'Stopped after three consecutive pages without native content; remaining routes are pending.':'Stopped because a native dialog remained open; remaining routes are pending.';break;}}
      }
      discovery.pending=queue.filter(route=>!seen.has(key(route))).map(route=>safeRoute(route)!);discovery.stopped=this.stopped;discovery.finishedAt=new Date().toISOString();
      if(this.capture){this.capture.coverage.discovery=discovery;this.capture.requests.push(...discovery.attempts.filter(a=>a.status==='failed').map(a=>({captureFailure:{route:a.route,error:a.error}})));}
      const failed=discovery.attempts.filter(a=>a.status==='failed').length;
      this.status.textContent=`${this.stopped?'Stopped.':'Discovery finished.'} ${this.screens.length} states saved; ${failed} failed routes; ${discovery.pending.length} pending. ${runNote} Export the update bundle before closing this panel.`;
      const recorded=await this.command(owned,'stop');if(this.capture)this.capture.requests.push(...recorded.requests,...(recorded.failures??[]).map((captureFailure:unknown)=>({captureFailure})));
      this.collectedAssets={...await this.command(owned,'assets'),origin};await this.collectVisuals(owned);
    }catch(error){discovery.finishedAt=new Date().toISOString();discovery.stopped=this.stopped;discovery.pending=queue.filter(route=>!seen.has(key(route))).map(route=>safeRoute(route)!);if(this.capture)this.capture.coverage.discovery=discovery;this.status.textContent=String(error);}
    finally{clearTimeout(this.checkpointTimer);this.checkpointTimer=undefined;if(this.capture?.run)this.capture.run.finishedAt=new Date().toISOString();if(owned&&!reusedSource)await chrome.tabs.remove(owned).catch(()=>undefined);if(owned&&reusedSource&&startingRoute&&(isInterfaceTraversalRoute(startingRoute)||isInterfaceChartRoute(startingRoute)))try{await this.command(owned,'navigate',{route:startingRoute});}catch(error){if(this.capture)this.capture.workflowReport=[...(this.capture.workflowReport??[]),{route:safeRoute(startingRoute)!,action:'Restore source page',status:'failed',reason:String(error).slice(0,1000)}];this.status.textContent+=' The source page could not be restored; inspect the native tab (a notice may still be open).';}this.explorationTab=undefined;this.busy=false;await this.saveArchive();}
  }
  private async loadBaseline(event:Event){try{const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;if(file.size>50*1024*1024)throw new Error('Capture must be smaller than 50 MB.');this.baseline=readInterfaceArchive(new Uint8Array(await file.arrayBuffer()));this.baselinePinned=true;this.status.textContent=`Baseline loaded: ${this.baseline.coverage.routes.length} routes. Capture states to compare.`;}catch(error){this.status.textContent=String(error);}}
  private async collectVisuals(tab:number){
    if(!this.capture)return;
    const data=await this.command(tab,'visual-assets');
    const byUrl=new Map((this.capture.visualAssets??[]).map(asset=>[asset.url,asset]));
    for(const asset of data.visualAssets??[])if(!byUrl.get(asset.url)?.data||asset.data)byUrl.set(asset.url,asset);
    let encodedBytes=0;const combined=[...byUrl.values()].slice(0,150).map(asset=>{if(!asset.data)return asset;encodedBytes+=asset.data.length;if(encodedBytes<=24_000_000)return asset;return {...asset,data:undefined,error:'Combined archive visual budget exceeded; narrow the next capture scope.'};});
    validateInterfaceCapture({...this.capture,visualAssets:combined});this.capture.visualAssets=combined;
  }
  private async assetFiles(){
    const tab=await this.active();const origin=new URL(tab.url).origin;
    if(this.capture&&this.capture.sourceOrigin!==origin)throw new Error('Open the captured tenant before exporting its assets or update bundle.');
    if(this.collectedAssets?.origin!==origin)this.collectedAssets=null;
    const activeAssets=await this.command(tab.id,'assets',{stylesOnly:true});await this.collectVisuals(tab.id);
    const candidates=[...new Map([...(this.collectedAssets?.assets??[]),...activeAssets.assets].map(asset=>[asset.url,asset])).values()];
    const failures=[...(this.collectedAssets?.failures??[]),...activeAssets.failures];
    const assets:typeof candidates=[];let bytes=0;
    for(const asset of candidates){bytes+=new TextEncoder().encode(asset.text).length;if(bytes>40_000_000){failures.push({url:asset.url,reason:'Combined bundle asset budget exceeded.'});continue;}assets.push(asset);}
    const files:Record<string,Uint8Array>={};
    for(const asset of this.capture?.visualAssets??[]){if(!asset.data||!asset.sha256)continue;const parts=asset.data.split(',');const raw=asset.data.startsWith('data:image/svg+xml,')?strToU8(decodeURIComponent(parts.slice(1).join(','))):Uint8Array.from(atob(parts.slice(1).join(',')),c=>c.charCodeAt(0));const ext=asset.kind==='font'?asset.data.match(/^data:font\/(\w+)/)?.[1]??'font':asset.data.startsWith('data:image/svg+xml,')?'svg':asset.data.match(/^data:image\/(\w+)/)?.[1]??'image';files[`visual-assets/${asset.sha256}.${ext}`]=raw;}
    for(const [index,asset]of assets.entries())files[`assets/${index}-${asset.sha256.slice(0,16)}.txt`]=strToU8(asset.text);
    files['manifest.json']=strToU8(JSON.stringify({sourceOrigin:origin,capturedAt:new Date().toISOString(),visualAssets:(this.capture?.visualAssets??[]).map(({data,...asset})=>asset),assets:assets.map((asset,index)=>({url:asset.url,sha256:asset.sha256,file:`assets/${index}-${asset.sha256.slice(0,16)}.txt`})),failures,limitations:['Observed same-origin and AlayaCare frontend CDN scripts/styles only. Other origins and unopened lazy modules are outside coverage.','Sources are text evidence; never execute them as an offline vendor app.']},null,2));
    return {files,assets:assets.length,failures:failures.length};
  }
  private downloadZip(files:Record<string,Uint8Array>,name:string){const zip=zipSync(files);if(zip.length>50*1024*1024)throw new Error('Bundle exceeds 50 MB; export the interface archive and assets separately.');const url=URL.createObjectURL(new Blob([new Uint8Array(zip)],{type:'application/zip'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  private async assets(){try{const data=await this.assetFiles();this.downloadZip(data.files,'alayacare-interface-assets.zip');this.status.textContent=`${data.assets} observed assets archived; ${data.failures} failures.`;}catch(error){this.status.textContent=String(error);}}
  private async bundle(){
    if(this.busy||this.recordingTab){this.status.textContent='Finish discovery and stop recording before exporting the update bundle.';return;}
    if(!this.capture){this.status.textContent='Discover routes or capture a state first.';return;}
    this.busy=true;
    try{const data=await this.assetFiles();const capture=validateInterfaceCapture(this.capture);data.files['interface.json.gz']=gzipSync(strToU8(JSON.stringify(capture)),{level:6});for(const [name,content]of Object.entries(snapshotReviewFiles(capture,this.baseline)))data.files[name]=strToU8(content);data.files['coverage-report.json']=strToU8(JSON.stringify({routes:capture.coverage,workflows:capture.workflowReport??[],transitions:capture.transitions?.length??0},null,2));if(this.baseline)data.files['comparison.json']=strToU8(JSON.stringify(compareCaptures(this.baseline,capture),null,2));data.files['README.txt']=strToU8('Load this ZIP in Webforms Help / Surface coverage / Interface archive. Review coverage and comparison before updating the simulator. Vendor source assets are text evidence, not an executable offline app. Reviewed dialogs and current-chart navigation can be captured automatically. Recorded transitions run locally in Webforms; skipped, failed and unobserved server behaviors are listed in the coverage report.');this.downloadZip(data.files,`alayacare-update-${capture.capturedAt.replace(/[:.]/g,'-')}.zip`);this.status.textContent=`Update bundle exported: ${capture.coverage.routes.length} routes, ${data.assets} assets, ${data.failures} asset failures. Review coverage-report.json for uncaptured routes.`;}
    catch(error){this.status.textContent=String(error);}finally{this.busy=false;}
  }
  private async recordRequests(){try{if(this.recordingTab){const data=await this.command(this.recordingTab,'stop');const recordedTab=await chrome.tabs.get(this.recordingTab);if(recordedTab.url){for(const screen of data.screens??[])this.remember(new URL(recordedTab.url).origin,screen);}if(this.capture)this.capture.requests=[...this.capture.requests,...data.requests,...(data.failures??[]).map((failure:unknown)=>({captureFailure:failure}))];this.recordingTab=undefined;this.status.textContent=`${data.requests.length} response shapes and dialog/menu states saved; ${data.failures?.length??0} recording gaps. Displayed values follow the selected capture mode.`;}else{const tab=await this.active();await this.command(tab.id,'start');this.recordingTab=tab.id;this.status.textContent='Recording response shapes and states after clicks in this tab. Click again to stop before export.';}}catch(error){this.status.textContent=String(error);}finally{await this.saveArchive();}}
  private async export(){
    if(this.busy){this.status.textContent='Finish discovery before export.';return;}
    if(this.recordingTab){this.status.textContent='Stop request recording before export.';return;}
    if(!this.capture){this.status.textContent='Capture a state first.';return;}
    this.busy=true;
    try{
      this.status.textContent='Collecting fonts/images for the offline archive…';
      const tab=await this.active();await this.command(tab.id,'assets',{stylesOnly:true});await this.collectVisuals(tab.id);
      const capture=validateInterfaceCapture(this.capture);
      const bytes=gzipSync(strToU8(JSON.stringify(capture)),{level:6});
      const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'application/gzip'}));
      const link=document.createElement('a');link.href=url;link.download=`alayacare-interface-${capture.capturedAt.replace(/[:.]/g,'-')}.json.gz`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      if(this.baseline)this.download(JSON.stringify(snapshotInventory(capture,this.baseline),null,2),'application/json','alayacare-interface-comparison.json');
      this.status.textContent=`Archive exported: ${capture.screens.length} states, ${(capture.visualAssets??[]).filter(a=>a.data).length} embedded visual resources, ${(capture.visualAssets??[]).filter(a=>!a.data).length} missing.`;
    }catch(error){this.status.textContent='Archive export failed: '+String(error);}
    finally{this.busy=false;await this.saveArchive();}
  }

}
