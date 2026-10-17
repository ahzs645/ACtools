import '../../styles.css';
import {InterfaceCaptureController} from './controller';

new InterfaceCaptureController((content,type,name)=>{
  const url=URL.createObjectURL(new Blob([content],{type}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
const params=new URLSearchParams(location.search);
const status=document.querySelector<HTMLElement>('#interface-source-status')!;
status.textContent=`Source: ${params.get('origin')??'No tenant selected'}. This workspace stays bound to its source tab while routes warm in a separate tab.`;
document.querySelector<HTMLButtonElement>('#open-interface-workspace')!.hidden=true;
