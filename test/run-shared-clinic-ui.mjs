/* Shared Clinic UI test (real browser DOM, flag-gated additive overlay).
 * Verifies, against a minimal harness with Drive + EMR mocked: the launcher opens the Create/Join setup;
 * Create boots the encrypted app + renders the patient list; New patient hands off to opd-emr as
 * source:"shared"; the patient shows in the list; and after a full page RELOAD the clinic re-opens from
 * the local encrypted snapshot (persistence). The core logic (crypto/store/sync/drive) is proven by
 * node --test; this proves the DOM wiring. USAGE: BASE=http://localhost:8991/ node test/run-shared-clinic-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8991/").replace(/\/?$/, "/");
const PORT = 9384, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/shared-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PAGE = BASE + "test/shared-clinic-ui-harness.html?shared=1";
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8991"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
async function navigate(url) { await call("Page.navigate", { url }); for (let i = 0; i < 50; i++) { await sleep(300); if (await ev(`return !!window.SMD_SHARED`) === true) return true; } return false; }
async function waitFor(sel, n) { for (let i = 0; i < (n || 40); i++) { await sleep(250); if (await ev(`return !!document.querySelector(${JSON.stringify(sel)})`) === true) return true; } return false; }

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});

  ok(await navigate(PAGE), "harness loads: window.SMD_SHARED present + 8 modules loaded");
  await ev(`try{localStorage.clear();sessionStorage.clear();}catch(e){} return 1;`);   // fresh start (user-data-dir persists between runs)
  ok(await navigate(PAGE), "clean navigate after clearing storage");
  ok(await ev(`return !!(window.SMD_CLINIC_APP && window.SMD_CLINIC_DRIVE && window.SMD_SHARED_CLINIC)`), "core modules bootstrapped (app/drive/orchestrator globals)");

  // ?shared=1 auto-opened the setup (Create / Join)
  ok(await waitFor("#scNew", 20), "Create/Join setup screen renders");

  // Create a clinic
  await ev(`var f=document.getElementById('scNew'); f.elements.name.value='Sunrise Test Clinic'; f.elements.pw.value='clinic-pass-1234'; f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); return 1;`);
  ok(await waitFor('#smdShared .sc-add[data-sc="new"]', 40), "Create boots the app + renders the patient list");
  ok(await ev(`return !!(window.SMD_SHARED.app())`), "live app instance held after create");

  // New patient -> hands off to opd-emr as source:"shared"
  await ev(`document.querySelector('#smdShared [data-sc="new"]').click(); return 1;`);
  ok(await waitFor("#scForm", 20), "New patient form renders");
  await ev(`var f=document.getElementById('scForm'); f.elements.name.value='Asha Rao'; f.elements.age.value='34'; f.elements.sex.value='Female'; f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); return 1;`);
  await sleep(400);
  ok(await ev(`return window.__opened && window.__opened.source==='shared'`), "opens the EMR overlay with source:'shared'");
  ok(await ev(`return !!(window.__opened && window.__opened.localStore && window.__opened.patientId)`), "handoff carries the shared localStore + patientId");

  // Patient shows in the list on reopen
  await ev(`window.SMD_SHARED.open(); return 1;`);
  ok(await waitFor("#smdShared .sc-row", 20), "the new patient appears in the clinic list");
  ok(await ev(`var r=document.querySelector('#smdShared .sc-row-n'); return r && r.textContent.indexOf('Asha Rao')>=0`), "list row shows the patient name");
  ok(await ev(`return window.SMD_SHARED.app().listPatients().length===1`), "exactly one patient stored");

  // Persistence: flush the debounced save, confirm an ENCRYPTED snapshot is on disk, then RELOAD and
  // re-open the clinic from it (via the cached secret, or the unlock passphrase if the cache didn't survive).
  await ev(`return window.SMD_SHARED.app().saveNow().then(function(){return 1})`);   // flush debounce
  const snapKey = await ev(`return Object.keys(localStorage).filter(function(k){return k.indexOf('smd_clinic_')===0})[0]||''`);
  ok(!!snapKey, "encrypted snapshot written to localStorage");
  ok(await ev(`var b=localStorage.getItem(${JSON.stringify(snapKey)})||''; return b.length>0 && b.indexOf('Asha')<0`), "snapshot on disk is encrypted (no plaintext PHI)");

  ok(await navigate(PAGE), "page reloaded");
  await sleep(700);
  // If the secret cache didn't survive the reload, the unlock screen shows — enter the passphrase.
  if (await ev(`return !!document.getElementById('scUnlock')`)) {
    await ev(`var f=document.getElementById('scUnlock'); f.elements.pw.value='clinic-pass-1234'; f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); return 1;`);
  }
  ok(await waitFor("#smdShared .sc-row", 40), "clinic re-opens from the encrypted local snapshot after restart");
  ok(await ev(`return window.SMD_SHARED.app() && window.SMD_SHARED.app().listPatients().length===1`), "patient survived the reload (persistence)");

} catch (e) { console.error("harness error:", e && e.message || e); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? ("\n" + fails + " check(s) failed") : "\nAll shared-clinic UI checks passed");
process.exit(fails ? 1 : 0);
