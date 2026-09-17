/* The conversion paywall sheet, driven in a REAL browser.
 *
 * paywall-render.test.mjs proves the markup in a sandbox. This drives the shipping pro-paywall.js on
 * a real page (test/fixtures/paywall-sheet.html): open the sheet, read the default selection, tap
 * the cycle toggle, tap a card, reveal the trainee tiers, and read back the CTA, the per-day hero
 * line and the benefit line the way a doctor's thumb would. Ends with a PNG.
 *
 * USAGE: node test/run-paywall-ui.mjs        (BASE / CHROME_BIN overridable)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8994/").replace(/\/?$/, "/");
const PAGE = BASE + "test/fixtures/paywall-sheet.html";
const PORT = 9398;
const OUT = process.env.OUT_DIR || "/tmp/paywall-ui";
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/paywall-ui-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8994"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  ...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=420,900",
], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
// NOTE: the expression is wrapped in a function body, so `return` is required and statements are
// fine. Keep it that way; a harness that wraps in `return ( ... )` turns `a; b` into a SyntaxError
// that silently no-ops.
const ev = async (e) => {
  const r = await call("Runtime.evaluate", {
    expression: `(function(){try{${e}}catch(x){return "__ERR:"+String(x&&x.message||x)}})()`,
    returnByValue: true, awaitPromise: true,
  });
  return r.result && r.result.result ? r.result.result.value : null;
};
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

const sheetText = () => ev(`var p=document.getElementById("proPay"); return p ? p.innerText : null;`);
const cardText = (id) => ev(`var b=document.querySelector('[data-pp="tier"][data-tier="${id}"]'); return b ? b.innerText : null;`);
const ctaText = () => ev(`var b=document.querySelector('[data-pp="buy"]'); return b ? b.innerText : null;`);
const selected = () => ev(`var b=document.querySelector('[data-pp="tier"][aria-pressed="true"]'); return b ? b.getAttribute("data-tier") : null;`);
const cycle = () => ev(`var b=document.querySelector('[data-pp="cycle"][aria-pressed="true"]'); return b ? b.getAttribute("data-cycle") : null;`);
const cardCount = () => ev(`return document.querySelectorAll('[data-pp="tier"]').length;`);
const tap = (sel) => ev(`var b=document.querySelector('${sel}'); if(!b) return "__ERR:no "+'${sel}'; b.click(); return 1;`);
async function shot(name) {
  const r = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const f = join(OUT, name + ".png");
  writeFileSync(f, Buffer.from(r.result.data, "base64"));
  console.log("     screenshot " + f);
  return f;
}

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

try {
  if (!await connect()) throw new Error("could not attach to Chrome");
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 420, height: 900, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: PAGE });

  let ready = false;
  for (let i = 0; i < 40; i++) { await sleep(200); if (await ev(`return !!(window.SMD_PRO && typeof SMD_PRO.openPaywall === "function")`) === true) { ready = true; break; } }
  ok(ready, "pro-paywall.js loaded and attached on a real page");
  if (!ready) throw new Error("module never loaded");

  await ev(`SMD_PRO.openPaywall("test"); return 1;`);
  for (let i = 0; i < 25; i++) { await sleep(120); if (await cardCount() > 0) break; }

  // ── default view ──────────────────────────────────────────────────────────
  ok(await cardCount() === 3, "three cards by default (got " + await cardCount() + ")");
  ok(await selected() === "physician", "Physician is preselected (got " + await selected() + ")");
  ok(await cycle() === "annual", "Annual is preselected (got " + await cycle() + ")");
  const phyA = String(await cardText("physician"));
  ok(/₹7,490/.test(phyA), "Physician annual price ₹7,490 from the payload: " + JSON.stringify(phyA.split("\n").slice(0, 4)));
  ok(/₹17,988/.test(phyA), "true anchor ₹17,988 struck through (regular 1499 x 12)");
  ok(/SAVE 58%/.test(phyA), "SAVE 58% computed from regular");
  ok(/₹21 a day\. Less than a samosa, and it runs your clinic\./.test(phyA), "per-day hero line, annual");
  ok(/Runs your clinic: queue, billing, recovery calls, and notes that think with you\./.test(phyA), "benefit line");
  ok(/MaiK Voice Scribe writes the note, then offers the differentials worth considering\./.test(phyA), "second line");
  ok(/Subscribe to Physician · ₹7,490\/year/.test(String(await ctaText())), "CTA: " + JSON.stringify(await ctaText()));
  ok(/Less than one family dinner a month\./.test(phyA), "everyday-spend line, yearly");
  await shot("01-default-annual");

  // ── switch cycle ──────────────────────────────────────────────────────────
  await tap('[data-pp="cycle"][data-cycle="monthly"]');
  await sleep(150);
  const phyM = String(await cardText("physician"));
  ok(await cycle() === "monthly", "monthly selected");
  ok(/₹749/.test(phyM) && /₹25 a day/.test(phyM), "monthly price + per-day: " + JSON.stringify(phyM.split("\n").slice(0, 4)));
  ok(/₹1,499/.test(phyM) && /SAVE 50%/.test(phyM), "monthly anchor and SAVE 50%");
  ok(/Subscribe to Physician · ₹749\/month/.test(String(await ctaText())), "CTA follows the cycle: " + JSON.stringify(await ctaText()));
  ok(/Less than one dinner out\./.test(phyM) && !/family dinner a month/.test(phyM), "everyday-spend line switches with the cycle");
  await shot("02-monthly");

  // ── switch tier ───────────────────────────────────────────────────────────
  await tap('[data-pp="tier"][data-tier="physicianpro"]');
  await sleep(150);
  ok(await selected() === "physicianpro", "Physician Pro selected");
  ok(/Subscribe to Physician Pro · ₹899\/month/.test(String(await ctaText())), "CTA follows the card: " + JSON.stringify(await ctaText()));
  const ppro = String(await cardText("physicianpro"));
  ok(/₹30 a day\. One consultation fee covers your month\./.test(ppro), "Physician Pro per-day line");

  // ── reveal the trainee tiers ──────────────────────────────────────────────
  await tap('[data-pp="showall"]');
  await sleep(150);
  ok(await cardCount() === 5, "the link reveals Trainee and Co-Resident (" + await cardCount() + " cards)");
  const stu = String(await cardText("student")), co = String(await cardText("coresident"));
  ok(/₹7 a day\. Less than a cup of chai\./.test(stu), "Trainee per-day line: " + JSON.stringify(stu.split("\n").slice(0, 4)));
  ok(/₹5 a day each\. Split with your co-resident\./.test(co), "Co-Resident per-day line, per seat");
  await tap('[data-pp="tier"][data-tier="student"]');
  await sleep(150);
  ok(/Subscribe to Trainee · ₹199\/month/.test(String(await ctaText())), "every tier stays buyable: " + JSON.stringify(await ctaText()));
  await shot("03-all-five-trainee-selected");

  // ── the add-on is there for a trainee too ─────────────────────────────────
  const all = String(await sheetText());
  ok(/Less than a coffee\./.test(all), "add-on everyday-spend line");
  ok(/Oncology AI add-on/.test(all) && /₹89/.test(all) && /₹3 a day/.test(all), "Onco add-on present and priced from the server");
  ok(!/days free|free trial|limited time|only \d+ left/i.test(all), "no invented trial and no fake scarcity");
  ok(!/—/.test(all), "no em-dash in the rendered sheet");

  console.log(fails ? `\n${fails} FAILED` : "\nALL GREEN");
  process.exitCode = fails ? 1 : 0;
  ws.close();
} catch (e) { console.error("HARNESS ERROR:", e.message); process.exitCode = 2; }
finally { chrome.kill("SIGKILL"); if (serveProc) serveProc.kill("SIGKILL"); }
