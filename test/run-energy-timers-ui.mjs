/* energy-timers branch — real headless-browser check (pattern: test/run-maik-audit-a-ui.mjs).
 *
 * Proves, in a real browser against the real app, that:
 *   - workspaces.js's #dxOverlay pill/watermark attaches via the new body MutationObserver the
 *     instant #dxOverlay is appended (no 400ms poll needed any more).
 *   - swipe-back.js's 900ms handle-sync poll does nothing while document.hidden, and resumes
 *     correctly once visible again.
 *   - guest-timer.js's 1s countdown poll does nothing while document.hidden (the clock freezes),
 *     and resumes ticking down once visible again — real guest session, real #guestBtn click.
 * document.hidden/visibilityState are overridden via Object.defineProperty + a dispatched
 * visibilitychange event, per the task spec (NOT Page.setWebLifecycleState — that also throttles
 * timers, which would hide a real bug behind the browser's own throttling).
 *
 * Also measures Performance.getMetrics() TaskDuration over 10s of home-screen idle, current tree
 * vs. origin/main (exported read-only via `git archive`, no working-tree changes), to sanity-check
 * the fix isn't burning MORE main-thread time than before.
 *
 * USAGE: node test/run-energy-timers-ui.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

// ---- one CDP session against one served root -----------------------------------------------
async function session(root, port, cdpPort, label) {
  const userDir = mkdtempSync(join(tmpdir(), "energy-timers-chrome-"));
  const serveProc = spawn("node", [join(HERE, "serve.mjs"), root, String(port)], { stdio: "ignore" });
  const base = `http://localhost:${port}/`;
  for (let i = 0; i < 40; i++) { try { await fetch(base); break; } catch { await sleep(200); } }
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

  let msgId = 1; const pending = new Map(); let ws, sid;
  const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
  const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true, awaitPromise: false }); return r.result && r.result.result ? r.result.result.value : null; };

  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${cdpPort}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {});
  await call("Page.enable", {});
  await call("Performance.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  // swipe-back.js only arms its handle-sync poll when isNative || standalone display-mode — force
  // standalone so the SAME production gate the app ships with is exercised, not a test-only bypass.
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `(function () { var real = window.matchMedia; window.matchMedia = function (q) {
      if (/display-mode:\\s*standalone/.test(q)) return { matches: true, media: q, addListener: function () {}, removeListener: function () {} };
      return real.call(window, q);
    }; })();`
  });
  await call("Page.navigate", { url: base });

  let ready = false;
  for (let i = 0; i < 75; i++) {
    await sleep(300);
    if (await ev(`return document.readyState === "complete" && !!(window.SMD_SWIPE_BACK && window.SMD_GUEST_BAR)`) === true) { ready = true; break; }
  }
  console.log((ready ? "PASS " : "FAIL ") + `[${label}] the app loads with SMD_SWIPE_BACK + SMD_GUEST_BAR ready`);
  if (!ready) fails++;
  // Only drop the splash/intro layers — #accountGate/#guestBtn must stay in the DOM, the
  // guest-timer check below clicks the real button.
  await ev(`["introPoster","splash","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);

  const setHidden = (h) => ev(`try {
      Object.defineProperty(document, "hidden", { get: function () { return ${h}; }, configurable: true });
      Object.defineProperty(document, "visibilityState", { get: function () { return "${h ? "hidden" : "visible"}"; }, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      return 1;
    } catch (e) { return "ERR:" + e.message; }`);

  const taskDuration = async () => { const r = await call("Performance.getMetrics", {}); const m = r.result.metrics.find(x => x.name === "TaskDuration"); return m ? m.value : null; };

  return {
    ev, setHidden, taskDuration,
    close: async () => {
      try { ws.close(); } catch {}
      chrome.kill(); serveProc.kill();
      await sleep(300);   // let Chrome release its profile dir before we delete it
      try { rmSync(userDir, { recursive: true, force: true }); } catch {}
    }
  };
}

let after = null, before = null, beforeDir = null;
try {
  // ================= FUNCTIONAL: current tree (the fix) =================
  after = await session(REPO, 8981, 9399, "after");

  // --- A: workspaces.js — #dxOverlay decoration attaches via MutationObserver, no 400ms poll ---
  await after.ev(`document.body.appendChild(Object.assign(document.createElement("div"), { id: "dxOverlay", className: "on" }));return 1;`);
  await sleep(120);   // well under the OLD 400ms poll interval
  const wmAttached = await after.ev(`return !!document.querySelector("#dxOverlay .sw-wm")`);
  ok(wmAttached === true, "workspaces.js: #dxOverlay gets its watermark within 120ms of being appended (MutationObserver, not the old 400ms poll)");
  await after.ev(`var o=document.getElementById("dxOverlay"); if(o) o.remove(); return 1;`);

  // --- B: swipe-back.js — 900ms poll does nothing while hidden, resumes once visible ---
  // Force canGoBack() true (a fake open "ATLAS" overlay) and neutralise wouldOverlap()'s
  // elementsFromPoint geometry probe (unrelated to the fix — the real home screen has its own
  // top-left header controls that legitimately suppress the handle) so the "show" gate is only
  // driven by the thing we changed: whether the poll runs at all.
  // homeIsForeground() (checked before ATLAS) needs home to actually NOT be what's on screen — cover
  // it with a real full-viewport layer so that check agrees, instead of only faking ATLAS.isOpen().
  await after.ev(`document.body.appendChild(Object.assign(document.createElement("div"), { id: "__fakeOverlay", style: "position:fixed;inset:0;z-index:999999;background:transparent;" }));
    window.ATLAS = { isOpen: function () { return true; } };
    window.__realElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = function () { return []; }; return 1;`);
  await sleep(1100);
  const bVis1 = await after.ev(`var b = document.getElementById("smdTopBack"); return b ? b.style.visibility : null;`);
  ok(bVis1 === "visible", `swipe-back.js: the back handle appears within ~1.1s while visible (canGoBack forced true) [got ${bVis1}]`);

  await after.ev(`window.ATLAS.isOpen = function () { return false; }; return 1;`);   // canGoBack now false
  await after.setHidden(true);
  await sleep(1100);
  const bVis2 = await after.ev(`var b = document.getElementById("smdTopBack"); return b ? b.style.visibility : null;`);
  ok(bVis2 === "visible", `swipe-back.js: the poll does NOT re-sync while document.hidden — handle stays as it was [got ${bVis2}, expected unchanged "visible"]`);

  await after.setHidden(false);
  await sleep(1100);
  const bVis3 = await after.ev(`var b = document.getElementById("smdTopBack"); return b ? b.style.visibility : null;`);
  ok(bVis3 === "hidden", `swipe-back.js: the poll resumes once visible again and re-syncs to "hidden" [got ${bVis3}]`);

  // --- C: guest-timer.js — 1s poll freezes the clock while hidden, resumes once visible ---
  await after.ev(`var fo = document.getElementById("__fakeOverlay"); if (fo) fo.remove(); window.ATLAS = null;
    if (window.__realElementsFromPoint) document.elementsFromPoint = window.__realElementsFromPoint; return 1;`);
  await after.ev(`localStorage.removeItem("stewardmd_account"); localStorage.removeItem("stewardmd_guest_used"); return 1;`);
  const clicked = await after.ev(`var b = document.getElementById("guestBtn"); if (!b) return "no-btn"; b.click(); return 1;`);
  await sleep(200);
  const acct = await after.ev(`return localStorage.getItem("stewardmd_account");`);
  const isGuest = (() => { try { return JSON.parse(acct || "null"); } catch { return null; } })();
  ok(clicked === 1 && isGuest && isGuest.type === "guest", `guest-timer.js: clicking #guestBtn grants a real guest session [account=${acct}]`);

  if (isGuest && isGuest.type === "guest") {
    const clock0 = await after.ev(`var e = document.querySelector("#smdGuestBar [data-gb-clock]"); return e ? e.textContent : null;`);
    await after.setHidden(true);
    await sleep(1100);
    const clock1 = await after.ev(`var e = document.querySelector("#smdGuestBar [data-gb-clock]"); return e ? e.textContent : null;`);
    ok(clock0 !== null && clock1 === clock0, `guest-timer.js: the countdown clock does NOT advance while document.hidden [t0=${clock0} t1=${clock1}]`);

    await after.setHidden(false);
    await sleep(1300);
    const clock2 = await after.ev(`var e = document.querySelector("#smdGuestBar [data-gb-clock]"); return e ? e.textContent : null;`);
    ok(clock2 !== null && clock2 !== clock1, `guest-timer.js: the countdown resumes ticking once visible again [t1=${clock1} t2=${clock2}]`);
  } else {
    ok(false, "guest-timer.js: skipped countdown checks — no guest session was granted");
  }

  // ================= PERF: 10s home-screen idle, TaskDuration =================
  await after.ev(`window.ATLAS = null; localStorage.removeItem("stewardmd_account"); return 1;`);
  await after.setHidden(false);
  const t0a = await after.taskDuration();
  await sleep(10000);
  const t1a = await after.taskDuration();
  const afterDelta = t1a - t0a;
  console.log(`INFO  [after]  TaskDuration over 10s home idle: ${afterDelta.toFixed(4)}s of main-thread time`);
  await after.close(); after = null;   // free the chrome profile + process before starting a second instance

  // ================= PERF: same 10s idle against origin/main (pre-fix) =================
  beforeDir = mkdtempSync(join(tmpdir(), "energy-timers-premain-"));
  mkdirSync(beforeDir, { recursive: true });
  execFileSync("sh", ["-c", `git archive origin/main | tar -x -C "${beforeDir}"`], { cwd: REPO });
  before = await session(beforeDir, 8982, 9398, "before/origin-main");
  const t0b = await before.taskDuration();
  await sleep(10000);
  const t1b = await before.taskDuration();
  const beforeDelta = t1b - t0b;
  console.log(`INFO  [before] TaskDuration over 10s home idle: ${beforeDelta.toFixed(4)}s of main-thread time`);
  console.log(`INFO  delta: ${(afterDelta - beforeDelta).toFixed(4)}s (negative = the fix uses LESS main-thread time while idle)`);

  console.log(fails === 0 ? "\nALL GREEN: energy-timers behaves in a real browser" : `\n${fails} FAILED`);
} catch (e) {
  console.error("HARNESS ERROR:", e.message);
  fails++;
} finally {
  if (after) await after.close();
  if (before) await before.close();
  if (beforeDir) try { rmSync(beforeDir, { recursive: true, force: true }); } catch {}
  process.exit(fails === 0 ? 0 : 1);
}
