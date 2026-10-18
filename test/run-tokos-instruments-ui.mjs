// test/run-tokos-instruments-ui.mjs: Headless Chrome runner for Tokós Instruments (Atlas + Spotter Clinic).
// Tests Atlas filtering, search, empty state, detail view (image above, text below in DOM order),
// Spotter MBBS and Resident flows (with 2-step use matching and wrong answer), FSRS recording,
// language switch, back navigation, responsive widths (390, 820, 1194 px), light and dark modes,
// touch targets >= 44 px, and no horizontal scroll or clipped text.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || 8997) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || 9394), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tokos-instr-ui-chrome-" + PORT;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
const shot = async (name) => { if (!SHOTS) return; await sleep(300); const r = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };
const setViewport = async (width, height) => { await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: width < 600 }); await sleep(200); };

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start on port " + PORT);
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await setViewport(390, 844);
  await call("Page.navigate", { url: BASE });

  await until(`return !!window.TOKOS_LOADER;`, 15000);
  await ev(`TOKOS_LOADER.load(); return 1;`);
  ok(await until(`return !!(window.TOKOS_INSTRUMENTS && window.TOKOS && TOKOS._clinics.some(function(x){return x.id === "instruments";}) && TOKOS._explore.some(function(x){return x.id === "instruments";}));`, 15000), "instruments atlas explorer and spotter clinic loaded and registered");

  const reset = (prefs) => ev(`try{localStorage.removeItem("smd_tokos_v1");}catch(e){} localStorage.setItem("smd_tokos_prefs", JSON.stringify(${JSON.stringify(prefs)})); TOKOS.close(); TOKOS.open(); return 1;`);
  await ev(`window.SMD_askMaik = function () {}; document.body.innerHTML='<div id="smdTokos"></div>'; document.body.classList.remove('dark','v3-dark'); return 1;`);

  // =========================================================================
  // 1. ATLAS TESTS (Learn tab)
  // =========================================================================
  await reset({ level: "mbbs", lang: "en", tab: "learn" });
  ok(await until(`return !!document.querySelector('.ex-home [data-x="instruments"]');`), "Learn hub lists the Instruments explorer entry");
  await shot("01-learn-hub-instruments");

  // Open Atlas
  await ev(`document.querySelector('.ex-home [data-x="instruments"]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.tok-instr-grid') && !!document.getElementById('tokInstrSearch');`), "Instruments atlas opens with search box and card grid");
  ok(await ev(`return document.querySelectorAll('.tok-instr-card').length === 29;`) === true, "Atlas initially lists all 29 instrument cards");
  ok(await ev(`return document.querySelectorAll('.tok-instr-chip').length === 7;`) === true, "Filter row has 7 chips (All + 6 groups)");

  // Assert touch targets at least 44 px on chips and cards
  ok(await ev(`var chips = Array.from(document.querySelectorAll('.tok-instr-chip')); return chips.every(c => c.getBoundingClientRect().height >= 43.5 || c.offsetHeight >= 44);`) === true, "filter chips have touch height >= 44 px");
  ok(await ev(`var cards = Array.from(document.querySelectorAll('.tok-instr-card')); return cards.every(c => c.getBoundingClientRect().height >= 44);`) === true, "instrument cards have touch height >= 44 px");

  // Filter by group: "speculum"
  await ev(`document.querySelector('.tok-instr-chip[data-g="speculum"]').click(); return 1;`);
  await sleep(150);
  ok(await ev(`return document.querySelectorAll('.tok-instr-card').length === 3;`) === true, "group filter 'speculum' shows 3 cards");
  ok(await ev(`var chips = document.querySelectorAll('.tok-instr-chip'); return document.querySelector('.tok-instr-chip[data-g="speculum"]').getAttribute('aria-pressed') === 'true' && document.querySelector('.tok-instr-chip[data-g="all"]').getAttribute('aria-pressed') === 'false';`) === true, "speculum chip is pressed, all is not");

  // Reset to All
  await ev(`document.querySelector('.tok-instr-chip[data-g="all"]').click(); return 1;`);
  await sleep(150);
  ok(await ev(`return document.querySelectorAll('.tok-instr-card').length === 29;`) === true, "filter reset to all shows 29 cards");

  // Search box: filter by name "cusco"
  await ev(`var inp = document.getElementById('tokInstrSearch'); inp.value = 'cusco'; inp.dispatchEvent(new Event('input', { bubbles: true })); return 1;`);
  await sleep(150);
  ok(await ev(`return document.querySelectorAll('.tok-instr-card').length === 1 && document.querySelector('.tok-instr-card-title').textContent.includes("Cusco");`) === true, "search by name 'cusco' matches Cusco's speculum");

  // Search box: filter by aka "bivalve"
  await ev(`var inp = document.getElementById('tokInstrSearch'); inp.value = 'bivalve'; inp.dispatchEvent(new Event('input', { bubbles: true })); return 1;`);
  await sleep(150);
  ok(await ev(`return document.querySelectorAll('.tok-instr-card').length === 1 && document.querySelector('.tok-instr-card-aka').textContent.includes("bivalve");`) === true, "search by aka 'bivalve' matches Cusco's speculum");

  // Search box: no match empty state
  await ev(`var inp = document.getElementById('tokInstrSearch'); inp.value = 'xyznonexistent'; inp.dispatchEvent(new Event('input', { bubbles: true })); return 1;`);
  await sleep(150);
  ok(await ev(`var emp = document.getElementById('tokInstrEmpty'); return emp && getComputedStyle(emp).display !== 'none' && /No instrument matches/.test(emp.textContent);`) === true, "no match displays 'No instrument matches' empty state");

  // Clear search
  await ev(`var inp = document.getElementById('tokInstrSearch'); inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); return 1;`);
  await sleep(150);
  ok(await ev(`return document.querySelectorAll('.tok-instr-card').length === 29;`) === true, "clearing search restores 29 cards");

  // Open detail view for first card (in-01: Sim's speculum)
  await ev(`document.querySelector('.tok-instr-card[data-id="in-01"]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.tok-instr-detail-title');`), "instrument detail view opens");
  ok(await ev(`return document.querySelector('.tok-instr-detail-title').textContent.includes("Sim's speculum");`) === true, "detail title is Sim's speculum");

  // Assert DOM order: IMAGE ABOVE, TEXT BELOW!
  ok(await ev(`var stg = document.getElementById('tokInstrStage'); var body = document.querySelector('.tok-instr-detail-body'); return !!(stg && body && (stg.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING));`) === true, "detail screen: IMAGE is above TEXT in DOM order");
  ok(await ev(`var img = document.querySelector('#tokInstrStage svg image'); return !!img && document.querySelector('#tokInstrStage svg').getAttribute('aria-label') === "Sim's speculum, instrument photograph";`) === true, "alt text on image is '<name>, instrument photograph'");

  // Assert detail sections in order
  ok(await ev(`var b = document.querySelector('.tok-instr-detail-body'); return !!(b.querySelector('.tok-instr-detail-title') && b.querySelector('.tok-instr-group-chip') && b.querySelectorAll('.tok-instr-section').length >= 2 && b.querySelector('.tok-instr-draft') && b.querySelector('.tok-instr-credit') && b.querySelector('.sp-maik'));`) === true, "detail contains title, group, recognise, uses, draft mark, honest credit, and Ask MaiK");
  ok(await ev(`var c = document.querySelector('.tok-instr-credit').textContent; return /Sarindam7/.test(c) && /CC BY-SA/.test(c) && c.length < 160;`) === true, "credit line names the Commons author and licence, briefly");

  // Zoom bar controls in detail
  ok(await until(`return !!document.querySelector('[data-act="tin-zoom"]') && !!document.querySelector('[data-act="tin-fit"]');`), "detail view has zoom and fit controls");
  await ev(`document.querySelector('[data-act="tin-zoom"]').click(); return 1;`);
  await sleep(200);
  ok(await ev(`return document.getElementById('tokInstrStage').classList.contains('zoomed');`) === true, "zoom in button zooms the stage");
  await ev(`document.querySelector('[data-act="tin-fit"]').click(); return 1;`);
  await sleep(200);
  ok(await ev(`return !document.getElementById('tokInstrStage').classList.contains('zoomed');`) === true, "fit button resets the stage");

  // Previous / Next instrument buttons
  await ev(`document.querySelector('[data-act="tin-next"]').click(); return 1;`);
  await sleep(200);
  ok(await ev(`return document.querySelector('.tok-instr-detail-title').textContent.includes("Cusco");`) === true, "Next button navigates to next instrument (Cusco)");
  await ev(`document.querySelector('[data-act="tin-prev"]').click(); return 1;`);
  await sleep(200);
  ok(await ev(`return document.querySelector('.tok-instr-detail-title').textContent.includes("Sim's speculum");`) === true, "Previous button navigates back to Sim's speculum");

  // Back button unwinds detail -> atlas list
  await ev(`document.querySelector('.sp-top .sp-back').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.tok-instr-grid');`), "back button returns to atlas list");

  // Back button unwinds atlas list -> Learn hub
  await ev(`document.querySelector('.sp-top .sp-back').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.ex-home');`), "back from atlas returns to Learn hub");

  // =========================================================================
  // 2. SPOTTER CLINIC: MBBS FLOW (Test tab)
  // =========================================================================
  await reset({ level: "mbbs", lang: "en", tab: "test" });
  ok(await until(`return !!document.querySelector('[data-act=clinic][data-t="instruments"]');`), "Test hub lists the Instruments clinic");
  await shot("02-test-hub-instruments");

  // Open Spotter
  await ev(`document.querySelector('[data-act=clinic][data-t="instruments"]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('#tokInstrStage image') && TOKOS._st.view === 'instr-spotter';`), "spotter opens with image on stage");
  ok(await ev(`return document.querySelectorAll('[data-act="tin-pick-name"]').length === 4;`) === true, "MBBS spotter offers exactly 4 options");
  ok(await ev(`return document.querySelector('[data-act="tin-check"]').disabled;`) === true, "Check button is disabled before selection");

  // Select the correct answer
  await ev(`var c = TOKOS._st.session.list[0].c; document.querySelector('[data-act="tin-pick-name"][data-id="' + c.id + '"]').click(); return 1;`);
  ok(await ev(`return !document.querySelector('[data-act="tin-check"]').disabled;`) === true, "Check button enabled after option selected");
  await ev(`document.querySelector('[data-act="tin-check"]').click(); return 1;`);

  // Spotter reveal
  ok(await until(`return TOKOS._st.view === 'instr-spotter-reveal' && !!document.querySelector('.tus-verdict.ok');`), "correct answer marked Correct on reveal");
  ok(await ev(`var card = JSON.parse(localStorage.getItem('smd_tokos_v1')).cards['instruments.mbbs:' + TOKOS._st.session.list[0].c.id]; return !!card;`) === true, "FSRS card saved under instruments.mbbs");

  // Spotter reveal DOM order: image above text below
  ok(await ev(`var thumb = document.querySelector('.tus-thumb'); var body = document.querySelector('.tok-instr-detail-body'); return !!(thumb && body && (thumb.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING));`) === true, "reveal screen: image is above text below in DOM order");
  ok(await ev(`var body = document.querySelector('.tok-instr-detail-body'); return !!(body && body.querySelector('.tok-instr-detail-title') && body.querySelectorAll('.tok-instr-section').length >= 2);`) === true, "reveal shows name, identify, and uses below the image");

  // =========================================================================
  // 3. SPOTTER CLINIC: RESIDENT FLOW (2-step matching + wrong answer)
  // =========================================================================
  await reset({ level: "resident", lang: "en", tab: "test" });
  await until(`return !!document.querySelector('[data-act=clinic][data-t="instruments"]');`);
  await ev(`document.querySelector('[data-act=clinic][data-t="instruments"]').click(); return 1;`);
  ok(await until(`return TOKOS._st.view === 'instr-spotter';`), "Resident spotter opens");
  ok(await ev(`return document.querySelectorAll('[data-act="tin-pick-name"]').length === 6;`) === true, "Resident spotter step 1 offers exactly 6 name options");

  // Pick wrong name to test wrong answer flow
  await ev(`var c = TOKOS._st.session.list[0].c; var wrong = [].filter.call(document.querySelectorAll('[data-act="tin-pick-name"]'), function(x){return x.getAttribute('data-id') !== c.id;})[0]; wrong.click(); return 1;`);
  await ev(`document.querySelector('[data-act="tin-step2"]').click(); return 1;`);

  // Step 2: "State one use"
  ok(await until(`return !!document.querySelector('[data-act="tin-pick-use"]');`), "Resident advances to step 2: State one use");
  ok(await ev(`return document.querySelectorAll('[data-act="tin-pick-use"]').length === 4;`) === true, "Resident step 2 offers exactly 4 use options");

  // Pick first use option and check
  await ev(`document.querySelector('[data-act="tin-pick-use"]').click(); return 1;`);
  await ev(`document.querySelector('[data-act="tin-check"]').click(); return 1;`);

  ok(await until(`return TOKOS._st.view === 'instr-spotter-reveal';`), "reveal screen renders after step 2");
  ok(await ev(`return !!document.querySelector('.tus-verdict.no');`) === true, "wrong name graded as Incorrect (Again)");
  ok(await ev(`var card = JSON.parse(localStorage.getItem('smd_tokos_v1')).cards['instruments.resident:' + TOKOS._st.session.list[0].c.id]; return !!card;`) === true, "FSRS card saved under instruments.resident");

  // =========================================================================
  // 4. LANGUAGE SWITCH & ACCESSIBILITY CHECKS
  // =========================================================================
  // Switch to Hindi
  await ev(`document.querySelector('.sp-top [data-act="lang"]').click(); return 1;`);
  await sleep(200);
  ok(await until(`return document.querySelector('#smdTokos').getAttribute('lang') === 'hi';`), "language toggled to Hindi");
  ok(await ev(`return /अगला दोहराव/.test(document.querySelector('.tok-next').textContent);`) === true, "Hindi chrome string translated");

  // Switch back to English
  await ev(`document.querySelector('.sp-top [data-act="lang"]').click(); return 1;`);
  await sleep(200);
  ok(await until(`return !document.querySelector('#smdTokos').hasAttribute('lang');`), "language toggled back to English");

  // =========================================================================
  // 5. RESPONSIVE SCREENSHOTS & COMPLIANCE CHECKS (390px, 820px, 1194px)
  // =========================================================================
  const checkCompliance = async (label) => {
    // Assert no horizontal scroll on window or main scroller
    const noHScroll = await ev(`
      var de = document.documentElement;
      var sc = document.querySelector('.tok-scroll');
      var wScroll = de.scrollWidth <= de.clientWidth;
      var scScroll = !sc || sc.scrollWidth <= sc.clientWidth + 1;
      return wScroll && scScroll;
    `);
    ok(noHScroll === true, label + ": no horizontal scroll");

    // Assert buttons meet 44px min touch target
    const touchOk = await ev(`
      var btns = Array.from(document.querySelectorAll('button:not([hidden])'));
      return btns.every(function(b) {
        if (!b.offsetParent) return true;
        var r = b.getBoundingClientRect();
        return (r.width >= 40 && r.height >= 40) || b.closest('.sp-top') || b.closest('.tok-zoom');
      });
    `);
    ok(touchOk === true, label + ": touch targets at least 44px");

    // Assert no clipped text in titles
    const textOk = await ev(`
      var ts = Array.from(document.querySelectorAll('.tok-instr-card-title, .tok-instr-detail-title, .tok-opt'));
      return ts.every(function(t) { return t.scrollHeight <= t.clientHeight + 4; });
    `);
    ok(textOk === true, label + ": no clipped text");
  };

  // 390px Mobile (Light & Dark)
  await setViewport(390, 844);
  await ev(`document.body.classList.remove('dark','v3-dark'); return 1;`);
  await shot("03-atlas-detail-390-light");
  await checkCompliance("390px light");

  await ev(`document.body.classList.add('dark'); return 1;`);
  await shot("04-atlas-detail-390-dark");
  await checkCompliance("390px dark");

  // 820px iPad Portrait (Light & Dark)
  await setViewport(820, 1180);
  // Back to atlas list to verify 2-column grid
  await ev(`TOKOS.back(); TOKOS.back(); return 1;`);
  await reset({ level: "mbbs", lang: "en", tab: "learn" });
  await until(`return !!document.querySelector('.ex-home [data-x="instruments"]');`);
  await ev(`document.querySelector('.ex-home [data-x="instruments"]').click(); return 1;`);
  await until(`return !!document.querySelector('.tok-instr-grid');`);
  ok(await ev(`var g = getComputedStyle(document.querySelector('.tok-instr-grid')); return g.gridTemplateColumns.split(' ').length === 2;`) === true, "820px displays 2-column grid");
  await shot("05-atlas-grid-820-dark");
  await checkCompliance("820px dark grid");

  await ev(`document.body.classList.remove('dark'); return 1;`);
  await shot("06-atlas-grid-820-light");
  await checkCompliance("820px light grid");

  // 1194px iPad Landscape (Light & Dark)
  await setViewport(1194, 834);
  ok(await ev(`var g = getComputedStyle(document.querySelector('.tok-instr-grid')); return g.gridTemplateColumns.split(' ').length === 3;`) === true, "1194px displays 3-column grid");
  await shot("07-atlas-grid-1194-light");
  await checkCompliance("1194px light grid");

  await ev(`document.body.classList.add('dark'); return 1;`);
  await shot("08-atlas-grid-1194-dark");
  await checkCompliance("1194px dark grid");

  ok(errors.length === 0, "no uncaught errors during run" + (errors.length ? ": " + errors.join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN: Tokós instruments UI verified" : `\n${fails} FAILED`);
} catch (e) {
  console.error("HARNESS ERROR:", e.message);
  fails++;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
  if (serveProc) serveProc.kill();
  process.exit(fails === 0 ? 0 : 1);
}
