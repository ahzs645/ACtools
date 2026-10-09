import type { TenantConfiguration } from './capture.mjs';
export interface TenantCatalog { format: 'webforms-alayacare-tenant-catalog'; formatVersion: 1; sourceOrigin: string; tenantConfiguration: TenantConfiguration; tenantConfigurationSha256: string }
export const TENANT_CATALOG_FORMAT: string;
export const CATALOG_CHANNEL: string;
export const CATALOG_REQUEST: string;
export const CATALOG_READ: string;
export function isWebformsCatalogOrigin(origin: string): boolean;
export function parseTenantCatalog(value: unknown): TenantCatalog;
export function verifyTenantCatalog(value: unknown): Promise<TenantCatalog>;
export function captureTenantCatalog(read: (path: string) => Promise<unknown>): Promise<TenantCatalog>;
export function installCatalogPageBridge(page: Window, request: (message: {type: string}) => Promise<unknown>): () => void;
export function routeCatalogRefresh(senderUrl: string, tabs: Array<{id?: number; url?: string}>, readTab: (id: number, message: {type: string}) => Promise<unknown>): Promise<unknown>;
