/* AI Usage dashboard - drives the REAL More > AI Usage sheet in a headless browser.
 *
 * Owner, 2026-10-10: "It's so confusing. Keep single MaiK Tokens, show weekly and per day tokens left. 300000 per
 * month for Pro and 20K per day, reset every night, so the dashboard should be easy, and no mention of Gemini."
 * What this pins, from a stubbed /api/ai/usage payload (no network, no PHI):
 *  1) ONE unit, MaiK Tokens: today left (the big number) of the daily allowance, this week used, this month
 *     left of the monthly allowance. No wallet, no "MT", no rate card, no model name;
 *  2) an owner reads Unlimited; a free account leads with its month and is offered "Upgrade to Pro", which
 *     reaches the paywall;
 *  3) a slow load shows the skeleton, a failed read says so and Try again works in place;
 *  4) light and dark surfaces, and no em dash.
 *
 * USAGE: node test/run-aiusage-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8917/").replace(/\/?$/, "/");
const PORT = 9437, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/aiusage-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8917"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

// A realistic /api/ai/usage payload + a paywall double, with fetch stubbed for that one path only.
const STUB = `
  window.__paywallOpened = 0;
  window.SMD_PRO = { openPaywall: function () { window.__paywallOpened++; } };
  window.__usage = {
    day: "2026-10-10", req: 7, tokens: 18400, estCostInr: 1.25, avgLatencyMs: 2400,
    byModule: { maik: 5, ecg: 2, ocr: 3, tts: 1, kb: 4 },
    limits: { maik: 50 }, capsEnforced: false, pooled: false, costCapOn: false,
    balanceMt: 0, rates: { model: "gemini-2.5-flash-lite", inPer1k: 19, outPer1k: 77, perImage: 700, perAudioSec: 8 },
    allowance: { plan: "pro", signedIn: true, day: { limit: 20000, used: 4960 }, week: { used: 14960 }, month: { limit: 300000, used: 40000 } }
  };
  window.__usageFail = false;
  if (!window.fetch.__aiuStub) {
    var orig = window.fetch.bind(window);
    var stub = function (input, init) {
      var url = (typeof input === "string" ? input : (input && input.url)) || "";
      if (url.indexOf("/usage") > -1 && url.indexOf("/ai") > -1) {
        var mk = function () {
          if (window.__usageFail) return new Response("nope", { status: 500 });
          return new Response(JSON.stringify(window.__usage), { status: 200, headers: { "Content-Type": "application/json" } });
        };
        if (window.__usageDelay) return new Promise(function (res) { setTimeout(function () { res(mk()); }, window.__usageDelay); });
        return Promise.resolve(mk());
      }
      return orig(input, init);
    };
    stub.__aiuStub = 1; window.fetch = stub;
  }
  return 1;`;

// Open it the way a doctor does: bottom nav "More" -> the AI Usage row.
const OPEN = `
  var m = document.querySelector('[data-act="more"]'); if (m) m.click(); return 1;`;
const TAP = `
  var b = document.querySelector('[data-mi="aiusage"]'); if (!b) return JSON.stringify({ row: false });
  b.click(); return JSON.stringify({ row: true });`;
const READ = `
  var host = document.getElementById("aiUsageBody");
  if (!host) return JSON.stringify({ sheet: false });
  return JSON.stringify({
    sheet: true,
    text: host.textContent.replace(/\\s+/g, " ").trim(),
    balance: (host.querySelector(".aiu-wallet .bal") || {}).textContent,
    buy: !!host.querySelector("#aiuBuy"),
    bars: host.querySelectorAll(".aiu-bar").length,
    stats: [].map.call(host.querySelectorAll(".aiu-stats .n"), function (n) { return n.textContent; }),
    rateCells: [].map.call(host.querySelectorAll(".aiu-rate td.v"), function (n) { return n.firstChild ? String(n.firstChild.textContent).trim() : ""; })
  });`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!document.querySelector('[data-act="more"]')`) === true) { ready = true; break; } }
  if (!ready) throw new Error("home shell not rendered");
  await ev(STUB);

  await ev(OPEN); await sleep(600);
  const row = await J(TAP);
  ok(row.row === true, "More has an AI Usage row");
  await sleep(700);

  const u = await J(READ);
  const T = u.text || "";
  if (process.env.SHOT) { await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(400); await ev(`["smdBootSplash","introPoster"].forEach(function(i){var b=document.getElementById(i);if(b)b.style.display="none"});return 1;`); await sleep(200); const r = await call("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(process.env.SHOT, Buffer.from(r.result.result ? r.result.result.data : r.result.data, "base64")); }
  ok(u.sheet === true, "the AI Usage sheet opens and paints");
  ok(u.balance === "15,040", `the big number is MaiK Tokens left today: 20,000 - 4,960 (got "${u.balance}")`);
  ok(/MaiK Tokens left today/.test(T) && /of 20,000/.test(T) && /resets every night at midnight/.test(T), "it says what it is, the daily allowance and that it resets every night");
  ok(/Used today\s*4,960/.test(T) && /Used this week\s*14,960/.test(T), "today and this week used, in the same unit");
  ok(/Left this month\s*2,60,000\s*of 3,00,000/.test(T), "this month left of 300,000 (" + (T.match(/Left this month[^]{0,40}/) || [""])[0] + ")");
  ok(u.bars === 2, `one bar for today, one for the month (${u.bars})`);
  ok(!/gemini|vertex/i.test(T), "no model or vendor name anywhere on the screen");
  ok(!/\bMT\b|wallet|pricing|per 1,000 tokens|Buy MaiK Tokens/i.test(T), "no wallet, no MT, no price list, no second unit");
  ok(u.buy === false, "a Pro account is not offered an upgrade");
  ok(/MaiK questions\s*5 requests/.test(T) && /Photo scans \(Vision \/ OCR\)\s*3 requests/.test(T) && /Knowledge Base search\s*4 requests/.test(T), "used today by feature, as request counts");
  ok(!/\u2014/.test(T), "no em dash on the screen");
  ok(!/undefined|NaN/.test(T), "nothing renders as undefined/NaN");

  // Owner: unlimited.
  await ev(`window.__usage.allowance = { plan: "owner", signedIn: true, day: { limit: -1, used: 4960 }, week: { used: 14960 }, month: { limit: -1, used: 40000 } }; return 1;`);
  await ev(OPEN); await sleep(600); await ev(TAP); await sleep(700);
  const own = await J(READ);
  ok(own.balance === "Unlimited" && /4,960 used today/.test(own.text || "") && /Used this month\s*40,000/.test(own.text || ""), "an owner reads Unlimited with the real use beside it");

  // Free account: only a month figure; offered Pro.
  await ev(`window.__usage.allowance = { plan: "free", signedIn: true, day: { limit: null, used: 120 }, week: { used: 900 }, month: { limit: 5000, used: 1200 } }; return 1;`);
  await ev(OPEN); await sleep(600); await ev(TAP); await sleep(700);
  const fr = await J(READ);
  ok(fr.balance === "3,800" && /MaiK Tokens left this month/.test(fr.text || "") && /renews on the 1st/.test(fr.text || ""), `a free account leads with what is left this month (${fr.balance})`);
  ok(fr.buy === true && /Upgrade to Pro/.test(fr.text || ""), "and is offered Upgrade to Pro");
  await ev(`window.__paywallOpened = 0; document.getElementById("aiuBuy").click(); return 1;`); await sleep(500);
  ok(await ev(`return window.__paywallOpened;`) === 1, "which opens the existing paywall");

  // A screen with nothing used yet is still a complete screen.
  await ev(`window.__usage.allowance = { plan: "pro", signedIn: true, day: { limit: 20000, used: 0 }, week: { used: 0 }, month: { limit: 300000, used: 0 } }; window.__usage.byModule = {}; return 1;`);
  await ev(OPEN); await sleep(600); await ev(TAP); await sleep(700);
  const fresh = await J(READ);
  ok(fresh.balance === "20,000" && !/Used today by feature/.test(fresh.text || ""), "nothing used yet reads as a full 20,000 and no empty feature list");

  // LOADING: a slow server must show the skeleton.
  await ev(`window.__usageDelay = 1500; return 1;`);
  await ev(OPEN); await sleep(600); await ev(TAP); await sleep(350);
  const loading = await J(`
    var host = document.getElementById("aiUsageBody");
    return JSON.stringify({ skel: !!host.querySelector(".aiu-skel"), busy: (host.querySelector(".aiu-skel")||{}).getAttribute ? host.querySelector(".aiu-skel").getAttribute("aria-busy") : null });`);
  ok(loading.skel === true, "a slow load shows the shaped skeleton");
  ok(loading.busy === "true", "and announces itself as busy");
  await sleep(1500);
  ok(/MaiK Tokens left today/.test(((await J(READ)).text) || ""), "then resolves to the real dashboard");
  await ev(`window.__usageDelay = 0; return 1;`);

  // LIGHT MODE: the card surface flips with the theme.
  await ev(`document.body.classList.remove("dark"); return 1;`);
  await ev(OPEN); await sleep(600); await ev(TAP); await sleep(700);
  const light = await J(`
    var host = document.getElementById("aiUsageBody");
    var w = host.querySelector(".aiu-wallet"), b = host.querySelector(".bal");
    return JSON.stringify({ card: getComputedStyle(w).backgroundColor, ink: getComputedStyle(b).color });`);
  ok(light.card === "rgb(241, 245, 249)", `the card uses the LIGHT surface (${light.card})`);
  ok(light.ink !== light.card, `and the number is not the same colour as its card (${light.ink})`);
  await ev(`document.body.classList.add("dark"); return 1;`);

  // A failed read must say so, offer a retry, and that retry must work in place.
  await ev(`window.__usageFail = true; return 1;`);
  await ev(OPEN); await sleep(600); await ev(TAP); await sleep(800);
  const err = await J(READ);
  ok(/could not be loaded/i.test(err.text || ""), "a failed usage read shows an error instead of an empty sheet");
  ok(await ev(`return !!document.getElementById("aiuRetry");`) === true, "with a Try again button");
  await ev(`window.__usageFail = false; document.getElementById("aiuRetry").click(); return 1;`);
  await sleep(800);
  ok(/MaiK Tokens left today/.test((await J(READ)).text || ""), "Try again reloads the dashboard in place, without reopening the sheet");

  console.log(fails === 0 ? "\nALL GREEN - AI Usage dashboard: one unit, today left, this week, this month" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
