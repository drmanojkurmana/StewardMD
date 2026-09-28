/* StewardMD - plain view of the Dx workspace (smd_dx_simple) real-browser test.
 *   0. default ON; localStorage smd_dx_simple=0 opts out.
 *   1. flag OFF (?dxsimple=0): the classic workspace (two lists, Region / policy first) plus two bug fixes that
 *      apply to everyone: the empty-state heading reads "question at a time" and the guideline note
 *      no longer repeats its own sentence.
 *   2. flag ON: "What it could be" leads with a Most likely card; ONE list, best fit first, numbered
 *      once, Infective / Non-infective tags, Strong / Possible / Weak fit, less likely ones folded, and
 *      the best non-infective alternative always in the first view; plain card headings; "Ask or
 *      check next" chips add the finding; the guideline box folds to one line with its button kept;
 *      "What changed" is a sentence; intake gets a "See what it could be" button and the guideline
 *      picker below the findings; the mislabelled feverGU is never suggested on top of fever.
 *   3. presentation only: SMD_REASON.assess is identical with the flag on and off; the
 *      differentiating questions (smd_dx_ask) still open from a plain card; fits a 390px phone.
 * USAGE: node test/serve.mjs . 8804 & BASE=http://localhost:8804/ CHROME=/path/to/chrome node test/run-dx-simple.mjs
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
const PORT = Number(process.env.CDP_PORT || 9492);
const JOB = process.env.CLAUDE_JOB_DIR || "/tmp";

let serveProc = null;
try { await fetch(BASE); } catch {
  const m = BASE.match(/^http:\/\/localhost:(\d+)\//);
  if (m) { serveProc = spawn("node", [join(ROOT, "test", "serve.mjs"), ROOT, m[1]], { stdio: "ignore" }); for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } } }
}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${JOB}/dx-simple-prof-${process.pid}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
async function load(url) {
  await call("Page.navigate", { url });
  for (let i = 0; i < 150; i++) {
    await sleep(300);
    const r = await ev(`if(window.SMD_KB_READY&&!window.__t){window.__t=1;SMD_KB_READY.then(function(){window.__t=2;});}
      return window.__t===2&&!!(window.SMD_REASON&&window.DX&&window.KB_CORE);`);
    if (r === true) return true;
  }
  return false;
}
const HEP = ["fever", "jaundice", "nauseaVomiting"], MEN = ["fever", "headache", "neckStiffness"];
const open = async (f, pane) => ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();});
  try{DX.openWorkspace();}catch(e){} DX.reset(); DX.addFindings(${lit(f)}); var j=document.querySelector('[data-dx-jump="${pane || "dxReview"}"]'); if(j) j.click(); return 1;`);
const view = async () => JSON.parse(await ev(`var ov=document.querySelector('#dxOverlay'), cols=document.querySelector('#dxCols'), top=document.querySelector('#dxTop');
  var ranks=[].map.call(document.querySelectorAll('#dxCols .dx-rank'),function(x){return +x.textContent;});
  var body=document.querySelector('#dxOverlay .dx-body');
  return JSON.stringify({simple:ov.classList.contains('dx-simple'), all:!!cols.querySelector('.dx-col.all'), two:!!(cols.querySelector('.dx-col.inf')&&cols.querySelector('.dx-col.ni')),
    ranks:ranks, cards:cols.querySelectorAll('.dx-card').length, ni:!!cols.querySelector('.dx-tag.ni'), showAll:(document.querySelector('#dxShowAll')||{}).textContent||'',
    top:top?top.innerText:'', firstName:(cols.querySelector('.dx-row-name')||{}).textContent||'', colsText:cols.innerText, title:(document.querySelector('#dxReviewTitle')||{}).textContent,
    changed:(document.querySelector('#dxChanged')||{}).innerText||'', go:(document.querySelector('#dxGo')||{}).innerText||'',
    wide:body.scrollWidth<=body.clientWidth+1, hospAfter:!!(document.querySelector('#dxHosp')&&document.querySelector('.dx-find-wrap')&&(document.querySelector('.dx-find-wrap').compareDocumentPosition(document.querySelector('#dxHosp'))&4))});`));
const ASSESS = `return JSON.stringify([${lit(HEP)},${lit(MEN)},["fever","cough","crepitations"],["chestPain","diaphoresis"]].map(function(f){var o={}; f.forEach(function(k){o[k]=true;}); return SMD_REASON.assess(o);}));`;

try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  // ---- 0. default ON (owner approved 2026-09-27); localStorage "0" keeps the classic view --------
  ok(await load(BASE), "app + KB load with no flag");
  await ev(`localStorage.removeItem("smd_dx_simple"); return 1`);
  ok((await ev(`return DX._simple()`)) === true, "default · plain view is on with no flag set");
  await ev(`localStorage.setItem("smd_dx_simple","0"); return 1`);
  ok(await load(BASE), "reload with smd_dx_simple=0");
  ok((await ev(`return DX._simple()`)) === false, "default · localStorage smd_dx_simple=0 keeps the classic view");
  await ev(`localStorage.removeItem("smd_dx_simple"); return 1`);

  // ---- 1. OFF --------------------------------------------------------------------------------
  ok(await load(BASE + "?dxsimple=0"), "app + KB load with ?dxsimple=0");
  const assessOff = await ev(ASSESS);
  await open([], "dxIntake");
  const h2 = await ev(`return document.querySelector('#dxIntakeTitle').innerText.replace(/\\s+/g,' ').trim()`);
  ok(/question at a time/.test(h2), `everyone · empty-state heading reads "${h2}" (was "questionat")`);
  await open(HEP);
  let v = await view();
  ok(!v.simple && v.two && !v.all && !v.top && !v.go, "off · classic workspace: two lists, no Most likely card, no intake button");
  ok(!v.hospAfter, "off · Region / policy stays at the top of the intake");

  // ---- 2. ON ---------------------------------------------------------------------------------
  ok(await load(BASE + "?dxsimple=1"), "app + KB load with ?dxsimple=1");
  ok((await ev(ASSESS)) === assessOff, "on  · presentation only: SMD_REASON.assess identical with the flag on and off");
  await open(["fever"], "dxIntake");
  v = await view();
  ok(/Add 2 more findings/.test(v.go), `on  · intake with one finding says what is needed ("${v.go.trim()}")`);
  ok(v.hospAfter, "on  · the antibiotic guideline picker sits below the findings");
  await open(HEP, "dxIntake");
  v = await view();
  ok(/See what it could be \(\d+\)/.test(v.go), `on  · intake with enough findings offers "${v.go.trim()}"`);
  await ev(`document.querySelector('#dxGoBtn').click(); return 1`);
  ok((await ev(`return !document.querySelector('#dxReview').hidden`)) === true, "on  · that button opens the differential");
  v = await view();
  ok(v.simple && v.all && !v.two && v.title === "What it could be", "on  · 'What it could be': one list instead of two");
  ok(v.ranks.length && v.ranks.every((r, i) => r === i + 1), `on  · numbered once, 1 to ${v.ranks.length} (no second #1)`);
  ok(/Most likely|Closest fits/.test(v.top) && v.top.includes(v.firstName) && /Infective|Non-infective/.test(v.top) && /fit, \d+\/100/.test(v.top), `on  · Most likely card names the first diagnosis (${v.firstName})`);
  ok(/Show \d+ less likely/.test(v.showAll) && v.cards <= 10, `on  · first view is short (${v.cards} cards), the rest folded ("${v.showAll}")`);
  ok(v.ni, "on  · the best non-infective alternative is in the first view (toxic hepatitis for this picture)");
  ok(!/Ranking score|NEW|⚖|mimics/.test(v.colsText) && /Strong fit|Possible fit|Weak fit/.test(v.colsText), "on  · no bare 'Ranking score', NEW, ⚖ or '↔ mimics' badges; plain fit labels");
  // anti-slop (tasteskill.dev audit): one accent, sentence-case labels, no pills, no bars on tracks,
  // no watermark, no arrows or middle dots in the plain text, off-black dark mode
  const slop = JSON.parse(await ev(`var ov=document.querySelector('#dxOverlay'), teal=getComputedStyle(document.body).getPropertyValue('--teal').trim();
    var top=document.querySelector('.dx-top-open'), lab=document.querySelector('.dx-col-h'), tag=document.querySelector('#dxCols .dx-tag'), bar=document.querySelector('#dxCols .dx-bar'), wm=document.querySelector('#dxOverlay .sw-wm');
    var toHex=function(c){var m=c.match(/\\d+/g); return m?'#'+m.slice(0,3).map(function(x){return (+x).toString(16).padStart(2,'0');}).join(''):c;};
    var txt=[].map.call(document.querySelectorAll('#dxTop, #dxCols .dx-fit, #dxCols .dx-col-h, #dxCols .dx-col-sub, #dxGo, #dxShowAll'),function(e){return e.innerText;}).join(' ');
    return JSON.stringify({accent:toHex(getComputedStyle(top).backgroundColor), teal:teal.toLowerCase(), labT:getComputedStyle(lab).textTransform, tagBg:getComputedStyle(tag).backgroundColor, bar:bar?getComputedStyle(bar).display:'none', wm:wm?getComputedStyle(wm).display:'none', arrows:/→/.test(txt), dots:/·/.test(txt)});`));
  ok(slop.accent === slop.teal, `slop · one accent: the brand teal (${slop.accent}), not the extra violet`);
  ok(slop.labT === "none" && /rgba\(0, 0, 0, 0\)|transparent/.test(slop.tagBg), "slop · sentence-case headings, tags as plain text (no pills)");
  ok(slop.bar === "none" && slop.wm === "none", "slop · no score bars on grey tracks, no decorative watermark");
  ok(!slop.arrows && !slop.dots, "slop · no arrows or middle-dot separators in the plain text");
  await ev(`document.querySelector('#dxShowAll').click(); return 1`);
  const more = await view();
  ok(more.cards > v.cards && /Show fewer/.test(more.showAll) && more.ranks.every((r, i) => r === i + 1), `on  · Show more lists the rest (${more.cards}), still numbered once`);
  await ev(`document.querySelector('#dxShowAll').click(); return 1`);
  await ev(`document.querySelector('.dx-top-open').click(); return 1`);
  const heads = JSON.parse(await ev(`return JSON.stringify([].map.call(document.querySelectorAll('.dx-card.open .dx-d-row>b'),function(b){return b.textContent;}))`));
  ok(heads[0] === "Fits because" && heads.includes("Ask or check next") && heads.includes("Tests to consider") && !heads.some((x) => /discriminator|—/.test(x)), `on  · plain card headings: ${heads.join(" / ")}`);
  const addk = await ev(`var b=document.querySelector('.dx-card.open [data-addf]'); if(!b) return ''; var k=b.getAttribute('data-addf'); b.click(); return k;`);
  ok(addk && (await ev(`return !!DX._state.f[${lit(addk)}]`)) === true, `on  · tapping "+ ${addk}" under Ask or check next adds it`);
  v = await view();
  ok(/^What changed: after adding /.test(v.changed.trim()) && !/–|—/.test(v.changed), `on  · What changed is a sentence ("${v.changed.trim().slice(0, 70)}...")`);
  const gu = await ev(`DX.reset(); DX.addFindings(${lit(HEP)}); var h=document.querySelector('.dx-row-head[data-id="CHOLECYSTITIS"]'); if(h) h.click();
    var t=[].map.call(document.querySelectorAll('.dx-card.open [data-addf]'),function(b){return b.getAttribute('data-addf');}); var sg=document.querySelector('#dxSuggest [data-confirm]');
    return JSON.stringify({card:t, sug:sg?sg.getAttribute('data-confirm'):null});`);
  ok(!/feverGU/.test(gu), `on  · 'Fever with urinary symptoms' is not suggested on top of fever (${gu})`);
  const chrome = await ev(`return [].map.call(document.querySelectorAll('#dxTop, .dx-col-h, .dx-col-sub, .dx-card.open .dx-d-row>b, #dxChanged, #dxGo, .dx-section-intro, .dx-hosp-l'),function(e){return e.innerText;}).join(' ')`);
  ok(!/—/.test(chrome), "on  · no em-dash in the plain-view text");
  // round 20 (smd_calib): a lead less than 15 points ahead of the runner-up is labelled a close call and names it
  const FIX = [HEP, MEN, ["fever", "cough", "crepitations"], ["chestPain", "diaphoresis"], ["fever", "cough"], ["fever", "dysuria", "flankPain"],
    ["headache", "photophobia", "nauseaVomiting"], ["fever", "neckStiffness", "photophobia", "headacheSevere", "alteredSensorium"]];
  const seen = { close: 0, clear: 0 };
  for (const f of FIX) {
    await open(f); const t = (await view()).top;
    if (/Leading, but close/.test(t)) { seen.close++; ok(/fits nearly as well \(\d+ vs \d+\)/.test(t) && !/Clear lead/.test(t), `on  · close call names the runner-up (${f.join("+")})`); }
    else if (/Most likely/.test(t)) { seen.clear++; ok(/Clear lead/.test(t), `on  · a clear lead says so (${f.join("+")})`); }
  }
  ok(seen.close > 0 && seen.clear > 0, `on  · both labels occur across the fixtures (close ${seen.close}, clear ${seen.clear})`);
  ok(v.wide && (await ev(`var j=document.querySelector('[data-dx-jump="dxIntake"]'); j.click(); var b=document.querySelector('#dxOverlay .dx-body'); return b.scrollWidth<=b.clientWidth+1;`)) === true, "on  · no horizontal overflow at 390px (review and intake)");
  const dark = await ev(`document.body.classList.add('dark'); var c=getComputedStyle(document.querySelector('#dxOverlay')).backgroundColor; var ev=document.querySelector('#dxOverlay .ev-wrap'); var e=ev?getComputedStyle(ev).backgroundColor:''; document.body.classList.remove('dark'); return c+'|'+e;`);
  ok(!/^rgb\(0, 0, 0\)/.test(dark) && !/rgb\(255, 255, 255\)$/.test(dark), `slop · dark mode is off-black, and "Know more" follows the theme (${dark})`);
  // guideline box: folded, its page button kept outside and still working
  await open(MEN);
  const pol = JSON.parse(await ev(`var el=document.querySelector('#dxPolicy'); return JSON.stringify({fold:!!el.querySelector(':scope > details.dx-pol-fold'), btn:!!el.querySelector(':scope > .dx-select[data-sel]'), sum:(el.querySelector('summary')||{}).textContent||''});`));
  ok(pol.fold && pol.btn && /^Antibiotic guidance/.test(pol.sum), `on  · guideline box folds to "${pol.sum.slice(0, 60)}", page button stays visible`);
  await ev(`document.querySelector('#dxPolicy > .dx-select').click(); return 1`);
  ok((await ev(`return document.querySelector('#dxOverlay').classList.contains('on')`)) === false, "on  · that button still opens the stewardship page");

  // ---- 3. with the differentiating questions --------------------------------------------------
  ok(await load(BASE + "?dxsimple=1&dxask=1&kbv2=1"), "app + KB load with ?dxsimple=1&dxask=1&kbv2=1");
  await open(HEP);
  const ask = await ev(`var h=document.querySelector('.dx-row-head[data-id="VIRAL_HEPATITIS"]'); h.click(); document.querySelector('.dx-card.open .dx-select[data-sel]').click(); return !!document.querySelector('#dxAskCard');`);
  ok(ask === true, "on  · Select on a plain card still asks the differentiating questions");

  // ---- 4. smd_calib off: the classic "Most likely" / "Closest fits" only ------------------------
  ok(await load(BASE + "?dxsimple=1&calib=0"), "app + KB load with ?dxsimple=1&calib=0");
  let anyLabel = false;
  for (const f of [["fever", "cough"], HEP, MEN]) { await open(f); const t = (await view()).top; if (/Leading, but close|Clear lead/.test(t)) anyLabel = true; }
  ok(!anyLabel, "calib off · no close-call or clear-lead label (the change is reversible)");
  console.log(fails === 0 ? "\nALL GREEN: plain view" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); setTimeout(() => process.exit(fails === 0 ? 0 : 1), 300); }
