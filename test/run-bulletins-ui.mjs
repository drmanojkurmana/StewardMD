/* Clinical Bulletins: real headless-Chromium test of the disease-reader card and the Review Desk signing tab.
 *
 * Serves the repo root in-process and mocks /api/updates/bulletins/* (every other /api call gets a fast 404),
 * then drives the real app over the DevTools protocol. Checks the rules in
 * docs/CLINICAL_AUTO_UPDATE_ENGINEERING_SPEC.md section 10.2.
 *
 *   node test/run-bulletins-ui.mjs            (CHROME=/path/to/chrome to override the browser)
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = 9061, DEBUG = 9461;
const SHOTS = join(tmpdir(), "stewardmd-bulletins");
const CHROME = process.env.CHROME || ["/opt/pw-browsers/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => existsSync(p));
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };

const DAY = 86400000, NOW = Date.now();
const DIS = "ACUTE_BRONCHITIS", DIS2 = "AMOEBIC_LIVER_ABSCESS", DIS3 = "ASPIRATION_PNEUMONIA", NONE = "zoon_balanitis";
function bl(id, over) {
  return Object.assign({
    id, kind: "approval", headline: "Headline " + id, what_changed: "What changed for " + id + ", in the reviewer's own words.",
    applies_to: "Adults", evidence_type: "regulatory_approval", evidence_note: "", regulator: "FDA", india_status: "cdsco_approved",
    source_label: "Source " + id, source_url: "https://example.org/" + id, source_date: "2026-09-01", doi: "", pmid: "",
    signed_name: "Manoj Kurmana", signed_reg: "APMC-1", signed_council: "Andhra Pradesh Medical Council", signed_ts: NOW - DAY,
    review_due_ts: NOW + 300 * DAY, updated_ts: NOW - DAY, disease_ids: [DIS],
  }, over || {});
}
const ITEMS = [
  bl("b-old", { source_date: "2026-01-10" }),
  bl("b-new", { source_date: "2026-09-10", india_status: "not_approved_india" }),
  bl("b-safety", { kind: "safety", evidence_type: "regulatory_safety", source_date: "2025-05-01", headline: "Boxed warning for liver injury" }),
  bl("b-mid", { source_date: "2026-05-05" }),
  bl("b-due", { source_date: "2026-09-20", review_due_ts: NOW - DAY }),
  bl("b-other", { disease_ids: [DIS2] }),
  bl("b-js", { disease_ids: [DIS3], source_url: "javascript:alert(1)" }),
  bl("b-unknown", { disease_ids: ["NOT_IN_THE_LIBRARY"] }),
];

// ---- mock state the test flips between steps ----
const st = { queueHits: 0, queueFail: false, saves: 0, skipBodies: [], killBodies: [], signerBodies: [], mode: "items", hits: 0, lastInm: "", lastHost: "", me: { canSign: false, isOwner: false }, signBodies: [], signResp: { status: 409, body: { error: "changed" } } };
const QUEUE_ITEM = Object.assign(bl("b-draft", { source_date: "2026-09-02" }), {
  update_id: "u1", review_months: 12, state: "draft", body_hash: "a".repeat(64), status: "draft", orphaned: [],
  signed_name: "", signed_reg: "", signed_council: "", signed_ts: 0, review_due_ts: 0, u_title: "Source item title", u_org: "FDA", u_url: "https://example.org/u1", u_published_ts: NOW - 5 * DAY, u_summary: "AI summary text",
});

function sendJson(res, status, obj, extra) {
  res.writeHead(status, Object.assign({ "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Expose-Headers": "ETag" }, extra || {}));
  res.end(obj == null ? "" : JSON.stringify(obj));
}
function readBody(req) { return new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch (e) { r({}); } }); }); }

const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  if (req.method === "OPTIONS") return sendJson(res, 204, null);
  if (p === "/api/updates/bulletins" && req.method === "GET") {
    st.hits++; st.lastInm = req.headers["if-none-match"] || ""; st.lastHost = req.headers.host || "";
    if (st.mode === "killed") return sendJson(res, 200, { enabled: false, items: [] });
    if (st.mode === "error") return sendJson(res, 500, { error: "x" });
    const etag = '"etag-' + st.mode + '"';
    if (st.lastInm === etag) return sendJson(res, 304, null, { ETag: etag });
    return sendJson(res, 200, { enabled: true, v: 1, items: ITEMS }, { ETag: etag, "Cache-Control": "public, max-age=300" });
  }
  if (p === "/api/updates/bulletins/me") return sendJson(res, 200, st.me);
  if (p === "/api/updates/bulletins/queue" && (st.queueHits++, st.queueFail)) return sendJson(res, 500, { error: "boom" });
  if (p === "/api/updates/bulletins/queue") return sendJson(res, 200, { ok: true, killed: false, items: [QUEUE_ITEM], candidates: [{ id: "u2", type: "safety_alert", title: "Candidate source", organization: "U.S. Food and Drug Administration", official_url: "http://example.org/u2", doi: "10.1056/NEJMoa2605659", pmid: "42748429", published_ts: NOW - DAY,
    summary: "In adults with Acute Bronchitis the drug cut symptom days (HR 0.72; 95% CI 0.61-0.85), 12.5% vs 17.3%, at 10 mg daily for 12 weeks. A second sentence that is long enough to push the draft beyond the four hundred character limit so that the cut lands on a full stop rather than the middle of a word, which keeps the draft readable for the doctor who must rewrite it anyway before signing it for the disease page." }] });
  if (p === "/api/updates/bulletins/skip" && req.method === "POST") { const b = await readBody(req); st.skipBodies.push(b); return sendJson(res, 200, { ok: true, update_id: b.update_id, skipped: !b.undo }); }
  if (p === "/api/updates/bulletins" && req.method === "POST") { st.saves++; const b = await readBody(req); return sendJson(res, 200, { ok: true, item: Object.assign({}, QUEUE_ITEM, b, { body_hash: "b".repeat(64), state: "draft" }) }); }
  if (p === "/api/updates/bulletins/signers" && req.method === "GET") return sendJson(res, 200, { ok: true, signers: [{ uid: "u-owner", name: "Manoj Kurmana", reg_no: "APMC-1", council: "Andhra Pradesh Medical Council", active: 1 }] });
  if (p === "/api/updates/bulletins/signers" && req.method === "POST") { st.signerBodies.push(await readBody(req)); return sendJson(res, 200, { ok: true }); }
  if (p === "/api/updates/bulletins/kill") { st.killBodies.push(await readBody(req)); return sendJson(res, 200, { ok: true, killed: true }); }
  if (/^\/api\/updates\/bulletins\/[^/]+\/sign$/.test(p)) { st.signBodies.push(await readBody(req)); return sendJson(res, st.signResp.status, st.signResp.body); }
  if (p === "/api/updates/bulletins/cdsco") {
    const q = new URL(req.url, "http://x").searchParams.get("q") || "";
    const checked = [{ year: 2026, title: "List 2026", fetched_ts: NOW }, { year: 2020, title: "List 2020", fetched_ts: NOW - DAY }];
    return sendJson(res, 200, { ok: true, q, checked, matches: /rimegepant/i.test(q) ? [{ list: "List of New Drugs approved in year 2025", year: 2025, date: "2025-03-27", excerpt: "...7. Rimegepant Oral disintegrating tablets (ODT) 75 mg For Acute treatment of migraine..." }] : [] });
  }
  if (p === "/api/updates" && req.method === "GET") return sendJson(res, 200, { enabled: true, nextCursor: null, items: [
    { id: "u9", type: "drug_approval", category: "approval", title: "Signed source item", summary: "AI summary.", ts: NOW - DAY, signed_bulletin: true, workspace: "internal_medicine" },
    { id: "u8", type: "trial", category: "study", title: "Unsigned source item", summary: "AI summary.", ts: NOW - 2 * DAY, signed_bulletin: false, workspace: "internal_medicine" }] });
  if (p.startsWith("/api/")) return sendJson(res, 404, { error: "not-mocked" });
  let file = normalize(join(ROOT, p === "/" ? "index.html" : p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try { const data = await readFile(file); res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" }); res.end(data); }
  catch (e) { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(PORT, r));

const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=" + DEBUG, "--user-data-dir=" + join(tmpdir(), "bulletins-chrome-" + process.pid), "--no-first-run", ...(process.env.CHROME_FLAGS || "").split(/\s+/).filter(Boolean), "about:blank"], { stdio: "ignore" });

let ws, sid, seq = 0, failures = 0;
const pending = new Map();
const call = (method, params = {}) => new Promise((resolve) => { const n = ++seq; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params, sessionId: sid })); });
async function ev(expression) {
  const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result && r.result.result ? r.result.result.value : undefined;
}
const ok = (pass, label, detail) => { console.log((pass ? "PASS " : "FAIL ") + label + (pass || detail == null ? "" : "  " + JSON.stringify(detail))); if (!pass) failures++; };
async function waitFor(fn, ms = 5000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(50); } return false; }
const noSideScroll = `(function(){var b=document.querySelector('#smdReview .kit-sheet-body');return !!b&&b.scrollWidth<=b.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth})()`;
// Design audit of the signing desk (WCAG 2.2 AA): text contrast against the real painted background (4.5:1, or 3:1
// for large text), and tap targets of at least 44 x 44 px for every control a doctor taps. Disabled controls and
// icon glyphs are exempt. Returns the offenders so a failure names them.
const AUDIT = `(function(){
  var root=document.querySelector('#smdReview .kit-sheet-body');
  function parse(c){var m=/rgba?\\(([^)]+)\\)/.exec(c);if(m){var p=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);return [p[0],p[1],p[2],p.length>3?p[3]:1]}
    m=/color\\(srgb ([^)]+)\\)/.exec(c);if(m){var q=m[1].split(/[ \\/]+/).filter(Boolean).map(Number);return [q[0]*255,q[1]*255,q[2]*255,q.length>3?q[3]:1]}return null}
  function lum(c){var a=[c[0],c[1],c[2]].map(function(v){v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2]}
  function over(t,b){var a=t[3];return [t[0]*a+b[0]*(1-a),t[1]*a+b[1]*(1-a),t[2]*a+b[2]*(1-a),1]}
  function bg(el){var st=[];for(var n=el;n;n=n.parentElement){var c=parse(getComputedStyle(n).backgroundColor);if(c&&c[3]>0){st.push(c);if(c[3]>=1)break}}var b=[255,255,255,1];for(var i=st.length-1;i>=0;i--)b=over(st[i],b);return b}
  function shown(el){var r=el.getBoundingClientRect(),cs=getComputedStyle(el);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&!el.closest('details:not([open]) > :not(summary)')}
  var low=[],small=[];
  root.querySelectorAll('*').forEach(function(el){
    if(!shown(el)||el.closest('.material-symbols-outlined,[disabled],[aria-disabled=true],.bl-preview'))return;
    var txt=Array.from(el.childNodes).filter(function(n){return n.nodeType===3&&n.textContent.trim()}).map(function(n){return n.textContent.trim()}).join(' ');
    if(!txt)return;
    var cs=getComputedStyle(el),fg=parse(cs.color),b=bg(el);if(!fg)return;fg=over(fg,b);
    var L1=lum(fg),L2=lum(b),r=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05),px=parseFloat(cs.fontSize),w=parseInt(cs.fontWeight,10);
    var need=(px>=24||(px>=18.66&&w>=700))?3:4.5;
    if(r<need)low.push(txt.slice(0,40)+' ['+(el.className||el.tagName)+'] '+r.toFixed(2));
  });
  root.querySelectorAll('input[placeholder],textarea[placeholder]').forEach(function(el){
    if(!shown(el)||el.disabled||el.value)return;var fg=parse(getComputedStyle(el,'::placeholder').color),b=bg(el);if(!fg)return;fg=over(fg,b);
    var L1=lum(fg),L2=lum(b),r=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);if(r<4.5)low.push('placeholder '+el.id+' '+r.toFixed(2));
  });
  root.querySelectorAll('button,a[href],summary,input,textarea,select').forEach(function(el){
    if(!shown(el)||el.disabled||el.closest('.bl-preview'))return;
    var t=el.type==='checkbox'?el.closest('label'):el;var r=t.getBoundingClientRect();
    if(r.height<43.5||r.width<43.5)small.push((el.getAttribute('data-bl-act')||el.id||el.textContent.trim().slice(0,24))+' '+Math.round(r.width)+'x'+Math.round(r.height));
  });
  return {low:low,small:small};
})()`;
async function audit(label) {
  const r = await ev(AUDIT);
  ok(r && !r.low.length, "design audit, " + label + ": text contrast meets WCAG AA", r && r.low);
  ok(r && !r.small.length, "design audit, " + label + ": every tap target is at least 44 x 44 px", r && r.small);
}
async function until(expr, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(150); } return false; }
async function shot(name) { await mkdir(SHOTS, { recursive: true }); const r = await call("Page.captureScreenshot", { format: "png" }); await writeFile(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); }
async function load(query) {
  await call("Page.navigate", { url: "http://localhost:" + PORT + "/" + (query || "") });
  await until("document.readyState==='complete'");
  const ready = await until("!!(window.DX&&DX.openRef&&window.SMD_BULLETINS&&window.SMD_REVIEW&&window.KB_ENRICHMENT&&Object.keys(KB_ENRICHMENT.byId||{}).length>4000)", 40000);
  await ev("['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(function(k){var e=document.getElementById(k);if(e)e.remove();});true");
  return ready;
}
const openDisease = (id) => ev(`(function(){DX.openRef(${JSON.stringify(id)},{standalone:true});return true;})()`);
const cardsIn = `Array.from(document.querySelectorAll('#dxMgmt .smd-bls .smd-bl'))`;

try {
  let version;
  for (let i = 0; i < 80; i++) { try { version = await (await fetch("http://localhost:" + DEBUG + "/json/version")).json(); break; } catch (e) { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const created = await call("Target.createTarget", { url: "about:blank" });
  sid = (await call("Target.attachToTarget", { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call("Page.enable"); await call("Network.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  /* 1. opted out on this device (localStorage "0", or ?bulletins=0): no request, no card */
  ok(await load("?bulletins=0"), "app and KB load");
  await ev("try{localStorage.setItem('smd_kb_bulletins','0');localStorage.removeItem('smd_kb_bulletins_v1')}catch(e){};true");
  await load("");
  await sleep(800);
  ok(st.hits === 0, "opted out: no request to /api/updates/bulletins", st.hits);
  await openDisease(DIS); await sleep(300);
  ok(await ev(`!document.querySelector('#dxMgmt .smd-bl')`), "opted out: no card on the disease page");
  await ev("try{localStorage.removeItem('smd_kb_bulletins')}catch(e){};true");
  await load("?bulletins=0");
  await sleep(800);
  ok(st.hits === 0, "?bulletins=0 forces off even without the stored opt-out", st.hits);

  /* 2. default ON: no parameter, no stored setting -> sync, then the card */
  await load("");
  ok(await ev("SMD_BULLETINS.flagOn()===true"), "on by default");
  ok(await until("!!(SMD_BULLETINS._readCache()&&SMD_BULLETINS._readCache().items.length)"), "default on: syncs on launch and stores the copy");
  ok(st.hits >= 1, "flag on: one request made", st.hits);
  await openDisease(DIS); await sleep(300);
  const shown = await ev(`${cardsIn}.map(function(c){return c.querySelector('.smd-bl-h').textContent})`);
  ok(Array.isArray(shown) && shown.length === 3, "at most three cards", shown);
  ok(shown && shown[0] === "Boxed warning for liver injury", "safety alert sorts first", shown);
  ok(shown && shown[1] === "Headline b-new" && shown[2] === "Headline b-mid", "then newest source first", shown);
  ok(shown && shown.indexOf("Headline b-due") < 0, "a bulletin past its review date is not shown");
  ok(await ev(`(function(){var g=document.querySelector('#dxMgmt .smd-bls'),a=document.querySelector('#dxMgmt .dx-reader-glance');return !!(g&&a&&(g.compareDocumentPosition(a)&Node.DOCUMENT_POSITION_FOLLOWING))})()`), "cards sit above At a glance (and its Management)");
  ok(await ev(`(function(){var w=document.querySelector('#dxMgmt .smd-bl-in.warn');return !!w&&w.textContent.indexOf('Not yet approved in India')>=0&&getComputedStyle(w).color==='rgb(180, 83, 9)'})()`), "India caution line is amber");
  ok(await ev(`${cardsIn}.every(function(c){return c.querySelector('.smd-bl-foot').textContent==='Check your local protocol before acting.'})`), "every card ends with the local-protocol line");
  ok(await ev(`${cardsIn}.every(function(c){return /Reviewed by Dr Manoj Kurmana, Reg\\. No\\. APMC-1, Andhra Pradesh Medical Council, on \\d+ \\w{3} \\d{4}\\. Review due \\w{3} \\d{4}\\./.test(c.querySelector('.smd-bl-sig').textContent)})`), "signature line names the doctor, registration, council and dates");
  ok(await ev(`document.querySelector('#dxMgmt .smd-bls').textContent.indexOf('\\u2014')<0`), "no em-dash in the card text");
  ok(await ev(`${cardsIn}.every(function(c){return c.getAttribute('role')!=='alert'&&c.getAttribute('aria-label')==='Practice update'})`), "cards are labelled sections, not alerts");
  ok(await ev(`(function(){var c=SMD_BULLETINS.card({kind:'trial',headline:'H',what_changed:'W',india_status:'unknown',source_label:'NEJM',source_url:'https://www.nejm.org/x',source_date:'2026-09-01',doi:'10.1056/NEJMoa1',pmid:'123',signed_name:'A',signed_reg:'1',signed_ts:1,review_due_ts:2});var d=document.createElement('div');d.innerHTML=c;var hs=Array.from(d.querySelectorAll('a')).map(function(a){return a.getAttribute('href')});return hs.join('|')==='https://www.nejm.org/x|https://doi.org/10.1056/NEJMoa1|https://pubmed.ncbi.nlm.nih.gov/123/'})()`), "the card links the source, its DOI and PubMed");
  for (const width of [320, 390, 768]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 700 });
    await sleep(150);
    const fit = await ev(`(function(){var cs=${cardsIn};return cs.every(function(c){var r=c.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+0.5&&c.scrollWidth<=c.clientWidth+1})&&document.documentElement.scrollWidth<=innerWidth})()`);
    ok(fit, "cards fit without horizontal overflow at " + width + "px");
    if (width === 390) await shot("reader-cards-390");
  }
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  await openDisease(NONE); await sleep(300);
  ok(await ev(`!document.querySelector('#dxMgmt .smd-bls')&&!document.querySelector('#dxMgmt .smd-bl-stale')&&!/no (new )?(practice )?updates/i.test(document.querySelector('#dxMgmt').textContent)`), "a disease without bulletins shows nothing, never 'no updates'");
  await openDisease(DIS3); await sleep(300);
  ok(await ev(`(function(){var c=document.querySelector('#dxMgmt .smd-bl');return !!c&&!c.querySelector('a')&&c.textContent.indexOf('Source b-js')>=0})()`), "a javascript: source renders as text, never a link");
  await openDisease(DIS2); await sleep(300);
  ok(await ev(`${cardsIn}.length===1`), "each disease gets only its own bulletins");
  ok(await ev(`SMD_BULLETINS._readCache().items.some(function(b){return b.disease_ids.indexOf('NOT_IN_THE_LIBRARY')>=0})&&SMD_BULLETINS._select(SMD_BULLETINS._readCache().items,'NOT_IN_THE_LIBRARY',Date.now()).length===0`), "an id the library does not know is ignored");

  /* 3. ETag: the next forced sync sends If-None-Match and accepts 304 */
  await ev("SMD_BULLETINS.sync(true)");
  ok(st.lastInm === '"etag-items"', "second sync sends If-None-Match", st.lastInm);
  ok(await ev("SMD_BULLETINS._readCache().items.length===" + ITEMS.length), "304 keeps the stored copy");

  /* 4. offline with a fresh copy: cards still render */
  await call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const hitsBefore = st.hits;
  await openDisease(DIS); await sleep(300);
  ok(await ev(`${cardsIn}.length===3`), "offline with a fresh copy: cards render");
  /* 5. copy older than 7 days: no cards, a notice instead */
  await ev("(function(){var c=SMD_BULLETINS._readCache();c.fetchedAt=Date.now()-8*86400000;localStorage.setItem('smd_kb_bulletins_v1',JSON.stringify(c));return true})()");
  await openDisease(DIS); await sleep(300);
  ok(await ev(`!document.querySelector('#dxMgmt .smd-bl')&&/Practice updates not shown: last synced \\d+ \\w{3} \\d{4}\\. Connect to refresh\\./.test((document.querySelector('#dxMgmt .smd-bl-stale')||{}).textContent||'')`), "stale copy: no cards, 'last synced' notice");
  ok(st.hits === hitsBefore, "offline: no request attempted", st.hits - hitsBefore);
  await shot("reader-stale-390");
  await call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  /* 6. server error keeps the (stale) copy rather than inventing an empty one */
  st.mode = "error";
  await ev("SMD_BULLETINS.sync(true)");
  ok(await ev("SMD_BULLETINS._readCache().items.length===" + ITEMS.length), "a failed sync keeps the stored copy");

  /* 7. kill switch: the copy is dropped and nothing shows */
  st.mode = "killed";
  await ev("SMD_BULLETINS.sync(true)");
  await openDisease(DIS); await sleep(300);
  ok(await ev("(function(){var c=SMD_BULLETINS._readCache();return c.enabled===false&&c.items.length===0})()"), "kill switch: stored copy cleared");
  ok(await ev(`!document.querySelector('#dxMgmt .smd-bl')&&!document.querySelector('#dxMgmt .smd-bl-stale')`), "kill switch: no cards, no notice");

  /* 8. native base URL is honoured */
  st.mode = "items";
  await ev(`window.SMD_API_BASE='http://127.0.0.1:${PORT}';SMD_BULLETINS.sync(true)`);
  ok(st.lastHost === "127.0.0.1:" + PORT, "sync uses SMD_API_BASE", st.lastHost);
  await ev("window.SMD_API_BASE='';true");

  /* 9. Review Desk: tab only for signers and owners */
  await ev("try{DX.close&&DX.close()}catch(e){};SMD_REVIEW.open();true");
  await sleep(600);
  ok(await ev(`!!document.querySelector('#smdReview.on')&&!document.querySelector('#smdReview [data-rv-act="kind:bulletin"]')`), "Review Desk: no Clinical updates tab for a non-signer");
  await ev("SMD_REVIEW.close();true");
  st.me = { canSign: true, isOwner: true, killed: false, pending: { candidates: 1, drafts: 1, source_changed: 0, review_due: 0, total: 2 }, signer: { name: "Manoj Kurmana", regNo: "APMC-1", council: "Andhra Pradesh Medical Council" }, self: { uid: "u-owner", name: "Manoj Kurmana", reg_no: "APMC-1", council: "Andhra Pradesh Medical Council" } };
  await ev("SMD_REVIEW.open();true");
  ok(await until(`!!document.querySelector('#smdReview [data-rv-act="kind:bulletin"]')`), "Review Desk: tab appears for a signer");
  await ev(`document.querySelector('#smdReview [data-rv-act="kind:bulletin"]').click();true`);
  ok(await until(`!!document.querySelector('#smdReview [data-bl-act="edit:b-draft"]')&&!!document.querySelector('#smdReview [data-bl-act="new:u2"]')`), "queue lists the draft and the new source");
  ok(await ev(`!!document.querySelector('#smdReview [data-bl-act="filter:todo"][aria-pressed="true"]')&&/To do\\s*2/.test(document.querySelector('#smdReview [data-bl-act="filter:todo"]').textContent)`), "queue opens on To do, with its count");
  ok(await ev(`(function(){var c=document.querySelector('#smdReview [data-bl-act="new:u2"]').closest('.bl-q');return c.classList.contains('bl-k-safety')&&c.querySelector('.bl-type').textContent==='Safety alert'&&/U\\.S\\. Food and Drug Administration \u00b7 \\d+ \\w{3} \\d{4}/.test(c.querySelector('.bl-meta').textContent)&&!!c.querySelector('[data-bl-act="skip:u2"]')})()`), "a source card shows its type, who and when, with Write update and Skip");
  await ev(`document.querySelector('#smdReview [data-bl-act="new:u2"]').scrollIntoView({block:'center'});true`); await shot("desk-queue"); await audit("queue");
  await call("Emulation.setDeviceMetricsOverride", { width: 320, height: 700, deviceScaleFactor: 1, mobile: true }); await sleep(200);
  ok(await ev(noSideScroll), "queue fits 320px without sideways scrolling");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(150);
  await ev(`document.querySelector('#smdReview [data-bl-act="skip:u2"]').click();true`);
  ok(await until(`!document.querySelector('#smdReview [data-bl-act="new:u2"]')&&!!document.querySelector('#smdReview [data-bl-act="unskip:u2"]')`), "Skip takes the item off the queue at once and offers Undo");
  ok(await waitFor(() => st.skipBodies.length === 1) && st.skipBodies[0].update_id === "u2" && st.skipBodies[0].undo === false, "Skip posts the source item", st.skipBodies);
  await ev(`document.querySelector('#smdReview [data-bl-act="unskip:u2"]').click();true`);
  ok(await until(`!!document.querySelector('#smdReview [data-bl-act="new:u2"]')`), "Undo puts it back");
  ok(await waitFor(() => st.skipBodies.length === 2) && st.skipBodies[1].undo === true, "Undo posts undo:true", st.skipBodies);
  await ev(`document.querySelector('#smdReview [data-bl-act="filter:live"]').click();true`);
  ok(await until(`/Nothing is live yet/.test(document.querySelector('#smdReview').textContent)&&!document.querySelector('#smdReview [data-bl-act="edit:b-draft"]')`), "Live shows only what is on the disease page");
  await ev(`document.querySelector('#smdReview [data-bl-act="filter:todo"]').click();true`);
  await until(`!!document.querySelector('#smdReview [data-bl-act="edit:b-draft"]')`);
  st.queueFail = true; const qh = st.queueHits;
  await ev("SMD_BULLETINS_DESK._state.queue=null;SMD_REVIEW._render();true");
  ok(await until(`!!document.querySelector('#smdReview [data-bl-act="retry"]')&&/Could not load the queue/.test(document.querySelector('#smdReview .bl-banner.err').textContent)`), "a failed queue load says so and offers Try again");
  await sleep(1200);
  ok(st.queueHits - qh === 1, "a failed load is not retried in a loop", st.queueHits - qh);
  st.queueFail = false;
  await ev(`document.querySelector('#smdReview [data-bl-act="retry"]').click();true`);
  ok(await until(`!!document.querySelector('#smdReview [data-bl-act="edit:b-draft"]')`), "Try again loads the queue");
  await ev(`document.querySelector('#smdReview [data-bl-act="edit:b-draft"]').click();true`);
  ok(await until(`!!document.querySelector('#smdReview .bl-preview .smd-bl')`), "editor shows a live preview");
  ok(await ev(`['1','2','3'].map(function(n){return document.getElementById('bl_s'+n).textContent}).join('|')==='1Read the source|2Write it in your own words|3Classify'`), "editor runs in the order of the work: read, write, classify");
  ok(await ev(`!!document.querySelector('#smdReview [data-bl-act="set:kind:approval"][aria-pressed="true"]')&&!!document.querySelector('#smdReview [data-bl-act="set:india_status:cdsco_approved"][aria-pressed="true"]')&&!!document.querySelector('#smdReview [data-bl-act="set:review_months:12"][aria-pressed="true"]')&&!document.querySelector('#smdReview select')`), "saved choices show as pressed chips, no dropdowns");
  ok(await ev(`/Ready to sign/.test(document.getElementById('bl_bar_s').textContent)&&getComputedStyle(document.querySelector('#smdReview .bl-bar')).position==='sticky'`), "the bottom bar says a complete draft is ready");
  await shot("desk-editor-top"); await audit("editor");
  await call("Emulation.setDeviceMetricsOverride", { width: 320, height: 700, deviceScaleFactor: 1, mobile: true }); await sleep(200);
  ok(await ev(noSideScroll), "editor fits 320px without sideways scrolling");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(150);
  // same renderer as the bedside: identical structure for the same bulletin
  const struct = (sel) => `Array.from(document.querySelectorAll('${sel} *')).map(function(e){return e.tagName+'.'+e.className}).join('|')`;
  await ev(`(function(){var d=document.createElement('div');d.id='blCmp';d.innerHTML=SMD_BULLETINS.card(SMD_BULLETINS_DESK._previewOf(SMD_BULLETINS_DESK._state.cur));document.body.appendChild(d);return true})()`);
  ok(await ev(`${struct("#smdReview .bl-preview")}===${struct("#blCmp")}`), "preview is drawn by the bedside renderer");
  ok(await ev(`document.querySelector('#smdReview .bl-preview .smd-bl-sig').textContent.indexOf('Reviewed by Dr Manoj Kurmana, Reg. No. APMC-1')===0`), "preview carries the signer's registry identity");
  await ev(`document.querySelector('#smdReview [data-bl-act="savesign"]').click();true`);
  ok(await until(`!!document.querySelector('#smdReview [data-bl-act="signgo"]')`), "Save and sign opens the sign sheet");
  ok(await ev(`(function(){var b=document.querySelector('#smdReview [data-bl-act="signgo"]').cloneNode(true);Array.from(b.querySelectorAll('.material-symbols-outlined')).forEach(function(i){i.remove()});return /^Sign as Dr Manoj Kurmana, Reg\\. No\\. APMC-1$/.test(b.textContent.trim())})()`), "sign button names the signer");
  ok(await ev(`document.querySelector('#smdReview [data-bl-act="signgo"]').disabled===true`), "Sign stays locked while the checklist is empty");
  await ev(`document.querySelector('#smdReview [data-bl-act="signgo"]').click();true`); await sleep(300);
  ok(st.signBodies.length === 0 && await ev(`document.querySelector('#smdReview').textContent.indexOf('Tick every item before signing.')>=0`), "cannot sign with the checklist unticked");
  await ev(`Array.from(document.querySelectorAll('#smdReview .bl-ck input')).slice(0,3).forEach(function(c){c.click()});true`);
  ok(await ev(`document.querySelector('#smdReview [data-bl-act="signgo"]').disabled===true&&/3 of 4 done/.test(document.getElementById('bl_ck_s').textContent)`), "three of four ticked: still locked, and it says so");
  await ev(`document.querySelectorAll('#smdReview .bl-ck input')[3].click();true`); await sleep(250);   // buttons fade opacity over 90 ms
  ok(await ev(`document.querySelector('#smdReview [data-bl-act="signgo"]').disabled===false&&getComputedStyle(document.querySelector('#smdReview [data-bl-act="signgo"]')).opacity==='1'&&/All four confirmed/.test(document.getElementById('bl_ck_s').textContent)`), "all four ticked: Sign unlocks");
  await shot("desk-sign-sheet"); await audit("sign sheet");
  await ev(`document.querySelector('#smdReview [data-bl-act="signgo"]').click();true`);
  ok(await until(`document.querySelector('#smdReview').textContent.indexOf('The text changed. Review it again before signing.')>=0`), "a 409 sends the signer back to review the text");
  const sent = st.signBodies[0] || {};
  ok(sent.body_hash === "b".repeat(64) && ["source_read", "numbers_match", "india_checked", "own_words"].every((k) => sent.checklist && sent.checklist[k] === true), "sign request carries the previewed hash and the full checklist", sent);
  ok(await ev(`!!document.querySelector('#smdReview [data-bl-act="savesign"]')`), "after a 409 the editor is back");
  await shot("desk-after-409");

  /* 10. owner tools: signers list, Add me pre-fill, switch-off needs a reason */
  await ev(`document.querySelector('#smdReview [data-bl-act="back"]').click();true`);
  ok(await until(`!!document.querySelector('#smdReview [data-bl-act="signers"]')`), "owner sees the Signers and switch-off tools");
  await ev(`document.querySelector('#smdReview [data-bl-act="signers"]').click();true`);
  ok(await until(`document.querySelector('#smdReview').textContent.indexOf('Reg. No. APMC-1, Andhra Pradesh Medical Council')>=0`), "signers list renders");
  await ev(`document.querySelector('#smdReview [data-bl-act="addme"]').click();true`);
  ok(await until(`(document.getElementById('bl_sname')||{}).value==='Manoj Kurmana'&&document.getElementById('bl_sreg').value==='APMC-1'`), "Add me pre-fills name and registration for checking");
  await ev(`document.querySelector('#smdReview [data-bl-act="saveSigner"]').click();true`); await sleep(400);
  ok(st.signerBodies.length === 1 && st.signerBodies[0].uid === "u-owner" && st.signerBodies[0].reg_no === "APMC-1", "Save signer posts the checked values", st.signerBodies);
  await ev(`document.querySelector('#smdReview [data-bl-act="back"]').click();true`);
  await until(`!!document.querySelector('#smdReview [data-bl-act="kill"]')`);
  await ev(`document.querySelector('#smdReview [data-bl-act="kill"]').click();true`);
  ok(await until(`!!document.querySelector('#smdReview [data-bl-act="killgo"]')`), "switch-off screen renders");
  await ev(`document.getElementById('bl_kreason').value='short';document.querySelector('#smdReview [data-bl-act="killgo"]').click();true`); await sleep(300);
  ok(st.killBodies.length === 0, "switch-off refuses a reason under 10 characters");
  await ev(`document.getElementById('bl_kreason').value='Checking a reported wording error';document.querySelector('#smdReview [data-bl-act="killgo"]').click();true`); await sleep(500);
  ok(st.killBodies.length === 1 && st.killBodies[0].killed === true, "switch-off posts killed:true with the reason", st.killBodies);

  /* 11. Draft from source: suggestions only, India status left to the signer, numbers flagged */
  await until(`!!document.querySelector('#smdReview [data-bl-act="new:u2"]')`);
  await ev(`document.querySelector('#smdReview [data-bl-act="new:u2"]').click();true`);
  // links fill themselves in (http feed link upgraded to https) and can be opened to check the source
  ok(await until(`(document.getElementById('bl_source_url')||{}).value==='https://example.org/u2'`), "an http:// source link is filled in as https://");
  ok(await ev(`document.getElementById('bl_doi').value==='10.1056/NEJMoa2605659'&&document.getElementById('bl_pmid').value==='42748429'`), "DOI and PMID are filled in from the source");
  ok(await ev(`document.getElementById('bl_open_url').getAttribute('href')==='https://example.org/u2'&&document.getElementById('bl_open_doi').getAttribute('href')==='https://doi.org/10.1056/NEJMoa2605659'&&document.getElementById('bl_open_pmid').getAttribute('href')==='https://pubmed.ncbi.nlm.nih.gov/42748429/'`), "Open source / Open DOI / Open in PubMed are tappable links");
  await ev(`document.getElementById('bl_open_url').scrollIntoView({block:'center'});true`); await shot("desk-verify-links");
  ok(await ev(`['bl_open_url','bl_open_doi','bl_open_pmid'].every(function(id){var a=document.getElementById(id);return a.getAttribute('target')==='_blank'&&/noopener/.test(a.getAttribute('rel'))})`), "links open outside the app safely");
  await ev(`(function(){var d=document.getElementById('bl_doi');d.value='10.1001/jama.2026.12627';d.dispatchEvent(new Event('input',{bubbles:true}));var p=document.getElementById('bl_pmid');p.value='';p.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  ok(await ev(`document.getElementById('bl_open_doi').getAttribute('href')==='https://doi.org/10.1001/jama.2026.12627'&&!document.getElementById('bl_open_pmid').hasAttribute('href')&&document.getElementById('bl_open_pmid').getAttribute('aria-disabled')==='true'`), "links follow edits; an empty PMID disables its link");
  ok(await until(`!!document.querySelector('#smdReview [data-bl-act="draft"]')`), "a new bulletin offers Draft from source");
  ok(await ev(`document.getElementById('bl_what_changed').value===''`), "nothing is pre-written before the signer asks");
  ok(await ev(`/4 to fill in: What changed, Diseases, India status and 1 more/.test(document.getElementById('bl_bar_s').textContent)`), "the bottom bar names what is still missing", await ev(`document.getElementById('bl_bar_s').textContent`));
  const savesBefore = st.saves;
  await ev(`document.querySelector('#smdReview [data-bl-act="save"]').click();true`); await sleep(400);
  ok(st.saves === savesBefore && await ev(`document.activeElement&&document.activeElement.id==='bl_what_changed'&&document.getElementById('bl_what_changed').classList.contains('bl-flash')`), "Save with gaps sends nothing and takes the doctor to the first gap");
  await ev(`document.querySelector('#smdReview [data-bl-act="draft"]').click();true`);
  ok(await until(`document.getElementById('bl_what_changed').value.indexOf('Acute Bronchitis')>=0`), "Draft fills What changed from the source summary");
  ok(await ev(`(function(){var v=document.getElementById('bl_what_changed').value;return v.length<=400&&/\.$/.test(v)})()`), "draft is cut at a full stop within 400 characters");
  ok(await ev(`!!document.querySelector('#smdReview .bl-drafted')&&/own words/.test(document.querySelector('#smdReview .bl-drafted').textContent)`), "draft banner asks for the signer's own words");
  ok(await ev(`!document.querySelector('#smdReview [data-bl-act="draft"]')`), "Draft from source is offered once, so it never overwrites the rewrite");
  ok(await ev(`SMD_BULLETINS_DESK._state.cur.india_status===''&&!document.querySelector('#smdReview [data-bl-act^="set:india_status:"][aria-pressed="true"]')`), "India status is never pre-filled");
  ok(await ev(`SMD_BULLETINS_DESK._state.cur.evidence_type==='regulatory_safety'&&SMD_BULLETINS_DESK._state.cur.regulator==='FDA'&&!!document.querySelector('#smdReview [data-bl-act="set:evidence_type:regulatory_safety"][aria-pressed="true"]')&&!!document.querySelector('#smdReview [data-bl-act="set:regulator:FDA"][aria-pressed="true"]')`), "evidence type and regulator suggested from the source");
  const nums = await ev(`Array.from(document.querySelectorAll('#smdReview .bl-num')).map(function(n){return n.textContent})`);
  ok(Array.isArray(nums) && ["HR 0.72", "12.5%", "17.3%", "10 mg", "12 weeks"].every((n) => nums.indexOf(n) >= 0), "numbers to check are listed", nums);
  ok(await ev(`!!document.querySelector('#smdReview [data-bl-act="dz:ACUTE_BRONCHITIS"]')`), "a library disease named in the source is suggested");
  ok(await ev(`SMD_BULLETINS_DESK._state.cur.disease_ids.length===0`), "suggestions are not added until the signer taps them");
  await ev(`document.querySelector('#smdReview [data-bl-act="dz:ACUTE_BRONCHITIS"]').click();true`);
  ok(await until(`SMD_BULLETINS_DESK._state.cur.disease_ids.indexOf('ACUTE_BRONCHITIS')>=0&&document.getElementById('bl_what_changed').value.indexOf('Acute Bronchitis')>=0`), "tapping a suggestion adds it and keeps the typed text");
  // B / I / U: wraps the selected words, the preview shows the formatting, nothing else becomes markup
  await ev(`(function(){var t=document.getElementById('bl_what_changed');t.focus();var i=t.value.indexOf('Acute Bronchitis');t.setSelectionRange(i,i+'Acute Bronchitis'.length);t.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));return true})()`);
  await ev(`document.querySelector('#smdReview [data-bl-act="fmt:b"]').click();true`);
  ok(await until(`document.getElementById('bl_what_changed').value.indexOf('[b]Acute Bronchitis[/b]')>=0`), "Bold wraps the selected words");
  ok(await ev(`(function(){var b=document.querySelector('#smdReview .bl-preview .smd-bl-p b');return !!b&&b.textContent==='Acute Bronchitis'})()`), "the preview shows them in bold");
  await ev(`(function(){var h=document.getElementById('bl_headline');h.focus();h.value='Safe <img src=x onerror=alert(1)> title';h.setSelectionRange(0,4);h.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));return true})()`);
  await ev(`document.querySelector('#smdReview [data-bl-act="fmt:i"]').click();true`);
  ok(await until(`document.getElementById('bl_headline').value.indexOf('[i]Safe[/i]')===0`), "Italic works on the headline too");
  ok(await ev(`(function(){var h=document.querySelector('#smdReview .bl-preview .smd-bl-h');return !!h.querySelector('i')&&!h.querySelector('img')&&h.textContent.indexOf('<img')>=0})()`), "typed HTML stays text; only B/I/U become formatting");
  await ev(`(function(){var h=document.getElementById('bl_headline');h.value='Headline for the [b]draft[/b]';h.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  ok(await ev(`document.getElementById('bl_cnt_headline').textContent==='22 / 120'`), "the headline counter counts what the reader sees, not the B/I/U markers");
  ok(await ev(`document.querySelector('#smdReview .bl-preview .smd-bl-h').textContent==='Headline for the draft'`), "the preview follows typing without a re-render");
  await shot("desk-draft-from-source");
  await ev(`document.getElementById('bl_cq').value='rimegepant';document.querySelector('#smdReview [data-bl-act="cdsco"]').click();true`);
  ok(await until(`/Found in the CDSCO lists\./.test((document.querySelector('#smdReview .bl-cdsco.found')||{}).textContent||'')&&document.querySelector('#smdReview .bl-cdsco').textContent.indexOf('approved 2025-03-27')>=0`), "CDSCO check shows the matching entry and its approval date");
  ok(await ev(`SMD_BULLETINS_DESK._state.cur.india_status===''`), "a CDSCO match never sets India status by itself");
  await ev(`document.getElementById('bl_cq').value='camizestrant';document.querySelector('#smdReview [data-bl-act="cdsco"]').click();true`);
  ok(await until(`/Not found in the CDSCO new-drug lists for 2020 to 2026 .*does not prove it is unapproved/.test((document.querySelector('#smdReview .bl-cdsco')||{}).textContent||'')`), "a miss says which lists were checked and that absence proves nothing");
  // the bar points at the one gap left; tapping it goes there; one tap on a chip fills it
  ok(await ev(`/1 to fill in: India status/.test(document.getElementById('bl_bar_s').textContent)`), "only India status is left", await ev(`document.getElementById('bl_bar_s').textContent`));
  await ev(`document.querySelector('#smdReview [data-bl-act="jump"]').click();true`); await sleep(200);
  ok(await ev(`document.getElementById('bl_sec_india_status').classList.contains('bl-flash')&&document.activeElement&&document.activeElement.getAttribute('data-bl-act')==='set:india_status:cdsco_approved'`), "tapping the gap list jumps to India status");
  await shot("desk-editor-classify"); await audit("classify");
  await ev(`document.querySelector('#smdReview [data-bl-act="set:india_status:unknown"]').click();true`);
  ok(await until(`SMD_BULLETINS_DESK._state.cur.india_status==='unknown'&&document.querySelector('#smdReview [data-bl-act="set:india_status:unknown"]').getAttribute('aria-pressed')==='true'&&/Ready to sign/.test(document.getElementById('bl_bar_s').textContent)`), "one tap sets India status and the bar turns ready");
  ok(await ev(`document.getElementById('bl_what_changed').value.indexOf('[b]Acute Bronchitis[/b]')>=0&&document.getElementById('bl_headline').value==='Headline for the [b]draft[/b]'`), "a chip tap keeps everything typed");
  await ev(`(function(){var a=document.getElementById('bl_applies_to');a.value='Adults \u2014 over 65';a.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  ok(await ev(`!!document.querySelector('#bl_bar_s .bl-left.fix')&&/Fix: Applies to/.test(document.getElementById('bl_bar_s').textContent)`), "a wrong entry (an em-dash) is flagged as Fix, in red");
  await ev(`(function(){var a=document.getElementById('bl_applies_to');a.value='';a.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  ok(await ev(`/Ready to sign/.test(document.getElementById('bl_bar_s').textContent)`), "clearing it returns the bar to ready");
  await ev("document.body.classList.add('dark');true"); await sleep(150); await shot("desk-editor-dark"); await audit("editor, dark mode");
  ok(await ev(`(function(){var c=getComputedStyle(document.querySelector('#smdReview .bl-chip.on'));return c.color!==c.backgroundColor})()`), "dark mode: chips stay readable");
  await ev("document.body.classList.remove('dark');true");
  await ev("SMD_REVIEW.close();true");

  /* 12. bell feed: the signed-bulletin marker, worded so it never implies the AI text was reviewed */
  await ev("window.SMD_openUpdate&&SMD_openUpdate('u9');true");
  ok(await until(`!!document.querySelector('.fd-card[data-uid="u9"]')`), "bell feed renders");
  ok(await ev(`(function(){var s=document.querySelector('.fd-card[data-uid="u9"] .fd-signed');return !!s&&s.textContent==='Signed bulletin in Library'&&!document.querySelector('.fd-card[data-uid="u8"] .fd-signed')})()`), "only the item with a live bulletin carries the marker");

  /* 13. the Saturday review push: tapping it (cold start at /?rvtab=bulletins) opens the Clinical updates tab */
  await load("?rvtab=bulletins");
  ok(await until(`!!document.querySelector('#smdReview.on')&&(document.querySelector('#smdReview [data-rv-act="kind:bulletin"]')||{}).getAttribute&&document.querySelector('#smdReview [data-rv-act="kind:bulletin"]').getAttribute('aria-selected')==='true'`, 20000), "the review link opens the Review Desk on Clinical updates");
  ok(await ev(`document.querySelector('#smdReview [data-rv-act="kind:bulletin"]').textContent.trim()==='Clinical updates (2)'`), "the tab shows how many items wait");
  ok(await until(`/Waiting for you: 1 new source item, 1 draft\./.test(document.querySelector('#smdReview').textContent)`), "the queue says what is waiting");
  await sleep(2500);
  const top = await ev(`(function(){var e=document.elementFromPoint(innerWidth/2,innerHeight/2);var r=e&&e.closest('#smdReview');var o=[];for(var n=e;n&&n!==document.body&&o.length<6;n=n.parentElement)o.push((n.id?'#'+n.id:n.tagName)+'.'+String(n.className).split(' ')[0]+':z'+getComputedStyle(n).zIndex+':o'+getComputedStyle(n).opacity);return r?'ok':o.join(' < ')})()`);
  ok(top === "ok", "the Review Desk sheet is on top once the app has started", top);
  await shot("desk-from-review-push");
} catch (e) {
  console.error(e); failures++;
} finally {
  try { chrome.kill("SIGKILL"); } catch (e) {}
  server.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
