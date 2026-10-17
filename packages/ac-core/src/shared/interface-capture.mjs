/** Versioned, inert interface evidence; full test mode retains displayed answers. */
import {VISUAL_TAGS,captureVisualDetails,visualResourceReferences,validateVisualDetails,validateVisualAssets} from "./interface-visuals.mjs";
export const INTERFACE_FORMAT = "webforms-alayacare-interface-capture";
export const INTERFACE_COMMAND = "ac/interface";
// ACtools inserts these roots into the vendor page. Do not use text matching:
// a native form may legitimately mention ACtools in its own instructions.
export const EXTENSION_UI_SELECTOR = '[data-ac-tools-ui],[data-ac-tools-button],.ac-tools-button,#ac-tools-overlay-root';
export const isExtensionUI = (el) => Boolean(el?.closest?.(EXTENSION_UI_SELECTOR));
export function hideExtensionUI(doc) {
  const saved = [...doc.querySelectorAll(EXTENSION_UI_SELECTOR)].map(el => ({el,value:el.style.getPropertyValue('display'),priority:el.style.getPropertyPriority('display')}));
  for (const {el} of saved) el.style.setProperty('display','none','important');
  return () => {for (const {el,value,priority} of saved) {if(value)el.style.setProperty('display',value,priority);else el.style.removeProperty('display');}};
}
const safeTags = new Set([
  ...VISUAL_TAGS.map(tag=>tag.toLowerCase()),
  "body",
  "div",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "label",
  "button",
  "input",
  "textarea",
  "select",
  "option",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "nav",
  "aside",
  "main",
  "header",
  "footer",
  "section",
  "article",
  "a",
  "ul",
  "ol",
  "li",
  "img",
  "svg",
  "path",
  "fieldset",
  "legend",
  "form",
  "hr",
]);
export const STYLE_PROPERTIES = [
  "text-transform","letter-spacing","word-spacing","text-overflow","font-variation-settings","font-feature-settings",
  "border-top","border-right","border-bottom","border-left","border-collapse","border-spacing","table-layout",
  "overflow-x","overflow-y","object-fit","object-position","aspect-ratio","outline",
  "fill","fill-opacity","stroke","stroke-width","stroke-linecap","stroke-linejoin",
  "display",
  "box-sizing",
  "float",
  "clear",
  "vertical-align",
  "flex",
  "flex-wrap",
  "align-self",
  "order",
  "white-space",
  "word-break",
  "font-style",
  "text-decoration",
  "transform",
  "transform-origin",
  "list-style",
  "position",
  "top",
  "left",
  "right",
  "bottom",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "padding",
  "margin",
  "gap",
  "grid-template-columns",
  "flex-direction",
  "align-items",
  "justify-content",
  "background-color",
  "background-image",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "border",
  "border-radius",
  "box-shadow",
  "overflow",
  "opacity",
  "z-index",
  "text-align",
];
export function safeRoute(value) {
  if (
    typeof value !== "string" ||
    !/^#\/[a-zA-Z0-9_/{}/.-]*(?:\?[a-zA-Z0-9_=&%.-]*)?$/.test(value) ||
    value.length > 500
  )
    return null;
  // Keep route shape, not client IDs or query values.
  return value
    .split("?")[0]
    .replace(/(\/view\/id\/)[^/]+/g, "$1{record}")
    .replace(/(\/key\/)[^/]+/g, "$1{record}")
    .replace(/(\/customer\/default\/view\/id\/)[^/]+/g, "$1{record}")
    .replace(
      /(\/(clients|employees|submissions)\/)([^/]+)/g,
      (full, prefix, group, id) =>
        (group === "clients" &&
          [
            "list",
            "services-list",
            "myclient-service-list",
            "charts",
            "facility",
          ].includes(id)) ||
        (group === "employees" &&
          [
            "list",
            "departments",
            "employment-rulesets",
            "skills",
            "expiring-criterias",
          ].includes(id))
          ? full
          : prefix + "{record}",
    )
    .replace(/(\/facilities\/)([^/]+)/g, (full,prefix,id)=>['list','types'].includes(id)?full:prefix+'{record}')
    .replace(/\/(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\/|$)/gi, "/{record}");
}
export function staticRoute(value) {
  const route = safeRoute(value);
  return route && !route.includes("{") ? route : null;
}
export function isInterfaceTraversalRoute(value) {
  const route = staticRoute(value);
  return Boolean(route && !/logout|signout|autologin|^#\/(?:login|auth)(?:\/|$)|\/(?:add|create|delete|remove|upload|import|edit)(?:[\/_-]|New(?:\/|$)|$)/i.test(route));
}
export function isInterfaceChartRoute(value) {
  const route=safeRoute(value);
  return Boolean(route && /^#\/(?:clients\/|client\/default\/|customer\/default\/view\/id\/)\{record\}(?:\/|$)/.test(route) && !/\/(?:add|create|delete|remove|upload|import|edit)(?:[\/_-]|$)/i.test(route));
}
// Accept historical metadata without authorizing those links for a new crawl.
function isRecordedNavigationRoute(value) {
  return isInterfaceTraversalRoute(value)||Boolean(typeof value==='string'&&safeRoute(value)&&
    (/^#\/(?:employee\/[^/]+\/view\/id\/|facilities\/)/.test(value)||value==='#/login/setup-account'));
}
// AlayaCare redirects the Dashboard entry to its live dashboard and adds
// trailing slashes on several routes. Keep stale/unrelated screens a failure.
export function captureRouteMatches(expected, actual) {
  const normalize = (route) => safeRoute(route)?.replace(/\/+$/, "");
  const wanted = normalize(expected);
  const loaded = normalize(actual);
  // Observed redirects in the 2026-10-16 native UAT archive. Never accept an
  // arbitrary new route as proof that the requested page loaded.
  const aliases = {
    '#/dashboard':'#/dashboard/live',
    '#/employee/default/list':'#/employees/list',
    '#/dashboard/client-intake-beta':'#/intake/offers',
    '#/employee/department/listall':'#/employees/departments',
    '#/employment-rulesets':'#/employees/employment-rulesets',
    '#/employeeskill/default/list':'#/employees/skills',
    '#/employeeskill/default/listexpiry':'#/employees/expiring-criterias',
    '#/accounting/settings':'#/accounting/settings/accounts',
    '#/workforce-management':'#/workforce-management/vacant-visits',
    '#/settings/scheduling':'#/settings/scheduling/entity-tags',
    '#/system-settings/libraries':'#/system-settings/libraries/careplan-libraries',
    '#/system-settings/external-events':'#/system-settings/external-events/sqs-queues',
    '#/system-settings/family-portal-email-template':'#/system-settings/family-portal-email-template/forgot-password',
    '#/system-settings/medication':'#/system-settings/medication/administration-reason',
    '#/dashboard/client-forms':'#/dashboard/client-forms/form-list',
    '#/clients/{record}/client-info':'#/clients/{record}/client-info/demographics',
    '#/clients/{record}/notes':'#/clients/{record}/notes/client-notes',
    '#/clients/{record}/care-management':'#/clients/{record}/care-management/ac-assessments',
    '#/clients/{record}/care-delivery':'#/clients/{record}/care-delivery/v2/tasks',
    '#/clients/{record}/accounting':'#/clients/{record}/accounting/authorizations',
    '#/clients/{record}/events':'#/clients/{record}/events/search',
  };
  return Boolean(wanted && loaded && (wanted === loaded || aliases[wanted] === loaded));
}
// Only source assets already observed in a captured page are considered by the
// collector. This CDN hosts the micro-frontends observed in the native HAR.
export function isInterfaceSourceAsset(value, sourceOrigin) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && ((/\.(?:js|css)$/i.test(url.pathname) &&
      (url.origin === sourceOrigin || url.origin === "https://accloud-frontend-assets.alayacare.com")) || (url.origin === "https://fonts.googleapis.com" && /^\/css2?$/.test(url.pathname) && [...url.searchParams.keys()].every(key=>["family","display","subset"].includes(key))));
  } catch { return false; }
}
export function responseShape(value, depth = 0) {
  if (depth > 7) return "depth-limit";
  if (value === null) return "null";
  if (Array.isArray(value))
    return {
      type: "array",
      samples: value.slice(0, 3).map((v) => responseShape(v, depth + 1)),
    };
  if (typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .slice(0, 100)
        .filter(
          (key) => !/(?:token|password|cookie|authorization|secret)/i.test(key),
        )
        .map((key) => [key, responseShape(value[key], depth + 1)]),
    );
  return typeof value;
}
export function captureScreen(doc, href, state = "page", options = {}) {
  const restore = hideExtensionUI(doc);
  try { return captureNativeScreen(doc,href,state,options); } finally { restore(); }
}
function captureNativeScreen(doc, href, state, options) {
  const url = new URL(href);
  const full = options.mode === 'test-full';
  const limits=[];
  const route = safeRoute(url.hash);
  if (!route) throw new Error("This page has no supported AlayaCare route.");
  const visible = (el) => !isExtensionUI(el) && Boolean(el.getClientRects().length);
  const label = (el) =>
    el.closest(".field-grid")?.querySelector(":scope > .field-label")?.textContent?.trim() ||
    el.closest(".form-group,.input-container,.input-wrapper,.field")?.querySelector('label,.label,.input_label,.input-label,[data-test="input-label"]')?.textContent?.trim() ||
    el.getAttribute("aria-label") ||
    (el.tagName==='INPUT' && ['button','submit','reset'].includes(el.type) ? el.value : '') ||
    el.getAttribute("placeholder") ||
    el.getAttribute("title") ||
    el.labels?.[0]?.textContent?.trim() ||
    "";
  // An inline clinical grid is interface structure too. Capture one row's
  // controls per table, using column headings rather than record labels/values.
  const rowTemplates = new Map();
  const recordColumn = el => {
    const cell = el.closest('td');
    const table = cell?.closest('table');
    const row = cell?.closest('tr');
    if (!table || !row) return null;
    if (!rowTemplates.has(table)) rowTemplates.set(table, [...table.querySelectorAll('tr')].find(item => item.closest('table') === table && item.querySelector('td input,td textarea,td select,td [role=combobox],td [role=switch]')));
    if (!full && rowTemplates.get(table) !== row) return null;
    const heading = [...table.querySelectorAll('thead tr, tr')].find(item => item.closest('table') === table && item.querySelector('th'));
    return heading?.children[cell.cellIndex]?.textContent?.trim().slice(0,300) || '';
  };
  const controlLabel = el => el.closest('td') ? recordColumn(el) ?? '' : label(el);
  const trim = (value) =>
    String(value ?? "")
      .trim()
      .slice(0, 300);
  const links = [...doc.querySelectorAll("a[href]")]
    .filter(el=>visible(el)&&(full||!el.closest("td")))
    .map((el) => {
      try {
        const target = new URL(el.getAttribute("href"), url.origin);
        return {
          label: trim(el.textContent),
          route: target.origin === url.origin ? staticRoute(target.hash) : null,
        };
      } catch {
        return { label: "", route: null };
      }
    })
    .filter((l) => l.route && !/logout|signout/i.test(l.route));
  const metadataOptions = new Set();
  const staticChoices = {
    Status: new Set(["Open", "In Progress", "In Review", "Done", "Not Doing"]),
    Priority: new Set(["Low", "Normal", "Important", "Urgent"]),
  };
  const optionsFor = (el) => {
    if (el.tagName === "SELECT") return [...el.options].map((o) => trim(o.textContent));
    // Only confirmed task vocabularies. Autocomplete results may be patients,
    // employees or chart records and must remain omitted.
    const noteType = label(el) === 'Search or select a note type';
    const allowed = staticChoices[label(el)];
    if ((!full && !allowed && !noteType) || el.getAttribute("role") !== "combobox" ||
        (!full && el.getAttribute("aria-autocomplete") === "list" && !noteType)) return [];
    const panel = doc.getElementById(el.getAttribute("aria-controls") || "");
    const options = panel ? [...panel.querySelectorAll('[role="option"]')].filter(visible) : [];
    const values = options.map((o) => trim(o.getAttribute("aria-label") || o.textContent));
    if (!values.length || (!full && !noteType && !values.every((v) => allowed.has(v)))) return [];
    for (const option of options) metadataOptions.add(option);
    return values;
  };
  const controlElements = [
    ...doc.querySelectorAll(
      "button,input,textarea,select,[role=combobox],[role=switch]",
    ),
  ]
    .filter((el) => visible(el) && (full || !el.closest("td") || (el.tagName !== 'BUTTON' && recordColumn(el) !== null)));
  if(controlElements.length>(full?1000:300)){limits.push('Control count exceeded the capture budget.');controlElements.length=full?1000:300;}
  const controlIds = new Map(controlElements.map((el,index)=>[el,`c${index}`]));
  const controls = controlElements.map((el) => ({
      id: controlIds.get(el),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || "",
      label: trim((full?label(el)||recordColumn(el):controlLabel(el)) || ((full||!el.closest('td')) && el.tagName === "BUTTON" ? el.textContent : "")),
      type: el.getAttribute("type") || "",
      disabled:
        el.hasAttribute("disabled") ||
        el.getAttribute("aria-disabled") === "true",
      required:
        el.hasAttribute("required") ||
        el.getAttribute("aria-required") === "true" ||
        (['INPUT','SELECT','TEXTAREA'].includes(el.tagName) && /\*\s*$/.test(label(el))),
      options: !full&&el.closest('td') ? (['Category','Severity'].includes(controlLabel(el)) && el.tagName === 'SELECT' ? [...el.options].map(option => trim(option.textContent)) : []) : optionsFor(el),
      ...(el.closest('td') ? {recordTemplate:true} : {}),
      ...(full ? {value:el.getAttribute('type')==='password'?'':String(el.value??el.getAttribute('aria-valuetext')??'').slice(0,100000),checked:el.checked??el.getAttribute('aria-checked')==='true',readOnly:Boolean(el.readOnly),selectedValues:el.tagName==='SELECT'?[...el.selectedOptions].map(option=>String(option.value)):[]} : {}),
    }));
  let count = 0;
  let truncated = false;
  function tree(el, inRecord = false) {
    if (isExtensionUI(el)) return null;
    if (++count > (full?20000:5000)) {
      truncated = true;
      return null;
    }
    if (!visible(el)) return null;
    const rawTag = el.tagName.toLowerCase();
    if (["script", "style", "iframe", "object", "embed"].includes(rawTag))
      return null;
    const tag = safeTags.has(rawTag) ? rawTag : "div";
    const record = !full && (
      inRecord ||
      tag === "td" ||
      el.matches("[contenteditable=true],.ql-editor") ||
      (el.matches("[role=option]") && !metadataOptions.has(el)));
    const style = doc.defaultView.getComputedStyle(el);
    const styles = Object.fromEntries(
      STYLE_PROPERTIES.map((key) => [key, style.getPropertyValue(key)]).filter(
        ([, v]) => v && !/url\s*\(|expression|javascript:/i.test(v),
      ),
    );
    const children = [...el.children]
      .map((c) => tree(c, record))
      .filter(Boolean);
    // Structural mode excludes record text; full test mode retains rendered answers.
    const text = record
      ? ""
      : [...el.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent)
          .join(" ")
          .trim();
    const semantic = !full && ([
      "h1",
      "h2",
      "h3",
      "h4",
      "label",
      "button",
      "th",
      "legend",
      "option",
    ].includes(tag) || metadataOptions.has(el) || el.matches(".field-grid > .field-label"));
    const fullText=full?text:'';
    if(fullText.length>10000&&!limits.includes('A text node exceeded the capture budget.'))limits.push('A text node exceeded the capture budget.');
    const visual=captureVisualDetails(el,STYLE_PROPERTIES);
    return {
      tag,
      ...(controlIds.has(el) ? {controlId:controlIds.get(el)} : {}),
      ...(visual?{visual}:{}),
      role: el.getAttribute("role") || "",
      label: record ? "" : trim(label(el)),
      text: full ? fullText.slice(0,10000) : semantic && !record ? trim(el.textContent) : "",
      ...(full&&['input','textarea','select'].includes(tag)?{value:el.getAttribute('type')==='password'?'':String(el.tagName==='SELECT'?[...el.selectedOptions].map(option=>option.textContent).join(', '):el.value??'').slice(0,100000),checked:Boolean(el.checked)}:{}),
      styles,
      children: semantic ? [] : children,
    };
  }
  const capturedTree=tree(doc.body);
  return {
    visualResources:visualResourceReferences(doc,capturedTree,url.origin),
    id: crypto.randomUUID(),
    route,
    ...(full?{captureMode:'test-full',sourceRoute:url.hash,captureLimits:limits}:{}),
    state: trim(state) || "page",
    capturedAt: new Date().toISOString(),
    viewport: {
      width: doc.defaultView.innerWidth,
      height: doc.defaultView.innerHeight,
      devicePixelRatio: doc.defaultView.devicePixelRatio || 1,
    },
    headings: [...doc.querySelectorAll("h1,h2,h3")]
      .filter(visible)
      .map((el) => trim(el.textContent)),
    columns: [...doc.querySelectorAll("th")]
      .filter(visible)
      .map((el) => trim(el.textContent)),
    controls,
    ...(controlIds.has(doc.activeElement) ? {focusedControlId:controlIds.get(doc.activeElement)} : {}),
    links,
    navigationRoutes: [...new Set([...doc.querySelectorAll('a[href]')].filter(el=>!isExtensionUI(el)).flatMap(el => {
      try {
        const target = new URL(el.getAttribute('href'), url.origin);
        return target.origin === url.origin && isInterfaceTraversalRoute(target.hash) ? [staticRoute(target.hash)] : [];
      } catch { return []; }
    }))].slice(0, 1500),
    tree: capturedTree,
    truncated:truncated||limits.length>0,
    assets: (() => {
      const declared = [
        ...doc.querySelectorAll("script[src],link[rel=stylesheet]"),
      ].filter(el=>!isExtensionUI(el)).map((el) => ({
        kind: el.tagName === "SCRIPT" ? "script" : "stylesheet",
        url: (()=>{const asset=new URL(el.getAttribute("src") || el.getAttribute("href"),url.origin);return asset.origin==='https://fonts.googleapis.com'&&isInterfaceSourceAsset(asset.href,url.origin)?asset.href.split('#')[0]:asset.href.split(/[?#]/)[0];})(),
      }));
      // Bundlers often remove lazy chunk script elements after loading.
      const loaded = (
        doc.defaultView.performance?.getEntriesByType?.("resource") ?? []
      )
        .filter((entry) => /\.(?:js|css)(?:[?#]|$)/i.test(entry.name))
        .map((entry) => ({
          kind: /\.css(?:[?#]|$)/i.test(entry.name) ? "stylesheet" : "script",
          url: entry.name.split(/[?#]/)[0],
        }));
      return [
        ...new Map(
          [...declared, ...loaded].map((asset) => [asset.url, asset]),
        ).values(),
      ].slice(0, 1000);
    })(),
  };
}
export function createInterfaceCapture(origin, screens = [], requests = []) {
  const url = new URL(origin);
  if (
    !/^https:$/.test(url.protocol) ||
    !/(^|\.)alayacare\.(ca|com|cloud)$/.test(url.hostname)
  )
    throw new Error("Select an AlayaCare tab.");
  return {
    format: INTERFACE_FORMAT,
    formatVersion: 1,
    capturedAt: new Date().toISOString(),
    sourceOrigin: url.origin,
    screens,
    requests,
    coverage: {
      routes: [...new Set(screens.map((s) => s.route))],
      states: screens.length,
      limitations: [
        "Only visited routes and explicitly opened dialog states are captured.",
        screens.some(screen=>screen.captureMode==='test-full') ? "Full test capture retains displayed record text, entered values and rendered row controls. Authentication material and unrendered server data are outside the UI snapshot." : "Record text, entered values, credentials and response values are excluded.",
        "Server policies and lazy modules not visited require a later live check.",
        "Replay is inert; vendor JavaScript is never executed.",
      ],
    },
  };
}
export function validateInterfaceCapture(value) {
  if (
    !value ||
    value.format !== INTERFACE_FORMAT ||
    value.formatVersion !== 1 ||
    !Array.isArray(value.screens) ||
    value.screens.length > 500 ||
    !Array.isArray(value.requests)
  )
    throw new Error("Invalid interface capture.");
  createInterfaceCapture(value.sourceOrigin);
  if (value.run !== undefined) {
    if (!value.run || typeof value.run.id !== 'string' || value.run.id.length > 100 ||
        !Number.isFinite(Date.parse(value.run.startedAt)) || typeof value.run.extensionVersion !== 'string' || value.run.extensionVersion.length > 100 ||
        typeof value.run.label !== 'string' || value.run.label.length > 200 ||
        (value.run.finishedAt !== undefined && !Number.isFinite(Date.parse(value.run.finishedAt)))) throw new Error('Invalid snapshot run.');
  }
  if(value.visualAssets!==undefined)validateVisualAssets(value.visualAssets,value.sourceOrigin);
  let nodes = 0;
  let currentControlIds = new Set();
  const visit = (node, depth = 0) => {
    if (!node) return;
    if(node.controlId !== undefined && !currentControlIds.has(node.controlId)) throw new Error('Invalid captured control reference.');
    for (const key of ["role", "label", "text"])
      if (typeof node[key] !== "string" || node[key].length > (key==='text'?10000:1000))
        throw new Error("Invalid node text.");
    if (
      depth > 100 ||
      ++nodes > 750000 ||
      !safeTags.has(node.tag) ||
      !Array.isArray(node.children) ||
      typeof node.styles !== "object"
    )
      throw new Error("Invalid captured screen tree.");
    const validateStyles = styles => {if(!styles||typeof styles!=='object'||Array.isArray(styles))throw new Error('Unsafe captured style.');for(const [key,v]of Object.entries(styles))if(!STYLE_PROPERTIES.includes(key)||typeof v!=='string'||v.length>1000||/url\s*\(|expression|javascript:/i.test(v))throw new Error('Unsafe captured style.');};
    validateStyles(node.styles);
    if(node.visual!==undefined)validateVisualDetails(node.visual,validateStyles);
    node.children.forEach((c) => visit(c, depth + 1));
    if((node.value!==undefined&&(typeof node.value!=='string'||node.value.length>100000))||(node.checked!==undefined&&typeof node.checked!=='boolean'))throw new Error('Invalid captured node value.');
  };
  for (const screen of value.screens) {
    if(screen.visualResources!==undefined)validateVisualAssets(screen.visualResources,value.sourceOrigin);
    if(screen.captureMode!==undefined&&screen.captureMode!=='test-full')throw new Error('Invalid capture mode.');
    if(screen.sourceRoute!==undefined&&(typeof screen.sourceRoute!=='string'||screen.sourceRoute.length>2000||!safeRoute(screen.sourceRoute)))throw new Error('Invalid source route.');
    if(screen.captureLimits!==undefined&&(!Array.isArray(screen.captureLimits)||screen.captureLimits.length>20||screen.captureLimits.some(item=>typeof item!=='string'||item.length>1000)))throw new Error('Invalid capture limits.');
    if (screen.viewport !== undefined && (!screen.viewport || ![screen.viewport.width,screen.viewport.height].every(n => Number.isFinite(n) && n > 0 && n <= 50000) || (screen.viewport.browserZoom!==undefined&&(!Number.isFinite(screen.viewport.browserZoom)||screen.viewport.browserZoom<0.25||screen.viewport.browserZoom>5)) || (screen.viewport.devicePixelRatio !== undefined && (!Number.isFinite(screen.viewport.devicePixelRatio) || screen.viewport.devicePixelRatio <= 0 || screen.viewport.devicePixelRatio > 10)))) throw new Error('Invalid captured viewport.');
    if(screen.focusedControlId !== undefined && !screen.controls?.some(c=>c.id===screen.focusedControlId)) throw new Error('Invalid captured focus.');
    if (screen.navigationRoutes !== undefined && (!Array.isArray(screen.navigationRoutes) || screen.navigationRoutes.length > 1500 || screen.navigationRoutes.some(route => !isRecordedNavigationRoute(route))))
      throw new Error("Invalid discovery routes.");
    if (
      screen.screenshot !== undefined &&
      (typeof screen.screenshot !== "string" ||
        screen.screenshot.length > 15_000_000 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(screen.screenshot))
    )
      throw new Error("Invalid captured screenshot.");
    if (
      !safeRoute(screen.route) ||
      !Array.isArray(screen.controls) ||
      !Array.isArray(screen.links) ||
      !Array.isArray(screen.columns) ||
      !Array.isArray(screen.headings)
    )
      throw new Error("Invalid screen contract.");
    for (const key of ["id", "state", "capturedAt"])
      if (typeof screen[key] !== "string" || screen[key].length > 1000)
        throw new Error("Invalid screen metadata.");
    for (const list of [screen.headings, screen.columns])
      if (list.some((v) => typeof v !== "string" || v.length > 1000))
        throw new Error("Invalid screen labels.");
    if (
      screen.controls.length > 1000 ||
      screen.controls.some(
        (c) =>
          !c ||
          (c.id !== undefined && (typeof c.id !== 'string' || !/^c\d{1,4}$/.test(c.id))) ||
          typeof c.label !== "string" ||
          c.label.length > 1000 ||
          typeof c.tag !== "string" ||
          typeof c.role !== "string" ||
          typeof c.type !== "string" ||
          typeof c.disabled !== "boolean" ||
          typeof c.required !== "boolean" ||
          (c.recordTemplate !== undefined && typeof c.recordTemplate !== 'boolean') ||
          (c.value!==undefined&&(typeof c.value!=='string'||c.value.length>100000)) ||
          (c.checked!==undefined&&typeof c.checked!=='boolean') ||
          (c.readOnly!==undefined&&typeof c.readOnly!=='boolean') ||
          (c.selectedValues!==undefined&&(!Array.isArray(c.selectedValues)||c.selectedValues.length>1000||c.selectedValues.some(item=>typeof item!=='string'||item.length>10000))) ||
          !Array.isArray(c.options) ||
          c.options.length > 1000 ||
          c.options.some((o) => typeof o !== "string" || o.length > 1000),
      )
    )
      throw new Error("Invalid captured controls.");
    currentControlIds = new Set(screen.controls.flatMap(c => c.id === undefined ? [] : [c.id]));
    if(currentControlIds.size !== screen.controls.filter(c=>c.id!==undefined).length)throw new Error('Duplicate captured control identifiers.');
    visit(screen.tree);
  }
  if(value.transitions !== undefined) {
    const ids=new Set(value.screens.map(s=>s.id));
    if(!Array.isArray(value.transitions)||value.transitions.length>2000)throw new Error('Invalid workflow transitions.');
    for(const edge of value.transitions) {
      if(!ids.has(edge.from)||!ids.has(edge.to)||!edge.action||!['click','escape','navigate'].includes(edge.action.kind)||typeof edge.action.label!=='string'||edge.action.label.length>300|| (edge.action.controlId !== undefined && !value.screens.find(s=>s.id===edge.from)?.controls.some(c=>c.id===edge.action.controlId)))throw new Error('Invalid workflow transition.');
    }
  }
  if(value.workflowReport !== undefined && (!Array.isArray(value.workflowReport)||value.workflowReport.length>2000||value.workflowReport.some(item=>!safeRoute(item.route)||typeof item.action!=='string'||item.action.length>300||!['captured','skipped','failed'].includes(item.status)||(item.reason!==undefined&&(typeof item.reason!=='string'||item.reason.length>1000)))))throw new Error('Invalid workflow report.');
  const discovery = value.coverage?.discovery;
  if (discovery !== undefined) {
    if (!discovery || typeof discovery.startedAt !== 'string' || typeof discovery.finishedAt !== 'string' || typeof discovery.stopped !== 'boolean' || !Number.isInteger(discovery.limit) || discovery.limit < 1 || discovery.limit > 300 || !Array.isArray(discovery.attempts) || discovery.attempts.length > 300 || !Array.isArray(discovery.pending) || discovery.pending.length > 1500)
      throw new Error('Invalid route discovery report.');
    for (const attempt of discovery.attempts) {
      // Older runs followed legacy record links and setup-account. Preserve that
      // dated evidence even though new traversal deliberately excludes them.
      const historical = !discovery.strategy && safeRoute(attempt.route) && (/^#\/(?:employee\/[^/]+\/view\/id\/|facilities\/)/.test(attempt.route)||attempt.route==='#/login/setup-account');
      if (!(isInterfaceTraversalRoute(attempt.route)||isInterfaceChartRoute(attempt.route)||historical) || !['captured','redirected','failed'].includes(attempt.status) || (attempt.actualRoute !== undefined && !safeRoute(attempt.actualRoute)) || (attempt.error !== undefined && (typeof attempt.error !== 'string' || attempt.error.length > 1000)) || (attempt.durationMs!==undefined&&(!Number.isFinite(attempt.durationMs)||attempt.durationMs<0)) || (attempt.navigation!==undefined&&!['initial','dom','hash'].includes(attempt.navigation))) throw new Error('Invalid route discovery attempt.');
    }
    if (discovery.pending.some(route => !(isInterfaceChartRoute(route)||(discovery.strategy?isInterfaceTraversalRoute(route):isRecordedNavigationRoute(route))))) throw new Error('Invalid pending discovery routes.');
  }
  value.coverage = createInterfaceCapture(
    value.sourceOrigin,
    value.screens,
  ).coverage;
  if (discovery) value.coverage.discovery = discovery;
  return value;
}
export function compareScreen(expected, actual) {
  const changes = [];
  const stableLabel=label=>label?.replace(/^\d{1,2}:\d{2}\s*•\s*(MST|PST|PDT)\b/,'<clock> • $1');
  const visuals=node=>node?[node.visual??null,...node.children.flatMap(visuals)]:[];
  if(JSON.stringify(visuals(expected.tree))!==JSON.stringify(visuals(actual.tree)))changes.push({kind:'visual-detail',message:'Icon, pseudo-element, image or SVG evidence changed.'});
  for (const key of ["headings", "columns"])
    if (JSON.stringify(expected[key]) !== JSON.stringify(actual[key]))
      changes.push({ kind: key, before: expected[key], after: actual[key] });
  const signature = (c) => `${c.role || c.tag}:${stableLabel(c.label)}:${c.type}`;
  const indexed = (controls) => {
    const seen = new Map();
    return new Map(
      controls.map((c) => {
        const name = signature(c);
        const index = seen.get(name) || 0;
        seen.set(name, index + 1);
        return [name + ":" + index, c];
      }),
    );
  };
  const before = indexed(expected.controls);
  const after = indexed(actual.controls);
  const structure = control => ({...control,label:stableLabel(control.label),id:undefined,value:undefined,checked:undefined,selectedValues:undefined});
  const answer = control => ({value:control.value,checked:control.checked,selectedValues:control.selectedValues});
  for (const [key, c] of before) {
    if (!after.has(key))
      changes.push({ kind: "removed-control", label: c.label });
    else if (JSON.stringify(structure(c)) !== JSON.stringify(structure(after.get(key))))
      changes.push({
        kind: "changed-control",
        label: c.label,
        before: c,
        after: after.get(key),
      });
    else if(JSON.stringify(answer(c))!==JSON.stringify(answer(after.get(key))))changes.push({kind:'control-value',label:c.label,before:answer(c),after:answer(after.get(key))});
  }
  for (const [key, c] of after)
    if (!before.has(key))
      changes.push({ kind: "added-control", label: c.label });
  const nodes = (root) => {
    const result = [];
    const walk = (node, path) => {
      if (!node) return;
      result.push({
        path,
        tag: node.tag,
        label: stableLabel(node.label),
        text: node.tag==='time'&&/^\d{1,2}:\d{2}$/.test(node.text)?'<clock>':node.text,
        value:node.value,
        styles: node.styles,
      });
      node.children.forEach((child, index) => walk(child, path + "/" + index));
    };
    walk(root, "body");
    return result;
  };
  const oldNodes = nodes(expected.tree),
    newNodes = nodes(actual.tree);
  const changedNodes = [];
  const changedContent=[];
  for (let i = 0; i < Math.max(oldNodes.length, newNodes.length); i++)
    if (JSON.stringify(oldNodes[i]&&{...oldNodes[i],text:undefined,value:undefined}) !== JSON.stringify(newNodes[i]&&{...newNodes[i],text:undefined,value:undefined}))
      changedNodes.push({ before: oldNodes[i], after: newNodes[i] });
    else if(oldNodes[i]?.text!==newNodes[i]?.text||oldNodes[i]?.value!==newNodes[i]?.value)changedContent.push({before:oldNodes[i],after:newNodes[i]});
  if (changedNodes.length)
    changes.push({
      kind: "layout-style",
      changedNodes: changedNodes.length,
      sample: changedNodes.slice(0, 5),
    });
  if(changedContent.length)changes.push({kind:'displayed-content',changedNodes:changedContent.length,sample:changedContent.slice(0,5)});
  if (expected.truncated !== actual.truncated)
    changes.push({
      kind: "capture-limit",
      before: expected.truncated,
      after: actual.truncated,
    });
  if (JSON.stringify(expected.viewport) !== JSON.stringify(actual.viewport)) changes.push({kind:'viewport',before:expected.viewport,after:actual.viewport});
  if (JSON.stringify(expected.assets) !== JSON.stringify(actual.assets))
    changes.push({
      kind: "assets",
      before: expected.assets,
      after: actual.assets,
    });
  return changes;
}
/** Compare both directions; uncovered states remain visible instead of passing. */
export function compareCaptures(baseline, current) {
  validateInterfaceCapture(baseline);
  validateInterfaceCapture(current);
  const key = (s) => `${s.route}\n${s.state}`;
  const before = new Map(baseline.screens.map((s) => [key(s), s]));
  const after = new Map(current.screens.map((s) => [key(s), s]));
  return [...new Set([...before.keys(), ...after.keys()])].map((k) => ({
    route: (before.get(k) || after.get(k)).route,
    state: (before.get(k) || after.get(k)).state,
    coverage: !before.has(k)
      ? "new-state"
      : !after.has(k)
        ? "not-recaptured"
        : "compared",
    changes:
      before.has(k) && after.has(k)
        ? compareScreen(before.get(k), after.get(k))
        : [],
  }));
}
/** Validate a passive bridge's type tree without turning numeric types into strings. */
export function sanitizeResponseShape(value, depth = 0) {
  if (depth > 8) return "depth-limit";
  if (typeof value === "string")
    return [
      "string",
      "number",
      "boolean",
      "undefined",
      "null",
      "depth-limit",
    ].includes(value)
      ? value
      : "string";
  if (Array.isArray(value))
    return value.slice(0, 3).map((v) => sanitizeResponseShape(v, depth + 1));
  if (
    value &&
    typeof value === "object" &&
    value.type === "array" &&
    Array.isArray(value.samples)
  )
    return {
      type: "array",
      samples: value.samples
        .slice(0, 3)
        .map((v) => sanitizeResponseShape(v, depth + 1)),
    };
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .filter(
          ([key]) =>
            !/(?:password|token|cookie|secret|authorization)/i.test(key),
        )
        .map(([key, v]) => [key, sanitizeResponseShape(v, depth + 1)]),
    );
  return typeof value;
}

/** Remove record-like path segments without exporting query values. */
export function safeRequestPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 500)
    return null;
  return value
    .split(/[?#]/)[0]
    .replace(
      /\/(?:[0-9]+|[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{24})(?=\/|$)/gi,
      "/{id}",
    );
}
