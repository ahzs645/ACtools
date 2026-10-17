import test from 'node:test';
import assert from 'node:assert/strict';
import {safeImageData,capturedVisualHtml,capturedFontCss,fontResourcesFromCss,collectVisualAssets,validateVisualAssets} from './interface-visuals.mjs';
const origin='https://northernhealth.uat.alayacare.ca';
const font={url:origin+'/assets/icons.woff',kind:'font',fontFamily:'Phosphor',fontWeight:'400'};
test('inert visual evidence preserves glyphs, SVG geometry, embedded logo and input answers',()=>{
 const node={tag:'span',styles:{color:'#000'},children:[],visual:{before:{text:'\uf34e',styles:{'font-family':'Phosphor'}}}};
 assert.match(capturedVisualHtml(node),/Phosphor/);assert.ok(capturedVisualHtml(node).includes('\uf34e'));
 assert.match(capturedVisualHtml({tag:'path',styles:{},children:[],visual:{attributes:{d:'M0 0h12',fill:'#fff'}}}),/d="M0 0h12"/);
 assert.ok(safeImageData('data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')));
 assert.match(capturedVisualHtml({tag:'input',styles:{},children:[],value:'<unsafe>'}),/&lt;unsafe&gt;/);
});
test('rejects executable SVG, external references and remote resource injection',()=>{
 for(const svg of ['<svg onload="alert(1)"/>','<svg><script/></svg>','<svg><use href="https://evil.test"/></svg>','<svg><style>@import "https://evil.test"</style></svg>'])assert.equal(safeImageData('data:image/svg+xml,'+encodeURIComponent(svg)),false);
 assert.ok(safeImageData('data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="fill"/></defs><path fill="url(#fill)"/></svg>')));
 assert.throws(()=>validateVisualAssets([{...font,url:'https://evil.test/a.woff',data:'data:font/woff;base64,YQ=='}],origin));
 assert.throws(()=>validateVisualAssets([{...font,data:'data:text/html;base64,YQ=='}],origin));
});
test('finds opaque stylesheet font references relative to their original asset',()=>{
 const refs=fontResourcesFromCss('@font-face{font-family:"Phosphor";src:url(./Phosphor.woff) format("woff");font-weight:400}@font-face{font-family:x;src:url(https://evil.test/a.woff)}','https://accloud-frontend-assets.alayacare.com/ui/style.css',origin);
 assert.equal(refs.length,1);assert.equal(refs[0].fontFamily,'Phosphor');assert.equal(refs[0].url,'https://accloud-frontend-assets.alayacare.com/ui/Phosphor.woff');
});
test('collects once per URL, embeds/hash-checks binary assets and reports failures',async()=>{
 let calls=0;const refs=[font,font,{...font,url:origin+'/missing.woff'}];
 const assets=await collectVisualAssets(refs,origin,async url=>{calls++;return new Response(url.includes('missing')?'':new Uint8Array([119,79,70,70]),{status:url.includes('missing')?404:200,headers:{'content-type':'application/octet-stream'}});});
 assert.equal(calls,2);assert.match(assets[0].data,/data:font\/woff;base64,/);assert.equal(assets[0].sha256.length,64);assert.match(assets[1].error,/404/);
 assert.match(capturedFontCss(assets),/@font-face/);assert.ok(!capturedFontCss(assets).includes('missing'));
});
test('oversized resources are explicit failures',async()=>{
 const assets=await collectVisualAssets([font],origin,async()=>new Response('bad',{headers:{'content-length':'2000001'}}));assert.match(assets[0].error,/exceeds 2 MB/);
});
