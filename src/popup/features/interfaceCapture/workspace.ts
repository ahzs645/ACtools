import '../../styles.css';
import {InterfaceCaptureController} from './controller';
import {installTooltips} from '../../ui/tooltips';

installTooltips();

new InterfaceCaptureController((content,type,name)=>{
  const url=URL.createObjectURL(new Blob([content],{type}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
const params=new URLSearchParams(location.search);
const status=document.querySelector<HTMLElement>('#interface-source-status')!;
status.textContent=`Source: ${params.get('origin')??'No tenant selected'}. Discovery runs in that tab and returns it to where it started; this workspace stays connected to it.`;
document.querySelector<HTMLButtonElement>('#open-interface-workspace')!.hidden=true;
