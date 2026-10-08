/* PrepNucleus Radiology (NEET-SS) image questions and scroll stacks in the REAL app (headless Chrome over CDP), against
 * the made-up fixture in test/fixtures/prep-rad/ (synthetic test-pattern WebP images and a 12-slice, 2-window stack).
 * What must hold: the NEET-SS tab lists Radiology; its module (bank version v6 from the taxonomy bv, while the rest of
 * the bank stays on v1) practises; the image item shows its image from the v6 path; the stack item shows the viewer at
 * the middle slice; wheel, vertical drag and keys each move the slice; the window switch swaps the slice folder; Enlarge
 * opens a full-screen series that back() closes first; a horizontal drag on the stack does not change the question;
 * answering shows the explanation; nothing is wider than the screen; no request reaches the live bank or /api/ai; no
 * uncaught PrepNucleus error.
 *
 * USAGE: node test/run-prep-rad-ui.mjs   (CHROME=<path>; SHOTS=<dir> saves phone 390x844 and iPad 820x1180 screenshots,
 *        PN_LIGHT=1 in light; REAL=<dir> runs on a real pilot output dir holding v6/ss-radiology/{index.json,mcq,img,stack},
 *        e.g. REAL=~/prep-data/rad/out, with the app's own prep/taxonomy.json)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..");
const LOADER_V = fs.readFileSync(join(ROOT, "prep-loader.js"), "utf8").match(/var V = "([^"]+)"/)[1];
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-rad-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const SID = "ss-radiology";

// Fixture root (served from the repo). REAL: a throwaway dir under test/fixtures with the app taxonomy, the real index and
// an api symlink to the real output, removed at the end.
let FIX = "/test/fixtures/prep-rad/", realDir = null, MID = "srd-neuro-tumour";
if (process.env.REAL) {
  const src = resolve(process.env.REAL.replace(/^~/, process.env.HOME));
  realDir = join(HERE, "fixtures", ".rad-real-" + process.pid);
  fs.mkdirSync(join(realDir, "bank/v6", SID), { recursive: true });
  fs.copyFileSync(join(ROOT, "prep/taxonomy.json"), join(realDir, "taxonomy.json"));
  fs.copyFileSync(join(src, "v6", SID, "index.json"), join(realDir, "bank/v6", SID, "index.json"));
  fs.writeFileSync(join(realDir, "hidden.json"), '{"ids":[]}');
  fs.symlinkSync(src, join(realDir, "api"));
  FIX = "/test/fixtures/" + ".rad-real-" + process.pid + "/";
  // the module with a stack (and an image if one has both)
  const mods = fs.readdirSync(join(src, "v6", SID, "mcq")).map((f) => ({ id: f.replace(/\.json$/, ""), items: JSON.parse(fs.readFileSync(join(src, "v6", SID, "mcq", f), "utf8")).items || [] }));
  const score = (m) => (m.items.some((i) => i.stack) ? 2 : 0) + (m.items.some((i) => i.img) ? 1 : 0);
  mods.sort((a, b) => score(b) - score(a));
  MID = process.env.MODULE || mods[0].id;
}
const REAL = !!realDir;

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8995"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const shotCall = async (p) => { await ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`); return call("Page.captureScreenshot", p); };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const text = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g," ").trim() : "";`);
let dev = "phone";
const shot = async (name) => {
  if (!process.env.SHOTS) return;
  fs.mkdirSync(process.env.SHOTS, { recursive: true });
  await sleep(350);
  const r = await shotCall({ format: "png" });
  if (r.result) fs.writeFileSync(join(process.env.SHOTS, "rad-" + dev + "-" + (process.env.PN_LIGHT ? "light-" : "dark-") + name + ".png"), Buffer.from(r.result.data, "base64"));
};
const overflow = () => ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); var o=[]; document.querySelectorAll("#smdPrep *").forEach(function(e){ var r=e.getBoundingClientRect(); if(r.width && r.right>innerWidth+1 && !e.closest(".pn-filters,.pn-tabs,.pn-zoom-sc,.pn-stack-z")) o.push(e.className||e.tagName); }); return o.slice(0,5).join("|");`);
const sliceK = () => ev(`var s=document.querySelector("#smdPrep .pn-stack"); return s ? +s.getAttribute("data-k") : -1;`);
// Synthetic input through CDP (real pointer events): mouse wheel and a touch drag on the stage.
const stageBox = () => ev(`var r=document.querySelector("#smdPrep .pn-stack .pn-stack-st").getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2, r.height];`);
async function touchDrag(x0, y0, x1, y1, steps = 8) {
  await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) await call("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }] });
  await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
// Practice until the item matching `test` (an expression over window.__it) is on screen.
async function toItem(cond, max = 60) {
  for (let i = 0; i < max; i++) {
    const hit = await ev(`var q=document.querySelector("#smdPrep .pn-q"); if(!q) return false; return ${cond};`);
    if (hit === true) return true;
    if (await ev(`return !!document.querySelector("#smdPrep [data-act=donerun]");`) === true) return false;
    const answered = await ev(`return !!document.querySelector("#smdPrep .pn-fb");`);
    if (!answered) await click(`#smdPrep [data-act=answer][data-k="0"]`);
    await click("#smdPrep [data-act=next]");
    await sleep(150);
  }
  return false;
}

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
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_SETUP=false; window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  reqs.length = 0;
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  if (process.env.PN_LIGHT) await ev(`if (!document.getElementById("pnNoTr")) { var t = document.createElement("style"); t.id = "pnNoTr"; t.textContent = "*{transition:none!important}"; document.head.appendChild(t); } document.body.classList.remove("dark"); return 1;`); else await ev(`document.body.classList.add("dark"); return 1;`);

  // ---- NEET-SS tab -> Radiology -> module
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=exam][data-v=neet-ss]");`, 20000), "PrepNucleus opens with exam tabs");
  ok(await ev(`return !!window.PREP_RAD;`) === true, "prep-loader.js loads prep-rad.js");
  await click(`#smdPrep [data-act=exam][data-v=neet-ss]`);
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=subject][data-s="${SID}"]');`, 8000), "the NEET-SS tab lists Radiology");
  await shot("home");
  await click(`#smdPrep [data-act=subject][data-s="${SID}"]`);
  ok(await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m="${MID}"]');`, 8000), "Radiology lists the module " + MID);
  await shot("subject");
  await click(`#smdPrep .pn-mod[data-m="${MID}"]`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=start][data-k=study]");`, 8000), "the module panel offers practice");
  await click(`#smdPrep [data-act=start][data-k=study]`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q");`, 8000), "practice starts");
  ok(reqs.some((u) => u.includes(FIX + "api/v6/" + SID + "/mcq/" + MID + ".json")), "the module file comes from the subject's own bank version (v6)");
  ok(reqs.some((u) => u.includes(FIX + "bank/v6/" + SID + "/index.json")), "the subject index comes from v6");

  // ---- image item
  const hasImg = REAL ? await ev(`return true;`) : true;
  if (hasImg && await toItem(`!!document.querySelector("#smdPrep .pn-yq-fig img")`, 40)) {
    ok(await until(`var i=document.querySelector("#smdPrep .pn-yq-fig img"); return !!(i && i.complete && i.naturalWidth > 0);`, 8000), "an image question shows its image (loaded)");
    ok(await ev(`return /\\/api\\/v6\\/ss-radiology\\/img\\/[a-z0-9-]+\\.webp$/.test(document.querySelector("#smdPrep .pn-yq-fig img").src);`) === true, "the image comes from the v6 radiology path: " + await ev(`return document.querySelector("#smdPrep .pn-yq-fig img").src;`));
    { const of = await overflow(); ok(of === "", "image question fits the screen" + (of ? ": " + of : "")); }
    await shot("image");
    await click("#smdPrep [data-act=y-zoom]");
    ok(await until(`return !!document.querySelector("#smdPrep #pnYqZoom img");`, 2000), "tapping the image enlarges it from the same path");
    await ev(`PREP.back(); return 1;`);
    ok(await ev(`return !document.querySelector("#smdPrep #pnYqZoom") && !!document.querySelector("#smdPrep .pn-q");`) === true, "back() closes the enlarged image first");
  } else if (!REAL) ok(false, "the image question was not reached");

  // ---- stack item (start a fresh set so it is reachable whatever the order)
  if (!(await toItem(`!!document.querySelector("#smdPrep .pn-stack")`, 60))) {
    await ev(`PREP.back(); return 1;`); await until(`return !!document.querySelector("#smdPrep [data-act=start][data-k=study]");`, 4000);
    await click(`#smdPrep [data-act=start][data-k=study]`); await until(`return !!document.querySelector("#smdPrep .pn-q");`, 6000);
  }
  ok(await toItem(`!!document.querySelector("#smdPrep .pn-stack")`, 60), "a stack question shows the image series");
  const n = await ev(`return +document.querySelector("#smdPrep .pn-stack").getAttribute("data-n");`);
  ok(await sliceK() === Math.floor((n - 1) / 2), "the series starts at the middle slice (" + (await sliceK()) + " of " + n + ")");
  ok(await until(`var i=document.querySelector("#smdPrep .pn-stack-im"); return !!(i && i.complete && i.naturalWidth > 0);`, 8000), "the slice image loads");
  ok(await until(`var b=document.querySelector("#smdPrep .pn-stack-ld"); return !!(b && b.classList.contains("done"));`, 15000), "every slice of the window preloads (the load bar finishes)");
  ok(await ev(`var c=document.querySelector("#smdPrep .pn-stack-st"); return c.tabIndex===0 && /slice \\d+ of \\d+/.test(c.getAttribute("aria-label"));`) === true, "the stage is focusable and names the slice");
  ok(await ev(`var r=document.querySelector("#smdPrep .pn-stack-rg"); return r && r.getAttribute("max")==String(${n}-1) && /Slice \\d+ of/.test(r.getAttribute("aria-valuetext"));`) === true, "the scrubber spans the stack and speaks the slice");
  ok(await ev(`var z=parseFloat(document.documentElement.style.zoom||"1")||1; return Array.from(document.querySelectorAll("#smdPrep .pn-stack button")).every(function(b){var r=b.getBoundingClientRect(); return r.height>=44*z-1 && r.width>=44*z-1;});`) === true, "stack controls are 44 px targets (at the app's display zoom)");
  ok(await overflow() === "", "stack question fits the screen");
  await shot("stack");

  // wheel
  const [cx, cy, h] = await stageBox();
  let k0 = await sliceK();
  await call("Input.dispatchMouseEvent", { type: "mouseWheel", x: cx, y: cy, deltaX: 0, deltaY: 240 });
  ok(await until(`return +document.querySelector("#smdPrep .pn-stack").getAttribute("data-k") > ${k0};`, 2000) && !!(await ev(`return document.querySelector("#smdPrep .pn-run") && 1;`)), "the wheel moves forward through the slices (" + k0 + " -> " + await sliceK() + ")");
  // vertical drag (touch)
  k0 = await sliceK();
  await touchDrag(cx, cy, cx, cy - h * 0.35);
  const k1 = await sliceK();
  ok(k1 < k0, "a drag up moves back through the slices (" + k0 + " -> " + k1 + ")");
  // horizontal drag on the stage is not a question swipe
  const q0 = await text("#smdPrep .pn-q");
  await touchDrag(cx + 100, cy, cx - 120, cy + 2, 10);
  ok(await text("#smdPrep .pn-q") === q0, "a horizontal drag on the series does not change the question");
  // keys
  await ev(`document.querySelector("#smdPrep .pn-stack-st").focus(); return 1;`);
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "End", code: "End", windowsVirtualKeyCode: 35 });
  ok(await sliceK() === n - 1, "End goes to the last slice");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 });
  ok(await sliceK() === n - 2, "ArrowUp moves one slice back");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Home", code: "Home", windowsVirtualKeyCode: 36 });
  ok(await sliceK() === 0 && /\/000\.webp$/.test(await ev(`return document.querySelector("#smdPrep .pn-stack-im").src;`)), "Home goes to slice 000");
  ok(await ev(`return !document.querySelector("#smdPrep .pn-fb");`) === true, "keys on the series never answer the question");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 });
  const kp = await sliceK();
  ok(kp > 1, "PageDown jumps a tenth of the stack (" + kp + ")");
  // window switch
  const wins = await ev(`return document.querySelectorAll("#smdPrep .pn-stack-wb").length;`);
  if (wins > 1) {
    const w0 = await ev(`return document.querySelector("#smdPrep .pn-stack-im").src.split("/").slice(-2)[0];`);
    await click(`#smdPrep .pn-stack-wb[data-v="1"]`);
    const w1 = await ev(`return document.querySelector("#smdPrep .pn-stack-im").src.split("/").slice(-2)[0];`);
    ok(w1 !== w0 && await sliceK() === kp && await ev(`return document.querySelector('#smdPrep .pn-stack-wb[data-v="1"]').getAttribute("aria-pressed");`) === "true", "the window switch swaps the slice folder at the same slice (" + w0 + " -> " + w1 + ")");
    await shot("stack-window");
  } else if (!REAL) ok(false, "the fixture stack has two windows");
  // cine
  await click(`#smdPrep .pn-stack [data-act=rd-play]`);
  const kc = await sliceK(); await sleep(600);
  ok(await sliceK() !== kc && await ev(`return document.querySelector("#smdPrep .pn-stack [data-act=rd-play]").getAttribute("aria-pressed");`) === "true", "Play loops through the slices");
  await click(`#smdPrep .pn-stack [data-act=rd-play]`);
  const ks = await sliceK(); await sleep(400);
  ok(await sliceK() === ks, "Pause stops the loop");
  // enlarge
  await click(`#smdPrep [data-act=rd-zoom]`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-stack-ov[role=dialog] .pn-stack-im");`, 2000), "Enlarge opens the full-screen series");
  ok(await ev(`return document.activeElement && document.activeElement.getAttribute("data-act")==="rd-unzoom";`) === true, "focus moves to Close");
  ok(await ev(`return +document.querySelector("#smdPrep .pn-stack-ov").getAttribute("data-k");`) === ks, "the enlarged series opens at the same slice");
  await shot("stack-enlarged");
  const [ox, oy, oh] = await ev(`var r=document.querySelector("#smdPrep .pn-stack-ov .pn-stack-st").getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2, r.height];`);
  await touchDrag(ox, oy, ox, oy + oh * 0.3);
  const kz = await ev(`return +document.querySelector("#smdPrep .pn-stack-ov").getAttribute("data-k");`);
  ok(kz > ks, "dragging in the enlarged series moves the slices (" + ks + " -> " + kz + ")");
  await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: ox - 20, y: oy, id: 1 }, { x: ox + 20, y: oy, id: 2 }] });
  for (let i = 1; i <= 6; i++) await call("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: ox - 20 - i * 12, y: oy, id: 1 }, { x: ox + 20 + i * 12, y: oy, id: 2 }] });
  await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  ok(await ev(`return /scale\\((\\d|\\.)+\\)/.test(document.querySelector("#smdPrep .pn-stack-ov .pn-stack-z").style.transform) && document.querySelector("#smdPrep .pn-stack-ov .pn-stack-st").classList.contains("zoomed");`) === true, "pinch zooms the enlarged series");
  await shot("stack-pinch");
  await ev(`PREP.back(); return 1;`);
  ok(await ev(`return !document.querySelector("#smdPrep .pn-stack-ov") && !!document.querySelector("#smdPrep .pn-stack");`) === true, "back() closes the enlarged series first and stays on the question");
  ok(await sliceK() === kz, "the question's series follows the slice reached in the enlarged view");

  // answer
  await click(`#smdPrep [data-act=answer][data-k="0"]`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-fb");`, 3000), "answering marks the question");
  ok((await text("#smdPrep .pn-fb")).length > 40 && !!(await ev(`return !!document.querySelector("#smdPrep .pn-stack");`)), "the explanation shows and the series stays");
  ok(await sliceK() === kz, "the slice survives the repaint after answering");
  ok(!/\b(AI|Radiopaedia|PMC|Creative Commons|licen[cs]e|TCIA)\b/.test(await ev(`return document.querySelector("#smdPrep .pn-run").textContent;`)), "no source, licence or AI label on the question");
  ok(await overflow() === "", "answered stack question fits the screen");
  await shot("stack-answered");

  // ---- iPad
  dev = "ipad";
  await call("Emulation.setDeviceMetricsOverride", { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true });
  await ev(`PREP._host.rerender(); return 1;`); await sleep(300);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-stack .pn-stack-im");`, 3000) && await overflow() === "", "iPad: the stack question fits 820 px");
  await shot("stack-answered");
  await click(`#smdPrep [data-act=rd-zoom]`); await until(`return !!document.querySelector("#smdPrep .pn-stack-ov");`, 2000);
  await shot("stack-enlarged");
  await ev(`PREP.back(); return 1;`);

  // ---- network, errors
  ok(reqs.some((u) => u.includes("/prep-rad.js?v=" + LOADER_V)), "prep-rad.js loads at the current token");
  ok(!reqs.some((u) => /\/api\/(ai|prep\/bank)/.test(u)), "no request to /api/ai or the live bank");
  await ev(`PREP.close(); return 1;`);
  ok(await ev(`return !window.PREP_RAD._st.ov && !window.PREP_RAD._st.cine;`) === true, "closing PrepNucleus leaves no overlay or loop running");
  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ").slice(0, 400) : ""));
} catch (e) {
  console.log("FAIL harness: " + (e && e.stack || e)); fails++;
} finally {
  try { chrome.kill("SIGKILL"); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
  await sleep(300);
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  try { if (realDir) fs.rmSync(realDir, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
