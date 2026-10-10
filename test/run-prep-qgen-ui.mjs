/* PrepNucleus "Create a module with MaiK" and the owner's Author screen in the REAL app (headless Chromium over raw CDP),
 * against a MOCKED /api/ai/prep-qgen (Fetch.requestPaused answers every /api/ request: nothing leaves the machine).
 * What must hold:
 *  - feature off (status on:false): no "Create a module with MaiK" row in Tests > QBank or the Menu, no Author row;
 *  - student on: the rows show (Author still hidden for a non-owner); create from a topic, 10 questions in rounds of 5
 *    (each POST carries the Firebase token, an idem key, n <= 5, the earlier stems as avoid), progress counts up, the
 *    result says what was made and what the checks left out; the module is a private deck (IndexedDB "prep-gen", source
 *    maik) that opens in the mode sheet (Learning / Test Mode, timer) and runs; a MaiK question shows the honest line;
 *    reporting it sends op report (no text) and hides it; the module reopens and practises OFFLINE;
 *  - limits: a 429 daily-modules shows the plain limit message; "N of 3 free modules left today" before;
 *  - owner: the Author row shows, a run lists items with a flagged one, Approve all unflagged, Stage sends only approved
 *    items and shows the publish command;
 *  - no em or en dash on these screens, every button 44 px or taller, no uncaught error.
 * SHOTS=<dir> saves 390x844 and 820x1180, dark and light, of: create, progress, result, limit, author, review.
 * USAGE: node test/run-prep-qgen-ui.mjs   (CHROME, CHROME_PORT, BASE, SHOTS)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || tmpdir()) + "/prep-qgen-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep/";
const DASH = new RegExp("[" + String.fromCharCode(8211, 8212) + "]");

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8998"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}

/* ---------- the mocked server ---------- */
const sha12 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const TOPICS = ["insulin infusion", "potassium replacement", "bicarbonate use", "cerebral oedema", "fluid choice", "ketone monitoring", "dextrose timing", "precipitating infection", "anion gap", "phosphate", "sodium correction", "discharge plan", "sick day rules", "hyperosmolar state"];
let qn = 0;
function item(mod, flag) {
  const i = qn++, t = TOPICS[i % TOPICS.length];
  const it = { id: "q_" + sha12(mod + ":" + i), q: "In diabetic ketoacidosis, which statement about " + t + " (case " + (i + 1) + ") is correct?", o: ["Statement one on " + t, "Statement two on " + t, "Statement three on " + t, "Statement four on " + t],
    a: i % 4, exp: "The correct statement follows from the physiology of " + t + ".", r: ["Reason one.", "Reason two.", "Reason three.", "Reason four."], kp: "Pearl about " + t + ".", et: [null, "knowledge", "mgmt", "confused"],
    d: 2, cog: "application", t: "gen", gen: "AI", prov: "USR", pv: "qg1", src: { maik: 1 }, tg: ["dka"], qg: { g: 0, v: flag ? "flag" : "ok", u: 1, pick: flag ? (i + 1) % 4 : i % 4 } };
  it.r[it.a] = "Right because of " + t + ".";
  if (flag) { it.qg.why = ["disagree"]; it.qg.note = "The checker preferred another option."; }
  return it;
}
const api = { status: { on: false, student: false, owner: false, caps: { modulesPerDay: 3, perModule: 30, perCall: 5 }, left: 3, models: [] }, calls: [], other: [], mode: "ok", slow: 0, mods: new Set(), q: {} };
function qgenReply(body, auth) {
  api.calls.push({ op: body.op, body, auth });
  if (body.op === "status") return [200, api.status];
  if (auth !== "Bearer test-token") return [401, { error: "sign-in", reason: "sign-in" }];
  if (!api.status.on) return [503, { error: "not-configured", reason: "off" }];
  if (body.op === "report") return [200, { ok: true }];
  const usage = { inTok: 1300, outTok: 3100, thinkTok: 480, cacheRead: 0, cacheWrite: 1500, usd: 0.028, inr: 2.69, mt: 2690 };
  if (body.op === "gen") {
    if (!/^qg[0-9a-f]{24}$/.test(body.idem || "") || !(body.n >= 1 && body.n <= 5)) return [400, { error: "bad-input", reason: "n" }];
    if (api.mode === "limit" && !api.mods.has(body.mod)) return [429, { error: "quota", reason: "daily-modules", message: "x" }];
    const owner = api.status.owner;
    if (!api.mods.has(body.mod)) { api.mods.add(body.mod); api.status.left = Math.max(0, api.status.left - 1); }
    const items = [];
    for (let k = 0; k < body.n; k++) items.push(item(body.mod, owner && k === 1));
    let out = items, dropped = [];
    // the student's first round: the checks drop one question
    if (!owner && (api.q[body.mod] || 0) === 0) { out = items.slice(0, body.n - 1); dropped = [{ why: ["disagree"] }]; }
    api.q[body.mod] = (api.q[body.mod] || 0) + out.length;
    return [200, { items: out, dropped, flagged: owner ? 1 : dropped.length, usage, left: { modules: api.status.left, questions: Math.max(0, 30 - api.q[body.mod]) } }];
  }
  if (body.op === "stage") {
    if (!api.status.owner) return [403, { error: "owner-only" }];
    return [200, { stageId: "s20261010-abc123", n: body.items.length, cmd: "node tools/prep-qgen.mjs publish --stage s20261010-abc123" }];
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
const SIZES = [[390, 844, 3, true], [820, 1180, 2, true]];
const setSize = async ([w, h, d, mob]) => { await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: d, mobile: mob }); await ev(`window.dispatchEvent(new Event("resize")); return 1;`); await sleep(300); };
const shots = async (name) => {
  if (!process.env.SHOTS) return;
  mkdirSync(process.env.SHOTS, { recursive: true });
  await ev(`if (!document.getElementById("pnNoTr")) { var t = document.createElement("style"); t.id = "pnNoTr"; t.textContent = "*{transition:none!important;animation-duration:0s!important}"; document.head.appendChild(t); } return 1;`);
  for (const sz of SIZES) {
    await setSize(sz);
    for (const theme of ["dark", "light"]) {
      await ev(theme === "dark" ? `document.body.classList.add("dark"); return 1;` : `document.body.classList.remove("dark"); return 1;`);
      await sleep(300);
      const r = await call("Page.captureScreenshot", { format: "png" });
      if (r.result) writeFileSync(join(process.env.SHOTS, "qgen-" + name + "-" + sz[0] + "-" + theme + ".png"), Buffer.from(r.result.data, "base64"));
    }
  }
  await setSize(SIZES[0]);
  await ev(`document.body.classList.add("dark"); var t=document.getElementById("pnNoTr"); if (t) t.remove(); return 1;`);
};
const screenText = () => ev(`var r=document.getElementById("smdPrep"); return r ? r.innerText : "";`);
const smallButtons = () => ev(`var r=document.getElementById("smdPrep"); if(!r) return "none"; return [].filter.call(r.querySelectorAll("#qgCreateView button, #qgProgView button, #qgAuthView button, #qgRevView button"), function(b){ return b.offsetParent && b.offsetHeight < 44; }).map(function(b){ return (b.getAttribute("data-act")||"") + ":" + b.offsetHeight; }).join(",");`);
const qgCalls = (op) => api.calls.filter((c) => c.op === op);
const goTests = async () => { await ev(`try{localStorage.setItem("smd_prep_tt","qbank");}catch(e){} var H=PREP._host; H.push(H.screens.mocks); return 1;`); await sleep(300); };
const goMenu = async () => { await ev(`var H=PREP._host; H.push(H.screens.menu); return 1;`); await sleep(300); };
const hasRow = (act) => ev(`return !!document.querySelector('#smdPrep [data-act="${act}"]');`);
const reopen = async () => { await ev(`PREP.close(); PREP.open(); return 1;`); await until(`return PREP.isOpen() && !!document.querySelector("#smdPrep .pn-tile");`, 15000); };

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start: " + chromeErr.slice(-500));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP|qgen/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
    if (m.method === "Fetch.requestPaused") {
      const p = m.params, url = p.request.url;
      let status = 404, body = { error: "not-found", note: "blocked by the test harness" };
      let post = p.request.postData;
      if (!post && p.request.hasPostData) { const r = await call("Fetch.getRequestPostData", { requestId: p.requestId }); post = r.result && r.result.postData; }
      if (/\/api\/ai\/prep-qgen/.test(url)) {
        const h = p.request.headers || {};
        [status, body] = qgenReply(JSON.parse(post || "{}"), h.Authorization || h.authorization);
        if (api.slow && /"op":"gen"/.test(post || "")) await sleep(api.slow);
      } else if (/\/api\/prep\/decks/.test(url)) { status = 200; body = p.request.method === "GET" ? { salt: "AAAA", decks: [] } : { ok: true }; }
      else api.other.push(url);
      call("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
    }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {}); await call("DOM.enable", {});
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
  await setSize(SIZES[0]);
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false; try{localStorage.setItem("smd_prep","1");}catch(e){}` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  const signIn = `window.SMD_AUTH = { currentUser: { uid: "u-test", email: "student@example.com", getIdToken: function () { return Promise.resolve("test-token"); } } }; return 1;`;
  await call("Page.navigate", { url: BASE });
  ok(await until(`return !!(window.PREP && window.SMD_showHome);`, 30000), "app boots");
  await ev(clean);
  await ev(`try{localStorage.removeItem("smd_prep_v1"); localStorage.removeItem("smd_prep_qgen_author");}catch(e){} indexedDB.deleteDatabase("prep-gen"); ` + signIn);
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return PREP.isOpen() && !!document.querySelector("#smdPrep .pn-tile") && !!window.PREP_QGEN;`, 25000), "PrepNucleus opens and prep-qgen.js loads");
  ok(await ev(`return PREP_LOADER.JS.indexOf("prep-qgen.js") > PREP_LOADER.JS.indexOf("prep-create.js") && !!document.querySelector('link[data-prep="prep-qgen.css"]');`) === true, "loader: prep-qgen.js after prep-create.js, prep-qgen.css");

  // ---- off: no entry points
  await sleep(300);
  ok(qgCalls("status").length >= 1, "the app asked the server for the feature status (" + qgCalls("status").length + ")");
  await goTests();
  ok(await hasRow("custom") && !(await hasRow("g-new")), "feature off: QBank has Custom module and no Create a module with MaiK");
  await goMenu();
  ok(!(await hasRow("g-new")) && !(await hasRow("g-author")), "feature off: Menu has neither row");

  // ---- student on
  api.status = Object.assign({}, api.status, { on: true, student: true, owner: false, models: ["claude-sonnet-5-5", "claude-haiku-5-5"] });
  await reopen(); await ev(signIn); await ev(`PREP_QGEN.refresh(PREP._host, true); return 1;`); await sleep(400);
  await goTests();
  ok(await until(`return !!document.querySelector('#smdPrep [data-act="g-new"]');`, 5000), "student on: QBank shows Create a module with MaiK");
  ok(/3 of 3 free modules left today/.test(await screenText()), "the row says 3 of 3 free modules left today");
  await goMenu();
  ok(await hasRow("g-new") && !(await hasRow("g-author")), "Menu: the create row, no Author row for a student");
  await click('#smdPrep [data-act="g-new"]');
  ok(await until(`return !!document.getElementById("qgCreateView");`, 5000), "create screen opens");
  ok(/not from the PrepNucleus library/.test(await screenText()), "topic mode says the questions are not from the library");
  ok(/not official exam questions/.test(await screenText()), "the safety note is shown");
  await ev(`var i=document.getElementById("qgTopic"); i.value="Diabetic ketoacidosis"; i.dispatchEvent(new Event("input")); return 1;`);
  ok(await smallButtons() === "", "create: every button 44 px or taller (" + (await smallButtons()) + ")");
  await shots("create");
  // notes mode: own-material check and short text refused
  await click('#smdPrep [data-act="g-src"][data-v="notes"]');
  ok(await until(`return !!document.getElementById("qgText");`, 3000), "notes mode shows the text box");
  await click('#smdPrep [data-act="g-go"]');
  ok(await until(`var e=document.getElementById("qgErr"); return !!e && /Confirm/.test(e.textContent);`, 3000), "notes without the own-material check: refused in words");
  await click('#smdPrep [data-act="g-src"][data-v="topic"]');
  api.slow = 900;
  await click('#smdPrep [data-act="g-go"]');
  ok(await until(`return !!document.getElementById("qgProgView") && !!document.getElementById("qgCount");`, 5000), "progress screen shows");
  await sleep(300);
  await shots("progress");
  ok(await until(`var p=document.getElementById("qgProgView"); return !!p && !document.getElementById("qgCount") && /Module ready|partly made/.test(document.body.innerText);`, 30000), "the module finishes");
  api.slow = 0;
  const gens = qgCalls("gen");
  ok(gens.length === 3 && gens.every((c) => c.body.n <= 5 && c.auth === "Bearer test-token" && /^qg[0-9a-f]{24}$/.test(c.body.idem)), "three rounds (5, 5, then 1 to make up the dropped one), each with the token and an idem key");
  ok(gens[1].body.avoid.length === 4 && gens[2].body.avoid.length === 9, "later rounds send the earlier stems to avoid");
  ok(gens.every((c) => c.body.exam === "neet-pg" && c.body.topic === "Diabetic ketoacidosis" && !c.body.ground), "topic, exam, no grounding");
  const res = await screenText();
  ok(/10\s*\n?\s*questions ready/.test(res) && /1 question was left out/.test(res), "result: 10 ready, 1 left out by the checks");
  ok(await smallButtons() === "", "result: buttons 44 px or taller");
  await shots("result");
  // the module is a private deck
  const decks = await (async () => { for (let i = 0; i < 20; i++) { const v = await ev(`return window.__d || null;`); if (v) return v; await ev(`PREP_DECKS.listDecks().then(function(l){ window.__d = JSON.stringify(l.map(function(m){ return { id: m.id, src: m.source.type, n: PREP_DECKS.questionCount(m), g: m.qgen && m.qgen.g }; })); }); return 1;`); await sleep(200); } return null; })();
  const list = JSON.parse(decks || "[]");
  ok(list.length === 1 && list[0].src === "maik" && list[0].n === 10 && list[0].g === 0, "saved as a private deck: source maik, 10 questions, not grounded (" + decks + ")");
  // start practising -> the mode sheet
  await click('#smdPrep [data-act="g-prac"]');
  ok(await until(`return !!document.querySelector('#smdPrep .su-modes');`, 8000), "Start practising opens the mode sheet (Learning / Test Mode)");
  ok(/Learning Mode/.test(await screenText()) && /Test Mode/.test(await screenText()), "both modes offered");
  await click('#smdPrep [data-act="su-go"]');
  ok(await until(`return !!document.querySelector("#smdPrep .pn-opt");`, 8000), "the runner starts with a MaiK question");
  await click('#smdPrep .pn-opt');
  ok(await until(`return !!document.querySelector("#smdPrep .qg-prov");`, 5000), "after answering: the honest line (Created with MaiK, not from the library)");
  ok(await hasRow("report"), "a MaiK question can be reported");
  await click('#smdPrep [data-act="report"]');
  await until(`return !!document.querySelector('#smdPrep [data-act="sendreport"]');`, 3000);
  await click('#smdPrep [data-act="sendreport"][data-v="wrong-key"]');
  await sleep(500);
  const rep = qgCalls("report");
  ok(rep.length === 1 && rep[0].body.why === "wrong-key" && /^q_[0-9a-f]{12}$/.test(rep[0].body.id) && /^gen_[0-9a-f]{12}$/.test(rep[0].body.mod) && !rep[0].body.q, "report: op report with ids and the reason only");
  // offline reopen: the module from Your decks, practised with no connection
  await reopen(); await ev(signIn);
  await call("Network.enable", {}); await call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await ev(`PREP._host.push(function(){}); PREP_C.act("c-home", null, PREP._host); return 1;`);
  ok(await until(`return document.querySelectorAll("#pcDecks .pc-drow").length === 1;`, 8000), "offline: the module is listed in Your decks");
  await click('#pcDecks [data-act="c-open"]');
  ok(await until(`return /Created with MaiK/.test((document.querySelector("#pcDeckView")||{}).textContent||"");`, 5000), "the module screen says Created with MaiK");
  ok(await until(`return /10 of 30/.test(document.body.innerText) || /of 30 questions/.test(document.body.innerText);`, 3000), "and holds up to 30");
  await click('#pcDeckView [data-act="c-prac"]');
  ok(await until(`return !!document.querySelector('#smdPrep .su-modes');`, 5000), "offline: the mode sheet opens");
  await click('#smdPrep [data-act="su-go"]');
  ok(await until(`return !!document.querySelector("#smdPrep .pn-opt");`, 5000), "offline: the module practises");
  await call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // ---- limit reached
  api.mode = "limit"; api.status.left = 0;
  await reopen(); await ev(signIn); await ev(`PREP_QGEN.refresh(PREP._host, true); return 1;`); await sleep(300);
  await goMenu();
  ok(/0 of 3 free modules left today/.test(await screenText()), "the row says 0 of 3 left");
  await click('#smdPrep [data-act="g-new"]');
  await until(`return !!document.getElementById("qgCreateView");`, 5000);
  ok(await ev(`var b=document.querySelector('#smdPrep [data-act="g-go"]'); return !!b && b.disabled && /Back tomorrow/.test(b.textContent) && /free modules are used/.test(document.body.innerText);`) === true, "known limit: the create screen says so and Create is disabled");
  await shots("limit");
  // a stale status (the phone thought one was left): the server's 429 is said in plain words
  await ev(`var s=PREP_QGEN.status(); s.left=1; PREP_QGEN._setStatus(s); PREP._host.rerender(); return 1;`);
  await ev(`var i=document.getElementById("qgTopic"); i.value="Thyroid storm"; i.dispatchEvent(new Event("input")); return 1;`);
  await click('#smdPrep [data-act="g-go"]');
  ok(await until(`var e=document.getElementById("qgErr"); return !!e && /free modules are used/i.test(e.textContent) && document.querySelectorAll("#qgProgView .qg-limit, #qgProgView .pn-err").length === 1 && !document.getElementById("qgMade");`, 8000), "429 daily-modules: the plain limit message, no empty score card");
  ok(!(await hasRow("g-prac")) && !(await hasRow("g-retry")), "limit: nothing to practise, no retry (it would fail again)");
  await shots("limit2");
  api.mode = "ok";

  // ---- owner
  api.status = Object.assign({}, api.status, { owner: true, left: 3 });
  await reopen(); await ev(signIn.replace("student@example.com", "drmanojkurmana@gmail.com")); await ev(`PREP_QGEN.refresh(PREP._host, true); return 1;`); await sleep(300);
  await goMenu();
  ok(await until(`return !!document.querySelector('#smdPrep [data-act="g-author"]');`, 5000), "owner: the Author row shows");
  await click('#smdPrep [data-act="g-author"]');
  ok(await until(`return !!document.getElementById("qgAuthView") && document.querySelectorAll("#qgASub option").length > 1;`, 8000), "Author screen with the subjects");
  await ev(`var s=document.getElementById("qgASub"); s.value=s.options[1].value; s.dispatchEvent(new Event("change")); return 1;`);
  await until(`return document.querySelectorAll("#qgAMod option").length > 1;`, 8000);
  await ev(`var m=document.getElementById("qgAMod"); m.value=m.options[1].value; m.dispatchEvent(new Event("change")); return 1;`);
  await sleep(200);
  await ev(`var n=document.getElementById("qgAN"); n.value="5"; n.dispatchEvent(new Event("input")); n.dispatchEvent(new Event("change")); return 1;`);
  ok(/Write 5 questions/.test(await screenText()), "owner: 5 questions run now");
  await shots("author");
  await click('#smdPrep [data-act="g-arun"]');
  ok(await until(`return !!document.querySelector('#smdPrep [data-act="g-areview"]');`, 10000), "owner run done: Review row" + (await ev(`var e=document.getElementById("qgAErr"); return e ? " ERR " + e.textContent : " " + JSON.stringify(PREP_QGEN._au() && { s: PREP_QGEN._au().subject, m: PREP_QGEN._au().module, t: PREP_QGEN._au().topic, n: PREP_QGEN._au().n });`)));
  const og = qgCalls("gen").slice(-1)[0];
  ok(og && Array.isArray(og.body.bank) && og.body.bank.length >= 1 && /\/mcq\/.+\.json$/.test(og.body.bank[0]), "owner run sends the module's bank file for the duplicate check (" + (og && og.body.bank) + ")");
  await click('#smdPrep [data-act="g-areview"]');
  ok(await until(`return document.querySelectorAll("#qgRevView .qg-item").length === 5;`, 5000), "review lists 5 items");
  ok(await ev(`return document.querySelectorAll("#qgRevView .qg-flag").length;`) === 1, "one is flagged with the checker's reason");
  await click('#smdPrep [data-act="g-abulk"]');
  ok(await ev(`return document.querySelectorAll("#qgRevView .qg-item.is-ok").length;`) === 4, "Approve all unflagged approves 4");
  await click('#smdPrep [data-act="g-aedit"][data-i="0"]');
  await ev(`var t=document.getElementById("qgE0"); t.value="Edited stem by the owner?"; t.dispatchEvent(new Event("input")); return 1;`);
  await click('#smdPrep [data-act="g-aedit"][data-i="0"]');
  await click('#smdPrep [data-act="g-adrop"][data-i="2"]');
  ok(await smallButtons() === "", "review: buttons 44 px or taller (" + (await smallButtons()) + ")");
  await shots("review");
  await click('#smdPrep [data-act="g-astage"]');
  ok(await until(`return !!document.getElementById("qgCmd");`, 8000), "staged: the publish command shows");
  const sg = qgCalls("stage")[0];
  ok(sg && sg.body.items.length === 3 && sg.body.items[0].q === "Edited stem by the owner?" && sg.body.items.every((x) => x.qg.v === "ok"), "stage sends only the 3 approved items, with the edit");
  ok(/node tools\/prep-qgen\.mjs publish --stage s20261010-abc123/.test(await screenText()), "the command is shown to copy");

  // ---- text and errors
  const all = await screenText();
  ok(!DASH.test(all), "no em or en dash on the last screen");
  ok(api.other.every((u) => /\/api\//.test(u)), "every other /api/ request was answered locally (" + api.other.length + ")");
  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN: PrepNucleus MaiK modules" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally {
  try { ws && ws.close(); } catch {} if (serveProc) serveProc.kill();
  const gone = new Promise((res) => { if (chrome.exitCode != null) return res(); chrome.once("exit", res); });
  chrome.kill();
  await Promise.race([gone, sleep(3000)]);
  if (chrome.exitCode == null) { try { chrome.kill("SIGKILL"); } catch {} await Promise.race([gone, sleep(2000)]); }
  await sleep(300);
  try { if (userDir && /prep-qgen-chrome-/.test(userDir)) rmSync(userDir, { recursive: true, force: true }); } catch {}
  process.exit(fails === 0 ? 0 : 1);
}
