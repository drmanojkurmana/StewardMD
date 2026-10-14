/* PrepNucleus content editor (review-prepfix.js) in the Clinical review desk, in the real app.
 * Stubbed server: /api/prep/flag?top=1 (reports), /api/prep/fix (me, module fixes, save, revert, image upload).
 *  - a student-reports row shows Edit only for owners and signers;
 *  - the question form loads the real item; saving sends only what changed (plus any earlier fix), a second edit keeps the first;
 *  - an image is shrunk, uploaded and shown; Revert asks and removes the fix; lessons edit per step;
 *  - the student side: a saved fix reaches PrepNucleus (module items come back corrected, reasoning dropped), and a slow or failed
 *    fix request never blocks a module.
 * USAGE: CHROME=<path> CHROME_FLAGS=--no-sandbox node test/run-prepfix-ui.mjs
*/
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const LOADER_V = (await import("node:fs")).readFileSync(new URL("../prep-loader.js", import.meta.url), "utf8").match(/var V = "([^"]+)"/)[1];
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-feel-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep/";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8995"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
// Screenshots land on the final frame: finite animations (entrances, ring draw) are finished first; loops keep running.
const shotCall = async (p) => { await ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`); return call("Page.captureScreenshot", p); };
const evA = async (e) => { const r = await call("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const text = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g," ").trim() : "";`);


