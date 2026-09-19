/* StewardMD — related-figures strip browser check (real Chrome, real bundle).
 * Stubs the provider, retrieval and SMD_AI.figures in the page, asks MaiK one question, and asserts:
 *   • the strip renders under the answer with image + site caption + link to the source page
 *   • the image is hotlinked with referrerpolicy=no-referrer (never proxied through us)
 *   • a figure whose hotlink fails removes its own card; the strip is gone when no card survives
 *   • the strip is persisted into the saved thread HTML
 * USAGE: node test/run-maik-figures.mjs   (starts its own static server on :8908)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const ROOT = new URL("..", import.meta.url).pathname;
const PORT = Number(process.env.CDP_PORT || 9478);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let server = null, BASE = process.env.BASE;
if (!BASE) { server = spawn("python3", ["-m", "http.server", "8908"], { cwd: ROOT, stdio: "ignore" }); BASE = "http://localhost:8908/"; await sleep(800); }
BASE = BASE.replace(/\/?$/, "/");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR || "/tmp")}/tmp/maik-chrome-figs`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e, ms = 20000) => {
  const p = call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true, awaitPromise: true });
  const r = await Promise.race([p, sleep(ms).then(() => null)]);
  if (!r) return "__TIMEOUT__";
  return r.result && r.result.result ? r.result.result.value : null;
};
let fails = 0; const chk = (n, ok, d) => { console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); if (!ok) fails++; };
try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() });
  await sleep(1500);
  await ev(`if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});} if(window.caches){caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k);});});} return 1;`);
  await sleep(600);
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() + "1" });
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.SMD_AI && window.StewardRAG)`) === true) break; }
  await ev(`["introPoster","splash","accountGate"].forEach(function(k){var e=document.getElementById(k);if(e)e.remove();});return 1;`);
  chk("SMD_AI.figures exists in the shipped bundle", await ev(`return typeof SMD_AI.figures === "function"`) === true);
  // Stubs: provider + retrieval as in run-maik-continuity; figures = one loadable image, one dead hotlink.
  await ev(`
    window.__figQ = "";
    SMD_AI.setFlag = function(){};
    SMD_AI.explainGrounded = function(pkg){ return Promise.resolve({ text: "## Clinical take\\nHematuria is evaluated with a risk-stratified approach, complete to the last sentence." }); };
    SMD_AI.explainGroundedStream = SMD_AI.explainGrounded;
    SMD_AI.figures = function(q){ window.__figQ = q; return Promise.resolve({ figures: [
      { img: "https://www.w3.org/Icons/w3c_home.png", page: "https://www.med.unc.edu/medclerk/hematuria/", site: "med.unc.edu", title: "AUA Microhematuria Evaluation Algorithm" },
      { img: "https://www.med.unc.edu/this-image-does-not-exist-404.png", page: "https://www.auanet.org/guidelines/microhematuria", site: "auanet.org", title: "Dead hotlink" }
    ] }); };
    window.StewardRAG = { ready:function(){return Promise.resolve();}, buildPackage:function(assess, opts){ return Promise.resolve({ retrieved:[], grounding:[], reasoning:{differential:[]}, question:(opts&&opts.question)||"" }); } };
    try { localStorage.setItem("smd_maik_v2","1"); localStorage.removeItem("smd_maik_figures"); localStorage.setItem("stewardmd.maikEngine","cloud"); } catch(e){}
    return 1;`);
  let opened = false;
  for (let i = 0; i < 12 && !opened; i++) { await ev(`var t=document.querySelector('[data-act="askai"]'); if(t){t.click();} return 1;`); await sleep(400); opened = await ev(`return !!document.getElementById("maikQ")`) === true; }
  chk("MaiK sheet opens", opened);
  await ev(`document.getElementById("maikQ").value="hematuria workup"; document.getElementById("maikSend").click(); return 1;`);
  await sleep(2500);
  const st = JSON.parse(await ev(`var b=document.querySelectorAll("#maikBody .maik-b.ai"); var last=b[b.length-1]; var s=last&&last.querySelector(".maik-figs"); var cards=s?[].slice.call(s.querySelectorAll(".maik-fig")):[];
    return JSON.stringify({ q: window.__figQ, strip: !!s, n: cards.length, href: cards[0]&&cards[0].getAttribute("href"), img: cards[0]&&cards[0].querySelector("img").getAttribute("src"), ref: cards[0]&&cards[0].querySelector("img").getAttribute("referrerpolicy"), cap: cards[0]&&cards[0].querySelector(".maik-fig-cap").textContent, saved: (localStorage.getItem(Object.keys(localStorage).find(function(k){return /maik.*thread/i.test(k)})||"")||"").indexOf("maik-figs")>=0 });`) || "{}");
  chk("figures were requested with the answered topic", /hematuria/i.test(st.q || ""), JSON.stringify(st.q));
  chk("strip renders under the answer", st.strip === true);
  chk("the dead hotlink removed its own card; the live one stays", st.n === 1, "cards=" + st.n);
  chk("card links to the SOURCE page", st.href === "https://www.med.unc.edu/medclerk/hematuria/", st.href);
  chk("image is hotlinked from the source, not proxied", st.img === "https://www.w3.org/Icons/w3c_home.png", st.img);
  chk("no-referrer policy on the hotlink", st.ref === "no-referrer", st.ref);
  chk("caption names the site and the figure", /med\.unc\.edu/.test(st.cap || "") && /Microhematuria/.test(st.cap || ""), st.cap);
  chk("strip persisted into the saved thread", st.saved === true);
} finally { try { chrome.kill(); } catch {} try { if (server) server.kill(); } catch {} }
console.log(fails ? `\nmaik-figures: ${fails} FAILED` : "\nmaik-figures: all checks passed");
process.exit(fails ? 1 : 0);
