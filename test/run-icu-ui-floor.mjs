/* ICU UI floor (2026-10-29, impeccable / ui-ux-pro-max / no-slop-ui / antislop-ui pass). Guards:
 *  - every visible control is >= 44pt (46 CSS px; home.js shrinks small phones to 0.95). Measured as layout size x
 *    page zoom, not getBoundingClientRect: press/page animations scale the box mid-transition (read as 43px).
 *  - no tracked-uppercase labels (they also mangled pH / PaCO2 / SpO2)
 *  - no text glyphs standing in for icons (checkbox, pencil)
 *  - dark mode: white-on-teal fills and teal text both >= 4.5:1 (one teal cannot do both)
 *  - no coloured left-edge stripe on cards, rows or alerts (antislop-ui / impeccable craft floor ban)
 * USAGE: node test/run-icu-ui-floor.mjs   (CHROME=/path/to/chrome to override)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8923/").replace(/\/?$/, "/");
const PORT = 9458, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-uifloor-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8923"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.stack||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "?tour=0" });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.savePatient)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");

  await call("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  const PROBE = `
    var root = document.getElementById("icuRoot"), z = 1;
    var vis = function (el) { var r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    var lum = function (c) { var m = c.match(/[\\d.]+/g); var v = m.slice(0, 3).map(function (x) { x = +x / 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }); return { L: .2126 * v[0] + .7152 * v[1] + .0722 * v[2], a: m[3] != null ? +m[3] : 1 }; };
    var bgOf = function (el) { while (el) { var l = lum(getComputedStyle(el).backgroundColor); if (l.a > .5) return l.L; el = el.parentElement; } return 1; };
    var cr = function (el) { var f = lum(getComputedStyle(el).color).L, b = bgOf(el); return (Math.max(f, b) + .05) / (Math.min(f, b) + .05); };
    var small = [], caps = [], glyph = [], lowc = [], stripe = [];
    root.querySelectorAll("*").forEach(function (el) { if (!vis(el)) return; var cs = getComputedStyle(el); if (parseFloat(cs.borderLeftWidth) > 1.5 && cs.borderLeftStyle !== "none" && parseFloat(cs.borderRightWidth) < 1.5) stripe.push((el.className || el.tagName).toString().slice(0, 40)); });
    root.querySelectorAll("button,[role=tab],[role=switch]").forEach(function (el) { if (!vis(el)) return; var zm = parseFloat(document.documentElement.style.zoom) || 1, w = el.offsetWidth * zm, h = el.offsetHeight * zm; if (h < 43.5 || w < 43.5) small.push((el.getAttribute("aria-label") || el.textContent).trim().slice(0, 30) + " " + Math.round(w) + "x" + Math.round(h)); });
    root.querySelectorAll("*").forEach(function (el) {
      if (!vis(el)) return; var own = [].filter.call(el.childNodes, function (n) { return n.nodeType === 3; }).map(function (n) { return n.textContent; }).join("").trim(); if (!own) return;
      var cs = getComputedStyle(el);
      if (cs.textTransform === "uppercase" && parseFloat(cs.letterSpacing) > .5) caps.push(own.slice(0, 24));
      if (/[\\u270E\\u2610\\u2611]/.test(own)) glyph.push(own.slice(0, 24));
      var fs = parseFloat(cs.fontSize), c = cr(el); if (c < ((fs >= 18.66 || (fs >= 14 && +cs.fontWeight >= 700)) ? 3 : 4.5)) lowc.push(own.slice(0, 24) + " " + c.toFixed(2));
    });
    return JSON.stringify({ small: small, caps: caps, glyph: glyph, lowc: lowc, stripe: stripe });`;
  for (const dark of [false, true]) {
    const th = dark ? "dark" : "light";
    await J(`
      window.SMD_AUTH = { currentUser: { uid: "floor-uid" } }; window.toast = function () {};
      localStorage.setItem("smd_icu_groups", "0");
      document.body.classList.toggle("dark", ${dark});
      try { for (var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k&&k.indexOf("stewardmd_icu_patients")===0) localStorage.removeItem(k); } } catch(e){}
      ICU.reset(); ICU.ingestPatient({ name: "Floor Pt", bed: "2", diagnosis: "Septic shock", age: 60, sex: "F" }); ICU.ingestMonitor({ hr: 124, sbp: 84, dbp: 48, spo2: 91, rr: 28 }); ICU.savePatient();
      ICU.open(); return "1";`);
    await sleep(700);
    const screens = [["board", null], ["overview", '#icuRoot .icu-v2-card'], ["rounds", '#icuRoot .icu-v2-tab[data-icu-act="tab:rounds"]'], ["settings", null]];
    for (const [name, sel] of screens) {
      if (name === "settings") { await J(`ICU.open(); return "1";`); await sleep(300); await J(`document.querySelector('#icuRoot [data-icu-act="icusettings"]').click(); return "1";`); }
      else if (sel) await J(`var e = document.querySelector('${sel}'); if (e) e.click(); return "1";`);
      await sleep(600);
      const r = await J(PROBE);
      ok(r.small.length === 0, `${th} ${name}: every control >= 44pt (${r.small.slice(0, 3).join("; ")})`);
      ok(r.caps.length === 0, `${th} ${name}: no tracked-uppercase labels (${r.caps.slice(0, 3).join("; ")})`);
      ok(r.glyph.length === 0, `${th} ${name}: no text glyphs as icons (${r.glyph.slice(0, 3).join("; ")})`);
      ok(r.lowc.length === 0, `${th} ${name}: text contrast passes (${r.lowc.slice(0, 3).join("; ")})`);
      ok(r.stripe.length === 0, `${th} ${name}: no coloured left-edge stripes (${r.stripe.slice(0, 3).join("; ")})`);
    }
  }
} catch (e) { console.log("❌ " + (e && e.stack || e)); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
