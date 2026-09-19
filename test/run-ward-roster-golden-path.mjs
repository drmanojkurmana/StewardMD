/* The ward round list is a ROUND, not a dump: grouped by ward, ordered by bed, admission-class chips
 * with counts, and a live search over name / MRN / bed that keeps the search box focused. Driven in
 * real headless Chrome over CDP against the REAL ward.js and ward.css
 * (test/ward-roster-golden-path-harness.html stubs only the network).
 *
 *   node test/run-ward-roster-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9427, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-roster-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-roster-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click(); return true;`);
async function waitFor(expr, tries) {
  for (let i = 0; i < (tries || 30); i++) { await sleep(120); if (await ev(expr)) return true; }
  return false;
}
const rowsOf = `return JSON.stringify([].map.call(document.querySelectorAll('#wRoster .w-bed'), function (b) { return b.querySelector('.w-bed-no').textContent + ':' + b.querySelector('.w-bed-b b').textContent; }));`;
const groupsOf = `return JSON.stringify([].map.call(document.querySelectorAll('#wRoster .w-wardrow h4'), function (h) { return h.childNodes[0].textContent + '|' + h.querySelector('small').textContent; }));`;
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });
  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the roster harness");
  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return document.querySelectorAll('#wRoster .w-bed').length === 6;`), "six admissions rendered");

  // Grouped by ward (alphabetical), each group ordered by bed NUMBER, not by arrival or string order.
  const groups = JSON.parse(await ev(groupsOf) || "[]");
  ok(JSON.stringify(groups) === JSON.stringify(["ICU|2 patients", "Medical A|3 patients", "Medical B|1 patient"]), "grouped by ward with counts: " + JSON.stringify(groups));
  const rows = JSON.parse(await ev(rowsOf) || "[]");
  ok(JSON.stringify(rows) === JSON.stringify(["2:Bhaskar Rao", "10:Asha Devi", "1:Sita Lakshmi", "4:Padma Rani", "12:Gopal Naidu", "3:Ravi Kumar"]), "rows ordered by bed within each ward (2 before 10, 1 before 4 before 12): " + JSON.stringify(rows));
  ok(await ev(`return document.querySelector('.w-count').textContent.indexOf('6 of 6 patients') === 0 && document.querySelector('.w-count').textContent.indexOf('3 wards') > 0;`), "count line says 6 of 6 patients, 3 wards");

  // Class chips carry counts and filter the round.
  const chips = JSON.parse(await ev(`return JSON.stringify([].map.call(document.querySelectorAll('.w-chip'), function (c) { return c.textContent.replace(/\\s+/g, ' ').trim(); }));`) || "[]");
  ok(JSON.stringify(chips) === JSON.stringify(["All 6", "General 3", "ICU 2", "Maternity 1"]), "class chips with counts, only classes present: " + JSON.stringify(chips));
  await click('[data-w-act="setcls:ICU"]');
  ok(await waitFor(`return document.querySelectorAll('#wRoster .w-bed').length === 2 && document.querySelector('.w-chip.on').textContent.indexOf('ICU') === 0;`), "ICU chip shows only the two ICU patients and is marked on");
  ok(await ev(`return document.querySelector('.w-count').textContent.indexOf('2 of 6 patients') === 0;`), "count line says 2 of 6");
  await click('[data-w-act="setcls:"]');
  ok(await waitFor(`return document.querySelectorAll('#wRoster .w-bed').length === 6;`), "All chip restores the full round");

  // Live search over name, MRN and bed; the box keeps focus while the list re-renders.
  await ev(`var q = document.getElementById('wQ'); q.focus(); q.value = 'MR5005'; q.dispatchEvent(new Event('input', { bubbles: true })); return true;`);
  ok(await waitFor(`return document.querySelectorAll('#wRoster .w-bed').length === 1 && document.querySelector('#wRoster .w-bed-b b').textContent === 'Gopal Naidu';`), "search by MRN narrows to one patient");
  ok(await ev(`return document.activeElement && document.activeElement.id === 'wQ' && document.getElementById('wQ').value === 'MR5005';`), "the search box keeps focus and its text across the re-render");
  await ev(`var q = document.getElementById('wQ'); q.value = 'padma'; q.dispatchEvent(new Event('input', { bubbles: true })); return true;`);
  ok(await waitFor(`return document.querySelectorAll('#wRoster .w-bed').length === 1 && document.querySelector('#wRoster .w-bed-b small').textContent.indexOf('Maternity') > 0;`), "search by name is case-insensitive and the row states the admission class");
  await ev(`var q = document.getElementById('wQ'); q.value = 'nobody'; q.dispatchEvent(new Event('input', { bubbles: true })); return true;`);
  ok(await waitFor(`return document.querySelectorAll('#wRoster .w-bed').length === 0 && document.body.textContent.indexOf('No patients match') >= 0;`), "no match says so instead of an empty gap");
  await ev(`var q = document.getElementById('wQ'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); return true;`);

  // Length of stay is on the row; the boards moved out of the filter row into their own card.
  ok(await ev(`return document.querySelector('#wRoster .w-bed-b small').textContent.indexOf('day ') > 0;`), "row carries the day of stay");
  ok(await ev(`return !!document.querySelector('.w-tools [data-w-act="board"]') && !document.querySelector('.w-filter [data-w-act="board"]');`), "boards and tools live in their own card, not the filter row");
  ok(await ev(`return document.querySelectorAll('.w-tools .w-btn').length === 14;`), "all fourteen hospital-wide boards are still reachable");

  // A row still opens the chart.
  await click('#wRoster .w-bed');
  ok(await waitFor(`return window.WARD._st.view === 'chart';`), "tapping a row opens the chart");
  ok(await ev(`return document.body.textContent.indexOf('\\u2014') < 0;`), "no em-dash in the round's copy");
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails === 0 ? "\nALL GREEN - ward roster golden path passed" : `\n${fails} FAILED`);
process.exit(fails ? 1 : 0);
