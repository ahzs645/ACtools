import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const temporary = await mkdtemp(join(tmpdir(), 'ac-tools-form-definitions-'));
try {
  const output = join(temporary, 'client.mjs');
  await build({ entryPoints: ['packages/ac-core/src/session/AlayaCareClient.ts'], outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const { AlayaCareClient } = await import(pathToFileURL(output).href);
  const origin = 'https://northernhealth.uat.alayacare.ca';
  const calls = [];
  const context = { origin, getHref: () => `${origin}/#/system-settings/forms`, fetch: async (url, options) => {
    calls.push({ url, options });
    const path = new URL(url);
    if (path.search) {
      assert.deepEqual(path.searchParams.getAll('status[]'), ['draft', 'active', 'archived']);
      return Response.json({ count: 1, total_pages: 1, items: [{ id: 1, name: 'Synthetic parent' }] });
    }
    return Response.json(path.pathname.endsWith('/1') ? { id: 1, name: 'Synthetic parent', fields: [{ id: 10, field_type: 'subform', settings: { subform_id: 2 } }] } : { id: 2, name: 'Synthetic child', form_type: 'subform', fields: [] });
  } };
  const capture = await new AlayaCareClient(context).exportFormDefinitions({ includeArchived: true });
  assert.deepEqual(capture.rootFormIds, [1]);
  assert.deepEqual(capture.forms.map(entry => entry.id), [1, 2]);
  assert.equal(capture.coverage.selectedDefinitionsComplete, true);
  assert.equal(calls.length, 3);
  for (const { url, options } of calls) {
    assert.equal(new URL(url).origin, origin);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'include');
  }
  calls.length = 0;
  await new AlayaCareClient(context).exportFormDefinitions({ formIds: [1] });
  assert.equal(calls.length, 2, 'selected export must not fetch the entire library');
  await assert.rejects(new AlayaCareClient({ ...context, origin: 'https://other.alayacare.ca' }).exportFormDefinitions({}), /Northern Health UAT/);
  await assert.rejects(new AlayaCareClient(context).exportFormDefinitions({ formIds: ['../patients'] }), /Invalid form ID/);
  console.log('Form-definition integration passed: authenticated GETs, bulk scope, selected dependencies, tenant and ID guards.');
} finally { await rm(temporary, { recursive: true, force: true }); }
