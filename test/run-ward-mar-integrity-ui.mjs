/* WardSynQ ward: the Codex audit medication fixes (F3, F5, F6), on the real ward.js and ward.css in headless Chrome over
 * CDP (test/ward-golden-path-harness.html stubs only the network; this runner wraps that stub for the refusals).
 *   F5  order entry whose safety check could not run asks for a reason and sends it as uncheckedReason, never as an override
 *   F5  a bedside scan refused because the check did not run asks the nurse for a reason and re-sends it
 *   F5  a dose scanned without the check says so on the round
 *   F3  a dose whose order changed after it was checked offers Verify again, not Administer
 *   F6  what the order check could not cover is shown on the review
 *   F5  a consultation medicine refused because the check did not run asks the doctor for a reason and re-sends it as uncheckedReason
 *   UI  the review and both reason questions take focus, name the drug, cannot be sent twice, and nothing clips at 390 px
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
    if (u.indexOf("/ward/consultation") >= 0 && body && body.medications) {
      window.__calls.push({ url: u, method: "POST", body: body });
      if (!body.medications[0].uncheckedReason) return res(422, { ok: false, status: 422, error: "consultation_not_saved", written: 0, failedAt: "medications",
        results: [{ piece: "medications", index: 0, ok: false, error: "safety_check_not_run", status: 409, detail: "The allergy, interaction and dose checks could not run." }] });
      return res(200, { ok: true, written: 1, results: [{ piece: "medications", index: 0, ok: true, safety: { checked: false } }] });
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
  ok(await ev(`return document.activeElement && document.activeElement.id === 'wMoOverride';`), "focus lands on the reason box when the review opens");
  ok(await ev(`var i=document.getElementById('wMoOverride'); return i.required && i.getAttribute('aria-required')==='true' && i.maxLength===500 && !!i.closest('label');`), "the reason box is a labelled, required field limited to what the server keeps");
  ok(/Prescribe without the safety check/.test(await ev(`return document.querySelector('[data-w-act="moconfirm"]').innerText;`)) && await ev(`return !!document.querySelector('#wMoReview [data-w-act="medorder"]');`),
    "the button says what it does, and Check again is offered beside it");
  await ev(`document.querySelector('[data-w-act="moconfirm"]').click(); return true;`);
  await sleep(200);
  ok((await bodies("/ward/medication-order")).filter((b) => !b.checkOnly).length === 0, "Prescribe anyway with no reason sends nothing");
  await ev(`document.querySelector('[data-w-act="mocancel"]').click(); return true;`);
  ok(await ev(`return !document.getElementById('wMoReview') && document.activeElement && document.activeElement.getAttribute('data-w-act') === 'medorder';`), "Change the order closes the review and puts focus back on Prescribe");
  await ev(`document.querySelector('[data-w-act="medorder"]').click(); return true;`);
  ok(await waitFor(`return !!document.getElementById('wMoOverride');`), "the review opens again");
  await typeInto("wMoOverride", "septic, cannot wait");
  await ev(`var b=document.querySelector('[data-w-act="moconfirm"]'); b.click(); b.click(); return true;`);
  await waitFor(`return window.__calls.some(function(c){return c.url.indexOf('/ward/medication-order')>=0 && c.body && !c.body.checkOnly;});`);
  const placed = (await bodies("/ward/medication-order")).filter((b) => !b.checkOnly).pop();
  ok(placed && placed.uncheckedReason === "septic, cannot wait" && !placed.overrideReason, "the reason goes as uncheckedReason, not as an override: " + JSON.stringify(placed));
  await sleep(200);
  ok((await bodies("/ward/medication-order")).filter((b) => !b.checkOnly).length === 1, "two quick taps on Prescribe place one order");

  // F5 at the bedside.
  ok(await waitFor(`return !!document.querySelector('[data-w-act^="mar:verify"]');`), "the order is on the round");
  await ev(`document.querySelector('[data-w-act^="mar:verify"]').click(); return true;`);
  await waitFor(`return !!document.querySelector('[data-w-act^="mar:dispense"]');`);
  await ev(`document.querySelector('[data-w-act^="mar:dispense"]').click(); return true;`);
  await waitFor(`return !!document.querySelector('[data-w-act^="mar:scan"]');`);
  await ev(`document.querySelector('[data-w-act^="mar:scan"]').click(); return true;`);
  ok(await waitFor(`return !!document.getElementById('wAsk_reason');`), "a scan refused because the check did not run asks the nurse for a reason");
  const askText = await ev(`return document.querySelector('#smdWard .w-ask').innerText;`);
  ok(/Safety check did not run/.test(askText) && /could not run for/.test(askText) && /by hand/.test(askText) && /Continue without the checks/.test(askText), "and says why, names the drug and what to do: " + JSON.stringify(askText));
  ok(await ev(`return document.activeElement && document.activeElement.id === 'wAsk_reason' && !!document.querySelector('#smdWard .w-ask [role=dialog][aria-labelledby=wAskTitle]');`), "focus is in the reason box of a labelled dialog");
  await ev(`document.querySelector('[data-w-act="askok"]').click(); return true;`);
  await sleep(150);
  ok((await bodies("/ward/mar")).filter((b) => b.action === "scan").length === 1 && await ev(`return !!document.getElementById('wAsk_reason') && /reason is required/.test(document.querySelector('.w-ask').innerText);`), "an empty reason is refused where it is asked and nothing is sent");
  await typeInto("wAsk_reason", "doctor at the bedside");
  await ev(`document.querySelector('[data-w-act="askok"]').click(); return true;`);
  await waitFor(`return window.__calls.filter(function(c){return c.url.indexOf('/ward/mar')>=0 && c.body && c.body.action==='scan';}).length >= 2;`);
  const scans = (await bodies("/ward/mar")).filter((b) => b.action === "scan");
  ok(scans.length === 2 && !scans[0].uncheckedReason && scans[1].uncheckedReason === "doctor at the bedside" && scans[1].scan,
    "the scan is sent again with the reason and the same scan: " + JSON.stringify(scans.map((b) => b.uncheckedReason || null)));

  // F5 and F3 on the round.
  await ev(`window.__markRound = true; WARD._dispatch("round"); return true;`);
  ok(await waitFor(`return document.body.textContent.indexOf('Safety check did not run') >= 0 && document.body.textContent.indexOf('doctor at the bedside') >= 0;`), "a dose scanned without the check says so on the round");
  ok(await ev(`return Array.from(document.querySelectorAll('.w-dose-note')).some(function(e){return e.textContent.indexOf('Safety check did not run')>=0 && e.offsetHeight>0;});`), "and it is visible on the row");
  ok(await waitFor(`return Array.from(document.querySelectorAll('.w-doses li')).some(function(li){return li.textContent.indexOf('Ceftriaxone')>=0 && li.textContent.indexOf('The order changed after this dose was checked')>=0 && !!li.querySelector('[data-w-act^="mar:verify"]') && !li.querySelector('[data-w-act^="mar:administer"]');});`),
    "a dose whose order changed offers Verify again and no Administer");
  ok(await ev(`var li=Array.from(document.querySelectorAll('.w-doses li')).filter(function(l){return l.textContent.indexOf('Ceftriaxone')>=0})[0]; return /verify again/i.test(li.querySelector('.w-st.recheck').textContent) && !li.querySelector('.w-st.scanned');`), "the status chip says verify again, not the stale status");

  // 390 px: nothing clipped, and the sentences are sentences (not capitalised chips).
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(150);
  ok(await ev(`var n=document.querySelectorAll('.w-dose-note'); if(n.length<2) return false; return Array.from(n).every(function(e){return e.scrollWidth<=e.clientWidth+1 && e.offsetHeight>0 && getComputedStyle(e).textTransform==='none';});`), "both dose notes fit at 390 px in sentence case");
  ok(await ev(`return Array.from(document.querySelectorAll('.w-doses li')).every(function(li){return li.scrollWidth<=li.clientWidth+1;});`), "no dose row is clipped at 390 px");

  // F5 on the consultation screen.
  await ev(`document.querySelector('[data-w-act="consultation"]').click(); return true;`);
  ok(await waitFor(`return !!document.getElementById('wcMoDrug');`), "the consultation screen opened");
  await typeInto("wcMoDrug", "Amoxicillin 500mg"); await typeInto("wcMoValue", "500"); await typeInto("wcMoUnit", "mg");
  await ev(`document.querySelector('[data-w-act="consultationsave"]').click(); return true;`);
  ok(await waitFor(`return !!document.getElementById('wAsk_reason');`), "a consultation medicine refused because the check did not run asks the doctor for a reason");
  const cAsk = await ev(`return document.querySelector('#smdWard .w-ask').innerText;`);
  ok(/Safety check did not run/.test(cAsk) && /Amoxicillin 500mg/.test(cAsk) && /not saved/.test(cAsk) && /Save without the checks/.test(cAsk), "naming the drug and saying nothing was saved: " + JSON.stringify(cAsk));
  await ev(`document.querySelector('[data-w-act="askok"]').click(); return true;`);
  await sleep(150);
  ok((await bodies("/ward/consultation")).length === 1 && await ev(`return !!document.getElementById('wAsk_reason') && /reason is required/.test(document.querySelector('.w-ask').innerText);`), "no reason sends nothing");
  await typeInto("wAsk_reason", "no allergy list, doctor reviewed by hand");
  await ev(`var b=document.querySelector('[data-w-act="askok"]'); b.click(); b.click(); return true;`);
  await waitFor(`return window.__calls.filter(function(c){return c.url.indexOf('/ward/consultation')>=0;}).length >= 2;`);
  await sleep(300);
  const cons = await bodies("/ward/consultation");
  ok(cons.length === 2 && !cons[0].medications[0].uncheckedReason && cons[1].medications[0].uncheckedReason === "no allergy list, doctor reviewed by hand" && !cons[1].medications[0].overrideReason,
    "the consultation is sent again once, with the reason as uncheckedReason: " + JSON.stringify(cons.map((b) => b.medications[0].uncheckedReason || null)));
  ok(await waitFor(`return !document.getElementById('wAsk_reason');`), "the question closes once it is answered");

  for (const w of [375, 390, 768, 1280]) {
    await call("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 });
    await sleep(120);
    const overflow = await ev(`return document.documentElement.scrollWidth - window.innerWidth;`);
    ok(overflow <= 1, `no horizontal overflow at ${w}px (scrollWidth - innerWidth = ${overflow})`);
  }
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
