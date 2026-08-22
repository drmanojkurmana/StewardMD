/* The StewardMD ID must be readable WITHOUT Group mode.
 *
 * Before this fix the ID card lived only on the group Team screen, and the ID itself was minted
 * only once Group mode was on and a unit resolved — so a resident waiting to be added to someone
 * else's unit had nothing to read out. This drives the real ICU UI in SOLO mode and asserts the
 * card renders with the account's ID and a working Copy action. No PHI, no network identity.
 * USAGE: node test/run-icu-stewardid-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8916/").replace(/\/?$/, "/");
const PORT = 9433, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-smdid-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8916"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");

  // The universal-identity module must be present and flagged to mint by default (no opt-in).
  const mods = await J(`return JSON.stringify({
    id: !!window.SMD_STEWARD_ID, onboard: !!window.SMD_STEWARD_ONBOARD,
    mint: !!(window.SMD_STEWARD_ID_FLAGS && window.SMD_STEWARD_ID_FLAGS.bool("smd_steward_id_mint")),
    anchor: !!(window.SMD_STEWARD_ID_FLAGS && window.SMD_STEWARD_ID_FLAGS.bool("smd_steward_id"))
  });`);
  ok(mods.id && mods.onboard, `identity modules load on the app shell (${JSON.stringify(mods)})`);
  ok(mods.mint === true, `the universal mint is ON by default (no flag to flip)`);
  ok(mods.anchor === false, `the anchor-email capture UI stays OFF by default (unchanged)`);

  // SOLO mode (group mode off), Team screen. Stub only the resolved ID — the mint itself needs a
  // real Firebase sign-in, which a headless harness has no business doing.
  const solo = await J(`
    try { localStorage.setItem("smd_icu_groups","0"); } catch(e){}
    window.SMD_STEWARD_ID.my = function(){ return "SMD-QT7K42"; };
    ICU.open();
    var b = document.querySelector('[data-icu-act="icuteam"]'); if (b) b.click();
    var card = document.querySelector("#icuRoot .icu-v2-idcard");
    var code = document.querySelector("#icuRoot .icu-v2-idcard-code");
    var copy = document.querySelector('#icuRoot [data-icu-act="grpcopyid"]');
    return JSON.stringify({ card: !!card, code: code ? code.textContent.trim() : "", copy: !!copy,
      groupOn: !!(localStorage.getItem("smd_icu_groups") === "1") });
  `);
  ok(solo.groupOn === false, `precondition: Group mode is OFF`);
  ok(solo.card === true, `the StewardMD ID card renders on the SOLO Team screen`);
  ok(solo.code === "SMD-QT7K42", `it shows this account's ID (got "${solo.code}")`);
  ok(solo.copy === true, `Copy is offered so the ID can be read out / pasted`);

  // Copy must carry the ID even though _grpDoctorId (the group-mode variable) was never set.
  const copied = await J(`
    var got = null;
    try { navigator.clipboard.writeText = function(v){ got = v; return Promise.resolve(); }; } catch(e){}
    var b = document.querySelector('#icuRoot [data-icu-act="grpcopyid"]'); if (b) b.click();
    return JSON.stringify({ got: got });
  `);
  ok(copied.got === "SMD-QT7K42", `Copy puts the ID on the clipboard (got ${JSON.stringify(copied.got)})`);

  console.log(fails === 0 ? "\nALL GREEN — StewardMD ID is available without Group mode" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
