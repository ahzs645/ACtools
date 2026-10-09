import test from 'node:test';
import assert from 'node:assert/strict';
import { captureTenantCatalog, verifyTenantCatalog, routeCatalogRefresh, installCatalogPageBridge, CATALOG_CHANNEL, CATALOG_REQUEST, CATALOG_READ } from './tenant-catalog.mjs';
import { UAT_ORIGIN } from './capture.mjs';

const read = async path => path.includes('/roles') || path.includes('/formcategories') ? { count: 1, total_pages: 1, items: [{ id: 1, name: 'Synthetic choice', permissions: ['not returned'] }] } : path.includes('progress_note_types') ? { progress_note_types: { progress_synthetic: 'Synthetic note' } } : path.includes('/profile_attributes') ? { count: 0, items: [] } : path.includes('/entity_definitions/') ? [] : {};
test('catalog-only refresh is fingerprinted and contains no role permissions or form/patient data', async () => {
  const catalog = await captureTenantCatalog(read);
  assert.equal((await verifyTenantCatalog(catalog)).tenantConfiguration.complete, true);
  assert.equal(JSON.stringify(catalog).includes('not returned'), false);
  assert.equal('forms' in catalog, false);
  catalog.tenantConfiguration.roles[0].label = 'Tampered';
  await assert.rejects(verifyTenantCatalog(catalog), /integrity/);
  await assert.rejects(captureTenantCatalog(async () => { throw new Error('login body'); }), /Sign in/);
});
test('routing accepts only local Webforms and one exact NH UAT Form Settings tab', async () => {
  const tabs = [{ id: 4, url: `${UAT_ORIGIN}/#/system-settings/forms` }, { id: 5, url: 'https://other.alayacare.ca/#/system-settings/forms' }];
  const calls = [];
  await routeCatalogRefresh('http://localhost:3000/', tabs, async (...args) => { calls.push(args); return {}; });
  assert.deepEqual(calls, [[4, { type: CATALOG_READ }]]);
  for (const url of ['https://example.invalid', 'http://localhost:4000', 'http://localhost.attacker.invalid:3000']) await assert.rejects(routeCatalogRefresh(url, tabs, async () => {}));
  await assert.rejects(routeCatalogRefresh('http://localhost:3000/', [], async () => {}), /Open Northern/);
  await assert.rejects(routeCatalogRefresh('http://localhost:3000/', [tabs[0], { ...tabs[0], id: 6 }], async () => {}), /Keep one/);
});
test('file catalogs accept other HTTPS tenants without widening live routing', async () => {
  const catalog = await captureTenantCatalog(read);
  catalog.sourceOrigin = 'https://other.alayacare.ca';
  assert.equal((await verifyTenantCatalog(catalog)).sourceOrigin, catalog.sourceOrigin);
  for (const origin of ['http://other.alayacare.ca', 'https://other.alayacare.ca/patients', 'invalid']) await assert.rejects(verifyTenantCatalog({ ...catalog, sourceOrigin: origin }), /Invalid tenant/);
});
test('page bridge ignores foreign senders and forwards only the fixed catalog action', async () => {
  let listener;
  const replies = [], requests = [];
  const page = { location: { origin: 'http://localhost:3000' }, addEventListener: (_, fn) => { listener = fn; }, removeEventListener: () => {}, postMessage: value => replies.push(value) }; page.top = page;
  installCatalogPageBridge(page, async value => { requests.push(value); return { ok: true, data: {} }; });
  const request = { source: page, origin: page.location.origin, data: { channel: CATALOG_CHANNEL, kind: 'request', id: '12345678-1234-1234-1234-123456789012', path: '/patients', method: 'POST' } };
  listener({ ...request, origin: 'https://example.invalid' }); listener({ ...request, source: {} });
  assert.equal(requests.length, 0);
  listener(request); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, [{ type: CATALOG_REQUEST }]);
  assert.equal(replies[0].ok, true);
});
