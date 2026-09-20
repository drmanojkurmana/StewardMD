/* MaiK answer action chips — real headless browser (iPhone widths).
 *
 * Reported on an iPhone 17 Pro (build 5245): the "Research" chip under a MaiK answer rendered
 * COLLAPSED — icon on the left and the label wrapping one letter per line (R/e/s/e/a/r/c/h),
 * pushing the row down over "Was this helpful?". Root cause: the chip reused the class of the
 * composer's fixed-size round icon button, so it was forced to 36px (44px with .maik-polished).
 *
 * USAGE: node test/run-maik-action-chips-ui.mjs [--shot <dir>]
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9399, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-chips-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOT = (process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : "");
if (SHOT) mkdirSync(SHOT, { recursive: true });

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

// Build the row exactly as a real answer does: "Know more →", the Rx chip, then the production
// Research chip element straight out of home.js.
const BUILD = `
  var b = document.getElementById("maikBody");
  var old = document.getElementById("chiprow"); if (old) old.remove();
  var d = document.createElement("div"); d.className = "maik-b ai"; d.id = "chiprow";
  d.innerHTML = '<div class="maik-attr">MaiK</div><p>Ceftriaxone 2 g IV once daily.</p>';
  b.appendChild(d);
  var k = document.createElement("button"); k.className = "maik-know"; k.textContent = "Know more \\u2192"; d.appendChild(k);
  var rx = document.createElement("button"); rx.className = "maik-chip maik-rx";
  rx.style.cssText = "margin-top:10px;background:#0e6e63;color:#fff;border-color:#0e6e63;font-weight:700";
  rx.textContent = "\\u211E Create prescription"; d.appendChild(rx);
  d.appendChild(__MAIK_TEST.webChipEl("empiric therapy for community-acquired pneumonia"));
  d.insertAdjacentHTML("beforeend", '<div class="maik-fb" id="chiphelp" style="margin-top:10px">Was this helpful? Yes / No</div>');
  return 1;`;

const MEASURE = `
  var r = document.querySelector("#chiprow .maik-webchip") || document.querySelector("#chiprow .maik-research"), rb = r.getBoundingClientRect();
  var help = document.getElementById("chiphelp").getBoundingClientRect();
  return JSON.stringify({ w: Math.round(rb.width), h: Math.round(rb.height),
    lines: Math.round(rb.height / parseFloat(getComputedStyle(r).lineHeight || 16)),
    scrollW: r.scrollWidth, clientW: Math.round(rb.width),
    overlapsHelp: rb.bottom > help.top + 1,
    spillH: r.scrollHeight - r.clientHeight, spillW: r.scrollWidth - r.clientWidth,
    text: r.textContent.trim() });`;

const shots = [];
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!window.SMD_askMaik`) === true) { ready = true; break; } }
  ok(ready, "the app and MaiK load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(1200);
  ok(await ev(`return !!document.getElementById("maikBody");`) === true, "the MaiK sheet opens");
  ok(await ev(`return !!(window.__MAIK_TEST && __MAIK_TEST.webChipEl);`) === true, "the production Research chip builder is reachable");
  ok(await ev(`return !!document.querySelector("#maikSheet.maik-polished");`) === true, "the sheet carries .maik-polished (the skin the phone renders)");

  for (const width of [390, 430, 320]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 2, mobile: true });
    await ev(BUILD); await sleep(250);
    const m = JSON.parse(await ev(MEASURE));
    console.log(`   ${width}px: Research chip ${m.w}x${m.h}px  text="${m.text}"  spill=${m.spillW}x${m.spillH}  overlapsHelp=${m.overlapsHelp}`);
    ok(m.text === "Research", `${width}px: the label is still "Research"`);
    ok(m.w >= 70, `${width}px: the chip is at least 70px wide (measured ${m.w})`);
    ok(m.h <= 44, `${width}px: the chip is no taller than 44px (measured ${m.h})`);
    ok(!m.overlapsHelp, `${width}px: the chip box does not reach the "Was this helpful?" row`);
    ok(m.spillH <= 1 && m.spillW <= 1, `${width}px: the label fits inside the chip, nothing spills out (spill ${m.spillW}x${m.spillH})`);
    if (SHOT) {
      const { result: { data } } = await call("Page.captureScreenshot", { format: "png" });
      const f = join(SHOT, `chips-${width}.png`); writeFileSync(f, Buffer.from(data, "base64")); shots.push(f);
    }
  }
  // nowrap must not push the longest chip label out of its bubble at the narrowest phone width.
  await call("Emulation.setDeviceMetricsOverride", { width: 320, height: 844, deviceScaleFactor: 2, mobile: true });
  await ev(BUILD); await sleep(200);
  const longFit = await ev(`
    var d = document.getElementById("chiprow");
    var c = document.createElement("button"); c.className = "maik-chip"; c.style.marginTop = "8px";
    c.textContent = "Switch to MaiK Cloud and ask again"; d.appendChild(c);
    var cb = c.getBoundingClientRect(), db = d.getBoundingClientRect();
    return JSON.stringify({ chip: Math.round(cb.width), bubble: Math.round(db.width), spills: cb.right > db.right + 1 });`);
  const lf = JSON.parse(longFit);
  console.log(`   320px: longest chip ${lf.chip}px inside a ${lf.bubble}px bubble`);
  ok(!lf.spills, `320px: the longest chip label stays inside the bubble (${lf.chip}px in ${lf.bubble}px)`);

  // Narrow: whole chips wrap onto another line, they never collapse mid-word.
  await call("Emulation.setDeviceMetricsOverride", { width: 300, height: 844, deviceScaleFactor: 2, mobile: true });
  await ev(BUILD); await sleep(250);
  const rows = await ev(`
    var d = document.getElementById("chiprow");
    var tops = [].slice.call(d.querySelectorAll(".maik-know,.maik-chip")).map(function (e) { return Math.round(e.getBoundingClientRect().top); });
    return JSON.stringify(tops);`);
  const tops = JSON.parse(rows);
  ok(new Set(tops).size > 1, `300px: the chips wrap onto more than one line (tops ${rows})`);
  const narrow = JSON.parse(await ev(MEASURE));
  console.log(`   300px: Research chip ${narrow.w}x${narrow.h}px`);
  ok(narrow.w >= 70 && narrow.h <= 44, `300px: the wrapped chip is still a whole chip (${narrow.w}x${narrow.h})`);

  if (shots.length) console.log("screenshots: " + shots.join(" "));
  console.log(fails === 0 ? "\nALL GREEN — the three action chips render on one line and wrap whole" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
