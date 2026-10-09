export const TEMPLATE_PATH:string;
export interface TemplateChoice {id:number;name:string;isDefault:boolean}
export interface FormTemplates {formId:number;name:string;schemaId:string;templates:TemplateChoice[]}
export interface ChildPrintReview {parentSubmissionId:number;digest:string;entries:Array<{submissionId:number;formId:number;schemaId:string;formName:string;templates:TemplateChoice[]}>}
export interface DocumentReceipt {operationId:string;kind:'upload'|'print';status:'running'|'partial'|'verified';errors:string[];formId?:number;schemaId?:string;fileName?:string;templateId?:number;parentSubmissionId?:number;jobs?:Array<{submissionId:number;formId:number;templateId:number;jobId?:string;status:string;url?:string}>}
export type DocumentAction = {action:'templates';formId:number}|{action:'upload';operationId:string;formId:number;schemaId:string;fileName:string;base64:string}|{action:'review-print';parentSubmissionId:number}|{action:'start-print';operationId:string;parentSubmissionId:number;digest:string;choices:Array<{submissionId:number;templateId:number}>}|{action:'receipt';operationId:string};
export type DocumentResult=FormTemplates|ChildPrintReview|DocumentReceipt|undefined;
export type DocumentRequest=(method:'GET'|'POST'|'PUT',path:string,body?:unknown)=>Promise<any>;
export interface DocumentIO {request:DocumentRequest;load:(id:string)=>Promise<DocumentReceipt|undefined>;save:(id:string,receipt:DocumentReceipt)=>Promise<void>}
export function requireDocumentId(value:unknown):number;
export function templateListPath(schemaId:string):string;
export function validateTemplateFile<T extends {fileName:string;base64:string}>(value:T):T;
export function inspectFormTemplates(formId:number,request:DocumentRequest):Promise<FormTemplates>;
export function uploadFormTemplate(input:Extract<DocumentAction,{action:'upload'}>,io:DocumentIO):Promise<DocumentReceipt>;
export function reviewChildPrint(parentSubmissionId:number,request:DocumentRequest):Promise<ChildPrintReview>;
export function startChildPrintBatch(input:Extract<DocumentAction,{action:'start-print'}>,io:DocumentIO):Promise<DocumentReceipt>;
export function refreshDocumentReceipt(operationId:string,io:DocumentIO):Promise<DocumentReceipt|undefined>;
export function validNativePdfUrl(value:unknown):boolean;
