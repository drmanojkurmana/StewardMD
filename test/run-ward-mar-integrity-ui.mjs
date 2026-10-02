/* WardSynQ ward: the Codex audit medication fixes (F3, F5, F6), on the real ward.js and ward.css in headless Chrome over
 * CDP (test/ward-golden-path-harness.html stubs only the network; this runner wraps that stub for the refusals).
 *   F5  order entry whose safety check could not run asks for a reason and sends it as uncheckedReason, never as an override
 *   F5  a bedside scan refused because the check did not run asks the nurse for a reason and re-sends it
 *   F5  a dose scanned without the check says so on the round
 *   F3  a dose whose order changed after it was checked offers Verify again, not Administer
 *   F6  what the order check could not cover is shown on the review
 * The server contracts are tested for real in test/wardsynq-mar-order-integrity.test.mjs.
 *
 *   node test/run-ward-mar-integrity-ui.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9391, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-mar-integrity-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const waitFor = async (expr, n) => { for (let i = 0; i < (n || 40); i++) { if (await ev(expr)) return true; await sleep(100); } return false; };
const bodies = (frag) => ev(`return JSON.stringify(window.__calls.filter(function(c){return c.url.indexOf(${JSON.stringify(frag)})>=0 && c.method === "POST"}).map(function(c){return c.body}));`).then((s) => JSON.parse(s || "[]"));
const typeInto = async (id, text) => { await ev(`var e=document.getElementById(${JSON.stringify(id)}); e.focus(); e.value=""; return true;`); await call("Input.insertText", { text }); await sleep(40); };

/* The refusals the real routes return (functions/_wardsynq/migrate-inpatient.js, migrate-emar.js, mar-schedule.js). */
const WRAP = `
(function () {
  var orig = window.fetch;
  var res = function (status, obj) { return Promise.resolve({ ok: status < 400, status: status, json: function () { return Promise.resolve(obj); } }); };
  window.fetch = function (url, opts) {
    var u = String(url), body = null;
    try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
    if (u.indexOf("/ward/medication-order") >= 0 && body && body.checkOnly) {
      window.__calls.push({ url: u, method: "POST", body: body });
      return res(200, { ok: true, written: 0, checkOnly: true, drug: body.order.drug,
        safety: { checked: false, code: "SAFETY_CHECK_UNAVAILABLE", message: "allergy list unreadable",
          coverage: [{ code: "RENAL_CHECK_NOT_AVAILABLE", disposition: "warn", message: "Renal dose check not available: no renal table is loaded." }] } });
    }
    if (u.indexOf("/ward/mar") >= 0 && body && body.action === "scan" && !body.uncheckedReason) {
      window.__calls.push({ url: u, method: "POST", body: body });
      return res(409, { ok: false, status: 409, error: "refused", action: "scan", from: "dispensed",
        reasons: [{ code: "SAFETY_CHECK_UNAVAILABLE", disposition: "block", checkNotRun: true, message: "The allergy, interaction and dose checks could not run." }] });
    }
    if (u.indexOf("/ward/schedule") >= 0 && window.__markRound) {
      return orig(url, opts).then(function (r) { return r.json(); }).then(function (j) {
        (j.due || []).forEach(function (d) { d.safetyNotRun = { code: "SAFETY_CHECK_UNAVAILABLE", reason: "doctor at the bedside", by: "cfa:rn" }; });
        j.due = (j.due || []).concat([{ orderId: "wsq-rx-ceftriaxone", orderVersion: 2, drug: "Ceftriaxone", dose: { value: 2, unit: "g" }, route: "IV", frequency: "OD",
          status: "scanned", recheckNeeded: ["dose"], dueAt: "2026-09-08T10:00:00.000Z", overdue: false }]);
        return res(200, j);
      });
    }
    return orig(url, opts);
  };
  return true;
})()`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });
  ok(await waitFor(`return window.__ready === true;`, 50), "real ward.js loaded into the harness");
  ok(await ev(`return ${WRAP.trim()};`), "the stub answers the refusals the real routes return");

  // Admit a patient through the board and open the chart, as the golden path does.
  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  await waitFor(`return document.querySelectorAll('.w-empty').length > 0 || document.querySelector('.w-bed');`);
  await ev(`document.querySelector('[data-w-act="board"]').click(); return true;`);
  await waitFor(`return !!document.querySelector('.w-bedcell.free');`);
  await ev(`var b=[].filter.call(document.querySelectorAll('.w-bedcell.free'), function(x){return x.textContent.indexOf('12')>=0})[0]; b.click(); return true;`);
  await waitFor(`return !!document.querySelector('[data-w-act="admitnew"]');`);
  await ev(`document.querySelector('[data-w-act="admitnew"]').click(); return true;`);
  await waitFor(`return !!document.querySelector('.w-bed');`);
  await ev(`document.querySelector('.w-bed').click(); return true;`);
  ok(await waitFor(`return !!document.getElementById('wMoDrug');`), "the chart opened");

  // F5 + F6 at order entry.
  await ev(`document.getElementById('wMoDrug').value='Paracetamol 500mg'; document.getElementById('wMoValue').value='500'; document.getElementById('wMoUnit').value='mg'; document.getElementById('wMoRoute').value='oral'; document.getElementById('wMoFreq').value='BD'; document.querySelector('[data-w-act="medorder"]').click(); return true;`);
  ok(await waitFor(`return !!document.getElementById('wMoReview');`), "a check that could not run opens the review");
  const review = await ev(`return document.getElementById('wMoReview').innerText;`);
  ok(/could not run/.test(review) && /without the safety check \(required\)/.test(review), "the review says the check did not run and asks for a reason: " + JSON.stringify(review));
  ok(/Renal dose check not available/.test(review), "and shows what the check could not cover");
  await ev(`document.querySelector('[data-w-act="moconfirm"]').click(); return true;`);
  await sleep(200);
  ok((await bodies("/ward/medication-order")).filter((b) => !b.checkOnly).length === 0, "Prescribe anyway with no reason sends nothing");
  await typeInto("wMoOverride", "septic, cannot wait");
  await ev(`document.querySelector('[data-w-act="moconfirm"]').click(); return true;`);
  await waitFor(`return window.__calls.some(function(c){return c.url.indexOf('/ward/medication-order')>=0 && c.body && !c.body.checkOnly;});`);
  const placed = (await bodies("/ward/medication-order")).filter((b) => !b.checkOnly).pop();
  ok(placed && placed.uncheckedReason === "septic, cannot wait" && !placed.overrideReason, "the reason goes as uncheckedReason, not as an override: " + JSON.stringify(placed));

  // F5 at the bedside.
  ok(await waitFor(`return !!document.querySelector('[data-w-act^="mar:verify"]');`), "the order is on the round");
  await ev(`document.querySelector('[data-w-act^="mar:verify"]').click(); return true;`);
  await waitFor(`return !!document.querySelector('[data-w-act^="mar:dispense"]');`);
  await ev(`document.querySelector('[data-w-act^="mar:dispense"]').click(); return true;`);
  await waitFor(`return !!document.querySelector('[data-w-act^="mar:scan"]');`);
  await ev(`document.querySelector('[data-w-act^="mar:scan"]').click(); return true;`);
  ok(await waitFor(`return !!document.getElementById('wAsk_reason');`), "a scan refused because the check did not run asks the nurse for a reason");
  ok(/could not run/.test(await ev(`return document.querySelector('#smdWard .w-ask').innerText;`)), "and says why");
  await typeInto("wAsk_reason", "doctor at the bedside");
  await ev(`document.querySelector('[data-w-act="askok"]').click(); return true;`);
  await waitFor(`return window.__calls.filter(function(c){return c.url.indexOf('/ward/mar')>=0 && c.body && c.body.action==='scan';}).length >= 2;`);
  const scans = (await bodies("/ward/mar")).filter((b) => b.action === "scan");
  ok(scans.length === 2 && !scans[0].uncheckedReason && scans[1].uncheckedReason === "doctor at the bedside" && scans[1].scan,
    "the scan is sent again with the reason and the same scan: " + JSON.stringify(scans.map((b) => b.uncheckedReason || null)));

  // F5 and F3 on the round.
  await ev(`window.__markRound = true; WARD._dispatch("round"); return true;`);
  ok(await waitFor(`return document.body.textContent.indexOf('Safety check did not run') >= 0 && document.body.textContent.indexOf('doctor at the bedside') >= 0;`), "a dose scanned without the check says so on the round");
  ok(await ev(`return Array.from(document.querySelectorAll('.w-dose-s small')).some(function(e){return e.textContent.indexOf('Safety check did not run')>=0 && e.offsetHeight>0;});`), "and it is visible on the row");
  ok(await waitFor(`return Array.from(document.querySelectorAll('.w-doses li')).some(function(li){return li.textContent.indexOf('Ceftriaxone')>=0 && li.textContent.indexOf('The order changed after this dose was checked')>=0 && !!li.querySelector('[data-w-act^="mar:verify"]') && !li.querySelector('[data-w-act^="mar:administer"]');});`),
    "a dose whose order changed offers Verify again and no Administer");

  for (const w of [375, 768, 1280]) {
    await call("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 });
    await sleep(120);
    const overflow = await ev(`return document.documentElement.scrollWidth - window.innerWidth;`);
    ok(overflow <= 1, `no horizontal overflow at ${w}px (scrollWidth - innerWidth = ${overflow})`);
  }
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
