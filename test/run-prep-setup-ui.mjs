/* PrepNucleus practice setup sheet and image questions from a PDF, in the REAL app (headless Chromium over raw CDP).
 * What must hold: Practice on a module opens the setup sheet (not the runner); each option shows the pool it leaves and
 * the counts change live with the other rows; Start draws exactly what was chosen (type, difficulty, count) and passes
 * the timer to the runner (per question in a timed test moves on by itself); the choice is remembered for the module and
 * "Start with last settings" starts in one tap; an empty pool says which row to relax and disables Start; back closes
 * the sheet first; the subject, bookmarks, mistakes and custom module open it too. Layer C: a PDF with two pictures
 * shows them as a strip, the kept ones are sent one per imcq call with the page text near them (MOCKED generator, every
 * /api/ request answered here), the deck keeps the image questions, and practising the deck through the sheet shows the
 * image with the stem. No em or en dash on screen; sheet buttons at least 44 px; no uncaught error.
 * Screenshots (phone 390 x 844 and iPad 820 x 1180, light and dark): SHOTS=<dir>.
 * USAGE: node test/run-prep-setup-ui.mjs   (CHROME, CHROME_PORT, BASE, SHOTS)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { makeImagePdf } from "./fixtures/prep-setup/make-pdf.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || tmpdir()) + "/prep-setup-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep/";
const DASH = new RegExp("[" + String.fromCharCode(8211, 8212) + "]");
const SHOTS = process.env.SHOTS || "";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8998"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}

/* ---- a richer module file for ana-brachial-plexus: 40 questions, every type and difficulty ---- */
function moduleFile() {
  const items = [];
  for (let i = 0; i < 40; i++) {
    const x = { id: "bp-" + i, q: "Which root forms nerve " + i + "?", o: ["C5", "C6", "C7", "C8"], a: i % 4, exp: "Fixture explanation " + i + ".", t: "ana-brachial-plexus", d: (i % 3) + 1, prov: "LIC" };
    if (i % 5 === 0) Object.assign(x, { q: "The radiograph shown is of a shoulder after a fall. Which nerve is at risk?", img: ["fx-2025-r1-2-1.webp"], imgPlace: "stem" });
    else if (i % 2) x.q = "A " + (20 + i) + "-year-old man presents with weakness of the arm after a fall. Which nerve is injured?";
    items.push(x);
  }
  return { topic: "ana-brachial-plexus", items };
}

/* ---- mocked generator, as in run-prep-create-ui, plus imcq ---- */
const sha12 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const api = { calls: [], other: [], decks: new Set(), month: 0, day: 0 };
function genReply(body, auth) {
  api.calls.push({ op: body.op, body, auth });
  if (auth !== "Bearer test-token") return [401, { error: "sign-in" }];
  if (body.op === "facts" && !api.decks.has(body.deckId)) { api.decks.add(body.deckId); api.month++; api.day++; }
  const usage = { inTok: 1200, outTok: 400, thinkTok: 0, inr: 0.0864, deckTok: 1600, deckCapTok: 200000, dayDecks: api.day, monthDecks: api.month };
  if (body.op === "facts") return [200, { facts: body.chunk.sents.slice(0, 15).map((s) => ({ fid: "f_" + sha12(body.deckId + s.n), ft: s.tx, cq: "Recall: " + s.tx, sn: [s.n], fk: "recall", quote: s.tx, p: s.p, h: s.h })), usage }];
  if (body.op === "mcq") return [200, { items: body.facts.map((f) => ({ id: "q_" + sha12(body.deckId + f.fid), q: "Which statement matches the source? " + f.ft, o: ["It is true as stated", "It applies only to children", "It was withdrawn in 2010", "It needs no follow up"], a: 0, r: ["Matches", "No age limit", "Not withdrawn", "Follow up"], exp: "Matches", kp: "", d: 2, cog: "recall", fid: f.fid, prov: "AI", ex: [body.exam], pv: "p1", rv: null })), usage }];
  if (body.op === "solve") return [200, { solved: body.q.map((q) => ({ id: q.id, ok: true, ot: q.o[q.a] })), usage }];
  if (body.op === "review") return [200, { gates: body.q.map((q, i) => ({ i, g4: true, g6: true, g7: true, g8: true, g9: true, g10: true, g11: true, old: false, why: "" })), usage }];
  if (body.op === "imcq") {
    const cap = body.near.find((s) => /^Figure/.test(s.tx)) || body.near[0], xray = /X-ray/.test(cap.tx);
    return [200, { items: [{ id: "q_" + sha12(body.deckId + "img" + cap.n), q: xray ? "The chest X-ray shown is of a breathless man. What is the diagnosis?" : "The smear shown is from a child with anaemia. Which cells are seen?", o: xray ? ["Tension pneumothorax", "Pleural effusion", "Lung collapse", "Consolidation"] : ["Target cells", "Spherocytes", "Schistocytes", "Sickle cells"], a: 0,
      r: ["Stated in the text", "Fluid, not air", "Shift would be towards it", "Air bronchograms"], exp: "Stated in the text", kp: "", d: 2, cog: "application", fid: "f_" + sha12(body.deckId + cap.n), src: { sn: [cap.n], p: [cap.p], h: cap.h }, prov: "USR", ex: [body.exam], pv: "p1", rv: null, imgPlace: "stem" }], skipped: null, usage }];
  }
  return [400, { error: "bad-input" }];
}

