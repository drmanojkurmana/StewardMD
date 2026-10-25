/* Kardia in the REAL app (headless Chrome): flag OFF = the Home grid is byte-for-byte unchanged
 * (no Kardia tile, KardiQ X tile untouched, KARDIA.open() a no-op); flag ON (?kardia=1 or
 * localStorage smd_kardia = 1, no early-access tier) = the Kardia tile replaces the KardiQ X tile,
 * the tile opens the Specialty Engine host with its five tabs, Learn lists the real atlas preview,
 * and the KardiQ X tab still holds behind SMD_XACCESS without opening the AI overlay.
 * Screenshots every tab at 390 and 820 widths in light and dark into work/shots/.
 * USAGE: node test/run-kardia-ui.mjs   (BASE=http://localhost:8996/ to use a running server;
 *   SHOTS=/tmp/shots to override the output dir)
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || 8995) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || 9399), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/kardia-app-chrome-" + PORT;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || join(HERE, "..", "work", "shots");
mkdirSync(SHOTS, { recursive: true });

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8995"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
try { rmSync(userDir, { recursive: true, force: true }); } catch {}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(200); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url);
    if (m.method === "Runtime.exceptionThrown") { const d = JSON.stringify(m.params.exceptionDetails); if (/kardia/i.test(d)) errors.push(d.slice(0, 300)); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {});
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  const load = async (url) => { await call("Page.navigate", { url }); await until(`return !!(window.KARDIA && window.SMD_showHome);`, 30000); await ev(clean); await ev(`SMD_showHome(); return 1;`); await sleep(700); };
  const shot = async (name) => { const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result && r.result.data) writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };
  const gridActs = `return [].map.call(document.querySelectorAll('.rnav-tile[data-act]'), function(x){return x.getAttribute('data-act');}).join(',');`;
  const eligibleActs = `return (window.SMD_HOME_TOOLS ? SMD_HOME_TOOLS() : []).map(function(t){return t.act;}).join(',');`;
  const metrics = async (w, h) => { await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true }); await sleep(300); };
  const theme = async (dark) => { await ev(`document.body.classList.toggle('dark', ${dark}); document.body.classList.toggle('v3-dark', ${dark}); return 1;`); await sleep(300); };

  /* ── 1. FLAG OFF: Home is byte-for-byte unchanged ── */
  console.log("\n--- flag OFF: Home unchanged ---");
  await load(BASE);
  await ev(`try{localStorage.removeItem("smd_kardia");localStorage.removeItem("smd_kardia_prefs");localStorage.removeItem("smd_home_tools");localStorage.setItem("smd_role","student");localStorage.setItem("smd_kardiox","1");}catch(e){} return 1;`);
  await load(BASE);
  const ENG = /\/(specialty(-(core|data|stage|shell|learn|bank|explore|tools|notes))?\.(js|css)|kardia\.js|kardia\.css|kardia-flags\.js|kardia\/)/;
  ok(reqs.some((u) => /kardia-loader\.js\?v=krd2/.test(u)) && !reqs.some((u) => ENG.test(u)), "app boot loads kardia-loader.js and no engine or Kardia file");
  const gridOff = await ev(gridActs);
  const eligOff = await ev(eligibleActs);
  ok(!/,kardia,/.test("," + eligOff + ","), "Kardia is ineligible with the flag off");
  ok(/,kardiox,/.test("," + eligOff + ","), "the KardiQ X tile stays eligible with the flag off");
  ok(!/,kardia,/.test("," + gridOff + ","), "no Kardia tile on the grid with the flag off");
  ok((await ev(`return KARDIA.open();`)) === false, "KARDIA.open() refuses with the flag off");
  ok((await ev(`return !!document.getElementById('smdKardia');`)) === false, "no Kardia overlay node with the flag off");
  await ev(`SMD_openRoute("kardia"); return 1;`); await sleep(400);
  ok((await ev(`return !KARDIA.isOpen();`)) === true, "stewardmd://kardia does not open with the flag off");

  /* ── 2. FLAG ON: Kardia replaces the KardiQ X tile ── */
  console.log("\n--- flag ON: tile swap ---");
  await ev(`try{localStorage.setItem("smd_kardia","1");}catch(e){} return 1;`);
  await load(BASE + "?kardia=1");
  const eligOn = await ev(eligibleActs);
  ok(/,kardia,/.test("," + eligOn + ","), "Kardia is eligible with the flag on");
  ok(!/,kardiox,/.test("," + eligOn + ","), "the KardiQ X tile is replaced while Kardia is on");
  ok(reqs.some((u) => /specialty-shell\.js\?v=krd2/.test(u)) === false, "the engine still lazy-loads: nothing fetched until the tile opens");
  // Open from All tools and pin it: the real Home tile UI, like a tester would.
  await ev(`document.querySelector('.rnav-tile[data-act=alltools]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('[data-at-open="kardia"]');`, 10000), "All tools lists Kardia (and no KardiQ X row: " + await until(`return !document.querySelector('[data-at-open="kardiox"]');`, 5000) + ")");
  await ev(`document.querySelector('[data-at-pin="kardia"]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.rnav-tile[data-act=kardia]');`, 10000), "pinning puts the Kardia tile on the Home grid");

  /* ── 3. Open Kardia, walk the five tabs ── */
  await ev(`var t=document.querySelector('.rnav-tile[data-act=kardia]'); t.focus(); t.click(); return 1;`);
  ok(await until(`return KARDIA.isOpen() && !!document.getElementById("smdKardia");`, 10000), "tile opens the Kardia overlay");
  ok(await until(`return !!document.querySelector('#smdKardia [data-act=ktab][data-t=kardiox]');`, 20000), "first open loads the engine + Kardia and shows the five tabs");
  ok(reqs.some((u) => /specialty-shell\.js\?v=krd2/.test(u)) && reqs.some((u) => /kardia\.js\?v=krd2/.test(u)), "engine + Kardia loaded on open, at the loader token");
  ok((await ev(`return KARDIA._kardia.tabs.join(",");`)) === "echo,learn,practice,cases,kardiox", "tabs: Echo Lab, Learn, Practice, Cases, KardiQ X");
  ok((await ev(`return KARDIA._kardia.levels.join(",");`)) === "mbbs,resident,fellow,sonographer", "levels: MBBS, Resident, Fellow, Sonographer");
  ok((await ev(`return KARDIA._kardia.freeLessons;`)) === 5, "free preview is a constant (5 lessons)");
  ok(!/[–—]/.test(await ev(`return document.getElementById('smdKardia').innerText;`)), "no em or en dash on screen");
  const tabH = await ev(`return document.querySelector('#smdKardia .krd-tab').getBoundingClientRect().height;`);
  ok(tabH >= 44, `tabs are a 44px touch target (${tabH}px)`);

  // The KardiQ X gate is still armed: opening the tab must NOT open the AI overlay by itself.
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=kardiox]').click(); return 1;`);
  await sleep(400);
  ok((await ev(`return !document.getElementById('kardioxRoot') || !document.getElementById('kardioxRoot').classList.contains('kx-open');`)) === true,
    "the KardiQ X tab does not open the AI overlay on its own");

  /* Fixture cases are swapped in before the first Cases tab visit (the case index is cached once loaded). */
  await ev(`(function(){var orig=window.fetch; if(window.__kcFixture) return 1; window.__kcFixture=1; window.fetch=function(u,o){var s=String(u); if(s.indexOf("kardia/cases/")>=0){ s="/test/fixtures/kardia-cases/"+s.split("kardia/cases/")[1]; } return orig.call(window,s,o);}; return 1;})()`);
  /* ── 3b. Echo Lab: opens, probe moves by synthetic touch, A4C achieved ── */
  console.log("\n--- Echo Lab ---");
  await metrics(390, 844); await theme(false);
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=echo]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdKardia #krdSector') && !!document.querySelector('#smdKardia [data-act=kecho-view][data-v=tte_a4c]');`, 20000), "Echo Lab opens with the sector and the A4C target");
  ok((await ev(`return KARDIA._kardia.freeEchoViews.join(",");`)) === "tte_plax,tte_psax_papillary,tte_a4c", "free preview views are PLAX, PSAX papillary and A4C");
  ok(await until(`return document.querySelectorAll('#smdKardia #krdHints li').length > 0;`, 10000), "quality hint text appears for the starting probe position");
  const hintText = await ev(`return document.getElementById('krdHints').innerText;`);
  ok(/slide|rotate|tilt|rock/i.test(hintText || ""), `hint names a correction ("${(hintText || "").split("\n")[0]}")`);
  const beforeTouch = await ev(`return JSON.stringify(KARDIA._kardia.echoLab.getProbeState());`);
  await ev(`(function(){var el=document.getElementById('krdChest'); var r=el.getBoundingClientRect();
    function pe(type,x,y,id){el.dispatchEvent(new PointerEvent(type,{pointerId:id,clientX:x,clientY:y,bubbles:true}));}
    pe('pointerdown',r.left+40,r.top+40,7); pe('pointermove',r.left+90,r.top+55,7); pe('pointermove',r.left+120,r.top+60,7); pe('pointerup',r.left+120,r.top+60,7); return 1;})()`);
  await sleep(300);
  const afterTouch = await ev(`return JSON.stringify(KARDIA._kardia.echoLab.getProbeState());`);
  ok(beforeTouch !== afterTouch && JSON.parse(afterTouch).position.x !== JSON.parse(beforeTouch).position.x, "the probe moves by synthetic touch on the chest map");
  await ev(`KARDIA._kardia.echoLab.setView('tte_a4c'); return 1;`);
  await sleep(300);
  await ev(`(function(){var L=KARDIA._kardia.echoLab; L.setProbeState(L.stateForView('tte_a4c')); return 1;})()`);
  ok(await until(`return document.getElementById('krdScore') && document.getElementById('krdScore').innerText === '100';`, 10000), "A4C scores 100 when the probe state is set to its target");
  ok(await until(`return !!document.getElementById('krdAchieved') && !document.getElementById('krdAchieved').hidden;`, 8000), "view achieved shows after holding A4C for a second");
  await ev(`(function(){var L=KARDIA._kardia.echoLab; var s=L.getProbeState(); s.rotationDeg+=25; L.setProbeState(s); return 1;})()`);
  ok(await until(`return /rotate/i.test(document.getElementById('krdHints').innerText);`, 8000), "rotating off target brings back a rotate hint");

  /* ── 4. Screenshots: every tab at 390 and 820, light and dark ── */
  console.log("\n--- screenshots ---");
  const tabs = [["echo", "Echo Lab"], ["learn", "Echo"], ["practice", "Question bank"], ["cases", "Whole patient"], ["kardiox", "Open KardiQ X"]];
  for (const [w, h] of [[390, 844], [820, 1180]]) {
    await metrics(w, h);
    for (const dark of [false, true]) {
      await theme(dark);
      const th = dark ? "dark" : "light";
      for (const [id, marker] of tabs) {
        await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=${id}]').click(); return 1;`);
        await sleep(350);
        const seen = await ev(`return document.getElementById('smdKardia').innerText;`);
        ok(seen && seen.toLowerCase().indexOf(marker.split(" ")[0].toLowerCase()) >= 0, `${w}px ${th}: ${id} tab shows its screen ("${marker}")`);
        await shot(`kardia-${id}-${w}-${th}`);
      }
    }
  }
  // Learn lists the real atlas preview, not placeholders.
  await theme(false); await metrics(390, 844);
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=learn]').click(); return 1;`);
  await sleep(350);
  ok((await ev(`return document.querySelectorAll('#smdKardia [data-act=klearn][data-id]').length;`)) === 5, "Learn lists exactly the 5 free preview lessons");
  ok((await ev(`return (document.getElementById('smdKardia').innerText.match(/Plus \\d+ more lessons/)||[])[0];`)) !== null, "and counts the locked rest instead of listing it");

  /* ── 4b. Echo lesson, level change, bank question (light and dark, 390 and 820) ── */
  console.log("\\n--- Echo lesson, level and bank ---");
  for (const [w, h] of [[390, 844], [820, 1180]]) {
    await metrics(w, h);
    for (const dark of [false, true]) {
      await theme(dark);
      const th = dark ? "dark" : "light";
      await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=learn]').click(); return 1;`);
      await sleep(400);
      ok((await ev(`return document.querySelectorAll('#smdKardia [data-act=lesson][data-l]').length;`)) > 0, `${w}px ${th}: Learn lists echo lessons for the chosen level`);
      await ev(`var b=document.querySelector('#smdKardia [data-act=lesson][data-l]'); if(b) b.click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia .ln-art');`, 15000), `${w}px ${th}: an echo lesson opens in the engine player`);
      await shot(`kardia-echo-lesson-${w}-${th}`);
      await ev(`var n=document.getElementById('lnNext'); if(n) n.click(); return 1;`);
      await sleep(300);
      ok((await ev(`return !!document.querySelector('#smdKardia .ln-art');`)) === true, `${w}px ${th}: the lesson moves to its next step`);
      await ev(`var x=document.querySelector('#smdKardia [data-act=lnexit]'); if(x) x.click(); return 1;`);
      await sleep(400);
      // Change level: a locked level holds at the paywall for a free user, so grant Pro in the harness, then switch.
      await ev(`window.SMD_PRO={isProSync:function(){return true;},openPaywall:function(){}}; return 1;`);
      await ev(`var lv=document.querySelector('#smdKardia [data-act=klevel][data-v=resident]'); if(lv) lv.click(); return 1;`);
      await sleep(400);
      ok((await ev(`return document.querySelector('#smdKardia [data-act=klevel][data-v=resident]').getAttribute('aria-pressed');`)) === "true", `${w}px ${th}: level changes to Resident and the echo list refilters`);
      await ev(`var lv2=document.querySelector('#smdKardia [data-act=klevel][data-v=mbbs]'); if(lv2) lv2.click(); return 1;`);
      await sleep(300);
      await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=practice]').click(); return 1;`);
      await sleep(400);
      ok((await ev(`return document.getElementById('smdKardia').innerText.indexOf('Question bank')>=0;`)) === true, `${w}px ${th}: Practice shows the question bank, not coming soon`);
      await ev(`var qb=document.querySelector('#smdKardia [data-act=kbank]'); if(qb) qb.click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-act=mcqstart]');`, 15000), `${w}px ${th}: the bank home opens through the engine bank`);
      await ev(`document.querySelector('#smdKardia [data-act=mcqstart]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-act=mcqans]');`, 20000), `${w}px ${th}: a bank question loads`);
      await ev(`var a=document.querySelector('#smdKardia [data-act=mcqans]'); if(a) a.click(); return 1;`);
      await sleep(400);
      ok((await ev(`return document.getElementById('mcqNote') && document.getElementById('mcqNote').innerText.length>0;`)) === true, `${w}px ${th}: answering a bank question shows its explanation`);
      await shot(`kardia-bank-q-${w}-${th}`);
      await ev(`if(window.KARDIA){KARDIA.close(); KARDIA.open();} return 1;`);
      await until(`return !!document.querySelector('#smdKardia [data-act=ktab][data-t=learn]');`, 15000);
      await sleep(300);
    }
  }

  /* ── 4c. SyncProbe: two roles, one stubbed link (390 and 820, light and dark) ──
   * The real KARDIA_SYNC core has not landed: the stub in
   * test/fixtures/kardia-sync-stub.mjs stands in, loaded here as a module, and
   * one page hosts both roles by swapping window.KARDIA_SYNC. The pair sheet,
   * probe screens, pill, details and lost-link banner are exercised through the
   * real Echo Lab hook, with screenshots into work/shots/. */
  console.log("\n--- SyncProbe (stubbed link) ---");
  await metrics(390, 844); await theme(false);
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=echo]').click(); return 1;`);
  ok(await until(`return !!window.KARDIA_SYNCPROBE;`, 15000), "SyncProbe module loads with the Kardia engine");
  ok(await until(`return !!document.getElementById('krdSyncPill');`, 8000), "Echo Lab carries the SyncProbe pill slot");
  await ev(`import('/test/fixtures/kardia-sync-stub.mjs').then(function(m){ window.KARDIA_SYNCPROBE_STUB = m; }, function(x){ window.KARDIA_SYNCPROBE_STUB = 'ERR:' + String(x && x.message || x); }); return 1;`);
  ok(await until(`return !!window.KARDIA_SYNCPROBE_STUB && typeof window.KARDIA_SYNCPROBE_STUB !== 'string';`, 15000), "SyncProbe stub loads in the app page");
  await ev(`(function(){ var p = window.KARDIA_SYNCPROBE_STUB.createSessionPair(); window.__sph = { display: p.display, probe: p.probe }; window.KARDIA_SYNC = p.display; return 1; })()`);
  const spUse = async (which) => ev(`window.KARDIA_SYNC = window.__sph.${which}; return 1;`);
  const spTxt = async () => ev(`return document.getElementById('krdSpRoot') ? document.getElementById('krdSpRoot').innerText : '';`);
  const spClick = async (sel) => ev(`(function(){var b=${sel}; if(b){b.click(); return 1;} return 0;})()`);
  // Display role: role sheet, pair sheet, QR, code, live state.
  await ev(`[...document.querySelectorAll('#smdKardia [data-act]')].find(b=>b.getAttribute('data-act')==='kecho-syncprobe').click(); return 1;`);
  ok(await until(`return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Pair a probe')>=0;`, 8000), "SyncProbe button opens the role sheet");
  await spClick(`[...document.querySelectorAll('#krdSpRoot [data-act]')].find(b=>b.getAttribute('data-act')==='sp-display')`);
  ok(await until(`return !!document.getElementById('krdSpQr');`, 8000), "pair sheet shows the pairing QR canvas");
  const spQr = await ev(`return document.getElementById('krdSpQr').width;`);
  ok(spQr > 100, `QR canvas draws at code size (${spQr}px wide)`);
  const spCode = await ev(`return window.KARDIA_SYNC.session().shortCode;`);
  ok(/^[A-Z2-9]{6}$/.test(spCode || ""), `probe code is six plain characters ("${spCode}")`);
  ok((await spTxt()).indexOf(spCode.slice(0, 3)) >= 0, "the code on screen matches the session code");
  ok(/Looking for|Pairing/.test(await ev(`return document.getElementById('krdSpState').innerText;`) || ""), "live state line moves");
  ok(!/[–—]/.test(await spTxt()), "no em or en dash in the pair sheet");
  // Probe role: intro, denied motion, touch fallback, calibrate, join box.
  await spUse("probe");
  await ev(`window.KARDIA_SYNCPROBE.openProbe(); return 1;`);
  ok(await until(`return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Use this phone as a probe')>=0;`, 8000), "probe intro explains motion first");
  await ev(`window.__krdSpMotionForced = 'denied'; return 1;`);
  await spClick(`[...document.querySelectorAll('#krdSpRoot [data-act]')].find(b=>b.getAttribute('data-act')==='sp-motion')`);
  ok(await until(`return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Motion is off')>=0;`, 8000), "denied motion explains and offers touch controls");
  await spClick(`[...document.querySelectorAll('#krdSpRoot [data-act]')].find(b=>b.getAttribute('data-act')==='sp-touch')`);
  ok(await until(`return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Touch controls')>=0;`, 8000), "touch fallback opens");
  await ev(`window.KARDIA_SYNCPROBE.openProbe(); return 1;`);
  await ev(`window.__krdSpMotionForced = 'granted'; return 1;`);
  await spClick(`[...document.querySelectorAll('#krdSpRoot [data-act]')].find(b=>b.getAttribute('data-act')==='sp-motion')`);
  ok(await until(`return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Calibrate')>=0;`, 8000), "granted motion reaches calibration");
  ok(/left shoulder/.test(await spTxt() || ""), "calibration tells the hold position");
  await spClick(`[...document.querySelectorAll('#krdSpRoot [data-act]')].find(b=>b.getAttribute('data-act')==='sp-calibrate')`);
  ok(await until(`return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Join with a code')>=0;`, 8000), "session screen still offers joining before the link exists");
  // The probe joins with the typed code; both phones confirm the same number.
  await ev(`document.getElementById('krdSpCode').value = ${JSON.stringify(spCode)}; return 1;`);
  await spClick(`[...document.querySelectorAll('#krdSpRoot [data-act]')].find(b=>b.getAttribute('data-act')==='sp-join-code')`);
  ok(await until(`return (document.getElementById('krdSpState')||{innerText:''}).innerText.indexOf('matches')>=0;`, 8000), "probe reaches the confirm step after joining");
  await spUse("display");
  await ev(`window.KARDIA_SYNCPROBE.openDisplay(); return 1;`);
  ok(await until(`return (document.getElementById('krdSpState')||{innerText:''}).innerText.indexOf('matches')>=0;`, 8000), "display reaches the confirm step when the probe joins");
  const spConfirmD = await ev(`return (document.querySelector('#krdSpConfirm .krd-sp-confirmno')||{innerText:''}).innerText;`);
  ok(spConfirmD.replace(/\s/g, "") === await ev(`return window.__sph.probe.session().confirm;`), `both phones show the same number ("${spConfirmD.trim()}")`);
  await shot(`kardia-syncprobe-confirm-390-light`);
  await spClick(`document.querySelector('#krdSpConfirm [data-act=sp-confirm]')`);
  await spUse("probe");
  await ev(`window.KARDIA_SYNCPROBE.openProbe(); return 1;`);
  ok(await until(`return !!document.querySelector('#krdSpConfirmP [data-act=sp-confirm]');`, 8000), "probe shows its own confirm button");
  await spClick(`document.querySelector('#krdSpConfirmP [data-act=sp-confirm]')`);
  ok(await until(`return (document.querySelectorAll('#krdSyncPill button').length>0);`, 8000), "connected: the sheet closes and the pill appears on Echo Lab");
  const spPill = await ev(`return document.querySelector('#krdSyncPill').innerText;`);
  ok(/ms/.test(spPill || ""), `pill shows link latency ("${(spPill || "").trim()}")`);
  ok(!/[–—]/.test(spPill || ""), "no dashes in the pill");
  ok((await ev(`return document.querySelector('#krdSyncPill button').getBoundingClientRect().height;`)) >= 44, "pill is a 44px target");
  await sleep(700);
  ok(/Tilt -?\d+ deg/.test(await ev(`return (document.getElementById('krdSpPoseDesc')||{innerText:''}).innerText;`) || ""), "orientation readout follows the link");
  await shot(`kardia-syncprobe-probe-active-390-light`);
  await ev(`window.__sph.probe._set('reconnecting'); return 1;`);
  ok(await until(`return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('frozen')>=0;`, 8000), "probe shows the lost banner with Reconnect and Recenter");
  await shot(`kardia-syncprobe-probe-lost-390-light`);
  await ev(`window.__sph.probe.reconnect(); return 1;`);
  ok(await until(`return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Probe session')>=0 && (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('frozen')<0;`, 8000), "reconnect clears the probe banner");
  // Details, lost link and recenter on the display phone.
  await spUse("display");
  await ev(`window.KARDIA_SYNCPROBE.openDisplay(); return 1;`);
  await ev(`window.KARDIA_SYNCPROBE.dismiss(); return 1;`);
  await spClick(`document.querySelector('#krdSyncPill button')`);
  ok(await until(`return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Connection')>=0;`, 8000), "pill opens connection details");
  const spDet = await spTxt();
  for (const w of ["Link", "Delay", "Image rate", "Code expires", "Last error", "Links on this phone"]) {
    ok(spDet.indexOf(w) >= 0, `details show ${w}`);
  }
  ok(spDet.indexOf("Nearby, Bluetooth") < 0, "loopback link is named plainly, not as Bluetooth");
  await shot(`kardia-syncprobe-details-390-light`);
  await spClick(`[...document.querySelectorAll('#krdSpRoot [data-act]')].find(b=>b.getAttribute('data-act')==='sp-back')`);
  await ev(`window.__sph.display._set('reconnecting'); return 1;`);
  ok(await until(`return !!document.getElementById('krdSpLost');`, 8000), "lost link shows a banner on Echo Lab");
  ok(/frozen/.test(await ev(`return document.getElementById('krdLab').innerText;`) || ""), "banner says the image is frozen");
  await shot(`kardia-syncprobe-lost-390-light`);
  await spClick(`document.querySelector('#krdSpLost [data-act=sp-reconnect]')`);
  await ev(`window.__sph.display.reconnect(); return 1;`);
  ok(await until(`return !document.getElementById('krdSpLost');`, 8000), "reconnect clears the banner");
  // Screenshots: pair sheet and probe screen at 390 and 820, light and dark.
  for (const [w, h] of [[390, 844], [820, 1180]]) {
    await metrics(w, h);
    for (const dark of [false, true]) {
      await theme(dark);
      const th = dark ? "dark" : "light";
      await spUse("display");
      await ev(`window.KARDIA_SYNCPROBE.openDisplay(); return 1;`);
      ok(await until(`return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Pair a probe')>=0;`, 8000), `${w}px ${th}: pair sheet`);
      await shot(`kardia-syncprobe-pair-${w}-${th}`);
      await spUse("probe");
      await ev(`window.KARDIA_SYNCPROBE.openProbe(); return 1;`);
      ok(await until(`return /Probe session|Use this phone/.test((document.getElementById('krdSpRoot')||{innerText:''}).innerText);`, 8000), `${w}px ${th}: probe screen`);
      await shot(`kardia-syncprobe-probe-${w}-${th}`);
      await spUse("display");
      await ev(`window.KARDIA_SYNCPROBE.dismiss(); return 1;`);
      ok(await until(`return (document.querySelector('#krdSyncPill')||{innerText:''}).innerText.length>0;`, 8000), `${w}px ${th}: pill on Echo Lab`);
      await shot(`kardia-syncprobe-pill-${w}-${th}`);
    }
  }
  // Leave no trace for the sections after this one.
  await ev(`window.KARDIA_SYNCPROBE.close(); try { delete window.KARDIA_SYNC; } catch (e) {} return 1;`);
  ok(await until(`return (document.getElementById('krdSpRoot')||{innerText:''}).innerText === '';`, 8000), "SyncProbe UI closes cleanly");

  // Pressing Open KardiQ X without a code must hold at the gate: no AI overlay opens.
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=kardiox]').click(); return 1;`);
  await sleep(300);
  await ev(`(function(){var b=[...document.querySelectorAll('#smdKardia [data-act=kx]')][0]; if(b) b.click(); return 1;})()`);
  await sleep(600);
  ok((await ev(`return !document.getElementById('kardioxRoot') || !document.getElementById('kardioxRoot').classList.contains('kx-open');`)) === true,
    "Open KardiQ X without a code holds at SMD_XACCESS: no AI overlay opens");
  // Close the access sign-in sheet the gate opened, so later screenshots are not covered by it.
  await ev(`var n=[...document.querySelectorAll('button')].filter(function(b){return b.offsetParent && /^\\s*Not now\\s*$/.test(b.textContent);})[0]; if(n) n.click(); return 1;`);
  await sleep(400);

  /* ── 6. Cases: fixture case end to end (390 and 820, light and dark) ── */
  console.log("\n--- Cases: fixture case end to end ---");
  for (const [w, h] of [[390, 844], [820, 1180]]) {
    await metrics(w, h);
    for (const dark of [false, true]) {
      await theme(dark);
      const th = dark ? "dark" : "light";
      /* The theme and size switches reload the page, so the fixture fetch swap is installed before each visit. */
      await ev(`(function(){var orig=window.fetch; if(window.__kcFixture) return 1; window.__kcFixture=1; window.fetch=function(u,o){var s=String(u); if(s.indexOf("kardia/cases/")>=0){ s="/test/fixtures/kardia-cases/"+s.split("kardia/cases/")[1]; } return orig.call(window,s,o);}; return 1;})()`);
      await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=cases]').click(); return 1;`);
      ok(await until(`return document.querySelectorAll('#smdKardia [data-act=kcase-open]').length>=1;`, 15000), `${w}px ${th}: Cases lists fixture cases`);
      await shot(`kardia-cases-list-${w}-${th}`);
      await ev(`document.querySelector('#smdKardia [data-act=kcase-open]').click(); return 1;`);
      ok(await until(`return document.getElementById('smdKardia').innerText.indexOf('racing pulse')>=0 || document.querySelector('#smdKardia .kc-vitals')!==null;`, 15000), `${w}px ${th}: case opens on the stem`);
      ok((await ev(`return !!document.querySelector('#smdKardia .kc-vitals');`)) === true, `${w}px ${th}: stem shows vitals`);
      const step = async (marker) => { await ev(`var b=document.querySelector('#smdKardia [data-act=kcase-next]'); if(b) b.click(); return 1;`); await sleep(350); return await ev(`return document.getElementById('smdKardia').innerText;`); };
      let txt = await step();
      ok(txt.indexOf("Tap each question") >= 0, `${w}px ${th}: history step`);
      await ev(`var q=document.querySelector('#smdKardia [data-act=kcase-q]'); if(q) q.click(); return 1;`); await sleep(300);
      ok((await ev(`return !!document.querySelector('#smdKardia .kc-a');`)) === true, `${w}px ${th}: tapping a history question reveals its answer`);
      txt = await step();
      ok(txt.indexOf("Examination") >= 0 && txt.indexOf("Listen") >= 0, `${w}px ${th}: examination shows a Listen control`);
      await ev(`var l=document.querySelector('#smdKardia [data-act=kcase-listen]'); if(l) l.click(); return 1;`); await sleep(300);
      txt = await step();
      ok((await ev(`return !!document.querySelector('#smdKardia .kc-ecg polyline');`)) === true, `${w}px ${th}: ECG strip is drawn by the ECG wave code`);
      ok(txt.indexOf("Atrial fibrillation") >= 0, `${w}px ${th}: ECG names the case rhythm`);
      txt = await step();
      ok((await ev(`return !!document.querySelector('#smdKardia .kc-diagram');`)) === true, `${w}px ${th}: echo task shows the lesson diagram for its view`);
      await ev(`var i=document.querySelector('#smdKardia [data-echo="0"]'); if(i){i.value='0.9';} var c=document.querySelector('#smdKardia [data-act=kcase-echo-check]'); if(c) c.click(); return 1;`); await sleep(300);
      ok((await ev(`return document.getElementById('smdKardia').innerText.indexOf('Correct.')>=0;`)) === true, `${w}px ${th}: echo measurement is graded against truth with tolerance`);
      txt = await step();
      await ev(`(function(){var vals={'Left atrium':'large left atrium','Mitral valve':'rheumatic mitral stenosis','Mitral valve area':'0.9 severe','Rhythm during study':'AF'}; document.querySelectorAll('#smdKardia [data-field]').forEach(function(el){ el.value=vals[el.getAttribute('data-field')]||''; }); var b=document.querySelector('#smdKardia [data-act=kcase-report-check]'); if(b) b.click(); return 1;})()`); await sleep(300);
      ok((await ev(`return document.getElementById('smdKardia').innerText.indexOf('4 of 4')>=0;`)) === true, `${w}px ${th}: structured report is app marked against the accept lists`);
      txt = await step();
      await ev(`var d=document.querySelector('#smdKardia [data-diag]'); if(d) d.value='severe rheumatic mitral stenosis with atrial fibrillation'; var b2=document.querySelector('#smdKardia [data-act=kcase-diag-check]'); if(b2) b2.click(); return 1;`); await sleep(300);
      ok((await ev(`return document.getElementById('smdKardia').innerText.indexOf('Model management')>=0;`)) === true, `${w}px ${th}: diagnosis check reveals the model management`);
      await ev(`var f=document.querySelector('#smdKardia [data-act=kcase-finish]'); if(f) f.click(); return 1;`); await sleep(400);
      ok((await ev(`return document.getElementById('smdKardia').innerText.indexOf('Debrief')>=0;`)) === true, `${w}px ${th}: debrief shows scores per section`);
      ok((await ev(`return (localStorage.getItem('smd_kardia_v1')||'').indexOf('fixture-ms-af')>=0;`)) === true, `${w}px ${th}: attempt and FSRS card are recorded in the engine store`);
      await shot(`kardia-case-debrief-${w}-${th}`);
      await ev(`var a=document.querySelector('#smdKardia [data-act=kcase-list]'); if(a) a.click(); return 1;`); await sleep(300);
    }
  }

  /* ── 5. Back OFF: the grid is byte-for-byte what it was ── */
  await ev(`KARDIA.close(); try{localStorage.removeItem("smd_kardia");}catch(e){} return 1;`);
  await load(BASE);
  const gridBack = await ev(gridActs);
  ok(gridBack === gridOff, "flag back off: the Home grid is byte-for-byte what it was");
  ok(!/kardia/i.test(JSON.stringify(errors)), "no uncaught Kardia errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));

  console.log(fails === 0 ? "\nALL GREEN: Kardia wired into the app" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} process.exit(fails === 0 ? 0 : 1); }
