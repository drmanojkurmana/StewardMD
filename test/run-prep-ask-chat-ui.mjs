/* PrepNucleus Ask MaiK as a chat, in the REAL app (headless Chrome over CDP) on the fixture bank.
 * Owner 2026-10-10 (iPhone recording): "chat screen is hard, make it fit the screen, keep it sliding type only, pulled
 * up on pressing Ask MaiK, and it doesn't answer like a chatbot. MaiK offline can have unlimited questions. Online it's
 * 10 max." This test holds:
 * - the sheet fits the viewport (390x844, 375x667, with the keyboard simulated by a shrunk visualViewport): one scroll
 *   region, the composer never covered, the newest message fully visible, the question as a collapsed one-line chip;
 * - replies answer the student's own message: the follow-up request carries the turns so far (multi-turn) and the
 *   owner's two prompts; the answer shown is the model's reply, not the stored explanation;
 * - online 10 a chat (client cap card, server 429 chat-limit honoured), Start a new chat (new chat id, no automatic
 *   ask), on this phone unlimited (25 messages, nothing sent), a phone without a model says so and offers Online;
 * - the MaiK AI mark on the button, the header and MaiK's avatars; the main MaiK assistant keeps its own logo.
 * USAGE: node test/run-prep-ask-chat-ui.mjs   (CHROME=<binary>, SHOTS=<dir> saves screenshots)
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
  ok(await until(`var s=document.getElementById("mkaiSprite"); return !!s && !!s.querySelector("#mkai-full") && !!s.querySelector("#mkai-tile") && !s.querySelector("#mkai-tile-mark") && !!s.querySelector("#mkai-word") && s.getBoundingClientRect().width === 0;`, 8000), "the MaiK AI mark sprite is in the page once, from assets/maik-ai-mark.svg, at zero size");

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
  ok(btn.mk && btn.use === "#mkai-tile" && btn.w === 32 && btn.bg === "none" && /Ask\sMaiK$/.test(btn.text), "the Ask MaiK button shows the MaiK AI mark tile (32 px, no old picture): " + JSON.stringify(btn));
  await shot("chat-button-p390");
  // MaiK in the label is the wordmark lettering (maik-ai-mark.js label()): drawn, sized to the text, the text kept for readers
  const wm = JSON.parse(await ev(`var b=document.querySelector("#smdPrep .pn-fb [data-act=ask]"), w=b.querySelector("svg.mkai-word"), t=b.querySelector(".mkai-wt"), r=w&&w.getBoundingClientRect(), fs=parseFloat(getComputedStyle(w.parentNode).fontSize), tr=t&&t.getBoundingClientRect(); return JSON.stringify({ use: w&&w.querySelector("use").getAttribute("href"), w: r&&Math.round(r.width), h: r&&Math.round(r.height*10)/10, fs: fs, hid: !!tr && tr.width <= 1, ok: document.documentElement.classList.contains("mkai-wok") });`));
  ok(wm.use === "#mkai-word" && wm.ok && wm.hid && Math.abs(wm.h - wm.fs * .75) < 1 && wm.w > wm.h * 3, "the button's MaiK is the wordmark, 0.75 em tall, its text visually hidden: " + JSON.stringify(wm));

  const STORED = "First-order kinetics: a constant fraction of the drug is eliminated per unit time.";
  // The "model": a reply about the student's own last message (what a real tutor reply looks like to the screen).
  answer = (b) => {
    if (b.kind !== "chat") return { status: 200, body: { text: "The answer is the key, as the stored explanation says.", usage: { mt: 40 + (b.turn || 1) }, wallet: { balanceMt: 1900 - (b.turn || 1), costCapOn: true } } };
    const last = b.messages[b.messages.length - 1].t;
    return { status: 200, body: { text: "Think of it like this. You asked: " + last + "\n- the key idea in plain words\n- how it links to this question", usage: { mt: 40 + b.turn }, wallet: { balanceMt: 1900 - b.turn, costCapOn: true } } };
  };
  const geo = () => ev(`var w=document.getElementById("pnAsk"), sh=w.querySelector(".pn-sheet"), b=w.querySelector(".pa-body"), c=w.querySelector(".pa-cmp")||w.querySelector(".pa-cap"), l=w.querySelector(".pa-last"), li=l&&l.closest("li"), vv=window.visualViewport, H=vv?vv.height+vv.offsetTop:innerHeight, R=function(e){if(!e)return null;var r=e.getBoundingClientRect();return {t:Math.round(r.top),b:Math.round(r.bottom),h:Math.round(r.height)};};
    return JSON.stringify({ H: Math.round(H), W: innerWidth, sheet: R(sh), body: R(b), comp: R(c), last: R(li), sheetScroll: sh.scrollHeight - sh.clientHeight, bodyOv: getComputedStyle(b).overflowY, scrollers: Array.prototype.filter.call(w.querySelectorAll("*"), function(e){ var s=getComputedStyle(e).overflowY; return (s==="auto"||s==="scroll") && e.scrollHeight > e.clientHeight + 1 && !e.classList.contains("pa-qr"); }).map(function(e){return e.className;}), atEnd: b.scrollHeight - b.scrollTop - b.clientHeight });`).then(JSON.parse);
  const fits = (g, tag) => {
    ok(g.sheet.b <= g.H + 1 && g.sheet.t >= 0 && g.sheet.h >= g.H * 0.8 && g.sheetScroll <= 1, tag + ": the sheet fits the visible screen, near full, nothing clipped: " + JSON.stringify({ H: g.H, sheet: g.sheet, sc: g.sheetScroll }));
    ok(g.comp && g.comp.b <= g.H + 1 && g.comp.t >= g.body.b - 1, tag + ": the composer sits below the conversation, on screen: " + JSON.stringify({ comp: g.comp, body: g.body }));
    ok(g.bodyOv === "auto" && g.scrollers.length <= 1 && (!g.scrollers.length || /pa-body/.test(g.scrollers[0])), tag + ": one scroll region (the conversation): " + JSON.stringify(g.scrollers));
  };
  const lastVisible = (g, tag) => ok(!!g.last && g.last.t >= g.body.t - 1 && (g.last.b <= g.body.b + 1 || g.last.h > g.body.h - 16), tag + ": the newest message is fully visible: " + JSON.stringify({ last: g.last, body: g.body }));
  const settle = () => until(`var b=document.querySelector("#pnAsk .pa-rev"), s=document.querySelector("#pnAsk .pn-sheet"); return !b && !document.querySelector('#pnAsk .pt-msg[data-key=typing]') && !(s && document.getAnimations().some(function(a){return a.effect && a.effect.target===s && a.playState==="running";}));`, 6000);

  // ---- open: slides up as a sheet, first answer, the composer
  await click("#smdPrep [data-act=ask]");
  await ev(`var s=document.querySelector("#pnAsk .pn-sheet"); window.__anim0 = s ? getComputedStyle(s).animationName + "|" + document.getAnimations().filter(function(a){return a.effect && a.effect.target===s;}).length : "nosheet"; return 1;`);
  ok(await until(`return !!document.querySelector("#pnAsk .pa-last") && !!document.getElementById("paIn");`, 6000), "Ask MaiK slides up; online first answer, then the composer");
  await settle();
  const head = JSON.parse(await ev(`var w=document.getElementById("pnAsk"); return JSON.stringify({ anim: window.__anim0, top: (w.querySelector(".pa-top .pt-av.mk use")||{getAttribute:function(){return ""}}).getAttribute("href"), av: w.querySelectorAll(".pt-msg.ai .pt-av.mk svg").length, stat: (w.querySelector("#paStat")||{}).textContent, left: !!w.querySelector("#paLeft"), ph: w.querySelector("#paIn").getAttribute("placeholder"), fs: getComputedStyle(w.querySelector("#paIn")).fontSize, send: Math.round(parseFloat(getComputedStyle(w.querySelector(".pa-send")).height)), qr: Array.prototype.map.call(w.querySelectorAll(".pa-q"), function(b){return b.textContent;}), notes: Array.prototype.map.call(w.querySelectorAll(".pt-note"), function(n){return n.textContent;}) });`));
  ok(head.top === "#mkai-tile" && head.av === 1 && (/pn-up/.test(head.anim) || +head.anim.split("|")[1] >= 1), "the sheet slides up (pn-up); the header and MaiK's avatar carry the mark: " + JSON.stringify(head));
  ok(head.stat === "9 of 10 left" && !head.left && head.ph === "Ask MaiK anything…" && head.fs === "16px" && head.send >= 44, "one status line (9 of 10 left), no footer counter; 16 px box (no iOS zoom), 44 px send: " + JSON.stringify(head));
  ok(head.qr.length === 3 && head.qr[0] === "Explain simply" && /^Why not [A-D]\?$/.test(head.qr[1]) && head.qr[2] === "Give a mnemonic", "quick replies: " + head.qr.join(" | "));
  ok(head.notes.length === 1 && /^41 MaiK Tokens · 1,899 left in your account$/.test(head.notes[0]), "the only note is the tokens line (no 'Answered online ... Checked' clutter): " + head.notes.join("|"));
  ok(reqs.length === 1 && reqs[0].body.kind === "mcq" && reqs[0].body.turn === 1 && /^pa[0-9a-z]{8,}$/.test(reqs[0].body.thread), "the first ask is the mcq request, turn 1 of this chat id: " + JSON.stringify({ turn: reqs[0].body.turn, thread: reqs[0].body.thread }));
  const cx = JSON.parse(await ev(`var d=document.querySelector("#pnAsk .pa-cx"), s=d.querySelector("summary"); return JSON.stringify({ open: d.open, text: s.textContent, h: Math.round(s.getBoundingClientRect().height), pinned: getComputedStyle(d.closest("li")).position, inBody: !!d.closest(".pa-body") });`));
  ok(!cx.open && /^Question 1You chose [A-D]Answer [A-D]$/.test(cx.text) && cx.h <= 48 && cx.pinned === "static" && cx.inBody, "the question is a collapsed one-line chip in the conversation (not pinned): " + JSON.stringify(cx));
  fits(await geo(), "390x844");
  lastVisible(await geo(), "390x844 first answer");
  await shot("chat-open-p390");
  await click("#pnAsk .pa-cxs");
  ok(await until(`var d=document.querySelector("#pnAsk .pa-cx"); return d.open && /Fixture question/.test(d.textContent) && d.querySelectorAll(".pa-cxo li").length >= 4 && !!d.querySelector(".pa-cxo li.key");`, 2000), "tap the chip: the stem and the options, the key marked");
  await shot("chat-ctx-open-p390");
  await click("#pnAsk .pa-cxs");

  // ---- the owner's two messages: real replies to what he asked, with the chat so far
  const P1 = "Tell me about firsy order kinetics in simple way", P2 = "Why is it correct and explain me topic like im dumb";
  await sendDoubt(P1);
  ok(await until(`return document.querySelectorAll("#pnAsk .pt-msg.ai .pt-ans-b").length === 2;`, 6000), "the first owner message gets its own answer");
  await settle();
  const r2 = reqs[reqs.length - 1].body;
  ok(r2.kind === "chat" && r2.turn === 2 && r2.thread === reqs[0].body.thread && /^Question: Fixture question/.test(r2.ground) && r2.messages.length === 3 && r2.messages[0].r === "u" && r2.messages[1].r === "m" && r2.messages[1].t === "The answer is the key, as the stored explanation says." && r2.messages[2].t === P1, "multi-turn: the request carries the turns so far and the owner's message: " + JSON.stringify({ turn: r2.turn, n: r2.messages.length }));
  await sendDoubt(P2);
  ok(await until(`return document.querySelectorAll("#pnAsk .pt-msg.ai .pt-ans-b").length === 3;`, 6000), "the second owner message gets its own answer");
  await settle();
  const r3 = reqs[reqs.length - 1].body;
  ok(r3.turn === 3 && r3.messages.length === 5 && r3.messages[2].t === P1 && r3.messages[3].r === "m" && /You asked: Tell me about firsy/.test(r3.messages[3].t) && r3.messages[4].t === P2, "the second request carries the first exchange too (history): " + r3.messages.map((m) => m.r).join(""));
  const shown = JSON.parse(await ev(`return JSON.stringify(Array.prototype.map.call(document.querySelectorAll("#pnAsk .pt-msg.ai .pa-txt"), function(x){return x.textContent;}));`));
  ok(shown[1].indexOf("You asked: " + P1) >= 0 && shown[2].indexOf("You asked: " + P2) >= 0 && shown[1] !== shown[2] && shown.every((t) => t.indexOf(STORED) < 0), "each reply is the model's answer to that message, not the stored explanation, and not the same twice");
  ok(await ev(`return document.querySelectorAll("#pnAsk .pt-msg.ai .pa-ul li").length === 4;`) === true, "'- ' lines draw as a short list");
  ok(await ev(`return document.getElementById("paStat").textContent;`) === "7 of 10 left", "online counts down: 7 of 10 left");
  const g390 = await geo(); fits(g390, "390x844 after replies"); lastVisible(g390, "390x844 after replies");
  ok(g390.atEnd < 30, "the chat follows the newest message (scrolled to the end): " + g390.atEnd);
  await shot("chat-two-p390");

  // ---- 375x667 with the keyboard up (visual viewport shrinks by 260 px, layout viewport stays)
  await click("#pnAsk .pa-top [data-act=ak-close]");
  await size(375, 667);
  await ev(`var f=new EventTarget(); f.width=375; f.height=667; f.offsetTop=0; f.offsetLeft=0; f.pageTop=0; f.scale=1; window.__vv=f; Object.defineProperty(window,"visualViewport",{configurable:true,get:function(){return f;}}); return 1;`);
  await click("#smdPrep [data-act=ask]");
  ok(await until(`return !!document.getElementById("paIn") && document.querySelectorAll("#pnAsk .pt-msg.me").length === 3;`, 4000), "reopened at 375x667: the same chat, no new request");
  await settle();
  fits(await geo(), "375x667");
  await shot("chat-p375");
  await ev(`var t=document.getElementById("paIn"); t.focus(); window.__vv.height=407; window.__vv.dispatchEvent(new Event("resize")); return 1;`);
  await sleep(120);
  const gk = await geo();
  fits(gk, "375x667 keyboard up");
  lastVisible(gk, "375x667 keyboard up");
  ok(gk.H === 407 && gk.comp.b <= 407 && await ev(`return document.getElementById("pnAsk").classList.contains("pa-kb") && document.activeElement && document.activeElement.id === "paIn";`) === true, "keyboard up: the sheet sits in the 407 px above the keyboard, the box keeps focus: " + JSON.stringify({ comp: gk.comp, sheet: gk.sheet }));
  await shot("chat-kb-p375");
  await sendDoubt("Give a mnemonic");
  await until(`return document.querySelectorAll("#pnAsk .pt-msg.ai .pt-ans-b").length === 4;`, 6000); await settle();
  const gk2 = await geo(); fits(gk2, "375x667 keyboard up, after a reply"); lastVisible(gk2, "375x667 keyboard up, after a reply");
  const fa = await ev(`var a=document.activeElement; return a ? a.tagName + "#" + a.id + "." + a.className : "none";`);
  ok(/^TEXTAREA#paIn/.test(fa), "after the reply the box still has focus (the keyboard stays up, no jump): " + fa);
  await shot("chat-kb-reply-p375");
  await ev(`window.__vv.height=667; window.__vv.dispatchEvent(new Event("resize")); return 1;`); await sleep(80);
  ok(await ev(`var w=document.getElementById("pnAsk"); return !w.classList.contains("pa-kb") && w.style.height === "";`) === true, "keyboard down: the sheet is full size again");
  await click("#pnAsk .pa-top [data-act=ak-close]");
  await ev(`delete window.visualViewport; return 1;`);
  await size(390, 844);
  await click("#smdPrep [data-act=ask]"); await until(`return !!document.getElementById("paIn");`, 4000); await settle();

  // ---- a failed answer: Try again, not a new message, not counted twice
  answer = (b) => b.kind === "chat" ? { status: 502, body: { error: "ai-failed", reason: "provider" } } : { status: 200, body: { text: "x" } };
  await sendDoubt("Is this about the second option?");
  ok(await until(`var l=document.querySelector("#pnAsk .pa-last"); return !!l && /could not answer online/.test(l.textContent) && !!l.querySelector("[data-act=ak-retry]");`, 6000), "a failed answer says so and offers Try again");
  ok(await ev(`return document.getElementById("paStat").textContent;`) === "5 of 10 left", "the failed message still counts (5 of 10 left)");
  answer = (b) => ({ status: 200, body: { text: "Reply to: " + b.messages[b.messages.length - 1].t, usage: { mt: 40 + (b.turn || 1) }, wallet: { balanceMt: 1800, costCapOn: true } } });
  const beforeRetry = reqs.length;
  await click("#pnAsk [data-act=ak-retry]");
  ok(await until(`var l=document.querySelector("#pnAsk .pa-last"); return !!l && /Reply to: Is this about/.test(l.textContent) && document.querySelectorAll("#pnAsk .pt-msg.me").length === 5;`, 6000), "Try again answers the same message, no new student message");
  ok(reqs.length === beforeRetry + 1 && reqs[reqs.length - 1].body.turn === 5 && await ev(`return document.getElementById("paStat").textContent;`) === "5 of 10 left", "the retry is turn 5 again, not counted twice");
  await settle();

  // ---- a quick reply sends at once
  await click("#pnAsk .pa-q");
  ok(await until(`return document.querySelectorAll("#pnAsk .pt-msg.me").length === 6 && /Explain simply/.test(document.querySelectorAll("#pnAsk .pt-msg.me")[5].textContent);`, 4000), "a quick reply is sent as the student's message");
  await settle();

  // ---- online: 10 a chat, then the limit card
  for (let n = 7; n <= 10; n++) {
    await sendDoubt("Doubt " + n);
    await until(`return document.querySelectorAll("#pnAsk .pt-msg.me").length === ${n} && !document.querySelector('#pnAsk .pt-msg[data-key=typing]') && !!document.querySelector("#pnAsk .pa-last");`, 6000);
  }
  await settle();
  const last = reqs[reqs.length - 1];
  ok(last.body.turn === 10 && last.body.messages.length <= 6 && typeof last.body.summary === "string" && last.raw.length < 16 * 1024, "10th online message: turn 10, recent turns as written, older summarised: " + JSON.stringify({ turn: last.body.turn, n: last.body.messages.length }));
  const cap = JSON.parse(await ev(`var w=document.getElementById("pnAsk"), c=w.querySelector(".pa-cap"); return JSON.stringify({ box: !!w.querySelector("#paIn"), text: c ? c.textContent : "", nw: !!(c && c.querySelector("[data-act=ak-new]")), loc: c && c.querySelector("[data-act=ak-mode][data-v=local]") ? c.querySelector("[data-act=ak-mode][data-v=local]").textContent : "", stat: w.querySelector("#paStat").textContent, ai: /\\bAI\\b/.test(w.textContent), dash: /[\\u2014\\u2013]/.test(w.textContent) });`));
  ok(!cap.box && /That is 10 online questions in this chat\./.test(cap.text) && cap.nw && cap.loc === "Continue on this phone (unlimited)" && cap.stat === "0 of 10 left", "after 10 online messages: no box, Start a new chat and Continue on this phone (unlimited): " + JSON.stringify(cap));
  ok(!cap.ai && !cap.dash, "no AI label and no em or en dash in the sheet");
  const nReq = reqs.length;
  await ev(`PREP_ASK._s() && 1; return 1;`);
  fits(await geo(), "390x844 at the limit");
  await shot("chat-cap-p390");
  await size(820, 1180); await sleep(250); await shot("chat-cap-p820");
  await size(1180, 820); await sleep(250); await shot("chat-cap-l1180");
  await size(390, 844); await sleep(250);

  // ---- the thread is kept: close, reopen
  await click("#pnAsk .pa-top [data-act=ak-close]");
  await click("#smdPrep [data-act=ask]");
  ok(await until(`var w=document.getElementById("pnAsk"); return !!w && w.querySelectorAll(".pt-msg.me").length === 10 && !!w.querySelector(".pa-cap");`, 4000) && reqs.length === nReq, "reopened: the chat and the limit card, no new request");
  ok(await ev(`var o=JSON.parse(localStorage.getItem("smd_prep_ask_v1")||"{}"), k=Object.keys(o.th||{}); return k.length === 1 && o.th[k[0]].on === 10 && o.th[k[0]].turns.length === 20;`) === true, "kept on the phone: one thread, 20 turns, 10 online");

  // ---- Start a new chat: empty, 10 again, no automatic ask, a new chat id
  const oldThread = reqs[0].body.thread;
  await click("#pnAsk [data-act=ak-new]");
  ok(await until(`var w=document.getElementById("pnAsk"); return !!w.querySelector(".pa-empty") && !!document.getElementById("paIn") && w.querySelector("#paStat").textContent === "10 of 10 left" && !w.querySelector(".pt-msg.me");`, 3000) && reqs.length === nReq, "Start a new chat: an empty chat, 10 of 10, nothing sent by itself");
  await shot("chat-new-p390");
  await sendDoubt("Explain like Im 5");
  ok(await until(`return document.querySelectorAll("#pnAsk .pt-msg.ai .pt-ans-b").length === 1;`, 6000), "the new chat's first message is answered");
  const nb = reqs[reqs.length - 1].body;
  ok(nb.kind === "chat" && nb.turn === 1 && nb.thread !== oldThread && nb.messages.length === 1 && nb.messages[0].t === "Explain like Im 5", "a new chat id, turn 1, just this message: " + JSON.stringify({ thread: nb.thread, turn: nb.turn }));
  await settle();

  // ---- the server's own limit (429 chat-limit) is honoured
  answer = () => ({ status: 429, body: { error: "quota", reason: "chat-limit", message: "x" } });
  await sendDoubt("One more");
  ok(await until(`var w=document.getElementById("pnAsk"); return !!w.querySelector(".pa-cap") && !document.getElementById("paIn") && /reached 10 online questions/.test(w.textContent);`, 6000), "the server's 429 chat-limit shows the limit card");
  await click("#pnAsk .pa-top [data-act=ak-close]");
  await ev(`PREP_ASK._resetThreads(); return 1;`);

  // ---- not covered: the hand-off is offered at once
  answer = (b) => ({ status: 200, body: { text: b.kind === "chat" ? "The stored explanation does not cover this." : "The answer is the key, as the stored explanation says.", usage: { mt: 30 }, wallet: { balanceMt: 0, costCapOn: false } } });
  await click("#smdPrep [data-act=ask]");
  ok(await until(`return !!document.getElementById("paIn") && !!document.querySelector("#pnAsk .pa-last") && !document.querySelector('#pnAsk .pt-msg[data-key=typing]');`, 6000), "a fresh thread: the first answer");
  await sendDoubt("What about a drug from another chapter?");
  ok(await until(`var l=document.querySelector("#pnAsk .pa-last"); return !!l && /does not cover this doubt/.test(l.textContent) && !!document.querySelector("#pnAsk .pa-hchip [data-act=ak-hand]") && !!document.getElementById("paIn");`, 6000), "not covered: said plainly, Continue in MaiK Assistant offered, the box stays");
  const runTitle = await ev(`return PREP._st.run.title;`);
  await click("#pnAsk .pa-hchip [data-act=ak-hand]");
  ok(await until(`var q=document.getElementById("maikQ"); return !document.getElementById("pnAsk") && !!document.getElementById("maikSheet") && !!q && /My next doubt: $/.test(q.value);`, 6000), "Continue in MaiK Assistant: the sheet closes, MaiK opens with the summary typed in");
  const mk = JSON.parse(await ev(`var q=document.getElementById("maikQ"), t=document.getElementById("maikTopicName"), s=document.getElementById("maikSheet"); return JSON.stringify({ q: q.value, topic: t ? t.textContent : "", marks: s.querySelectorAll(".mkai, use[href^='#mkai']").length });`));
  ok(/^PrepNucleus question: Fixture question/.test(mk.q) && mk.topic === "About: " + String(runTitle).slice(0, 80) && mk.marks === 0, "the prefill and topic; the main MaiK assistant keeps its own logo: " + mk.q.slice(0, 80));
  await ev(`var s=document.getElementById("maikSheet"), c=document.getElementById("maikScrim"); if(s) s.remove(); if(c) c.remove(); document.body.classList.remove("maik-open"); return 1;`);
  const foot = await ev(`var a=document.querySelectorAll(".v4-maik .v4-maik-logo"); return a.length ? Array.prototype.map.call(a, function(i){return i.getAttribute("src");}).join(",") + "|" + document.querySelectorAll(".v4-maik .mkai").length : "none";`);
  ok(foot === "none" || /^\/maik-logo\.png,\/maik-logo-white\.png(,\/maik-logo\.png,\/maik-logo-white\.png)*\|0$/.test(foot), "the footer MaiKnowledge logo is untouched: " + foot);

  // ---- on this phone: unlimited (25 messages), multi-turn prompt, nothing sent
  await ev(`PREP_ASK._reset(); PREP_ASK._resetThreads(); window.__capWas = window.Capacitor; window.__sys = []; window.__localOk = true;
    window.Capacitor = { isNativePlatform: function () { return true; }, getPlatform: function () { return "ios"; }, isPluginAvailable: function (n) { return n === "Device"; }, Plugins: { Device: { getInfo: function () { return Promise.resolve({ model: "iPhone16,1", platform: "ios", osVersion: "26.0" }); } } } };
    window.SMD_MAIK_MODELS = { PACKS: { "maik-lite": { label: "MaiK Lite" } }, installed: function () { return Promise.resolve(window.__localOk); }, installedCached: function () { return true; }, suitability: function () { return { level: "ok" }; }, refreshDevice: function () { return Promise.resolve({ ramGB: 7.5 }); }, device: function () { return { ramGB: 7.5 }; } };
    window.SMD_MAIK_LOCAL = { available: function () { return true; }, currentPack: function () { return "maik-lite"; }, answer: function (q, o) { window.__sys.push({ s: o.systemOverride, q: q.question, temp: o.temperature }); var m = /\\nStudent: ([^\\n]*)\\n\\nTASK/.exec(q.question); return Promise.resolve({ text: m ? "On the phone, about: " + m[1] : "The answer is the key, as the stored explanation says." }); } };
    var s=PREP._host.store(); s.ask={m:"local",q:1}; PREP._host.save(); return 1;`);
  const b5 = reqs.length;
  await click("#smdPrep [data-act=ask]");
  ok(await until(`return !!document.getElementById("paIn") && !!document.querySelector("#pnAsk .pa-last") && document.getElementById("paStat").textContent === "Unlimited";`, 6000), "on this phone: the first answer, status Unlimited");
  for (let n = 1; n <= 25; n++) {
    await sendDoubt("Local doubt " + n);
    await until(`return document.querySelectorAll("#pnAsk .pt-msg.ai .pt-ans-b").length === ${n + 1} && !document.querySelector('#pnAsk .pt-msg[data-key=typing]');`, 6000);
  }
  await settle();
  const loc = JSON.parse(await ev(`var w=document.getElementById("pnAsk"); return JSON.stringify({ me: w.querySelectorAll(".pt-msg.me").length, ans: w.querySelectorAll(".pt-msg.ai .pt-ans-b").length, box: !!document.getElementById("paIn"), cap: !!w.querySelector(".pa-cap"), stat: w.querySelector("#paStat").textContent, last: w.querySelector(".pa-last").textContent, tok: /MaiK Tokens/.test(w.textContent) });`));
  ok(loc.me === 26 && loc.ans === 26 && loc.box && !loc.cap && loc.stat === "Unlimited" && /Local doubt 25/.test(loc.last) && !loc.tok, "on this phone: 25 follow-ups all answered, no limit, no MaiK Tokens line: " + JSON.stringify(loc));
  const sys = JSON.parse(await ev(`return JSON.stringify(window.__sys);`));
  ok(reqs.length === b5 && sys.length === 26, "on this phone: nothing sent to the server (" + (reqs.length - b5) + " requests)");
  const lq = sys[sys.length - 1];
  ok(/You are MaiK, a friendly medical exam tutor/.test(lq.s) && /\nCHAT:\nStudent: Local doubt 2[2-4]\n/.test(lq.q) && /\nMaiK: On the phone, about: Local doubt 24\nStudent: Local doubt 25\n\nTASK: Reply to the student's last message in your own words\./.test(lq.q) && /EARLIER IN THIS CHAT \(summary\)/.test(lq.q) && lq.temp === 0.3, "on this phone: a multi-turn chat prompt (recent turns, a summary of older ones), the tutor system prompt, a little warmth: " + lq.q.slice(-220).replace(/\n/g, " / "));
  fits(await geo(), "on this phone after 25");
  await shot("chat-local-p390");

  // ---- the mode switch: Online from here, then back
  await click('#pnAsk .pa-seg [data-act=ak-mode][data-v=online]');
  ok(await ev(`return document.getElementById("paStat").textContent === "10 of 10 left" && document.querySelector('#pnAsk .pa-seg [data-v=online]').getAttribute("aria-checked") === "true";`) === true, "switching to Online: the status shows this chat's 10");
  await click('#pnAsk .pa-seg [data-act=ak-mode][data-v=local]');
  ok(await ev(`return document.getElementById("paStat").textContent === "Unlimited";`) === true, "back on this phone: Unlimited");

  // ---- on this phone without a ready model: said plainly, Online offered, nothing sent
  await ev(`window.__localOk = false; return 1;`);
  await sendDoubt("Does this need the model?");
  ok(await until(`var l=document.querySelector("#pnAsk .pa-last"); return !!l && /not ready on this phone/.test(l.textContent) && !!l.querySelector("[data-act=ak-mode][data-v=online]");`, 6000) && reqs.length === b5, "no model on the phone: said plainly with Ask online instead; no silent switch, nothing sent");
  await shot("chat-nolocal-p390");
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
