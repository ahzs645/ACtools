import {captureScreen,isExtensionUI,safeRoute} from './interface-capture.mjs';

const clean = value => String(value??'').trim().replace(/^[^a-z0-9]+/i,'').replace(/\s+/g,' ').slice(0,300);
const visible = el => !isExtensionUI(el) && Boolean(el.getClientRects().length);
// Exact, reviewed openers only. This list never authorizes saving, approval,
// uploads, chart writes or an arbitrary button discovered on a page.
export function dialogOpeners(route) {
  if(route==='#/system-settings/forms')return ['Add Form','Import Form','Manage Form Categories'];
  if(route==='#/system-settings/templates')return ['Add template'];
  if(route==='#/system-settings/form-context')return ['Add Field'];
  if(route==='#/system-settings/notifications')return ['Add Queue'];
  if(route==='#/system-settings/roles-permissions')return ['Create a Role'];
  if(route==='#/system-settings/libraries/medication-libraries')return ['Create','Create library','Create Medication Library'];
  if(route==='#/home'||route==='#/dashboard/v2/tasks')return ['Task','New Task','Create Task'];
  if(route?.startsWith('#/scheduling/calendar/'))return ['New Visit'];
  if(route?.includes('/accounting/settings/bill-codes'))return ['Add Bill Code'];
  if(route?.includes('/accounting/settings/service-codes'))return ['Add Service Code'];
  if(route?.includes('/notes'))return ['Note','Add Progress Note','New Progress Note'];
  if(route?.includes('/medications'))return ['Add Medication','New Medication'];
  if(route?.includes('/care-plan'))return ['Add Care Plan','New Care Plan'];
  return [];
}
export function currentChartRoutes(doc,href) {
  const url=new URL(href);
  const prefix=url.hash.match(/^#\/(?:clients\/|client\/default\/|customer\/default\/view\/id\/)([a-zA-Z0-9-]+)(?=\/|$)/i)?.[0];
  if(!prefix)return [];
  return [...new Set([...doc.querySelectorAll('a[href]')].filter(el=>!isExtensionUI(el)).flatMap(el=>{
    try {const target=new URL(el.getAttribute('href'),url);const hash=target.hash.split('?')[0];
      return target.origin===url.origin && (hash===prefix||hash.startsWith(prefix+'/')) && !/\/(?:add|create|edit|delete|remove|upload|import)(?:[\/_-]|$)/i.test(hash) ? [hash] : [];
    }catch{return [];}
  }))].slice(0,80);
}
export function openDialogs(doc) {
  // Native Task uses .acds-dock-modal, without role=dialog (UAT DOM 2026-10-16).
  const selector='[role=dialog],.popup,.el-dialog,.drawer-container,.acds-dock-modal';
  return [...doc.querySelectorAll(selector)].filter(visible).filter(el=>!el.parentElement?.closest(selector));
}
export function safeDialogCandidates(doc,href) {
  const allowed=new Set(dialogOpeners(safeRoute(new URL(href).hash)));
  return [...doc.querySelectorAll('button,[role=button]')].filter(el=>visible(el)&&!el.closest('td')&&!el.hasAttribute('disabled')&&el.getAttribute('aria-disabled')!=='true'&&allowed.has(clean(el.getAttribute('aria-label')||el.textContent)));
}
const descriptor = (screen,el) => {
  const text=clean(el.getAttribute('aria-label')||el.textContent);
  const control=screen.controls.find(c=>clean(c.label)===text);
  return {kind:'click',label:text,...(control?.id?{controlId:control.id}:{})};
};
function escape(doc) {
  const target=doc.activeElement||doc.body;
  for(const type of ['keydown','keyup'])target.dispatchEvent(new doc.defaultView.KeyboardEvent(type,{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));
}
function closeDialog(doc) {
  const roots=openDialogs(doc);
  const root=roots.at(-1);
  if(!root)return true;
  const button=[...root.querySelectorAll('button,a,[role=button]')].find(el=>visible(el)&& (/^(Cancel|Close)$/i.test(clean(el.getAttribute('aria-label')||el.textContent))||el.matches('[data-test="popup-header-close"]')));
  if(button){button.click();return true;}
  escape(doc);return false;
}
/** Capture reviewed openers, popup choices, focus and dismissal without writes. */
export async function exploreDialogs(doc,href,{settle=async state=>captureScreen(doc,href,state),isStopped=()=>false,maxActions=30}={}) {
  const screens=[];const transitions=[];const report=[];let actions=0;
  const route=safeRoute(new URL(href).hash);
  const snap=async state=>{const screen=await settle(state);screens.push(screen);return screen;};
  const edge=(from,to,action)=>transitions.push({from:from.id,to:to.id,action});
  if(openDialogs(doc).length){report.push({route,action:'Explore dialogs',status:'skipped',reason:'A dialog is already open; it was left unchanged.'});return {screens,transitions,report};}
  const candidates=safeDialogCandidates(doc,href);
  if(!candidates.length){report.push({route,action:'Explore dialogs',status:'skipped',reason:'No reviewed dialog opener found on this page.'});return {screens,transitions,report};}
  let page=await snap('page');
  for(const opener of candidates) {
    if(isStopped()||actions>=maxActions)break;
    if(!opener.isConnected||!visible(opener))continue;
    const name=clean(opener.getAttribute('aria-label')||opener.textContent);
    // Native Import Form opens an OS file chooser directly. It is not a DOM
    // dialog, and leaving that chooser open would block unattended traversal.
    if(name==='Import Form') {report.push({route,action:name,status:'skipped',reason:'Native file chooser: control metadata is captured; use the connected local import workflow with a fixture.'});continue;}
    try {
      actions++;opener.click();let opened=await snap(`${name} / opened`);
      edge(page,opened,descriptor(page,opener));
      if(!openDialogs(doc).length){report.push({route,action:name,status:'failed',reason:'No recognized dialog appeared; no further controls were clicked.'});break;}
      report.push({route,action:name,status:'captured'});
      // Static comboboxes and native readonly date inputs can expose more UI.
      // Directory autocomplete and file controls are intentionally excluded.
      const pickerLabel=el=>clean(el.getAttribute('aria-label')||el.closest('.field-grid,.input-wrapper')?.querySelector('.field-label,label,.label')?.textContent||(el.tagName==='BUTTON'?el.textContent:'')||el.getAttribute('placeholder')||'Picker');
      const dialogPickers=()=>[...openDialogs(doc).at(-1)?.querySelectorAll('[role=combobox],input[readonly],button')??[]].filter(el=>visible(el)&&(el.getAttribute('aria-autocomplete')!=='list'||el.getAttribute('aria-label')==='Search or select a note type')&&!el.matches('[type=file]') && (el.tagName!=='BUTTON'||['Roles able to submit form','Roles able to view form'].includes(pickerLabel(el))));
      const pickerCount=Math.min(dialogPickers().length,8);
      for(let pickerIndex=0;pickerIndex<pickerCount;pickerIndex++) {
        if(isStopped()||actions>=maxActions)break;
        // Some native menus close their entire parent on Escape. Reopen the
        // reviewed dialog to capture the remaining pickers without submitting.
        if(!openDialogs(doc).length){if(!opener.isConnected||!visible(opener))break;actions++;opener.click();opened=await snap(`${name} / reopened ${pickerIndex+1}`);edge(page,opened,descriptor(page,opener));}
        const picker=dialogPickers()[pickerIndex];
        if(!picker?.isConnected||!visible(picker))continue;
        actions++;const label=pickerLabel(picker);
        picker.click();const expanded=await snap(`${name} / ${label} open`);edge(opened,expanded,{kind:'click',label});
        escape(doc);const dismissed=await snap(`${name} / ${label} Escape`);edge(expanded,dismissed,{kind:'escape',label:'Escape'});
        if(!openDialogs(doc).length){page=dismissed;continue;}
        opened=dismissed;
      }
      if(openDialogs(doc).length) {
        closeDialog(doc);const after=await snap('page');edge(opened,after,{kind:'click',label:'Cancel / Close'});page=after;
        if(openDialogs(doc).length){report.push({route,action:name,status:'failed',reason:'Dialog did not close; exploration stopped to preserve the current screen.'});break;}
      }
    }catch(error){report.push({route,action:name,status:'failed',reason:String(error).slice(0,1000)});closeDialog(doc);break;}
  }
  return {screens,transitions,report};
}
