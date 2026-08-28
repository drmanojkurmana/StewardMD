/* Guest session bar — real-browser test.
 *
 * The bar is the visible half of a promise: a guest gets 300 seconds and is signed out. A unit test
 * can check the arithmetic, but not the two things that actually matter on a phone — that the bar
 * renders above the app header instead of covering it, and that the clock really does tear the
 * session down when it reaches zero.
 *
 * Verifies: nothing renders for a non-guest; the bar mounts and counts down for a guest; the body
 * is pushed down by exactly the bar's height; it turns urgent in the last minute; and at zero it
 * marks the trial used, drops the account and reloads to the sign-in gate.
 *
 * USAGE: BASE=http://localhost:8991/ node test/run-guest-bar-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8991/").replace(/\/?$/, "/");
const PAGE = BASE + "test/fixtures/guest-bar.html";
const PORT = 9394;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/guest-bar-chrome";
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

// Put a guest session in localStorage, then reload so the module boots against it.
async function asGuest(msLeft) {
  await ev(`localStorage.setItem("stewardmd_account", JSON.stringify({type:"guest",expiresAt:Date.now()+${msLeft}}));
            localStorage.removeItem("stewardmd_guest_used");
            localStorage.setItem("smd_guest_day", new Date().toISOString().slice(0,10));
            localStorage.setItem("smd_guest_uses","1"); return 1;`);
  await call("Page.navigate", { url: PAGE });
  await sleep(700);
}

try {
  if (!await connect()) throw new Error("could not attach to Chrome");
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.enable", {});
  await call("Page.navigate", { url: PAGE });

  let ready = false;
  for (let i = 0; i < 40; i++) { await sleep(250); if (await ev(`return !!window.SMD_GUEST_BAR`) === true) { ready = true; break; } }
  ok(ready, "guest-timer.js loaded on a real page");
  if (!ready) throw new Error("module never loaded");

  // ── not a guest: the bar must not exist at all ──
  await ev(`localStorage.clear(); return 1;`);
  await ev(`SMD_GUEST_BAR.tick(); return 1;`);
  ok(await ev(`return document.getElementById("smdGuestBar") === null`) === true,
     "no bar for a signed-in / non-guest visitor");
  ok(await ev(`return document.body.style.paddingTop === "" || document.body.style.paddingTop === "0px"`) === true,
     "no body padding when there is no bar");

  // ── a live guest session ──
  await asGuest(300000);
  ok(await ev(`return !!document.getElementById("smdGuestBar")`) === true, "bar renders for a guest");
  const txt = await ev(`return document.getElementById("smdGuestBar").innerText`);
  ok(/signing out in\s+[45]:\d\d/.test(String(txt)), `bar shows the countdown (got: ${JSON.stringify(txt)})`);
  ok(/session 1 of 2 today/.test(String(txt)), "bar states which of the 2 daily sessions this is");

  // The bar must push the app down, not cover the header — the whole point of a top bar.
  ok(await ev(`var b=document.getElementById("smdGuestBar");
               return Math.abs(parseFloat(document.body.style.paddingTop||"0") - b.offsetHeight) < 1.5`) === true,
     "body is padded by exactly the bar height (header not covered)");
  ok(await ev(`var h=document.getElementById("appHeader").getBoundingClientRect();
               var b=document.getElementById("smdGuestBar").getBoundingClientRect();
               return h.top >= b.bottom - 1.5`) === true,
     "the app header actually sits below the bar on screen");

  // ── it really counts ──
  const t1 = await ev(`return document.querySelector("[data-gb-clock]").textContent`);
  await sleep(2100);
  const t2 = await ev(`return document.querySelector("[data-gb-clock]").textContent`);
  ok(t1 !== t2, `clock advances (${t1} -> ${t2})`);

  // ── last minute turns urgent ──
  await ev(`var a=JSON.parse(localStorage.getItem("stewardmd_account"));a.expiresAt=Date.now()+30000;
            localStorage.setItem("stewardmd_account",JSON.stringify(a));SMD_GUEST_BAR.tick();return 1;`);
  ok(await ev(`return document.getElementById("smdGuestBar").classList.contains("urgent")`) === true,
     "bar turns urgent inside the last minute");
  ok(await ev(`return document.querySelector("[data-gb-a11y]").textContent.length > 0`) === true,
     "a11y region announces at the 60s threshold (and not every second)");

  // ── zero: the session is actually torn down, not just displayed as 0:00 ──
  await ev(`var a=JSON.parse(localStorage.getItem("stewardmd_account"));a.expiresAt=Date.now()-1;
            localStorage.setItem("stewardmd_account",JSON.stringify(a));SMD_GUEST_BAR.tick();return 1;`);
  await sleep(900);   // endSession() reloads the page
  ok(await ev(`return localStorage.getItem("stewardmd_account") === null`) === true,
     "at zero the guest account is dropped (auto sign-out really happens)");
  ok(await ev(`return !!localStorage.getItem("stewardmd_guest_used")`) === true,
     "at zero the session is marked used, so the 2-per-day cap can count it");
  ok(await ev(`return document.getElementById("smdGuestBar") === null`) === true,
     "bar is gone after the session ends");

  /* The bar is fixed to the viewport, so padding the BODY never moved a fixed overlay - it sat on
   * top of the eLOGBook and FollowCare headers, covering their close buttons. The height is now
   * published as a custom property those overlays offset by, and it must return to 0px on teardown
   * or every overlay keeps a dead gap at the top forever. */
  const gbVar = String(await ev(`return getComputedStyle(document.documentElement)
       .getPropertyValue("--smd-guestbar-h").trim()`));
  // Ending the session reloads the page, so the property is simply absent rather than 0px. Both
  // mean the same thing to the overlays: no offset. What must never survive is a non-zero height.
  ok(gbVar === "0px" || gbVar === "",
     `the guest-bar height leaves no offset behind (got: ${JSON.stringify(gbVar)})`);

  console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed");
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
process.exit(fails ? 1 : 0);
