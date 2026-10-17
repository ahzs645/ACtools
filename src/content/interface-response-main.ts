/** Passive request-shape recorder, enabled only from ACtools. No bodies/headers/cookies exported. */
import {responseShape,safeRequestPath} from '@ac-core/shared/interface-capture.mjs';
let enabled=false;let pending=0;
const busy=(delta:number)=>{pending=Math.max(0,pending+delta);window.dispatchEvent(new CustomEvent('ac-interface-busy',{detail:pending}));};
window.addEventListener('ac-interface-record',event=>{enabled=(event as CustomEvent).detail===true;});
const record=(rawUrl:string,method:string,status:number,value:unknown)=>{if(!enabled)return;let url:URL;try{url=new URL(rawUrl,location.origin);}catch{return;}if(url.origin!==location.origin)return;window.dispatchEvent(new CustomEvent('ac-interface-response',{detail:{path:safeRequestPath(url.pathname),queryKeys:[...new Set(url.searchParams.keys())].sort(),method,status,shape:responseShape(value)}}));};
window.addEventListener('ac-interface-busy-request',()=>busy(0));
const originalFetch=window.fetch;
window.fetch=async function(...args:Parameters<typeof fetch>){busy(1);let result:Response;try{result=await originalFetch.apply(this,args);}finally{busy(-1);}if(enabled&&result.headers.get('content-type')?.includes('json')){const size=Number(result.headers.get('content-length')||0);if(size<=2_000_000)void result.clone().text().then(text=>{if(text.length<=2_000_000)record(result.url,args[1]?.method??(args[0] instanceof Request?args[0].method:'GET'),result.status,JSON.parse(text));}).catch(()=>undefined);}return result;};
const open=XMLHttpRequest.prototype.open;
// Keep native overloads and transport unchanged; record only successful JSON parsing.
XMLHttpRequest.prototype.open=function(this:XMLHttpRequest,method:string,url:string|URL,...rest:unknown[]){this.addEventListener('load',()=>{if(!enabled)return;try{const value=this.responseType==='json'?this.response:this.responseType===''||this.responseType==='text'?JSON.parse(this.responseText):undefined;if(value!==undefined)record(this.responseURL,method,this.status,value);}catch{/* Non-JSON/binary responses are deliberately omitted. */}},{once:true});return (open as (...args:unknown[])=>void).apply(this,[method,url,...rest]);} as typeof open;

const originalSend=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send=function(this:XMLHttpRequest,body?:Document|XMLHttpRequestBodyInit|null){busy(1);this.addEventListener('loadend',()=>busy(-1),{once:true});try{return originalSend.call(this,body);}catch(error){busy(-1);throw error;}};
