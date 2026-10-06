/* PrepNucleus Cards in the REAL app (headless Chrome over CDP): the shipped sample deck (prep/cards/v1/sur-breast-cancer.json,
 * 7 basic, 2 cloze, 1 occlusion) against the real taxonomy.
 * What must hold: the module screen shows "Cards · 10"; a card turns over on tap and shows four grades with FSRS interval
 * previews; Good, Again (by key 1, re-shown once at the end), a swipe right (Good) and Space all work; a cloze hides its term
 * (silent to screen readers) until revealed; occlusion boxes reveal one by one and the grades appear once all are open;
 * the end screen counts the grades, says when cards are next due and keeps the daily new-card setting; every grade is an
 * FSRS row under p:<module>:c that the MCQ progress count ignores; the home shows Cards due and runs a due-only session;
 * nothing wider than the screen; no request to /api/ai; no uncaught PrepNucleus error.
 *
 * USAGE: node test/run-prep-flash-ui.mjs   (CHROME=<path>; SHOTS=<dir> saves screenshots, PN_LIGHT=1 in light)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-flash-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const MID = "sur-breast-cancer";

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
const evA = async (e) => { const r = await call("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const shot = async (name) => {
  if (!process.env.SHOTS) return;
  await sleep(320);
  const r = await call("Page.captureScreenshot", { format: "png" });
  if (r.result) fs.writeFileSync(join(process.env.SHOTS, "cards-" + (process.env.PN_LIGHT ? "light-" : "dark-") + name + ".png"), Buffer.from(r.result.data, "base64"));
};
const step = () => ev(`var p=document.querySelector("#smdPrep .pn-t p"); return p ? p.textContent : "";`);
const store = (expr) => ev(`var s=JSON.parse(localStorage.getItem("smd_prep_v1")); return ${expr};`);

const key = (k) => ev(`var t=document.activeElement||document.body; if(!document.getElementById("smdPrep").contains(t)) t=document.getElementById("smdPrep"); var e=new KeyboardEvent("keydown",{key:${JSON.stringify(k)},bubbles:true,cancelable:true}); t.dispatchEvent(e); return e.defaultPrevented;`);
const shown = () => ev(`var c=document.querySelector("#pkCard"); return !!(c && c.classList.contains("on"));`);
const grades = () => ev(`return Array.from(document.querySelectorAll("#smdPrep .pk-g")).map(function(b){return b.querySelector("b").textContent+" "+b.querySelector("small").textContent;}).join("|");`);
const front = () => ev(`var f=document.querySelector("#pkCard .pk-fr"); return f ? f.textContent : "";`);
const ck = (id) => `"p:${MID}:c:${id}"`;
const wide = async () => ev(`var o=[]; document.querySelectorAll("#smdPrep *").forEach(function(e){ var r=e.getBoundingClientRect(); if(r.width && r.right>innerWidth+1 && !e.closest(".pk-card.out-r,.pk-card.out-l")) o.push(e.className||e.tagName); }); return o.slice(0,5).join("|");`);
const nextCard = (n) => until(`return /Card ${n} of/.test((document.querySelector("#smdPrep .pn-t p")||{}).textContent||"") && !document.querySelector("#pkCard.out-r,#pkCard.out-l");`, 3000);

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url);
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_API="/test/fixtures/prep/api/"; window.SMD_PREP_FLAG_API="/test/fixtures/prep/hidden.json"; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  reqs.length = 0;
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  if (process.env.PN_LIGHT) await ev(`if (!document.getElementById("pnNoTr")) { var t = document.createElement("style"); t.id = "pnNoTr"; t.textContent = "*{transition:none!important}"; document.head.appendChild(t); } document.body.classList.remove("dark"); return 1;`); else await ev(`document.body.classList.add("dark"); return 1;`);

  // ---- module screen: the Cards row
  await ev(`PREP.open({ subject: "surgery" }); return 1;`);
  ok(await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=${MID}]');`, 20000), "Surgery lists the breast cancer module");
  ok(await ev(`return !!window.PREP_FLASH;`) === true, "prep-loader.js loads prep-flash.js");
  await click(`#smdPrep .pn-mod[data-m=${MID}]`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=k-open]");`, 8000), "the module screen shows a Cards row");
  ok(/Cards · 10/.test(await ev(`return document.querySelector("#smdPrep [data-act=k-open]").textContent;`)), "the row says Cards · 10");
  await shot("module");

  // ---- card 1: basic, turn by tap, grade Good by button
  await click("#smdPrep [data-act=k-open]");
  ok(await until(`return !!document.querySelector("#pkCard");`, 8000), "Cards opens the reviewer");
  ok(await step() === "Card 1 of 10", "10 new cards (daily cap 20): Card 1 of 10");
  ok(await ev(`return document.querySelector("#pkCard .pk-back").getAttribute("aria-hidden")==="true" && !document.querySelector("#smdPrep .pk-g");`) === true, "the answer side is hidden and there are no grades yet");
  ok(await wide() === "", "nothing wider than the 390 px screen");
  await shot("1-front");
  await click("#pkCard");
  ok(await shown(), "tapping the card turns it over");
  ok(await ev(`return !document.querySelector("#pkCard .pk-back").hasAttribute("aria-hidden") && document.querySelector("#pkCard .pk-front").getAttribute("aria-hidden")==="true";`) === true, "the answer side is exposed to screen readers, the question side hidden");
  const g1 = await grades();
  ok(/^Again 1d\|Hard \d+d\|Good \d+d\|Easy \d+d$/.test(g1), "four grades with interval previews: " + g1);
  await sleep(300); await shot("1-back");
  await click("#smdPrep .pk-g[data-g='3']");
  ok(await nextCard(2), "Good moves to card 2");
  ok(await store(`!!s.cards[${ck("c01")}] && s.cards[${ck("c01")}][4]===1`) === true, "card 1 has an FSRS row under p:<module>:c");

  // ---- card 2: Space reveals, key 1 = Again (comes back at the end)
  ok(await key(" ") === true && await shown(), "Space turns the card over");
  ok(await key("1") === true, "key 1 grades Again");
  ok(await nextCard(3), "card 3 after Again");
  ok(/of 11$/.test(await step()), "the Again card is queued once more at the end (11 in the session)");
  ok(await store(`s.cards[${ck("c02")}][3]-s.cards[${ck("c02")}][2]`) === 1, "Again is due tomorrow");

  // ---- card 3: swipe right = Good
  await click("#pkCard");
  await ev(`var el=document.getElementById("pkCard"), r=el.getBoundingClientRect(), y=r.top+r.height/2, o={bubbles:true,pointerType:"touch",isPrimary:true,pointerId:7};
    el.dispatchEvent(new PointerEvent("pointerdown",Object.assign({clientX:150,clientY:y},o)));
    el.dispatchEvent(new PointerEvent("pointermove",Object.assign({clientX:200,clientY:y+2},o)));
    el.dispatchEvent(new PointerEvent("pointermove",Object.assign({clientX:290,clientY:y+4},o))); return 1;`);
  ok(await ev(`var s=document.querySelector("#pkCard .pk-stamp"); return !!s && s.textContent==="Good" && Number(s.style.opacity)>0.9 && /translateX\\(140px\\)/.test(document.getElementById("pkCard").style.transform);`) === true, "the card follows the finger and the stamp says Good");
  await shot("3-swipe");
  await ev(`var el=document.getElementById("pkCard"), r=el.getBoundingClientRect(), y=r.top+r.height/2; el.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerType:"touch",isPrimary:true,pointerId:7,clientX:300,clientY:y+4})); return 1;`);
  ok(await nextCard(4), "releasing past the threshold grades it and moves on");
  ok(await store(`s.cards[${ck("c03")}][3]>s.cards[${ck("c03")}][2]+1`) === true, "the swipe wrote a Good (due after tomorrow)");

  // ---- cards 4-7 by keys (no animation)
  for (let n = 4; n <= 7; n++) { await key(" "); await key(n === 5 ? "4" : n === 6 ? "2" : "3"); await nextCard(n + 1); }
  ok(await step() === "Card 8 of 11", "keys carry through cards 4 to 7");

  // ---- card 8: cloze
  ok(await ev(`var g=document.querySelector("#pkCard .pk-gap"); return !!g && g.querySelector(".pk-gap-t").getAttribute("aria-hidden")==="true" && g.querySelector(".pn-sr").textContent==="blank" && getComputedStyle(g.querySelector(".pk-gap-t")).color==="rgba(0, 0, 0, 0)";`) === true, "cloze: the term is invisible and screen readers hear 'blank'");
  ok(/Paget disease/.test(await front()), "card 8 is the Paget cloze");
  await shot("8-cloze");
  await click("#pkCard");
  ok(await ev(`var g=document.querySelector("#pkCard .pk-gap"); return !g.querySelector(".pn-sr") && !g.querySelector(".pk-gap-t").hasAttribute("aria-hidden") && document.querySelector("#pkBack.on")!==null;`) === true, "cloze reveal shows the term and the why");
  await sleep(300); await shot("8-cloze-shown");
  await click("#smdPrep .pk-g[data-g='3']"); await nextCard(9);
  await click("#pkCard"); await click("#smdPrep .pk-g[data-g='3']"); await nextCard(10);

  // ---- card 10: occlusion
  ok(await ev(`return document.querySelectorAll("#pkCard .pk-box").length===4 && !document.querySelector("#smdPrep .pk-g");`) === true, "occlusion: 4 masks, no grades yet");
  ok(await until(`var i=document.querySelector("#pkCard .pk-occ img"); return !!i && i.complete && i.naturalWidth>0;`, 5000), "the diagram loads");
  await shot("10-occl");
  await click("#pkCard .pk-box[data-i='0']");
  ok(await ev(`var b=document.querySelector("#pkCard .pk-box[data-i='0']"); return b.classList.contains("on") && b.getAttribute("aria-pressed")==="true" && /T1: up to 2 cm/.test(b.getAttribute("aria-label")) && !document.querySelector("#smdPrep .pk-g");`) === true, "tapping a mask reveals that label only");
  await shot("10-occl-one");
  await click("#pkCard .pk-box[data-i='1']"); await click("#pkCard .pk-box[data-i='2']"); await click("#pkCard .pk-box[data-i='3']");
  ok(await until(`return document.querySelectorAll("#smdPrep .pk-g").length===4;`, 2000), "once every label is open the grades appear");
  await shot("10-occl-all");
  await click("#smdPrep .pk-g[data-g='3']"); await nextCard(11);

  // ---- card 11: the Again card again
  ok(/again/.test(await step()) && /both breasts/.test(await front()), "card 2 returns at the end, marked again");
  await click("#pkCard"); await click("#smdPrep .pk-g[data-g='3']");

  // ---- end screen
  ok(await until(`return !!document.querySelector("#pkEnd");`, 3000), "the session ends with a summary");
  ok(/10 cards reviewed/.test(await ev(`return document.querySelector("#pkEnd .pk-end-n").textContent;`)), "10 cards reviewed (the repeat is not counted twice)");
  ok(await ev(`return Array.from(document.querySelectorAll("#pkEnd .pk-tally dd")).map(function(d){return d.textContent;}).join(",");`) === "1,1,7,1", "tally Again 1, Hard 1, Good 7, Easy 1");
  ok(/Next cards are due tomorrow: \d+ card/.test(await ev(`return document.querySelector("#pkEnd").textContent;`)), "says when the next cards are due");
  ok(await ev(`return !document.querySelector("#smdPrep [data-act=k-more]");`) === true, "no 'learn more' when the deck has no new cards left");
  await shot("end");
  await click("#smdPrep [data-act=k-cap][data-v='30']");
  ok(await store(`s.fc.cap`) === 30 && await ev(`return document.querySelector("#smdPrep [data-act=k-cap][data-v='30']").getAttribute("aria-pressed");`) === "true", "the daily new-card setting is kept");
  ok(await store(`Object.keys(s.cards).filter(function(k){return k.indexOf("p:${MID}:c:")===0;}).length`) === 10, "10 FSRS rows under p:sur-breast-cancer:c");
  ok(await store(`s.fc.n`) === 10, "10 new cards counted for today");
  ok(await ev(`var s=PREP._host.store(); return !PREP._pure.progressByModule(s, PREP._host.today())["${MID}"];`) === true, "MCQ progress for the module is untouched by cards");
  ok(await ev(`return PREP._host.core().recall(PREP._host.store(), "p:${MID}", PREP._host.today()).seen;`) === 10, "recall over the module sees the 10 cards (readiness input)");

  // ---- back to the module: row reflects progress
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return /nothing due today|due/.test((document.querySelector("#smdPrep [data-act=k-open]")||{}).textContent||"");`, 3000), "the Cards row updates after the session");

  // ---- home: Cards due, due-only session
  await ev(`var s=PREP._host.store(), d=PREP._host.today(); s.cards[${ck("c05")}][3]=d; s.cards[${ck("c09")}][3]=d-1; PREP._host.save(); PREP.close(); PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=k-due]");`, 8000), "home shows Cards due once cards were studied");
  ok(/2 due today across 1 module/.test(await ev(`return document.querySelector("#smdPrep [data-act=k-due]").textContent;`)), "Cards due counts 2 across 1 module");
  await shot("home");
  await click("#smdPrep [data-act=k-due]");
  ok(await until(`return !!document.querySelector("#pkCard");`, 6000) && await step() === "Card 1 of 2", "Cards due runs only the 2 due cards");
  await key(" "); await key("3"); await nextCard(2); await key(" "); await key("3");
  ok(await until(`return !!document.querySelector("#pkEnd");`, 3000), "the due session ends");
  ok(await store(`s.fc.n`) === 10, "reviews of seen cards do not use the new-card allowance");

  const apiHits = reqs.filter((u) => /\/api\/(ai|prep\/bank)/.test(u)); ok(!apiHits.length, "no request to /api/ai or the live bank" + (apiHits.length ? ": " + apiHits.slice(0, 3).join(" ") : ""));
  ok(reqs.some((u) => /\/prep\/cards\/v1\/sur-breast-cancer\.json/.test(u)) && reqs.some((u) => /prep-flash\.css/.test(u)), "the deck and the stylesheet load");
  ok(await evA(`PREP._host.cacheGet("cards/v1/${MID}.json").then(function(f){ return !!(f && f.cards && f.cards.length===10); })`) === true, "the deck is kept in IndexedDB for offline");
  await ev(`PREP.close(); return 1;`);
  // ---- generated deck from the bank API (fixture api/v1/cards): hand deck still wins; a module with none bundled gets one
  ok(await ev(`return PREP_FLASH._k.ix.modules["${MID}"].from === "app" && PREP_FLASH._k.ix.modules["${MID}"].n === 10;`) === true, "the hand-written bundled deck wins over the bank's generated one for the same module");
  await ev(`var d=document.createElement("div"); d.id="genSlot"; document.body.appendChild(d); PREP_FLASH.mount(d, "surgery", "sur-thyroid", PREP._host); return 1;`);
  ok(await until(`var b=document.querySelector("#genSlot [data-act=k-open]"); return !!b && /Cards · 4/.test(b.textContent);`, 5000), "a module with no bundled deck shows the generated deck row (Cards · 4)");
  await ev(`PREP_FLASH.act("k-open", document.querySelector("#genSlot [data-act=k-open]"), PREP._host); return 1;`);
  ok(await until(`var m=PREP_FLASH._k.mem["sur-thyroid"]; return !!(m && m.cards.length === 4);`, 8000), "the generated deck loads");
  ok(reqs.some((u) => u.includes("/test/fixtures/prep/api/v1/cards/sur-thyroid.json")) && reqs.some((u) => u.includes("/test/fixtures/prep/api/v1/cards/index.json")), "the generated deck and index load through the bank API base");
  ok(await evA(`PREP._host.cacheGet("v1/cards/sur-thyroid.json").then(function(f){ return !!(f && f.module === "sur-thyroid"); })`) === true, "the generated deck is kept in IndexedDB like bank files");
  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ").slice(0, 400) : ""));
} catch (e) {
  console.log("FAIL harness: " + (e && e.stack || e)); fails++;
} finally {
  try { chrome.kill("SIGKILL"); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
