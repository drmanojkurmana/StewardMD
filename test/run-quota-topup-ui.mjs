/* The quota top-up sheet — real-browser test.
 *
 * quota-meters.test.mjs proves the server meter and the refusal payload in node. This proves the
 * other half on a real page with the REAL pro-paywall.js: a server 402 quota-exhausted body (built
 * here by the real functions/_quota.js quotaRefusal(), not hand-typed) travelling back through a
 * /api/followcare/ fetch must open the top-up sheet, render the owner-approved value copy and the
 * real pack prices, and carry the App Store product keys on the buy buttons.
 *
 * USAGE: BASE=http://localhost:8994/ CHROME=<chrome binary> node test/run-quota-topup-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { quotaRefusal } from "../functions/_quota.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8994/").replace(/\/?$/, "/");
const PAGE = BASE + "test/fixtures/quota-topup.html";
const PORT = 9398;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/quota-topup-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8994"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [
  ...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio"
], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => {
  const r = await call("Runtime.evaluate", {
    expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`,
    returnByValue: true, awaitPromise: true
  });
  return r.result && r.result.result ? r.result.result.value : null;
};
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      ws = new WebSocket(j.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
      return true;
    } catch { await sleep(300); }
  }
  return false;
}

// The EXACT bodies the server sends (functions/_quota.js), serialized into the page.
const CARE = JSON.stringify(quotaRefusal({}, "care"));
const SCRIBE = JSON.stringify(quotaRefusal({}, "scribe"));
// The same care refusal once a server actually has a count, and once it has none to give.
const CARE7 = JSON.stringify(quotaRefusal({}, "care", { unheardCount: 7 }));
const CARE0 = JSON.stringify(quotaRefusal({}, "care", { unheardCount: 0 }));

const sheetText = () => ev(`var p=document.getElementById("proPay"); return p ? p.innerText : null;`);
const close = () => ev(`var p=document.getElementById("proPay"); if(p){ var c=p.querySelector('[data-pp="close"]'); if(c) c.click(); } return 1;`);
// One refusing call through the REAL wrapped fetch — this is what the app does when a quota runs out.
const refuse = (body) => ev(`window.__402 = ${body};
  return fetch("/api/followcare/enroll", { method: "POST" }).then(function(){ return 1; });`);

try {
  if (!await connect()) throw new Error("could not attach to Chrome");
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.navigate", { url: PAGE });

  let ready = false;
  for (let i = 0; i < 40; i++) { await sleep(250); if (await ev(`return !!(window.SMD_PRO && typeof SMD_PRO.openTopUp === "function")`) === true) { ready = true; break; } }
  ok(ready, "pro-paywall.js loaded and attached SMD_PRO.openTopUp on a real page");
  if (!ready) throw new Error("module never loaded");

  // ── a server 402 on a FollowCare call opens the sheet by itself ──
  await close();
  await refuse(CARE);
  await sleep(400);
  ok(await ev(`return !!document.getElementById("proPay");`) === true, "a 402 quota-exhausted from /api/followcare/ opens the top-up sheet with no caller involvement");

  const t = String(await sheetText() || "");
  ok(/The clinic that calls is the clinic they come back to\./.test(t), "renders the owner-approved benefit headline");
  ok(/₹100 per patient, or ₹90 in the 100 pack\. One patient who comes back pays for the pack\./.test(t), "renders the price-per-patient line");
  ok(/Credits never expire\./.test(t), "says credits never expire (removes the main purchase hesitation)");
  ok(!/have not heard from you/.test(t), "the low-state sentence is absent when the server sends no real count");
  ok(!/—/.test(t), "no em-dash in the rendered sheet");
  ok(!/readmis|mortalit|complication/i.test(t), "no clinical outcome claim on the sheet");

  const packs = await ev(`var b=[].slice.call(document.querySelectorAll('#proPay [data-pp="qpack"]'));
    return JSON.stringify(b.map(function(x){ return { k: x.getAttribute("data-qpack"), t: x.innerText.replace(/\\s+/g," ").trim() }; }));`);
  const P = JSON.parse(packs || "[]");
  ok(P.length === 2, `both care packs are offered (got ${P.length})`);
  ok(P.map(p => p.k).sort().join(",") === "care.100,care.25", "buttons carry the server pack keys care.25 / care.100");
  // No Capacitor on this page, so plat() === "web": the web prices are the ones a browser may see.
  ok(/25 patients ₹2,199/.test(P.map(p => p.t).join(" | ")), `the web ₹2,199 / 25-patient pack is priced on the card (got ${JSON.stringify(P.map(p => p.t))})`);
  ok(/100 patients ₹7,999/.test(P.map(p => p.t).join(" | ")), "the web ₹7,999 / 100-patient pack is priced on the card");
  ok(/₹88 each/.test(P.map(p => p.t).join(" | ")), "the per-patient figure follows the web price");

  // ── ANTI-STEERING: the same sheet on iOS shows the STORE price and nothing about the web ──
  await close();
  await ev(`window.Capacitor = { getPlatform: function(){ return "ios"; } }; return 1;`);
  await refuse(CARE);
  await sleep(400);
  const ios = String(await sheetText() || "");
  ok(/₹2,499/.test(ios), "iOS renders the App Store price ₹2,499");
  ok(/₹8,999/.test(ios), "iOS renders the App Store price ₹8,999");
  ok(!/2,199|7,999/.test(ios), "iOS renders NO web price anywhere on the sheet");
  ok(!/stewardmd\.in/i.test(ios), "iOS renders no stewardmd.in link or hint");
  ok(!/cheaper (on|at|via)|on the web|our website|in your browser/i.test(ios), "iOS carries no steering wording");
  ok(/₹100 each/.test(ios), "iOS per-patient figure follows the store price");
  const iosHtml = String(await ev(`var p=document.getElementById("proPay"); return p ? p.outerHTML : "";`) || "");
  ok(!/stewardmd\.in|2,199|7,999|219900|799900/.test(iosHtml), "not even the iOS sheet's MARKUP carries a web price or purchase URL");
  await ev(`try { delete window.Capacitor; } catch(e) { window.Capacitor = undefined; } return 1;`);
  await close();
  await refuse(CARE);
  await sleep(400);
  ok(/₹2,199/.test(String(await sheetText() || "")), "back on the web the web price returns");

  // ── the nudge: it renders with a real count and vanishes at 0 ──
  await close();
  await refuse(CARE7);
  await sleep(400);
  const n7 = String(await sheetText() || "");
  ok(/7 patients discharged this month have not heard from you\./.test(n7), "a real count renders the unheard-patients nudge verbatim");
  ok((n7.match(/have not heard from you/g) || []).length === 1, "the nudge renders exactly once");
  ok(n7.indexOf("7 patients discharged") < n7.indexOf("Your patient hears from you on day 3"), "the nudge leads the deck, above the evergreen lines");
  ok(!/\u2014/.test(n7), "no em-dash on the sheet with the nudge");
  ok(!/\b\d{10}\b|MRN|mrn/.test(n7), "the nudge carries a number only, never a patient identifier");

  await close();
  await refuse(CARE0);
  await sleep(400);
  const n0 = String(await sheetText() || "");
  ok(/The clinic that calls is the clinic they come back to\./.test(n0), "the sheet still opens at a zero count");
  ok(!/have not heard from you/.test(n0), "the nudge vanishes at 0 rather than saying \"0 patients\"");

  // ── the Scribe refusal renders the Scribe deck, doctor-final and non-diagnostic ──
  await close();
  await refuse(SCRIBE);
  await sleep(400);
  const s = String(await sheetText() || "");
  ok(/MaiK Voice Scribe consults/.test(s), "the sheet is titled with the full product name, MaiK Voice Scribe");
  ok(!/MaiK Scribe/.test(s), "the old name MaiK Scribe appears nowhere on the sheet");
  ok(/Not just a note\. A second pair of eyes\./.test(s), "Scribe sheet leads with the second-pair-of-eyes headline");
  ok(/differentials worth considering/.test(s), "sells the differentials and investigations, not just dictation");
  ok(/You decide\./.test(s), "keeps the doctor-final frame");
  ok(!/never miss|won'?t miss|can'?t miss|catches what you miss|diagnos/i.test(s), "no diagnostic-completeness or accuracy claim");
  ok(/₹20 a consult\./.test(s), "renders the Scribe price line");
  const sp = JSON.parse(await ev(`var b=[].slice.call(document.querySelectorAll('#proPay [data-pp="qpack"]'));
    return JSON.stringify(b.map(function(x){ return x.getAttribute("data-qpack"); }));`) || "[]");
  ok(sp.sort().join(",") === "scribe.250,scribe.50", "the Scribe sheet offers only the Scribe packs");

  // ── closing works, and an ordinary 200 never opens it ──
  await close();
  await sleep(200);
  ok(await ev(`return !!document.getElementById("proPay");`) === false, "the sheet closes");
  await ev(`window.__402 = null; return fetch("/api/followcare/enroll", { method: "POST" }).then(function(){ return 1; });`);
  await sleep(300);
  ok(await ev(`return !!document.getElementById("proPay");`) === false, "a successful call never pops the sheet");

  console.log(fails ? `\n${fails} FAILED` : "\nALL GREEN — the quota refusal sells the top-up on a real page");
  process.exitCode = fails ? 1 : 0;
  ws.close();
} catch (e) { console.error("HARNESS ERROR:", e.message); process.exitCode = 2; }
finally { chrome.kill("SIGKILL"); if (serveProc) serveProc.kill("SIGKILL"); }
