const channel = 'ac-tools/form-draft-http/v1';
export function requestNativeFormDraft(method: 'GET'|'POST'|'PUT', path: string, body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const finish = () => { clearTimeout(timer); window.removeEventListener('message', listener); };
    const listener = (event: MessageEvent) => {
      const response = event.data;
      if (event.source !== window || event.origin !== window.location.origin || response?.channel !== channel || response?.kind !== 'response' || response.id !== id) return;
      finish();
      if (response.ok) resolve(response.data);
      else reject(new Error(typeof response.error === 'string' ? response.error : 'Native request failed.'));
    };
    const timer = setTimeout(() => { finish(); reject(new Error('Native request timed out. Check the draft and receipt before retrying.')); }, 35000);
    window.addEventListener('message', listener);
    window.postMessage({channel,kind:'request',id,method,path,body}, window.location.origin);
  });
}
