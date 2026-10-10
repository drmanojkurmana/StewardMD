/* PrepNucleus floating primary action (owner bug 2026-10-10): on the feedback screen the amber "Next question" bar floated
 * over the explanation, cut the last lines, and text showed below the button on a gradient-only footer. Real WebKit
 * (iPhone 15 profile, 3x), a long explanation (4 option reasons), scrolled to the very bottom at 390/430/820/1180, light
 * and dark: the last text line ends 8px above the button, nothing of the feedback is painted under or around the button,
 * the footer is opaque with a hairline top border and safe-area padding, the button is >= 44px.
 * SHOTS=<dir> saves screenshots (TAG=before|after).  USAGE: node test/run-prep-footer-ui.mjs (PLAYWRIGHT_CORE=...)
 */
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = "/test/fixtures/prep/";
const SHOTS = process.env.SHOTS || "";

// playwright-core is not a dependency of the app: PLAYWRIGHT_CORE, then node_modules, then the npx cache.
async function loadPW() {
  const tries = [];
  if (process.env.PLAYWRIGHT_CORE) tries.push(process.env.PLAYWRIGHT_CORE);
  tries.push(join(HERE, "..", "node_modules", "playwright-core"));
  const npx = join(os.homedir(), ".npm", "_npx");
  try { for (const d of fs.readdirSync(npx)) tries.push(join(npx, d, "node_modules", "playwright-core")); } catch {}
  for (const p of tries) {
    if (!fs.existsSync(join(p, "index.mjs"))) continue;
    const pw = await import(pathToFileURL(join(p, "index.mjs")).href);
    try { const exe = pw.webkit.executablePath(); if (exe && fs.existsSync(exe)) return pw; } catch {}
  }
  return null;
}
if (!process.env.PN_SIZE) {   // one fresh WebKit page per size: a resized mobile page keeps a stale shrink-to-fit zoom
  let bad = 0;
  for (const z of ["390x844", "430x932", "820x1180", "1180x820"]) { const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, PN_SIZE: z }, stdio: "inherit" }); bad += r.status ? 1 : 0; }
  console.log(bad ? "\n" + bad + " SIZES FAILED" : "\nALL SIZES PASS"); process.exit(bad ? 1 : 0);
}
const pw = await loadPW();
if (!pw) { console.log("SKIP no playwright-core with an installed WebKit (set PLAYWRIGHT_CORE)"); process.exit(0); }

// index.html's CSP upgrades insecure requests, and WebKit (unlike Chrome) upgrades http://localhost too, so the repo is
// served from disk through a route on an https test origin (a secure context, as capacitor://localhost is on the phone).
const ORIGIN = "https://prep.test";
const BASE = ORIGIN + "/";
const ROOT = join(HERE, "..");
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".gz": "application/gzip", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
function serveFile(route) {
  let p = decodeURIComponent(new URL(route.request().url()).pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = join(ROOT, p.replace(/^\/+/, ""));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: "" });
  const ext = (f.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
  return route.fulfill({ status: 200, contentType: TYPES[ext] || "application/octet-stream", body: fs.readFileSync(f) });
}

const LONG = (n) => "Reason " + n + ": this option is wrong because the stated mechanism does not apply here, and the drug in question is handled by a different enzyme pathway, which changes the exposure, the monitoring plan and the expected adverse effects in a way the stem never describes. Read the stem again and compare each clause.";
function moduleFile() {
  const items = [];
  for (let i = 0; i < 12; i++) items.push({ id: "bp-" + i, q: "A 62-year-old man on risperidone is started on paroxetine. Which interaction explains the extrapyramidal effects that follow within two weeks? " + i, o: ["CYP2D6 induction increases risperidone levels", "CYP2D6 inhibition increases risperidone levels", "CYP2C9 inhibition increases risperidone levels", "CYP3A4 inhibition increases risperidone levels"], a: 1, r: [LONG("A"), "Paroxetine inhibits CYP2D6, the enzyme metabolizing risperidone, causing increased levels and extrapyramidal effects.", LONG("C"), LONG("D") + " Risperidone metabolism is primarily dependent on the CYP2D6 pathway, increasing risperidone levels and the risk of extrapyramidal side effects."], exp: "Paroxetine inhibits CYP2D6.", t: "ana-brachial-plexus", d: 2, prov: "LIC" });
  return { topic: "ana-brachial-plexus", items };
}

