import { UAT_ORIGIN, FORM_PATH } from './capture.mjs';
/** Uses the application's configured AJAX transport; never reads cookies or CSRF tokens. */
export async function nativeFormRequest(method, path, body, host = window) {
  if (host.location.origin !== UAT_ORIGIN || !host.location.hash.startsWith('#/system-settings/forms')) throw new Error('Open Northern Health UAT Form Settings before pushing drafts.');
  const number = '[1-9][0-9]*';
  const allowed = method === 'GET' && new RegExp(`^${FORM_PATH}/${number}$`).test(path)
    || method === 'POST' && (path === FORM_PATH || new RegExp(`^${FORM_PATH}/${number}/fields$`).test(path))
    || method === 'PUT' && new RegExp(`^${FORM_PATH}/${number}/fields/${number}$`).test(path);
  if (!allowed) throw new Error('This bridge only creates and verifies draft form definitions.');
  if (typeof host.jQuery?.ajax !== 'function') throw new Error('The native form transport is unavailable. Reload AlayaCare Form Settings.');
  try {
    const result = await host.jQuery.ajax({ url:path, type:method, dataType:'json', timeout:30000, ...(method === 'GET' ? {cache:false} : {contentType:'application/json',data:JSON.stringify(body)}) });
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('The native form request returned an invalid response.');
    return result;
  } catch (error) {
    // Native error bodies may contain login HTML or session details. Do not forward them.
    if (Number.isInteger(error?.status)) throw new Error(`AlayaCare form request failed (HTTP ${error.status}). Check your login and form permissions.`);
    throw new Error('AlayaCare form request did not complete. Inspect the deployment receipt before retrying.');
  }
}
