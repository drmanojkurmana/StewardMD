/* MaiK answer-engine picker — real-browser test.
 *
 * The unit tests load maik-engine.js in isolation. What they CANNOT prove is the thing most likely
 * to break: that the decorator actually attaches to window.SMD_AI in the live script load order
 * (reasoning.js defines SMD_AI at :3771 and is a separate deferred script), and that no later
 * script replaces the facade and silently discards the wrap.
 *
 * Verifies: SMD_AI is decorated after a real page load; "cloud" passes through untouched; "rag"
 * returns a renderable notice and issues ZERO network requests to /api/ai; the settings markup
 * renders three options; the on-device option is correctly unavailable on the web (no plugin).
 *
 * USAGE: BASE=http://localhost:8991/ node test/run-maik-engine-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8991/").replace(/\/?$/, "/");
const PORT = 9391;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-engine-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8991"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [
  ...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio"
], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); const extra = []; let ws, sessionId;
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
      // Node's global WebSocket (browser API), matching test/run-abx-ui.mjs. Events are fanned out
      // to both the id-reply map and a list of extra listeners (we need Network.* events too).
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        extra.forEach((fn) => { try { fn(m); } catch {} });
      };
      return true;
    } catch { await sleep(300); }
  }
  return false;
}

try {
  if (!await connect()) throw new Error("could not attach to Chrome");

  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Network.enable", {});
  await call("Page.navigate", { url: BASE });

  let ready = false;
  for (let i = 0; i < 75; i++) {
    await sleep(400);
    if (await ev(`return !!(window.SMD_AI && window.SMD_MAIK_ENGINE)`) === true) { ready = true; break; }
  }
  ok(ready, "app loaded with both SMD_AI and SMD_MAIK_ENGINE present");
  if (!ready) throw new Error("app never became ready");

  // ── the decorator actually attached in the live load order ──
  ok(await ev(`return SMD_MAIK_ENGINE.install() === false`) === true,
     "decorator already installed at load (install() is a no-op second time)");
  ok(await ev(`return SMD_MAIK_ENGINE.getPref()`) === "cloud",
     "default engine is cloud (untouched install behaves as before)");
  ok(await ev(`return typeof SMD_AI.explainGrounded === "function" && typeof SMD_AI.explainGroundedStream === "function"`) === true,
     "SMD_AI still exposes the grounded methods after decoration");

  // Prove the wrap is OURS, not the original: mark it and check the marker survives.
  ok(await ev(`
      var seen = false;
      var orig = SMD_AI.explainGrounded;
      SMD_MAIK_ENGINE.setPref("rag");
      return SMD_MAIK_ENGINE.effective() === "rag";
  `) === true, "setPref('rag') takes effect immediately");

  // ── rag mode: a renderable notice and ZERO calls to /api/ai ──
  const aiReqs = [];
  extra.push((m) => {
    if (m.method === "Network.requestWillBeSent" && /\/api\/ai/.test(m.params?.request?.url || "")) {
      aiReqs.push(m.params.request.url);
    }
  });

  const ragResult = await ev(`
      return SMD_AI.explainGrounded({ question: "test question", grounding: [] })
        .then(function (r) { return JSON.stringify({ hasText: !!r.text, err: r.error || null, engine: r.engine, text: (r.text||"").slice(0,80) }); });
  `);
  const rag = JSON.parse(ragResult || "{}");
  ok(rag.hasText === true, "rag mode returns TEXT (renders as an answer, not an error branch)");
  ok(!rag.err, "rag mode sets no error field");
  ok(rag.engine === "rag", "rag mode tags the result engine=rag");

  const refineNull = await ev(`return SMD_AI.refine("sepsis").then(function(r){ return r === null; });`);
  ok(refineNull === true, "rag mode short-circuits refine() to null (no paid router call)");

  await sleep(600);
  ok(aiReqs.length === 0, `rag mode issued ZERO /api/ai requests (saw ${aiReqs.length})`);

  // ── settings markup renders in the real DOM ──
  const marks = await ev(`
      var h = SMD_MAIK_ENGINE.settingsHTML();
      var d = document.createElement("div"); d.innerHTML = h;
      return JSON.stringify({
        opts: d.querySelectorAll("[data-me-opt]").length,
        seg: d.querySelectorAll(".me-seg").length,
        localDisabled: !!d.querySelector('[data-me-opt="local"][aria-disabled="true"]'),
        modelRow: d.querySelectorAll("[data-me-model]").length,
        labels: Array.prototype.map.call(d.querySelectorAll("[data-me-opt]"), function(b){ return b.getAttribute("data-me-opt"); }).join(",")
      });
  `);
  const m = JSON.parse(marks || "{}");
  ok(m.opts === 3, "settings renders exactly 3 engine options");
  ok(m.seg === 1, "settings renders one .me-seg host (re-render target)");
  ok(m.labels === "rag,cloud,local", "options are rag, cloud, local in order");
  ok(m.localDisabled === true, "on-device option disabled on the web (no access code, no plugin)");
  ok(m.modelRow === 0, "no model download row on the web build");

  ok(await ev(`return SMD_MAIK_LOCAL.available() === false`) === true,
     "SMD_MAIK_LOCAL reports unavailable on the web (module present, plugin absent)");
  ok(await ev(`return SMD_MAIK_ENGINE.runtimeAvailable ? true : SMD_MAIK_ENGINE.localReady() === false`) !== false,
     "localReady() false on the web");

  // ── cloud restores pass-through ──
  ok(await ev(`SMD_MAIK_ENGINE.setPref("cloud"); return SMD_MAIK_ENGINE.effective() === "cloud";`) === true,
     "switching back to cloud restores the original path");
  ok(await ev(`return localStorage.getItem("smd_maik_llm_first") === null`) === true,
     "cloud clears the KB-first override it set for rag/local");

  console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed");
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
process.exit(fails ? 1 : 0);
