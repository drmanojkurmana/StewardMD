/* PrepNucleus previous-year papers in the REAL app (headless Chrome over CDP), against the synthetic PYQ fixture in
 * test/fixtures/prep/api/v2/pyq/ (made-up questions, a generated test-pattern image) and the small fixture bank.
 * What must hold: home shows "Previous year papers" on the NEET-PG tab; the papers screen says the papers are recalls,
 * not official, lists years newest first with a Recall label and counts that leave out flagged items; a paper shows its
 * questions, what was held back, the NEET-PG pattern timing and marking, and a subject list; practice runs in paper order
 * with "Asked in ..." chips (both years for a question asked twice), no bookmark ribbon, our explanation and a recall
 * source line; an image question shows its image, which enlarges and closes with back() first; a timed test runs a clock
 * and is marked +4/-1 with an unsorted subject drawn as plain text; a module with PYQs gets "All questions / PYQ n" chips
 * and the PYQ chip runs them (recall items mapped there and bank items tagged as asked, which carry the chip too); the
 * index is kept in IndexedDB; nothing is wider than the screen; no request reaches the live bank or /api/ai and no
 * uncaught PrepNucleus error.
 *
 * USAGE: node test/run-prep-pyq-ui.mjs   (CHROME=<path>; SHOTS=<dir> saves screenshots, PN_LIGHT=1 in light)
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
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-pyq-chrome-" + PORT + "-" + Date.now();
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
const evA = async (e) => { const r = await call("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const text = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g," ").trim() : "";`);
const shot = async (name) => {
  if (!process.env.SHOTS) return;
  await sleep(300);
  const r = await call("Page.captureScreenshot", { format: "png" });
  if (r.result) fs.writeFileSync(join(process.env.SHOTS, "pyq-" + (process.env.PN_LIGHT ? "light-" : "dark-") + name + ".png"), Buffer.from(r.result.data, "base64"));
};
const overflow = () => ev(`var o=[]; document.querySelectorAll("#smdPrep *").forEach(function(e){ var r=e.getBoundingClientRect(); if(r.width && r.right>innerWidth+1 && !e.closest(".pn-filters,.pn-tabs,.pn-zoom-sc")) o.push(e.className||e.tagName); }); return o.slice(0,5).join("|");`);

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
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  reqs.length = 0;
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  if (process.env.PN_LIGHT) await ev(`document.body.classList.remove("dark"); return 1;`); else await ev(`document.body.classList.add("dark"); return 1;`);

  // ---- home row
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=y-home]");`, 20000), "home shows Previous year papers on the NEET-PG tab");
  ok(await ev(`return !!window.PREP_PYQ;`) === true, "prep-loader.js loads prep-pyq.js");
  ok(/Previous year papers/.test(await text("#smdPrep [data-act=y-home]")), "the row is named Previous year papers");
  await click(`#smdPrep [data-act=exam][data-v=neet-ss]`);
  ok(await until(`return !document.querySelector("#smdPrep [data-act=y-home]");`, 4000), "the NEET-SS tab has no papers row");
  await click(`#smdPrep [data-act=exam][data-v=neet-pg]`);
  await until(`return !!document.querySelector("#smdPrep [data-act=y-home]");`, 4000);

  // ---- papers list
  await click("#smdPrep [data-act=y-home]");
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-yq-row").length === 3;`, 8000), "the papers screen lists the three fixture papers (an AIPGMEE one on the NEET-PG tab)");
  ok(/not official/i.test(await text("#smdPrep .pn-yq-note")) && /NBEMS does not publish/.test(await text("#smdPrep .pn-yq-note")) && /AIPGMEE/.test(await text("#smdPrep .pn-yq-note")), "the screen says these are recalls, not official papers");
  ok(await ev(`return Array.from(document.querySelectorAll("#smdPrep #pnYq .pn-sec")).map(function(h){return h.textContent;}).join(",")==="2025,2024,2013";`) === true, "years newest first");
  ok(/AIPGMEE 2013/.test(await text(`#smdPrep [data-act=y-paper][data-v=fx-2013-r1]`)), "a pre-2017 paper is named AIPGMEE");
  const r25 = await text(`#smdPrep [data-act=y-paper][data-v=fx-2025-r1]`);
  ok(/NEET-PG 2025/.test(r25) && /3 questions/.test(r25) && /1 with images/.test(r25) && /Recall/.test(r25), "2025 row: title, 3 usable questions (the flagged one left out), 1 with an image, Recall label: " + r25);
  ok(/Shift 1/.test(await text(`#smdPrep [data-act=y-paper][data-v=fx-2024-s1]`)), "the 2024 row names its shift");
  ok(!/official/i.test(await ev(`return Array.from(document.querySelectorAll("#smdPrep .pn-yq-kind")).map(function(x){return x.textContent;}).join(" ");`)), "no paper is labelled official");
  ok(await overflow() === "", "papers screen fits 390 px");
  await shot("papers");

  // ---- one paper
  await click(`#smdPrep [data-act=y-paper][data-v=fx-2025-r1]`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=y-start][data-k=exam]");`, 6000), "a paper opens its panel");
  ok(/3 questions/.test(await text("#smdPrep .pn-big")) && /1 held back/.test(await text("#smdPrep .pn-panel .pn-mut")), "the panel counts questions and what was held back");
  const timed = await text("#smdPrep [data-act=y-start][data-k=exam]");
  ok(/3 min/.test(timed) && /\+4/.test(timed) && /−1/.test(timed), "timed test: NEET-PG time per question (210 min for 200) and +4 / −1: " + timed);
  ok(await ev(`return Array.from(document.querySelectorAll("#smdPrep .pn-yq-subs li")).map(function(l){return l.textContent;}).join("|");`) === "Anatomy2|Not sorted yet1", "subject list: Anatomy 2, Not sorted yet 1");
  await shot("paper");

  // ---- practice in paper order
  await click(`#smdPrep [data-act=y-start][data-k=study]`);
  ok(await until(`return /Synthetic PYQ one/.test((document.querySelector("#smdPrep .pn-q")||{}).textContent||"");`, 5000), "practice starts at question 1");
  ok(await text("#smdPrep .pn-yq-tags") === "Asked in NEET-PG 2025, 2024 (recall)", "a question asked in two papers carries both years");
  ok(await ev(`return !document.querySelector("#smdPrep [data-act=bookmark]");`) === true, "no bookmark ribbon on a recall question");
  await click(`#smdPrep [data-act=answer][data-k="2"]`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-fb.ok");`, 3000), "the right answer is marked correct");
  ok(/C is the fixture key/.test(await text("#smdPrep .pn-exp")) && /Fixture pearl one/.test(await text("#smdPrep .pn-kp")), "our explanation and pearl show");
  ok(/2025 recall question \(memory-based, not an official paper\)/.test(await text("#smdPrep .pn-prov")), "the source line says recall, not official");
  await shot("practice-answer");
  await click("#smdPrep [data-act=next]");
  ok(await until(`var i=document.querySelector("#smdPrep .pn-yq-fig img"); return !!(i && i.complete && i.naturalWidth > 0);`, 6000), "an image question shows its image (loaded)");
  ok(await ev(`var f=document.querySelector("#smdPrep .pn-yq-fig"), q=document.querySelector("#smdPrep .pn-q"), o=document.querySelector("#smdPrep .pn-opts"); return !!(q.compareDocumentPosition(f) & 4) && !!(f.compareDocumentPosition(o) & 4);`) === true, "the image sits between the stem and the options");
  ok(await overflow() === "", "image question fits 390 px");
  await shot("image");
  await click("#smdPrep [data-act=y-zoom]");
  ok(await until(`return !!document.querySelector("#smdPrep #pnYqZoom");`, 2000), "tapping the image enlarges it");
  ok(await ev(`return document.activeElement && document.activeElement.getAttribute("data-act")==="y-unzoom";`) === true, "focus moves to Close image");
  await click("#smdPrep [data-act=y-zoom2]");
  ok(await ev(`return document.querySelector("#smdPrep .pn-zoom-b").classList.contains("big");`) === true, "a second tap enlarges further");
  await shot("zoom");
  await ev(`PREP.back(); return 1;`);
  ok(await ev(`return !document.querySelector("#smdPrep #pnYqZoom") && /Synthetic PYQ two/.test(document.querySelector("#smdPrep .pn-q").textContent);`) === true, "back() closes the image first and stays on the question");
  await click(`#smdPrep [data-act=answer][data-k="1"]`);
  await click("#smdPrep [data-act=next]");
  ok(await until(`return /Synthetic PYQ three/.test((document.querySelector("#smdPrep .pn-q")||{}).textContent||"");`, 3000) && await ev(`return !/Synthetic PYQ four/.test(document.body.textContent);`) === true, "the key-unclear question is never shown");
  await click(`#smdPrep [data-act=answer][data-k="1"]`);
  ok(/Explanation coming soon/.test(await text("#smdPrep .pn-fb")) && !/Explanation coming soon\. Explanation/.test(await text("#smdPrep .pn-fb")), "an exp-pending question is still shown and says Explanation coming soon");
  await click("#smdPrep [data-act=next]");
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=donerun]");`, 3000), "the set finishes after 3 questions");
  ok(await ev(`var s=JSON.parse(localStorage.getItem("smd_prep_v1")); return !!s.cards["p:ana-brachial-plexus:pyq-fx-2025-r1-1"] && !s.mt["pyq-fx-2025-r1-2"];`) === true, "answers write FSRS cards under the mapped module; recall items stay out of My mistakes");
  await click("#smdPrep [data-act=donerun]");

  // ---- timed test
  await until(`return !!document.querySelector("#smdPrep [data-act=y-start][data-k=exam]");`, 3000);
  await click(`#smdPrep [data-act=y-start][data-k=exam]`);
  ok(await until(`return !!document.querySelector("#smdPrep #pnClock");`, 3000) && /^3:0\d$/.test(await text("#smdPrep #pnClock")), "the timed test runs a clock from about 3 minutes");
  await click(`#smdPrep [data-act=answer][data-k="2"]`); await click("#smdPrep [data-act=next]");
  await click(`#smdPrep [data-act=answer][data-k="3"]`); await click("#smdPrep [data-act=next]");
  await click("#smdPrep [data-act=submit]");
  ok(await until(`return /4 \\/ 12/.test((document.querySelector("#smdPrep .pn-big")||{}).textContent||"") || /^3 \\/ 12/.test((document.querySelector("#smdPrep .pn-big")||{}).textContent||"");`, 3000), "marked in the NEET-PG pattern: +4 right, -1 wrong, of 12: " + await text("#smdPrep .pn-big"));
  ok(await ev(`var r=Array.from(document.querySelectorAll("#smdPrep .pn-mod")).filter(function(m){return /Not sorted/.test(m.textContent);}); return r.length===1 && r[0].tagName==="DIV";`) === true, "an unsorted subject is a plain row, not a dead link");
  await shot("timed-result");
  await click("#smdPrep [data-act=donerun]");

  // ---- module chips
  await ev(`PREP.close(); PREP.open({ subject: "anatomy" }); return 1;`);
  ok(await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=ana-brachial-plexus]');`, 8000), "Anatomy lists its modules");
  await click(`#smdPrep .pn-mod[data-m=ana-brachial-plexus]`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=y-mf][data-v=pyq]");`, 6000), "a module with PYQs shows the PYQ chip");
  ok(await text(`#smdPrep [data-act=y-mf][data-v=pyq]`) === "PYQ · 2", "the chip counts the module's PYQs");
  await click(`#smdPrep [data-act=y-mf][data-v=pyq]`);
  ok(await ev(`var p=document.querySelector("#smdPrep #pnModPanel"); return p.hidden && getComputedStyle(p).display==="none" && !!document.querySelector("#smdPrep [data-act=y-mstart]");`) === true, "the PYQ chip swaps in the PYQ panel");
  await shot("module-pyq");
  await click(`#smdPrep [data-act=y-mstart][data-k=study]`);
  ok(await until(`return /Question 1 of 2/.test((document.querySelector("#smdPrep .pn-bar")||{}).textContent||"");`, 5000), "PYQ practice runs the module's 2 recall questions");
  await ev(`PREP.back(); return 1;`);
  await click(`#smdPrep [data-act=y-mf][data-v=all]`);
  ok(await ev(`return !document.querySelector("#smdPrep #pnModPanel").hidden;`) === true, "All questions brings the module panel back");
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=ana-gametogenesis]');`, 4000);
  await click(`#smdPrep .pn-mod[data-m=ana-gametogenesis]`);
  ok(await until(`return /PYQ · 1/.test((document.querySelector("#smdPrep [data-act=y-mf][data-v=pyq]")||{}).textContent||"");`, 6000), "a bank item tagged as asked counts as a PYQ of its module");
  await click(`#smdPrep [data-act=y-mf][data-v=pyq]`);
  await click(`#smdPrep [data-act=y-mstart][data-k=study]`);
  ok(await until(`return /Fixture question 1 of ana-gametogenesis/.test((document.querySelector("#smdPrep .pn-q")||{}).textContent||"");`, 5000), "the tagged bank item runs");
  ok(await text("#smdPrep .pn-yq-tags") === "Asked in NEET-PG 2025 (recall)", "the bank item carries the Asked in NEET-PG 2025 (recall) chip");
  ok(await ev(`return !!document.querySelector("#smdPrep [data-act=bookmark]");`) === true, "a bank item keeps its bookmark ribbon");
  await shot("bank-chip");
  await ev(`PREP.back(); return 1;`);
  await click(`#smdPrep [data-act=y-mf][data-v=all]`);
  await click(`#smdPrep [data-act=start][data-k=study]`);
  ok(await until(`return /Fixture question/.test((document.querySelector("#smdPrep .pn-q")||{}).textContent||"");`, 5000), "ordinary practice still works");
  ok(await ev(`var q=document.querySelector("#smdPrep .pn-q").textContent; var t=document.querySelector("#smdPrep .pn-yq-tags"); return /question 1 of/.test(q) ? !!t : !t;`) === true, "only the tagged item carries a chip in ordinary practice");

  // ---- offline copy, network, errors
  ok(await evA(`PREP._host.cacheGet("pyq/index.json").then(function(f){ return !!(f && f.papers && f.papers.length===3); })`) === true, "the PYQ index is kept in IndexedDB");
  ok(await evA(`PREP._host.cacheGet("pyq/items-0f0f0f01.json").then(function(f){ return !!(f && f.items && f.items.length===6); })`) === true, "the PYQ items are kept in IndexedDB");
  ok(reqs.some((u) => u.includes("/prep-pyq.js?v=" + LOADER_V)), "prep-pyq.js loads at the current token");
  ok(!reqs.some((u) => /\/api\/(ai|prep\/bank)/.test(u)), "no request to /api/ai or the live bank");
  await ev(`PREP.close(); return 1;`);
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