let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const errors = [];
let browser;
let frameN = 0; const frameFiles = [];
try {
  browser = await pw.webkit.launch();
  const [PW_, PH_] = process.env.PN_SIZE.split("x").map(Number);
  const ctx = await browser.newContext({ ...pw.devices["iPhone 15"], viewport: { width: PW_, height: PH_ }, screen: { width: PW_, height: PH_ }, hasTouch: true, isMobile: true, deviceScaleFactor: 3, serviceWorkers: "block" });
  const page = await ctx.newPage();
  if (process.env.DBG) { page.on("pageerror", (e) => console.log("pageerror", String(e.message).slice(0, 200))); page.on("requestfailed", (r) => console.log("reqfail", r.url().slice(0, 100))); page.on("console", (m) => { if (m.type() === "error") console.log("console", m.text().slice(0, 160)); }); }
  page.on("pageerror", (e) => { if (/prep|PREP/.test(String(e && (e.stack || e.message)))) errors.push(String(e.message || e)); });
  await page.route(/^https:\/\/prep\.test\//, serveFile);
  await page.route(/ana-brachial-plexus\.json/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(moduleFile()) }));
  await page.route(/^https:\/\/prep\.test\/api\//, (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  // The owner's phone remembered "Incorrect before" for the custom module, with nothing answered wrong yet.
  const remembered = JSON.stringify({ custom: { type: "all", seen: "wrong", d: "mix", n: 20, mode: "study", timer: "q", qs: 90, mins: 0, t: 1 } });
  await page.addInitScript(`window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;
    try{ localStorage.setItem("smd_prep","1"); if (!sessionStorage.getItem("pnwk")) { sessionStorage.setItem("pnwk","1"); localStorage.removeItem("smd_prep_v1"); localStorage.setItem("smd_prep_setup", ${JSON.stringify(remembered)}); } }catch(e){}`);
  await page.goto(BASE);
  await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
  await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const until = async (fn, ms = 10000, arg) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  await ev(() => { const s = document.createElement("style"); s.textContent = "*{transition:none!important;animation-duration:0s!important}"; document.head.appendChild(s); });
  await ev(() => PREP.open({ query: "brachial plexus", n: 3 }));
  ok(await until(() => !!(window.PREP && PREP._st && PREP._st.run) || !!document.querySelector("#smdPrep .pn-opt"), 20000), "a run starts");
  if (!(await ev(() => !!document.querySelector("#smdPrep .pn-opt")))) {
    await ev(() => { PREP.close(); PREP.open(); }); await until(() => !!document.querySelector("#smdPrep [data-act=custom]"), 20000);
    await ev(() => window.SMD_EDGE && SMD_EDGE.startMcq({ kind: "start_mcq", n: 3, topic: "brachial plexus", mode: "study", title: "Today's reviews" }));
    await until(() => !!document.querySelector("#smdPrep .pn-opt"), 15000);
  }
  const SIZES = [[PW_, PH_, String(PW_)]];
  const check = async (tag) => {
    await ev(() => { const b = document.querySelector("#smdPrep .pn-body"); b.scrollTop = b.scrollHeight; });
    await sleep(250);
    const m = await ev(() => {
      const root = document.querySelector("#smdPrep"), body = root.querySelector(".pn-body"), nav = root.querySelector(".pn-navrow"), btn = nav.querySelector(".pn-btn");
      const fb = root.querySelector(".pn-fb"), br = btn.getBoundingClientRect(), nr = nav.getBoundingClientRect();
      // lowest rendered text line of the feedback
      let low = 0; const w = document.createTreeWalker(fb, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) { if (!n.nodeValue.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); for (const q of r.getClientRects()) low = Math.max(low, q.bottom); }
      // what is painted under the button: the element at points just below it, and at the bar's bottom edge
      const vh = innerHeight, below = [];
      for (const y of [br.bottom + 2, Math.min(vh - 1, nr.bottom + 4), vh - 2]) for (const x of [br.left + 20, br.left + br.width / 2]) { const e = document.elementFromPoint(x, y); below.push(e ? (e.className && e.className.baseVal === undefined ? e.className : e.tagName) + "|" + (root.contains(e) && fb.contains(e) ? "FB" : "") : "null"); }
      const cs = getComputedStyle(nav, "::before"), cn = getComputedStyle(nav);
      return { btnTop: br.top, btnBottom: br.bottom, navTop: nr.top, navBottom: nr.bottom, low, vh, below, bg: cs.backgroundColor, bgi: cs.backgroundImage, pos: cs.position, pb: cn.paddingBottom, bt: cs.borderTopWidth, h: br.height, bodyPb: getComputedStyle(root.querySelector(".pn-qw")).paddingBottom, sc: body.scrollTop, mx: body.scrollHeight - body.clientHeight };
    });
    return m;
  };
  for (const [w, h, name] of SIZES) {
    for (const theme of ["light", "dark"]) {
      await ev((t) => document.body.classList.toggle("dark", t === "dark"), theme);
      // answer wrong (option C) once per run item, repaint
      if (!(await ev(() => !!document.querySelector("#smdPrep .pn-fb")))) { await ev(() => document.querySelector('#smdPrep .pn-opt[data-k="2"]').click()); await until(() => !!document.querySelector("#smdPrep .pn-fb"), 5000); }
      await sleep(300);
      const m = await check(name + theme);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, (process.env.TAG || "after") + "-" + name + "-" + theme + ".png") });
      if (process.env.DBG) console.log(name, theme, JSON.stringify(m));
      const t = name + " " + theme;
      // Mid-scroll (the owner's screenshot): text scrolls behind the bar; below and around the button only the footer plate may be hit.
      await ev(() => { const b = document.querySelector("#smdPrep .pn-body"); b.scrollTop = (b.scrollHeight - b.clientHeight) * 0.55; });
      await sleep(200);
      const mid = await ev(() => {
        const nav = document.querySelector("#smdPrep .pn-navrow"), br = nav.querySelector(".pn-btn").getBoundingClientRect(), bad = [];
        for (const y of [br.bottom + 1, br.bottom + 6, (br.bottom + innerHeight) / 2, innerHeight - 2]) for (const x of [4, br.left + 8, br.left + br.width / 2, br.right - 8, innerWidth - 4]) {
          const e = document.elementFromPoint(x, y); if (!e) continue;
          if (e.closest(".pn-qw") && !nav.contains(e)) bad.push(Math.round(x) + "," + Math.round(y) + ":" + (e.className || e.tagName));
        }
        return bad;
      });
      if (SHOTS && (name === "390" || name === "820")) await page.screenshot({ path: join(SHOTS, (process.env.TAG || "after") + "-mid-" + name + "-" + theme + ".png") });
      ok(mid.length === 0, t + ": mid-scroll, no question or explanation content is under and around the button" + (mid.length ? " (" + mid.slice(0, 3).join(" ") + ")" : ""));
      ok(m.low <= m.btnTop - 8, t + ": last explanation line (" + Math.round(m.low) + ") clears the button top (" + Math.round(m.btnTop) + ") by 8px at the end of the scroll");
      ok(m.below.every((x) => !/FB/.test(x)), t + ": no feedback content painted under or around the button: " + m.below.join(", "));
      ok(!/rgba\(0, 0, 0, 0\)|transparent/.test(m.bg) && !/^rgba\((\d+, ){3}0\)$/.test(m.bg), t + ": footer background is opaque (" + m.bg + ")");
      ok(m.navBottom >= m.vh - 1, t + ": footer reaches the bottom edge (" + Math.round(m.navBottom) + " of " + m.vh + ")");
      ok(await ev(() => {
        const b = document.querySelector("#smdPrep .pn-body"), n = b.querySelector(".pn-navrow"), r = n.getBoundingClientRect(), cs = getComputedStyle(n, "::before");
        const l = r.left + parseFloat(cs.left), rt = r.right - parseFloat(cs.right), w1 = b.scrollWidth, st = document.createElement("style");
        st.textContent = ".pn-navrow::before{display:none!important}"; document.head.appendChild(st); const w0 = b.scrollWidth; st.remove();
        return l >= -0.5 && rt <= innerWidth + 0.5 && w1 <= w0;
      }), t + ": the footer plate stays inside the window and adds no sideways scroll");
      ok(m.h >= 44, t + ": primary action is at least 44px tall (" + m.h + ")");
      ok(parseFloat(m.bt) >= 1, t + ": footer has a hairline top border");
    }
  }
  const sa = await ev(() => { const s = [].concat.apply([], [].map.call(document.styleSheets, (x) => { try { return [].map.call(x.cssRules, (r) => r.cssText); } catch (e) { return []; } })); return s.some((t) => /pn-navrow/.test(t) && /safe-area-inset-bottom/.test(t)); });
  ok(sa === true, "the footer rule carries env(safe-area-inset-bottom)");
  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
} catch (e) {
  ok(false, "the run completed: " + (e && e.stack || e));
} finally {
  if (browser) await browser.close().catch(() => {});
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
