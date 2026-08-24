/* AI Usage dashboard — drives the REAL More → AI Usage sheet in a headless browser.
 *
 * What this pins:
 *  1) the sheet renders the MaiK Token wallet, today's spend, the per-feature list and the rate card
 *     from a live /api/ai/usage payload (stubbed at fetch, no network, no PHI);
 *  2) "Buy MaiK Tokens" actually reaches the existing paywall token store — the button used not to
 *     exist at all, so a doctor who ran out had no route to buy;
 *  3) no cap bar is drawn while the per-module caps are not enforced (the old page always drew
 *     "3 / 50" bars for limits that block nobody);
 *  4) a failed usage read shows an error, not a blank sheet.
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
    day: "2026-08-25", req: 7, tokens: 18400, estCostInr: 1.25, avgLatencyMs: 2400,
    byModule: { maik: 5, ecg: 2 }, limits: { maik: 50, maik_case: 25, ecg: 10 },
    capsEnforced: false, pooled: false, costCapOn: false,
    tokensUsedMt: 2500, balanceMt: 250000, dailyFreeMt: 0, mtPerInr: 2000,
    rates: { model: "gemini-2.5-flash", inPer1k: 14, outPer1k: 50, perImage: 700, perAudioSec: 40 }
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
  ok(u.sheet === true, "the AI Usage sheet opens and paints");
  ok(u.balance === "250k", `the MaiK Token wallet leads the screen (got "${u.balance}")`);
  ok(u.buy === true, "there is a Buy MaiK Tokens button on it");
  ok(/Worth about ₹125/.test(u.text || ""), "the wallet says what the balance is worth in rupees");
  ok((u.stats || []).join("|") === "7|18k|2,500|2.4s", `today's stats are real: requests, tokens, spend, latency (${(u.stats || []).join("|")})`);
  ok((u.rateCells || []).join("|") === "14 MT|50 MT|700 MT|40 MT", `the rate card prices every unit (${(u.rateCells || []).join("|")})`);
  ok(/gemini-2\.5-flash/.test(u.text || ""), "the rate card names the model it is quoting");
  ok(u.bars === 0 && !/5 ?\/ ?50/.test(u.text || ""), `no cap bars while the caps are not enforced (${u.bars} bars)`);
  ok(/MaiK questions ?5/.test(u.text || "") && /ECG reads \(KardiQ X\) ?2/.test(u.text || ""), "per-feature usage is still counted and shown");
  ok(!/undefined|NaN/.test(u.text || ""), "nothing renders as undefined/NaN");

  // The button must reach the paywall's token store.
  await ev(`document.getElementById("aiuBuy").click(); return 1;`);
  await sleep(400);
  ok(await ev(`return window.__paywallOpened;`) === 1, "Buy MaiK Tokens opens the paywall token store");

  // SHOT=<path> captures the painted sheet, for eyeballing the design without a device.
  if (process.env.SHOT) {
    await call("Page.enable", {});
    // The launch splash/intro sits above the sheet — drop it so the capture shows the dashboard.
    await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
    await sleep(400);
    const box = await J(`var h=document.getElementById("aiUsageBody"); var s=h.closest("#hvSheet")||h.parentElement; var r=s.getBoundingClientRect();
      return JSON.stringify({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: Math.max(r.height, h.scrollHeight) });`);
    const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 2 } });
    const data = shot.result && shot.result.data;
    if (data) { (await import("node:fs")).writeFileSync(process.env.SHOT, Buffer.from(data, "base64")); console.log("   ↳ screenshot: " + process.env.SHOT); }
  }

  // Caps ON: the bars come back with the real limits.
  await ev(`window.__usage.capsEnforced = true; return 1;`);
  await ev(OPEN); await sleep(600); await ev(TAP); await sleep(700);
  const capped = await J(READ);
  ok(capped.bars >= 2, `with caps enforced, the limit bars are drawn (${capped.bars})`);
  ok(/MaiK questions ?5 \/ 50/.test(capped.text || ""), "and show used / limit");

  // Free daily allowance (cost cap live).
  await ev(`window.__usage.costCapOn = true; window.__usage.dailyFreeMt = 20000; window.__usage.tokensUsedMt = 15000; return 1;`);
  await ev(OPEN); await sleep(600); await ev(TAP); await sleep(700);
  const free = await J(READ);
  ok(/free allowance/i.test(free.text || "") && /15k \/ 20k/.test(free.text || ""), "today's included allowance is shown against what is spent");

  // LOADING: a slow server must show the skeleton, not a blank sheet or a spinner-less gap.
  await ev(`window.__usageDelay = 1500; return 1;`);
  await ev(OPEN); await sleep(600); await ev(TAP); await sleep(350);
  const loading = await J(`
    var host = document.getElementById("aiUsageBody");
    return JSON.stringify({ skel: !!host.querySelector(".aiu-skel"), busy: (host.querySelector(".aiu-skel")||{}).getAttribute ? host.querySelector(".aiu-skel").getAttribute("aria-busy") : null });`);
  ok(loading.skel === true, "a slow load shows the shaped skeleton");
  ok(loading.busy === "true", "and announces itself as busy");
  await sleep(1500);
  ok(/Tokens in wallet/.test(((await J(READ)).text) || ""), "then resolves to the real dashboard");
  await ev(`window.__usageDelay = 0; return 1;`);

  // Never-purchased user: zero wallet, zero usage. Must still be a complete screen.
  // capsEnforced back to false = today's real production state (MAIK_ENFORCE_CAPS off).
  await ev(`window.__usage.capsEnforced = false; window.__usage.costCapOn = false; window.__usage.balanceMt = 0; window.__usage.req = 0;
    window.__usage.tokens = 0; window.__usage.tokensUsedMt = 0; window.__usage.avgLatencyMs = 0;
    window.__usage.byModule = {}; return 1;`);
  await ev(OPEN); await sleep(600); await ev(TAP); await sleep(700);
  const fresh = await J(READ);
  ok(/haven.t added any tokens yet/i.test(fresh.text || ""), "a user who never purchased is told so plainly");
  ok(fresh.buy === true && /Buy MaiK Tokens/.test(fresh.text || ""), "and is offered the top-up");
  ok(/No AI activity yet today/.test(fresh.text || ""), "zero usage reads as zero, not as a broken screen");
  ok(!/undefined|NaN/.test(fresh.text || ""), "no undefined/NaN in the empty state");

  // LIGHT MODE: the card surfaces must flip with the theme (a sibling sheet shipped unreadable once).
  await ev(`document.body.classList.remove("dark"); return 1;`);
  await ev(OPEN); await sleep(600); await ev(TAP); await sleep(700);
  const light = await J(`
    var host = document.getElementById("aiUsageBody");
    var w = host.querySelector(".aiu-wallet"), b = host.querySelector(".bal");
    var cs = getComputedStyle(w), ts = getComputedStyle(b);
    return JSON.stringify({ card: cs.backgroundColor, ink: ts.color });`);
  ok(light.card === "rgb(241, 245, 249)", `wallet card uses the LIGHT surface (${light.card})`);
  ok(light.ink !== light.card, `and the balance text is not the same colour as its card (${light.ink})`);
  await ev(`document.body.classList.add("dark"); return 1;`);

  // A failed read must say so, offer a retry, and that retry must work in place.
  await ev(`window.__usageFail = true; return 1;`);
  await ev(OPEN); await sleep(600); await ev(TAP); await sleep(800);
  const err = await J(READ);
  ok(/could not be loaded/i.test(err.text || ""), "a failed usage read shows an error instead of an empty sheet");
  ok(await ev(`return !!document.getElementById("aiuRetry");`) === true, "with a Try again button");
  ok(/features are unaffected/i.test(err.text || ""), "and reassures that AI itself still works");

  await ev(`window.__usageFail = false; document.getElementById("aiuRetry").click(); return 1;`);
  await sleep(800);
  const recovered = await J(READ);
  ok(/Tokens in wallet/.test(recovered.text || ""), "Try again reloads the dashboard in place, without reopening the sheet");

  console.log(fails === 0 ? "\nALL GREEN — AI Usage dashboard: wallet, spend, rate card and a working buy route" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
