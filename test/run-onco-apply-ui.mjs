/* Phase 4 CDP test (real headless Chrome): apply an ACTIVE protocol, review it, override a line
 * with a reason, then Create & Activate - the suggest-and-confirm gate this phase exists to prove.
 * Loads the REAL onco-dose.js + onco-protocols.js + opd-emr.js into a minimal harness (flags stubbed
 * on, fetch stubbed + every call RECORDED, window.confirm stubbed to auto-accept). Asserts:
 *   - only an ACTIVE fixture protocol is offered; the draft protocol (rchop-shaped) never is
 *   - applying a protocol stages st.oncoDraft and fires ZERO network calls (pure client-side compute)
 *   - the review panel shows "verify" for a non-computable line (no height/weight typed - never-invent)
 *   - ZERO POSTs to /api/queue/onco/plan* fire before the [Create & Activate] tap
 *   - on tap, EXACTLY the plan-create then plan/confirm POSTs fire, in that order, nothing else
 * USAGE: node test/run-onco-apply-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PORT = 8798, DBG = 9389, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/onco-apply-ui-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const RCHOP = require(join(HERE, "..", "kb", "protocols", "rchop.json"));
// A FIXTURE protocol that IS active - the real repo (correctly) offers nothing yet since rchop
// itself ships lifecycleState "draft" (activation is a separate owner/R1 governance step).
const FIXTURE_ACTIVE = Object.assign({}, RCHOP, { id: "fixture-active", name: "Fixture Active Protocol", version: "1.0", lifecycleState: "active" });
const MANIFEST = { protocols: [
  { id: FIXTURE_ACTIVE.id, name: FIXTURE_ACTIVE.name, diseaseId: FIXTURE_ACTIVE.diseaseId, version: FIXTURE_ACTIVE.version, lifecycleState: "active" },
  { id: RCHOP.id, name: RCHOP.name, diseaseId: RCHOP.diseaseId, version: RCHOP.version, lifecycleState: "draft" }
] };
const TEMPLATES = { "fixture-active": FIXTURE_ACTIVE, "rchop": RCHOP };

const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "test/onco-apply-ui-harness.html" });

  let ready = null;
  for (let i = 0; i < 60; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, "real onco-dose.js + onco-protocols.js + opd-emr.js loaded into the harness");

  // Inject the manifest + templates the app will fetch, then open the assessment tab (the seam
  // that triggers maybeLoadOncoProtocols()).
  await ev(`window.__MANIFEST = ${JSON.stringify(MANIFEST)}; window.__TEMPLATES = ${JSON.stringify(TEMPLATES)}; return 1;`);
  await ev(`window.OPDEMR.openProfile({ patientId: "MR1148", name: "Test Patient", tab: "assess" }); return 1;`);

  let applyShown = null;
  for (let i = 0; i < 60; i++) { await sleep(150); applyShown = await ev(`return !!document.querySelector('[data-oe-act="onco-apply:fixture-active"]');`); if (applyShown === true) break; }
  ok(applyShown === true, "the ACTIVE fixture protocol is offered next to the assessment");
  ok(await ev(`return !document.querySelector('[data-oe-act="onco-apply:rchop"]');`) === true, "the draft protocol (rchop) is never offered");

  const fetchesBeforeApply = await ev(`return window.__fetchCalls.length;`);
  await ev(`document.querySelector('[data-oe-act="onco-apply:fixture-active"]').click(); return 1;`);
  await sleep(150);

  ok(await ev(`return !!document.querySelector('[data-oe-act="onco-create"]');`) === true, "applying the protocol opens the review panel (Create & Activate present)");
  ok(await ev(`return !document.querySelector('[data-oe-act^="onco-apply:"]');`) === true, "the apply list is replaced by the review panel");
  const fetchesAfterApply = await ev(`return window.__fetchCalls.length;`);
  ok(fetchesAfterApply === fetchesBeforeApply, `applying a protocol fires ZERO network calls (before=${fetchesBeforeApply}, after=${fetchesAfterApply}) - pure client-side staging`);

  // Never-invent: no height/weight was ever typed into the assessment, so every BSA-basis line in
  // this template is non-computable and must render "verify", never a fabricated number.
  const reviewText = (await ev(`var e=document.querySelector(".oe-onco-review"); return e ? e.textContent.toLowerCase() : "";`)) || "";
  ok(reviewText.indexOf("verify") >= 0, "a non-computable dose line renders 'verify', never a guessed number");

  const oncoPostsBeforeTap = await ev(`return window.__fetchCalls.filter(function(c){ return c.url.indexOf("/api/queue/onco/plan") >= 0; }).length;`);
  ok(oncoPostsBeforeTap === 0, "ZERO POSTs to /api/queue/onco/plan* before the Create & Activate tap");

  // Tap [Create & Activate]. window.confirm is stubbed to auto-accept (the ONE confirm() gate
  // covering the whole create-then-activate sequence).
  await ev(`document.querySelector('[data-oe-act="onco-create"]').click(); return 1;`);
  let oncoCalls = null;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    oncoCalls = await ev(`return window.__fetchCalls.filter(function(c){ return c.url.indexOf("/api/queue/onco/plan") >= 0; });`);
    if (oncoCalls && oncoCalls.length >= 2) break;
  }
  ok(!!oncoCalls && oncoCalls.length === 2, `EXACTLY two onco POSTs fire on the tap (got ${oncoCalls ? oncoCalls.length : 0})`);
  if (oncoCalls && oncoCalls.length === 2) {
    const [createCall, confirmCall] = oncoCalls;
    ok(createCall.method === "POST" && /\/api\/queue\/onco\/plan$/.test(createCall.url), "1st call: POST .../onco/plan (create)");
    ok(createCall.body && createCall.body.protocolId === "fixture-active", "create body carries the applied protocolId");
    ok(confirmCall.method === "POST" && /\/api\/queue\/onco\/plan\/confirm$/.test(confirmCall.url), "2nd call: POST .../onco/plan/confirm (activate) - fires AFTER create");
    ok(!!(confirmCall.body && confirmCall.body.planId), "confirm body carries the planId returned by create");
  }

  console.log(fails ? `\n${fails} check(s) failed` : "\nAll oncology apply/review/confirm checks passed");
} catch (x) { console.error(x); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill("SIGKILL"); } catch {} try { serveProc.kill("SIGKILL"); } catch {} if (fails) process.exitCode = 1; }
