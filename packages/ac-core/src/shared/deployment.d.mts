export const DEPLOYMENT_FORMAT: 'webforms-alayacare-draft-deployment';
export const FORM_WRITE_KEYS: string[];
export interface DeploymentField extends Record<string, unknown> { id:number;parent_id:number;rank:number;field_type:string;label:string;settings?:Record<string,unknown>|null;json_logic?:Record<string,unknown>|null }
export interface DeploymentDefinition extends Record<string,unknown> { name:string;form_type:string;fields:DeploymentField[] }
export interface DraftDeployment {format:typeof DEPLOYMENT_FORMAT;formatVersion:1;packageId:string;targetOrigin:string;createdAt:string;parentKey:string;forms:Array<{key:string;definition:DeploymentDefinition;source?:{id:number;definition:Record<string,unknown>};links:Array<{fieldId:number;formKey:string}>}>;notes:string[]}
export interface DraftDeploymentPreview {packageId:string;digest:string;targetOrigin:string;mode:string;forms:Array<{key:string;name:string;type:string;questions:number;sourceId?:number}>}
export interface DraftDeploymentReceipt {packageId:string;digest:string;targetOrigin:string;status:'running'|'partial'|'verified';startedAt:string;updatedAt:string;formIds:Record<string,number>;fieldIds:Record<string,Record<number,number>>;verifiedForms:string[];errors:Array<{operation:string;reason:string}>}
export function canonical(value:unknown):unknown;
export function deploymentDigest(value:unknown):Promise<string>;
export function sourceSnapshot(value:Record<string,unknown>):Record<string,unknown>;
export function remapLogic(value:unknown,mapping:Record<number,number>):unknown;
export function parseDraftDeployment(value:unknown):DraftDeployment;
export function orderedDeploymentForms(value:DraftDeployment):DraftDeployment['forms'];
export function previewDraftDeployment(value:unknown,read:(path:string)=>Promise<any>):Promise<DraftDeploymentPreview>;
export function executeDraftDeployment(value:unknown,approvedDigest:string,io:{request:(method:'GET'|'POST'|'PUT',path:string,body?:unknown)=>Promise<any>;load:(id:string)=>Promise<DraftDeploymentReceipt|undefined>;save:(id:string,receipt:DraftDeploymentReceipt)=>Promise<void>}):Promise<DraftDeploymentReceipt>;

export function nativeScoreGraphProblems(fields: Array<{id: string | number; field_type:string;settings?:{linked_field_ids?:Array<string|number>}|null}>):Array<{fieldId:string|number;reason:string}>;
export interface NativeScoreFormulaField {id:string|number;field_type:string;settings?:Record<string,unknown>|null}
export function expandedNativeScoreFormula(field:NativeScoreFormulaField,fields:NativeScoreFormulaField[]):unknown;
export function nativeDisplayRule(rule:unknown):Record<string,unknown>;
