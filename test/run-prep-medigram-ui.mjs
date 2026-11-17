/* PrepReels (MediGram) in the REAL app (headless Chrome over CDP), flag smd_prep_medigram ON.
 * What must hold: prep-loader fetches the PrepReels files only with the flag; home shows PrepReels;
 * the reel mixes bank questions, pearls and videos; an answer scores in place and writes FSRS; a video in view
 * autoplays in the app through the https shim (stubbed here) and never hands off to YouTube; Keep going
 * and Finish work; Smart Break (sub-flag) runs a timer that only offers a return; nothing wider than 390 px.
 * USAGE: node test/run-prep-medigram-ui.mjs   (CHROME=<path>) */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = "/tmp/prep-mg-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });
let shimSilent = false;
// The shim (stewardmd.in/_site/yt) is stubbed: it posts the same hello the real one does, or stays silent.
// The live stub also answers the app's commands like the real shim: { smdCmd } in, { smdYt, state, muted } out.
const shimPage = (silent) => "<!doctype html><body style=background:#000><script>" + (silent ? "" : "var v=(location.search.match(/v=([^&]+)/)||[])[1],st=1,mu=false,t=0;function rep(){parent.postMessage({smdYt:true,v:v,state:st,muted:mu,t:t},'*');}parent.postMessage({clinixYt:true,v:v,shim:'loaded'},'*');rep();addEventListener('message',function(e){var c=e.data&&e.data.smdCmd;if(c==='pause')st=2;if(c==='play')st=1;if(c==='mute')mu=true;if(c==='unmute')mu=false;if(c==='seek')t=Math.max(0,t+(+e.data.by||0));rep();});") + "</script>";
// Every bank module the reel draws gets a 30-question fixture (the fixture bank only has two real modules); imglearn gets two images.
const fixtureFor = (u) => {
  if (/imglearn/.test(u)) return { set: "eye", items: [{ img: "fx.webp", dx: "Fixture diagnosis", finding: "Fixture finding.", deck: "Eye" }, { img: "fx2.webp", dx: "Second diagnosis", deck: "Eye" }] };
  const mid = (u.match(/\/mcq\/([^/?]+)\.json/) || [, "fx"])[1], items = [];
  for (let i = 0; i < 30; i++) items.push({ id: mid + "-" + i, q: "Fixture question " + i + " on " + mid + "?", o: ["One", "Two", "Three", "Four"], a: 0, exp: "Fixture explanation " + i + ". More.", kp: i % 2 ? "Pearl " + i + " of " + mid : undefined, t: mid, d: 3, prov: "LIC" });
  items.push({ id: mid + "-fig", q: "Identify the lesion shown in the image.", o: ["One", "Two", "Three", "Four"], a: 0, exp: "Needs its figure.", t: mid, d: 3, prov: "LIC" });
  return { topic: mid, items };
};
let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = []; const reqs = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const evA = async (e) => { const r = await call("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start: " + chromeErr.slice(-500));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url); if (m.method === "Fetch.requestPaused") { const u = m.params.request.url, isShim = /_site\/yt/.test(u); call("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: isShim ? "text/html" : "application/json" }], body: Buffer.from(isShim ? shimPage(shimSilent) : JSON.stringify(fixtureFor(u))).toString("base64") }); } if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP|medigram/i.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Page.enable", {});
  await call("Fetch.enable", { patterns: ["*stewardmd.in/_site/yt*", "*/mcq/*.json*", "*imglearn/*"].map((u) => ({ urlPattern: u, requestStage: "Request" })) });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_API="/test/fixtures/prep/api/"; window.SMD_PREP_FLAG_API="/test/fixtures/prep/hidden.json"; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false; try{localStorage.setItem("smd_prep_medigram","1");}catch(e){}` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.setItem("smd_prep_medigram","1"); localStorage.removeItem("smd_prep_v1");}catch(e){} return 1;`);
  reqs.length = 0;
  await call("Page.navigate", { url: BASE + "?prep=1&medigram=1&medigram_break=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  // Root cause of the all-red run: prep-loader.js fetches everything (PrepReels included) lazily inside
  // load(), which only runs on PREP.open() — the same lazy pattern the Play harness uses. Asserting the
  // fetch and the globals before opening could never pass. Open first, then assert.
  await evA(`window.PREP.open({})`);
  ok(await until(`return !!(window.PREP_MEDIGRAM && window.PREP_MG_DATA);`, 20000), "PREP_MEDIGRAM and PREP_MG_DATA loaded");
  ok(reqs.some((u) => /prep-medigram\.js/.test(u)), "prep-loader fetched prep-medigram.js with the flag on");
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=mg-open]');`, 20000), "home shows the PrepReels row");
  await click("#smdPrep [data-act=mg-open]");
  ok(await until(`return document.querySelectorAll('#smdPrep #pnMgFeed .vf-c').length > 5;`, 20000), "PrepReels opens on a reel built from the bank");
  const kinds = await ev(`var k={}; document.querySelectorAll('#smdPrep #pnMgFeed .vf-c').forEach(function(e){ k[e.classList.contains('vf-q')?'q':e.classList.contains('vf-pearl')?'pearl':e.classList.contains('pn-mg-vid')?'video':e.classList.contains('vf-img')?'img':e.classList.contains('vf-end')?'end':'lesson']=1; }); return Object.keys(k).sort().join(",");`);
  ok(/q/.test(kinds) && /video/.test(kinds) && /pearl/.test(kinds) && /end/.test(kinds), "the reel mixes formats (questions, pearls, videos, end card): " + kinds);
  ok(await ev(`return document.querySelector('#smdPrep #pnMgFeed .vf-c').classList.contains('vf-q');`) === true, "the first card is a question");
  ok(await ev(`return !/shown in the image/.test(document.querySelector('#pnMgFeed').textContent);`) === true, "questions that need a figure are left out");
  ok(await ev(`return !document.querySelector('#smdPrep .pn-mg-chip, #smdPrep [data-act=mg-next], #smdPrep [data-act=mg-skip]');`) === true, "no chip rows, Skip or Next before an answer: one card per swipe");
  const wide = await ev(`var o=[]; document.querySelectorAll("#smdPrep *").forEach(function(e){var r=e.getBoundingClientRect(); if(r.width && r.right>innerWidth+1) o.push(e.tagName+"."+String(e.className).slice(0,30)+":"+Math.round(r.right));}); return o.slice(0,4).join(" ");`);
  ok(wide === "", "nothing wider than the 390 px screen" + (wide ? ": " + wide : ""));
  const subj = await ev(`return document.querySelector('#smdPrep #pnMgFeed .vf-q .pn-eb').textContent;`);
  await click("#smdPrep #pnMgFeed .vf-c[data-i='0'] [data-act=mg-answer][data-k='0']");
  ok(await until(`return !!document.querySelector("#smdPrep #pnMgFeed .vf-c[data-i='0'] .vf-why");`, 8000), "answering shows the explanation in place");
  const top0 = await ev(`return document.querySelector('#pnMgFeed').scrollTop;`);
  await click("#smdPrep #pnMgFeed .vf-c[data-i='0'] [data-act=mg-next]");
  ok(await until(`return document.querySelector('#pnMgFeed').scrollTop > ${top0} + 100;`, 4000), "Next after an answer moves to the next card");
  await ev(`document.querySelector('#pnMgFeed').scrollTop=0; return 1;`);
  ok(await ev(`return /of 1 right/.test(document.querySelector("#smdPrep .pn-t p").textContent);`) === true, "the bar keeps score");
  ok(await ev(`var s=JSON.parse(localStorage.getItem("smd_prep_v1")||"{}"); return Object.keys(s.cards||{}).length > 0;`) === true, "the answer wrote an FSRS card row (" + subj + ")");
  // Video: scrolling a video card into view mounts the https shim (never a direct YouTube embed from the app origin).
  await ev(`var v=document.querySelector('#smdPrep .pn-mg-vid'), b=document.querySelector('#pnMgFeed'); b.scrollTop=v.offsetTop-b.offsetTop; return 1;`);
  ok(await until(`var f=document.querySelector('#smdPrep .pn-mg-vid iframe'); return !!f && /^https:\\/\\/stewardmd\\.in\\/_site\\/yt\\?v=[\\w-]{11}&autoplay=1$/.test(f.src);`, 8000), "a video card in view autoplays in the app through the stewardmd.in shim");
  const played = await ev(`return document.querySelector('#smdPrep .pn-mg-vid iframe').closest('.pn-mg-vid').getAttribute('data-vid');`);
  await sleep(6500);
  ok(await ev(`return !!document.querySelector('#smdPrep .pn-mg-vid iframe') && !document.querySelector('#smdPrep [data-act=mg-yt]');`) === true, "a shim that reports in keeps playing (no fallback)");
  // Our own controls: pause/play, seek, sound, full screen (YouTube's overlay hides itself on touch screens).
  const cardSel = "#smdPrep .pn-mg-vid.pn-mg-c:has(iframe)";
  const ctlOn = `var f=document.querySelector(${JSON.stringify(cardSel + " .pn-mg-frame")}); return !!f && f.classList.contains('ctl') && getComputedStyle(f.querySelector('.pn-mg-vctl')).pointerEvents === 'auto';`;
  ok(await until(`var f=document.querySelector(${JSON.stringify(cardSel + " .pn-mg-frame")}); return !!f && !f.classList.contains('ctl');`, 5000), "the glass controls fade out on their own (3 s)");
  ok(await ev(`var v=document.querySelector(${JSON.stringify(cardSel + " .pn-mg-vctl")}); var c=getComputedStyle(v); return !!v.closest('.pn-mg-frame') && /blur/.test(c.backdropFilter || c.webkitBackdropFilter || '');`) === true, "the controls sit on the video as blurred glass");
  await ev(`document.querySelector(${JSON.stringify(cardSel + " .pn-mg-frame")}).click(); return 1;`);
  ok(await until(ctlOn, 2000), "a tap on the video brings the controls back");
  ok(await ev(`var c=document.querySelector(${JSON.stringify(cardSel)}); return !!c && ["back","toggle","fwd","sound"].every(function(v){return !!c.querySelector('[data-act=mg-v][data-v='+v+']');}) && !!c.querySelector('[data-act=mg-fs]');`) === true, "the playing video has back, play/pause, forward, sound and full screen controls");
  await click(cardSel + " [data-act=mg-v][data-v=toggle]");
  ok(await until(`return document.querySelector(${JSON.stringify(cardSel + " [data-v=toggle]")}).getAttribute('aria-label') === 'Play';`, 4000), "Pause pauses (the button turns to Play)");
  await click(cardSel + " [data-act=mg-v][data-v=toggle]");
  ok(await until(`return document.querySelector(${JSON.stringify(cardSel + " [data-v=toggle]")}).getAttribute('aria-label') === 'Pause';`, 4000), "Play resumes");
  await click(cardSel + " [data-act=mg-v][data-v=sound]");
  ok(await until(`return document.querySelector(${JSON.stringify(cardSel + " [data-v=sound]")}).getAttribute('aria-label') === 'Unmute';`, 4000), "Sound mutes and unmutes");
  await click(cardSel + " [data-act=mg-fs]");
  ok(await until(`var c=document.querySelector('#smdPrep .pn-mg-fs'); if(!c) return false; var r=c.getBoundingClientRect(); return r.top<=1 && r.left<=1 && r.width>=innerWidth-1 && r.height>=innerHeight-1 && !!c.querySelector('iframe');`, 4000), "Full screen covers the whole screen and keeps the same player");
  ok(await ev(`var f=document.querySelector('#smdPrep .pn-mg-fs .pn-mg-frame').getBoundingClientRect(); return f.width<=innerWidth+1 && f.bottom<=innerHeight+1 && f.height>100;`) === true, "the full-screen video fits the screen");
  ok(await ev(`var e=document.elementFromPoint(innerWidth/2, 30); return !!(e && e.closest('.pn-mg-fs'));`) === true, "nothing (header, tabs) shows over the full-screen video");
  await evA(`window.PREP.back ? window.PREP.back() : history.back()`);
  ok(await until(`return !document.querySelector('#smdPrep .pn-mg-fs') && !!document.querySelector('#smdPrep #pnMgFeed') && !!document.querySelector('#smdPrep .pn-mg-vid iframe');`, 4000), "Back leaves full screen first, the video keeps playing in its card");
  await ev(`var b=document.querySelector('#pnMgFeed'); b.scrollTop=0; return 1;`);
  ok(await until(`return !document.querySelector('#smdPrep .pn-mg-vid iframe');`, 8000), "swiping away releases the player");
  ok(await ev(`return !document.querySelector('#smdPrep .pn-mg-vid img');`) === true, "the video poster is a background, so a tap can never open the image zoom viewer");
  await click("#smdPrep .pn-mg-vid [data-act=mg-play]");
  ok(await until(`return !!document.querySelector('#smdPrep .pn-mg-vid iframe');`, 4000), "tapping a video poster plays it in the card");
  await ev(`var b=document.querySelector("#pnMgFeed"); b.scrollTop=b.scrollHeight; return 1;`);
  ok(await until(`return !document.querySelector('#smdPrep .pn-mg-vid iframe');`, 4000), "and it stops once the reel settles on another card");
  // End card: Keep going appends a batch, Finish returns home.
  const n0 = await ev(`return document.querySelectorAll('#smdPrep #pnMgFeed .vf-c').length;`);
  await click("#smdPrep [data-act=mg-more]");
  ok(await until(`return document.querySelectorAll('#smdPrep #pnMgFeed .vf-c').length > ${n0};`, 15000), "Keep going adds more cards");
  ok(await ev(`return !!document.querySelector("#smdPrep #pnMgFeed .vf-c[data-i='0'] .vf-why");`) === true, "earlier answers survive the new batch");
  ok(await ev(`var k={}, d=0; PREP_MEDIGRAM._s().cards.forEach(function(c){ var x=c.kind+":"+(c.it?c.it.id||c.it.img:c.videoId||c.mid||c.text); if(k[x]) d++; k[x]=1; }); return d;`) === 0, "nothing repeats across batches");
  // A silent shim (offline, slow) never hands off to YouTube: the player stays in the card over the poster.
  shimSilent = true;
  await ev(`var v=[].filter.call(document.querySelectorAll('#smdPrep .pn-mg-vid'), function(e){ return e.getAttribute('data-vid') !== ${JSON.stringify(played)}; })[0]; var b=document.querySelector('#pnMgFeed'); b.scrollTop=v.offsetTop-b.offsetTop; return 1;`);
  ok(await until(`return !!document.querySelector('#smdPrep .pn-mg-vid iframe');`, 8000), "a second video mounts in the app");
  await sleep(7000);
  ok(await ev(`return !!document.querySelector('#smdPrep .pn-mg-vid iframe') && !/Play on YouTube/.test(document.querySelector('#pnMgFeed').textContent);`) === true, "a silent shim keeps the in-app player, no YouTube hand-off");
  shimSilent = false;
  await click("#smdPrep [data-act=mg-done]");
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=mg-open]');`, 8000), "Finish returns to the PrepNucleus home");
  // Smart Break: sub-flag on, 3-minute timer, return offers study (never locks)
  await click("#smdPrep [data-act=mg-open]");
  await until(`return !!document.querySelector('#smdPrep [data-act=mg-mode][data-v=break]');`, 8000);
  await click("#smdPrep [data-act=mg-mode][data-v=break]");
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=mg-break-start][data-v="3"]');`, 8000), "Break offers a 3-minute choice");
  await click("#smdPrep [data-act=mg-break-start][data-v='3']");
  ok(await until(`return /left|Break/.test(document.querySelector("#smdPrep .pn-mg-h").textContent);`, 8000), "break timer is running");
  await click("#smdPrep [data-act=mg-break-return]");
  ok(await until(`return !!document.querySelector('#smdPrep #pnMgFeed .vf-c');`, 15000), "Return to study goes back to the reel");
  ok(!errors.length, "no uncaught PrepReels error" + (errors.length ? ": " + errors[0] : ""));
  ok(!reqs.some((u) => /youtube-nocookie\.com|googleapis\.com\/youtube/.test(u)), "no direct YouTube embed or YouTube API request from the app");
  // Sound flag on: the first-party Sound path loads (PREP_SOUND defined) after open.
  reqs.length = 0;   // only this page's requests count for the spotify=0 check
  await call("Page.navigate", { url: BASE + "?prep=1&sound=1&spotify=0" });
  ok(await until(`return !!(window.PREP && window.SMD_showHome);`, 30000), "app boots with ?sound=1");
  await ev(clean);
  await ev(`try{localStorage.removeItem("smd_prep_sound_prefs");}catch(e){} return 1;`);
  await evA(`window.PREP.open({})`);
  ok(await until(`return !!window.PREP_SOUND;`, 20000), "Sound UI path loads when its flag is on");
  ok(reqs.some((u) => /prep-sound\.js/.test(u)), "prep-loader fetched prep-sound.js with ?sound=1");
  ok(!reqs.some((u) => /prep-sound-spotify/.test(u)), "spotify files stay unfetched while the spotify sub-flag is off");
  // Sound card (rs-sound-ui): Enable -> Providers and settings opens the sheet with a Play
  // control; Play starts the first-party ambience (WebAudio nodes, playing state).
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=s-enable]');`, 20000), "home shows the Sound section with Enable Sound");
  await click("#smdPrep [data-act=s-enable]");
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=s-open]');`, 8000), "Enable Sound reveals Providers and settings");
  await click("#smdPrep [data-act=s-open]");
  ok(await until(`return !!document.querySelector('.pn-sound-sheet [data-act=s-play]');`, 8000), "s-open shows the sheet with a Play control");
  ok(await ev(`return !!document.querySelector('.pn-sound-sheet [data-act=s-preset]');`) === true, "sheet lists the focus presets");
  ok(await ev(`return !!document.querySelector('.pn-sound-sheet [data-act=s-provider]') && !!document.querySelector('.pn-sound-sheet [data-act=s-disable]');`) === true, "sheet has the provider chooser and Turn off");
  await click(".pn-sound-sheet [data-act=s-play]");
  ok(await ev(`return !!(window.PREP_SOUND && window.PREP_SOUND.isPlaying());`) === true, "Play starts the first-party ambience (playing state)");
  ok(await ev(`return !!(window.PREP_SOUND_WEB && window.PREP_SOUND_WEB.supported() && window.PREP_SOUND_WEB.current());`) === true, "a live WebAudio track backs the playing state");
  await sleep(1500);
  ok(await ev(`var o=[]; document.querySelectorAll("#smdPrep *").forEach(function(e){var r=e.getBoundingClientRect(); if(r.width && r.right>innerWidth+1) o.push(1);}); return o.length;`) === 0, "after a 1500ms settle nothing in #smdPrep is wider than the 390 px screen");
  // Now Playing card (rs-player-ui): the same card renders ambience in the Sound
  // sheet — play shows pause, progress (elapsed) and the volume control present.
  ok(await ev(`return !!document.querySelector('.pn-sound-sheet .pn-player');`) === true, "Sound sheet shows the shared Now Playing card for ambience");
  ok(await ev(`return !!document.querySelector('.pn-sound-sheet .pn-player [data-player-act="toggle"][aria-label="Pause"]');`) === true, "ambience card shows Pause while playing (play shows pause)");
  ok(await ev(`return !!document.querySelector('.pn-sound-sheet .pn-player [data-player-volume]');`) === true, "ambience card shows its volume control");
  ok(await ev(`return !!document.querySelector('.pn-sound-sheet .pn-player [data-player-elapsed]');`) === true, "ambience card shows progress (elapsed time)");
  await click(".pn-sound-sheet .pn-player [data-player-act=toggle]");
  ok(await ev(`return window.PREP_SOUND.isPlaying();`) === false, "ambience card Pause stops the ambience");
  // All flags off: explicit =0 beats the seeded localStorage, so the loader must fetch no medigram file
  // and the home must show no PrepReels row. reqs is reset so this sweep only sees the flags-off page.
  await ev(`try{localStorage.setItem("smd_prep_medigram","0"); localStorage.setItem("smd_prep_sound","0"); localStorage.setItem("smd_prep_sound_spotify","0");}catch(e){} return 1;`);
  reqs.length = 0;
  await call("Page.navigate", { url: BASE + "?prep=1&medigram=0&sound=0&spotify=0" });
  ok(await until(`return !!(window.PREP && window.SMD_showHome);`, 30000), "app boots with all flags off");
  await ev(clean);
  await evA(`window.PREP.open({})`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-home");`, 20000), "home renders with all flags off");
  ok(!reqs.some((u) => /prep-medigram/.test(u)), "with all flags off prep-loader fetches none of the medigram files");
  ok(await ev(`return !document.querySelector('#smdPrep [data-act=mg-open]');`) === true, "with all flags off no PrepReels row shows");
  ok(!reqs.some((u) => /prep-sound/.test(u)), "with all flags off prep-loader fetches none of the sound files");
  // Owner 2026-10-31: Spotify is ON by default with no flag or link (only an explicit "0" turns it off).
  await ev(`try{localStorage.removeItem("smd_prep_sound_spotify");}catch(e){} return 1;`);
  reqs.length = 0;
  await call("Page.navigate", { url: BASE + "?prep=1&medigram=0&sound=0" });
  await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  await evA(`window.PREP.open({})`);
  ok(await until(`return !!window.PREP_LOADER && performance.getEntriesByType("resource").some(function(e){return /prep-sound-spotify\\.js/.test(e.name);});`, 20000) || reqs.some((u) => /prep-sound-spotify\.js/.test(u)), "Spotify loads by default with no flag (Sound off)");
  ok(await ev(`return !document.querySelector('#smdPrep [data-act=s-enable]') && !document.querySelector('#smdPrep [data-act=s-open]');`) === true, "with all flags off no Sound section shows");
  ok(!errors.length, "no uncaught error after the flag sweeps" + (errors.length ? ": " + errors[0] : ""));
} catch (e) { console.log("FAIL harness: " + (e && e.message || e)); fails++; }
finally { try { chrome.kill(); } catch {} if (serveProc) try { serveProc.kill(); } catch {} }
console.log(fails ? `MEDIGRAM UI: ${fails} FAIL` : "MEDIGRAM UI: ALL PASS");
process.exit(fails ? 1 : 0);
