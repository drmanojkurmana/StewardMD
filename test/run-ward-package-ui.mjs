/* WardSynQ gap-claims-gst-2: package billing on TPA / Claims in real headless Chrome over CDP, against the REAL ward.js
 * and ward.css (test/ward-package-harness.html stubs only the network). Opens a chart, TPA, puts the stay on a package
 * through the in-ward question, repaints the ward mid-question and checks what was typed survived, checks the POST
 * body, the flags, the manual submission pack (never "submitted") and that removal refuses no reason.
 *
 *   node test/run-ward-package-ui.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9433, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-package-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-package-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click(); return true;`);
const type = (sel, v) => ev(`var el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true;`);
async function waitFor(expr, tries) {
  for (let i = 0; i < (tries || 40); i++) { await sleep(120); if (await ev(expr)) return true; }
  return false;
}
const text = (s) => `return document.body.lastElementChild.textContent.indexOf(${JSON.stringify(s)}) >= 0;`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });
  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the package harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('.w-bed');`), "the ward list shows the patient");
  await click(".w-bed");
  ok(await waitFor(`return !!document.querySelector('[data-w-act="tpaopen"]');`), "the chart carries the TPA button");
  await click('[data-w-act="tpaopen"]');
  ok(await waitFor(text("No stay of this patient is on a package")), "TPA / Claims shows Package billing, plainly none yet");

  await click('[data-w-act="pkgset"]');
  ok(await waitFor(`return !!document.querySelector('.w-ask [data-w-ask="beneficiaryId"]');`), "Put a stay on a package asks on the ward");
  await type('.w-ask [data-w-ask="beneficiaryId"]', "PMJAY-77");
  await type('.w-ask [data-w-ask="preAuthId"]', "pa-1");
  await ev(`window.WARD._dispatch("dismiss"); return true;`);
  ok(await ev(`return document.querySelector('.w-ask [data-w-ask="beneficiaryId"]').value === "PMJAY-77";`), "what was typed survives a repaint");
  await click('.w-ask [data-w-act="askok"]');
  ok(await waitFor(text("Length of stay exceeded")), "after saving, the stay shows its package and the length-of-stay flag");
  const post = await ev(`var c = window.__calls.filter(function (x) { return x.url.indexOf("/ward/stay-package") >= 0 && x.method === "POST"; })[0]; return c ? JSON.stringify(c.body) : null;`);
  const b = JSON.parse(post || "{}");
  ok(b.packageId === "pkg-pmjay-su007a" && b.beneficiaryId === "PMJAY-77" && b.preAuthId === "pa-1" && b.encounterId === "wsq-enc-smd-h1-pkg01", "the POST carries the stay, package, pre-authorisation and beneficiary ID");
  ok(await ev(text("This package needs an approved pre-authorisation")), "a requested (not approved) pre-authorisation is flagged");
  ok(await ev(text("Excluded, billed on top: Locking plate 20000")), "exclusions billed on top are listed");
  ok(await ev(text("Not connected to the scheme's portal")), "the portal is said to be not connected");

  await click('[data-w-act="pkgpack:wsq-enc-smd-h1-pkg01"]');
  ok(await waitFor(`return window.__packWin.html.indexOf("Fields to copy into the portal") >= 0;`), "the document pack opens with the fields to copy");
  ok(await ev(`return window.__packWin.html.indexOf("Nothing in this pack has been sent or submitted") >= 0 && window.__packWin.html.indexOf("PMJAY-77") >= 0;`), "the pack says nothing was sent or submitted, and carries the beneficiary ID");

  await click('[data-w-act="pkgremove:wsq-enc-smd-h1-pkg01"]');
  ok(await waitFor(`return !!document.querySelector('.w-ask [data-w-ask="reason"]');`), "Remove asks why on the ward");
  const before = await ev(`return window.__calls.length;`);
  await click('.w-ask [data-w-act="askok"]');
  ok(await waitFor(text("Say why the package is being removed.")), "no reason: said in the question, nothing sent");
  ok((await ev(`return window.__calls.filter(function (x, i) { return i >= ${before} && x.url.indexOf("/ward/stay-package") >= 0; }).length;`)) === 0, "no request left the ward without a reason");
  await type('.w-ask [data-w-ask="reason"]', "Patient chose to pay privately");
  await click('.w-ask [data-w-act="askok"]');
  ok(await waitFor(text("No stay of this patient is on a package")), "removed with a reason, the stay is itemised again");
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} await sleep(300); try { rmSync(userDir, { recursive: true, force: true }); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
