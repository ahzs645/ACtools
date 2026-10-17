import {capturedVisualHtml,capturedFontCss} from './interface-visuals.mjs';
import {compareCaptures,validateInterfaceCapture} from './interface-capture.mjs';

/** Run-local inventory. Old checkpoints must never count as a new visit. */
export function snapshotInventory(capture,baseline) {
  validateInterfaceCapture(capture);
  const start = Date.parse(capture.run?.startedAt ?? '');
  const screens = capture.screens.map((screen,index) => ({
    route:screen.route,state:screen.state,capturedAt:screen.capturedAt,
    fresh:Number.isFinite(start) ? Date.parse(screen.capturedAt)>=start : null,
    viewport:screen.viewport ?? null,controls:screen.controls.length,
    inlineControls:screen.controls.filter(control=>control.recordTemplate).length,
    truncated:screen.truncated,screenshot:Boolean(screen.screenshot),file:`screens/${String(index+1).padStart(3,'0')}.html`,
  }));
  const comparisons=baseline?compareCaptures(baseline,capture):[];
  const missing=comparisons.filter(item=>item.coverage==='not-recaptured');
  const changed=comparisons.filter(item=>item.coverage==='compared'&&item.changes.length);
  return {
    format:'alayacare-interface-snapshot-review',version:1,sourceOrigin:capture.sourceOrigin,
    run:capture.run??null,capturedAt:capture.capturedAt,
    summary:{routes:capture.coverage.routes.length,states:screens.length,fresh:screens.filter(screen=>screen.fresh===true).length,stale:screens.filter(screen=>screen.fresh===false).length,
      screenshots:screens.filter(screen=>screen.screenshot).length,truncated:screens.filter(screen=>screen.truncated).length,
      failedRoutes:capture.coverage.discovery?.attempts.filter(item=>item.status==='failed').length??0,pendingRoutes:capture.coverage.discovery?.pending.length??0,
      changedStates:changed.length,notRecaptured:missing.length,embeddedVisualAssets:(capture.visualAssets??[]).filter(a=>a.data).length,missingVisualAssets:(capture.visualAssets??[]).filter(a=>!a.data).length,pseudoElements:capture.screens.reduce((n,s)=>{const count=node=>node?(node.visual?.before?1:0)+(node.visual?.after?1:0)+node.children.reduce((sum,c)=>sum+count(c),0):0;return n+count(s.tree);},0)},
    visualAssets:(capture.visualAssets??[]).map(({data,...asset})=>asset),visualAssetChanges:baseline?[...new Set([...(baseline.visualAssets??[]).map(a=>a.url),...(capture.visualAssets??[]).map(a=>a.url)])].flatMap(url=>{const before=baseline.visualAssets?.find(a=>a.url===url),after=capture.visualAssets?.find(a=>a.url===url);return before?.sha256===after?.sha256?[]:[{url,before:before?.sha256??null,after:after?.sha256??null}];}):[],screens,discovery:capture.coverage.discovery??null,comparisons,
    warnings:[...(baseline?.run&&capture.run&&baseline.run.extensionVersion!==capture.run.extensionVersion?['Collector version differs from baseline; newly captured attributes can change the report without a vendor interface change.']:[]),...(baseline&&!baseline.visualAssets&&capture.visualAssets?.length?['The baseline has no embedded visual resources. Treat newly recorded assets as added evidence until both runs carry equivalent visual detail.']:[]),...(!capture.visualAssets?.some(a=>a.kind==='font'&&a.data)?['No font binaries embedded: icon glyphs and text may use fallback fonts.']:[]),...((capture.visualAssets??[]).some(a=>a.error)?['Some visual assets could not be embedded; see visualAssets for individual failures.']:[]),...(!capture.run?['Legacy archive: no run identity; freshness is unknown.']:[]),
      ...(baseline&&baseline.sourceOrigin!==capture.sourceOrigin?['Tenant differs from baseline; differences are not proof of a vendor release.']:[]),
      ...(comparisons.some(item=>item.changes.some(change=>change.kind==='viewport'))?['Viewport differs on compared states. Review size-dependent layout changes separately.']:[]),
      'Unvisited or failed routes are coverage gaps, not removed features.','Captured controls and transitions do not prove server-side Save, approval or permission behavior.'],
  };
}
const esc = value => String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const shell=(title,body,images=false)=>`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'"><title>${esc(title)}</title><style>body{font:14px/1.5 Arial,sans-serif;margin:24px;color:#263344;background:#fff}table{border-collapse:collapse;width:100%}td,th{padding:8px;border:1px solid #ddd;text-align:left}th{background:#f2f4f7}a{color:#245ac2}code{white-space:pre-wrap}img{max-width:100%}</style></head><body>${body}</body></html>`;
/** Inert local pages, shared by extension ZIP exports and CLI reports. */
export function snapshotReviewFiles(capture,baseline) {
  const review=snapshotInventory(capture,baseline);
  const files={'snapshot-review.json':JSON.stringify(review,null,2)+'\n'};
  for(const [index,screen] of capture.screens.entries()) files[review.screens[index].file]=shell(`${screen.route} · ${screen.state}`,
    `<p><a href="../index.html">Snapshot index</a> · ${esc(screen.route)} · ${esc(screen.state)} · ${esc(screen.capturedAt)}</p><p>${screen.screenshot?'Native viewport screenshot':'Inert captured structure with retained visual evidence; see resource failures for missing assets.'}</p>${screen.screenshot?`<img alt="Captured native viewport" src="${screen.screenshot}">`:`<div style="overflow:auto"><style>${capturedFontCss(capture.visualAssets)}</style>${capturedVisualHtml(screen.tree,capture.visualAssets)}</div>`}`,Boolean(screen.screenshot));
  const rows=review.screens.map(screen=>`<tr><td><a href="${screen.file}">${esc(screen.route)}</a></td><td>${esc(screen.state)}</td><td>${esc(screen.capturedAt)}</td><td>${screen.viewport?`${screen.viewport.width} × ${screen.viewport.height}`:'Unknown'}</td><td>${screen.controls} (${screen.inlineControls} inline)</td><td>${screen.screenshot?'PNG':'Structure'}${screen.truncated?' · truncated':''}${screen.fresh===false?' · stale':''}</td></tr>`).join('');
  const changes=review.comparisons.map(item=>`<tr><td>${esc(item.route)}</td><td>${esc(item.state)}</td><td>${esc(item.coverage)}</td><td>${esc(item.changes.map(change=>change.kind).join(', '))}</td></tr>`).join('');
  files['index.html']=shell('AlayaCare interface snapshot',`<h1>AlayaCare interface snapshot</h1><p>${esc(capture.sourceOrigin)} · ${esc(capture.run?.label)} · ${esc(capture.run?.id??'Legacy run')}</p><p>${review.summary.routes} routes · ${review.summary.states} states · ${review.summary.failedRoutes} failed routes · ${review.summary.pendingRoutes} pending · ${review.summary.notRecaptured} baseline states not recaptured</p><ul>${review.warnings.map(warning=>`<li>${esc(warning)}</li>`).join('')}</ul><h2>Pages and states</h2><table><thead><tr><th>Route</th><th>State</th><th>Captured</th><th>Viewport</th><th>Controls</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table><h2>Comparison</h2><table><thead><tr><th>Route</th><th>State</th><th>Coverage</th><th>Changes</th></tr></thead><tbody>${changes}</tbody></table><h2>Route discovery</h2><pre>${esc(JSON.stringify(review.discovery,null,2))}</pre>`);
  return files;
}
