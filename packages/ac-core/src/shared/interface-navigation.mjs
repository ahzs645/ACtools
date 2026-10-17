import {isExtensionUI,isInterfaceTraversalRoute,isInterfaceChartRoute} from './interface-capture.mjs';

/** Native roots observed in UAT: legacy #app/#content and single-spa services.
 * Shell navigation, task docks and detached parcels do not prove page readiness. */
export function interfacePageReadiness(doc) {
  const visible=el=>Boolean(el.getClientRects().length)&&doc.defaultView.getComputedStyle(el).visibility!=='hidden';
  // Native legacy pages mount their actual micro-frontend below the tab bar.
  // #app itself already contains a heading and links while that slot is empty.
  const slots=[...doc.querySelectorAll('.tabs__content,.tab-content')].filter(visible);
  const roots=[...doc.querySelectorAll('#app,#content,main,[role="main"],[id^="single-spa-application:"]')]
    .filter(el=>!isExtensionUI(el)&&!el.closest('.acds-dock-modal,header,nav,aside')&&!/shell_layout_blocks|DockModalManagerApp/i.test(el.id));
  const candidates=slots.length?slots.filter(el=>!slots.some(other=>other!==el&&el.contains(other))):roots;
  const content=candidates.find(el=>visible(el)&&(el.textContent.trim()||[...el.querySelectorAll('input,textarea,select,canvas,table,[role=grid]')].some(visible)));
  const loading=[...doc.querySelectorAll('.loading-global,[aria-busy=true],.loading-overlay,.el-loading-mask,.dataTables_processing')].some(visible);
  return {ready:Boolean(content)&&!loading,root:content,signature:content?`${content.id}:${content.textContent.replace(/\s+/g,' ').trim().slice(0,10000)}:${content.querySelectorAll('input,button,select,textarea,table,canvas').length}`:'',reason:loading?'Native page is still loading.':content?'':'No rendered native page content; only the application shell or an empty mount is present.'};
}

/** Choose a visible same-tenant anchor so AlayaCare handles its own navigation. */
export function interfaceNavigationLink(doc,href,route) {
  const source=new URL(href);
  const chartPrefix=hash=>hash.match(/^#\/(?:clients\/|client\/default\/|customer\/default\/view\/id\/)[^/]+(?=\/|$)/)?.[0];
  if(!isInterfaceTraversalRoute(route)&&!(isInterfaceChartRoute(route)&&chartPrefix(source.hash)&&chartPrefix(source.hash)===chartPrefix(route)))return null;
  return [...doc.querySelectorAll('a[href]')].find(el=>{
    if(isExtensionUI(el)||!el.getClientRects().length||el.getAttribute('target')==='_blank'||el.hasAttribute('download'))return false;
    try {const target=new URL(el.getAttribute('href'),source);return target.origin===source.origin&&target.hash.split('?')[0].replace(/\/+$/,'')===route.split('?')[0].replace(/\/+$/,'')&&!target.hash.includes('?');}catch{return false;}
  })??null;
}
