import { UAT_ORIGIN, captureTenantConfiguration, definitionHash } from './capture.mjs';

export const TENANT_CATALOG_FORMAT = 'webforms-alayacare-tenant-catalog';
export const CATALOG_CHANNEL = 'webforms:alayacare-tenant-catalog:v1';
export const CATALOG_REQUEST = 'ac/webforms/refresh-tenant-catalog';
export const CATALOG_READ = 'ac/content/read-tenant-catalog';
export const isWebformsCatalogOrigin = origin => /^http:\/\/(localhost|127\.0\.0\.1):3000$/.test(origin);
const catalogOrigin = value => { try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value; } catch { return false; } };
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export function parseTenantCatalog(value) {
  const t = value?.tenantConfiguration;
  if (!record(value) || value.format !== TENANT_CATALOG_FORMAT || value.formatVersion !== 1 || !catalogOrigin(value.sourceOrigin) || !record(t) || !Number.isFinite(Date.parse(t.capturedAt)) || typeof t.complete !== 'boolean' || !Array.isArray(t.roles) || !Array.isArray(t.categories) || ![...t.roles,...t.categories].every(item => record(item) && Number.isSafeInteger(item.id) && item.id > 0 && typeof item.label === 'string') || !record(t.progressNoteTypes) || !Object.values(t.progressNoteTypes).every(label => typeof label === 'string') || !Array.isArray(t.profileAttributes) || !t.profileAttributes.every(record) || !Array.isArray(t.failures) || !t.failures.every(item => record(item) && typeof item.path === 'string' && typeof item.reason === 'string') || !/^[a-f\d]{64}$/.test(value.tenantConfigurationSha256 ?? '')) throw new Error('Invalid tenant catalog. Choose a verified ACtools catalog or form capture.');
  if (t.clinicalEntities && (!record(t.clinicalEntities) || !Object.values(t.clinicalEntities).every(group => Array.isArray(group) && group.every(record)))) throw new Error('Invalid clinical schema catalog.');
  if (t.medicationFields && !record(t.medicationFields)) throw new Error('Invalid medication catalog.');
  return value;
}

export async function verifyTenantCatalog(value) {
  const catalog = parseTenantCatalog(value);
  if (await definitionHash(catalog.tenantConfiguration) !== catalog.tenantConfigurationSha256) throw new Error('Tenant catalog failed its integrity check.');
  return catalog;
}

export async function captureTenantCatalog(read) {
  const tenantConfiguration = await captureTenantConfiguration(read);
  if (tenantConfiguration.failures.length >= 8) throw new Error('Tenant catalogs could not be read. Sign in to Northern Health UAT and open Form Settings.');
  return { format: TENANT_CATALOG_FORMAT, formatVersion: 1, sourceOrigin: UAT_ORIGIN, tenantConfiguration, tenantConfigurationSha256: await definitionHash(tenantConfiguration) };
}

/** Isolated content-script relay. A page can ask only for the fixed read-only catalog action. */
export function installCatalogPageBridge(page, request) {
  if (!isWebformsCatalogOrigin(page.location.origin) || page.top !== page) return () => {};
  let busy = false;
  const listener = event => {
    const value = event.data;
    if (event.source !== page || event.origin !== page.location.origin || value?.channel !== CATALOG_CHANNEL || value.kind !== 'request' || typeof value.id !== 'string' || !/^[\w-]{36}$/.test(value.id)) return;
    const respond = result => page.postMessage({ channel: CATALOG_CHANNEL, kind: 'response', id: value.id, ...result }, page.location.origin);
    if (busy) { respond({ ok: false, error: 'A tenant catalog refresh is already running.' }); return; }
    busy = true;
    Promise.resolve().then(() => request({ type: CATALOG_REQUEST })).then(respond, () => respond({ ok: false, error: 'ACtools could not refresh the catalog. Reload the extension and check your UAT login.' })).finally(() => { busy = false; });
  };
  page.addEventListener('message', listener);
  return () => page.removeEventListener('message', listener);
}

/** Background routing never exposes general API paths, patient data or write actions. */
export async function routeCatalogRefresh(senderUrl, tabs, readTab) {
  if (!isWebformsCatalogOrigin(new URL(senderUrl).origin)) throw new Error('Open Webforms on localhost:3000 to refresh tenant choices.');
  const candidates = tabs.filter(tab => {
    try { const url = new URL(tab.url); return Number.isInteger(tab.id) && url.origin === UAT_ORIGIN && url.hash.startsWith('#/system-settings/forms'); } catch { return false; }
  });
  if (candidates.length !== 1) throw new Error(candidates.length ? 'Keep one Northern Health UAT Form Settings tab open for this refresh.' : 'Open Northern Health UAT Form Settings in this Chrome profile, then refresh again.');
  return readTab(candidates[0].id, { type: CATALOG_READ });
}
