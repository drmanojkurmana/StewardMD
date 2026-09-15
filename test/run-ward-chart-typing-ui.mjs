/* LT-06 / LT-12 / LT-14 (docs/wardsynq/LIVE_TEST_2026-09-15.md), in real headless Chrome over CDP against the real
 * ward.js and ward.css (test/ward-tablet-harness.html stubs only the network). Proves what a unit test cannot:
 * text really typed into the chart's vitals and medication order boxes survives the late repaints the chart's own
 * reads cause (one held back 2.5 s here, as a slow read on the live site was), a repaint seconds later too, and a
 * save the server accepted still empties the form. Then the medication order goes through the server's safety check
 * before anything is written, and a finding needs a reason.
 *
 *   node test/run-ward-chart-typing-ui.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9497, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-chart-typing-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-tablet-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=1280,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const waitFor = async (js, n) => { for (let i = 0; i < (n || 40); i++) { await sleep(100); if (await ev(js)) return true; } return false; };
/* Real typing: focus the box, then the browser inserts the text as a keyboard would. */
const type = async (id, text) => { await ev(`document.getElementById(${JSON.stringify(id)}).focus(); return true;`); await call("Input.insertText", { text }); await sleep(40); };
const value = (id) => ev(`var e = document.getElementById(${JSON.stringify(id)}); return e ? e.value : null;`);
const click = (sel) => ev(`var b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true;`);
const posts = (part) => ev(`return JSON.stringify(window.__calls.filter(function (c) { return c.method === "POST" && c.url.indexOf(${JSON.stringify(part)}) >= 0; }).map(function (c) { return c.body; }));`).then((s) => JSON.parse(s || "[]"));

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.navigate", { url: URL });
  ok(await waitFor(`return window.__ready === true;`, 60), "real ward.js loaded into the harness");

  /* The network as the live chart saw it: the timeline read lands 2.5 s after the chart opens, so its repaint arrives
   * while someone is typing. Vitals and the medication order get answers shaped like the real routes'. */
  await ev(`var real = window.fetch;
    window.__rx = { checkOnly: 0, written: 0 };
    window.fetch = function (url, opts) {
      var u = String(url), p = real(url, opts), body = null;
      try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
      var reply = function (o) { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(o); } }); };
      if (u.indexOf("/ward/timeline") >= 0) return new Promise(function (r) { setTimeout(function () { r(p); }, 2500); });
      if (u.indexOf("/ward/vitals") >= 0) return reply({ ok: true, written: 4 });
      if (u.indexOf("/ward/medication-order") >= 0) {
        if (body && body.checkOnly) { window.__rx.checkOnly++; return reply({ ok: true, written: 0, checkOnly: true, drug: body.order.drug,
          safety: { checked: true, rulePackVersion: "harness", blocks: [], warnings: [], unresolvedDrug: false, unresolvedActiveMeds: [],
            overridables: [{ code: "ALLERGY_CLASS", disposition: "overridable", message: "Documented penicillin allergy; amoxicillin is a penicillin." }] } }); }
        window.__rx.written++; return reply({ ok: true, written: 1, orderId: "rx-h1", safety: { checked: true } });
      }
      return p;
    };
    return true;`);

  await ev(`WARD.open({ orgId: "org-tablet-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="open:enc-1"]');`), "the ward list shows the harness patient");
  await ev(`document.querySelector('[data-w-act="open:enc-1"]').click(); return true;`);
  ok(await waitFor(`return !!document.getElementById("wv_sbp") && !!document.getElementById("wMoDrug");`), "the chart opened with the vitals and medication order forms");

  // LT-06: type straight away, then wait past the late timeline repaint.
  const painted = await ev(`window.__paints = 0; var r = document.getElementById("smdWard"); new MutationObserver(function () { window.__paints++; }).observe(r, { childList: true }); return true;`);
  await type("wv_sbp", "120"); await type("wv_dbp", "80"); await type("wv_pulse", "88"); await type("wv_rr", "18");
  await type("wMoDrug", "Amoxicillin"); await type("wMoValue", "500");
  await sleep(3200);
  ok(painted && (await ev(`return window.__paints;`)) > 0, "the chart really did repaint after the typing (" + (await ev(`return window.__paints;`)) + " repaints)");
  ok((await value("wv_sbp")) === "120" && (await value("wv_dbp")) === "80" && (await value("wv_pulse")) === "88" && (await value("wv_rr")) === "18",
    "LT-06: typed vitals survive the late repaint: " + JSON.stringify([await value("wv_sbp"), await value("wv_dbp"), await value("wv_pulse"), await value("wv_rr")]));
  ok((await value("wMoDrug")) === "Amoxicillin" && (await value("wMoValue")) === "500", "LT-12: a half-typed medication order survives it too");
  ok(await ev(`return document.activeElement && document.activeElement.id === "wMoValue";`), "focus is still in the box being typed in");

  // LT-12: a repaint much later (another read landing) keeps them as well.
  await ev(`WARD._st.note = "harness repaint"; document.querySelector('[data-w-act="investigations"]').click(); return true;`);
  await sleep(600);
  ok((await value("wMoDrug")) === "Amoxicillin" && (await value("wv_rr")) === "18", "LT-12: a repaint seconds later still keeps what was typed");

  // A save the server accepted empties its own form, and only its own form.
  ok(await click('[data-w-act="vitals"]'), "Record vitals pressed");
  ok(await waitFor(`return document.getElementById("wv_sbp") && document.getElementById("wv_sbp").value === "";`), "an accepted vitals save empties the vitals form");
  ok((await value("wMoDrug")) === "Amoxicillin", "and leaves the medication order someone is still writing");

  // LT-14: Prescribe asks the server's safety check first; nothing is written until the prescriber decides.
  await type("wMoUnit", "mg"); await type("wMoFreq", "TDS");
  ok(await click('[data-w-act="medorder"]'), "Prescribe pressed");
  ok(await waitFor(`return !!document.getElementById("wMoReview");`), "the server's findings are shown before anything is written");
  const r1 = JSON.parse(await ev(`return JSON.stringify(window.__rx);`));
  ok(r1.checkOnly === 1 && r1.written === 0, "one check, no write: " + JSON.stringify(r1));
  ok(await ev(`return document.getElementById("wMoReview").textContent.indexOf("ALLERGY_CLASS") >= 0;`), "the allergy finding is on screen in the engine's words");
  ok((await value("wMoDrug")) === "Amoxicillin", "the order stays on the form while it is reviewed");
  ok(await click('[data-w-act="moconfirm"]'), "Prescribe anyway pressed with no reason");
  ok(await waitFor(`return document.body.textContent.indexOf("Give a reason to prescribe past these findings") >= 0;`), "a finding that needs a reason is not prescribed without one");
  ok(JSON.parse(await ev(`return JSON.stringify(window.__rx);`)).written === 0, "and nothing was written");
  await type("wMoOverride", "Tolerated amoxicillin in 2024");
  ok(await click('[data-w-act="moconfirm"]'), "Prescribe anyway pressed with a reason");
  ok(await waitFor(`return window.__rx.written === 1 && !document.getElementById("wMoReview");`), "the order is written once and the review closes");
  const sent = (await posts("/ward/medication-order")).filter((b) => !b.checkOnly);
  ok(sent.length === 1 && sent[0].overrideReason === "Tolerated amoxicillin in 2024" && !sent[0].safety && sent[0].order.drug === "Amoxicillin",
    "the write carries the reason and the order, and no client-made verdict: " + JSON.stringify(sent));
  ok(await waitFor(`return document.getElementById("wMoDrug") && document.getElementById("wMoDrug").value === "";`), "a prescription the server accepted empties the order form");
  ok(await waitFor(`return window.__calls.filter(function (c) { return c.url.indexOf("/ward/schedule") >= 0; }).length >= 2;`), "the round is read again after prescribing");
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
