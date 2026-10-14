/* Know more fallback relabel in the REAL app (headless Chrome over CDP, 390px), against the
 * fixture bank in test/fixtures/prep with a stubbed v2/links index (fetch wrapper, no network).
 * What must hold: an item whose only target is a module-level fallback (legacy kt article) renders
 * one "Learn this module" button subtitled with the taxonomy module name ("Gametogenesis"), opening
 * the same article, never naming it; an evidenced item keeps "Knowledge Library: <title>"; an item
 * with both shows both, evidenced first; a lesson-only fallback relabels too; an unlinked item hides
 * its row quietly. Dark first, then light: labels and 44px targets both modes.
 *
 * USAGE: node test/run-prep-relabel-ui.mjs   (BASE=http://localhost:8997/ for a running server;
 *   SHOTS=<dir> saves screenshots; CHROME=<path> overrides the browser)
 */
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { freePort } from "./free-port.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || ["/opt/pw-browsers/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => existsSync(p));
const FIX = "/test/fixtures/prep/";

// Stubbed links index: real KB ids (so hasDiseaseRef keeps them), mixed new-style and legacy rows.
const INDEX = { v: 1, ver: "relabel-test", gen: "test", th: 75, n: { items: 5, linked: 4, links: 5 }, src: {},
  m: { "ana-gametogenesis": "anatomy/rel4bel0" }, c: {} };
const SHARD = {
  v: 1, m: "ana-gametogenesis", s: "anatomy", ver: "relabel-test",
  T: [["kb", "zika_virus", "Zika virus infection"], ["kb", "mumps", "Mumps"], ["ls", "ana-gametogenesis", "Gametogenesis"]],
  e: {
    "ana-gametogenesis-q1": [[1, 75, "kt"]],
    "ana-gametogenesis-q2": [[0, 92, "k"]],
    "ana-gametogenesis-q3": [[0, 92, "k"], [1, 75, "kt", "", 0]],
    "ana-gametogenesis-q4": [[2, 75, "lt", "", 0]],
  },
  x: {}, mod: {},
};
const SEED = `window.SMD_PREP_QGEN=false; window.SMD_PREP_SETUP=false; window.SMD_PREP_BANK_VER="v1";
  window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BASE=${JSON.stringify(FIX)};
  window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")};
  window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")};
  window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;
  (function(){var IDX=${JSON.stringify(INDEX)}, SH=${JSON.stringify(SHARD)}, real=window.fetch;
  window.fetch=function(u,o){var s=String((u&&u.url)||u);
  if(s.indexOf("/v2/links/index.json")>=0) return Promise.resolve(new Response(JSON.stringify(IDX),{headers:{"content-type":"application/json"}}));
  if(s.indexOf("/v2/links/m/ana-gametogenesis-rel4bel0.json")>=0) return Promise.resolve(new Response(JSON.stringify(SH),{headers:{"content-type":"application/json"}}));
  return real.apply(this,arguments);};})();`;

