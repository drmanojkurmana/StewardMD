/* MaiK Intent Firewall — real-browser test.
 *
 * The unit tests exercise maik-scope.js in node, where window.MEDDRUGS and window.MaiKKB do not
 * exist. That means they never touch lexiconMedical() — the runtime widening that is supposed to
 * carry the long tail of drug and disease names the regexes cannot. So the node suite can be fully
 * green while the widening is dead in the app, which is exactly what happened: the lookup was an
 * exact whole-string match, so "PCOD" resolved and "What is PCOD?" did not, and a doctor was told
 * their clinical question was not medical.
 *
 * This loads the real page with the real lexicons and asserts the firewall on the questions from
 * that device transcript.
 *
 * USAGE: BASE=http://localhost:8993/ node test/run-maik-scope-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8993/").replace(/\/?$/, "/");
const PORT = 9393;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-scope-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8993"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [
  ...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio"
], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => {
  const r = await call("Runtime.evaluate", {
    expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`,
    returnByValue: true, awaitPromise: true
  });
  return r.result && r.result.result ? r.result.result.value : null;
};
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      ws = new WebSocket(j.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
      return true;
    } catch { await sleep(300); }
  }
  return false;
}

// Every question from the transcript, plus the shapes the owner named as must-refuse.
const CLINICAL = [
  "Hi", "Treatment of Fever", "PCOD?", "What is PCOD?", "Polycystic Kidney Disease",
  "What is SGLT2 drugs mechanism of action?", "Linagliptin mechanism of action",
  "Side effects?", "Side effects of Linagliptin", "what is PCOS", "PCOS management",
  "DPP-4 inhibitor mechanism", "GLP-1 agonist side effects", "half life of amiodarone",
  "BPH treatment", "GDM screening", "T2DM first line", "ITP treatment", "loading dose of phenytoin"
];
const NON_CLINICAL = [
  "what is ap capital", "what is the capital of andhra pradesh", "how to code",
  "write me a python script", "who won the world cup", "tell me a joke", "plan my trip to goa"
];

try {
  if (!await connect()) throw new Error("could not attach to Chrome");

  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.navigate", { url: BASE });

  let ready = false;
  for (let i = 0; i < 75; i++) {
    await sleep(400);
    if (await ev(`return !!(window.MaiKScope && window.MaiKScope.isRefusable)`) === true) { ready = true; break; }
  }
  ok(ready, "page loaded with MaiKScope.isRefusable present");
  if (!ready) throw new Error("MaiKScope never became ready");

  // The whole point of this file: the lexicons the node suite cannot see.
  const lex = JSON.parse(await ev(`return JSON.stringify({
    drugs: !!(window.MEDDRUGS && window.MEDDRUGS.isKnownGeneric),
    kb: !!(window.MaiKKB && window.MaiKKB.isKnownConcept)
  })`));
  ok(lex.drugs || lex.kb, "at least one runtime lexicon is live (this is what node cannot test)");

  const refused = JSON.parse(await ev(
    `return JSON.stringify(${JSON.stringify(CLINICAL)}.filter(function(q){ return MaiKScope.isRefusable(q); }))`));
  ok(refused.length === 0, "no clinical question is refused in the real page" +
     (refused.length ? " — STILL REFUSED: " + refused.join(" | ") : ""));

  const leaked = JSON.parse(await ev(
    `return JSON.stringify(${JSON.stringify(NON_CLINICAL)}.filter(function(q){ return !MaiKScope.isRefusable(q); }))`));
  ok(leaked.length === 0, "every plainly non-clinical question is still refused for free" +
     (leaked.length ? " — LEAKED: " + leaked.join(" | ") : ""));

  // The wrapper-stripping fix, against the live lexicons rather than a stub.
  ok(await ev(`return MaiKScope.core("What is PCOD?")`) === "pcod",
     "core() strips the question wrapper so the exact lexicon lookup can fire");

  // An unrecognised query must reach the model, not be refused.
  const unk = JSON.parse(await ev(`return JSON.stringify(MaiKScope.classify("zzzqq wibble nonsense"))`));
  ok(unk.medical === false && unk.certain === false && await ev(`return MaiKScope.isRefusable("zzzqq wibble nonsense")`) === false,
     "an unrecognised query is uncertain, not refused");

  console.log(fails === 0 ? "\nall checks passed" : `\n${fails} FAILED`);
} finally {
  try { chrome.kill(); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
}
process.exit(fails === 0 ? 0 : 1);
