/* Phase J-b CDP test (real headless Chrome): the ONCQIS REVIEW/APPROVAL surface rendered end to end
 * from fixtures via the REAL onco-protocol-review.js (+ lifecycle + evidence). Asserts:
 *   - J7 the diff UI renders COMPARE vN ACTIVE vs vN+1 DRAFT, per-change Field/Current/Proposed/Evidence
 *     rows, and the four per-change actions [ACCEPT] [REJECT] [EDIT] [MARK VERIFY]
 *   - the proposed version never mutated the ACTIVE source
 *   - the review->clinical approve->institutional approve->activate happy path (canActivate false after
 *     one gate, true after both; vN+1 ACTIVE, vN SUPERSEDED)
 *   - J14 the audit trail renders the whole chain
 *   - J13 the review-due dashboard flags an overdue protocol
 *   - J12 UPDATE AVAILABLE shows for the old-version plan and the plan is left unchanged
 * USAGE: node test/run-onco-review-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8801, DBG = 9392, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/onco-review-ui-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=1100,900"], { stdio: "ignore" });

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
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "test/onco-review-ui-harness.html" });

  let ready = null;
  for (let i = 0; i < 60; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, "real onco-protocol-review.js loaded + rendered into the harness");

  // ---- J8 no-mutation ----
  ok(await ev(`return window.__activeUnchanged;`) === true, "J8: proposed version did NOT mutate the ACTIVE source");

  // ---- J7 diff UI ----
  const dText = (await ev(`return document.getElementById('diff').textContent || "";`)) || "";
  ok(/COMPARE v1\.0 ACTIVE/.test(dText) && /v1\.1 DRAFT/.test(dText), "J7: diff shows COMPARE v1.0 ACTIVE -> v1.1 DRAFT");
  ok(/85 mg\/m2/.test(dText) && /100 mg\/m2/.test(dText), "J7: diff row shows Current 85 vs Proposed 100 mg/m2");
  ok(/p\.42, Table 3/.test(dText), "J7: evidence cell shows the source location");
  ok(/VERIFY/.test(dText), "J7: the unsourced change is flagged VERIFY");
  const changeRows = await ev(`return document.querySelectorAll('[data-onco-rev="change"]').length;`);
  ok(Number(changeRows) === 2, `J7: two per-change rows (${changeRows})`);
  for (const a of ["accept", "reject", "edit", "verify"]) {
    ok(await ev(`return document.querySelectorAll('[data-onco-rev-act="${a}"]').length;`) >= 2, `J7: per-change action [${a}] present on every row`);
  }

  // ---- J9->J11 happy path ----
  ok(await ev(`return window.__unresolved;`) === 0, "J9: all VERIFY resolved before clinical approval");
  ok(await ev(`return window.__afterClinicalCanActivate;`) === false, "J10: NOT activatable after clinical approval alone (needs gate 2)");
  ok(await ev(`return window.__afterBothCanActivate;`) === true, "J10: activatable after BOTH approvals");
  ok(await ev(`return window.__activatedStatus;`) === "ACTIVE", "J11: v1.1 becomes ACTIVE on activate");
  ok(await ev(`return window.__supersededStatus;`) === "SUPERSEDED", "J11: v1.0 becomes SUPERSEDED");

  // ---- J14 audit ----
  const aText = (await ev(`return document.querySelector('[data-onco-rev="audit"]').textContent || "";`)) || "";
  ok(/draft_created/.test(aText) && /clinical_approved/.test(aText) && /institutional_approved/.test(aText) && /activated/.test(aText),
     "J14: audit trail renders the whole chain (draft->clinical->institutional->activated)");

  // ---- J13 review-due ----
  const rText = (await ev(`return document.querySelector('[data-onco-rev="review-due"]').textContent || "";`)) || "";
  ok(/REVIEW DUE/.test(rText) && /OLD-PROTOCOL/.test(rText), "J13: review-due dashboard flags the overdue protocol");

  // ---- J12 UPDATE AVAILABLE ----
  const uText = (await ev(`return document.getElementById('update').textContent || "";`)) || "";
  ok(/UPDATE AVAILABLE/.test(uText), "J12: UPDATE AVAILABLE shows for the old-version plan");
  ok(await ev(`return window.__planUnchanged;`) === true, "J12: the existing plan was NOT auto-modified");

  console.log(fails ? ("\n" + fails + " FAILED") : "\nALL PASS");
} catch (e) {
  console.log("FAIL harness error: " + (e && e.message || e)); fails++;
} finally {
  try { ws && ws.close(); } catch {} try { chrome.kill(); } catch {} try { serveProc.kill(); } catch {}
  process.exit(fails ? 1 : 0);
}
