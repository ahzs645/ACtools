import type {CapturedNode} from './interface-capture.mjs';
export interface VisualResource {url:string;kind:'font'|'image';fontFamily?:string;fontWeight?:string;fontStyle?:string;data?:string;sha256?:string;error?:string;}
export interface VisualDetail {backgroundImage?:{source:string};iconClasses?:string[];before?:{text:string;styles:Record<string,string>};after?:{text:string;styles:Record<string,string>};image?:{source:string;alt:string;width:number;height:number};attributes?:Record<string,string>;}
export const VISUAL_TAGS:string[];
export function isVisualResourceUrl(value:string,origin:string,kind:string):boolean;
export function safeImageData(value:unknown):boolean;
export function captureVisualDetails(el:Element,properties:string[]):VisualDetail|undefined;
export function visualResourceReferences(doc:Document,tree:CapturedNode|null,origin:string):VisualResource[];
export function validateVisualDetails(visual:unknown,validateStyles:(styles:Record<string,string>)=>void):void;
export function validateVisualAssets(assets:unknown,origin:string):void;
export function capturedVisualHtml(node:CapturedNode|null,assets?:VisualResource[]):string;
export function capturedFontCss(assets?:VisualResource[]):string;
export function fontResourcesFromCss(css:string,base:string,origin:string):VisualResource[];
export function collectVisualAssets(refs:VisualResource[],origin:string,fetcher?:typeof fetch):Promise<VisualResource[]>;
