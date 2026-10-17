import test from "node:test";
import assert from "node:assert/strict";
import {
  safeRoute,
  staticRoute,
  responseShape,
  createInterfaceCapture,
  validateInterfaceCapture,
  compareScreen,
  captureRouteMatches,
  isInterfaceTraversalRoute,
  isInterfaceSourceAsset,
} from "./interface-capture.mjs";
test("source assets allow the observed vendor CDN without accepting arbitrary origins", () => {
  const origin = "https://tenant.uat.alayacare.ca";
  assert.equal(isInterfaceSourceAsset(`${origin}/app.js`, origin), true);
  assert.equal(isInterfaceSourceAsset("https://accloud-frontend-assets.alayacare.com/chunk.css", origin), true);
  assert.equal(isInterfaceSourceAsset("https://unrelated.example/chunk.js", origin), false);
  assert.equal(isInterfaceSourceAsset(`${origin}/api/patients`, origin), false);
  assert.equal(isInterfaceSourceAsset("https://fonts.googleapis.com/css2?family=Roboto+Flex&display=swap",origin),true);
  assert.equal(isInterfaceSourceAsset("https://fonts.googleapis.com/css2?token=secret",origin),false);
  assert.equal(isInterfaceSourceAsset("https://user:secret@accloud-frontend-assets.alayacare.com/app.js", origin), false);
});
const screen = {
  id: "1",
  route: "#/dashboard/v2/tasks",
  state: "page",
  capturedAt: "now",
  headings: ["Tasks"],
  columns: ["Name"],
  controls: [
    {
      tag: "button",
      role: "",
      label: "Task",
      type: "",
      disabled: false,
      required: false,
      options: [],
    },
  ],
  links: [],
  tree: null,
  truncated: false,
  assets: [],
};
test("routes exclude identities and query values", () => {
  assert.equal(
    safeRoute("#/clients/secret123/medical?token=abc"),
    "#/clients/{record}/medical",
  );
  assert.equal(staticRoute("#/clients/1/chart"), null);
  assert.equal(staticRoute("#/employee/default/343/profile"), null);
  assert.equal(staticRoute("#/clients/charts/343"), null);
  assert.equal(safeRoute("javascript:alert(1)"), null);
});
test("capture accepts observed canonical redirects without accepting stale screens", () => {
  assert.equal(captureRouteMatches("#/dashboard", "#/dashboard/live/"), true);
  assert.equal(captureRouteMatches("#/clients/list", "#/clients/list/?page=2"), true);
  assert.equal(captureRouteMatches("#/clients/list", "#/dashboard/live/"), false);
  assert.equal(captureRouteMatches("#/accounting/billing", "#/accounting/payroll"), false);
  assert.equal(captureRouteMatches('#/employee/default/list','#/employees/list'),true);
  assert.equal(captureRouteMatches('#/clients/18p/client-info','#/clients/18p/client-info/demographics'),true);
});
test('legacy record routes are normalized for comparison and excluded from new traversal',()=>{
  assert.equal(safeRoute('#/employee/default/view/id/9j/'),'#/employee/default/view/id/{record}/');
  assert.equal(safeRoute('#/employee/department/view/id/1a7//key/opaque'),'#/employee/department/view/id/{record}//key/{record}');
  assert.equal(isInterfaceTraversalRoute('#/employee/default/view/id/9j/'),false);
  assert.equal(isInterfaceTraversalRoute('#/facilities/1ab'),false);
  assert.equal(isInterfaceTraversalRoute('#/login/setup-account'),false);
  const capture=createInterfaceCapture('https://uat.alayacare.ca',[screen]);
  capture.coverage.discovery={startedAt:'start',finishedAt:'end',stopped:false,limit:300,attempts:[{route:'#/employee/default/view/id/9j/',status:'captured'}],pending:[]};
  assert.equal(validateInterfaceCapture(capture).coverage.discovery.attempts.length,1);
});
test("response shapes retain no values or credentials", () => {
  assert.deepEqual(
    responseShape({
      name: "Patient",
      password: "secret",
      age: 39,
      items: [{ code: "ABC" }],
    }),
    {
      age: "number",
      items: { type: "array", samples: [{ code: "string" }] },
      name: "string",
    },
  );
});
test("versioned capture validates inert trees and rejects malicious CSS", () => {
  const capture = createInterfaceCapture("https://example.uat.alayacare.ca", [
    screen,
  ]);
  assert.equal(validateInterfaceCapture(capture).screens.length, 1);
  assert.throws(() =>
    validateInterfaceCapture({
      ...capture,
      screens: [
        { ...screen, tree: { tag: "script", styles: {}, children: [] } },
      ],
    }),
  );
  assert.throws(() =>
    validateInterfaceCapture({
      ...capture,
      screens: [
        {
          ...screen,
          tree: {
            tag: "div",
            styles: { color: "url(https://evil.test)" },
            children: [],
          },
        },
      ],
    }),
  );
  assert.throws(() => createInterfaceCapture("https://evil.test"));
});
test("comparison detects options and disabled changes", () => {
  const actual = {
    ...screen,
    columns: ["Name", "Status"],
    controls: [
      { ...screen.controls[0], disabled: true },
      { ...screen.controls[0], label: "Settings" },
    ],
  };
  assert.deepEqual(
    compareScreen(screen, actual).map((c) => c.kind),
    ["columns", "changed-control", "added-control"],
  );
});
import { compareCaptures } from "./interface-capture.mjs";
test("comparison does not call uncaptured historical states a pass", () => {
  const a = createInterfaceCapture("https://uat.alayacare.ca", [
    screen,
    { ...screen, id: "2", state: "New Task" },
  ]);
  const b = createInterfaceCapture("https://uat.alayacare.ca", [screen]);
  assert.deepEqual(
    compareCaptures(a, b).map((s) => s.coverage),
    ["compared", "not-recaptured"],
  );
});
import { sanitizeResponseShape } from "./interface-capture.mjs";
test("passive type bridge preserves numbers and never accepts response values", () => {
  assert.deepEqual(
    sanitizeResponseShape({
      age: "number",
      name: "Patient",
      password: "secret",
    }),
    { age: "number", name: "string" },
  );
});
import { safeRequestPath } from "./interface-capture.mjs";
import { readInterfaceArchive } from "./interface-archive-file.mjs";
import { gzipSync, strToU8, zipSync } from "fflate";
test("compressed archives round trip and reject non-capture files", () => {
  const capture = createInterfaceCapture("https://uat.alayacare.ca", [screen]);
  assert.equal(
    readInterfaceArchive(gzipSync(strToU8(JSON.stringify(capture)))).screens[0]
      .id,
    "1",
  );
  assert.throws(() => readInterfaceArchive(strToU8('{"screens":[]}')));
});
test('update ZIP loads only its bounded interface contract',()=>{
  const capture=createInterfaceCapture('https://uat.alayacare.ca',[screen]);
  const zip=zipSync({'interface.json.gz':gzipSync(strToU8(JSON.stringify(capture))),'assets/vendor.txt':strToU8('window.alert("never execute");')});
  assert.equal(readInterfaceArchive(zip).screens[0].id,'1');
  assert.throws(()=>readInterfaceArchive(zipSync({'vendor.js':strToU8('alert(1)')})),/missing interface/);
});
test('discovery preserves failed and pending routes through archive validation',()=>{
  const capture=createInterfaceCapture('https://uat.alayacare.ca',[screen]);
  capture.coverage.discovery={startedAt:'start',finishedAt:'end',stopped:true,limit:300,attempts:[{route:'#/accounting/payment',status:'failed',error:'Access unavailable'}],pending:['#/system-settings/forms']};
  assert.equal(validateInterfaceCapture(capture).coverage.discovery.pending.length,1);
  assert.equal(isInterfaceTraversalRoute('#/employee/default/createNew'),false);
  assert.equal(isInterfaceTraversalRoute('#/clients/charts/343'),false);
  assert.equal(isInterfaceTraversalRoute('#/system-settings/forms'),true);
  capture.coverage.discovery.pending=['#/clients/charts/343'];
  assert.throws(()=>validateInterfaceCapture(capture),/pending/);
});
test("regression comparison keeps duplicate controls and reports style changes", () => {
  const node = {
    tag: "div",
    role: "",
    label: "",
    text: "",
    styles: { width: "100px" },
    children: [],
  };
  const before = {
    ...screen,
    controls: [screen.controls[0], screen.controls[0]],
    tree: node,
  };
  const after = { ...screen, tree: { ...node, styles: { width: "120px" } } };
  assert.deepEqual(
    compareScreen(before, after).map((c) => c.kind),
    ["removed-control", "layout-style"],
  );
});
test("request paths normalize UUID and numeric identities; type arrays remain arrays", () => {
  assert.equal(
    safeRequestPath(
      "/api/clients/40/forms/550e8400-e29b-41d4-a716-446655440000?token=abc",
    ),
    "/api/clients/{id}/forms/{id}",
  );
  assert.deepEqual(sanitizeResponseShape(responseShape([{ id: 4 }])), {
    type: "array",
    samples: [{ id: "number" }],
  });
});

