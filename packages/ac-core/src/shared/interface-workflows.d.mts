import type {CapturedScreen,CapturedTransition,InterfaceCapture} from './interface-capture.mjs';
export function dialogOpeners(route: string | null): string[];
export function currentChartRoutes(doc: Document,href: string): string[];
export function openDialogs(doc: Document): Element[];
export function safeDialogCandidates(doc: Document,href: string): HTMLElement[];
export function exploreDialogs(doc:Document,href:string,options?:{settle?:(state:string)=>Promise<CapturedScreen>;isStopped?:()=>boolean;maxActions?:number}): Promise<{screens:CapturedScreen[];transitions:CapturedTransition[];report:NonNullable<InterfaceCapture['workflowReport']>}>;
