/* PrepNucleus practice setup sheet and image questions from a PDF, in the REAL app (headless Chromium over raw CDP).
 * What must hold: Practice on a module opens the setup sheet (not the runner); each option shows the pool it leaves and
 * the counts change live with the other rows; Start draws exactly what was chosen (type, difficulty, count) and passes
 * the timer to the runner (per question in a timed test moves on by itself); the choice is remembered for the module and
 * "Start with last settings" starts in one tap; an option that would leave no question is disabled (native pass 2; the relax hint stays for a scope with nothing in it); back closes
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
    if (i === 7 || i === 13 || i === 23) Object.assign(x, { d: 3, vh: true });   // very hard (level 4 in the app)
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
const more = async () => { if (await ev(`var b=document.querySelector("#pnSetup [data-act=su-more]"); return !!b && b.getAttribute("aria-expanded")==="false";`) === true) await click("#pnSetup [data-act=su-more]"); };
const timerOff = async () => { if (await ev(`var b=document.querySelector("#pnSetup .su-sw"); return !!b && b.getAttribute("aria-checked")==="true";`) === true) await click("#pnSetup .su-sw"); };
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
  ok(await ev(`return PREP_LOADER.V === "prep63" && PREP_LOADER.JS.indexOf("prep-setup.js") > PREP_LOADER.JS.indexOf("prep.js") && !!document.querySelector('link[data-prep="prep-setup.css"]');`) === true, "loader: prep31, prep-setup.js after prep.js, prep-setup.css");
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=su-subject][data-s=anatomy]');`, 5000), "the subject screen has Practise Anatomy");

  // ---- module: opening it asks how to practise (mode sheet, 2026-10-10); Practise opens it again
  await click('#smdPrep .pn-mod[data-m=ana-brachial-plexus]');
  ok(await until(sheetOpen, 8000), "opening the module shows the mode sheet at once");
  await click("#pnSetup .su-x");
  ok(await until(`return !document.getElementById("pnSetup") && !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 8000), "closed: the module screen");
  ok(await ev(`return !document.querySelector('#smdPrep [data-act=su-last]');`) === true, "no Last settings button before a choice was made");
  await click('#smdPrep [data-act=start][data-k=study]');
  ok(await until(sheetOpen, 8000), "Practise opens the setup sheet");
  ok(await ev(`return !document.querySelector("#smdPrep .pn-q");`) === true, "the runner has not started");
  ok(/20\s*questions/.test(await text("#suStatus")), "the set is counted: " + await text("#suStatus"));
  await more();
  ok(await count("type", "img") === 8 && await count("type", "case") === 16 && await count("type", "line") === 16 && await count("type", "all") === 40, "type counts: 8 image, 16 scenario, 16 one-liner");
  ok(await count("seen", "new") === 40 && await count("seen", "bm") === 0 && await count("seen", "due") === 0, "repeat counts on a fresh store");
  ok(await count("d", "1") + await count("d", "2") + await count("d", "3") + await count("d", "4") === 40 && await count("d", "4") === 3, "difficulty counts add up; the 3 vh items count as Very hard");
  ok(await text('#pnSetup [data-act=su-d][data-v="4"] span') === "Very hard", "a Very hard choice");
  await click('#pnSetup [data-act=su-d][data-v="4"]');
  ok(/^3\s*questions/.test(await text("#suStatus")), "Very hard: 3: " + await text("#suStatus"));
  await click('#pnSetup [data-act=su-d][data-v=mix]');
  ok(await ev(`return document.querySelector('#pnSetup [data-act=su-mode][data-v=study]').getAttribute("aria-checked");`) === "true", "Learning Mode preselected");
  ok(await ev(`return document.querySelector('#pnSetup .su-sw').getAttribute("aria-checked") === "true" && document.querySelector('#pnSetup .su-qsrow .su-sv').textContent === "60 s";`) === true, "timer on by default, 60 s a question");
  ok(await small("#pnSetup") === "", "every sheet button is at least 44 px tall " + await small("#pnSetup"));
  ok(!DASH.test(await screenText()), "no em or en dash");
  await shots("sheet");

  // live counts
  await click('#pnSetup [data-act=su-type][data-v=img]');
  ok(/^8\s*questions/.test(await text("#suStatus")) && await count("d", "3") === await ev(`return [0,5,10,15,20,25,30,35].filter(function(i){return i%3===2;}).length;`), "Image-based: 8; difficulty counts follow the type");
  await click('#pnSetup [data-act=su-d][data-v="3"]');
  const hardImg = await ev(`return [0,5,10,15,20,25,30,35].filter(function(i){return i%3===2;}).length;`);
  ok(new RegExp("^" + hardImg + "\\s*questions?").test(await text("#suStatus")), "Image-based and Hard: " + await text("#suStatus"));
  ok(await ev(`var b=document.querySelector('#pnSetup [data-act=su-seen][data-v=bm]'); return b.disabled && b.getAttribute("aria-checked")==="false";`) === true, "an option with 0 questions (Bookmarked) is disabled");
  await click('#pnSetup [data-act=su-seen][data-v=bm]');
  ok(new RegExp("^" + hardImg + "\\s*questions?").test(await text("#suStatus")) && await ev(`return document.getElementById("suGo").disabled;`) === false, "tapping it changes nothing; Start stays on: " + await text("#suStatus"));
  await shots("sheet-empty");
  await click('#pnSetup [data-act=su-seen][data-v=new]');
  await click('#pnSetup [data-act=su-d][data-v=mix]');
  await click('#pnSetup [data-act=su-n][data-v="10"]');
  ok(/^8 questions/.test(await text("#suStatus")) && /Only 8 questions match/.test(await screenText()), "count capped by the pool, said in words");
  await click('#pnSetup [data-act=su-dec]');
  ok(await text("#suN") === "5", "stepper: 10 down to 5");
  await click('#pnSetup [data-act=su-inc]');
  ok(await text("#suN") === "8" || await text("#suN") === "10", "stepper up stays within the pool: " + await text("#suN"));
  await click('#pnSetup [data-act=su-n][data-v="10"]');
  // Test Mode, 30 s a question (the earlier strict-timer step: 60 -> 45 -> 30)
  await click('#pnSetup [data-act=su-mode][data-v=exam]');
  ok(await ev(`return document.querySelector('#pnSetup [data-act=su-timer][data-v=q]').getAttribute("aria-checked")==="true" && /Start test/.test(document.getElementById("suGo").textContent);`) === true, "Test Mode keeps the timer per question; Start test");
  await click('#pnSetup [data-act=su-qdec]'); await click('#pnSetup [data-act=su-qdec]');
  await ev(`document.querySelector("#pnSetup .su-body").scrollTop = 99999; return 1;`);
  await shots("sheet-timer");
  await click("#suGo");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q") && !document.getElementById("pnSetup");`, 5000), "Start closes the sheet and starts the set");
  const run = JSON.parse(await ev(`var r=PREP._st.run; return JSON.stringify({n:r.items.length, mode:r.mode, qsec:r.qsec, limit:r.limit, img:r.items.every(function(x){return x.img && x.imgPlace==="stem";})});`));
  ok(run.n === 8 && run.mode === "exam" && run.qsec === 30 && run.limit === 0 && run.img, "the set: 8 image questions, Test Mode, 30 s a question: " + JSON.stringify(run));
  ok(await until(`return document.getElementById("pnClock").textContent === "0:30";`, 3000), "the clock shows 0:30");
  ok(await ev(`return !!document.querySelector("#smdPrep .pn-yq-fig img");`) === true, "the image shows with the stem");
  await shots("runner-image");
  // ---- per-question clock: a test clock (SMD_PREP_NOW) moves in 2 s steps
  await ev(`window.__off = 1000; window.SMD_PREP_NOW = function () { return window.__off; }; return 1;`);
  await ev(`PREP._st.run.qc.on = -1; document.querySelector("#smdPrep [data-act=qgrid]").click(); return 1;`);
  await until(`return !!document.querySelector("#smdPrep .pn-qgrid");`, 2000);
  await click('#smdPrep [data-act=goq][data-i="0"]');
  await until(`return !!document.querySelector("#smdPrep .pn-q") && PREP._st.run.qc.on === 0;`, 2000);
  const adv = async (ms) => { for (let d = 0; d < ms; d += 2000) { await ev(`window.__off += ${Math.min(2000, ms - d)}; return 1;`); await sleep(330); } };
  const left = (i) => ev(`var r = PREP._st.run; return Math.ceil(PREP._pure.qcLeft(r.qc, ${i}, window.__off) / 1000);`);
  const q0 = await left(0);
  await adv(10000);
  ok(await left(0) === q0 - 10 && await text("#pnClock") === "0:" + String(q0 - 10).padStart(2, "0"), "10 s on question 1: 10 s fewer, said in the bar: " + await text("#pnClock"));
  await click("#smdPrep [data-act=next]");
  ok(await until(`return PREP._st.run.i === 1;`, 2000) && await text("#pnClock") === "0:30", "question 2 starts on its own 0:30: " + await text("#pnClock"));
  await adv(6000);
  await click("#smdPrep [data-act=prev]");
  const back0 = await left(0), q1 = await left(1);
  ok(await until(`return PREP._st.run.i === 0;`, 2000) && back0 === q0 - 10 && q1 === 24, "back on question 1 the clock resumes where it was, not at 0:30 (q1 " + back0 + " s, q2 " + q1 + " s)");
  await click("#smdPrep [data-act=qgrid]");
  await until(`return !!document.querySelector("#smdPrep .pn-qgrid");`, 2000);
  await adv(30000);
  ok(await ev(`return PREP._st.run.qc.on;`) === -1 && await left(0) === back0, "the question grid stops the clock: 30 s there cost nothing");
  await click('#smdPrep [data-act=goq][data-i="0"]');
  await until(`return !!document.querySelector("#smdPrep .pn-q") && PREP._st.run.i === 0;`, 2000);
  await adv(back0 * 1000 + 2000);
  ok(await until(`return PREP._st.run.i === 1 && PREP._st.run.qc.out[0];`, 3000), "Test Mode: the time runs out, the question locks and the test moves on");
  ok(await ev(`return PREP._st.run.ans[0];`) === -1, "the timed-out question stays unanswered");
  await click("#smdPrep [data-act=prev]");
  ok(await until(`return PREP._st.run.i === 0 && !!document.querySelector("#smdPrep .pn-timeup");`, 2000), "going back shows it locked: Time up");
  ok(/Time up/.test(await text("#smdPrep .pn-timeup")) && await ev(`return [].every.call(document.querySelectorAll("#smdPrep .pn-opt"), function (b) { return b.disabled; });`) === true, "every option is disabled");
  ok(await text("#pnClock") === "0:00" && await ev(`return document.querySelector("#smdPrep .pn-qck").getAttribute("data-lvl") === "out" && document.querySelector("#pnTl").getAttribute("data-lvl") === "out";`) === true, "its clock reads 0:00, the line is out");
  await ev(`document.querySelector('#smdPrep .pn-opt[data-k="1"]').click(); return 1;`);
  ok(await ev(`return PREP._st.run.ans[0];`) === -1, "a tap on a locked option answers nothing");
  await shots("runner-timeup");
  await click("#smdPrep [data-act=qgrid]");
  ok(await until(`var b = document.querySelector('#smdPrep [data-act=goq][data-i="0"]'); return !!b && b.classList.contains("out") && /time up/.test(b.getAttribute("aria-label"));`, 2000), "the grid marks it: time up");
  await shots("grid-timeup");
  await click('#smdPrep [data-act=goq][data-i="1"]');
  await until(`return PREP._st.run.i === 1 && !!document.querySelector("#smdPrep .pn-q");`, 2000);
  // away (a frozen page, the phone locked): the clock stops, nothing is charged; back: it goes on
  const before1 = await left(1);
  await ev(`document.dispatchEvent(new Event("freeze")); return 1;`);
  await adv(40000);
  ok(await left(1) === before1 && await ev(`return PREP._st.run.i === 1 && !PREP._st.run.qc.out[1];`) === true, "40 s away cost nothing (owner 2026-10-10: the timer pauses in the background)");
  await ev(`document.dispatchEvent(new Event("resume")); return 1;`);
  await adv(4000);
  ok(await left(1) === before1 - 4, "back: it runs again");
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=su-last]');`, 5000), "back on the module: Start with last settings is offered");
  ok(/8|10 questions/.test(await text('#smdPrep [data-act=su-last]')) && /image-based/.test(await text('#smdPrep [data-act=su-last]')) && /test mode, 30 s a question/.test(await text('#smdPrep [data-act=su-last]')), "it says what it will start: " + await text('#smdPrep [data-act=su-last]'));
  await shots("module-last");
  // remembered: the sheet opens on the same choice
  await click('#smdPrep [data-act=start][data-k=study]');
  ok(await until(sheetOpen, 5000), "sheet again");
  ok(await ev(`return ["su-type=img","su-seen=new","su-n=10","su-timer=q","su-mode=exam"].every(function(k){var p=k.split("="); var b=document.querySelector('#pnSetup [data-act="'+p[0]+'"][data-v="'+p[1]+'"]'); return b && b.getAttribute("aria-checked")==="true";}) && document.querySelector('#pnSetup .su-qsrow .su-sv').textContent === "30 s";`) === true, "the last choice is remembered (filters for the module, mode and timer for the device)");
  // back closes the sheet first
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !document.getElementById("pnSetup") && !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 3000), "back closes the sheet and stays on the module");
  // one tap
  await click('#smdPrep [data-act=su-last]');
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q") && PREP._st.run.items.length === 8 && !document.getElementById("pnSetup");`, 5000), "Start with last settings: one tap, no sheet");
  // Learning Mode: at 0 the answer shows and it waits for Next
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 3000);
  await click('#smdPrep [data-act=start][data-k=study]'); await until(sheetOpen, 5000);
  await click('#pnSetup [data-act=su-mode][data-v=study]');
  await more();
  await click('#pnSetup [data-act=su-type][data-v=all]');
  await click("#suGo");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q");`, 5000) && await ev(`return PREP._st.run.mode === "study" && PREP._st.run.qsec === 30 && !!document.querySelector("#smdPrep .pn-qprog #pnClock") && !!document.getElementById("pnTl");`) === true, "Learning Mode: the figure beside the bookmark and the line under the header");
  await shots("runner-practice-ring");
  await adv(32000);
  ok(await until(`return PREP._st.run.i === 0 && PREP._st.run.qc.out[0] && PREP._st.run.ans[0] === -1 && !!document.querySelector("#smdPrep .pn-verdict.pn-vtu");`, 3000), "Learning Mode: the time runs out, Time up with the answer, it waits on the question");
  await click("#smdPrep [data-act=next]");
  await until(`return PREP._st.run.i === 1;`, 2000);
  // answer one wrong and bookmark it (the timed-out one counts as not answered), for bookmarks and mistakes
  await ev(`var it=PREP._st.run.items[PREP._st.run.i]; document.querySelector('#smdPrep .pn-opt[data-k="'+((it.a+1)%4)+'"]').click(); return 1;`);
  ok(await ev(`return PREP._st.run.qc.on;`) === -1, "an answered question stops its clock");
  await click("#smdPrep [data-act=bookmark]");
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 3000);
  await click('#smdPrep [data-act=start][data-k=study]'); await until(sheetOpen, 5000);
  await more();
  ok(await count("seen", "wrong") === 2 && await count("seen", "bm") === 1 && await count("seen", "new") === 38, "repeat counts follow the store: 2 incorrect (one timed out), 1 bookmarked, 38 new: " + [await count("seen", "wrong"), await count("seen", "bm"), await count("seen", "new")]);
  await ev(`PREP.back(); return 1;`);

  // ---- subject, bookmarks, mistakes, custom: each opens the sheet
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.querySelector('#smdPrep [data-act=su-subject]');`, 5000);
  await click('#smdPrep [data-act=su-subject]');
  ok(await until(sheetOpen, 10000) && /Anatomy/.test(await text("#pnSetup .su-head")), "the subject opens the sheet over its modules");
  await more();
  ok(await count("type", "all") >= 40, "the subject pool spans its modules: " + await count("type", "all"));
  await ev(`PREP.back(); PREP.back(); return 1;`);
  await until(`return !!document.querySelector('#smdPrep [data-act=bookmarks]');`, 5000);
  await click('#smdPrep [data-act=bookmarks]');
  await until(`return !!document.querySelector('#smdPrep [data-act=practicebm]');`, 5000);
  await click('#smdPrep [data-act=practicebm]');
  ok(await until(sheetOpen, 5000) && /^1\s*question\b/.test(await text("#suStatus")), "bookmarks open the sheet: " + await text("#suStatus"));
  await ev(`PREP.back(); PREP.back(); return 1;`);
  await until(`return !!document.querySelector('#smdPrep [data-act=mistakes]');`, 5000);
  await click('#smdPrep [data-act=mistakes]');
  await until(`return !!document.querySelector('#smdPrep [data-act=mpractice]');`, 5000);
  await click('#smdPrep [data-act=mpractice]');
  await more();
  ok(await until(sheetOpen, 5000) && await ev(`return !document.querySelector('#pnSetup [data-act=su-seen]');`) === true && /^2\s*questions?/.test(await text("#suStatus")), "My mistakes opens the sheet without the repeat row (the wrong one and the timed-out one): " + await text("#suStatus"));
  await ev(`PREP.back(); PREP.back(); return 1;`);
  await until(`return !!document.querySelector('#smdPrep [data-act=custom]');`, 5000);
  await click('#smdPrep [data-act=custom]');
  await until(`return !!document.querySelector('#smdPrep [data-act=cmsub][data-v=anatomy]');`, 5000);
  ok(await ev(`return !document.querySelector('#smdPrep [data-act=cmd]');`) === true, "custom module: difficulty, count and mode moved to the sheet");
  await click('#smdPrep [data-act=cmsub][data-v=anatomy]');
  await click('#smdPrep [data-act=cmstart]');
  ok(await until(sheetOpen, 10000) && /Custom module/.test(await text("#pnSetup .su-head")), "custom module opens the sheet");

  // ---- result review filters and saved practice sets (owner 2026-10-09)
  await click('#pnSetup [data-act=su-mode][data-v=study]');
  await more();
  await click('#pnSetup [data-act=su-type][data-v=all]');
  await click('#pnSetup [data-act=su-seen][data-v=all]').catch(() => {});
  await timerOff();
  await click('#pnSetup [data-act=su-n][data-v="10"]');
  await click("#suGo");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q") && PREP._st.run && PREP._st.run.items.length === 10 && PREP._st.run.save === "custom";`, 8000), "a 10-question custom practice set starts and is marked to be saved");
  // right on even questions, wrong on odd ones
  await ev(`for (var n = 0; n < 10; n++) { var r = PREP._st.run, it = r.items[r.i]; document.querySelector('#smdPrep .pn-opt[data-k="' + (r.i % 2 ? (it.a + 1) % 4 : it.a) + '"]').click(); document.querySelector("#smdPrep [data-act=next]").click(); } return 1;`);
  ok(await until(`return PREP._st.run.done && !!document.querySelector("#smdPrep [data-act=rfilter]");`, 3000), "the result shows the review filters");
  const chips = JSON.parse(await ev(`return JSON.stringify([].map.call(document.querySelectorAll("#smdPrep [data-act=rfilter]"), function (b) { return [b.getAttribute("data-v"), b.textContent.trim(), b.getAttribute("aria-pressed"), b.disabled]; }));`));
  ok(chips.map((c) => c[0]).join() === "all,wrong,right,skip,bm" && /All\s*10/.test(chips[0][1]) && /Wrong\s*5/.test(chips[1][1]) && /Correct\s*5/.test(chips[2][1]) && /Skipped\s*0/.test(chips[3][1]) && chips[3][3] === true, "filters with counts: " + JSON.stringify(chips));
  ok(chips[1][2] === "true" && await ev(`return document.querySelectorAll("#smdPrep .pn-missed [data-act=reviewq]").length;`) === 5, "Wrong is the default and lists the 5 wrong");
  await click('#smdPrep [data-act=rfilter][data-v=right]');
  ok(await ev(`return document.querySelectorAll("#smdPrep .pn-missed [data-act=reviewq]").length === 5 && document.querySelector('#smdPrep [data-act=rfilter][data-v=right]').getAttribute("aria-pressed") === "true";`) === true, "Correct lists the 5 right ones");
  await click('#smdPrep [data-act=rfilter][data-v=all]');
  ok(await ev(`return document.querySelectorAll("#smdPrep .pn-missed [data-act=reviewq]").length;`) === 10, "All lists every question");
  ok(await ev(`return !!document.querySelector("#smdPrep [data-act=retrymissed]") && /all again \\(10\\)/.test(document.querySelector("#smdPrep [data-act=retryall]").textContent);`) === true, "practise again: the missed or all 10");
  await shots("result-review");
  const ps = JSON.parse(await ev(`var s = PREP._st.store, ids = Object.keys(s.ps); return JSON.stringify({ n: ids.length, e: s.ps[ids[0]], id: PREP._st.run.psId, ids: ids });`));
  ok(ps.n === 1 && ps.e.n === 10 && ps.e.ok === 5 && ps.id === ps.ids[0] && Math.round((ps.e.x - ps.e.c) / 864e5) === 7, "the set is saved for 7 days: " + JSON.stringify({ n: ps.n, ok: ps.e && ps.e.ok }));
  ok(!/Which root|Fixture explanation/.test(JSON.stringify(ps.e)), "saved as ids and answers, no question text");
  ok(/Expires in 7 days/.test(await text("#smdPrep .pn-body")), "the result says it is saved and when it expires");
  await click("#smdPrep [data-act=donerun]");
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep #pnSets [data-act=psopen]");`, 5000), "home lists Your practice sets");
  ok(/Custom module/.test(await text("#pnSets")) && /10 questions · 5 right · Expires in 7 days/.test(await text("#pnSets")), "the row: " + await text("#pnSets"));
  await shots("home-sets");
  await click("#smdPrep #pnSets [data-act=psopen]");
  ok(await until(`return PREP._st.run && PREP._st.run.done && PREP._st.run.saved && !!document.querySelector("#smdPrep [data-act=rfilter]");`, 8000), "the saved set reopens on its result");
  ok(/Wrong\s*5/.test(await text('#smdPrep [data-act=rfilter][data-v=wrong]')) && await ev(`return document.querySelectorAll("#smdPrep .pn-missed [data-act=reviewq]").length;`) === 5, "with the same answers: 5 wrong");
  await click('#smdPrep .pn-missed [data-act=reviewq]');
  ok(await until(`return /Review/.test(document.querySelector("#smdPrep .pn-bar, #smdPrep header") ? document.querySelector("#smdPrep .pn-bar, #smdPrep header").textContent : document.body.textContent);`, 3000), "a question opens for review");
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.querySelector("#smdPrep [data-act=retryall]");`, 3000);
  await click("#smdPrep [data-act=retryall]");
  ok(await until(`var r = PREP._st.run; return !!r && !r.done && r.items.length === 10 && r.psId === ${JSON.stringify(ps.id)} && r.ans.every(function (a) { return a < 0; });`, 3000), "practise all again: the same 10, fresh answers, tied to the saved set");
  await ev(`for (var n = 0; n < 10; n++) { var r = PREP._st.run, it = r.items[r.i]; document.querySelector('#smdPrep .pn-opt[data-k="' + it.a + '"]').click(); document.querySelector("#smdPrep [data-act=next]").click(); } return 1;`);
  ok(await until(`var s = PREP._st.store; return PREP._st.run.done && Object.keys(s.ps).length === 1 && s.ps[${JSON.stringify(ps.id)}].ok === 10 && s.ps[${JSON.stringify(ps.id)}].c === ${ps.e.c};`, 3000), "the saved set takes the new answers and keeps its expiry");
  await click("#smdPrep [data-act=donerun]");
  // expiry: 7 days on, the set is purged on load and gone from home
  await ev(`var s = PREP._st.store, id = Object.keys(s.ps)[0]; s.ps[id].x = Date.now() - 1; localStorage.setItem("smd_prep_v1", JSON.stringify(s)); return 1;`);
  await ev(`PREP.close(); PREP._st.store = null; return 1;`);
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=custom]');`, 5000) && await ev(`return !document.querySelector("#smdPrep #pnSets") && Object.keys(PREP._st.store.ps).length === 0;`) === true, "an expired set is purged on load and leaves home");

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
  ok(await until(`return !!document.getElementById("pcPagesView") && /^2 of 60 selected/.test(document.getElementById("pcPgN").textContent);`, 20000), "the PDF opens in the page picker, both pages picked");
  await click('#smdPrep [data-act="c-pgok"]');
  await until(`return !!document.getElementById("pcSetView");`, 5000);
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
  await until(`return !!document.querySelector('#pcDecks [data-act=c-open]');`, 5000);
  await click('#pcDecks [data-act=c-open]');
  await until(`return !!document.querySelector('#pcDeckView [data-act=c-prac]');`, 5000);
  await click('#pcDeckView [data-act=c-prac]');
  ok(await until(sheetOpen, 5000) && (await more(), await count("type", "img")) === 2, "practising the deck opens the sheet; 2 image-based questions");
  await click('#pnSetup [data-act=su-type][data-v=img]');
  await click('#pnSetup [data-act=su-mode][data-v=study]');
  await timerOff();
  await click("#suGo");
  ok(await until(`var i=document.querySelector("#smdPrep .pn-yq-fig img"); return !!i && /^data:image\\//.test(i.getAttribute("src")) && i.naturalWidth > 0;`, 5000), "the deck's image question shows its image with the stem");
  ok(/(X-ray|smear) shown/.test(await text("#smdPrep .pn-q")), "the stem refers to the image");
  await shots("deck-image-question");
  await click("#smdPrep .pn-yq-fig [data-act=y-zoom]");
  ok(await until(`var z=document.querySelector(".pv .pv-img"); return !!z && /^data:image\\//.test(z.getAttribute("src"));`, 3000), "tap to enlarge works on a deck image (shared viewer)");
  await ev(`PREP.back(); return 1;`);

  ok(api.other.every((u) => /\/api\//.test(u)), "every other /api/ request was answered locally (" + api.other.length + ")");
  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN: PrepNucleus practice setup" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally {
  try { ws && ws.close(); } catch {} if (serveProc) serveProc.kill();
  const gone = new Promise((res) => { if (chrome.exitCode != null) return res(); chrome.once("exit", res); });
  chrome.kill(); await Promise.race([gone, sleep(3000)]);
  if (chrome.exitCode == null) { try { chrome.kill("SIGKILL"); } catch {} }
  process.exit(fails === 0 ? 0 : 1);
}
