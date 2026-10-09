/* PrepNucleus interactive lessons in the REAL app (headless Chrome over CDP), on a synthetic fixture
 * (test/fixtures/prep-lx/api: drawn shapes, no real figure or text).
 * What must hold: an index entry with "r": 2 opens v2/lessons/<key>.json (not the v1 copy) and keeps progress under its
 * key; opening fetches every figure of the lesson (both images of a compare too) and keeps the file in IndexedDB, so it
 * opens again offline; spot the sign: a tap off the finding leaves a miss ring and "Not there", a tap on it lights the
 * box and its label (real mouse events at image coordinates); labelled figure: a number names its point, "Show all"
 * names every one; compare: two same-shape images get a slider that follows a drag, a key press and the Show buttons,
 * two different shapes sit side by side and enlarge one by one; quick check: one tap answers, marks right and wrong and
 * explains; a malformed quick check is dropped without costing the lesson; the classic signs deck turns cards; key
 * points show the score; the finish adds 5 XP a right answer; an old-format lesson still reads as before; nothing is
 * wider than the screen; no uncaught PrepNucleus error.
 *
 * USAGE: node test/run-prep-lessons-ix-ui.mjs   (CHROME=<path>; SHOTS=<dir> saves screenshots; PN_LIGHT=1 light;
 *        W=390|820|1180 viewport width, default 390)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-lx-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep-lx/";
const MID = "rad-chest", KEY = "radbook-fx-ix", PLAIN = "radbook-fx-plain";
const W = +(process.env.W || 390), H = W === 390 ? 844 : W === 820 ? 1180 : 820;

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const evA = async (e) => { const r = await call("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const theme = process.env.PN_LIGHT ? "light" : "dark";
const shot = async (name) => {
  if (!process.env.SHOTS) return;
  await sleep(450);
  await ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`);
  const r = await call("Page.captureScreenshot", { format: "png" });
  if (r.result) fs.writeFileSync(join(process.env.SHOTS, `lx-${W}-${theme}-${name}.png`), Buffer.from(r.result.data, "base64"));
};
const bar = () => ev(`var p=document.querySelector("#smdPrep .pn-t p"); return p ? p.textContent : "";`);
const store = (expr) => ev(`var s=JSON.parse(localStorage.getItem("smd_prep_v1")); return ${expr};`);
// a real pointer click at (fx, fy) of the element's box (0..1), after scrolling it into view
async function tapAt(sel, fx, fy) {
  const r = JSON.parse(await ev(`var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return "null"; e.scrollIntoView({block:"center"}); var b=e.getBoundingClientRect(); return JSON.stringify({x:b.left,y:b.top,w:b.width,h:b.height});`) || "null");
  if (!r) return false;
  await sleep(80);
  const r2 = JSON.parse(await ev(`var b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return JSON.stringify({x:b.left,y:b.top,w:b.width,h:b.height});`));
  const x = r2.x + r2.w * fx, y = r2.y + r2.h * fy;
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  return true;
}
async function dragX(sel, f0, f1) {
  await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:"center"}); return 1;`);
  await sleep(150); await until(`return document.getAnimations().every(function (a) { var t = a.effect && a.effect.getTiming(); return a.playState !== "running" || (t && t.iterations === Infinity); });`, 2000);
  const r = JSON.parse(await ev(`var b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return JSON.stringify({x:b.left,y:b.top,w:b.width,h:b.height});`));
  const y = r.y + r.h / 2, steps = 8;
  if (process.env.DBG) console.log("rect", JSON.stringify(r), await ev(`return innerWidth + " " + visualViewport.scale + " " + visualViewport.width;`));
  await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x + r.w * f0, y }] });
  for (let k = 1; k <= steps; k++) await call("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: r.x + r.w * (f0 + (f1 - f0) * k / steps), y }] });
  await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const overflow = () => ev(`var o=[]; document.querySelectorAll("#smdPrep *").forEach(function(e){ if (e.closest(".pn-vtbl,.pn-mk-l,.pn-sr")) return; var r=e.getBoundingClientRect(); if(r.width && r.right>innerWidth+1) o.push(e.className||e.tagName); }); return o.slice(0,5).join("|");`);

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url);
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: W < 1000 });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_SETUP=false; window.SMD_PREP_FLAG_API="/test/fixtures/prep/hidden.json"; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  reqs.length = 0;
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  if (process.env.PN_LIGHT) await ev(`document.body.classList.remove("dark"); return 1;`); else await ev(`document.body.classList.add("dark"); return 1;`);

  // ---- module: both lessons listed; the interactive one opens from v2
  await ev(`PREP.open({ subject: "radiology" }); return 1;`);
  ok(await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=${MID}]');`, 20000), "Radiology lists the chest module");
  await click(`#smdPrep .pn-mod[data-m=${MID}]`);
  ok(await until(`return !!document.querySelector('#smdPrep [data-l="${KEY}"]') && !!document.querySelector('#smdPrep [data-l="${PLAIN}"]');`, 8000), "the module lists the interactive and the plain lesson");
  ok(await ev(`return !!document.querySelector('link[data-prep="prep-lx.css"]');`) === true, "prep-loader.js adds prep-lx.css");
  await click(`#smdPrep [data-l="${KEY}"]`);
  ok(await until(`return /Step 1 of 7/.test((document.querySelector("#smdPrep .pn-t p")||{}).textContent||"");`, 8000), "the lesson opens: 5 steps + signs deck + key points = 7 pages (" + await bar() + ")");
  ok(reqs.some((u) => u.includes(FIX + "api/v2/lessons/" + KEY + ".json")) && !reqs.some((u) => u.includes(FIX + "api/v1/lessons/" + KEY + ".json")), "an index entry with r 2 loads v2/lessons/<key>.json, never the v1 copy");
  ok(/interactive chest/.test(await ev(`return document.querySelector("#smdPrep .pn-t h1, #smdPrep .pn-t b, #smdPrep .pn-t").textContent;`)), "the v2 file's title shows");
  { const t0 = Date.now(); const want = ["rb-fx-ix-a.webp", "rb-fx-ix-b.webp", "rb-fx-ix-c.webp"]; while (Date.now() - t0 < 5000 && !want.every((f) => reqs.some((u) => u.includes(FIX + "api/v1/lessons/media/" + f)))) await sleep(120);
    ok(want.every((f) => reqs.some((u) => u.includes(FIX + "api/v1/lessons/media/" + f))), "opening fetches every figure at once, the compare images included (offline after one open)"); }
  ok(await ev(`var i=document.querySelectorAll("#smdPrep .pn-lsn-prog i"); return i.length===7 && document.querySelectorAll("#smdPrep .pn-lsn-prog i.ix").length===6;`) === true, "progress: 7 segments, interactive pages marked (4 steps + deck + key points)");

  // ---- spot the sign
  ok(await until(`var i=document.querySelector("#smdPrep .pn-spot img"); return !!i && i.complete && i.naturalWidth>0;`, 6000), "spot: the figure loads");
  ok(await ev(`var i=document.querySelector("#smdPrep .pn-spot img"); return i.getAttribute("width")==="800" && i.getAttribute("height")==="1000";`) === true, "the figure reserves its shape (width and height from ar)");
  ok(await ev(`return getComputedStyle(document.querySelector("#smdPrep .pn-spot-box")).opacity === "0" && /Tap the image/.test(document.querySelector("#smdPrep .pn-spot .pn-ix-fb").textContent);`) === true, "spot: the answer box is hidden until answered; a hint says to tap");
  await shot("1-spot");
  await tapAt("#smdPrep .pn-spot .pn-ix-stage img", 0.12, 0.85);
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-spot-miss").length===1 && /Not there/.test(document.querySelector("#smdPrep .pn-spot .pn-ix-fb").textContent) && !document.querySelector("#smdPrep .pn-spot.done");`, 3000), "spot: a tap off the finding leaves a miss ring and says Not there");
  await tapAt("#smdPrep .pn-spot .pn-ix-stage img", 0.68, 0.38);
  ok(await until(`var f=document.querySelector("#smdPrep .pn-spot"); return f.classList.contains("done") && f.classList.contains("hit") && /Found it/.test(f.querySelector(".pn-ix-fb").textContent) && /Bright blob/.test(f.textContent);`, 3000), "spot: a tap on the finding lights the box and names it");
  ok(await until(`return getComputedStyle(document.querySelector("#smdPrep .pn-spot-box")).opacity === "1";`, 2000), "spot: the box shows once found");
  ok(await ev(`return !!document.querySelector("#smdPrep .pn-spot img") && document.querySelector("#smdPrep .pn-spot img").complete;`) === true, "spot: the figure is not redrawn by a tap");
  const sw1 = await overflow(); ok(sw1 === "", "spot: nothing wider than the screen" + (sw1 ? ": " + sw1 : ""));
  await shot("2-spot-found");

  // ---- labelled figure + true/false quick check
  await click("#smdPrep [data-act=l-next]");
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-reveal .pn-mk").length===3;`, 4000), "reveal: 3 numbered points");
  ok(await ev(`return document.querySelectorAll("#smdPrep .pn-mk.on").length===0;`) === true, "reveal: labels start hidden");
  await click(`#smdPrep .pn-mk[data-k="0"]`);
  ok(await ev(`var b=document.querySelector('#smdPrep .pn-mk[data-k="0"]'); return b.classList.contains("on") && b.getAttribute("aria-expanded")==="true" && /Lower blob/.test(document.querySelector("#smdPrep .pn-mk-key li").textContent) && document.querySelectorAll("#smdPrep .pn-mk.on").length===1;`) === true, "reveal: a number names its point (and the key below lists it)");
  await click("#smdPrep [data-act=l-marks]");
  ok(await ev(`return document.querySelectorAll("#smdPrep .pn-mk.on").length===3 && document.querySelector("#smdPrep [data-act=l-marks]").getAttribute("aria-pressed")==="true";`) === true, "reveal: Show all names every point");
  ok(await ev(`var q=document.querySelectorAll("#smdPrep .pn-qc-o.tf .pn-qc-b"); return q.length===2 && q[0].textContent==="True";`) === true, "quick check: true or false shows as two buttons");
  await shot("3-reveal");
  await click(`#smdPrep .pn-qc [data-k="1"]`);
  ok(await until(`var s=document.querySelector("#smdPrep .pn-qc"); return s.classList.contains("done") && s.querySelector('[data-k="1"]').classList.contains("bad") && s.querySelector('[data-k="0"]').classList.contains("ok") && /Not quite/.test(s.textContent) && /drawn outline/.test(s.textContent);`, 3000), "quick check: a wrong pick is marked, the right one lit, the reason shown");
  await click(`#smdPrep .pn-qc [data-k="0"]`);
  ok(await ev(`return document.querySelector('#smdPrep .pn-qc [data-k="1"]').classList.contains("bad");`) === true, "quick check: the first answer stands");
  ok(await ev(`return document.activeElement && document.activeElement.getAttribute("data-k")==="1";`) === true, "quick check: focus stays on the picked option");
  await shot("4-quickcheck");

  // ---- compare: slider
  await click("#smdPrep [data-act=l-next]");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-pair.sl .pn-cmp-sl");`, 4000), "compare: two same-shape images get a slider");
  const pos = () => ev(`return document.querySelector("#smdPrep .pn-cmp-sl").style.getPropertyValue("--pos");`);
  ok(await pos() === "50%", "compare: the slider starts half way");
  await ev(`window.__pe=[]; var st=document.querySelector("#smdPrep .pn-cmp-sl"); ["pointerdown","pointermove","pointerup","pointercancel"].forEach(function(t){ st.addEventListener(t,function(e){ var r=st.getBoundingClientRect(); window.__pe.push(t[7]+Math.round((e.clientX-r.left)/r.width*100)); }); }); return 1;`);
  await dragX("#smdPrep .pn-cmp-sl", 0.5, 0.2);
  if (process.env.DBG) console.log(await ev(`return window.__pe.join(" ");`));
  const p1 = parseInt(await pos(), 10);
  ok(p1 >= 15 && p1 <= 26, "compare: a drag moves the slider with the finger (" + p1 + "%)");
  await click(`#smdPrep [data-act=l-cmp][data-v="0"]`);
  ok(await ev(`return document.querySelector("#smdPrep .pn-cmp-sl").style.getPropertyValue("--pos")==="0%" && document.querySelector('#smdPrep [data-act=l-cmp][data-v="0"]').getAttribute("aria-pressed")==="true";`) === true, "compare: the Show buttons move it without dragging");
  await ev(`var r=document.querySelector("#smdPrep .pn-cmp-r"); r.focus(); return 1;`);
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  ok(await until(`return document.querySelector("#smdPrep .pn-cmp-sl").style.getPropertyValue("--pos")==="1%";`, 2000) && /Step 3 of 7/.test(await bar()), "compare: arrow keys move the slider (and do not turn the page)");
  await click(`#smdPrep [data-act=l-cmp][data-v="50"]`);
  await click(`#smdPrep .pn-qc [data-k="0"]`);
  ok(await until(`return /Right\\./.test(document.querySelector("#smdPrep .pn-qc").textContent);`, 2000), "quick check: a right answer says Right");
  await shot("5-slider");

  // ---- compare: side by side, enlarge one; the broken quick check is gone
  await click("#smdPrep [data-act=l-next]");
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-cmp2 .pn-cmp-cell").length===2;`, 4000), "compare: different shapes sit side by side");
  ok(await ev(`return !document.querySelector("#smdPrep .pn-qc");`) === true, "a malformed quick check is dropped, the step still shows");
  await shot("6-side");
  await click(`#smdPrep .pn-cmp-cell[data-z="b"]`);
  ok(await until(`var v=document.querySelector(".pv"); var z=v && v.querySelector("img"); return !!window.PREP_VIEWER && PREP_VIEWER.isOpen() && !!z && /rb-fx-ix-c\\.webp$/.test(z.getAttribute("src"));`, 3000), "compare: the second image opens on its own in the shared viewer (prep-viewer.js)");
  await ev(`PREP_VIEWER.close(); return 1;`);
  ok(await until(`return !PREP_VIEWER.isOpen() && document.activeElement && document.activeElement.getAttribute("data-z")==="b";`, 3000), "closing the viewer returns focus to the cell that opened it");
  // ---- table step, then the classic signs deck
  await click("#smdPrep [data-act=l-next]");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-vtbl");`, 3000), "a table step reads as before");
  await click("#smdPrep [data-act=l-next]");
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-flip").length===3 && /Page 6 of 7/.test(document.querySelector("#smdPrep .pn-t p").textContent);`, 3000), "the classic signs deck: 3 cards on page 6");
  await click(`#smdPrep .pn-flip[data-k="0"]`);
  ok(await ev(`var b=document.querySelector('#smdPrep .pn-flip[data-k="0"]'); return b.classList.contains("on") && b.getAttribute("aria-pressed")==="true" && /dense round shadow/.test(b.getAttribute("aria-label"));`) === true, "a tap turns a card; its label reads the meaning");
  await sleep(500);
  const sw2 = await overflow(); ok(sw2 === "", "deck: nothing wider than the screen" + (sw2 ? ": " + sw2 : ""));
  await shot("7-cards");

  // ---- key points with the score, then the finish
  await click("#smdPrep [data-act=l-next]");
  ok(await until(`return document.querySelectorAll("#smdPrep .pn-keys li").length===3 && /2 of 3 right/.test(document.querySelector("#smdPrep .pn-lsn-sc").textContent);`, 3000), "key points: 3 points and the score (2 of 3 right)");
  ok(await ev(`return document.querySelectorAll("#smdPrep .pn-keys b").length===1 && /Finish/.test(document.querySelector("#smdPrep [data-act=l-next]").textContent);`) === true, "key terms bold; the last page offers Finish");
  await shot("8-keys");
  await click("#smdPrep [data-act=l-next]");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-lsn-fin");`, 3000), "Finish shows the finish screen");
  ok(/\+60/.test(await ev(`return document.querySelector("#smdPrep .pn-lsn-xp").textContent;`)) && /2 of 3 answers right/.test(await ev(`return document.querySelector("#smdPrep .pn-lsn-fin").textContent;`)), "the finish: 5 steps x 10 XP + 2 right x 5 = +60, and the score line");
  ok(await store(`s.ls["${KEY}"].done > 0 && s.ls["${KEY}"].xp === 60 && s.ls["${KEY}"].n === 7`) === true, "progress and XP kept under the lesson key");
  await shot("9-finish");

  // ---- an old-format lesson reads as before
  await ev(`PREP.back(); return 1;`); await sleep(300);
  await until(`return !!document.querySelector('#smdPrep [data-l="${PLAIN}"]');`, 4000);
  await click(`#smdPrep [data-l="${PLAIN}"]`);
  ok(await until(`return /Step 1 of 4/.test((document.querySelector("#smdPrep .pn-t p")||{}).textContent||"");`, 6000), "an old-format lesson opens: Step 1 of 4");
  await click("#smdPrep [data-act=l-next]");
  ok(await until(`var i=document.querySelector("#smdPrep .pn-vfig .pn-vimg img"); return !!i && i.complete && i.naturalWidth>0 && !document.querySelector("#smdPrep .pn-ix");`, 4000), "its figure is the plain tap-to-enlarge figure, no interactive part");
  ok(await ev(`return document.querySelectorAll("#smdPrep .pn-lsn-prog i").length===4 && !document.querySelector("#smdPrep .pn-lsn-prog i.ix");`) === true, "its progress has 4 plain segments");

  // ---- offline: the lesson comes back from IndexedDB, its figures from the cache
  const cached = await evA(`PREP._host.cacheGet("v2/lessons/${KEY}.json").then(function (f) { return !!f && f.steps.length === 5 && !!f.cards; }, function () { return false; })`);
  ok(cached === true, "the v2 lesson is kept in IndexedDB under v2/lessons/<key>.json");
  // a fresh page (no in-memory images), then offline: the lesson, its index and its figures come from the caches
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  await ev(`PREP.open({ subject: "radiology" }); return 1;`);
  await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=${MID}]');`, 20000);
  await call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await click(`#smdPrep .pn-mod[data-m=${MID}]`);
  await until(`return !!document.querySelector('#smdPrep [data-l="${KEY}"]');`, 8000);
  await click(`#smdPrep [data-l="${KEY}"]`);
  ok(await until(`return /Step 1 of 7/.test((document.querySelector("#smdPrep .pn-t p")||{}).textContent||"") && !!document.querySelector("#smdPrep .pn-spot");`, 8000), "offline: the interactive lesson opens again from IndexedDB");
  ok(await until(`var i=document.querySelector("#smdPrep .pn-spot img"); return !!i && i.complete && i.naturalWidth>0;`, 6000), "offline: its figure still shows (fetched when the lesson first opened)");
  await call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await ev(`PREP.close(); return 1;`);
  ok(!reqs.some((u) => /\/api\/(ai|prep\/bank)\//.test(u) && !u.includes(FIX)), "no request to /api/ai or the live bank");
  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ").slice(0, 400) : ""));
} catch (e) {
  console.log("FAIL harness: " + (e && e.stack || e)); fails++;
} finally {
  try { chrome.kill("SIGKILL"); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