const BOOTX = `
  window.__reqs = []; window.__me = { editor: true, role: "signer", name: "Dr Test" };
  window.__fixMod = { q: {}, l: {} }; window.__fixIx = {}; window.__slowFix = 0;
  var realFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    var u = String(url), m = (opts && opts.method) || "GET";
    if (u.indexOf("/api/prep/flag") !== -1 && u.indexOf("top=1") !== -1) return Promise.resolve(new Response(JSON.stringify({ items: [
      { itemId: "ana-gametogenesis-q1", subject: "anatomy", module: "ana-gametogenesis", n: 2, reasons: { typo: 2 }, itemType: "question" },
      { itemId: "ana-spleen", subject: "anatomy", module: "ana-spleen", n: 1, reasons: { unclear: 1 }, itemType: "lesson" }] }), { status: 200 }));
    if (u.indexOf("/api/prep/fix") !== -1) {
      var body = opts && opts.body; if (body && body.size) window.__lastBlob = body; window.__reqs.push({ m: m, u: u, b: typeof body === "string" ? JSON.parse(body) : (body && body.size ? "blob:" + body.size + ":" + body.type : null) });
      if (u.indexOf("me=1") !== -1) return Promise.resolve(new Response(JSON.stringify(window.__me), { status: 200 }));
      if (u.indexOf("image=1") !== -1) return Promise.resolve(new Response(JSON.stringify({ ok: true, path: "v90/img/fx-test0001.webp" }), { status: 200 }));
      if (u.indexOf("log=1") !== -1) return Promise.resolve(new Response(JSON.stringify({ log: window.__log || [] }), { status: 200 }));
      if (u.indexOf("ix=1") !== -1) return Promise.resolve(new Response(JSON.stringify({ mods: window.__fixIx }), { status: 200 }));
      if (u.indexOf("module=") !== -1) { if (window.__slowFix) return new Promise(function () {}); return Promise.resolve(new Response(JSON.stringify(window.__fixMod), { status: 200 })); }
      if (m === "POST" || m === "DELETE") return Promise.resolve(new Response(JSON.stringify({ ok: true, ts: 12345 }), { status: 200 }));
    }
    return realFetch(url, opts);
  };
`;
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };
const val = (id) => ev(`return document.getElementById(${JSON.stringify(id)}).value;`);
const setv = (id, v) => ev(`var e=document.getElementById(${JSON.stringify(id)}); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
const lastReq = (m) => J(`var r=window.__reqs.filter(function(x){return x.m===${JSON.stringify(m)} && x.u.indexOf("image=1")===-1;}); return JSON.stringify(r[r.length-1]||null);`);
try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start: " + chromeErr.slice(-400));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP|review/i.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_SETUP=false; window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;` });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: BOOTX });
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP && !!window.SMD_PREPFIX && !!window.SMD_REVIEW;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_REVIEW && window.SMD_PREPFIX);`, 30000);
  await ev(`["introPoster","splash","smdBootSplash","accountGate","introOverlay","verifyGate"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); window.SMD_AUTH = { currentUser: { uid: "u1", email: "dr@example.com", getIdToken: function () { return Promise.resolve("tok"); }, getIdTokenResult: function () { return Promise.resolve({ claims: {}, token: "tok" }); } } };
    window.SMD_BULLETINS_DESK = window.SMD_BULLETINS_DESK || {}; SMD_BULLETINS_DESK.probe = function () { return Promise.resolve(true); }; SMD_BULLETINS_DESK.pendingTotal = function () { return 0; }; SMD_BULLETINS_DESK.reset = function () {}; return 1;`);

  // ---- the reports list: Edit shows for editors only ----
  console.log("DBG open", await ev(`try { SMD_REVIEW.open(); return "opened:" + !!document.getElementById("smdReview"); } catch (e) { return "ERR " + e.message; }`));
  await sleep(1500); console.log("DBG tabs", await ev(`return JSON.stringify([].map.call(document.querySelectorAll("#smdReview [data-rv-act^='kind:']"), function(b){return b.getAttribute("data-rv-act");}));`));
  ok(await until(`return !!document.querySelector('#smdReview [data-rv-act="kind:prep"]');`, 8000), "the PrepNucleus reports tab is there for an editor");
  await click(`#smdReview [data-rv-act="kind:prep"]`);
  ok(await until(`return document.querySelectorAll('#smdReview [data-rv-act^="prepedit:"]').length === 2;`, 8000), "each report row has an Edit button for an editor (" + await text("#smdReview .rv-list") .then((x) => x.slice(0, 60)) + ")");
  ok(/Edit question/.test(await text('#smdReview [data-rv-act="prepedit:ana-gametogenesis-q1"]')) && /Edit lesson/.test(await text('#smdReview [data-rv-act="prepedit:ana-spleen"]')), "a question row says Edit question, a lesson row Edit lesson");

  // ---- edit a question ----
  await click(`#smdReview [data-rv-act="prepedit:ana-gametogenesis-q1"]`);
  ok(await until(`return !!document.getElementById("pf_q");`, 15000), "the question form opens with the real item");
  ok(await val("pf_q") === "Fixture question 1 of ana-gametogenesis?" && await val("pf_o1") === "Option B" && await val("pf_exp") === "Fixture explanation 1.", "the form shows the current text, options and explanation");
  ok(await ev(`return document.getElementById("pf_a0").checked === true;`) === true, "the current correct option is ticked");
  if (process.env.SHOTS) { await ev(`var g=document.getElementById("verifyGate"); if (g) g.remove(); return 1;`); await sleep(400); const r = await call("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(process.env.SHOTS + "/prepfix-form.png", Buffer.from(r.result.data, "base64")); }
  await setv("pf_exp", "Corrected explanation with <b>tags</b>.");
  await setv("pf_o1", "Option B corrected");
  await ev(`document.getElementById("pf_a1").checked = true; return 1;`);
  await setv("pf_kp", "Remember the corrected rule.");
  await setv("pf_note", "typo in option B");
  // image: a real file through the change event opens the crop sheet first
  const pickFile = `var c=document.createElement("canvas"); c.width=400; c.height=300; var x=c.getContext("2d"); var g=x.createLinearGradient(0,0,400,300); g.addColorStop(0,"#08c"); g.addColorStop(1,"#c40"); x.fillStyle=g; x.fillRect(0,0,400,300);
    return new Promise(function(res){ c.toBlob(function(b){ var f=new File([b],"fig.png",{type:"image/png"}); var dt=new DataTransfer(); dt.items.add(f); var i=document.getElementById("pf_file"); i.files=dt.files; i.dispatchEvent(new Event("change",{bubbles:true})); res(1); }, "image/png"); });`;
  await ev(pickFile).catch(() => 0);
  ok(await until(`return !!document.getElementById("pfCrop") && /Result 400 x 300 px/.test(document.getElementById("pfcinfo").textContent);`, 8000), "a chosen image opens the crop sheet, the whole picture selected (Result 400 x 300 px)");
  ok(await ev(`return document.querySelectorAll("#pfCrop .pf-box i").length === 4 && !!document.querySelector('#pfCrop [data-pfc="rotate"]') && !!document.getElementById("pfsize") && !!document.getElementById("pfqual");`) === true, "the sheet has four corner handles, shape chips, Rotate, Size and Quality");
  const pu = await J(`var P = SMD_PREPFIX._pure; return JSON.stringify({ fit: P.fitAspect({ x: 0, y: 0, w: 400, h: 300 }, 1, { w: 400, h: 300 }), fit169: P.fitAspect({ x: 0, y: 0, w: 400, h: 300 }, 16 / 9, { w: 400, h: 300 }), res: P.resizeRect({ x: 100, y: 100, w: 100, h: 100 }, "se", 50, 20, null, { w: 400, h: 300 }), resA: P.resizeRect({ x: 100, y: 100, w: 100, h: 100 }, "se", 50, 0, 2, { w: 400, h: 300 }), resNw: P.resizeRect({ x: 100, y: 100, w: 100, h: 100 }, "nw", -300, -300, null, { w: 400, h: 300 }), mv: P.moveRect({ x: 100, y: 100, w: 100, h: 100 }, 999, -999, { w: 400, h: 300 }), out: P.outSize({ w: 4000, h: 3000 }, 1200), small: P.outSize({ w: 400, h: 300 }, 1200) });`);
  ok(pu.fit.w === 300 && pu.fit.h === 300 && pu.fit.x === 50, "a square inside 400 x 300 is 300 x 300, centred");
  ok(Math.round(pu.fit169.w) === 400 && Math.round(pu.fit169.h) === 225, "16:9 inside 400 x 300 is 400 x 225");
  ok(pu.res.w === 150 && pu.res.h === 120 && pu.res.x === 100, "dragging the SE corner grows the box and keeps the NW corner");
  ok(pu.resA.w === 150 && pu.resA.h === 75, "with a 2:1 shape a resize keeps 2:1");
  ok(pu.resNw.x === 0 && pu.resNw.y === 0 && pu.resNw.w === 200 && pu.resNw.h === 200, "a corner dragged past the edge stops at the image edge");
  ok(pu.mv.x === 300 && pu.mv.y === 0, "moving the box stops at the image edges");
  ok(pu.out.w === 1200 && pu.out.h === 900 && pu.small.w === 400, "the output is capped by the chosen size and never enlarged");
  await click('#pfCrop [data-pfc="aspect:sq"]');
  ok(await until(`return /Result 300 x 300 px/.test(document.getElementById("pfcinfo").textContent);`, 3000), "Square makes a 300 x 300 crop");
  const sq = await J(`var b=document.getElementById("pfbox"); return JSON.stringify([parseFloat(b.style.width), parseFloat(b.style.height)]);`);
  ok(Math.abs(sq[0] - sq[1]) < 1.5, "the box on screen is square (" + sq.map((x) => Math.round(x)).join(" x ") + ")");
  await click('#pfCrop [data-pfc="rotate"]'); await sleep(150);
  await click('#pfCrop [data-pfc="aspect:orig"]');
  ok(await until(`return /Result 225 x 300 px/.test(document.getElementById("pfcinfo").textContent);`, 3000), "after a turn, Original keeps the rotated picture's own shape (225 x 300 inside the square)");
  await click('#pfCrop [data-pfc="aspect:free"]');
  if (process.env.SHOTS) { await sleep(300); const r = await call("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(process.env.SHOTS + "/prepfix-crop.png", Buffer.from(r.result.data, "base64")); }
  // drag the SE corner with a real pointer
  const h = await J(`var r=document.querySelector('#pfCrop .pf-box i[data-h="se"]').getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]);`);
  const before = await J(`var b=document.getElementById("pfbox"); return JSON.stringify([parseFloat(b.style.width), parseFloat(b.style.height)]);`);
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: h[0], y: h[1] }); await call("Input.dispatchMouseEvent", { type: "mousePressed", x: h[0], y: h[1], button: "left", clickCount: 1 });
  for (let k = 1; k <= 6; k++) { await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: h[0] - k * 10, y: h[1] - k * 8, button: "left" }); await sleep(16); }
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: h[0] - 60, y: h[1] - 48, button: "left", clickCount: 1 });
  const after = await J(`var b=document.getElementById("pfbox"); return JSON.stringify([parseFloat(b.style.width), parseFloat(b.style.height)]);`);
  ok(after[0] < before[0] - 40 && after[1] < before[1] - 30, "dragging a corner with the pointer shrinks the box (" + before.map(Math.round) + " to " + after.map(Math.round) + ")");
  await ev(`var s=document.getElementById("pfsize"); s.value="800"; s.dispatchEvent(new Event("change",{bubbles:true})); return 1;`);
  const crop1 = await text("#pfcinfo");
  await click('#pfCrop [data-pfc="ok"]');
  const gotImg = await until(`return document.querySelectorAll("#smdReview .pf-img img").length === 1 && !document.getElementById("pfCrop");`, 8000);
  const dims = JSON.parse(await evA(`createImageBitmap(window.__lastBlob).then(function (b) { return JSON.stringify([b.width, b.height]); })`));
  const want = crop1.match(/Result (\d+) x (\d+)/);
  ok(dims[0] === Number(want[1]) && dims[1] === Number(want[2]), "the uploaded picture has the size the sheet announced (" + dims.join(" x ") + ")");
  // cancel uploads nothing
  const upsBefore = await ev(`return window.__reqs.filter(function(x){return x.u.indexOf("image=1")!==-1;}).length;`);
  await ev(pickFile).catch(() => 0); await until(`return !!document.getElementById("pfCrop");`, 6000);
  await click('#pfCrop [data-pfc="cancel"]'); await sleep(300);
  ok(await ev(`return window.__reqs.filter(function(x){return x.u.indexOf("image=1")!==-1;}).length;`) === upsBefore && await ev(`return document.querySelectorAll("#smdReview .pf-img img").length === 1 && !document.getElementById("pfCrop");`) === true, "Cancel closes the sheet and uploads nothing");
  ok(gotImg, "a chosen image is shrunk, uploaded and shown");
  const up = await J(`var r=window.__reqs.filter(function(x){return x.u.indexOf("image=1")!==-1;}); return JSON.stringify(r[0]||null);`);
  ok(up && /^blob:\d+:image\/(webp|jpeg)$/.test(up.b), "the upload is a WebP or JPEG blob: " + (up && up.b));
  ok(await val("pf_exp") === "Corrected explanation with <b>tags</b>." && await val("pf_kp") === "Remember the corrected rule.", "typed text survives the image upload re-render");
  await click(`#smdReview [data-rv-act="pfsave"]`);
  ok(await until(`return !document.getElementById("pf_q");`, 6000), "Save closes the form and returns to the reports");
  const p1 = await lastReq("POST");
  ok(p1 && p1.b.kind === "question" && p1.b.id === "ana-gametogenesis-q1" && p1.b.module === "ana-gametogenesis", "the save names the item and its module");
  console.log("DBG p1", JSON.stringify(p1.b));
  ok(p1.b.fix.exp === "Corrected explanation with <b>tags</b>." && p1.b.fix.a === 1 && p1.b.fix.o[1] === "Option B corrected" && p1.b.fix.kp === "Remember the corrected rule.", "the fix carries the explanation, options, key and key point");
  ok(p1.b.fix.q === undefined, "the unchanged question stem is not sent");
  ok(Array.isArray(p1.b.fix.img) && p1.b.fix.img[0] === "v90/img/fx-test0001.webp" && p1.b.note === "typo in option B", "the uploaded image path and the note are sent");

  // ---- a second edit keeps the first fix ----
  await ev(`window.__fixMod = { q: { "ana-gametogenesis-q1": ${JSON.stringify(p1.b.fix)} }, l: {} }; window.__fixIx = { "ana-gametogenesis": 111 }; window.__log = [{ ts: Date.now(), name: "Dr Test", role: "signer", after: ${JSON.stringify(p1.b.fix)} }]; return 1;`);
  await click(`#smdReview [data-rv-act="kind:prep"]`); await sleep(300);
  await until(`return document.querySelectorAll('#smdReview [data-rv-act^="prepedit:"]').length === 2;`, 8000);
  await click(`#smdReview [data-rv-act="prepedit:ana-gametogenesis-q1"]`);
  await until(`return !!document.getElementById("pf_q");`, 15000);
  ok(/Already corrected/.test(await text("#smdReview .dl")), "an already corrected item says so");
  ok(/History \(1\)/.test(await text("#smdReview .pf-hist")) && /Dr Test/.test(await text("#smdReview .pf-hist")), "the history lists who changed it");
  await setv("pf_kp", "A second key point.");
  await click(`#smdReview [data-rv-act="pfsave"]`); await until(`return !document.getElementById("pf_q");`, 6000);
  const p2 = await lastReq("POST");
  ok(p2.b.fix.kp === "A second key point." && p2.b.fix.exp === "Corrected explanation with <b>tags</b>." && p2.b.fix.a === 1, "the second save keeps the first fix and changes only the key point");

  // ---- nothing changed ----
  await click(`#smdReview [data-rv-act="prepedit:ana-gametogenesis-q1"]`); await until(`return !!document.getElementById("pf_q");`, 15000);
  await click(`#smdReview [data-rv-act="pfsave"]`); await sleep(300);
  ok(/Nothing changed/.test(await text("#pf_msg")) && !!(await ev(`return !!document.getElementById("pf_q");`)), "Save with no change says so and stays on the form");

  // ---- revert ----
  await click(`#smdReview [data-rv-act="pfrevert"]`);
  ok(await until(`return !document.getElementById("pf_q");`, 6000), "Revert returns to the reports");
  const del = await lastReq("DELETE");
  ok(del && del.b.kind === "question" && del.b.id === "ana-gametogenesis-q1", "Revert sends a DELETE for that item");

  // ---- a lesson ----
  await ev(`window.__fixMod = { q: {}, l: {} }; window.__fixIx = {}; window.PREP_LESSONS.file = function () { return Promise.resolve({ v: 1, module: "ana-spleen", subject: "anatomy", title: "Spleen", steps: [{ tx: "Step one text.", say: "Say one." }, { tx: "Step two text.", say: "Say two." }, { tx: "Three", say: "S3" }, { tx: "Four", say: "S4" }], quiz: [], gen: "AI" }); }; return 1;`);
  await click(`#smdReview [data-rv-act="kind:prep"]`); await sleep(300);
  await until(`return document.querySelectorAll('#smdReview [data-rv-act^="prepedit:"]').length === 2;`, 8000);
  await click(`#smdReview [data-rv-act="prepedit:ana-spleen"]`);
  ok(await until(`return !!document.getElementById("pf_title") && !!document.getElementById("pf_tx3");`, 15000), "the lesson form shows the title and every step");
  await setv("pf_tx1", "Step two, corrected.");
  await click(`#smdReview [data-rv-act="pfsave"]`); await until(`return !document.getElementById("pf_title");`, 6000);
  const p3 = await lastReq("POST");
  ok(p3.b.kind === "lesson" && p3.b.id === "ana-spleen" && p3.b.fix.steps["1"].tx === "Step two, corrected." && !p3.b.fix.steps["0"] && p3.b.fix.title === undefined, "only the edited lesson step is sent");

  // ---- the student side ----
  await ev(`window.__fixIx = { "ana-gametogenesis": 777 }; window.__fixMod = { q: { "ana-gametogenesis-q1": { exp: "STUDENT SEES THIS", o: ["A1", "B1", "C1"], a: 2, kp: "KP", ts: 777 } }, l: {} }; PREP.refreshFixes(); return 1;`);
  const stu = JSON.parse(await evA(`PREP_LOADER.load().then(function (P) { return P.loadItems("anatomy", "ana-gametogenesis"); }).then(function (items) { var it = items.filter(function (i) { return i.id === "ana-gametogenesis-q1"; })[0]; return JSON.stringify({ exp: it.exp, o: it.o, a: it.a, kp: it.kp, r: it.r || null, x: it.x || null, other: items.filter(function (i) { return i.id !== "ana-gametogenesis-q1"; })[0].exp }); })`) || "null");
  ok(stu && stu.exp === "STUDENT SEES THIS" && stu.o.length === 3 && stu.a === 2 && stu.kp === "KP" && !stu.r && !stu.x, "a fixed question reaches PrepNucleus corrected, with its old per-option reasoning dropped");
  ok(stu && /Fixture explanation/.test(stu.other), "other questions in the module are untouched");

  // ---- a slow fix request never blocks a module ----
  await ev(`window.__slowFix = 1; window.__fixIx = { "ana-brachial-plexus": 888 }; PREP.refreshFixes(); return 1;`);
  const t0 = Date.now();
  const slow = JSON.parse(await evA(`PREP.loadItems("anatomy", "ana-brachial-plexus").then(function (items) { return JSON.stringify({ n: items.length }); })`) || "null");
  ok(slow && slow.n > 0 && Date.now() - t0 < 6000, "a module opens without its fixes when the fix request hangs (" + (Date.now() - t0) + " ms)");

  // ---- a student sees no Edit ----
  await ev(`window.__me = { editor: false }; return 1;`);
  await ev(`document.getElementById("smdReview") && document.getElementById("smdReview").remove(); return 1;`);
  await ev(`SMD_PREPFIX._resetMe && 1; return 1;`);
  ok(errors.length === 0, "no uncaught PrepNucleus or review error " + JSON.stringify(errors.slice(0, 2)));
} catch (e) { console.log("FAIL harness: " + (e && e.stack || e)); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
