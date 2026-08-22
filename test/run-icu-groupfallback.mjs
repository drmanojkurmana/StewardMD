/* BUG B6 (2026-08-22 ward-round audit): with Group mode on and the shared unit unreachable, the
 * board used to show a spinner then a full error card for up to 20s+ while HIDING the patients
 * already saved on this very device (the group board renders only the shared list) - hospital
 * wifi failing at 3am is exactly when this bites. It now falls back to the device roster,
 * read-only, under a persistent amber banner, and tapping a card opens it locally (not via the
 * unreachable Firestore path a normal board card would use).
 * USAGE: node test/run-icu-groupfallback.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8920/").replace(/\/?$/, "/");
const PORT = 9455, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-grpfallback-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8920"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.stack||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "?tour=0" });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.savePatient)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");

  // The roster key is owner-scoped (rosterKey() reads window.SMD_AUTH.currentUser.uid) - fix the
  // identity FIRST so the seed-save and the later fallback-read land on the SAME key.
  await ev(`window.SMD_AUTH = { currentUser: { uid: "test-uid" } }; return 1;`);

  // Seed a device-local patient FIRST, in solo mode (the realistic "already have patients saved on
  // this phone" scenario), then switch group mode ON with a fake collab API that fails to connect.
  const seeded = await J(`
    try { for (var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k&&k.indexOf("stewardmd_icu_patients")===0) localStorage.removeItem(k); } } catch(e){}
    localStorage.setItem("smd_icu_groups", "0");
    ICU.reset(); ICU.ingestPatient({ name: "Local Pt", bed: "5", diagnosis: "COPD exacerbation" }); ICU.savePatient();
    return JSON.stringify({ n: ICU.listPatients().length });
  `);
  ok(seeded.n === 1, `a patient is saved locally before group mode is even touched (${seeded.n})`);

  const wired = await J(`
    window.__unsubCalls = 0;
    window.SMD_ICU_GROUPS = {
      setSeverityFn: function () {},
      ensureIdentity: function () {},
      setActiveGroup: function () {},
      subscribeGroups: function (okCb) { setTimeout(function () { okCb([{ id: "g1", name: "Test ICU Unit", kind: "icu" }]); }, 20); return function () { window.__unsubCalls++; }; },
      subscribePatients: function (gid, okCb, errCb) { setTimeout(function () { errCb(new Error("network-error")); }, 20); return function () { window.__unsubCalls++; }; }
    };
    localStorage.setItem("smd_icu_groups", "1");
    ICU.reset();
    ICU.open();
    return JSON.stringify({ ok: true });
  `);
  ok(wired.ok === true, "group mode turned on with a fake collab API that will fail to connect");

  let banner = null;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    banner = await J(`
      var root = document.getElementById("icuRoot");
      var note = root ? root.querySelector(".icu-v2-note") : null;
      return JSON.stringify({ noteText: note ? note.textContent : null, cards: root ? root.querySelectorAll(".icu-v2-card").length : 0, errCard: root ? !!root.querySelector(".icu-v2-errcard") : false });
    `);
    if (banner.noteText || banner.errCard) break;
  }
  ok(!!(banner && banner.noteText && /unreachable/i.test(banner.noteText)), `a persistent banner names the shared unit as unreachable (got "${banner && banner.noteText}")`);
  ok(!!(banner && /showing.*device/i.test(banner.noteText || "")), `...and says it's showing device-local patients, not the live shared list`);
  ok(banner && banner.cards === 1, `the locally-saved patient still renders as a card (${banner && banner.cards})`);
  ok(banner && banner.errCard === false, `the old full-screen error card does NOT take over when local patients exist (${banner && banner.errCard})`);

  // Tapping the fallback card must open it LOCALLY (loadPatient), not via the unreachable
  // Firestore path a normal "openpt" card would use while grpActive() is still true.
  const tapped = await J(`
    var root = document.getElementById("icuRoot");
    var card = root.querySelector(".icu-v2-card");
    return JSON.stringify({ act: card ? card.getAttribute("data-icu-act") : null });
  `);
  ok(/^openptlocal:/.test(tapped.act || ""), `the fallback card uses openptlocal, not openpt (got "${tapped.act}")`);
  const opened = await J(`
    var card = document.getElementById("icuRoot").querySelector(".icu-v2-card"); card.click();
    return "ok";
  `);
  await sleep(300);
  const patientOpen = await J(`
    var root = document.getElementById("icuRoot");
    var banner = root.querySelector(".icu-v2-banner-nm, .icu-v2-banner-id");
    return JSON.stringify({ text: banner ? root.textContent.slice(0, 400) : null, hasPatientView: !!root.querySelector(".icu-v2-banner") });
  `);
  ok(patientOpen.hasPatientView === true && /Local Pt/.test(patientOpen.text || ""), `tapping the card actually opens the local patient's workspace (${JSON.stringify(patientOpen)})`);

  console.log(fails === 0 ? "\nALL GREEN — B6 (group-mode unreachable hides local patients) fixed: falls back to the device roster, read-only, opens locally" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
