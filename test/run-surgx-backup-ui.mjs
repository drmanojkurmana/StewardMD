/* SURGX Notes backup card (real headless browser). Deliberately SHORT: this app calls
 * location.reload() when the guest session expires, which wipes a long run mid-test.
 *
 * What only a browser can show, and what matters most here, is the SAFETY behaviour of the control:
 * one tap must ARM and explain, never send. The merge rules and the Drive round trip are covered
 * deterministically in test/surgx-backup.test.mjs.
 *
 * USAGE: node test/run-surgx-backup-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8992/").replace(/\/?$/, "/");
const PORT = 9405, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/surgx-bk-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
try { await fetch(BASE); } catch {
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8992"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE + "?surgx=1" });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.SURGX && window.SMD_SURGX_BACKUP && window.SMD_SURGX_DEST)`) === true) { ready = true; break; } }
  ok(ready, "SURGX and the backup module load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);

  ok(await ev(`return !!(window.SMD_SURGX_DEST.driveToken && window.SMD_SURGX_DEST.driveFolderId);`) === true,
    "the backup reuses the destinations layer's Drive token + folder (one integration, not two)");

  // Notes is role-gated on the app's clinician gate; take the primary path with a verified stub.
  await ev(`window.SMD_VERIFY = { isVerified: function(){ return Promise.resolve(true); }, openPanel: function(){} }; return 1;`);
  await ev(`SURGX.open(); return 1;`); await sleep(1200);

  // Without a Drive account the card must say so honestly rather than offer a dead button.
  await ev(`try{ delete window.SMD_getDriveToken; }catch(e){} SMD_SURGX_SCREENS.go("notes"); return 1;`); await sleep(1000);
  const offReason = await ev(`var e=document.querySelector("#surgxRoot .sgx-bk-off"); return e?e.textContent.trim():"";`);
  if (await ev(`return !!document.querySelector("#surgxRoot .sgx-bk-h");`) === true) {
    ok(/installed app/i.test(offReason), "with no Drive account it explains why, instead of a dead button (" + offReason + ")");
  } else {
    ok(false, "the Notes screen did not render the backup card (notes may be role-gated in this build)");
  }

  // With a Drive account AND a note to send, both controls are live. (Back up is correctly
  // disabled when there is nothing on the device, so seed one through the real encrypted store.)
  await ev(`window.SMD_getDriveToken = function(){ return "tok"; }; return 1;`);
  await ev(`window.__seed = 0; SMD_SURGX_STORE.saveNote({ type:"operative", label:"Test note", values:{}, provenance:{} }).then(function(r){ window.__seed = r && r.ok ? 1 : -1; }); return 1;`);
  for (let i = 0; i < 20; i++) { await sleep(250); if (await ev(`return window.__seed;`) !== 0) break; }
  ok(await ev(`return window.__seed;`) === 1, "a note can be written to the encrypted device store");
  await ev(`SMD_SURGX_SCREENS.go("protocols"); return 1;`); await sleep(400);
  await ev(`SMD_SURGX_SCREENS.go("notes"); return 1;`); await sleep(1000);
  ok(await ev(`return !!document.querySelector('#surgxRoot [data-sgx="bkup"]');`) === true, "a Back up control is offered");
  ok(await ev(`return !!document.querySelector('#surgxRoot [data-sgx="bkrestore"]');`) === true, "a Restore control is offered");

  /* THE safety property: one tap must ARM, not send. */
  await ev(`window.__sent = 0; var b = SMD_SURGX_BACKUP; b.__backupNow = b.backupNow; b.backupNow = function(o){ window.__sent++; return b.__backupNow(o); }; return 1;`);
  await ev(`var b=document.querySelector('#surgxRoot [data-sgx="bkrestore"]'); if(b) b.click(); return 1;`); await sleep(500);
  ok(await ev(`return document.querySelector('#surgxRoot [data-sgx="bkrestore"]').getAttribute("data-armed");`) === "1",
    "one tap ARMS the control rather than acting");
  ok(/tap again/i.test(await ev(`return document.querySelector('#surgxRoot [data-sgx="bkrestore"]').textContent;`)),
    "and the label says another tap is needed");
  ok((await ev(`var e=document.querySelector("#sgxBkMsg"); return e?e.textContent.trim():"";`)).length > 10,
    "with an explanation of what the second tap will do");

  // Arming the other control must disarm this one, so a stray tap cannot fire the wrong action.
  await ev(`var b=document.querySelector('#surgxRoot [data-sgx="bkup"]'); if(b) b.click(); return 1;`); await sleep(400);
  ok(await ev(`return document.querySelector('#surgxRoot [data-sgx="bkrestore"]').getAttribute("data-armed");`) === null,
    "arming Back up disarms Restore (only one action armed at a time)");
  ok(await ev(`return window.__sent;`) === 0, "nothing has been sent to Drive by any of this");

  console.log(fails === 0 ? "\nALL GREEN — the backup card is offered, explains itself, and never sends on one tap" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