await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });
let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const text = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g," ").trim() : "";`);
const screenText = () => ev(`var r=document.getElementById("smdPrep"); return r ? r.innerText : "";`);
const small = (scope) => ev(`var r=document.querySelector(${JSON.stringify(scope)}); if(!r) return "none"; return [].filter.call(r.querySelectorAll("button"), function(b){ return b.offsetParent && b.getBoundingClientRect().height < 44 * 0.95 - 0.5; }).map(function(b){ return (b.getAttribute("data-act")||"") + ":" + Math.round(b.getBoundingClientRect().height); }).join(",");`);
const SIZES = { phone: [390, 844], ipad: [820, 1180] };
async function size(k) { await call("Emulation.setDeviceMetricsOverride", { width: SIZES[k][0], height: SIZES[k][1], deviceScaleFactor: 2, mobile: true }); await sleep(250); }
async function shotOne(name, dark) {
  await ev(`document.body.classList.toggle("dark", ${dark ? "true" : "false"}); document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`);
  await sleep(200);
  const r = await call("Page.captureScreenshot", { format: "png" });
  if (r.result) writeFileSync(join(SHOTS, name + (dark ? "-dark" : "-light") + ".png"), Buffer.from(r.result.data, "base64"));
}
// Phone and iPad, light and dark, of whatever is on screen now (the screen must survive a resize: sheets do).
async function shots(name) {
  if (!SHOTS) return;
  for (const k of ["phone", "ipad"]) { await size(k); await shotOne(name + "-" + k, false); await shotOne(name + "-" + k, true); }
  await size("phone"); await ev(`document.body.classList.remove("dark"); return 1;`);
}
const sheetOpen = `return !!document.querySelector("#pnSetup .su-sheet") && !document.querySelector("#pnSetup .pn-load");`;
const count = (row, v) => ev(`var b=document.querySelector('#pnSetup [data-act="su-${row}"][data-v="${v}"] .su-n'); return b ? +b.textContent.replace(/\\D/g,"") : -1;`);

try {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start: " + chromeErr.slice(-600));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
    if (m.method === "Fetch.requestPaused") {
      const p = m.params, url = p.request.url;
      let status = 404, body = { error: "not-found" };
      if (/ana-brachial-plexus\.json/.test(url)) { status = 200; body = moduleFile(); }
      else if (/\/api\/ai\/prep-generate/.test(url)) {
        let post = p.request.postData;
        if (!post && p.request.hasPostData) { const r = await call("Fetch.getRequestPostData", { requestId: p.requestId }); post = r.result && r.result.postData; }
        const h = p.request.headers || {};
        [status, body] = genReply(JSON.parse(post || "{}"), h.Authorization || h.authorization);
      } else api.other.push(url);
      call("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
    }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {}); await call("DOM.enable", {});
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }, { urlPattern: "*ana-brachial-plexus.json*", requestStage: "Request" }] });
  await size("phone");
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false; try{localStorage.setItem("smd_prep","1");}catch(e){}` });
  await call("Page.navigate", { url: BASE });
  ok(await until(`return !!(window.PREP && window.SMD_showHome);`, 30000), "app boots");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{["smd_prep_v1","smd_prep_setup","smd_prep_c_caps"].forEach(function(k){localStorage.removeItem(k);});}catch(e){} indexedDB.deleteDatabase("prep-gen"); indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await ev(`PREP.open({ subject: "anatomy" }); return 1;`);
  ok(await until(`return !!window.PREP_SETUP && !!document.querySelector('#smdPrep .pn-mod[data-m=ana-brachial-plexus]');`, 20000), "prep-setup.js loads with PrepNucleus; the subject lists its modules");
  ok(await ev(`return PREP_LOADER.V === "prep24" && PREP_LOADER.JS.indexOf("prep-setup.js") > PREP_LOADER.JS.indexOf("prep.js") && !!document.querySelector('link[data-prep="prep-setup.css"]');`) === true, "loader: prep24, prep-setup.js after prep.js, prep-setup.css");
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=su-subject][data-s=anatomy]');`, 5000), "the subject screen has Practise Anatomy");

  // ---- module: Practice opens the sheet
  await click('#smdPrep .pn-mod[data-m=ana-brachial-plexus]');
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 8000), "module screen");
  ok(await ev(`return !document.querySelector('#smdPrep [data-act=su-last]');`) === true, "no Last settings button before a choice was made");
  await click('#smdPrep [data-act=start][data-k=study]');
  ok(await until(sheetOpen, 8000), "Practice opens the setup sheet");
  ok(await ev(`return !document.querySelector("#smdPrep .pn-q");`) === true, "the runner has not started");
  ok(/40\s*questions match/.test(await text("#suStatus")), "the pool is counted: " + await text("#suStatus"));
  ok(await count("type", "img") === 8 && await count("type", "case") === 16 && await count("type", "line") === 16 && await count("type", "all") === 40, "type counts: 8 image, 16 scenario, 16 one-liner");
  ok(await count("seen", "new") === 40 && await count("seen", "bm") === 0 && await count("seen", "due") === 0, "repeat counts on a fresh store");
  ok(await count("d", "1") + await count("d", "2") + await count("d", "3") === 40, "difficulty counts add up");
  ok(await ev(`return document.querySelector('#pnSetup [data-act=su-mode][data-v=study]').getAttribute("aria-checked");`) === "true", "Practice mode preselected from the button");
  ok(await small("#pnSetup") === "", "every sheet button is at least 44 px tall " + await small("#pnSetup"));
  ok(!DASH.test(await screenText()), "no em or en dash");
  await shots("sheet");

  // live counts
  await click('#pnSetup [data-act=su-type][data-v=img]');
  ok(/8\s*questions match/.test(await text("#suStatus")) && await count("d", "3") === await ev(`return [0,5,10,15,20,25,30,35].filter(function(i){return i%3===2;}).length;`), "Image-based: 8 match; difficulty counts follow the type");
  await click('#pnSetup [data-act=su-d][data-v="3"]');
  const hardImg = await ev(`return [0,5,10,15,20,25,30,35].filter(function(i){return i%3===2;}).length;`);
  ok(new RegExp(hardImg + "\\s*questions? match").test(await text("#suStatus")), "Image-based and Hard: " + await text("#suStatus"));
  await click('#pnSetup [data-act=su-seen][data-v=bm]');
  ok(/No .* questions match\. Choose /.test(await text("#suStatus")) && await ev(`return document.getElementById("suGo").disabled;`) === true, "empty pool: the row to relax is named and Start is off: " + await text("#suStatus"));
  await shots("sheet-empty");
  await click('#pnSetup [data-act=su-seen][data-v=new]');
  await click('#pnSetup [data-act=su-d][data-v=mix]');
  await click('#pnSetup [data-act=su-n][data-v="10"]');
  ok(/Start 8 questions/.test(await text("#suGo")) && /Only 8 questions match/.test(await screenText()), "count capped by the pool, said in words");
  // stepper
  await click('#pnSetup [data-act=su-dec]');
  ok(await text("#suN") === "5", "stepper: 10 down to 5");
  await click('#pnSetup [data-act=su-inc]');
  ok(await text("#suN") === "8" || await text("#suN") === "10", "stepper up stays within the pool: " + await text("#suN"));
  await click('#pnSetup [data-act=su-n][data-v="10"]');
  // timed test, 30 s a question
  await click('#pnSetup [data-act=su-mode][data-v=exam]');
  ok(await ev(`return !document.querySelector('#pnSetup [data-act=su-timer][data-v=off]') && document.querySelector('#pnSetup [data-act=su-timer][data-v=set]').getAttribute("aria-checked")==="true";`) === true, "a timed test has no Off; Whole set at exam pace by default");
  await click('#pnSetup [data-act=su-timer][data-v=q]');
  await click('#pnSetup [data-act=su-qs][data-v="30"]');
  await ev(`document.querySelector("#pnSetup .su-body").scrollTop = 99999; return 1;`);
  await shots("sheet-timer");
  await click("#suGo");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q") && !document.getElementById("pnSetup");`, 5000), "Start closes the sheet and starts the set");
  const run = JSON.parse(await ev(`var r=PREP._st.run; return JSON.stringify({n:r.items.length, mode:r.mode, qsec:r.qsec, limit:r.limit, img:r.items.every(function(x){return x.img && x.imgPlace==="stem";})});`));
  ok(run.n === 8 && run.mode === "exam" && run.qsec === 30 && run.limit === 0 && run.img, "the set: 8 image questions, timed, 30 s a question: " + JSON.stringify(run));
  ok(await until(`return /^0:(2\\d|30)$/.test(document.getElementById("pnClock").textContent);`, 3000), "the clock counts this question down from 0:30");
  ok(await ev(`return !!document.querySelector("#smdPrep .pn-yq-fig img");`) === true, "the image shows with the stem");
  await shots("runner-image");
  // auto-advance: make the question's clock run out
  await ev(`PREP._st.run.qt0 = Date.now() - 31000; return 1;`);
  ok(await until(`return PREP._st.run.i === 1;`, 3000), "per question in a timed test: the time runs out and the test moves on");
  ok(await ev(`return PREP._st.run.ans[0];`) === -1, "the timed-out question stays unanswered");
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=su-last]');`, 5000), "back on the module: Start with last settings is offered");
  ok(/8|10 questions/.test(await text('#smdPrep [data-act=su-last]')) && /image-based/.test(await text('#smdPrep [data-act=su-last]')) && /30 s a question/.test(await text('#smdPrep [data-act=su-last]')), "it says what it will start: " + await text('#smdPrep [data-act=su-last]'));
  await shots("module-last");
  // remembered: the sheet opens on the same choice
  await click('#smdPrep [data-act=start][data-k=study]');
  ok(await until(sheetOpen, 5000), "sheet again");
  ok(await ev(`return ["su-type=img","su-seen=new","su-n=10","su-timer=q","su-qs=30"].every(function(k){var p=k.split("="); var b=document.querySelector('#pnSetup [data-act="'+p[0]+'"][data-v="'+p[1]+'"]'); return b && b.getAttribute("aria-checked")==="true";});`) === true, "the last choice for this module is remembered");
  ok(await ev(`return document.querySelector('#pnSetup [data-act=su-mode][data-v=study]').getAttribute("aria-checked");`) === "true", "the button pressed (Practice) sets the mode");
  // back closes the sheet first
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !document.getElementById("pnSetup") && !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 3000), "back closes the sheet and stays on the module");
  // one tap
  await click('#smdPrep [data-act=su-last]');
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q") && PREP._st.run.items.length === 8 && !document.getElementById("pnSetup");`, 5000), "Start with last settings: one tap, no sheet");
  // practice: per-question ring, no auto-advance
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 3000);
  await click('#smdPrep [data-act=start][data-k=study]'); await until(sheetOpen, 5000);
  await click('#pnSetup [data-act=su-type][data-v=all]');
  await click("#suGo");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q");`, 5000) && await ev(`return PREP._st.run.mode === "study" && PREP._st.run.qsec === 30 && !!document.querySelector("#smdPrep .pn-acts #pnClock");`) === true, "practice keeps the ring beside the bookmark");
  await ev(`PREP._st.run.qt0 = Date.now() - 40000; return 1;`); await sleep(1300);
  ok(await ev(`return PREP._st.run.i === 0 && document.querySelector("#smdPrep .pn-clockw").classList.contains("over");`) === true, "practice never moves on by itself; the ring turns");
  await shots("runner-practice-ring");
  // answer two (one wrong) and bookmark one, for bookmarks and mistakes
  await ev(`var it=PREP._st.run.items[0]; document.querySelector('#smdPrep .pn-opt[data-k="'+((it.a+1)%4)+'"]').click(); return 1;`);
  await click("#smdPrep [data-act=bookmark]");
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 3000);
  await click('#smdPrep [data-act=start][data-k=study]'); await until(sheetOpen, 5000);
  ok(await count("seen", "wrong") === 1 && await count("seen", "bm") === 1 && await count("seen", "new") === 39, "repeat counts follow the store: 1 incorrect, 1 bookmarked, 39 new");
  await ev(`PREP.back(); return 1;`);

  // ---- subject, bookmarks, mistakes, custom: each opens the sheet
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.querySelector('#smdPrep [data-act=su-subject]');`, 5000);
  await click('#smdPrep [data-act=su-subject]');
  ok(await until(sheetOpen, 10000) && /Anatomy/.test(await text("#pnSetup .su-head")), "the subject opens the sheet over its modules");
  ok(await count("type", "all") >= 40, "the subject pool spans its modules: " + await count("type", "all"));
  await ev(`PREP.back(); PREP.back(); return 1;`);
  await until(`return !!document.querySelector('#smdPrep [data-act=bookmarks]');`, 5000);
  await click('#smdPrep [data-act=bookmarks]');
  await until(`return !!document.querySelector('#smdPrep [data-act=practicebm]');`, 5000);
  await click('#smdPrep [data-act=practicebm]');
  ok(await until(sheetOpen, 5000) && /1\s*question matches/.test(await text("#suStatus")), "bookmarks open the sheet: " + await text("#suStatus"));
  await ev(`PREP.back(); PREP.back(); return 1;`);
  await until(`return !!document.querySelector('#smdPrep [data-act=mistakes]');`, 5000);
  await click('#smdPrep [data-act=mistakes]');
  await until(`return !!document.querySelector('#smdPrep [data-act=mpractice]');`, 5000);
  await click('#smdPrep [data-act=mpractice]');
  ok(await until(sheetOpen, 5000) && await ev(`return !document.querySelector('#pnSetup [data-act=su-seen]');`) === true && /1\s*question matches/.test(await text("#suStatus")), "My mistakes opens the sheet without the repeat row");
  await ev(`PREP.back(); PREP.back(); return 1;`);
  await until(`return !!document.querySelector('#smdPrep [data-act=custom]');`, 5000);
  await click('#smdPrep [data-act=custom]');
  await until(`return !!document.querySelector('#smdPrep [data-act=cmsub][data-v=anatomy]');`, 5000);
  ok(await ev(`return !document.querySelector('#smdPrep [data-act=cmd]');`) === true, "custom module: difficulty, count and mode moved to the sheet");
  await click('#smdPrep [data-act=cmsub][data-v=anatomy]');
  await click('#smdPrep [data-act=cmstart]');
  ok(await until(sheetOpen, 10000) && /Custom module/.test(await text("#pnSetup .su-head")), "custom module opens the sheet");
  await ev(`PREP.back(); PREP.back(); return 1;`);

  // ---- Layer C: a PDF with two pictures
  await ev(`PREP_C.cfg.gap = 0; window.SMD_AUTH = { currentUser: { uid: "u-test", getIdToken: function () { return Promise.resolve("test-token"); } } }; return 1;`);
  await until(`return !!document.querySelector('#smdPrep [data-act=c-home]');`, 5000);
  await click('#smdPrep [data-act=c-home]');
  await until(`return !!document.querySelector('#smdPrep [data-act=c-new]');`, 5000);
  await click('#smdPrep [data-act=c-new]');
  await until(`return !!document.querySelector('#smdPrep [data-act="c-src"][data-v="pdf"]');`);
  await click('#smdPrep [data-act="c-src"][data-v="pdf"]');
  await until(`return !!document.getElementById("pcFile");`);
  const dir = join(process.env.CLAUDE_JOB_DIR || tmpdir(), "prep-c-setup-" + Date.now()); mkdirSync(dir, { recursive: true });
  const pdfPath = join(dir, "Radiology notes.pdf"); writeFileSync(pdfPath, makeImagePdf(), "latin1");
  { const { result: { root } } = await call("DOM.getDocument", { depth: 0 }); const { result: { nodeId } } = await call("DOM.querySelector", { nodeId: root.nodeId, selector: "#pcFile" }); await call("DOM.setFileInputFiles", { nodeId, files: [pdfPath] }); }
  ok(await until(`var f=document.querySelector("#pcCreateView .pc-file"); return !!f && /2 pages/.test(f.textContent);`, 20000), "the PDF opens");
  await click('#smdPrep [data-act="c-own"]');
  await click('#smdPrep [data-act="c-go"]');
  ok(await until(`return document.querySelectorAll("#pcImgView .pc-thumb").length === 2;`, 20000), "two pictures found: the repeated logo and the small icon are left out");
  ok(await ev(`return [].every.call(document.querySelectorAll("#pcImgView .pc-thumb img"), function(i){ return /^data:image\\/(webp|jpeg);base64,/.test(i.src) && i.naturalWidth >= 200; }) && /Use these images for image questions/.test(document.getElementById("pcImgView").textContent);`) === true, "the strip shows the cut-out images (at their own size)");
  ok(api.calls.length === 0, "nothing sent while choosing images");
  ok(await small("#pcImgView") === "", "strip buttons at least 44 px " + await small("#pcImgView"));
  await shots("image-strip");
  await click('#pcImgView .pc-thumb');
  ok(/1 of 2 kept/.test(await text("#pcImgN")) && /Use 1 image/.test(await text('#smdPrep [data-act=c-imgok]')), "a tap leaves an image out");
  await click('#pcImgView .pc-thumb');
  await click('#smdPrep [data-act=c-imgok]');
  ok(await until(`return !!document.getElementById("pcProgView") && /Deck saved/.test(document.querySelector("#smdPrep .pn-bar h1").textContent);`, 40000), "the deck is made");
  const ops = api.calls.map((c) => c.op);
  ok(ops.filter((o) => o === "imcq").length === 2 && ops.indexOf("imcq") > ops.lastIndexOf("review"), "two imcq calls, after the text round: " + ops.join(","));
  const ic = api.calls.filter((c) => c.op === "imcq");
  ok(ic.every((c) => /^(image\/webp|image\/jpeg)$/.test(c.body.img.mime) && c.body.img.data.length > 1000 && c.body.near.length >= 3 && c.body.near.every((s) => Object.keys(s).sort().join() === "h,n,p,tx")), "each sends one image and the numbered page text near it");
  ok(/^Figure 1/.test(ic[0].body.near.find((s) => /^Figure/.test(s.tx)).tx) && ic[0].body.near.some((s) => s.p === 1), "the first image goes with page 1's caption");
  ok(!api.calls.filter((c) => c.op !== "imcq").some((c) => JSON.stringify(c.body).indexOf("data:image") >= 0 || c.body.img), "no image in any other call");
  ok(/2 questions on your images/.test(await screenText()), "the result says how many image questions were made");
  await shots("deck-saved");
  await click('#smdPrep [data-act="c-done"]');
  await until(`return !!document.querySelector('#pcDecks [data-act=c-prac]');`, 5000);
  await click('#pcDecks [data-act=c-prac]');
  ok(await until(sheetOpen, 5000) && await count("type", "img") === 2, "practising the deck opens the sheet; 2 image-based questions");
  await click('#pnSetup [data-act=su-type][data-v=img]');
  await click('#pnSetup [data-act=su-mode][data-v=study]');
  await click('#pnSetup [data-act=su-timer][data-v=off]');
  await click("#suGo");
  ok(await until(`var i=document.querySelector("#smdPrep .pn-yq-fig img"); return !!i && /^data:image\\//.test(i.getAttribute("src")) && i.naturalWidth > 0;`, 5000), "the deck's image question shows its image with the stem");
  ok(/(X-ray|smear) shown/.test(await text("#smdPrep .pn-q")), "the stem refers to the image");
  await shots("deck-image-question");
  await click("#smdPrep .pn-yq-fig [data-act=y-zoom]");
  ok(await until(`var z=document.querySelector("#pnYqZoom img"); return !!z && /^data:image\\//.test(z.getAttribute("src"));`, 3000), "tap to enlarge works on a deck image");
  await ev(`PREP.back(); return 1;`);

  ok(api.other.every((u) => /\/api\//.test(u)), "every other /api/ request was answered locally (" + api.other.length + ")");
  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN: PrepNucleus practice setup" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
