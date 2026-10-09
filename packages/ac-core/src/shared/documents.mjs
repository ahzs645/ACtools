import { UAT_ORIGIN, FORM_PATH } from './capture.mjs';
import { deploymentDigest } from './deployment.mjs';
export const TEMPLATE_PATH = '/api/v1/tasks/custom_templates';
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const positive = value => Number.isSafeInteger(value) && value > 0;
export function requireDocumentId(value) { if (!positive(value)) throw new Error('Use a positive native form or submission ID.'); return value; }
export function templateListPath(schemaId) { if (!uuid.test(schemaId)) throw new Error('The form has no valid schema identity.'); return `${TEMPLATE_PATH}?entity_type=form&entity_id=${schemaId}`; }
export function validateTemplateFile(value) {
  if (!value || typeof value.fileName !== 'string' || !/^[^/\\\x00-\x1f]{1,150}\.docx$/i.test(value.fileName) || typeof value.base64 !== 'string' || value.base64.length > 14_000_000 || !/^UEsDB[A-Za-z0-9+/]*={0,2}$/.test(value.base64) || value.base64.length % 4) throw new Error('Choose a Word .docx template under 10 MB.');
  return value;
}
function validOperation(id) { if (!uuid.test(id)) throw new Error('Invalid document operation ID.'); }
function templateChoices(value, schemaId) {
  if (!Array.isArray(value?.items) || value.total_pages > 1) throw new Error('Could not read the complete template list.');
  return value.items.filter(item => positive(item.id) && item.entity_type === 'form' && (item.entity_id === schemaId || item.is_ac_template === true && item.entity_id == null)).map(item => ({id:item.id,name:String(item.template_name),isDefault:item.is_default === true}));
}
export async function inspectFormTemplates(formId, request) {
  requireDocumentId(formId);
  const form = await request('GET',`${FORM_PATH}/${formId}`);
  if (form?.id !== formId) throw new Error('The form read-back returned a different ID.');
  const path = templateListPath(form.schema_id);
  return {formId,name:String(form.name),schemaId:form.schema_id,templates:templateChoices(await request('GET',path),form.schema_id)};
}
export async function uploadFormTemplate(input, io) {
  validOperation(input.operationId); validateTemplateFile(input); requireDocumentId(input.formId);
  if (await io.load(input.operationId)) throw new Error('This upload already has a receipt. Inspect it before uploading again.');
  const target = await inspectFormTemplates(input.formId,io.request);
  if (input.schemaId !== target.schemaId) throw new Error('The selected form changed. Load its templates again.');
  const receipt = {operationId:input.operationId,kind:'upload',status:'running',formId:target.formId,schemaId:target.schemaId,fileName:input.fileName,errors:[]};
  await io.save(input.operationId,receipt);
  try {
    const created = await io.request('POST',TEMPLATE_PATH,{documentUpload:true,fileName:input.fileName,base64:input.base64,schemaId:target.schemaId});
    if (!positive(created?.id)) throw new Error('Upload did not return a template ID. Inspect Manage template before retrying.');
    receipt.templateId = created.id; await io.save(input.operationId,receipt);
    if (created.entity_id !== target.schemaId || created.entity_type !== 'form' || created.template_name !== input.fileName) throw new Error('Uploaded template identity did not match the selected form.');
    const after = await inspectFormTemplates(input.formId,io.request);
    if (!after.templates.some(item=>item.id===created.id && item.name===input.fileName)) throw new Error('The uploaded template was not present in read-back.');
    receipt.status='verified';
  } catch(error) {receipt.status='partial'; receipt.errors.push(error.message ?? 'Upload failed. Inspect its receipt before retrying.');}
  await io.save(input.operationId,receipt); return receipt;
}
export async function reviewChildPrint(parentSubmissionId, request) {
  requireDocumentId(parentSubmissionId);
  const parent = await request('GET',`/api/v1/tasks/forms20/submissions/${parentSubmissionId}?with_subforms=true`);
  if (parent?.id !== parentSubmissionId || !Array.isArray(parent.subforms)) throw new Error('The parent submission did not return linked subform entries.');
  if (parent.subforms.length > 200) throw new Error('Print at most 200 child entries per batch.');
  const seen = new Set(), forms = new Map(), entries = [];
  for (const child of parent.subforms) {
    requireDocumentId(child.id); requireDocumentId(child.form_id);
    if (seen.has(child.id) || child.parent_submission_id !== parentSubmissionId) throw new Error('The child list contains duplicate or unrelated submissions.');
    seen.add(child.id);
    if (!forms.has(child.form_id)) forms.set(child.form_id,await inspectFormTemplates(child.form_id,request));
    const form = forms.get(child.form_id);
    entries.push({submissionId:child.id,formId:child.form_id,schemaId:form.schemaId,formName:form.name,templates:form.templates});
  }
  const review = {parentSubmissionId,entries};
  return {...review,digest:await deploymentDigest(review)};
}
export async function startChildPrintBatch(input, io) {
  validOperation(input.operationId);
  if (await io.load(input.operationId)) throw new Error('This print batch already has a receipt. Refresh it instead of starting duplicate jobs.');
  const review = await reviewChildPrint(input.parentSubmissionId,io.request);
  if (input.digest !== review.digest) throw new Error('Child entries or templates changed after review. Review the batch again.');
  if (!review.entries.length) throw new Error('There are no child entries to print.');
  if (!Array.isArray(input.choices) || input.choices.length !== review.entries.length || new Set(input.choices.map(item=>item.submissionId)).size !== review.entries.length) throw new Error('Choose one template for each reviewed child entry.');
  const choices = review.entries.map(entry=>{
    const choice=input.choices.find(item=>item.submissionId===entry.submissionId);
    if (!choice || !entry.templates.some(item=>item.id===choice.templateId)) throw new Error('A selected template does not belong to this child form.');
    return {submissionId:entry.submissionId,formId:entry.formId,templateId:choice.templateId,status:'not-started'};
  });
  const receipt={operationId:input.operationId,kind:'print',parentSubmissionId:review.parentSubmissionId,status:'running',jobs:choices,errors:[]};
  await io.save(input.operationId,receipt);
  for (const job of receipt.jobs) {
    // Save the attempted state before starting a native job. An uncertain attempt is never replayed.
    job.status='starting'; await io.save(input.operationId,receipt);
    try {
      const result=await io.request('POST',`/api/v1/tasks/forms20/submissions/${job.submissionId}/start_print_job`,{template_id:job.templateId});
      if (!uuid.test(result?.print_job_id)) throw new Error('Print did not return a job ID. Inspect native printing before retrying.');
      job.jobId=result.print_job_id; job.status='pending';
    } catch(error) {job.status='uncertain';receipt.errors.push(`Submission ${job.submissionId}: ${error.message}`); receipt.status='partial'; await io.save(input.operationId,receipt); return receipt;}
    await io.save(input.operationId,receipt);
  }
  return receipt;
}
export function validNativePdfUrl(value) {
  if (typeof value !== 'string') return false;
  try {const url=new URL(value);return url.origin===UAT_ORIGIN && /^\/api\/v1\/files\/tasks\/form_submissions\/[a-f\d-]{36}\.pdf$/i.test(url.pathname) && !url.search && !url.hash;} catch {return false;}
}
export async function refreshDocumentReceipt(operationId, io) {
  validOperation(operationId); const receipt=await io.load(operationId);
  if (!receipt || receipt.kind !== 'print') return receipt;
  for (const job of receipt.jobs) {
    if (!job.jobId || job.status !== 'pending') continue;
    const response=await io.request('GET',`/api/v1/printing/jobs/${job.jobId}`);
    if (response.status === 'SUCCESS') {
      if (!validNativePdfUrl(response.result)) throw new Error('The print result is not a native UAT form PDF.');
      job.url=response.result;job.status='ready';
    } else if (['FAILURE','FAILED','ERROR','REVOKED'].includes(response.status)) {job.status='failed';receipt.errors.push(`Submission ${job.submissionId}: native printing failed.`);}
    else if (!['PENDING','STARTED','PROGRESS','RETRY'].includes(response.status)) throw new Error('Unknown native print job state. Refresh later or inspect the native job.');
    await io.save(operationId,receipt);
  }
  receipt.status=receipt.jobs.every(job=>job.status==='ready')?'verified':receipt.jobs.some(job=>['failed','uncertain','starting','not-started'].includes(job.status))?'partial':'running';
  await io.save(operationId,receipt); return receipt;
}
