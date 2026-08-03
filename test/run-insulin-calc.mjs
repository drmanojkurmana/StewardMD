/* StewardMD — insulin dosing calculator clinical-correctness test (headless).
 * Verifies the 500/450 carb rule, 1800/1500 correction rule, weight-based TDD
 * initiation, 50/50 basal-bolus split, correction-dose arithmetic and the
 * hypoglycaemia / implausible-dose / DKA safety guards against hand-computed
 * reference values. Dev/test tooling only. */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8798/";
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9366;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/insulin-prof-" + Date.now();

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {}
  const m = BASE.match(/:(\d+)/); serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), m ? m[1] : "8798"], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+(x&&x.message)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { fail++; console.log("❌ " + m); } };

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
  for (let i = 0; i < 50; i++) { await sleep(400); if (await ev(`return !!(window.MEDCALC && MEDCALC._calcs && MEDCALC._calcs.filter(function(x){return x.id==="insulin_rules";})[0]);`)) { ready = true; break; } }
  if (!ready) throw new Error("MEDCALC / insulin_rules not reachable");

  const run = async (vals) => JSON.parse(await ev(`var c=MEDCALC._calcs.filter(function(x){return x.id==="insulin_rules";})[0]; return JSON.stringify(c.compute(${JSON.stringify(vals)}));`) || "null");

  // ---- 1. Insulin-naive, weight-based initiation (the case the old version could not do) ----
  // 80 kg x 0.5 U/kg/day = 40 U/day. Analogue: ICR 500/40 = 12.5 g/U; ISF 1800/40 = 45 mg/dL/U.
  let r = await run({ type: "rapid", tdd: NaN, wt: 80, factor: "0.5", glu: NaN, tgt: 150 });
  ok(r && Number(r.v) === 40, "insulin-naive 80 kg x 0.5 U/kg/day -> TDD 40 U/day (was impossible before)");
  ok(/1 unit per <b>12\.5 g<\/b>/.test(r.i), "carb ratio 500/40 = 12.5 g per unit");
  ok(/≈ <b>45 mg\/dL<\/b>/.test(r.i), "correction factor 1800/40 = 45 mg/dL per unit");
  ok(/2\.5 mmol\/L/.test(r.i), "mmol/L conversion 45/18 = 2.5");
  ok(/basal ≈ <b>20 units<\/b>/.test(r.i) && /prandial ≈ <b>7 units<\/b>/.test(r.i), "50/50 split -> basal 20 U, ~7 U per meal");
  ok(/estimate<\/b> from weight/.test(r.i), "flags that the TDD is a weight-based estimate");

  // ---- 2. Regular human insulin uses 450/1500, NOT 500/1800 (the silent-analogue bug) ----
  // TDD 50: regular ICR 450/50 = 9 g/U (analogue would be 10); ISF 1500/50 = 30 (analogue 36).
  const reg = await run({ type: "reg", tdd: 50, wt: NaN, factor: "0.4", glu: NaN, tgt: 150 });
  const rap = await run({ type: "rapid", tdd: 50, wt: NaN, factor: "0.4", glu: NaN, tgt: 150 });
  ok(/1 unit per <b>9 g<\/b>/.test(reg.i) && /\(450 rule\)/.test(reg.i), "regular insulin uses the 450 rule -> 9 g/unit");
  ok(/≈ <b>30 mg\/dL<\/b>/.test(reg.i) && /\(1500 rule\)/.test(reg.i), "regular insulin uses the 1500 rule -> 30 mg/dL per unit");
  ok(/1 unit per <b>10 g<\/b>/.test(rap.i) && /≈ <b>36 mg\/dL<\/b>/.test(rap.i), "analogue at same TDD differs (10 g/U, 36 mg/dL/U) — types are not interchangeable");

  // ---- 3. Correction dose arithmetic ----
  // TDD 40 analogue -> ISF 45. Glucose 280, target 150: (280-150)/45 = 2.9 -> 3 U (nearest 0.5).
  r = await run({ type: "rapid", tdd: 40, wt: NaN, factor: "0.4", glu: 280, tgt: 150 });
  ok(/Correction dose:<\/b> ≈ <b>3 units<\/b>/.test(r.i), "correction (280-150)/45 = 2.9 -> 3 units");
  ok(/stacking causes hypoglycaemia/.test(r.i), "warns against stacking correction doses");

  // ---- 4. Safety guards ----
  r = await run({ type: "rapid", tdd: 40, wt: NaN, factor: "0.4", glu: 62, tgt: 150 });
  ok(/hypoglycaemia/i.test(r.i) && /Do NOT give correction insulin/.test(r.i), "glucose 62 -> blocks correction, directs hypoglycaemia treatment");
  r = await run({ type: "rapid", tdd: 40, wt: NaN, factor: "0.4", glu: 140, tgt: 150 });
  ok(/Correction dose:<\/b> none/.test(r.i), "glucose at/below target -> no correction dose");
  r = await run({ type: "rapid", tdd: 200, wt: 70, factor: "0.4", glu: NaN, tgt: 150 });
  ok(/above the usual range/.test(r.i), "implausible 2.9 U/kg/day is flagged");
  ok(/Not for DKA\/HHS/.test(rap.i) && /0\.1 U\/kg\/h/.test(rap.i), "always carries the DKA/HHS fixed-rate-infusion warning");
  ok(/eGFR &lt;30/.test(rap.i), "carries the renal (eGFR <30) dose-reduction caution");

  // ---- 5. No usable input -> clean error, never a bogus number ----
  r = await run({ type: "rapid", tdd: NaN, wt: NaN, factor: "0.4", glu: NaN, tgt: 150 });
  ok(!!(r && r.err) && !r.v, "no TDD and no weight -> explicit error, no fabricated dose");

  console.log(`\n${fail === 0 ? "ALL GREEN — insulin calculator is clinically correct" : fail + " FAILED"} — ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
  ws.close();
} catch (e) { console.error("HARNESS ERROR:", e.message); process.exitCode = 2; }
finally { chrome.kill("SIGKILL"); if (serveProc) serveProc.kill("SIGKILL"); }
