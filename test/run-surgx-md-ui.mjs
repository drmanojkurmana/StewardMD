/* StewardMD - SURGX evidence review renders MARKDOWN, not a code dump (headless).
 *
 * Reported from internal testing with a screenshot of "The ABCDE primary survey": the MaiK Evidence
 * Review answer was shown in .sgx-pre (monospace, pre-wrap) after esc(), so the model's markdown
 * appeared literally - "*   **A - Airway:** Ensure a patent airway" - and a clinical summary read
 * like a code dump.
 *
 * mdLite() renders the subset the model actually emits. This drives the REAL function out of the
 * loaded module (SMD_SURGX_SCREENS._mdLite), so it fails if the renderer regresses or is bypassed.
 *
 * USAGE: node test/run-surgx-md-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8801/";
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9374;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/surgx-md-" + Date.now();

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const m = BASE.match(/:(\d+)/);
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), m ? m[1] : "8801"], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+(x&&x.message)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS " + m); } else { fail++; console.log("FAIL " + m); } };

const md = (src) => ev(`return window.SMD_SURGX_SCREENS._mdLite(${JSON.stringify(src)});`);

// The exact shape from the reported screenshot.
const REPORTED = [
  "The ABCDE primary survey is a structured approach to the initial assessment and management of",
  "acutely unwell patients, prioritizing life-threatening conditions.",
  "",
  "*   **A - Airway:** Ensure a patent airway, with cervical spine protection if trauma is suspected.",
  "*   **B - Breathing:** Assess respiratory rate, depth, and pattern.",
  "*   **C - Circulation:** Evaluate pulse rate and rhythm, blood pressure."
].join("\n");

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Page.navigate", { url: BASE });

  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.SMD_SURGX_SCREENS && SMD_SURGX_SCREENS._mdLite);`)) { ready = true; break; } }
  if (!ready) throw new Error("SMD_SURGX_SCREENS._mdLite not reachable");
  ok(true, "the SURGX evidence renderer is reachable");

  // ---- the reported bug ----
  const out = await md(REPORTED);
  ok(!/\*\*/.test(out), "no literal ** survives (the reported symptom)");
  ok(/<strong>A - Airway:<\/strong>/.test(out), "bold labels become real bold (A - Airway)");
  ok(/<ul class="sgx-md-ul">/.test(out) && (out.match(/<li>/g) || []).length === 3, "the three ABC items become one list of three items");
  ok(/<p>The ABCDE primary survey/.test(out), "the lead-in stays a paragraph, not a list item");

  // ---- headings ----
  const h = await md("## Key points\ntext after");
  ok(/<h5 class="sgx-md-h">Key points<\/h5>/.test(h), "a markdown heading becomes a heading");
  const h2 = await md("### Summary:\nbody");
  ok(/>Summary</.test(h2), "a trailing colon is trimmed from a heading");

  // ---- a line that merely OPENS with bold is a paragraph, not a bullet ----
  const p = await md("**Airway:** keep it patent");
  ok(/^<p><strong>Airway:<\/strong>/.test(p), "a bold-led line is a paragraph, not a list item");
  ok(!/<li>/.test(p), "...and creates no list");

  // ---- numbered lists ----
  const n = await md("1. first\n2. second");
  ok((n.match(/<li>/g) || []).length === 2, "numbered lists render as list items");

  // ---- SAFETY: model output can never inject HTML ----
  const x = await md('<img src=x onerror=alert(1)>\n**<b>bold</b>**');
  ok(!/<img/.test(x), "an HTML tag in the model response is escaped, never injected");
  ok(/&lt;b&gt;/.test(x), "inner HTML is escaped even inside bold markers");
  ok(/<strong>/.test(x), "...while the markdown bold itself still renders");

  // ---- degenerate input never throws ----
  for (const bad of ["", null, "   ", "\n\n\n"]) {
    const r = await ev(`try { return typeof window.SMD_SURGX_SCREENS._mdLite(${JSON.stringify(bad)}); } catch(e){ return "THREW"; }`);
    ok(r === "string", `degenerate input returns a string, never throws (${JSON.stringify(bad)})`);
  }

  // ---- the production call site actually uses it ----
  const src = await (await fetch(BASE + "surgx-screens.js")).text();
  ok(/class="sgx-md">'\s*\+\s*mdLite\(r\.text\)/.test(src), "runLitReview renders through mdLite, not esc() into .sgx-pre");
  ok(!/'<div class="sgx-pre">' \+ esc\(r\.text\)/.test(src), "the old monospace render site is gone");

} catch (e) {
  fail++; console.log("FAIL harness: " + (e && e.message || e));
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  try { ws && ws.close(); } catch {}
  chrome.kill(); if (serveProc) serveProc.kill();
  process.exit(fail ? 1 : 0);
}
