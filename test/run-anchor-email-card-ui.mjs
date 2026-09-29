/* The "Add a real email" card for Apple Hide My Email accounts, in a real headless browser.
 *
 * Owner 2026-09-30: our senders are registered with Apple's private relay, so relayed mail DOES arrive,
 * but it lands in Gmail spam. The card used to say the relay address "can't receive messages", which
 * was no longer true. It now says relayed mail often lands in spam. This drives the real
 * steward-id-onboard.js + anchor-email.js with an Apple relay user and checks the copy, the three
 * ways out (Google, typed email, later) and the 390 px layout.
 *
 * USAGE: BASE=http://localhost:8996/ CHROME=<chrome binary> node test/run-anchor-email-card-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9398, OUT = process.env.CLAUDE_JOB_DIR || "/tmp", userDir = OUT + "/anchor-card-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver;
  for (let i = 0; i < 50; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  const t = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId: t.result.targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable"); await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE + "__anchor_card_blank" });   // same origin, nothing else loaded
  await sleep(600);

  // Real modules; only the ID mint is stubbed (it needs Firestore).
  const loaded = await ev(`
    document.body.innerHTML = ""; document.body.style.margin = "0";
    window.SMD_STEWARD_ID = { ensure: function (d, cb) { cb && cb("SMD-ABC234"); } };
    for (const src of ["steward-id-flags.js", "anchor-email.js", "steward-id-onboard.js"]) {
      await new Promise(function (res, rej) { var s = document.createElement("script"); s.charset = "utf-8"; s.src = "/" + src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    }
    return !!(window.SMD_STEWARD_ONBOARD && window.SMD_ANCHOR && window.SMD_STEWARD_ID_FLAGS);`);
  ok(loaded === true, "real onboard, anchor and flag modules load");

  const flag = await ev(`return window.SMD_STEWARD_ID_FLAGS.bool("smd_steward_id");`);
  ok(flag === true, "smd_steward_id is ON by default, so the card can show");

  await ev(`window.SMD_STEWARD_ONBOARD._onUser({ uid: "u-apple", email: "8tky8vr5rp@privaterelay.appleid.com", providerData: [{ providerId: "apple.com" }] }); return true;`);
  await sleep(300);

  const card = await ev(`var el = document.querySelector(".smdonb"); if (!el) return null;
    var cs = getComputedStyle(el); return { shown: cs.display !== "none", text: el.innerText,
      buttons: Array.from(el.querySelectorAll("[data-onb]")).map(function (b) { return b.getAttribute("data-onb"); }) };`);
  ok(card && card.shown, "an Apple relay account gets the card");
  ok(card && /Add a real email/.test(card.text), "headline: Add a real email");
  ok(card && /often land in spam/.test(card.text), "copy says relayed mail often lands in spam");
  ok(card && !/can.t receive/i.test(card.text), "no longer claims the relay address cannot receive mail");
  ok(card && card.text.indexOf(String.fromCharCode(0x2014)) < 0, "no em-dash in the card");
  ok(card && card.text.indexOf("Apple" + String.fromCharCode(0x2019) + "s Hide My Email") > -1 && card.text.indexOf(String.fromCharCode(0xe2, 0x20ac)) < 0, "curly apostrophes render (no mojibake)");
  ok(card && ["google", "sendCode", "later"].every(function (k) { return card.buttons.indexOf(k) > -1; }), "Google, typed email and later are all offered");

  const fit = await ev(`var c = document.querySelector(".smdonb-card"); var r = c.getBoundingClientRect();
    return { left: r.left, right: r.right, w: innerWidth, scroll: document.documentElement.scrollWidth };`);
  ok(fit && fit.left >= 0 && fit.right <= fit.w && fit.scroll <= fit.w, "card fits a 390 px phone with no sideways scroll");

  const shot = await call("Page.captureScreenshot", { format: "png" });
  writeFileSync(OUT + "/anchor-email-card-390.png", Buffer.from(shot.result.data, "base64"));
  console.log("   screenshot: " + OUT + "/anchor-email-card-390.png");

  await ev(`document.querySelector('[data-onb="later"]').click(); return true;`);
  const closed = await ev(`var el = document.querySelector(".smdonb"); return !el || getComputedStyle(el).display === "none";`);
  ok(closed === true, "\"I'll do this later\" closes it (optional, never forced)");

  const ordinary = await ev(`var el = document.querySelector(".smdonb"); if (el) el.style.display = "none";
    window.SMD_STEWARD_ONBOARD._onUser({ uid: "u-google", email: "dr@gmail.com", providerData: [{ providerId: "google.com" }] });
    var e2 = document.querySelector(".smdonb"); return !e2 || getComputedStyle(e2).display === "none";`);
  ok(ordinary === true, "a real Gmail account is never shown the card");
} catch (e) {
  console.log("❌ harness error: " + (e && e.stack || e)); fails++;
} finally {
  try { chrome.kill("SIGKILL"); } catch {}
  try { if (serveProc) serveProc.kill("SIGKILL"); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