test('workflow graphs reject missing states, unknown control references and duplicate controls',()=>{
 const initial={...screen,controls:[{...screen.controls[0],id:'c0'}]};
 const capture=createInterfaceCapture('https://uat.alayacare.ca',[initial]);
 capture.transitions=[{from:initial.id,to:'missing',action:{kind:'click',label:'Open'}}];
 assert.throws(()=>validateInterfaceCapture(capture),/transition/);
 capture.transitions=[];capture.screens[0]={...initial,tree:{tag:'div',role:'',label:'',text:'',styles:{},children:[],controlId:'c1'}};
 assert.throws(()=>validateInterfaceCapture(capture),/control reference/);
 capture.screens[0]={...initial,controls:[...initial.controls,...initial.controls],tree:null};assert.throws(()=>validateInterfaceCapture(capture),/Duplicate/);
});
test('short alphanumeric customer chart identities are normalized and never retained as record routes',()=>{
 assert.equal(safeRoute('#/customer/default/view/id/p7z'), '#/customer/default/view/id/{record}');
});

test('account-button clock changes do not become removed controls, while ordinary time-labelled fields remain distinct',()=>{
 const one={...screen,controls:[{...screen.controls[0],label:'18:49MSTnorthernhealth'}]};const two={...screen,controls:[{...screen.controls[0],label:'11:12MSTnorthernhealth'}]};
 assert.deepEqual(compareScreen(one,two),[]);
 assert.equal(compareScreen({...one,controls:[{...one.controls[0],label:'11:12 safety review'}]},{...two,controls:[{...two.controls[0],label:'11:13 safety review'}]}).length,2);
});
