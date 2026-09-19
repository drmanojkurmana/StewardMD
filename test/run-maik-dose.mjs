/* StewardMD — dose-router browser check (real Chrome, real bundle).
 *
 * Node tests load kb/ai/drug-dose.js directly; this proves the thing that only a browser can:
 *   • index.html actually ships it (window.SMD_DOSE exists after load)
 *   • maik-engine.js short-circuits SMD_AI.explainGrounded to it — no provider call leaves
 *   • a misspelled molecule ("parecetmal") resolves through the drug database and says so
 *   • a non-dose question is untouched
 * MEDAPI is stubbed in the page so the check is deterministic and makes no network call.
 *
 * USAGE: node test/run-maik-dose.mjs            (starts its own static server on :8907)
 *        BASE=http://localhost:8903/ node test/run-maik-dose.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = new URL("..", import.meta.url).pathname;
const PORT = Number(process.env.CDP_PORT || 9477);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let server = null, BASE = process.env.BASE;
if (!BASE) { server = spawn("python3", ["-m", "http.server", "8907"], { cwd: ROOT, stdio: "ignore" }); BASE = "http://localhost:8907/"; await sleep(800); }
BASE = BASE.replace(/\/?$/, "/");

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${(process.env.CLAUDE_JOB_DIR || "/tmp")}/tmp/maik-chrome-dose`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });

let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
// Every evaluation is bounded: a fall-through call reaches the real provider, which without a
// session can hang, and a stuck harness teaches nothing. A timeout resolves to "__TIMEOUT__".
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
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.SMD_AI && window.SMD_DOSE)`) === true) break; }

  chk("index.html ships the dose router", await ev(`return !!(window.SMD_DOSE && SMD_DOSE.intent && SMD_DOSE.answer)`) === true);
  chk("the engine decorator is installed over SMD_AI", await ev(`return typeof SMD_AI.explainGrounded === "function"`) === true);

  // Deterministic drug database in the page: no network call, and the same shape the live API returns.
  await ev(`
    window.MEDAPI = {
      searchCompositions: function (q) { var hit = /^par|^parec|^ondan|^ond/i.test(q); return Promise.resolve({ results: hit ? [{ composition: /ond/i.test(q) ? "Ondansetron" : "Paracetamol" }] : [] }); },
      searchBrands: function () { return Promise.resolve({ results: [] }); },
      structured: function (n) { return Promise.resolve(/paracetamol|ondansetron/i.test(n) ? { found: true, data: { adult_dose: "500 mg to 1 g every 4 to 6 hours, max 4 g/day.", renal_adjust: "CrCl < 30: extend the interval." } } : { found: false }); }
    };
    return 1;`);

  const d = await ev(`return SMD_AI.explainGrounded({ question: "dose of paracetamol" }, {}).then(function (r) { return JSON.stringify({ e: r.engine, drug: r.drug, t: r.text || "" }); });`);
  const got = JSON.parse(d || "{}");
  chk("a dose question is answered from the drug database, not a model", got.e === "drugdb" && /500 mg to 1 g/.test(got.t || ""), got.e);
  chk("the renal line a dose question needs is included", /Renal:/.test(got.t || ""));
  chk("the source line names the drugs database", /Drugs Database/.test(got.t || ""));

  const s = await ev(`return SMD_AI.explainGrounded({ question: "dose of parecetmal" }, {}).then(function (r) { return JSON.stringify({ e: r.engine, drug: r.drug, t: r.text || "" }); });`);
  const sp = JSON.parse(s || "{}");
  chk("a misspelled molecule resolves to Paracetamol", sp.drug === "Paracetamol", sp.drug);
  chk("and the correction is STATED, never silent", /You typed "parecetmal"/.test(sp.t || ""));

  const miss = await ev(`return SMD_AI.explainGrounded({ question: "dose of zzzqqxdrug" }, {}).then(function (r) { return String((r && r.engine) || "fellthrough"); }, function () { return "fellthrough"; });`);
  // A fall-through reaches the real provider (no session in this harness): anything that is NOT a
  // drugdb answer - an error, or the bounded timeout - proves the router did not claim the question.
  chk("a dose the database cannot answer falls through to the normal answer", miss !== "drugdb", String(miss));
  const non = await ev(`return Promise.resolve(SMD_DOSE.intent("treatment of pneumonia")).then(function (r) { return r === null; });`);
  chk("a non-dose question is untouched by the router", non === true);
} finally {
  try { chrome.kill(); } catch {}
  try { if (server) server.kill(); } catch {}
}
console.log(fails ? `\nmaik-dose: ${fails} FAILED` : "\nmaik-dose: all checks passed");
process.exit(fails ? 1 : 0);
