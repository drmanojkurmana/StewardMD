/* Tokós in the REAL app (headless Chrome): ON by default, the tile opens Tokós, the hub shows the CTG clinic, back()
 * returns to home; the Review Desk Tokós tab lists the cases and text blocks and Read it opens a case; smd_tokos="0"
 * and ?tokos=0 hide the tile and block every entry; no uncaught Tokós errors. SHOTS=<dir> saves screenshots. The module's own behaviour is in test/run-tokos-ui.mjs.
 * USAGE: node test/run-tokos-app-ui.mjs   (BASE=http://localhost:8996/ to use a running server)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
// BASE (a running server) or PORT (the server this harness starts) and CHROME_PORT override the defaults, so parallel sessions do not collide.
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || 8996) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || 9398), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tokos-app-chrome-" + PORT;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
// Like ev, for a promise-returning body.
const evp = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(200); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url);
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/tokos|TOKOS/i.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  const tile = `return !!document.querySelector('.rnav-tile[data-act=tokos]');`;
  const load = async (url) => { await call("Page.navigate", { url }); await until(`return !!(window.TOKOS && window.SMD_showHome);`, 30000); await ev(clean); await ev(`SMD_showHome(); return 1;`); await sleep(600); };

  const shot = async (name) => { const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result && process.env.SHOTS) (await import("node:fs")).writeFileSync(join(process.env.SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };

  // default (owner decision 2026-09-29, ON for all): no flag set, the tile shows and opens Tokós
  await call("Page.navigate", { url: BASE }); await until(`return !!(window.TOKOS && window.SMD_showHome);`, 30000);
  await ev(`try{localStorage.removeItem("smd_tokos"); localStorage.removeItem("smd_tokos_prefs"); localStorage.removeItem("smd_home_tools"); localStorage.removeItem("smd_review_decisions");}catch(e){} return 1;`);
  await load(BASE);
  // lazy loading: app boot requests the loader and no engine or Tokós file
  const ENG = /\/(specialty(-(core|data|stage|shell|learn|bank|explore|tools|notes))?\.(js|css)|tokos(-core|-data|-stage|-ctg|-calipers)?\.(js|css)|tokos-models\/)/;
  ok(reqs.some((u) => /tokos-loader\.js\?v=tok7/.test(u)) && !reqs.some((u) => ENG.test(u)), "app boot loads tokos-loader.js and no engine or Tokós file" + (reqs.filter((u) => ENG.test(u)).length ? ": " + reqs.filter((u) => ENG.test(u)).join(", ") : ""));
  ok(await until(tile, 10000), "default (no flag): the Tokós home tile renders without being added from Add Tool");
  await ev(`var t=document.querySelector('.rnav-tile[data-act=tokos]'); t.focus(); t.click(); return 1;`);
  ok(await until(`return TOKOS.isOpen() && !!document.getElementById("smdTokos");`, 10000), "tile opens the Tokós overlay");
  ok(await until(`return !!document.querySelector('#smdTokos [data-act=pick][data-t=test]');`, 20000), "first open loads Tokós and asks Learn or Test");
  ok(await ev(`return !!window.SPECIALTY_CORE;`) === true && reqs.some((u) => /specialty-shell\.js\?v=tok7/.test(u)) && reqs.some((u) => /tokos-ctg\.js\?v=tok7/.test(u)), "the engine and Tokós loaded on open, at the loader's token");
  await ev(`document.querySelector('#smdTokos [data-act=pick][data-t=test]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdTokos [data-act=clinic][data-t=ctg]');`, 20000), "hub shows the CTG clinic");
  // Tokós 2.0 wiring: every model in tokos/models.json is listed with its own screen (13 tools, 6 drills + the labour room
  // + the OSCE link, 6 explorers) and the three clinics are registered.
  ok(await until(`var T=TOKOS; return T._tools.length === 13 && T._sims.length === 8 && T._explore.length === 6;`, 20000), "all 13 calculators, 6 drills + labour + OSCE and 6 explorers are listed: " + await ev(`var T=TOKOS; return [T._tools.length, T._sims.map(function(x){return x.id;}).join(","), T._explore.map(function(x){return x.id;}).join(",")].join(" | ");`));
  ok(await ev(`return !TOKOS._sims.some(function(x){return x.pending;});`) === true, "the labour room has its own screen (no placeholder)");
  ok(await ev(`return TOKOS._clinics.map(function(x){return x.id;}).join(",");`) === "ctg,fetal-planes,hc-biometry", "clinics: CTG, fetal planes, HC biometry");
  ok(await ev(`return !!document.querySelector('#smdTokos [data-act=sim][data-s=osce]');`) === true, "Test hub lists the OSCE link");
  await ev(`TOKOS.back(); return 1;`);
  ok(await until(`return !TOKOS.isOpen();`, 5000), "back() closes Tokós and returns to home");
  ok(await ev(`var a=document.activeElement; return !!(a && a.matches && a.matches('.rnav-tile[data-act=tokos]'));`) === true, "closing Tokós returns focus to the tile that opened it");
  ok(await ev(`return !document.getElementById("smdTokos") || !document.getElementById("smdTokos").offsetParent;`) === true, "overlay is gone");
  await ev(`SMD_openRoute("tokos"); return 1;`);
  ok(await until(`return TOKOS.isOpen();`, 5000), "default: stewardmd://tokos (SMD_openRoute) opens Tokós");
  await ev(`TOKOS.close(); return 1;`);

  // Review Desk: the Tokós tab lists one item per case and per text block; Read it opens that case in Tokós
  await ev(`SMD_REVIEW.open(); return 1;`);
  await until(`return !!document.querySelector('#smdReview [data-rv-act="kind:tokos"]');`, 10000);
  await ev(`document.querySelector('#smdReview [data-rv-act="kind:tokos"]').click(); return 1;`);
  // 16 CTG cases + 3 text blocks, plus Tokós 2.0: 40 units, 17 bank topics, 6 drills, the labour room, 13 calculators,
  // 6 explorers, 2 ultrasound clinics; the units holding claims to verify come first
  ok(await until(`return document.querySelectorAll('#smdReview .rv-row').length === 104;`, 20000), "Review Desk Tokós tab lists every Tokós content item: " + await ev(`return document.querySelectorAll('#smdReview .rv-row').length;`));
  ok(await ev(`var r=document.querySelectorAll('#smdReview .rv-row'); return r[0].getAttribute("data-rv-act") + "," + r[1].getAttribute("data-rv-act");`) === "sel:unit-ob9,sel:unit-ob12", "units with claims to verify are listed first");
  await ev(`document.querySelector('#smdReview [data-rv-act="sel:unit-ob12"]').click(); return 1;`);
  await until(`return !!document.querySelector('#smdReview [data-rv-act="read"]');`);
  await ev(`document.querySelector('#smdReview [data-rv-act="read"]').click(); return 1;`);
  ok(await until(`var t=document.querySelector('#smdReview .rv-text'); return !!t && /^Verify first/.test(t.querySelector(".rv-s").textContent) && /FIGO 2015 baseline/.test(t.textContent);`, 5000), "Read it on a unit lists its verify claims first, then each lesson");
  await ev(`document.querySelector('#smdReview [data-rv-act="back"]').click(); return 1;`);
  await ev(`document.querySelector('#smdReview [data-rv-act="sel:tool-mgso4"]').click(); return 1;`);
  await until(`return !!document.querySelector('#smdReview [data-rv-act="read"]');`);
  await ev(`document.querySelector('#smdReview [data-rv-act="read"]').click(); return 1;`);
  ok(await until(`var t=document.querySelector('#smdReview .rv-text'); return !!t && /Worked example/.test(t.textContent) && /Source/.test(t.textContent);`, 5000), "a calculator shows its worked examples and sources");
  await ev(`document.querySelector('#smdReview [data-rv-act="back"]').click(); return 1;`);
  await ev(`document.querySelector('#smdReview [data-rv-act="sel:bank-ob-labour"]').click(); return 1;`);
  await until(`return !!document.querySelector('#smdReview [data-rv-act="read"]');`);
  await ev(`document.querySelector('#smdReview [data-rv-act="read"]').click(); return 1;`);
  ok(await until(`var t=document.querySelector('#smdReview .rv-text'); return !!t && /Flags: /.test(t.textContent) && /Key: /.test(t.textContent);`, 10000), "a bank topic lists its flagged answer keys");
  await ev(`document.querySelector('#smdReview [data-rv-act="back"]').click(); return 1;`);
  await until(`return !!document.querySelector('#smdReview [data-rv-act="sel:clinic-fetal-planes"]');`);
  await ev(`document.querySelector('#smdReview [data-rv-act="sel:clinic-fetal-planes"]').click(); return 1;`);
  await until(`return !!document.querySelector('#smdReview [data-rv-act="read"]');`);
  await ev(`document.querySelector('#smdReview [data-rv-act="read"]').click(); return 1;`);
  ok(await until(`var t=document.querySelector('#smdReview .rv-text'); return !!t && /transthalamic/i.test(t.textContent) && /ISUOG/.test(t.textContent);`, 5000), "the fetal planes clinic shows its teaching points and sources");
  await ev(`document.querySelector('#smdReview [data-rv-act="back"]').click(); return 1;`);
  await until(`return !!document.querySelector('#smdReview [data-rv-act="sel:case-1031"]');`);
  ok(await ev(`var r=document.querySelector('#smdReview [data-rv-act="sel:case-1031"]'); return !!r && /Tokós CTG case 1031/.test(r.textContent) && /Pending review/.test(r.textContent);`) === true, "a case row is titled and pending review");
  await ev(`document.querySelector('#smdReview [data-rv-act="sel:case-1031"]').click(); return 1;`);
  ok(await until(`var t=document.querySelector('#smdReview .rv-tok'); return !!t && /FIGO category/.test(t.textContent) && /Baseline/.test(t.textContent) && /Variability/.test(t.textContent) && /Decelerations/.test(t.textContent) && /Contractions/.test(t.textContent) && /Acidosis class/.test(t.textContent) && /Signal quality/.test(t.textContent);`), "case detail shows the labels to confirm and the quality note");
  await shot("review-desk-tokos-case-390");
  await ev(`document.querySelector('#smdReview [data-rv-act="read"]').click(); return 1;`);
  ok(await until(`return TOKOS.isOpen() && TOKOS._st.view === "clinic" && TOKOS._st.session.list.length === 1 && TOKOS._st.session.list[0].c.id === "1031";`, 20000), "Read it opens Tokós straight into case 1031");
  ok(await ev(`var r=document.getElementById("smdTokos").getBoundingClientRect(), e=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2); return !!(e && e.closest("#smdTokos"));`) === true, "Tokós sits above the Review Desk");
  await ev(`TOKOS.back(); TOKOS.back(); return 1;`);
  ok(await until(`return !TOKOS.isOpen() && document.querySelector('#smdReview.on') && getComputedStyle(document.getElementById('smdReview')).display !== 'none';`, 5000), "closing Tokós returns to the Review Desk");
  await ev(`document.querySelector('#smdReview [data-rv-act="back"]').click(); return 1;`);
  await until(`return !!document.querySelector('#smdReview [data-rv-act="sel:rationale"]');`);
  await ev(`document.querySelector('#smdReview [data-rv-act="sel:rationale"]').click(); return 1;`);
  await until(`return !!document.querySelector('#smdReview [data-rv-act="read"]');`);
  await ev(`document.querySelector('#smdReview [data-rv-act="read"]').click(); return 1;`);
  ok(await until(`return document.querySelectorAll('#smdReview .rv-text li').length === 14;`), "Read it on the teaching points shows all 14, English and Hindi");
  await shot("review-desk-tokos-text-390");
  ok(await ev(`return document.querySelector('#smdReview [data-rv-act="read"]').getAttribute('aria-expanded') === 'true';`) === true, "the text toggle reports its state");
  ok(!/[–—]/.test(await ev(`return document.querySelector('#smdReview').innerText;`)), "review desk Tokós tab: no em or en dash on screen");
  await ev(`document.getElementById('rv_dec').value='approve'; document.getElementById('rv_name').value='Dr Test'; document.querySelector('#smdReview [data-rv-act="save"]').click(); return 1;`);
  ok(await until(`return (JSON.parse(localStorage.getItem('smd_review_decisions')||'{}')['tokos:rationale']||{}).decision === 'approve';`), "a Tokós decision is saved like other content (kind tokos)");
  await ev(`localStorage.removeItem('smd_review_decisions'); SMD_REVIEW.close(); return 1;`);

  // OSCE: CliniX opens above Tokós; back (swipe-back.js) acts on CliniX, and Tokós keeps its screen underneath
  await ev(`SMD_openRoute("tokos"); return 1;`);
  await until(`return !!document.querySelector('#smdTokos [data-act=sim][data-s=osce]');`, 20000);
  const tokView = await ev(`return TOKOS._st.view;`);
  await ev(`document.querySelector('#smdTokos [data-act=sim][data-s=osce]').click(); return 1;`);
  ok(await until(`return !!(window.CLINIX && CLINIX.isOpen() && document.getElementById("clinixRoot") && document.getElementById("clinixRoot").textContent.length > 50);`, 20000), "the OSCE entry opens CliniX");
  await sleep(1500);
  const cxBefore = await ev(`return document.getElementById("clinixRoot").innerHTML.length + ":" + document.getElementById("clinixRoot").textContent.slice(0, 200);`);
  await ev(`SMD_SWIPE_BACK.goBack(); return 1;`);
  await sleep(800);
  ok(await ev(`var r=document.getElementById("clinixRoot"); return !CLINIX.isOpen() || (r.innerHTML.length + ":" + r.textContent.slice(0, 200)) !== ${JSON.stringify(cxBefore)};`) === true && await ev(`return TOKOS.isOpen() && TOKOS._st.view;`) === tokView, "back over the OSCE acts on CliniX; Tokós keeps its view");
  await ev(`for (var i = 0; i < 6 && CLINIX.isOpen(); i++) { if (CLINIX.close) CLINIX.close(); } return 1;`);

  // kill switch smd_tokos="0": no tile, and no other entry opens it (ACT.tokos is the one door; openCase checks the same flag)
  await ev(`localStorage.setItem("smd_tokos","0"); return 1;`);
  await load(BASE);
  ok(await ev(tile) === false, "smd_tokos=0: the Tokós home tile is absent");
  await ev(`SMD_openRoute("tokos"); return 1;`); await sleep(400);
  ok(await ev(`return !TOKOS.isOpen();`) === true, "smd_tokos=0: stewardmd://tokos (SMD_openRoute) does not open Tokós");
  ok(await ev(`return TOKOS.openCase("1031") === false && !TOKOS.isOpen();`) === true, "smd_tokos=0: TOKOS.openCase is blocked");

  // URL kill switch
  await ev(`localStorage.removeItem("smd_tokos"); return 1;`);
  await load(BASE + "?tokos=0");
  ok(await ev(tile) === false, "?tokos=0 hides the tile without the flag");
  await ev(`SMD_openRoute("tokos"); return 1;`); await sleep(400);
  ok(await ev(`return !TOKOS.isOpen();`) === true, "?tokos=0: the route is blocked");

  ok(errors.length === 0, "no uncaught Tokós errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN: Tokós wired into the app" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
