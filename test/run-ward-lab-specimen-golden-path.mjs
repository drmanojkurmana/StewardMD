/* WardSynQ TASK 3.1: order a lab test -> see it uncollected -> Collect -> wristband scan blocks a
 * mismatch -> the correct scan collects it, with a real accession number - driven in real headless
 * Chrome over CDP against the REAL ward.js and ward.css
 * (test/ward-lab-specimen-golden-path-harness.html stubs only the network and window.prompt).
 * Proves the CLIENT half of TASK 3.1's specimen safeguards; server-side correctness for these same
 * contracts is proven separately, for real, in test/wardsynq-lab-specimen-safeguards.test.mjs.
 *
 *   node test/run-ward-lab-specimen-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9404, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-lab-specimen-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-lab-specimen-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const lastBody = (frag) => ev(`var c=window.__calls.filter(function(c){return c.method==="POST" && c.url && c.url.indexOf(${JSON.stringify(frag)})>=0}); return JSON.stringify(c[c.length-1]&&c[c.length-1].body);`).then((s) => { try { return JSON.parse(s); } catch { return null; } });
const setPrompts = (arr) => ev(`window.__prompts = ${JSON.stringify(arr)}; return true;`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click(); return true;`);
async function waitFor(expr, tries) {
  for (let i = 0; i < (tries || 30); i++) { await sleep(120); if (await ev(expr)) return true; }
  return false;
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the specimen-collection harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('.w-bed');`), "the ward list shows the patient");
  await click('.w-bed');
  ok(await waitFor(`return document.body.textContent.indexOf('Investigations') >= 0;`), "the chart carries the Investigations card");
  ok(await waitFor(`return !!document.querySelector('[data-w-act^="collectspecimen:"]');`), "the uncollected order shows a real Collect button, reachable from the ordinary chart");

  // ---- 1. A wrong-patient wristband scan is refused, and the row stays uncollected. -----------------
  await setPrompts(["Whole blood", "WRONG-MRN-999"]);
  await click('[data-w-act^="collectspecimen:"]');
  ok(await waitFor(`return document.body.textContent.indexOf('does not match this patient') >= 0;`), "a mismatched wristband scan is refused, in words the phlebotomist can act on");
  const badBody = await lastBody("/ward/collect");
  ok(badBody && badBody.scannedPatientBarcode === "WRONG-MRN-999", "the wrong scan really was sent, not a client-side shortcut: " + JSON.stringify(badBody));

  // ---- 2. The correct wristband scan collects it, with a real accession number shown. ----------------
  await setPrompts(["Whole blood", "SMD-H1-LAB01"]);
  await click('[data-w-act^="collectspecimen:"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Accession ACC-') >= 0;`), "the correct scan collects the specimen and shows a real accession number");
  const goodBody = await lastBody("/ward/collect");
  ok(goodBody && goodBody.specimenType === "Whole blood" && goodBody.scannedPatientBarcode === "SMD-H1-LAB01", "the collection posts the real specimen type and the real scanned wristband: " + JSON.stringify(goodBody));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
