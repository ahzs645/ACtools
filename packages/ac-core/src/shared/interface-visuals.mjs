/** Inert visual evidence. Resources are embedded data, never vendor scripts. */
const SVG_ATTRS=new Set(['viewBox','d','points','x','y','x1','x2','y1','y2','cx','cy','r','rx','ry','width','height','fill','fill-rule','stroke','stroke-width','stroke-linecap','stroke-linejoin','opacity','transform','offset','stop-color','stop-opacity']);
const SVG_TAGS=new Set(['svg','path','g','circle','ellipse','rect','line','polygon','polyline','defs','linearGradient','stop']);
export const VISUAL_TAGS=[...SVG_TAGS];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function isVisualResourceUrl(value,origin,kind){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(u.origin===origin||u.hostname==='accloud-frontend-assets.alayacare.com'||(kind==='font'&&u.hostname==='fonts.gstatic.com'));}catch{return false;}}
export function safeImageData(value){
 if(typeof value!=='string'||value.length>3_000_000)return false;
 if(/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(value))return true;
 if(!/^data:image\/svg\+xml(?:;base64)?,/i.test(value))return false;
 try{const [head,...rest]=value.split(',');const svg=/base64/i.test(head)?atob(rest.join(',')):decodeURIComponent(rest.join(','));if(!/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(svg)||/<\s*(?:script|foreignObject|iframe|object|embed|animate|set)\b|\bon[a-z]+\s*=|@import|<!DOCTYPE|\\/i.test(svg))return false;
  // Embedded SVG assets may use local gradient/mask/use definitions. Keep
  // fragment-only references; no external images, styles or navigation URLs.
  for(const match of svg.matchAll(/\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi))if(!/^#[a-z0-9_.:-]+$/i.test(match[2]))return false;
  const localUrls=svg.replace(/url\(\s*(["']?)#[a-z0-9_.:-]+\1\s*\)/gi,'');
  return !/url\s*\(|\b(?:href|src)\s*=\s*[^"'\s]/i.test(localUrls);}catch{return false;}
}
function pseudoText(raw){if(!raw||['none','normal','""',"''"].includes(raw))return '';try{return JSON.parse(raw);}catch{return raw.replace(/^['"]|['"]$/g,'').replace(/\\([0-9a-f]{1,6})\s?/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16)));}}
export function captureVisualDetails(el,properties){
 const view=el.ownerDocument.defaultView,visual={};
 try{const background=view.getComputedStyle(el).getPropertyValue('background-image');const source=background.match(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/)?.[1];if(source&&(safeImageData(source)||/^https:/.test(source)))visual.backgroundImage={source};}catch{}
 const classes=[...el.classList].filter(c=>/^(?:ph(?:-[a-z0-9-]+)?|fa[srlbd]?|fa-[a-z0-9-]+)$/.test(c));if(classes.length)visual.iconClasses=classes;
 if(classes.length||['I','SPAN','BUTTON','A','LABEL'].includes(el.tagName))for(const part of ['before','after']){try{const style=view.getComputedStyle(el,'::'+part);const text=pseudoText(style.getPropertyValue('content'));if(!text)continue;visual[part]={text:String(text).slice(0,1000),styles:Object.fromEntries(properties.map(key=>[key,style.getPropertyValue(key)]).filter(([,v])=>v&&!/url\s*\(|expression|javascript:/i.test(v)))};}catch{/* An unsupported pseudo-element remains an explicit absent detail. */}}
 if(el.tagName==='IMG'){const source=el.currentSrc||el.src;if(source&&(safeImageData(source)||/^https:/.test(source)))visual.image={source,alt:(el.alt||'').slice(0,1000),width:el.naturalWidth||el.width||0,height:el.naturalHeight||el.height||0};}
 if(SVG_TAGS.has(el.tagName.toLowerCase())||SVG_TAGS.has(el.tagName)){visual.attributes=Object.fromEntries([...el.attributes].filter(a=>SVG_ATTRS.has(a.name)&&a.value.length<=200000&&!/url\s*\(|javascript:/i.test(a.value)).map(a=>[a.name,a.value]));}
 return Object.keys(visual).length?visual:undefined;
}
export function visualResourceReferences(doc,tree,origin){
 const resources=new Map();const add=item=>{if(isVisualResourceUrl(item.url,origin,item.kind))resources.set(item.url,item);};
 const visit=node=>{if(!node)return;const source=node.visual?.image?.source;if(source&&!source.startsWith('data:'))add({url:source,kind:'image'});const bg=node.visual?.backgroundImage?.source;if(bg&&!bg.startsWith('data:'))add({url:bg,kind:'image'});node.children.forEach(visit);};visit(tree);
 const rules=(list,base)=>{for(const rule of list){if(rule.type===5){const src=rule.style.getPropertyValue('src');for(const match of src.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)){try{add({url:new URL(match[1],base||origin).href,kind:'font',fontFamily:rule.style.getPropertyValue('font-family').replace(/^['"]|['"]$/g,''),fontWeight:rule.style.getPropertyValue('font-weight')||'400',fontStyle:rule.style.getPropertyValue('font-style')||'normal'});}catch{}}}else if(rule.cssRules)rules(rule.cssRules,base);}};
 for(const sheet of doc.styleSheets)try{rules(sheet.cssRules,sheet.href);}catch{/* Opaque cross-origin sheets are listed as assets, not invented font mappings. */}
 // CSSOM cannot expose opaque CDN sheets. Associate reviewed native font URL
 // families only when that family is also present in the document's FontFaceSet.
 const loadedFamilies=new Set([...doc.fonts??[]].map(face=>face.family.replace(/^['"]|['"]$/g,'')));
 for(const entry of doc.defaultView.performance?.getEntriesByType?.('resource')??[]){
  const family=/\/robotoflex\//i.test(entry.name)?'Roboto Flex':/Phosphor[^/]*\.(?:woff2?|ttf|otf)/i.test(entry.name)?'Phosphor':null;
  if(family&&loadedFamilies.has(family)&&!resources.has(entry.name))add({url:entry.name,kind:'font',fontFamily:family,fontWeight:family==='Roboto Flex'?'100 1000':'400',fontStyle:'normal'});
 }
 return [...resources.values()].slice(0,150);
}
export function validateVisualDetails(visual,validateStyles){
 if(!visual||typeof visual!=='object'||Array.isArray(visual))throw new Error('Invalid visual detail.');
 if(visual.iconClasses!==undefined&&(!Array.isArray(visual.iconClasses)||visual.iconClasses.length>20||visual.iconClasses.some(c=>typeof c!=='string'||!/^[-a-z0-9]+$/.test(c)||c.length>100)))throw new Error('Invalid icon classes.');
 for(const part of ['before','after'])if(visual[part]!==undefined){if(typeof visual[part].text!=='string'||visual[part].text.length>1000)throw new Error('Invalid pseudo-element.');validateStyles(visual[part].styles);}
 if(visual.backgroundImage&&(typeof visual.backgroundImage.source!=='string'||visual.backgroundImage.source.length>3_000_000||!(safeImageData(visual.backgroundImage.source)||/^https:\/\//.test(visual.backgroundImage.source))))throw new Error('Invalid background image.');
 if(visual.image){const i=visual.image;if(typeof i.source!=='string'||i.source.length>3_000_000||!(safeImageData(i.source)||/^https:\/\//.test(i.source))||typeof i.alt!=='string'||i.alt.length>1000||![i.width,i.height].every(n=>Number.isFinite(n)&&n>=0&&n<=100000))throw new Error('Invalid captured image.');}
 if(visual.attributes&&Object.entries(visual.attributes).some(([k,v])=>!SVG_ATTRS.has(k)||typeof v!=='string'||v.length>200000||/url\s*\(|javascript:/i.test(v)))throw new Error('Invalid SVG geometry.');
}
export function validateVisualAssets(assets,origin){
 if(!Array.isArray(assets)||assets.length>150)throw new Error('Invalid visual resources.');let bytes=0;
 for(const item of assets){if(!['font','image'].includes(item.kind)||!isVisualResourceUrl(item.url,origin,item.kind))throw new Error('Invalid visual resource URL.');
  if(item.data!==undefined){bytes+=item.data.length;if(bytes>24_000_000||typeof item.data!=='string'||(item.kind==='image'?!safeImageData(item.data):!/^data:font\/(?:woff2?|ttf|otf);base64,[a-z0-9+/=]+$/i.test(item.data)))throw new Error('Invalid embedded visual resource.');}
  for(const key of ['fontFamily','fontWeight','fontStyle','error','sha256'])if(item[key]!==undefined&&(typeof item[key]!=='string'||item[key].length>1000||/[<>]/.test(item[key])))throw new Error('Invalid visual resource metadata.');
 }
}
function styleText(styles){return Object.entries(styles??{}).filter(([,v])=>!/[<>]|url\s*\(|expression|javascript:/i.test(v)).map(([k,v])=>`${k}:${v}`).join(';');}
export function capturedVisualHtml(node,assets=[]){
 if(!node)return '';let tag=['body','input','select','textarea','form'].includes(node.tag)?'div':node.tag;
 if(tag==='lineargradient')tag='linearGradient';const visual=node.visual??{};const pseudo=part=>visual[part]?`<span aria-hidden="true" style="${esc(styleText(visual[part].styles))}">${esc(visual[part].text)}</span>`:'';
 const attrs=visual.attributes?Object.entries(visual.attributes).filter(([k])=>SVG_ATTRS.has(k)).map(([k,v])=>` ${k}="${esc(v)}"`).join(''):'';
 const bg=visual.backgroundImage?.source;const bgData=safeImageData(bg)?bg:assets.find(a=>a.kind==='image'&&a.url===bg)?.data;
 const style=esc(styleText(node.styles)+(bgData&&safeImageData(bgData)?`;background-image:url(${JSON.stringify(bgData)})`:""));
 if(tag==='img'){const source=visual.image?.source;const embedded=safeImageData(source)?source:assets.find(a=>a.url===source&&a.kind==='image')?.data;return embedded&&safeImageData(embedded)?`<img alt="${esc(visual.image.alt)}" src="${esc(embedded)}" style="${style}">`:`<div style="${style}">${esc(visual.image?.alt||node.label)}</div>`;}
 const content=node.value!==undefined?(node.checked?'☑ ':'')+node.value:node.text||(!node.children.length?node.label:'');
 return `<${tag}${attrs} style="${style}"${tag==='button'?' disabled':''}>${pseudo('before')}${esc(content)}${node.children.map(child=>capturedVisualHtml(child,assets)).join('')}${pseudo('after')}</${tag}>`;
}
export function capturedFontCss(assets=[]){return assets.filter(a=>a.kind==='font'&&a.data&&a.fontFamily).map(a=>`@font-face{font-family:${JSON.stringify(a.fontFamily)};src:url(${JSON.stringify(a.data)});font-weight:${/^[0-9 ]+$/.test(a.fontWeight??'')?a.fontWeight:'400'};font-style:${a.fontStyle==='italic'?'italic':'normal'}}`).join('\n');}
/** Read @font-face from fetched opaque CDN stylesheets without executing them. */
export function fontResourcesFromCss(css,base,origin){
 const refs=[];
 for(const face of css.matchAll(/@font-face\s*\{([^}]+)\}/gi)){
  const prop=name=>face[1].match(new RegExp('(?:^|;)\\s*'+name+'\\s*:\\s*([^;]+)','i'))?.[1]?.trim();
  const family=prop('font-family')?.replace(/^['"]|['"]$/g,'');if(!family)continue;
  for(const match of (prop('src')??'').matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g))try{const url=new URL(match[1],base).href;if(isVisualResourceUrl(url,origin,'font')&&/\.(?:woff2?|ttf|otf)(?:[?#]|$)/i.test(url))refs.push({url,kind:'font',fontFamily:family,fontWeight:prop('font-weight')??'400',fontStyle:prop('font-style')??'normal'});}catch{}
 }
 return refs;
}
/** Bounded, deduplicated binary evidence collection. Missing assets remain explicit. */
export async function collectVisualAssets(refs,origin,fetcher=fetch){
 const result=[];let bytes=0;const deadline=Date.now()+30000;
 for(const item of [...new Map(refs.map(r=>[r.url,r])).values()].slice(0,150)){
  if(!isVisualResourceUrl(item.url,origin,item.kind))continue;
  try{
   if(Date.now()>deadline)throw new Error('Visual collection deadline reached; retry export for missing assets.');
   const response=await fetcher(item.url,{method:'GET',credentials:new URL(item.url).origin===origin?'same-origin':'omit',redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(8000,deadline-Date.now())))});
   if(!response.ok)throw new Error(`HTTP ${response.status}`);
   const declared=Number(response.headers.get('content-length'));if(declared>2_000_000)throw new Error('Visual asset exceeds 2 MB.');
   // Stream the response so an oversized resource cannot allocate unbounded memory.
   const reader=response.body?.getReader();if(!reader)throw new Error('Visual asset has no response body.');
   const chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000||bytes+size>16_000_000)throw new Error('Visual asset budget exceeded.');chunks.push(value);}}finally{await reader.cancel().catch(()=>undefined);}
   const binary=new Uint8Array(size);let offset=0;for(const chunk of chunks){binary.set(chunk,offset);offset+=chunk.length;}
   let mime=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
   if(item.kind==='font'){const ext=new URL(item.url).pathname.match(/\.(woff2?|ttf|otf)$/i)?.[1]?.toLowerCase();if(!ext)throw new Error('Unrecognized font format.');mime='font/'+ext;}
   let data;
   if(mime==='image/svg+xml'){data='data:image/svg+xml,'+encodeURIComponent(new TextDecoder().decode(binary));}
   else {let text='';for(let i=0;i<binary.length;i+=32768)text+=String.fromCharCode(...binary.subarray(i,i+32768));data=`data:${mime};base64,${btoa(text)}`;}
   const asset={...item,data,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',binary))].map(b=>b.toString(16).padStart(2,'0')).join('')};validateVisualAssets([asset],origin);bytes+=size;result.push(asset);
  }catch(error){result.push({...item,error:String(error instanceof Error?error.message:error).slice(0,500)});}
 }
 return result;
}
