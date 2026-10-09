import type { CommandResult, RuntimeMessage } from '@ac-core/shared/messages';
import { parseDraftDeployment, type DraftDeployment, type DraftDeploymentPreview, type DraftDeploymentReceipt } from '@ac-core/shared/deployment.mjs';
import { UAT_ORIGIN } from '@ac-core/shared/capture.mjs';
interface Dependencies {send<T>(message:RuntimeMessage):Promise<CommandResult<T>>;download(content:string,type:string,filename:string):void}
export class FormDeploymentController {
  private file = document.querySelector<HTMLInputElement>('#form-draft-package')!;
  private review = document.querySelector<HTMLButtonElement>('#review-form-drafts')!;
  private create = document.querySelector<HTMLButtonElement>('#push-form-drafts')!;
  private confirm = document.querySelector<HTMLInputElement>('#confirm-form-drafts')!;
  private status = document.querySelector<HTMLElement>('#form-draft-status')!;
  private plan = document.querySelector<HTMLElement>('#form-draft-plan')!;
  private download = document.querySelector<HTMLButtonElement>('#download-form-draft-receipt')!;
  private recover = document.querySelector<HTMLButtonElement>('#refresh-form-draft-receipt')!;
  private package?:DraftDeployment;
  private preview?:DraftDeploymentPreview;
  private receipt?:DraftDeploymentReceipt;
  private busy = false;
  constructor(private deps:Dependencies) {
    this.file.addEventListener('change', () => void this.choose());
    this.review.addEventListener('click', () => void this.runReview());
    this.create.addEventListener('click', () => void this.push());
    this.recover.addEventListener('click', () => void this.refresh());
    this.confirm.addEventListener('change', () => this.controls());
    this.download.addEventListener('click', () => {if(this.receipt) this.deps.download(JSON.stringify(this.receipt,null,2),'application/json',`alayacare-draft-receipt-${this.receipt.packageId}.json`);});
    this.controls();
  }
  private controls() {
    this.file.disabled=this.busy; this.review.disabled=this.busy||!this.package||!!this.receipt;
    this.create.disabled=this.busy||!this.preview||!this.confirm.checked||!!this.receipt;
    this.confirm.disabled=this.busy||!this.preview||!!this.receipt;
    this.download.disabled=!this.receipt;
    this.recover.disabled=this.busy||!this.package;
  }
  private error(error:unknown) {this.status.textContent=error instanceof Error?error.message:'Draft deployment failed. Check its receipt before retrying.';}
  private showReceipt(receipt:DraftDeploymentReceipt) {
    this.receipt=receipt;
    this.plan.querySelector('[data-draft-links]')?.remove();
    const links=document.createElement('ul');links.dataset.draftLinks='true';
    for(const [key,id] of Object.entries(receipt.formIds)){
      if(!Number.isSafeInteger(id)||id<=0)continue;
      const row=document.createElement('li'),link=document.createElement('a');
      link.href=`${UAT_ORIGIN}/#/system-settings/forms?form_builder_form_id=${id}`;link.target='_blank';link.rel='noopener';
      link.textContent=`Open ${this.package?.forms.find(form=>form.key===key)?.definition.name??key} · ID ${id} in AlayaCare`;
      row.append(link);links.append(row);
    }
    this.plan.append(links);
    this.status.textContent=`Deployment ${receipt.status}. ${Object.entries(receipt.formIds).map(([key,id])=>`${key}: form ${id}`).join('; ')}. ${receipt.errors.map(error=>`${error.operation}: ${error.reason}`).join(' ')} ${receipt.status==='verified'?'Open the drafts in AlayaCare to review and publish.':'Inspect recorded drafts before creating a replacement package. Automatic replay is disabled.'}`;
  }
  private async choose() {
    this.package=undefined;this.preview=undefined;this.receipt=undefined;this.confirm.checked=false;this.plan.replaceChildren();
    const file=this.file.files?.[0];
    try {
      if (!file) return;
      if(file.size>50_000_000)throw new Error('Choose a package under 50 MB.');
      this.package=parseDraftDeployment(JSON.parse(await file.text()));
      this.status.textContent=`${this.package.forms.length} planned forms. Review the package against the current UAT source definitions.`;
      await this.refresh();
    } catch(error){this.error(error);} finally {this.controls();}
  }
  private async refresh() {
    if(!this.package)return;
    this.busy=true;this.controls();
    try {
      const response=await this.deps.send<DraftDeploymentReceipt>({type:'ac/popup/get-form-draft-receipt',payload:{packageId:this.package.packageId}});
      if(!response.ok)throw new Error(response.error??'Could not read the receipt.');
      if(response.data)this.showReceipt(response.data);
    }catch(error){this.error(error);}finally{this.busy=false;this.controls();}
  }
  private async runReview() {
    if(!this.package)return;
    this.busy=true;this.preview=undefined;this.confirm.checked=false;this.controls();this.status.textContent='Checking current source versions…';
    try {
      const response=await this.deps.send<DraftDeploymentPreview>({type:'ac/popup/preview-form-drafts',payload:{package:this.package}});
      if(!response.ok||!response.data)throw new Error(response.error??'Could not review drafts.');
      this.preview=response.data;
      const list=document.createElement('ul');
      for(const form of this.preview.forms){const item=document.createElement('li');item.textContent=`${form.name} · ${form.type} · ${form.questions} fields · new draft${form.sourceId?` copied from ${form.sourceId}`:''}`;list.append(item);}
      const notes=document.createElement('p');notes.textContent=this.package.notes.join(' ');
      this.plan.replaceChildren(list,notes);this.status.textContent=this.preview.mode;
    }catch(error){this.error(error);}finally{this.busy=false;this.controls();}
  }
  private async push() {
    if(!this.package||!this.preview||!this.confirm.checked||this.receipt)return;
    this.busy=true;this.controls();this.status.textContent='Creating and verifying draft copies. Receipts are saved after each creation; you can refresh the receipt if the panel closes.';
    try {
      const response=await this.deps.send<DraftDeploymentReceipt>({type:'ac/popup/push-form-drafts',payload:{package:this.package,approvedDigest:this.preview.digest}});
      if(!response.ok||!response.data)throw new Error(response.error??'Could not push drafts.');
      this.showReceipt(response.data);
    }catch(error){this.error(error);await this.refresh();}finally{this.busy=false;this.controls();}
  }
}