async function main() {
if (!CHROME) { console.error("no Chrome found (set CHROME=)"); return 1; }
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/relabel-chrome-" + PORT + "-" + Date.now();
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
const until = async (e, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const shot = async (name) => { if (!process.env.SHOTS) return; const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result) writeFileSync(join(process.env.SHOTS, "relabel-" + name + ".png"), Buffer.from(r.result.data, "base64")); };
const kmHtml = () => ev(`var s=document.querySelector("#smdPrep .pn-km[data-done=\\"1\\"]"); return s ? s.innerHTML : "missing";`);
const kmHidden = () => ev(`var s=document.querySelector("#smdPrep .pn-km[data-done=\\"1\\"]"); return !!s && s.style.display==="none" && !s.innerHTML;`);
const curId = () => ev(`var r=PREP._st.run; return r && r.items[r.i] ? r.items[r.i].id : "none";`);
const btnMinH = () => ev(`var b=document.querySelector("#smdPrep .pn-km .pn-km-btn"); return b ? parseFloat(getComputedStyle(b).minHeight) : -1;`);

async function answerAndRead() {
  await click('#smdPrep .pn-opt[data-k="0"]');
  const done = await until(`return !!document.querySelector("#smdPrep .pn-km[data-done=\\"1\\"]");`);
  if (!done) return { id: await curId(), html: "missing", hidden: false };
  return { id: await curId(), html: await kmHtml(), hidden: await kmHidden() };
}
const seen = {};
async function check(id, html) {
  seen[id] = true;
  if (id === "ana-gametogenesis-q1") {
    ok(/Learn this module/.test(html) && /Gametogenesis/.test(html), "q1 fallback-only: Learn this module subtitled Gametogenesis");
    ok(!/Mumps/.test(html), "q1 never names the unevidenced article");
    ok(/pn-km-btn pn-km-fb/.test(html) && /data-id="mumps"/.test(html), "q1 secondary style, same target");
    await shot("q1-fallback");
  } else if (id === "ana-gametogenesis-q2") {
    ok(/Knowledge Library/.test(html) && /Zika virus infection/.test(html), "q2 evidenced keeps its wording");
    ok(!/Learn this module/.test(html), "q2 shows no fallback label");
  } else if (id === "ana-gametogenesis-q3") {
    ok(/Zika virus infection/.test(html) && /Learn this module/.test(html), "q3 items with both keep both");
    ok(html.indexOf("Zika virus infection") < html.indexOf("Learn this module"), "q3 evidenced first");
    await shot("q3-both");
  } else if (id === "ana-gametogenesis-q4") {
    ok(/Learn this module/.test(html) && /data-l="ana-gametogenesis"/.test(html), "q4 lesson-only fallback relabels, same target");
    ok(!/Lesson:/.test(html), "q4 never uses the topic-lesson wording");
  } else if (id === "ana-gametogenesis-q5" || id === "ana-gametogenesis-q6") {
    ok(await kmHidden() === true, id + " unlinked: the row hides quietly");
  } else ok(false, "unexpected item " + id);
  ok((await btnMinH()) === -1 || (await btnMinH()) >= 44, id + ": buttons keep 44px targets");
}

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
  await call("Page.addScriptToEvaluateOnNewDocument", { source: SEED });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  const load = async (url) => { await call("Page.navigate", { url }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean); await ev(`SMD_showHome(); return 1;`); await sleep(500); };

  // ---- dark: the full loop
  await load(BASE + "?prep=1");
  await ev(`document.body.classList.add("dark"); try{localStorage.removeItem("smd_prep_v1");}catch(e){} return 1;`);
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-tile[data-s=anatomy]");`, 20000), "dark: PrepNucleus home lists Anatomy");
  await click("#smdPrep .pn-tile[data-s=anatomy]");
  ok(await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=ana-gametogenesis]');`, 10000), "dark: subject lists Gametogenesis");
  await click('#smdPrep .pn-mod[data-m=ana-gametogenesis]');
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 10000), "dark: module screen opens");
  await click('#smdPrep [data-act=start][data-k=study]');
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q");`, 10000), "dark: practice starts");
  for (let i = 0; i < 6; i++) {
    const r = await answerAndRead();
    if (r.html === "missing") { ok(false, "Know more row never filled"); break; }
    await check(r.id, r.html);
    if (Object.keys(seen).length >= 5) break;
    if (await ev(`return !!document.querySelector("#smdPrep [data-act=next]");`) !== true) break;
    await click("#smdPrep [data-act=next]");
    await until(`return !!document.querySelector("#smdPrep .pn-q");`, 5000);
  }
  ok(["ana-gametogenesis-q1", "ana-gametogenesis-q2", "ana-gametogenesis-q3", "ana-gametogenesis-q4"].every((id) => seen[id]), "dark: all four label cases seen");
  ok(await ev(`return getComputedStyle(document.body).backgroundColor;`) !== "", "dark: page paints");

  // ---- light: labels and targets hold without the dark palette
  await load(BASE + "?prep=1");
  await ev(`document.body.classList.remove("dark"); return 1;`);
  await ev(`PREP.open(); return 1;`);
  await until(`return !!document.querySelector("#smdPrep .pn-tile[data-s=anatomy]");`, 20000);
  await click("#smdPrep .pn-tile[data-s=anatomy]");
  await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=ana-gametogenesis]');`, 10000);
  await click('#smdPrep .pn-mod[data-m=ana-gametogenesis]');
  await until(`return !!document.querySelector('#smdPrep [data-act=start][data-k=study]');`, 10000);
  await click('#smdPrep [data-act=start][data-k=study]');
  await until(`return !!document.querySelector("#smdPrep .pn-q");`, 10000);
  for (let i = 0; i < 6; i++) {
    const r = await answerAndRead();
    if (r.html === "missing") { ok(false, "light: Know more row never filled"); break; }
    if (/Learn this module/.test(r.html)) {
      ok(/Gametogenesis/.test(r.html) && !/Mumps|Lesson:/.test(r.html), "light: fallback reads Learn this module + module name");
      ok((await btnMinH()) >= 44, "light: 44px targets");
      await shot("light-fallback");
      break;
    }
    if (await ev(`return !!document.querySelector("#smdPrep [data-act=next]");`) !== true) break;
    await click("#smdPrep [data-act=next]");
    await until(`return !!document.querySelector("#smdPrep .pn-q");`, 5000);
  }

  const mine = reqs.filter((u) => /\/api\/(prep\/bank|ai)\//.test(u));
  ok(!mine.length, "no request reaches /api/prep/bank or /api/ai" + (mine.length ? ": " + mine.join(", ") : ""));
  ok(!errors.length, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (e) {
  console.error(e); fails++;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill("SIGKILL"); if (serveProc) serveProc.kill();
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
return fails ? 1 : 0;
}

export { INDEX, SHARD, SEED };

if (process.argv[1] && join(HERE, "run-prep-relabel-ui.mjs") === process.argv[1]) {
  const code = await main();
  process.exit(code);
}
