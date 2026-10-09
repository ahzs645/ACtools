export const UAT_ORIGIN: string;
export const FORM_PATH: string;
export const CAPTURE_FORMAT: "webforms-alayacare-definition-capture";
export interface FormDefinition extends Record<string, unknown> {
  id: number;
  name: string;
  fields: Array<Record<string, unknown>>;
  subforms?: FormDefinition[];
}
export interface FormListEntry { id: number; name: string; status?: string; schemaVersion?: number }
export interface CaptureScope { includeArchived?: boolean; includeVersions?: boolean; includeTenantConfiguration?:boolean }
export interface TenantConfiguration {clinicalEntities?:Record<string,Array<Record<string,unknown>>>;medicationFields?:Record<string,unknown>;capturedAt:string;complete:boolean;roles:Array<{id:number;label:string}>;categories:Array<{id:number;label:string}>;progressNoteTypes:Record<string,string>;profileAttributes:Array<Record<string,unknown>>;failures:Array<{path:string;reason:string}>}
export interface DefinitionCaptureRequest extends CaptureScope { formIds?: number[] }
export interface DefinitionCapture {
  format: typeof CAPTURE_FORMAT; formatVersion: 1; sourceOrigin: string; capturedAt: string; rootFormIds: number[];
  coverage: { selectedDefinitionsComplete: boolean; scope: string; excluded: string[]; unresolvedSubformIds: number[]; includeArchived: boolean; includeVersions: boolean };
  forms: Array<{ id: number; sourcePath: string; capturedAt: string; sha256: string; dependencies: number[]; definition: FormDefinition }>;
  failures: Array<{ id: number; reason: string }>;
  tenantConfiguration?:TenantConfiguration;tenantConfigurationSha256?:string;
}
export const TENANT_CONFIGURATION_PATHS:string[];
export function captureTenantConfiguration(read:(path:string)=>Promise<any>):Promise<TenantConfiguration>;
export function formId(value: unknown): number;
export function indexPath(page?: number, options?: CaptureScope): string;
export function versionsPath(schemaId: string): string;
export function loadFormIndex(read: (path: string) => Promise<unknown>, options?: CaptureScope): Promise<FormListEntry[]>;
export function captureDefinitions(ids: number[], read: (path: string) => Promise<unknown>, progress?: (value: { id: number; completed: number; pending: number }) => void, options?: CaptureScope): Promise<DefinitionCapture>;
export function definitionHash(value: unknown): Promise<string>;
export function linkedFormIds(value: FormDefinition): number[];
export function readDefinitionInPage(path: string): Promise<unknown>;
