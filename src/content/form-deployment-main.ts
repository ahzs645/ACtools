import { nativeFormRequest } from '@ac-core/shared/native-transport.mjs';
const channel = 'ac-tools/form-draft-http/v1';
window.addEventListener('message', (event: MessageEvent) => {
  const value = event.data;
  if (event.source !== window || event.origin !== window.location.origin || value?.channel !== channel || value?.kind !== 'request' || typeof value.id !== 'string' || !/^[\w-]{36}$/.test(value.id)) return;
  void nativeFormRequest(value.method, value.path, value.body).then(
    data => window.postMessage({channel,kind:'response',id:value.id,ok:true,data}, window.location.origin),
    error => window.postMessage({channel,kind:'response',id:value.id,ok:false,error:error instanceof Error ? error.message : 'Native request failed.'}, window.location.origin)
  );
});
