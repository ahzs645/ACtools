import type {InterfaceCapture} from './interface-capture.mjs';
export function snapshotInventory(capture:InterfaceCapture,baseline?:InterfaceCapture|null):{
  format:string;version:number;sourceOrigin:string;run:InterfaceCapture['run']|null;capturedAt:string;
  summary:{routes:number;states:number;fresh:number;stale:number;screenshots:number;truncated:number;failedRoutes:number;pendingRoutes:number;changedStates:number;notRecaptured:number;embeddedVisualAssets:number;missingVisualAssets:number;pseudoElements:number};
  screens:{route:string;state:string;capturedAt:string;fresh:boolean|null;viewport:unknown;controls:number;inlineControls:number;truncated:boolean;screenshot:boolean;file:string}[];
  visualAssets:Omit<import("./interface-visuals.mjs").VisualResource,"data">[];visualAssetChanges:{url:string;before:string|null;after:string|null}[];
  discovery:unknown;comparisons:ReturnType<typeof import('./interface-capture.mjs').compareCaptures>;warnings:string[];
};
export function snapshotReviewFiles(capture:InterfaceCapture,baseline?:InterfaceCapture|null):Record<string,string>;
