/* MaiK composer symmetry, a findable Close, and backgrounds in dark mode (2026-09-26), real headless browser.
 *
 * Owner: "the button UI doesnt look well aligned in symmetry in ask maik text box and x close button
 * etc are not visible to many and many are confused how to close, and in dark mode keep existing as
 * one background and give option to change background even in dark mode."
 *
 * 1. Composer, at 390 and 320 px, light and dark: every control in the tool row is 44 px tall, on one
 *    line, fully round, none overlapping or outside the box, equal spacing inside each group, the text
 *    box on the same inner edges; typing (extract button appears) moves nothing in the tool row.
 * 2. Close: top right, 44 px target, labelled, text/fill and fill/page contrast measured in both themes;
 *    Escape closes (sidebar panel, then sidebar, then MaiK; never a typed question); Android back
 *    (swipe-back.js goBack) closes the sidebar first, then MaiK.
 * 3. Backgrounds: the dark default is byte-for-byte the old computed background; the sidebar chooser is a
 *    radiogroup, a pick repaints at once, survives closing and reopening MaiK, Plain hides the layer,
 *    light keeps its own choice, Default restores the original exactly, reduced motion still works.
 *
 * USAGE: node test/run-maik-close-bg-ui.mjs [--shot <dir>]     (BASE=http://localhost:8979/ by default)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8979/").replace(/\/?$/, "/");
const PORT = 9491, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-close-bg-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOT = (process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : "");
if (SHOT) mkdirSync(SHOT, { recursive: true });
// The dark background as origin/main computed it before this change (captured 2026-09-26).
const DARK_DEFAULT = "radial-gradient(at 12% 0%, rgba(255, 103, 31, 0.34), rgba(0, 0, 0, 0) 60%), radial-gradient(at 88% 10%, rgba(6, 3, 141, 0.45), rgba(0, 0, 0, 0) 60%), radial-gradient(at 50% 100%, rgba(4, 106, 56, 0.22), rgba(0, 0, 0, 0) 65%)";

let serveProc = null;
try { await fetch(BASE); } catch {
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8979"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId; const exceptions = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const evj = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { throw new Error("eval: " + v); } };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const shot = async (name) => { if (!SHOT) return; const { result: { data } } = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(join(SHOT, name + ".png"), Buffer.from(data, "base64")); };
const width = (w) => call("Emulation.setDeviceMetricsOverride", { width: w, height: 844, deviceScaleFactor: 2, mobile: true });
const theme = (dark) => ev(`document.body.classList.toggle("dark", ${!!dark}); return 1;`);
const esc = () => call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
const open = async () => { await ev(`SMD_askMaik(""); return 1;`); await sleep(900); };
const isOpen = () => ev(`var s = document.getElementById("maikSheet"); return !!(s && s.classList.contains("on") && document.body.classList.contains("maik-open"));`);
const sideOpen = () => ev(`var w = document.getElementById("maikSideWrap"); return !!(w && !w.hidden && w.classList.contains("open"));`);
const atmoBg = () => ev(`var a = document.querySelector("#maikSheet .mk-atmo"); return a ? getComputedStyle(a).backgroundImage : "";`);
const atmoShown = () => ev(`var a = document.querySelector("#maikSheet .mk-atmo"); return !!a && getComputedStyle(a).display !== "none";`);
const pickBg = async (id) => { await ev(`document.getElementById("maikMenu").click(); return 1;`); await sleep(400); await ev(`document.getElementById("maikSideBg").click(); return 1;`); await sleep(250); await ev(`document.querySelector('#maikBgPick [data-bg="${id}"]').click(); return 1;`); await sleep(500); };

// In-page helpers: WCAG contrast of two CSS colours, and the composer's tool-row geometry.
const HELPERS = `window.__rgb = function (c) { var d = document.createElement("i"); d.style.color = c; document.body.appendChild(d); var v = getComputedStyle(d).color; d.remove(); var m = v.match(/[\\d.]+/g).map(Number); return m; };
  window.__lum = function (m) { var a = m.slice(0, 3).map(function (v) { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * a[0] + .7152 * a[1] + .0722 * a[2]; };
  window.__cr = function (a, b) { var x = __lum(__rgb(a)), y = __lum(__rgb(b)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  window.__row = function () {
    var ids = ["maikMic", "maikResearch", "maikImg", "maikLen", "maikModelChip", "maikSend"], box = document.querySelector(".maik-cmp-in").getBoundingClientRect(), q = document.getElementById("maikQ").getBoundingClientRect();
    var els = ids.map(function (id) { return document.getElementById(id); }).filter(function (e) { return e && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0; });
    return { box: { l: box.left, r: box.right }, q: { l: q.left, r: q.right, t: q.top, b: q.bottom }, els: els.map(function (e) { var r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return { id: e.id, l: r.left, r: r.right, t: r.top, h: e.offsetHeight, w: e.offsetWidth, rad: cs.borderTopLeftRadius, bw: cs.borderTopWidth, clip: e.scrollWidth - e.clientWidth }; }) };
  }; return 1;`;

async function composer(label) {
  const g = await evj(`return JSON.stringify(__row());`);
  const e = g.els, byId = Object.fromEntries(e.map((x) => [x.id, x]));
  ok(e.length >= 4 && e.every((x) => x.h === 44), `${label}: every tool-row control is 44px tall (${e.map((x) => x.id.replace("maik", "") + " " + x.h).join(", ")})`);
  ok(e.every((x) => Math.abs(x.t - e[0].t) < 1), `${label}: they sit on one line`);
  ok(e.every((x) => x.rad === e[0].rad) && e.every((x) => x.w >= 44), `${label}: one radius (${e[0].rad}) and at least 44px wide each`);
  const sec = e.filter((x) => x.id !== "maikSend");
  ok(sec.every((x) => x.bw === sec[0].bw), `${label}: one border weight on the secondary controls (${sec[0].bw})`);
  let overlap = false; for (let i = 1; i < e.length; i++) if (e[i].l < e[i - 1].r - 0.5) overlap = true;
  ok(!overlap && e[0].l >= g.box.l && e[e.length - 1].r <= g.box.r, `${label}: nothing overlaps or leaves the composer`);
  ok(byId.maikLen && byId.maikLen.clip <= 1, `${label}: the length pill's label is whole ("${await ev(`return document.getElementById("maikLen").textContent`)}")`);
  const gaps = []; for (let i = 1; i < e.length; i++) gaps.push(+(e[i].l - e[i - 1].r).toFixed(1));
  const li = e.findIndex((x) => x.id === "maikLen"), inner = gaps.filter((_, i) => i !== li);   // gap after the length pill is the flexible one
  ok(inner.every((x) => Math.abs(x - inner[0]) < 1) && gaps[li] >= inner[0] - 0.5, `${label}: equal spacing inside each group (${inner.join("/")}), the group gap is no smaller (${gaps[li]})`);
  ok(Math.abs(g.q.l - e[0].l) < 1 && Math.abs(g.q.r - e[e.length - 1].r) < 1, `${label}: the text box shares the tool row's inner edges`);
  return g;
}

try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") exceptions.push(m.params.exceptionDetails); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await width(390);
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_askMaik && window.SMD_MAIK_ATMOSPHERE && window.SMD_SWIPE_BACK)`) === true) { ready = true; break; } }
  ok(ready, "the app, MaiK, the atmosphere and swipe-back load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); localStorage.setItem("stewardmd_theme_autosync","0"); localStorage.removeItem("smd_maik_atmo_cfg"); SMD_MAIK_ATMOSPHERE.resetConfig(); return 1;`);
  await ev(HELPERS);
  await theme(false); await open();

  // ── 1. Composer symmetry ──
  for (const dark of [false, true]) {
    await theme(dark); await sleep(300);
    for (const w of [390, 320]) {
      await width(w); await sleep(350);
      await composer(`${dark ? "dark" : "light"} ${w}px`);
      await shot(`composer-${dark ? "dark" : "light"}-${w}`);
    }
  }
  await width(390); await theme(false); await sleep(300);
  const before = await evj(`return JSON.stringify(__row().els);`);
  await ev(`var q = document.getElementById("maikQ"); q.focus(); q.value = "sixty year old with fever and cough for three days"; q.dispatchEvent(new Event("input", { bubbles: true })); return 1;`); await sleep(250);
  const typed = await evj(`var x = document.getElementById("maikExtract"), r = x.getBoundingClientRect(), q = document.getElementById("maikQ"), qr = q.getBoundingClientRect();
    return JSON.stringify({ els: __row().els, shown: getComputedStyle(x).visibility === "visible", x: { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }, q: { t: qr.top, b: qr.bottom, r: qr.right, pr: parseFloat(getComputedStyle(q).paddingRight) } });`);
  ok(JSON.stringify(typed.els.map((x) => [x.id, x.l, x.r])) === JSON.stringify(before.map((x) => [x.id, x.l, x.r])), "typing moves nothing in the tool row");
  if (typed.shown) ok(typed.x.t >= typed.q.t - 0.5 && typed.x.b <= typed.q.b + 0.5 && Math.abs(typed.x.r - typed.q.r) < 1 && typed.q.pr >= typed.x.w, "the extract button sits at the right end of the text row, and the text stops short of it");
  else console.log("NOTE the extract button stays hidden here (the reasoning engine did not load), so its placement was not measured");
  await shot("composer-typed-light-390");

  // ── 2. Close ──
  for (const dark of [false, true]) {
    await theme(dark); await sleep(350);
    const c = await evj(`var b = document.getElementById("maikClose"), r = b.getBoundingClientRect(), cs = getComputedStyle(b), s = document.getElementById("maikSheet");
      var page = getComputedStyle(s).getPropertyValue("--mk-bg").trim();
      return JSON.stringify({ w: b.offsetWidth, h: b.offsetHeight, right: innerWidth - r.right, top: r.top, label: b.getAttribute("aria-label"), text: b.textContent.trim(),
        fg: __cr(cs.color, cs.backgroundColor), page: __cr(cs.backgroundColor, page), fill: cs.backgroundColor });`);
    const t = dark ? "dark" : "light";
    ok(c.w >= 44 && c.h >= 44, `${t}: Close is a 44px target (${c.w}x${c.h})`);
    ok(c.right <= 24 && c.top < 80, `${t}: Close sits top right (${Math.round(c.right)}px from the edge, ${Math.round(c.top)}px down)`);
    ok(c.label === "Close MaiK" && c.text === "Close", `${t}: Close says so in words ("${c.text}", aria-label "${c.label}")`);
    ok(c.fg >= 7, `${t}: label on fill contrast ${c.fg.toFixed(1)}:1 (fill ${c.fill})`);
    ok(c.page >= 7, `${t}: fill against the page ${c.page.toFixed(1)}:1`);
    await shot(`close-${t}`);
  }
  await theme(false); await sleep(300);
  ok(await isOpen() === true, "MaiK is open with a question typed");
  await esc(); await sleep(400);
  ok(await isOpen() === true, "Escape in the composer with a question typed does not close MaiK");
  await ev(`var q = document.getElementById("maikQ"); q.value = ""; q.dispatchEvent(new Event("input", { bubbles: true })); return 1;`);
  await esc(); await sleep(500);
  ok(await isOpen() === false, "Escape closes MaiK");
  await open();
  await ev(`document.getElementById("maikMenu").click(); return 1;`); await sleep(400);
  await ev(`document.getElementById("maikSideBg").click(); return 1;`); await sleep(250);
  await esc(); await sleep(350);
  ok(await sideOpen() === true && await ev(`return document.getElementById("maikBgPick").hidden`) === true, "Escape in the background panel steps back to the sidebar list");
  await esc(); await sleep(400);
  ok(await sideOpen() === false && await isOpen() === true, "Escape then closes the sidebar, MaiK stays");
  await esc(); await sleep(500);
  ok(await isOpen() === false, "Escape then closes MaiK");
  await open();
  await ev(`document.getElementById("maikMenu").click(); return 1;`); await sleep(450);
  await ev(`SMD_SWIPE_BACK.goBack(); return 1;`); await sleep(500);
  ok(await sideOpen() === false && await isOpen() === true, "Android back closes the sidebar first");
  await ev(`SMD_SWIPE_BACK.goBack(); return 1;`); await sleep(600);
  ok(await isOpen() === false, "Android back then closes MaiK");

  // ── 3. Backgrounds in dark mode ──
  await theme(true); await open();
  ok(await atmoBg() === DARK_DEFAULT && await atmoShown() === true, "dark default background is exactly the original one");
  ok(await ev(`return document.getElementById("maikSideBgState").textContent`) === "Default", "the sidebar row shows Default");
  await ev(`document.getElementById("maikMenu").click(); return 1;`); await sleep(400);
  await ev(`document.getElementById("maikSideBg").click(); return 1;`); await sleep(250);
  const g = await evj(`var p = document.getElementById("maikBgPick"), rg = p.querySelector('[role="radiogroup"]'), r = p.querySelectorAll('[role="radio"]'), on = p.querySelectorAll('[role="radio"][aria-checked="true"]');
    return JSON.stringify({ shown: !p.hidden, rg: !!rg, n: r.length, on: on.length, cur: on[0] && on[0].getAttribute("data-bg"), h: Math.min.apply(null, [].map.call(r, function (x) { return x.offsetHeight; })), help: p.textContent });`);
  ok(g.shown && g.rg && g.n === 6 && g.on === 1 && g.cur === "tiranga", `the chooser is a radiogroup of ${g.n} with the default checked (${g.cur})`);
  ok(g.h >= 44 && /For dark mode/.test(g.help) && !/—/.test(g.help), `options are ${g.h}px tall, the panel says it is for dark mode, no em-dash`);
  await shot("bg-chooser-dark");
  await ev(`document.querySelector('#maikBgPick [data-bg="cosmic"]').click(); return 1;`); await sleep(500);
  const cos = await atmoBg();
  ok(/rgba\(79, 70, 229, 0\.34\)/.test(cos) && await sideOpen() === false, "picking Cosmic Indigo repaints the open sheet at once and closes the sidebar");
  const saved = await evj(`return localStorage.getItem("smd_maik_atmo_cfg")`);
  ok(saved.dark.color1 === "#4f46e5" && saved.light.color1 === "#b4510a", "saved on this device, for dark only (light keeps its own)");
  await shot("bg-cosmic-dark");
  await ev(`document.getElementById("maikClose").click(); return 1;`); await sleep(500); await open();
  ok(await atmoBg() === cos && await ev(`return document.getElementById("maikSideBgState").textContent`) === "Cosmic", "the choice survives closing and reopening MaiK");
  await pickBg("plain");
  ok(await atmoShown() === false && await ev(`return document.querySelector("#maikSheet .mk-atmo").classList.contains("mk-atmo-plain")`) === true, "Plain hides the aurora layer");
  await shot("bg-plain-dark");
  await theme(false); await sleep(500);
  ok(await atmoShown() === true && /rgba\(180, 81, 10, 0\.28\)/.test(await atmoBg()), "light mode keeps its own (default) background");
  await theme(true); await sleep(500);
  ok(await atmoShown() === false, "back in dark mode, Plain is still chosen");
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }); await sleep(300);
  await pickBg("sunset");
  ok(await atmoShown() === true && /rgba\(180, 81, 10, 0\.34\)/.test(await atmoBg()), "with reduced motion a pick still applies (static)");
  await call("Emulation.setEmulatedMedia", { features: [] });
  await pickBg("tiranga");
  ok(await atmoBg() === DARK_DEFAULT && await atmoShown() === true, "Default restores the original dark background exactly");
  const mine = exceptions.filter((x) => /home\.js|maik-atmosphere|maik-polish/.test(JSON.stringify(x)));
  ok(mine.length === 0, `no uncaught errors from MaiK (${mine.length})`);

  console.log(fails === 0 ? "\nALL GREEN: composer symmetry, Close and dark-mode backgrounds behave in a real browser" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally {
  try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill();
  await sleep(400); try { rmSync(userDir, { recursive: true, force: true }); } catch {}
  process.exit(fails === 0 ? 0 : 1);
}
