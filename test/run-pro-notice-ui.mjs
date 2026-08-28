/* "Why is this locked?" dialog — real-browser test.
 *
 * The unit test proves the WORDING is chosen correctly. What it cannot prove is that the dialog
 * actually appears on a real page and that its button reaches the right destination — which is the
 * entire point: an unverified doctor pressing the primary button must land on verification, not on
 * a payment sheet.
 *
 * USAGE: BASE=http://localhost:8991/ node test/run-pro-notice-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8991/").replace(/\/?$/, "/");
const PAGE = BASE + "test/fixtures/pro-notice.html";
const PORT = 9396;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/pro-notice-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8991"])[1];
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

// Set the account's entitlement state, then open the notice for a feature.
const asState = (json) => ev(`window.__pro=false; window.__state=${json}; window.__acted=[];
                              SMD_PRO_NOTICE.close(); return 1;`);
const press = () => ev(`document.querySelector("#smdProNotice .pn-go").click(); return 1;`);

try {
  if (!await connect()) throw new Error("could not attach to Chrome");
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.navigate", { url: PAGE });

  let ready = false;
  for (let i = 0; i < 40; i++) { await sleep(250); if (await ev(`return !!window.SMD_PRO_NOTICE`) === true) { ready = true; break; } }
  ok(ready, "pro-notice.js loaded on a real page");
  if (!ready) throw new Error("module never loaded");

  // ── the case that matters most: unverified must NOT be sold to ──
  await asState(`{pro:false, reason:"unverified", verified:false}`);
  await ev(`SMD_PRO_NOTICE.show("cloud-sync"); return 1;`);
  ok(await ev(`return !!document.getElementById("smdProNotice")`) === true, "dialog renders");
  const t = String(await ev(`return document.getElementById("smdProNotice").innerText`));
  ok(/verified registration/i.test(t), `explains the real reason (got: ${JSON.stringify(t.slice(0, 70))})`);
  ok(/Cross-device case sync/.test(t), "names the feature the doctor actually tapped");
  ok(!/₹|price|plans/i.test(t), "shows no price to someone who has not been asked to verify yet");
  await press();
  ok(String(await ev(`return JSON.stringify(window.__acted)`)).includes("verify"),
     "the button opens VERIFICATION, not the paywall");
  ok(await ev(`return document.getElementById("smdProNotice") === null`) === true,
     "dialog closes after acting");

  // ── free week over: a paywall is now the honest answer ──
  await asState(`{pro:false, reason:"verified-week-expired", verified:true}`);
  await ev(`SMD_PRO_NOTICE.show("lab-watch"); return 1;`);
  ok(/free Pro week has ended/i.test(String(await ev(`return document.getElementById("smdProNotice").innerText`))),
     "expired week is explained plainly");
  await press();
  ok(String(await ev(`return JSON.stringify(window.__acted)`)).includes("paywall:lab-watch"),
     "the button opens the paywall, tagged with the feature");

  // ── pending review: never a price, and no 'Not now' since there is nothing to decline ──
  await asState(`{pro:false, pendingReview:true, reason:"unverified"}`);
  await ev(`SMD_PRO_NOTICE.show("ward-sync"); return 1;`);
  const p = String(await ev(`return document.getElementById("smdProNotice").innerText`));
  ok(/reviewing/i.test(p), "tells them it is being reviewed");
  ok(!/plans|subscribe/i.test(p), "no price for someone already waiting on us");
  ok(await ev(`return document.querySelectorAll("#smdProNotice button").length === 1`) === true,
     "single acknowledge button, nothing to decline");

  // ── handle() drives the whole thing straight off a 402 body ──
  await asState(`null`);
  ok(await ev(`return SMD_PRO_NOTICE.handle({needsPro:true, reason:"unverified", message:"Server wording here."}, "maik")`) === true,
     "handle() reports it dealt with the refusal");
  ok(/Server wording here\./.test(String(await ev(`return document.getElementById("smdProNotice").innerText`))),
     "the server's own sentence is what the doctor reads");
  ok(await ev(`SMD_PRO_NOTICE.close(); return SMD_PRO_NOTICE.handle({error:"server"}, "maik")`) === false,
     "a non-Pro failure is left alone for normal error handling");

  console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed");
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
process.exit(fails ? 1 : 0);
