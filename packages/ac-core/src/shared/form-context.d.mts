export const FORM_CONTEXT_FORMAT: 'webforms-alayacare-form-context';
export const FORM_CONTEXT_DEPLOYMENT_FORMAT: 'webforms-alayacare-form-context-deployment';
export type NativeRecord = Record<string, unknown>;
export interface FormContextArchive { format: typeof FORM_CONTEXT_FORMAT; formatVersion: 1; sourceOrigin: string; capturedAt: string; complete: boolean; failures: { path: string; reason: string }[]; contexts: NativeRecord[]; fields: NativeRecord[]; roles: NativeRecord[]; families: NativeRecord[]; fieldTypes: NativeRecord[]; profileAttributes: NativeRecord[]; optionCatalogs?: { countries: NativeRecord[]; genders: NativeRecord[] }; sha256: string }
export interface FormContextDeployment { format: typeof FORM_CONTEXT_DEPLOYMENT_FORMAT; formatVersion: 1; sourceOrigin: string; archiveSha256: string; preparedAt: string; mode: 'create-only'; fields: NativeRecord[]; sha256: string }
export type FormContextRead = (path: string) => Promise<unknown>;
export function definitionHash(value: unknown): Promise<string>;
export function parseFormContextArchive(value: unknown): FormContextArchive;
export function verifyFormContextArchive(value: unknown): Promise<FormContextArchive>;
export function captureFormContextArchive(read: FormContextRead, sourceOrigin: string): Promise<FormContextArchive>;
export function prepareFormContextDeployment(archive: FormContextArchive, fields: NativeRecord[]): Promise<FormContextDeployment>;
export function parseFormContextDeployment(value: unknown): FormContextDeployment;
export function verifyFormContextDeployment(value: unknown): Promise<FormContextDeployment>;
export interface FormContextDeploymentPreview { digest: string; sourceOrigin: string; fields: { tag: string; description: string; contexts: string[] }[]; mode: 'Create new tenant configuration only; existing fields are never changed.' }
export interface FormContextReceipt { digest: string; sourceOrigin: string; status: 'running' | 'verified' | 'uncertain' | 'failed'; steps: { tag: string; state: 'pending' | 'creating' | 'created' | 'assigning' | 'verified' | 'uncertain' | 'failed'; fieldId?: string | number; contexts: string[]; error?: string }[]; updatedAt: string }
export interface FormContextIO { read: FormContextRead; request(method: 'POST' | 'PUT', path: string, body: unknown): Promise<unknown>; store: { get<T = unknown>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> }; sourceOrigin: string }
export function previewFormContextDeployment(value: unknown, io: FormContextIO): Promise<FormContextDeploymentPreview>;
export function executeFormContextDeployment(value: unknown, approvedDigest: string, io: FormContextIO): Promise<FormContextReceipt>;
export function readFormContextReceipt(digest: string, io: FormContextIO): Promise<FormContextReceipt | undefined>;
