/* StewardMD - "not enough information" (smd_calib) real-browser test. Phase 4 of
 * kb/validation/PLAN-DX-ABX-10.md, first part.
 *   1. flag OFF: "fever" alone gives the classic gate ("non-infectious diagnosis favored") and no
 *      sufficiency field
 *   2. flag ON: non-diagnostic findings -> gate "insufficient" with the most useful next findings;
 *      enough findings, one highly specific finding, or a matched infection -> the normal answer;
 *      a sepsis / neutropenia signal is never hidden behind "not enough information"
 *   3. the Dx workspace gate card and OPD Ask MaiK (no provisional dx, no treatment) show it
 *   4. the antibiotic wizard maps the class to a neutral, labelled card
 * Population-level: test/run-dx-audit.mjs prints how often it fires and top-1 among those cases.
 * USAGE: node test/serve.mjs . 8804 & BASE=http://localhost:8804/ CHROME=/path/to/chrome node test/run-calib.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// data -> a JS literal safe to splice into code evaluated in the page (CodeQL js/bad-code-sanitization):
// JSON.stringify leaves <, >, U+2028 and U+2029 raw, so escape them (the pattern CodeQL documents)
const LIT_ESC = { "<": "\\u003C", ">": "\\u003E", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\0": "\\0", "\u2028": "\\u2028", "\u2029": "\\u2029" };
const lit = (v) => JSON.stringify(v).replace(/[<>\b\f\n\r\t\0\u2028\u2029]/g, (c) => LIT_ESC[c]);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE || "http://localhost:8804/").replace(/\/?$/, "/");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9489);
const JOB = process.env.CLAUDE_JOB_DIR || "/tmp";

let serveProc = null;
try { await fetch(BASE); } catch {
  const m = BASE.match(/^http:\/\/localhost:(\d+)\//);
  if (m) { serveProc = spawn("node", [join(ROOT, "test", "serve.mjs"), ROOT, m[1]], { stdio: "ignore" }); for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } } }
}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${JOB}/calib-prof-${process.pid}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
async function load(url) {
  await call("Page.navigate", { url });
  for (let i = 0; i < 150; i++) {
    await sleep(300);
    const r = await ev(`if(window.SMD_KB_READY&&!window.__t){window.__t=1;SMD_KB_READY.then(function(){window.__t=2;});}
      return window.__t===2&&!!(window.SMD_REASON&&window.DX&&window.KB_CORE&&window.OPDEMR);`);
    if (r === true) return true;
  }
  return false;
}
const g = async (keys) => JSON.parse(await ev(`var f={}; ${lit(keys)}.forEach(function(k){f[k]=true;}); var a=SMD_REASON.assess(f);
  return JSON.stringify({cls:a.gate.cls, ab:a.gate.ab, msg:a.gate.message||"", suff:a.sufficiency||null});`));

try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable");

  // ---- 1. OFF --------------------------------------------------------------------------------
  ok(await load(BASE + "?calib=0"), "app + KB load with ?calib=0");
  const off = await g(["fever"]);
  ok(off.cls === "noninfective" && off.suff === null, `off · fever alone: classic "${off.cls}", no sufficiency field`);
  const redOff = { hypo: (await g(["fever", "hypotension"])).cls, neut: (await g(["fever", "absoluteNeutrophilCountLow"])).cls, ams: (await g(["headache", "alteredSensorium"])).cls };

  // ---- 2. ON ---------------------------------------------------------------------------------
  ok(await load(BASE + "?calib=1"), "app + KB load with ?calib=1");
  const f1 = await g(["fever"]);
  ok(f1.cls === "insufficient" && f1.ab === false, `on  · fever alone -> "${f1.cls}"`);
  ok(f1.suff && f1.suff.enough === false && f1.suff.next.length > 0 && f1.suff.next[0].label, `on  · sufficiency.next suggests findings (${f1.suff && f1.suff.next.map((x) => x.label).slice(0, 3).join(", ")})`);
  ok(/do not point to a diagnosis yet/.test(f1.msg) && !/—/.test(f1.msg), "on  · message explains, no em-dash");
  const f2 = await g(["fever", "age", "sex"]);
  ok(f2.cls === "insufficient", "on  · age and sex do not count toward 'enough'");
  const f3 = await g(["fever", "headache", "myalgiaArthralgia"]);
  ok(f3.cls !== "insufficient" && f3.suff.enough, `on  · three clinical findings is enough (${f3.cls})`);
  const f4 = await g(["fever", "neckStiffness"]);
  ok(f4.cls !== "insufficient" && f4.suff.enough, `on  · one highly specific finding is enough (${f4.cls})`);
  // a red flag is never "not enough information": the class is exactly the classic one
  for (const [set, off0] of [[["fever", "hypotension"], redOff.hypo], [["fever", "absoluteNeutrophilCountLow"], redOff.neut], [["headache", "alteredSensorium"], redOff.ams]]) {
    const r = await g(set);
    ok(r.cls === off0 && r.cls !== "insufficient", `on  · ${set.join(" + ")}: red flag keeps the classic answer ("${r.cls}")`);
  }

  // ---- 3. surfaces -----------------------------------------------------------------------------
  // the workspace already withheld a differential below its threshold; under the flag it uses the
  // engine's rule, so a red flag is shown rather than hidden behind "more context is needed"
  const ws1 = await ev(`try{DX.openWorkspace();}catch(e){} DX.reset&&DX.reset(); DX.addFindings(["fever"]); var c=document.querySelector('#dxCols'); return c?c.innerText:'';`);
  ok(/More clinical context is needed/.test(ws1), "workspace: fever alone -> 'More clinical context is needed' (no differential)");
  const ws2 = await ev(`DX.reset&&DX.reset(); DX.addFindings(["fever","hypotension"]); var el=document.querySelector('#dxGate'), c=document.querySelector('#dxCols'); var t=(el?el.innerText:'')+' | '+(c?c.innerText.slice(0,80):''); DX.reset&&DX.reset(); return t;`);
  ok(!/More clinical context is needed/.test(ws2) && /Infection|diagnosis|information/i.test(ws2), `workspace: fever + hypotension is shown, not withheld ("${ws2.replace(/\s+/g, " ").slice(0, 70)}...")`);
  const opd = JSON.parse(await ev(`var st=OPDEMR._state(); st.assessVals={Chief_complaints_duration:"fever since 2 days"}; OPDEMR._askMaik(); var s=st.scribeSuggestions||{};
    return JSON.stringify({ins:!!s.insufficient, dx:s.provisionalDx||"", rx:(s.treatment||[]).length, ddx:(s.ddx||[]).length, next:(s.nextFindings||[]).length});`));
  ok(opd.ins && opd.dx === "" && opd.rx === 0 && opd.ddx > 0 && opd.next > 0, `OPD Ask MaiK "fever since 2 days": no provisional dx, no treatment, ${opd.ddx} compatible, ${opd.next} next findings`);
  const opd2 = JSON.parse(await ev(`var st=OPDEMR._state(); st.scribeSuggestions=null; st.assessVals={Chief_complaints_duration:"high fever, severe headache, neck stiffness and photophobia since morning, vomiting"}; OPDEMR._askMaik(); var s=st.scribeSuggestions;
    return JSON.stringify({ins:!!(s&&s.insufficient), busy:!!st.maikBusy});`));
  ok(!opd2.ins, "OPD Ask MaiK with a diagnostic note takes the normal path (not 'insufficient')");

  // ---- 4. wizard -------------------------------------------------------------------------------
  const sev = JSON.parse(await ev(`return JSON.stringify(ABX_WIZARD._sevOf("insufficient"))`));
  ok(sev && sev.k === "none" && /Not enough information/.test(sev.label), `wizard: neutral card "${sev && sev.label}"`);

  console.log(fails === 0 ? "\nALL GREEN: not enough information" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); setTimeout(() => process.exit(fails === 0 ? 0 : 1), 300); }
