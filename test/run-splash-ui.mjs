/* Interstitial revamp UI test (presentation-only, flag-gated: html.smd-splash-v2).
 * Verifies at a 390x844 phone viewport that:
 *   - the flag applies by default and ?splashv2=0 removes it,
 *   - the first-run intro poster renders all three phases with the revamped CSS in effect,
 *   - the first-run landing splash (#splash) renders with the revamped card/CTA,
 *   - a returning signed-in clinician gets the personalised boot-splash row (avatar + name),
 *     read from the SAME localStorage "stewardmd_account" record the sidebar/profile use,
 *   - guests/first-time users do NOT get it,
 *   - no uncaught JS errors are raised on any of those paths.
 * Screenshots are written to $SHOT_DIR (default /tmp) for eyeballing.
 * USAGE: CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node test/run-splash-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8992/").replace(/\/?$/, "/");
const PORT = 9384;
const SHOT_DIR = process.env.SHOT_DIR || "/tmp";
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/splash-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8992"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--no-sandbox", "--disable-gpu", "--mute-audio", "--hide-scrollbars"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => {
  const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true });
  return r.result && r.result.result ? r.result.result.value : null;
};
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

async function shot(name) {
  const r = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const d = r.result && r.result.data;
  if (!d) { console.log("  (screenshot failed: " + name + ")"); return; }
  const p = join(SHOT_DIR, name + ".png");
  writeFileSync(p, Buffer.from(d, "base64"));
  console.log("  shot -> " + p);
}

async function newTab() {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
}

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params && m.params.exceptionDetails;
      errors.push((d && d.exception && d.exception.description) || (d && d.text) || "unknown");
    }
  };

  /* ---------- 1. FIRST-RUN: intro poster + landing splash ---------- */
  await newTab();
  await call("Page.navigate", { url: BASE });
  await sleep(3500);

  ok(await ev(`return document.documentElement.classList.contains("smd-splash-v2");`) === true,
    "flag applies by default (html.smd-splash-v2)");
  ok(await ev(`var e=document.getElementById("introPoster"); return !!e && getComputedStyle(e).display!=="none";`) === true,
    "#introPoster renders for a first-time user");
  ok(await ev(`var e=document.querySelector(".ip-dot.active"); return e ? getComputedStyle(e).width : "";`) === "20px",
    "revamped progress dots in effect (active dot 20px)");
  ok(await ev(`var e=document.querySelector(".ip-skip"); return e ? getComputedStyle(e).borderTopLeftRadius : "";`) === "999px",
    "revamped skip control in effect (pill radius)");
  // the poster must clear its own footer: the phase content stops above the dots/skip row
  ok(await ev(`var p=document.getElementById("ipPhase1"),f=document.querySelector(".ip-footer");
      if(!p||!f)return false; return p.getBoundingClientRect().bottom <= f.getBoundingClientRect().top + 1;`) === true,
    "phase content does not collide with the footer at 390x844");
  await shot("splash-01-intro-phase1");

  // advance to the AMR phase and the credit phase (tap anywhere but the skip button)
  await ev(`var p=document.getElementById("introPoster"); p.click(); return 1;`); await sleep(900);
  ok(await ev(`var e=document.getElementById("ipPhase2"); return !!e && !e.classList.contains("ip-hidden");`) === true,
    "tap advances to the AMR phase");
  ok(await ev(`var e=document.querySelector(".ip-stats"); return e ? getComputedStyle(e).display : "";`) === "grid",
    "AMR stat block uses the revamped 3-up grid");
  await shot("splash-02-intro-phase2-amr");

  await ev(`var p=document.getElementById("introPoster"); p.click(); return 1;`); await sleep(900);
  ok(await ev(`var e=document.getElementById("ipPhase3"); return !!e && !e.classList.contains("ip-hidden");`) === true,
    "tap advances to the credit phase");
  await shot("splash-03-intro-phase3-credit");

  // skip -> the landing splash underneath
  await ev(`var b=document.getElementById("introPosterSkip"); if(b)b.click(); return 1;`); await sleep(1200);
  ok(await ev(`var e=document.getElementById("splash"); return !!e && getComputedStyle(e).display!=="none" && e.offsetHeight>1;`) === true,
    "#splash (landing) renders after the poster is dismissed");
  ok(await ev(`var e=document.querySelector("#splash .demo-card"); return e ? getComputedStyle(e).borderTopLeftRadius : "";`) === "18px",
    "revamped case-preview card in effect (radius 18px)");
  ok(await ev(`var e=document.querySelector("#splash .demo-drug"); return e ? getComputedStyle(e).borderTopLeftRadius : "";`) === "999px",
    "revamped drug chips in effect (pill radius)");
  await shot("splash-04-landing");

  /* ---------- 2. RETURNING signed-in clinician: personalised boot splash ---------- */
  await newTab();
  await call("Page.navigate", { url: BASE });
  await sleep(1500);
  await ev(`localStorage.setItem("stewardmd_account", JSON.stringify({type:"google",name:"Dr. Manoj Kumar Kurmana",email:"doctor@example.com",picture:"https://example.invalid/photo.jpg"})); return 1;`);
  await call("Page.navigate", { url: BASE });
  await sleep(1600);

  ok(await ev(`var e=document.getElementById("sbsHello"); return !!e && !e.hidden && e.offsetHeight>1;`) === true,
    "returning signed-in user gets the personalised welcome row");
  ok(await ev(`var e=document.getElementById("sbsHelloName"); return e ? e.textContent : "";`) === "Dr. Manoj Kumar Kurmana",
    "greeting shows the account name from localStorage stewardmd_account");
  ok(await ev(`var e=document.getElementById("smdBootSplash"); return !!e && e.classList.contains("sbs-personal");`) === true,
    "generic tagline is swapped for the personal greeting (.sbs-personal)");
  ok(await ev(`var e=document.getElementById("sbsDp"); return e ? e.textContent : "";`) === "M",
    "avatar falls back to the clinician's monogram when the photo cannot load");
  await shot("splash-05-boot-personal-monogram");

  // same layout with a real photo in the avatar (local asset stands in for the Google photoURL)
  await ev(`var d=document.getElementById("sbsDp"); if(d){d.style.backgroundImage='url("/logo.png")';d.textContent="";d.className="sbs-dp has-pic";} return 1;`);
  await sleep(300);
  await shot("splash-06-boot-personal-photo");

  /* ---------- 3. Guest: no personalisation ---------- */
  await newTab();
  await call("Page.navigate", { url: BASE });
  await sleep(1200);
  await ev(`localStorage.clear(); localStorage.setItem("stewardmd_guest_used","1"); return 1;`);
  await call("Page.navigate", { url: BASE });
  await sleep(1500);
  ok(await ev(`var e=document.getElementById("sbsHello"); return !e || e.hidden===true;`) === true,
    "guest sees no personalised row (brand tagline retained)");

  /* ---------- 4. Flag OFF reverts cleanly ---------- */
  await newTab();
  await call("Page.navigate", { url: BASE + "?splashv2=0" });
  await sleep(2500);
  ok(await ev(`return document.documentElement.classList.contains("smd-splash-v2");`) === false,
    "?splashv2=0 removes the flag");
  ok(await ev(`var e=document.querySelector(".ip-dot.active"); return e ? getComputedStyle(e).width : "";`) === "7px",
    "?splashv2=0 restores the original dots (7px)");
  ok(await ev(`var e=document.getElementById("sbsHello"); return !e || e.hidden===true;`) === true,
    "?splashv2=0 leaves the boot splash unpersonalised");

  ok(errors.length === 0, "no uncaught JS errors (" + (errors.length ? errors.join(" | ") : "none") + ")");
} catch (e) {
  console.log("HARNESS ERROR: " + (e && e.stack || e));
  fails++;
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
console.log(fails === 0 ? "ALL PASS" : fails + " FAILED");
process.exit(fails === 0 ? 0 : 1);
