/* ICU alert-safety UX/robustness checks (items #12–#17) — reproducible proof for the
 * non-engine fixes. Static file checks (local pdf.js bundle) + a headless run that drives:
 *   #12 pdf.js is bundled locally and referenced by icu.js/medlist.js (offline/native safe)
 *   #13 manual Vitals/Labs entry routes through the review sheet — nothing applied until confirm
 *   #14 ICU.open(tab) opens a specific workspace (the FAB opens Infusions, distinct from the tile)
 *   #15 data-entry inputs carry id + name + aria-label + associated <label for>
 *   #17 an empty vital tile (K⁺) announces "not recorded", never a bare dash
 * Deterministic.  USAGE: node test/run-icu-safety-ux.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, statSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8903/").replace(/\/?$/, "/");
const PORT = 9405, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-ux-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// ===== #12 static: pdf.js bundled locally + referenced by both consumers =====
try {
  const pdf = statSync(join(ROOT, "vendor/pdfjs/pdf.min.js")).size;
  const wrk = statSync(join(ROOT, "vendor/pdfjs/pdf.worker.min.js")).size;
  ok(pdf > 100000 && wrk > 500000, `#12 vendored pdf.js present (pdf ${pdf}B, worker ${wrk}B)`);
} catch (e) { ok(false, "#12 vendored pdf.js missing: " + e.message); }
const icuSrc = readFileSync(join(ROOT, "icu.js"), "utf8");
const medSrc = readFileSync(join(ROOT, "medlist.js"), "utf8");
ok(icuSrc.includes("/vendor/pdfjs/pdf.min.js") && icuSrc.includes("/vendor/pdfjs/pdf.worker.min.js"), "#12 icu.js loads local pdf.js first");
ok(medSrc.includes("/vendor/pdfjs/pdf.min.js"), "#12 medlist.js loads local pdf.js first");
const idx = readFileSync(join(ROOT, "index.html"), "utf8");
ok(/ICU\.open\('infusions'\)/.test(idx), "#14 FAB calls ICU.open('infusions')");
ok(/<small>Pumps<\/small>/.test(idx) && !/onclick="\(window\.ICU\?ICU\.open\(\):INF/.test(idx), "#14 FAB relabelled 'Pumps' (no duplicate 'ICU')");

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8903"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && ICU._review && ICU.ingestLabs)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");

  // ===== #14: ICU.open(tab) opens a specific workspace; no-arg still works =====
  const c14 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"UXPT",age:60,sex:"M"});
    ICU.open('infusions');
    var seg = document.querySelector('#icuRoot .icu-seg.on');
    var target = seg ? seg.getAttribute('data-icu-act') : null;
    ICU.open();          // no arg must not throw
    return JSON.stringify({ target: target, openIsFn: typeof ICU.open === 'function' });
  `);
  ok(c14.target === "tab:infusions", `#14 ICU.open('infusions') activates the Infusions tab (active seg = ${c14.target})`);

  // ===== #15: data-entry inputs have id + name + aria-label + associated <label for> =====
  const c15 = await J(`
    var root = document.getElementById('icuRoot');
    var b = document.createElement('button'); b.setAttribute('data-icu-act','edit:labs'); root.appendChild(b); b.click(); b.remove();
    var m = document.getElementById('icuModal');
    var inputs = m ? [].slice.call(m.querySelectorAll('[data-k]')) : [];
    var bad = inputs.filter(function(i){ var id=i.id, al=i.getAttribute('aria-label'), nm=i.getAttribute('name');
      var lab = id && m.querySelector('label[for="'+id+'"]'); return !(id && al && nm && lab); });
    return JSON.stringify({ n: inputs.length, bad: bad.length, sample: inputs[0] ? {id:inputs[0].id, al:inputs[0].getAttribute('aria-label'), nm:inputs[0].getAttribute('name')} : null });
  `);
  ok(c15.n >= 11 && c15.bad === 0, `#15 all ${c15.n} labs-form inputs have id+name+aria-label+<label for> (bad=${c15.bad}); e.g. ${JSON.stringify(c15.sample)}`);

  // ===== #13: manual Labs entry (K 6.8) routes through review; nothing applied until confirm =====
  const c13a = await J(`
    var m = document.getElementById('icuModal');
    var ki = m.querySelector('[data-k="k"]'); ki.value = "6.8";
    var root = document.getElementById('icuRoot');
    var b = document.createElement('button'); b.setAttribute('data-icu-act','save:labs'); root.appendChild(b); b.click(); b.remove();
    var ov = document.getElementById('icuImpOv');
    return JSON.stringify({
      reviewShown: !!ov,
      manualNote: ov ? /Manual entry/.test(ov.textContent) : false,
      notYetApplied: (ICU.state().labs.recent.k == null),
      alertsBefore: (ICU.state().alerts||[]).length
    });
  `);
  ok(c13a.reviewShown && c13a.manualNote, `#13 manual Save opens the review sheet with a Manual-entry note (shown=${c13a.reviewShown}, note=${c13a.manualNote})`);
  ok(c13a.notYetApplied, "#13 nothing is applied to the patient until the clinician confirms");
  const c13b = await J(`
    var ov = document.getElementById('icuImpOv');
    ov.querySelector('#icuImpConfirm').click();
    var al = ICU.state().alerts || [];
    return JSON.stringify({ k: ICU.state().labs.recent.k, hyperK: al.some(function(a){return /hyperkal/i.test(a.title);}), src: (ICU.state().src.k||{}).source });
  `);
  ok(c13b.k === 6.8 && c13b.hyperK, `#13 after confirm, K 6.8 is applied and fires hyperkalaemia (k=${c13b.k}, alert=${c13b.hyperK})`);
  ok(c13b.src === "Manual", `#13 confirmed manual entry is tagged source "Manual" (override-safe vs Ward Sync) — got "${c13b.src}"`);

  // ===== #16: draft persists on input + restored on reopen (survives a guest-session reload) =====
  const c16w = await J(`
    ICU.reset(); ICU.ingestPatient({name:"DRAFT",age:40,sex:"M"});
    var root = document.getElementById('icuRoot');
    var b = document.createElement('button'); b.setAttribute('data-icu-act','edit:ventilator'); root.appendChild(b); b.click(); b.remove();
    var m = document.getElementById('icuModal');
    var pe = m.querySelector('[data-k="peep"]'); pe.value = "9"; pe.dispatchEvent(new Event('input',{bubbles:true}));
    var keys = Object.keys(localStorage).filter(function(k){return k.indexOf('smd_icu_draft:')===0 && k.indexOf(':ventilator')>0;});
    var d = keys.length ? JSON.parse(localStorage.getItem(keys[0])) : null;
    return JSON.stringify({ wrote: !!(d && d.vals && String(d.vals.peep)==="9"), hasTs: !!(d && d.at) });
  `);
  ok(c16w.wrote && c16w.hasTs, "#16 typing into a data-entry form persists a timestamped draft to localStorage");
  const c16r = await J(`
    var root = document.getElementById('icuRoot');
    var b = document.createElement('button'); b.setAttribute('data-icu-act','edit:ventilator'); root.appendChild(b); b.click(); b.remove();
    var m = document.getElementById('icuModal');
    var pe = m.querySelector('[data-k="peep"]'); var note = m.querySelector('.icu-draft-note');
    return JSON.stringify({ restored: pe ? pe.value : null, note: !!note });
  `);
  ok(c16r.restored === "9" && c16r.note, "#16 reopening the form restores the unsaved draft + shows the restore note");
  const c16c = await J(`
    var root = document.getElementById('icuRoot');
    var b = document.createElement('button'); b.setAttribute('data-icu-act','closeform'); root.appendChild(b); b.click(); b.remove();
    var keys = Object.keys(localStorage).filter(function(k){return k.indexOf('smd_icu_draft:')===0 && k.indexOf(':ventilator')>0;});
    return JSON.stringify({ cleared: keys.length===0 });
  `);
  ok(c16c.cleared, "#16 Cancel clears the draft (only an interrupted session ever leaves one behind)");

  // ===== #17: empty K⁺ tile announces "not recorded", not a bare dash =====
  const c17 = await J(`
    ICU.reset(); ICU.ingestPatient({name:"NOK",age:50,sex:"F"});   // no potassium
    ICU.open();
    var tiles = [].slice.call(document.querySelectorAll('#icuRoot .icu-vc'));
    var kt = tiles.filter(function(t){ var a=t.getAttribute('aria-label')||""; return /^K/.test(a); })[0];
    return JSON.stringify({ found: !!kt, aria: kt ? kt.getAttribute('aria-label') : null, hasNa: kt ? !!kt.querySelector('.icu-vc-na[title="Not recorded"]') : false });
  `);
  ok(c17.found && /not recorded/i.test(c17.aria || "") && c17.hasNa, `#17 empty K⁺ tile announces "not recorded" (aria="${c17.aria}")`);

  console.log(fails === 0 ? "\nALL GREEN — ICU safety UX/robustness (#12–#17) passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
