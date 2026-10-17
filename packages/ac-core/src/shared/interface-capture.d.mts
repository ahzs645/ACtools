import type {VisualDetail,VisualResource} from './interface-visuals.mjs';
export const INTERFACE_FORMAT: "webforms-alayacare-interface-capture";
export const INTERFACE_COMMAND: string;
export const EXTENSION_UI_SELECTOR: string;
export function isExtensionUI(el: Element | null): boolean;
export function hideExtensionUI(doc: Document): () => void;
export const STYLE_PROPERTIES: string[];
export interface CapturedNode {
  visual?:VisualDetail;
  value?: string;
  checked?: boolean;
  controlId?: string;
  tag: string;
  role: string;
  label: string;
  text: string;
  styles: Record<string, string>;
  children: CapturedNode[];
}
export interface CapturedControl {
  value?: string;
  checked?: boolean;
  readOnly?: boolean;
  selectedValues?: string[];
  recordTemplate?: boolean;
  id?: string;
  tag: string;
  role: string;
  label: string;
  type: string;
  disabled: boolean;
  required: boolean;
  options: string[];
}
export interface CapturedScreen {
  visualResources?:VisualResource[];
  captureMode?: 'test-full';
  sourceRoute?: string;
  captureLimits?: string[];
  focusedControlId?: string;
  navigationRoutes?: string[];
  screenshot?: string;
  viewport?: { width: number; height: number; devicePixelRatio?: number;browserZoom?:number };
  id: string;
  route: string;
  state: string;
  capturedAt: string;
  headings: string[];
  columns: string[];
  controls: CapturedControl[];
  links: { label: string; route: string }[];
  tree: CapturedNode | null;
  truncated: boolean;
  assets: { kind: string; url: string }[];
}
export interface InterfaceCapture {
  visualAssets?:VisualResource[];
  run?: {id:string;startedAt:string;finishedAt?:string;extensionVersion:string;label:string};
  transitions?: CapturedTransition[];
  workflowReport?: {route:string;action:string;status:'captured'|'skipped'|'failed';reason?:string}[];
  format: typeof INTERFACE_FORMAT;
  formatVersion: 1;
  capturedAt: string;
  sourceOrigin: string;
  screens: CapturedScreen[];
  requests: unknown[];
  coverage: { routes: string[]; states: number; limitations: string[]; discovery?: InterfaceDiscovery };
}
export interface CapturedTransition {from:string;to:string;action:{kind:'click'|'escape'|'navigate';label:string;controlId?:string};}
export interface InterfaceDiscovery {
  strategy?: 'dom-v2';
  startedAt: string;
  finishedAt: string;
  stopped: boolean;
  limit: number;
  attempts: { route: string; status: 'captured' | 'redirected' | 'failed'; actualRoute?: string; error?: string; durationMs?:number; navigation?:'initial'|'dom'|'hash'|'reload' }[];
  pending: string[];
}
export function safeRoute(value: unknown): string | null;
export function staticRoute(value: unknown): string | null;
export function isInterfaceTraversalRoute(value: unknown): boolean;
export function isInterfaceChartRoute(value: unknown): boolean;
export function captureRouteMatches(expected: unknown, actual: unknown): boolean;
export function isInterfaceSourceAsset(value: string, sourceOrigin: string): boolean;
export function responseShape(value: unknown, depth?: number): unknown;
export function captureScreen(
  doc: Document,
  href: string,
  state?: string,
  options?: {mode?:'test-full'|'structure'},
): CapturedScreen;
export function createInterfaceCapture(
  origin: string,
  screens?: CapturedScreen[],
  requests?: unknown[],
): InterfaceCapture;
export function validateInterfaceCapture(value: unknown): InterfaceCapture;
export function compareScreen(
  expected: CapturedScreen,
  actual: CapturedScreen,
): Array<Record<string, unknown>>;
export function compareCaptures(
  baseline: InterfaceCapture,
  current: InterfaceCapture,
): {
  route: string;
  state: string;
  coverage: "new-state" | "not-recaptured" | "compared";
  changes: Record<string, unknown>[];
}[];
export function sanitizeResponseShape(value: unknown, depth?: number): unknown;

export function safeRequestPath(value: unknown): string | null;
