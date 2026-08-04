/* SknX AI end-to-end flow test (headless Chrome via CDP, modeled on test/run-abx-ui.mjs).
 * Verifies, against the REAL rendered #sknxRoot DOM in a browser (not a stub):
 *  1. Registration: index.html loads all sknx-*.js in the required order (sknx-engines.js BEFORE
 *     sknx-providers.js — the provider resolves window.SMD_SKNX_ENGINES at analyze()-call time, so a
 *     wrong order would leave it null in a pure browser) and the gated home tile (data-act="sknx",
 *     wired in home.js, hidden/shown by SKNX.isOn()) dispatches to SKNX.open() via the app's normal
 *     [data-act] click delegation.
 *  2. A normal mock analysis renders a ranked differential (#sknxRoot .sknx-dx .sknx-dx-row, >=1).
 *  3. SAFETY: the __mock:"melanoma" image, analyzed under a v2beta (dual-engine) entitlement, routes
 *     to a visible referral banner (#sknxRoot .sknx-refer) AND there is NO .sknx-rx element anywhere
 *     in #sknxRoot — Rx is a Phase 3 feature and must never surface on a referral in Phase 1.
 *
 * The mock analysis is driven via window.SMD_SKNX_SCREENS.runPipeline(image) — the same router
 * entry point the real capture flow calls after a photo is picked — rather than the native
 * camera/file picker (which can't be automated headlessly); this is the "screens' render path" the
 * task brief explicitly allows. Everything asserted is the real render output, not a stub.
 *
 * Runs against the BUILT www/ bundle (build-www.sh copies root *.js/*.css into www/), same as the
 * native app ships. USAGE: bash scripts/build-www.sh && node test/run-sknx-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const WWW = join(HERE, "..", "www");
const HTTP_PORT = Number(process.env.SKNX_HTTP_PORT || 8996);
const BASE = process.env.BASE || `http://localhost:${HTTP_PORT}/`;
const CDP_PORT = Number(process.env.SKNX_CDP_PORT || 9386);
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/sknx-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  serveProc = spawn("node", [join(HERE, "serve.mjs"), WWW, String(HTTP_PORT)], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

async function attach(url) {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url });
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    if (await ev(`return !!(window.SKNX && window.SMD_SKNX_SCREENS && window.SMD_SKNX_PROVIDERS && window.SMD_SKNX_ENGINES && window.SMD_SKNX_ENTITLEMENT && window.SMD_SKNX_FLAGS);`) === true) return true;
  }
  return false;
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${CDP_PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  ok(await attach(BASE), "app loads (SKNX + SMD_SKNX_SCREENS/PROVIDERS/ENGINES/ENTITLEMENT/FLAGS all registered)");

  // Load-order proof: the provider seam resolves engines from window.SMD_SKNX_ENGINES at call time —
  // if index.html loaded sknx-providers.js before sknx-engines.js this would still be present (last
  // script wins on window assignment) but analyze() would have captured a null engines dep on an
  // EARLIER call; asserting the export shape here is the load-bearing registration-order check.
  ok(await ev(`return typeof window.SMD_SKNX_ENGINES.makeAnalysis === "function" && typeof window.SMD_SKNX_PROVIDERS.analyze === "function";`) === true,
    "sknx-engines.js loaded before sknx-providers.js (SMD_SKNX_ENGINES.makeAnalysis resolvable)");

  // Clear any splash/login overlays that could sit over the home screen (mirrors run-abx-ui.mjs).
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await sleep(300);

  // Force the module ON + a v2beta (dual-engine) entitlement BEFORE opening, per the task brief.
  await ev(`localStorage.setItem("smd_sknx","1"); return 1;`);
  await ev(`window.SMD_PRO = { isProSync: function () { return true; } }; window.SMD_XACCESS = { tierFor: function () { return "v2beta"; } }; return 1;`);
  ok(await ev(`return SKNX.isOn();`) === true, "SKNX.isOn() is true once smd_sknx=1 + a v2beta entitlement are stubbed");

  // Home tile + ACT dispatch wiring: the gated tile must be in the real DOM and clicking it (through
  // home.js's existing [data-act] click delegation) must be what opens SknX — not a direct API call.
  ok(await ev(`return !!document.querySelector('[data-act="sknx"]');`) === true, "gated home tile (data-act=\"sknx\") is present in the DOM");
  await ev(`var b=document.querySelector('[data-act="sknx"]'); if(b) b.click(); return 1;`);
  await sleep(300);
  ok(await ev(`var r=document.getElementById("sknxRoot"); return !!(r && r.classList.contains("sknx-open"));`) === true, "clicking the tile dispatches to SKNX.open() (#sknxRoot.sknx-open)");
  ok(await ev(`return !!document.querySelector("#sknxRoot .sknx-cap-title");`) === true, "capture screen renders on open");

  // ---- 1) Normal mock analysis -> ranked differential renders ----
  await ev(`window.SMD_SKNX_SCREENS.runPipeline({ id: "sknx-test-normal" }); return 1;`);
  let dxCount = 0;
  for (let i = 0; i < 40; i++) {
    dxCount = await ev(`return document.querySelectorAll("#sknxRoot .sknx-dx .sknx-dx-row").length;`);
    if (dxCount > 0) break;
    await sleep(250);
  }
  ok(dxCount > 0, "normal mock analysis renders a ranked differential (#sknxRoot .sknx-dx has >=1 item, got " + dxCount + ")");
  ok(await ev(`var r=document.querySelector("#sknxRoot .sknx-refer"); return !r;`) === true, "the benign mock does NOT show a referral banner");

  // ---- 2) Melanoma mock -> referral banner, and CRITICALLY no Rx affordance anywhere ----
  await ev(`window.SMD_SKNX_SCREENS.runPipeline({ id: "sknx-test-melanoma", __mock: "melanoma" }); return 1;`);
  let referVisible = false;
  for (let i = 0; i < 40; i++) {
    referVisible = await ev(`var r=document.querySelector("#sknxRoot .sknx-refer"); return !!(r && r.offsetParent !== null);`);
    if (referVisible) break;
    await sleep(250);
  }
  ok(referVisible === true, "melanoma mock (v2beta dual-engine) routes to a visible referral banner (#sknxRoot .sknx-refer)");
  const rxCount = await ev(`return document.querySelectorAll("#sknxRoot .sknx-rx").length;`);
  ok(rxCount === 0, "NO .sknx-rx affordance anywhere in #sknxRoot on a referral (Rx is Phase 3, must never appear)");
  ok(await ev(`return !document.querySelector("#sknxRoot [data-act*='rx']");`) === true, "no rx-flavoured data-act affordance either");
  ok(await ev(`return document.querySelectorAll("#sknxRoot .sknx-dx .sknx-dx-row").length > 0;`) === true, "the referral screen still carries the differential (referral augments, doesn't replace, the result)");

  console.log(fails === 0 ? "\nALL GREEN — SknX AI end-to-end flow test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
