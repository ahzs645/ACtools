import type {CommandResult,RuntimeMessage} from '@ac-core/shared/messages';
import {validateTemplateFile,type FormTemplates,type ChildPrintReview,type DocumentReceipt,type DocumentAction} from '@ac-core/shared/documents.mjs';
interface Dependencies {send<T>(message:RuntimeMessage):Promise<CommandResult<T>>;download(content:string,type:string,filename:string):void}
const input=(id:string)=>document.querySelector<HTMLInputElement>(`#${id}`)!;
const button=(id:string)=>document.querySelector<HTMLButtonElement>(`#${id}`)!;
export class FormDocumentsController {
  private form=input('document-form-id');private file=input('document-template-file');private parent=input('document-parent-submission');
  private operation=input('document-operation-id');private target=document.querySelector<HTMLElement>('#document-template-target')!;
  private plan=document.querySelector<HTMLElement>('#child-print-plan')!;private results=document.querySelector<HTMLElement>('#document-print-results')!;
  private status=document.querySelector<HTMLElement>('#document-status')!;
  private selected?:FormTemplates;private review?:ChildPrintReview;private receipt?:DocumentReceipt;private busy=false;
  private choices=new Map<number,HTMLSelectElement>();
  constructor(private deps:Dependencies){
    this.operation.value=localStorage.getItem('ac-tools-last-document-operation')??'';
    this.form.addEventListener('input',()=>{this.selected=undefined;this.target.textContent='';this.controls();});
    this.parent.addEventListener('input',()=>{this.review=undefined;this.plan.replaceChildren();this.controls();});
    this.file.addEventListener('change',()=>this.controls());
    this.operation.addEventListener('input',()=>{this.receipt=undefined;this.controls();});
    button('load-document-templates').addEventListener('click',()=>void this.run(async()=>{this.selected=await this.send<FormTemplates>({action:'templates',formId:Number(this.form.value)});this.target.textContent=`${this.selected.name} · form ${this.selected.formId}. ${this.selected.templates.map(item=>`${item.name} (ID ${item.id})`).join('; ')}`;this.status.textContent='Loaded form templates. Choose a Word file to upload.';}));
    button('upload-document-template').addEventListener('click',()=>void this.run(()=>this.upload()));
    button('review-child-print').addEventListener('click',()=>void this.run(()=>this.loadReview()));
    button('start-child-print').addEventListener('click',()=>void this.run(()=>this.print()));
    button('refresh-document-receipt').addEventListener('click',()=>void this.run(async()=>{const receipt=await this.send<DocumentReceipt|undefined>({action:'receipt',operationId:this.operation.value.trim()});if(!receipt)throw new Error('No receipt found for this operation.');this.showReceipt(receipt);}));
    button('download-document-receipt').addEventListener('click',()=>{if(this.receipt)this.deps.download(JSON.stringify(this.receipt,null,2),'application/json',`alayacare-document-receipt-${this.receipt.operationId}.json`);});
    this.controls();
  }
  private controls(){
    for(const id of ['load-document-templates','review-child-print','refresh-document-receipt'])button(id).disabled=this.busy;
    for(const item of [this.form,this.file,this.parent,this.operation])item.disabled=this.busy;
    for(const item of this.choices.values())item.disabled=this.busy;
    button('upload-document-template').disabled=this.busy||!this.selected||!this.file.files?.length;
    button('start-child-print').disabled=this.busy||!this.review?.entries.length||this.review.entries.some(entry=>!this.choices.get(entry.submissionId)?.value);
    button('download-document-receipt').disabled=!this.receipt;
  }
  private async send<T>(payload:DocumentAction):Promise<T>{const result=await this.deps.send<T>({type:'ac/popup/form-documents',payload});if(!result.ok)throw new Error(result.error??'Document operation failed.');return result.data as T;}
  private async run(action:()=>Promise<void>){if(this.busy)return;this.busy=true;this.status.textContent='Working in the signed-in UAT session…';this.controls();try{await action();}catch(error){this.status.textContent=error instanceof Error?error.message:'Inspect the document receipt before retrying.';}finally{this.busy=false;this.controls();}}
  private newOperation(){const id=crypto.randomUUID();this.operation.value=id;localStorage.setItem('ac-tools-last-document-operation',id);return id;}
  private async upload(){
    const file=this.file.files?.[0],target=this.selected;if(!file||!target)return;
    if(file.size>10_000_000)throw new Error('Choose a Word template under 10 MB.');
    const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
    const content=validateTemplateFile({fileName:file.name,base64:btoa(binary)});
    const operationId=this.newOperation();
    this.file.value='';this.selected=undefined;
    this.showReceipt(await this.send<DocumentReceipt>({action:'upload',operationId,formId:target.formId,schemaId:target.schemaId,...content}));
  }
  private async loadReview(){
    this.review=undefined;this.choices.clear();this.plan.replaceChildren();
    const review=await this.send<ChildPrintReview>({action:'review-print',parentSubmissionId:Number(this.parent.value)});this.review=review;
    for(const entry of review.entries){
      const label=document.createElement('label'),select=document.createElement('select');select.className='input';label.className='field';label.textContent=`Entry ${entry.submissionId} · ${entry.formName} (form ${entry.formId}) `;
      for(const item of entry.templates){const option=document.createElement('option');option.value=String(item.id);option.textContent=`${item.name} · template ${item.id}`;option.selected=item.isDefault;select.append(option);}
      label.append(select);this.plan.append(label);this.choices.set(entry.submissionId,select);
    }
    this.status.textContent=`Reviewed ${review.entries.length} direct child entries. Choose each entry's template, then generate the batch.`;
  }
  private async print(){
    const review=this.review;if(!review)return;
    const operationId=this.newOperation();
    // Consume the review before starting; repeated clicks cannot create the same batch twice.
    this.review=undefined;
    this.showReceipt(await this.send<DocumentReceipt>({action:'start-print',operationId,parentSubmissionId:review.parentSubmissionId,digest:review.digest,choices:review.entries.map(entry=>({submissionId:entry.submissionId,templateId:Number(this.choices.get(entry.submissionId)!.value)}))}));
    if(this.receipt?.kind==='print')this.showReceipt(await this.send<DocumentReceipt>({action:'receipt',operationId}));
  }
  private showReceipt(receipt:DocumentReceipt){
    this.receipt=receipt;this.operation.value=receipt.operationId;this.results.replaceChildren();
    this.status.textContent=`${receipt.kind} ${receipt.status}. ${receipt.templateId?`Template ${receipt.templateId} on form ${receipt.formId}. `:''}${receipt.errors.join(' ')}${receipt.status==='running'?' Refresh to check existing PDF jobs.':''}`;
    for(const job of receipt.jobs??[]){const row=document.createElement('p');row.textContent=`Entry ${job.submissionId}: ${job.status}. `;if(job.url){const link=document.createElement('a');link.href=job.url;link.target='_blank';link.rel='noopener';link.textContent='Open native PDF';row.append(link);}this.results.append(row);}
  }
}
