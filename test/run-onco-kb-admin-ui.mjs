/* Phase J-a CDP test (real headless Chrome): the ONCQIS Knowledge Center admin dashboard + libraries
 * rendered end to end from fixtures via the REAL onco-kb-admin.js. Asserts:
 *   - the dashboard tiles render the aggregated counts (ACTIVE/DRAFT + guideline uploads + updates +
 *     clinical-review-required, with the review tile flagged hot)
 *   - the J2 protocol library table renders disease/version/status/evidence/last-review/update-flag
 *     + the six row actions, and the ACTIVE protocol carries its impact-report flag
 *   - the J3 evidence library lists uploaded sources with metadata + checksum
 * USAGE: node test/run-onco-kb-admin-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8799, DBG = 9390, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/onco-kb-admin-ui-chrome";
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
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "test/onco-kb-admin-ui-harness.html" });

  let ready = null;
  for (let i = 0; i < 60; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, "real onco-kb-admin.js loaded + rendered into the harness");

  // ---- J1 dashboard tiles ----
  const tileCount = await ev(`return document.querySelectorAll('[data-okb-tile]').length;`);
  ok(Number(tileCount) >= 6, `dashboard renders the metric tiles (${tileCount})`);
  ok(await ev(`return document.querySelector('[data-okb-tile="active"] .okb-tile-n').textContent;`) === "1", "ACTIVE tile shows 1");
  ok(await ev(`return document.querySelector('[data-okb-tile="draft"] .okb-tile-n').textContent;`) === "1", "DRAFT tile shows 1");
  ok(await ev(`return document.querySelector('[data-okb-tile="guidelineUploads"] .okb-tile-n').textContent;`) === "2", "guideline uploads tile shows 2");
  ok(await ev(`return document.querySelector('[data-okb-tile="updatesAvailable"] .okb-tile-n').textContent;`) === "1", "updates-available tile shows 1");
  ok(await ev(`return document.querySelector('[data-okb-tile="clinicalReviewRequired"] .okb-tile-n').textContent;`) === "1", "clinical-review-required tile shows 1");
  ok(await ev(`return document.querySelector('[data-okb-tile="clinicalReviewRequired"]').className.indexOf('okb-tile-hot')>-1;`) === true, "clinical-review-required tile is flagged hot");

  // ---- J2 protocol library ----
  const pText = (await ev(`return document.querySelector('[data-okb="protocols"]').textContent || "";`)) || "";
  ok(/FOLFOX-6/.test(pText) && /colorectal cancer/.test(pText) && /ACTIVE/.test(pText), "protocol table shows the ACTIVE FOLFOX-6 row w/ disease + status");
  ok(/1\.0/.test(pText) && /core\+guideline/.test(pText), "protocol row shows version + evidence layers");
  ok(/CLINICAL REVIEW REQUIRED/.test(pText), "the ACTIVE protocol carries its impact-report update flag");
  const actCount = await ev(`return document.querySelectorAll('[data-okb-proto="folfox-6"] .okb-act').length;`);
  ok(Number(actCount) === 6, `protocol row renders the six lifecycle actions (${actCount})`);
  ok(await ev(`return !!document.querySelector('[data-okb-act="create-draft-update"]');`) === true, "CREATE DRAFT UPDATE action present (routes to Phase I lifecycle; no ACTIVE mutation here)");
  ok(await ev(`return !!document.querySelector('[data-okb-act="retire"]');`) === true, "RETIRE action present");

  // ---- J3 evidence library ----
  const eText = (await ev(`return document.querySelector('[data-okb="evidence"]').textContent || "";`)) || "";
  ok(/NCCN Colon v3\.2026/.test(eText) && /NCCN/.test(eText), "evidence library lists the uploaded NCCN source + org");
  ok(/abcdef1234/.test(eText), "evidence row shows the checksum/hash");
  ok(await ev(`return document.querySelectorAll('[data-okb="evidence"] tbody tr').length;`) === 2, "both uploaded evidence sources listed");

  console.log(fails ? ("\n" + fails + " FAILED") : "\nALL PASS");
} catch (e) {
  console.log("FAIL harness error: " + (e && e.message || e)); fails++;
} finally {
  try { ws && ws.close(); } catch {} try { chrome.kill(); } catch {} try { serveProc.kill(); } catch {}
  process.exit(fails ? 1 : 0);
}
