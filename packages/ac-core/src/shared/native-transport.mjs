import { UAT_ORIGIN, FORM_PATH } from './capture.mjs';
import { TEMPLATE_PATH, validateTemplateFile } from './documents.mjs';
/** Uses the application's configured AJAX transport; never reads cookies or CSRF tokens. */
export async function nativeFormRequest(method, path, body, host = window) {
  const settings = host.location.hash.startsWith('#/system-settings/forms');
  const submission = /^#\/dashboard\/client-forms\/[1-9][0-9]*(?:$|[?])/ .test(host.location.hash);
  if (host.location.origin !== UAT_ORIGIN || !settings && !submission) throw new Error('Open Northern Health UAT Form Settings or a form submission before using this bridge.');
  const number = '[1-9][0-9]*', uuid = '[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}';
  const definitionRead = method === 'GET' && new RegExp(`^${FORM_PATH}/${number}$`).test(path);
  const draftWrite = settings && (method === 'POST' && (path === FORM_PATH || new RegExp(`^${FORM_PATH}/${number}/fields$`).test(path)) || method === 'PUT' && new RegExp(`^${FORM_PATH}/${number}/fields/${number}$`).test(path));
  const templateRead = method === 'GET' && new RegExp(`^${TEMPLATE_PATH}\\?entity_type=form&entity_id=${uuid}$`).test(path);
  const templateUpload = settings && method === 'POST' && path === TEMPLATE_PATH;
  const submissionRead = method === 'GET' && new RegExp(`^/api/v1/tasks/forms20/submissions/${number}\\?with_subforms=true$`).test(path);
  const printStart = method === 'POST' && new RegExp(`^/api/v1/tasks/forms20/submissions/${number}/start_print_job$`).test(path);
  const printRead = method === 'GET' && new RegExp(`^/api/v1/printing/jobs/${uuid}$`).test(path);
  if (!definitionRead && !draftWrite && !templateRead && !templateUpload && !submissionRead && !printStart && !printRead) throw new Error('This bridge only manages draft definitions, form templates and child PDF jobs.');
  if (printStart && (!body || Object.keys(body).length !== 1 || !Number.isSafeInteger(body.template_id) || body.template_id <= 0)) throw new Error('Choose a native template ID before printing.');
  let upload;
  if (templateUpload) {
    validateTemplateFile(body);
    if (!body.documentUpload || !new RegExp(`^${uuid}$`).test(body.schemaId)) throw new Error('Invalid template upload target.');
    const bytes = Uint8Array.from(atob(body.base64), character=>character.charCodeAt(0));
    if (bytes.length > 10_000_000) throw new Error('Choose a template under 10 MB.');
    upload = new FormData();
    upload.append('template_file',new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),body.fileName);
    upload.append('template_name',body.fileName);upload.append('entity_type','form');upload.append('entity_id',body.schemaId);
  }
  if (typeof host.jQuery?.ajax !== 'function') throw new Error('The native form transport is unavailable. Reload AlayaCare Form Settings.');
  try {
    const result = await host.jQuery.ajax({ url:path, type:method, dataType:'json', timeout:30000, ...(method === 'GET' ? {cache:false} : upload ? {processData:false,contentType:false,data:upload} : {contentType:'application/json',data:JSON.stringify(body)}) });
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('The native form request returned an invalid response.');
    return result;
  } catch (error) {
    // Native error bodies may contain login HTML or session details. Do not forward them.
    if (Number.isInteger(error?.status)) throw new Error(`AlayaCare form request failed (HTTP ${error.status}). Check your login and form permissions.`);
    throw new Error('AlayaCare form request did not complete. Inspect the operation receipt before retrying.');
  }
}
