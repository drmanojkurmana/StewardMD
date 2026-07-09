/* KI-M3 — the live ICU buffer (PHI: name/bed/labs/imaging) must be scoped PER signed-in account
 * so two clinicians sharing one physical device never read each other's open patient, even if the
 * auth-reset doesn't fire. Controls the owner via a stubbed SMD_AUTH + the OWNER_KEY and exercises
 * reconcileOwner(). Synthetic patients only. USAGE: node test/run-icu-buffer-scope.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8923/").replace(/\/?$/, "/");
const PORT = 9425, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-buf-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const K = "stewardmd_icu_state", OWNER = "stewardmd_icu_owner";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8923"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };
// clear all scoped/legacy buffer + owner keys between scenarios
const CLR = `Object.keys(localStorage).forEach(function(k){ if(k.indexOf("${K}")===0||k==="${OWNER}") localStorage.removeItem(k); });`;
const setOwner = (uid) => uid ? `window.SMD_AUTH={currentUser:{uid:"${uid}"}};` : `window.SMD_AUTH={currentUser:null};`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU._bufKey && ICU._reconcileOwner && ICU._resetBufSync)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");

  // T1 — key reflects the owner
  ok(await ev(`${setOwner("userA")} return ICU._bufKey();`) === "stewardmd_icu_state:userA", "buffer key is scoped to the signed-in account");
  ok(await ev(`${setOwner(null)} return ICU._bufKey();`) === "stewardmd_icu_state:anon", "buffer key falls back to :anon when signed out");

  // T2 — isolation: signing in as B does NOT read A's buffer
  const t2 = await J(`${CLR}
    localStorage.setItem("${K}:userA", JSON.stringify({ patient:{ name:"Alpha-A" } }));   // A's open patient
    localStorage.setItem("${OWNER}","userA");                                              // last owner = A
    ${setOwner("userB")} ICU._resetBufSync(); ICU._reconcileOwner();
    return JSON.stringify({ bName: (ICU.state().patient||{}).name || null });`);
  ok(t2.bName !== "Alpha-A", "isolation: clinician B does NOT see clinician A's open patient (name=" + t2.bName + ")");

  // T3 — persist writes to the per-owner key (not the legacy unscoped key)
  const t3 = await J(`${CLR}
    localStorage.setItem("${OWNER}","userP"); ${setOwner("userP")} ICU._resetBufSync(); ICU._reconcileOwner();
    ICU.reset(); ICU.ingestPatient({ name:"Persist-Me" });
    return "1";`);
  await sleep(200);
  const t3b = await J(`return JSON.stringify({ scoped: /Persist-Me/.test(localStorage.getItem("${K}:userP")||""), legacy: localStorage.getItem("${K}")===null });`);
  ok(t3b.scoped, "persist writes the live buffer to the per-owner key");
  ok(t3b.legacy, "persist does NOT write to the legacy unscoped key");

  // T4 — real account switch loads THIS owner's OWN buffer (not the previous owner's)
  const t4 = await J(`${CLR}
    localStorage.setItem("${K}:swA", JSON.stringify({ patient:{ name:"AlphaSw" } }));
    localStorage.setItem("${K}:swB", JSON.stringify({ patient:{ name:"BravoSw" } }));
    localStorage.setItem("${OWNER}","swA"); ${setOwner("swB")} ICU._resetBufSync(); ICU._reconcileOwner();
    return JSON.stringify({ name: (ICU.state().patient||{}).name || null });`);
  ok(t4.name === "BravoSw", "account switch A→B loads B's OWN saved buffer, never A's (got " + t4.name + ")");

  // T5 — anon → sign-in KEEPS the pre-sign-in work (migrated to the account)
  await ev(`${CLR} localStorage.setItem("${OWNER}","anon"); ${setOwner(null)} ICU._resetBufSync(); ICU._reconcileOwner(); ICU.reset(); ICU.ingestPatient({ name:"AnonWork" }); return 1;`);
  await sleep(200);
  const t5 = await J(`${setOwner("userC")} ICU._reconcileOwner();
    return JSON.stringify({ stateName:(ICU.state().patient||{}).name||null, scoped:/AnonWork/.test(localStorage.getItem("${K}:userC")||""), anonGone: localStorage.getItem("${K}:anon")===null });`);
  ok(t5.stateName === "AnonWork" && t5.scoped, "anon → sign-in keeps the clinician's pre-sign-in work (migrated to their account)");
  ok(t5.anonGone, "anon buffer is cleared after being claimed on sign-in");

  // T6 — legacy unscoped buffer migrates once to the current owner
  const t6 = await J(`${CLR}
    localStorage.setItem("${K}", JSON.stringify({ patient:{ name:"LegacyPt" } }));   // legacy unscoped
    ${setOwner("legOwner")} ICU._resetBufSync(); ICU._reconcileOwner();
    return JSON.stringify({ migrated:/LegacyPt/.test(localStorage.getItem("${K}:legOwner")||""), legacyGone: localStorage.getItem("${K}")===null });`);
  ok(t6.migrated && t6.legacyGone, "legacy unscoped buffer migrates once to the current owner's key");

  console.log(fails === 0 ? "\nALL GREEN — KI-M3 per-account live-buffer scoping passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
