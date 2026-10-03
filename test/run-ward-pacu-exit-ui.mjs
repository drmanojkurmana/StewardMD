/* WardSynQ: leaving recovery (PACU), driven in real headless Chrome at 390 px against the REAL ward.js
 * and ward.css (test/ward-surgery-golden-path-harness.html stubs only the network). The theatre board
 * lists who is in recovery; "Leave recovery" asks where the patient goes; a ward bed or unit is picked
 * on the bed board and confirmed; a refused bed keeps the question open and the patient in recovery;
 * home is recorded from the question. And To PACU with no bays listed falls back to bay "1", editable.
 * The bed board shows each recovery bay taken ("Recovery" and how long), never offered as a free bed, at 390 px and tablet width.
 * The server half is test/wardsynq-surgery.test.mjs (LEAVE RECOVERY ...).
 *
 *   node test/run-ward-pacu-exit-ui.mjs   (needs Google Chrome; CHROME=... to point elsewhere; SHOTS=dir saves screenshots)
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9397, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-pacu-exit-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-surgery-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=390,844"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const lastBody = (frag) => ev(`var c=window.__calls.filter(function(c){return c.method==="POST" && c.url.indexOf(${JSON.stringify(frag)})>=0}); return JSON.stringify(c[c.length-1]&&c[c.length-1].body);`).then((s) => { try { return JSON.parse(s); } catch { return null; } });
const posts = (frag) => ev(`return window.__calls.filter(function(c){return c.method==="POST" && c.url.indexOf(${JSON.stringify(frag)})>=0}).length;`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click(); return true;`);
const pick = (key, v) => ev(`var s=document.querySelector('.w-ask [data-w-ask="${key}"]'); s.value=${JSON.stringify(v)}; s.dispatchEvent(new Event("input",{bubbles:true})); s.dispatchEvent(new Event("change",{bubbles:true})); return true;`);
const text = () => ev(`return document.body.textContent;`);
const noSideScroll = () => ev(`return document.documentElement.scrollWidth <= window.innerWidth;`);
async function shot(name) {
  if (!process.env.SHOTS) return;
  const r = await call("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(process.env.SHOTS, name + ".png"), Buffer.from(r.result.data, "base64"));
}
async function waitFor(expr, tries) {
  for (let i = 0; i < (tries || 30); i++) { await sleep(120); if (await ev(expr)) return true; }
  return false;
}
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const ROWS = [
  { encounterId: "wsq-pacu-a", caseId: "a", patientId: "p-a", name: "Lakshmi Narayanan Venkataraman", mrn: "SMD-H1-RC01", procedure: "Laparoscopic cholecystectomy", bed: "Bay 1", since: ago(95), version: 1 },
  { encounterId: "wsq-pacu-b", caseId: "b", patientId: "p-b", mrn: "SMD-H1-RC02", procedure: "Open inguinal hernia repair with mesh", bed: "Bay 12", since: ago(25), version: 3 },
  { encounterId: "wsq-pacu-c", caseId: "c", patientId: "p-c", mrn: "SMD-H1-RC03", procedure: "Excision of lipoma", bed: "Bay 4", since: ago(190), version: 1 },
];
const recoveryTiles = () => ev(`return JSON.stringify(Array.prototype.filter.call(document.querySelectorAll('.w-bedgrid [data-w-act="surgeryboard"]'), function (b) { return !!b.querySelector('.w-bedcell-rec'); }).map(function (b) { var r=b.getBoundingClientRect(); return { text: b.textContent, h: r.height, right: r.right, clipped: Array.prototype.some.call(b.querySelectorAll('span'), function (s) { return s.classList.contains('w-bedcell-rec') && s.scrollWidth > s.clientWidth + 1; }) }; }));`).then((s) => JSON.parse(s));

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: URL });
  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the harness");
  ok(await ev(`return window.innerWidth;`) === 390, "the viewport is 390 px wide");

  // ---- 1. The theatre board lists who is in recovery. -------------------------------------------------
  await ev(`window.__setRecovery(${JSON.stringify(ROWS)}); window.WARD.open({ orgId: "org-harness" }); return true;`);
  await waitFor(`return !!document.querySelector('[data-w-act="surgeryboard"]');`);
  await click('[data-w-act="surgeryboard"]');
  ok(await waitFor(`return document.querySelectorAll('[data-w-act^="leaverecovery:"]').length === 3;`), "every open recovery stay is a row on the theatre board");
  const t1 = await text();
  ok(t1.indexOf("In recovery (PACU)") >= 0 && t1.indexOf("Bay 12") >= 0 && t1.indexOf("SMD-H1-RC02") >= 0 && t1.indexOf("Leave recovery") >= 0, "each row names the bay, the MRN and the action");
  ok(await noSideScroll(), "no sideways scroll at 390 px");
  ok(await ev(`return Array.prototype.every.call(document.querySelectorAll('[data-w-act^="leaverecovery:"]'), function (b) { var r=b.getBoundingClientRect(); return r.height >= 44 && r.right <= window.innerWidth; });`), "each row is a full-width target at least 44 px tall");
  ok(await ev(`var b=document.querySelector('[data-w-act="leaverecovery:wsq-pacu-b"] .w-bed-no'); return b.scrollWidth <= b.clientWidth + 1;`), "a long bay name fits its badge");
  await ev(`document.querySelector('[data-w-act="leaverecovery:wsq-pacu-b"]').scrollIntoView({block:"center"}); return true;`);
  await shot("1-board-recovery");

  // ---- 2. To a ward bed: the bed board, a refused bed, then a free one. --------------------------------
  await click('[data-w-act="leaverecovery:wsq-pacu-a"]');
  ok(await waitFor(`return !!document.querySelector('.w-ask select[data-w-ask="outcome"]');`), "Leave recovery asks where the patient goes");
  ok(await ev(`return Array.prototype.map.call(document.querySelectorAll('.w-ask select[data-w-ask="outcome"] option'), function (o) { return o.value; }).join(",");`) === "ward,unit,home", "the three ways out: a ward bed, a unit, home");
  await shot("2-leave-question");
  await click('[data-w-act="askok"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Leaving recovery: SMD-H1-RC01') >= 0 && !!document.querySelector('[data-w-act="pickbed:Surgical Ward|S1"]');`), "a ward bed is chosen on the bed board, which says who is leaving recovery");
  ok(await noSideScroll(), "the bed board has no sideways scroll at 390 px");
  // The PACU ward on the same board: every recovery bay is taken, labelled, and not offered to this move.
  const tiles = await recoveryTiles();
  ok(tiles.length === 3, "each recovery stay holds its bay on the bed board: " + tiles.length);
  ok(tiles.some((x) => x.text.indexOf("Bay 1") === 0 && x.text.indexOf("Recovery · 1 h 35 min") >= 0) && tiles.some((x) => x.text.indexOf("Recovery · 25 min") >= 0) && tiles.some((x) => x.text.indexOf("Recovery · 3 h 10 min") >= 0),
    "each bay says Recovery and for how long: " + tiles.map((x) => x.text).join(" | "));
  ok(tiles.some((x) => x.text.indexOf("SMD-H1-RC02") >= 0), "a tile with no name shows the MRN");
  ok(await ev(`return ['Bay 1','Bay 4','Bay 12'].every(function (b) { return !document.querySelector('[data-w-act="pickbed:PACU|' + b + '"]'); }) && !!document.querySelector('[data-w-act="pickbed:PACU|Bay 2"]');`), "a recovery bay is never a free bed to pick; the empty bay is");
  ok(await ev(`return Array.prototype.some.call(document.querySelectorAll('.w-wardrow h4'), function (h) { return h.textContent.indexOf('PACU') === 0 && h.textContent.indexOf('3 occupied') >= 0 && h.textContent.indexOf('1 free') >= 0; });`), "the PACU header counts the recovery bays as occupied");
  ok(tiles.every((x) => x.h >= 44 && x.right <= 390 && !x.clipped), "recovery tiles are 44 px targets inside the screen, the label not cut off: " + JSON.stringify(tiles.map((x) => [x.h, x.right, x.clipped])));
  await ev(`document.querySelector('.w-bedgrid [data-w-act="surgeryboard"]').scrollIntoView({block:"center"}); return true;`);
  await shot("2b-bed-board-recovery");
  await click('[data-w-act="pickbed:Surgical Ward|S1"]');
  ok(await waitFor(`return document.querySelector('.w-ask') && document.querySelector('.w-ask').textContent.indexOf('Move SMD-H1-RC01 from recovery to Surgical Ward, bed S1?') >= 0;`), "picking a bed asks to confirm the move, naming patient, ward and bed");
  await click('[data-w-act="askok"]');
  ok(await waitFor(`return document.querySelector('.w-ask [role=alert]') && document.querySelector('.w-ask [role=alert]').textContent.indexOf('Surgical Ward bed S1 is occupied') >= 0;`), "an occupied bed is refused in the question itself, with the server's reason");
  await shot("3-refused-bed");
  await click('[data-w-act="askcancel"]');
  await click('[data-w-act="pickbed:Surgical Ward|S2"]');
  await waitFor(`return !!document.querySelector('.w-ask [data-w-act="askok"]');`);
  await click('[data-w-act="askok"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Left recovery.') >= 0 && document.querySelectorAll('[data-w-act^="leaverecovery:"]').length === 2;`), "a free bed: back on the theatre board, the patient is off the recovery list");
  const wardBody = await lastBody("/ward/surgery-leave-recovery");
  ok(wardBody && wardBody.encounterId === "wsq-pacu-a" && wardBody.outcome === "ward" && wardBody.expectedVersion === 1 && wardBody.admission.ward === "Surgical Ward" && wardBody.admission.bed === "S2" && !wardBody.admission.class,
    "it posts the stay, the version shown, and the bed picked: " + JSON.stringify(wardBody));

  // ---- 3. To a unit: the unit is chosen when the bed is confirmed. -------------------------------------
  await click('[data-w-act="leaverecovery:wsq-pacu-b"]');
  await waitFor(`return !!document.querySelector('.w-ask select[data-w-ask="outcome"]');`);
  await pick("outcome", "unit");
  await click('[data-w-act="askok"]');
  await waitFor(`return !!document.querySelector('[data-w-act="pickbed:Surgical Ward|S2"]');`);
  await click('[data-w-act="pickbed:Surgical Ward|S2"]');
  ok(await waitFor(`return !!document.querySelector('.w-ask select[data-w-ask="cls"]');`), "a move to a unit asks which unit");
  await pick("cls", "NICU");
  await shot("4-unit-confirm");
  await click('[data-w-act="askok"]');
  ok(await waitFor(`return document.querySelectorAll('[data-w-act^="leaverecovery:"]').length === 1;`), "the unit move lands");
  const unitBody = await lastBody("/ward/surgery-leave-recovery");
  ok(unitBody && unitBody.outcome === "unit" && unitBody.admission.class === "NICU" && unitBody.expectedVersion === 3, "it posts the unit chosen: " + JSON.stringify(unitBody));

  // ---- 4. Home: recorded from the question, no bed board. ----------------------------------------------
  const before = await posts("/ward/surgery-leave-recovery");
  await click('[data-w-act="leaverecovery:wsq-pacu-c"]');
  await waitFor(`return !!document.querySelector('.w-ask select[data-w-ask="outcome"]');`);
  await pick("outcome", "home");
  await ev(`var t=document.querySelector('.w-ask [data-w-ask="reason"]'); t.value="Day case, escort present"; t.dispatchEvent(new Event("input",{bubbles:true})); return true;`);
  await click('[data-w-act="askok"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Nobody is in recovery.') >= 0;`), "home closes the stay; an empty recovery list says so");
  const homeBody = await lastBody("/ward/surgery-leave-recovery");
  ok(await posts("/ward/surgery-leave-recovery") === before + 1 && homeBody.outcome === "home" && !homeBody.admission && homeBody.reason === "Day case, escort present", "home posts once, with the note and no bed: " + JSON.stringify(homeBody));

  // ---- 5. Back out of the bed board: nothing is sent, the patient stays in recovery. -------------------
  await ev(`window.__setRecovery(${JSON.stringify([ROWS[0]])}); return true;`);
  await click('[data-w-act="surgeryboard"]');
  await waitFor(`return !!document.querySelector('[data-w-act="leaverecovery:wsq-pacu-a"]');`);
  const n = await posts("/ward/surgery-leave-recovery");
  await click('[data-w-act="leaverecovery:wsq-pacu-a"]');
  await waitFor(`return !!document.querySelector('.w-ask [data-w-act="askok"]');`);
  await click('[data-w-act="askok"]');
  await waitFor(`return !!document.querySelector('[data-w-act="pickbed:Surgical Ward|S2"]');`);
  await click('[data-w-act="back"]');
  ok(await waitFor(`return !!document.querySelector('[data-w-act="leaverecovery:wsq-pacu-a"]');`), "Back from the bed board returns to the theatre board");
  ok(await posts("/ward/surgery-leave-recovery") === n, "and sends nothing");

  // ---- 6. To PACU with no recovery bays listed: bay 1, editable. ---------------------------------------
  await ev(`window.__setSignedOutCase(); window.__pacuBays = null; return true;`);
  await click('[data-w-act="surgeryboard"]');
  await waitFor(`return !!document.querySelector('[data-w-act^="opensurgery:"]');`);
  await click('[data-w-act^="opensurgery:"]');
  await waitFor(`return !!document.querySelector('[data-w-act="surgerydisposition:pacu"]');`);
  await click('[data-w-act="surgerydisposition:pacu"]');
  ok(await waitFor(`var i=document.querySelector('.w-ask input[data-w-ask="bay"]'); return !!i && i.value === "1";`), "with no bays listed, the recovery bay is 1 unless somebody names another");
  await shot("5-bay-fallback");
  await ev(`var i=document.querySelector('.w-ask input[data-w-ask="bay"]'); i.value="2"; i.dispatchEvent(new Event("input",{bubbles:true})); return true;`);
  await click('[data-w-act="askok"]');
  await waitFor(`return document.body.textContent.indexOf('Disposition recorded.') >= 0;`);
  const disp = await lastBody("/ward/surgery-disposition");
  ok(disp && disp.pacuBed === "2", "the bay named is the one posted: " + JSON.stringify(disp));
  // A list with no free bay stops before asking.
  await ev(`window.__setSignedOutCase(); window.__pacuBays = []; return true;`);
  await click('[data-w-act="surgeryboard"]');
  await waitFor(`return !!document.querySelector('[data-w-act^="opensurgery:"]');`);
  await click('[data-w-act^="opensurgery:"]');
  await waitFor(`return !!document.querySelector('[data-w-act="surgerydisposition:pacu"]');`);
  await click('[data-w-act="surgerydisposition:pacu"]');
  ok(await waitFor(`return document.body.textContent.indexOf("No recovery bay is free on the hospital's bed list.") >= 0 && !document.querySelector('.w-ask');`), "no free bay on the list: said plainly, nothing asked or sent");

  // ---- 7. Tablet width: the bed board's recovery bays, and a tile opens the theatre board. ---------------
  await call("Emulation.setDeviceMetricsOverride", { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true });
  await ev(`window.__setRecovery(${JSON.stringify(ROWS)}); window.WARD.open({ orgId: "org-harness" }); return true;`);
  await waitFor(`return !!document.querySelector('[data-w-act="surgeryboard"]');`);
  await click('[data-w-act="surgeryboard"]');
  ok(await waitFor(`return document.querySelectorAll('[data-w-act^="leaverecovery:"]').length === 3;`), "tablet: the theatre board lists the three recovery stays");
  await click('[data-w-act="leaverecovery:wsq-pacu-a"]');
  await waitFor(`return !!document.querySelector('.w-ask [data-w-act="askok"]');`);
  await click('[data-w-act="askok"]');
  await waitFor(`return !!document.querySelector('[data-w-act="pickbed:Surgical Ward|S2"]');`);
  const wide = await recoveryTiles();
  ok(wide.length === 3 && wide.every((x) => !x.clipped && x.right <= 820), "at 820 px the recovery bays are whole too: " + JSON.stringify(wide.map((x) => [x.text, x.right, x.clipped])));
  ok(await ev(`return document.documentElement.scrollWidth <= window.innerWidth;`), "no sideways scroll at 820 px");
  await ev(`document.querySelector('.w-bedgrid [data-w-act="surgeryboard"]').scrollIntoView({block:"center"}); return true;`);
  await shot("6-bed-board-tablet");
  await click('.w-bedgrid [data-w-act="surgeryboard"]');
  ok(await waitFor(`return !!document.querySelector('[data-w-act="leaverecovery:wsq-pacu-a"]');`), "a recovery tile opens the theatre board, where the patient leaves recovery");
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
