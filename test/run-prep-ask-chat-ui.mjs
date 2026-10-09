/* PrepNucleus Ask MaiK as a short chat, and the MaiK AI mark, in the REAL app (headless Chrome over CDP) on the fixture
 * bank. Owner requests 2026-10-09 evening:
 * - after the first answer a box takes follow-up doubts on the same MCQ; each goes to /api/ai/prep-teach (answered here
 *   by the test) as kind "chat" with the same grounding, the newest turns and a summary of older ones, size capped;
 *   MaiK Tokens show under every online answer; after 10 student messages the box gives way to "Continue this in MaiK
 *   Assistant", which opens the app's main MaiK with the topic chip and a short summary typed in;
 * - the thread is kept per item (reopening shows it, it survives a reload); "not covered" offers the hand-off; a failed
 *   answer offers Try again (not a new message); on this phone the follow-up runs on the phone's model, nothing sent;
 * - the MaiK AI mark (assets/maik-ai-mark.svg via maik-ai-mark.js) is on the Ask MaiK button, the sheet header and
 *   MaiK's avatars; the main MaiK assistant and the footer keep their own logos (no mark inside them).
 * USAGE: node test/run-prep-ask-chat-ui.mjs   (CHROME=<binary>, SHOTS=<dir> saves screenshots at 390, 820, 1180)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, rmSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-chat-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep/";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const size = (w, h, mobile = true) => call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
const shot = async (name) => {
  if (!process.env.SHOTS) return;
  for (const dark of [false, true]) {
    await ev(`document.body.classList.toggle("dark", ${dark}); document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`);
    await sleep(160);
    const r = await call("Page.captureScreenshot", { format: "png" });
    if (r.result) writeFileSync(join(process.env.SHOTS, name + (dark ? "-dark" : "-light") + ".png"), Buffer.from(r.result.data, "base64"));
  }
  await ev(`document.body.classList.remove("dark"); return 1;`);
};
// The server's answer per request (a function of the parsed body); every request is kept.
let answer = () => ({ status: 200, body: { text: "The answer is the key, as the stored explanation says.", usage: { mt: 52 }, wallet: { balanceMt: 1900, costCapOn: true } } });
const reqs = [];

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Fetch.requestPaused") {
      const rq = m.params.request; let body = {}; try { body = JSON.parse(rq.postData || "{}"); } catch {}
      reqs.push({ auth: (rq.headers && (rq.headers.Authorization || rq.headers.authorization)) || "", body, raw: rq.postData || "" });
      const a = answer(body);
      call("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: a.status, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(a.body)).toString("base64") });
    }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP|maik-ai-mark/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await size(390, 844);
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_SETUP=false; window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;` });
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/ai/prep-teach*" }] });
  const boot = async () => {
    await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome && window.SMD_MAIK_MARK);`, 30000);
    await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); window.SMD_AUTH = { currentUser: { uid: "s1", getIdToken: function () { return Promise.resolve("tok-1"); } } }; return 1;`);
    await ev(`PREP.open(); return 1;`);
    return until(`return !!document.querySelector("#smdPrep .pn-home") && !!window.PREP_ASK;`, 20000);
  };
  ok(await boot(), "PrepNucleus opens with prep-ask.js and the MaiK AI mark helper");
  await ev(`try{localStorage.removeItem("smd_prep_v1"); localStorage.removeItem("smd_prep_ask_v1");}catch(e){} PREP_ASK._resetThreads(); var s=PREP._host.store(); s.ask={m:"online",q:1}; PREP._host.save(); return 1;`);
  ok(await until(`var s=document.getElementById("mkaiSprite"); return !!s && !!s.querySelector("#mkai-full") && !!s.querySelector("#mkai-tile-mark") && s.getBoundingClientRect().width === 0;`, 8000), "the MaiK AI mark sprite is in the page once, from assets/maik-ai-mark.svg, at zero size");

  const startQ = async (wrong) => {
    await ev(`PREP._st.run=null; PREP._st.stack.length=1; PREP._host.home(); return 1;`);
    await click('#smdPrep .pn-tile[data-s=anatomy]'); await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=ana-gametogenesis]');`, 8000);
    await click('#smdPrep .pn-mod[data-m=ana-gametogenesis]'); await until(`return !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 8000);
    await click('#smdPrep [data-act=start][data-k=study]'); await until(`return !!document.querySelector("#smdPrep .pn-q");`, 8000);
    await ev(`var r=PREP._st.run, it=r.items[r.i]; document.querySelector('#smdPrep .pn-opt[data-k="'+(${wrong ? "(it.a+1)%4" : "it.a"})+'"]').click(); return 1;`);
    return until(`return !!document.querySelector("#smdPrep .pn-fb [data-act=ask]");`, 4000);
  };
  const sendDoubt = async (txt) => {
    await ev(`var t=document.getElementById("paIn"); t.focus(); t.value=${JSON.stringify(txt)}; t.dispatchEvent(new Event("input",{bubbles:true})); t.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true})); return 1;`);
  };
  const nAnswers = () => ev(`return document.querySelectorAll("#pnAsk .pt-msg.ai .pt-ans-b").length;`);

  // ---- the Ask MaiK button carries the mark
  ok(await startQ(true), "a wrong answer offers Ask MaiK");
  const btn = JSON.parse(await ev(`var b=document.querySelector("#smdPrep .pn-fb [data-act=ask]"), av=b.querySelector(".pt-av"), sv=av&&av.querySelector("svg.mkai"), u=sv&&sv.querySelector("use"); return JSON.stringify({ mk: !!av && av.classList.contains("mk"), use: u && u.getAttribute("href"), w: sv ? Math.round(parseFloat(getComputedStyle(sv).width)) : 0, bg: av ? getComputedStyle(av).backgroundImage : "", text: b.textContent });`));
  ok(btn.mk && btn.use === "#mkai-tile-mark" && btn.w === 32 && btn.bg === "none" && /Ask MaiK$/.test(btn.text), "the Ask MaiK button shows the MaiK AI mark tile (32 px, no old picture): " + JSON.stringify(btn));
  await shot("chat-button-p390");

  // ---- first answer, then the follow-up box
  answer = (b) => ({ status: 200, body: { text: b.kind === "chat" ? "The stored explanation says the key is right for this reason." : "The answer is the key, as the stored explanation says.", usage: { mt: 40 + (b.turn || 1) }, wallet: { balanceMt: 1900 - (b.turn || 1), costCapOn: true } } });
  await click("#smdPrep [data-act=ask]");
  ok(await until(`return !!document.querySelector("#pnAsk .pa-last") && !!document.getElementById("paIn");`, 6000), "online first answer, then the follow-up box");
  const head = JSON.parse(await ev(`var w=document.getElementById("pnAsk"); return JSON.stringify({ top: (w.querySelector(".pa-top .pt-av.mk use")||{getAttribute:function(){return ""}}).getAttribute("href"), av: w.querySelectorAll(".pt-msg.ai .pt-av.mk svg").length, left: (w.querySelector("#paLeft")||{}).textContent, ph: w.querySelector("#paIn").getAttribute("placeholder"), fs: getComputedStyle(w.querySelector("#paIn")).fontSize, send: Math.round(parseFloat(getComputedStyle(w.querySelector(".pa-send")).height)) });`));
  ok(head.top === "#mkai-tile-mark" && head.av === 1, "the sheet header and MaiK's avatar carry the mark: " + JSON.stringify(head));
  ok(head.left === "9 questions left in this chat" && head.ph === "Ask a follow-up doubt…" && head.fs === "16px" && head.send >= 44, "the box: 9 left, its placeholder, 16 px text (no iOS zoom), a 44 px send button: " + JSON.stringify(head));
  ok(reqs.length === 1 && reqs[0].body.kind === "mcq", "the first ask is the usual mcq request");

  // ---- a follow-up doubt
  await sendDoubt("Why not the other options?");
  ok(await until(`return document.querySelectorAll("#pnAsk .pt-msg.ai .pt-ans-b").length === 2 && !document.querySelector('#pnAsk .pt-msg[data-key=typing]');`, 6000), "the follow-up gets its own checked answer");
  const r2 = reqs[reqs.length - 1].body;
  ok(r2.kind === "chat" && r2.base === "mcq" && r2.turn === 2 && /^Question: Fixture question/.test(r2.ground) && /Correct answer: [A-D]\./.test(r2.ground) && r2.messages.length === 3 && r2.messages[2].r === "u" && r2.messages[2].t === "Why not the other options?" && r2.messages[1].r === "m" && /^ck[0-9a-z]+/.test(r2.idem), "follow-up request: kind chat, turn 2, the same grounding, the turns so far, an idempotency id: " + JSON.stringify({ kind: r2.kind, turn: r2.turn, n: r2.messages.length, idem: r2.idem }));
  ok(reqs[reqs.length - 1].auth === "Bearer tok-1", "signed in");
  const notes = await ev(`return Array.prototype.map.call(document.querySelectorAll("#pnAsk .pt-note"), function(n){return n.textContent;}).join("|");`);
  ok(/Used about 41 MaiK Tokens; 1,899 left in your account\..*\|.*Used about 42 MaiK Tokens; 1,898 left in your account\./.test(notes), "MaiK Tokens shown under every online answer: " + notes);
  ok(await ev(`return document.getElementById("paLeft").textContent === "8 questions left in this chat" && document.getElementById("paIn").value === "" && document.querySelectorAll("#pnAsk .pt-msg.me").length === 2;`) === true, "the box is cleared and counts down (8 left)");
  ok(await ev(`return document.querySelectorAll("#pnAsk [role=status].pt-ans-b").length === 1 && !!document.querySelector("#pnAsk .pa-last[role=status]");`) === true, "only the newest answer is the live region");
  await shot("chat-two-p390");

  // ---- a failed answer: Try again, not a new message
  answer = (b) => b.kind === "chat" ? { status: 502, body: { error: "ai-failed", reason: "provider" } } : { status: 200, body: { text: "x" } };
  await sendDoubt("Is this about the second option?");
  ok(await until(`var l=document.querySelector("#pnAsk .pa-last"); return !!l && /could not answer online/.test(l.textContent) && !!l.querySelector("[data-act=ak-retry]");`, 6000), "a failed answer says so and offers Try again");
  ok(await ev(`return document.getElementById("paLeft").textContent;`) === "7 questions left in this chat", "the failed doubt still counts as the student's message (7 left)");
  answer = (b) => ({ status: 200, body: { text: "The stored explanation says the key is right for this reason.", usage: { mt: 40 + (b.turn || 1) }, wallet: { balanceMt: 1800, costCapOn: true } } });
  const beforeRetry = reqs.length;
  await click("#pnAsk [data-act=ak-retry]");
  ok(await until(`var l=document.querySelector("#pnAsk .pa-last"); return !!l && /MaiK explains/.test(l.textContent) && document.querySelectorAll("#pnAsk .pt-msg.me").length === 3;`, 6000), "Try again answers the same message, no new student message");
  ok(reqs.length === beforeRetry + 1 && reqs[reqs.length - 1].body.turn === 3 && reqs[reqs.length - 1].body.messages.filter((x) => x.r === "m").every((x) => x.t !== ""), "the retry is one request for turn 3; failed answers are not sent back");

  // ---- on to 10 student messages: context stays small, then the hand-off
  for (let n = 4; n <= 10; n++) {
    await sendDoubt("Doubt " + n + ": how does the stored explanation put it?");
    await until(`return document.querySelectorAll("#pnAsk .pt-msg.me").length === ${n} && !document.querySelector('#pnAsk .pt-msg[data-key=typing]') && !!document.querySelector("#pnAsk .pa-last");`, 6000);
  }
  const last = reqs[reqs.length - 1];
  ok(last.body.turn === 10 && last.body.messages.length <= 6 && last.body.messages[0].r === "u" && typeof last.body.summary === "string" && /^The student asked: /.test(last.body.summary) && last.raw.length < 16 * 1024, "10th message: turn 10, at most 6 turns as written, older ones summarised, under 16 KB: " + JSON.stringify({ turn: last.body.turn, n: last.body.messages.length, bytes: last.raw.length, summary: (last.body.summary || "").slice(0, 60) }));
  const hand = JSON.parse(await ev(`var w=document.getElementById("pnAsk"), h=w.querySelector(".pa-hand"); return JSON.stringify({ box: !!w.querySelector("#paIn"), hand: h ? h.textContent : "", btn: h && h.querySelector("[data-act=ak-hand]") ? h.querySelector("[data-act=ak-hand]").textContent : "", mk: !!(h && h.querySelector("[data-act=ak-hand] svg.mkai use[href='#mkai-mark']")), ai: /\\bAI\\b/.test(w.textContent), dash: /[\\u2014\\u2013]/.test(w.textContent) });`));
  ok(!hand.box && /This chat has reached 10 questions\./.test(hand.hand) && hand.btn === "Continue this in MaiK Assistant" && hand.mk, "after 10 student messages: no box, a clear hand-off to MaiK Assistant with the mark: " + JSON.stringify(hand));
  ok(!hand.ai && !hand.dash, "no AI label and no em or en dash in the sheet");
  const nReq = reqs.length;
  await shot("chat-handoff-p390");
  await size(820, 1180); await sleep(250); await ev(`var b=document.querySelector("#pnAsk .pa-body"); if(b) b.scrollTop=b.scrollHeight; return 1;`); await shot("chat-handoff-p820");
  await size(1180, 820); await sleep(250); await ev(`var b=document.querySelector("#pnAsk .pa-body"); if(b) b.scrollTop=b.scrollHeight; return 1;`); await shot("chat-handoff-l1180");
  await size(390, 844); await sleep(250);

  // ---- the thread is kept: close, reopen, reload
  await click("#pnAsk .pa-top [data-act=ak-close]");
  await click("#smdPrep [data-act=ask]");
  ok(await until(`var w=document.getElementById("pnAsk"); return !!w && w.querySelectorAll(".pt-msg.me").length === 10 && !!w.querySelector(".pa-hand");`, 4000) && reqs.length === nReq, "reopened on the same question: the thread and the hand-off, no new request");
  ok(await ev(`var o=JSON.parse(localStorage.getItem("smd_prep_ask_v1")||"{}"), k=Object.keys(o.th||{}); return k.length === 1 && /^q:/.test(k[0]) && o.th[k[0]].turns.length === 20;`) === true, "kept on the phone: one thread, 20 turns");

  // ---- the hand-off opens the main MaiK assistant with the topic and a summary
  const runTitle = await ev(`return PREP._st.run.title;`);
  await click("#pnAsk [data-act=ak-hand]");
  ok(await until(`var q=document.getElementById("maikQ"); return !document.getElementById("pnAsk") && !!document.getElementById("maikSheet") && !!q && /My next doubt: $/.test(q.value);`, 6000), "Continue this in MaiK Assistant: the sheet closes, MaiK opens with the summary typed in");
  const mk = JSON.parse(await ev(`var q=document.getElementById("maikQ"), t=document.getElementById("maikTopicName"), bar=document.getElementById("maikTopicBar"), s=document.getElementById("maikSheet"); return JSON.stringify({ q: q.value, topic: t ? t.textContent : "", hidden: bar ? bar.hidden : null, marks: s.querySelectorAll(".mkai, use[href^='#mkai']").length, logos: Array.prototype.map.call(s.querySelectorAll("img"), function(i){return i.getAttribute("src")||"";}).filter(function(x){return /maik/i.test(x);}).length });`));
  ok(/^PrepNucleus question: Fixture question/.test(mk.q) && /Answer: [A-D]\. /.test(mk.q) && /The student asked: /.test(mk.q) && mk.q.length <= 1000, "the prefill: the question, its answer, what was asked: " + mk.q.slice(0, 120));
  ok(mk.topic === "About: " + String(runTitle).slice(0, 80) && mk.hidden === false, "the topic chip names the set: " + mk.topic);
  ok(mk.marks === 0, "the main MaiK assistant keeps its own logo: no MaiK AI mark inside it (" + mk.marks + ")");
  ok(reqs.length === nReq, "the hand-off sends nothing by itself");
  await shot("chat-assistant-prefill-p390");
  await ev(`var s=document.getElementById("maikSheet"), c=document.getElementById("maikScrim"); if(s) s.remove(); if(c) c.remove(); document.body.classList.remove("maik-open"); return 1;`);

  // ---- the footer logo is unchanged
  const foot = await ev(`var a=document.querySelectorAll(".v4-maik .v4-maik-logo"); return a.length ? Array.prototype.map.call(a, function(i){return i.getAttribute("src");}).join(",") + "|" + document.querySelectorAll(".v4-maik .mkai").length : "none";`);
  ok(foot === "none" || /^\/maik-logo\.png,\/maik-logo-white\.png(,\/maik-logo\.png,\/maik-logo-white\.png)*\|0$/.test(foot), "the footer MaiKnowledge logo is untouched: " + foot);

  // ---- reload: the thread survives (the same item opened again; a new run may order the questions differently)
  const itemJson = await ev(`var r=PREP._st.run, it=r.items[r.i]; return JSON.stringify({ item: { id: it.id, q: it.q, o: it.o, a: it.a, exp: it.exp }, chosen: r.ans[r.i] });`);
  ok(await boot(), "reload");
  ok(await startQ(true), "a question is open again");
  await ev(`var x=${itemJson}; PREP_ASK.open({ kind: "mcq", item: x.item, chosen: x.chosen }, PREP._host); return 1;`);
  ok(await until(`var w=document.getElementById("pnAsk"); return !!w && w.querySelectorAll(".pt-msg.me").length === 10 && !!w.querySelector(".pa-hand");`, 5000), "after a reload the thread is still there");
  await click("#pnAsk .pa-top [data-act=ak-close]");

  // ---- not covered: the hand-off is offered at once
  await ev(`PREP_ASK._resetThreads(); return 1;`);
  answer = (b) => ({ status: 200, body: { text: b.kind === "chat" ? "The stored explanation does not cover this." : "The answer is the key, as the stored explanation says.", usage: { mt: 30 }, wallet: { balanceMt: 0, costCapOn: false } } });
  await click("#smdPrep [data-act=ask]");
  ok(await until(`return !!document.getElementById("paIn") && !!document.querySelector("#pnAsk .pa-last") && !document.querySelector('#pnAsk .pt-msg[data-key=typing]');`, 6000), "a fresh thread: the first answer");
  await sendDoubt("What about a drug from another chapter?");
  ok(await until(`var l=document.querySelector("#pnAsk .pa-last"); return !!l && /does not cover this doubt/.test(l.textContent) && !!document.querySelector("#pnAsk .pa-hchip [data-act=ak-hand]") && !!document.getElementById("paIn");`, 6000), "not covered: said plainly, Continue in MaiK Assistant offered, the box stays");
  await shot("chat-notcovered-p390");
  await click("#pnAsk .pa-top [data-act=ak-close]");

  // ---- on this phone: the follow-up runs on the phone's model, nothing is sent
  await ev(`PREP_ASK._reset(); PREP_ASK._resetThreads(); window.__capWas = window.Capacitor; window.__sys = [];
    window.Capacitor = { isNativePlatform: function () { return true; }, getPlatform: function () { return "ios"; }, isPluginAvailable: function (n) { return n === "Device"; }, Plugins: { Device: { getInfo: function () { return Promise.resolve({ model: "iPhone16,1", platform: "ios", osVersion: "26.0" }); } } } };
    window.SMD_MAIK_MODELS = { PACKS: { "maik-lite": { label: "MaiK Lite" } }, installed: function () { return Promise.resolve(true); }, installedCached: function () { return true; }, suitability: function () { return { level: "ok" }; }, refreshDevice: function () { return Promise.resolve({ ramGB: 7.5 }); }, device: function () { return { ramGB: 7.5 }; } };
    window.SMD_MAIK_LOCAL = { available: function () { return true; }, currentPack: function () { return "maik-lite"; }, answer: function (q, o) { window.__sys.push({ s: o.systemOverride, q: q.question }); return Promise.resolve({ text: "The answer is the key, as the stored explanation says." }); } };
    var s=PREP._host.store(); s.ask={m:"local",q:1}; PREP._host.save(); return 1;`);
  const b5 = reqs.length;
  await click("#smdPrep [data-act=ask]");
  await until(`return !!document.getElementById("paIn") && /Written on this phone/.test((document.querySelector("#pnAsk .pa-last")||{}).parentNode ? document.querySelector("#pnAsk .pt-note").textContent : "");`, 6000);
  await sendDoubt("Say it more simply?");
  ok(await until(`return document.querySelectorAll("#pnAsk .pt-msg.ai .pt-ans-b").length === 2 && /Written on this phone by MaiK Lite/.test(document.querySelectorAll("#pnAsk .pt-note")[1].textContent);`, 6000), "on this phone: the follow-up is answered by the phone's model");
  const sys = JSON.parse(await ev(`return JSON.stringify(window.__sys);`));
  ok(reqs.length === b5 && sys.length === 2 && /follow-up doubts/.test(sys[1].s) && /\nCHAT:\nStudent: .*\nMaiK: .*\nStudent: Say it more simply\?\n/.test(sys[1].q), "on this phone: nothing sent; the chat prompt with the chat system prompt");
  ok(!/Used about/.test(await ev(`return document.getElementById("pnAsk").textContent;`)), "on this phone: no MaiK Tokens line");
  await click("#pnAsk .pa-top [data-act=ak-close]");
  await ev(`window.Capacitor = window.__capWas; delete window.SMD_MAIK_MODELS; delete window.SMD_MAIK_LOCAL; PREP_ASK._reset(); return 1;`);

  ok(!errors.length, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (e) {
  console.error(e); fails++;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill("SIGKILL"); if (serveProc) serveProc.kill();
  await sleep(300);
  try { rmSync(userDir, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
