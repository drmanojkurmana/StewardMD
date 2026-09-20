/* The owner's 2026-09-13 Report Bug fixes that only a real browser can prove (docs/wardsynq/BUG_REPORTS.md):
 * real change events on selects, real layout order at phone width, a mic inside a real textarea, and the
 * bed board transfer clicked through. Real ward.js and ward.css on test/ward-tablet-harness.html, stubbed
 * transport, no network. Fixtures are invented; no patient data.
 *
 *   node test/run-ward-bug-reports-0913-ui.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9397, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-bugs-0913-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-tablet-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=1024,768"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const waitFor = async (js, n) => { for (let i = 0; i < (n || 40); i++) { await sleep(100); if (await ev(js)) return true; } return false; };
const size = (width, height) => call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
const change = (id, value) => ev(`var s = document.getElementById(${JSON.stringify(id)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("change", { bubbles: true })); return true;`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await size(1024, 768);
  await call("Page.navigate", { url: URL });
  let ready = null;
  for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, `real ward.js loaded into the harness (${ready})`);

  // The harness transport, plus the department the server now sends and a bed board.
  await ev(`
    var base = window.fetch;
    window.fetch = function (url, opts) {
      var u = String(url);
      var reply = function (o) { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(o); } }); };
      if (u.indexOf("/ward/list") >= 0) return reply({ ok: true, region: "IN", patients: [
        { encounterId: "enc-1", patientId: "pat-1", name: "Harness Patient One", mrn: "MRN-H1", ward: "Ward A", department: "General Medicine", bed: "07", class: "IPD", admittedAt: "2026-09-12T04:00:00.000Z" },
        { encounterId: "enc-2", patientId: "pat-2", name: "Harness Patient Two", mrn: "MRN-H2", ward: "CCU", department: "Cardiology", bed: "1", class: "IPD", admittedAt: "2026-09-12T04:00:00.000Z" }] });
      if (u.indexOf("/ward/beds") >= 0) return reply({ ok: true, bedsConfigured: true, wards: [
        { ward: "CCU", department: "Cardiology", occupied: [{ encounterId: "enc-2", patientId: "pat-2", name: "Harness Patient Two", bed: "1" }], unplaced: [], free: ["2"], bedsKnown: true },
        { ward: "Ward A", department: "General Medicine", occupied: [{ encounterId: "enc-1", patientId: "pat-1", name: "Harness Patient One", bed: "07" }], unplaced: [], free: ["08"], bedsKnown: true }] });
      if (u.indexOf("/ward/transfer") >= 0) return reply({ ok: true, written: 1 });
      return base(url, opts);
    };
    window.confirm = function () { return true; };
    return true;`);
  await ev(`WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="open:enc-2"]');`), "the ward list rendered");

  // BUG-MU0710W4-04KD: a real change event on the Department select narrows the list.
  ok(await ev(`return !!document.getElementById("wRosterDeptFilter");`), "0710W4: a Department filter is offered from the record");
  await change("wRosterDeptFilter", "Cardiology");
  ok(await waitFor(`return !document.querySelector('[data-w-act="open:enc-1"]') && !!document.querySelector('[data-w-act="open:enc-2"]');`), "0710W4: choosing Cardiology shows only Cardiology's patient");
  await change("wRosterDeptFilter", "");
  await change("wRosterWardFilter", "Ward A");
  ok(await waitFor(`return !!document.querySelector('[data-w-act="open:enc-1"]') && !document.querySelector('[data-w-act="open:enc-2"]');`), "0710W4: the Ward select applies on change");
  await change("wRosterWardFilter", "");

  // BUG-MU073XKT-7KZW: at phone width the patient list is above the tools.
  await size(390, 844); await sleep(250);
  const order = JSON.parse(await ev(`return JSON.stringify({ roster: document.querySelector(".w-col-roster").getBoundingClientRect().top, tools: document.querySelector(".w-col-tools").getBoundingClientRect().top });`));
  ok(order.roster < order.tools, `7KZW: the patient list comes first on a phone (list ${Math.round(order.roster)} px, tools ${Math.round(order.tools)} px)`);
  await size(1280, 800); await sleep(250);
  const wide = JSON.parse(await ev(`return JSON.stringify({ roster: document.querySelector(".w-col-roster").getBoundingClientRect().left, tools: document.querySelector(".w-col-tools").getBoundingClientRect().left });`));
  ok(wide.tools < wide.roster, "G0GA: on a wide screen the tools are on the left and the patient list on the right");

  // BUG-MU08DSH6-N7FM: a bed tile opens that patient's chart.
  await ev(`document.querySelector('[data-w-act="board"]').click(); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="openbedpatient:enc-2"]');`), "the bed board rendered with occupied tiles");
  await ev(`document.querySelector('[data-w-act="openbedpatient:enc-2"]').click(); return true;`);
  ok(await waitFor(`return WARD._st.view === "chart" && WARD._st.sel && WARD._st.sel.encounterId === "enc-2";`), "DSH6: tapping bed 1 in CCU opened that patient's chart");

  // BUG-MU08NPGV-0MZX: every free-text box has a mic inside its right edge (the lab result form and the
  // timeline note: one decorated here, one that carries its own).
  await ev(`WARD._st.view = "labboard"; WARD._st.labBoard = { specimens: [], pending: [{ serviceRequestId: "sr-1", display: "CBC", patientId: "pat-2" }], criticals: [], toVerify: [], cultures: [], histopathology: [], errors: [], failed: {} };
    WARD._st.labResultFor = { serviceRequestId: "sr-1", display: "CBC", patientId: "pat-2" }; WARD._dispatch("labdept:all"); return true;`);
  const mics = JSON.parse(await ev(`
    var tas = [].slice.call(document.querySelectorAll("#smdWard textarea[id]"));
    var bad = tas.filter(function (ta) {
      var b = document.querySelector('[data-w-act="dictate:' + ta.id + '"]');
      if (!b) return true;
      var r = ta.getBoundingClientRect(), m = b.getBoundingClientRect();
      if (ta.parentNode.className !== "w-dict") return false; // a box with its own mic, placed by its card
      return !(m.right <= r.right + 1 && m.left >= r.left && m.top >= r.top - 1);
    }).map(function (ta) { return ta.id; });
    return JSON.stringify({ n: tas.length, bad: bad });`));
  ok(mics.n > 0 && mics.bad.length === 0, `0MZX: ${mics.n} text box(es) on the lab result form, each with voice typing inside it (${mics.bad.join(", ") || "none missing"})`);
  // BUG-MU09M56N-TOP1: the Microbiology tab, clicked, can start a culture.
  await ev(`document.querySelector('[data-w-act="labdept:micro"]').click(); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="cultureopen:sr-1"]') && !document.querySelector('[data-w-act="labresultopen:sr-1"]');`), "TOP1: the Microbiology tab lists the test with a Culture button");
  await ev(`WARD._st.labResultFor = null; WARD._st.view = "chart"; WARD._dispatch("labdept:all"); return true;`);

  // BUG-MU08T4RL-GU0N / BUG-MU06Z46U-DMDX: transfer on the board, department chosen with a real change event.
  await ev(`window.__posts = []; var f = window.fetch; window.fetch = function (u, o) { if (o && o.method === "POST") window.__posts.push({ url: String(u), body: JSON.parse(o.body) }); return f(u, o); }; return true;`);
  await ev(`document.querySelector('[data-w-act="move"]').click(); return true;`);
  ok(await waitFor(`return WARD._st.view === "board" && !!document.getElementById("wBoardDept");`), "GU0N: Transfer opens the bed board with a Department choice");
  await change("wBoardDept", "General Medicine");
  ok(await waitFor(`return !!document.querySelector('[data-w-act="pickbed:Ward A|08"]') && !document.querySelector('[data-w-act="pickbed:CCU|2"]');`), "DMDX: choosing the department shows only its wards");
  await ev(`document.querySelector('[data-w-act="pickbed:Ward A|08"]').click(); return true;`);
  ok(await waitFor(`return window.__posts.some(function (p) { return /\\/ward\\/transfer$/.test(p.url) && p.body.ward === "Ward A" && p.body.bed === "08"; });`), "GU0N: the transfer posts the ward and bed that were picked");
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
