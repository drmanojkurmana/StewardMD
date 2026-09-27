/* Early access to the four beta imaging AI modules + Learn ECG without the AI code. REAL headless Chrome.
 *
 * Owner decisions 2026-09-26:
 *   A) ThoreX / KardiQ X / SknX / FundX open WITHOUT an access code for purchase tiers "physicianpro"
 *      (Clinician Pro) and "ultimate". Every other tier still needs the SMD_XACCESS code. One helper
 *      (SMD_PRO.hasEarlyAccess, account.js) decides; the beta labelling must still show.
 *   B) Audit finding 11: KardiQ X LEARN (atlas + quiz, no AI) is reachable by any signed-in user with
 *      smd_kardiox off and no code, while the ECG AI screens stay locked.
 *
 * The tier comes from the REAL account.js path: localStorage "smd_tier_last:anon" seeds _tier, and every
 * /api/* request is failed via CDP Fetch so /api/billing/status cannot overwrite it (the sync is
 * fail-open: an error keeps the last known tier). No SMD_PRO method is stubbed.
 *
 * USAGE: CHROME=/path/to/chrome CHROME_FLAGS=--no-sandbox node test/run-early-access-imaging-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8931/").replace(/\/?$/, "/");
const PORT = 9471, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/early-access-imaging-chrome-" + process.pid;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8931"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };
const until = async (e, n = 40, ms = 150) => { for (let i = 0; i < n; i++) { if (await ev(e) === true) return true; await sleep(ms); } return false; };

const MODS = [
  { act: "thorex", flag: "smd_thorex", root: "#thorexRoot", on: "tx-open", name: "ThoreX" },
  { act: "kardiox", flag: "smd_kardiox", root: "#kardioxRoot", on: "kx-open", name: "KardiQ X" },
  { act: "sknx", flag: "smd_sknx", root: "#sknxRoot", on: "sknx-open", name: "SknX" },
  { act: "retinalscan", flag: "smd_fundx", root: "#fundxRoot", on: "on", name: "FundX", xa: "fundx" }
];
const READY = `return !!(window.SMD_PRO && SMD_PRO.hasEarlyAccess && window.SMD_XACCESS && window.SMD_HOME_TOOLS && window.KARDIOX && KARDIOX.openLearn && window.THOREX && window.SKNX && window.FUNDX && window.SMD_KARDIOX_ROUTER && window.SMD_KARDIOX_FLAGS);`;

// Reload the app with a clean device: only the given localStorage keys set.
async function boot(store) {
  await ev(`localStorage.clear(); sessionStorage.clear(); var s = ${JSON.stringify(store)}; for (var k in s) localStorage.setItem(k, s[k]); return "ok";`);
  await call("Page.reload", { ignoreCache: false });
  await sleep(600);
  const ready = await until(READY, 120, 250);
  if (!ready) throw new Error("app did not boot: " + JSON.stringify(store));
  await sleep(400);
}
// Close every module + overlay so one check cannot leak into the next.
const closeAll = () => ev(`try{THOREX.close()}catch(e){} try{KARDIOX.close()}catch(e){} try{SKNX.close()}catch(e){} try{FUNDX.close()}catch(e){}
  var g = document.getElementById("xaGate"); if (g) g.classList.remove("on");
  document.querySelectorAll(".smd-beta-ov").forEach(function(n){ n.remove(); }); return "ok";`);
const tileActs = () => J(`return JSON.stringify(SMD_HOME_TOOLS().map(function(t){ return t.act; }));`);
// Tap the tile the way a user does: the rendered home grid button if present, else the ACT dispatch.
const tapTile = (act) => J(`var b = document.querySelector('#rnavToolsGrid .rnav-tile[data-act="${act}"]');
  if (b) { b.click(); return JSON.stringify({ via: "tile" }); } return JSON.stringify({ via: "none" });`);
const modState = (m) => J(`var r = document.querySelector("${m.root}");
  var ov = document.querySelector(".smd-beta-ov"), g = document.getElementById("xaGate");
  return JSON.stringify({ open: !!(r && r.classList.contains("${m.on}")), notice: ov ? ov.textContent : "", gate: !!(g && g.classList.contains("on")), gateText: g && g.classList.contains("on") ? g.textContent : "" });`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    // Every /api/* call fails: billing/status cannot overwrite the seeded tier, and no access code can
    // be verified or restored, so the ONLY route past the gate is the early-access plan under test.
    if (m.method === "Fetch.requestPaused") { call("Fetch.failRequest", { requestId: m.params.requestId, errorReason: "ConnectionRefused" }); return; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }, { urlPattern: "https://www.gstatic.com/firebasejs/*" }] });
  await call("Page.navigate", { url: BASE });
  if (!(await until(READY, 120, 250))) throw new Error("app did not boot");

  // ── A) tiers WITHOUT early access: tiles hidden, every module needs the code ───────────────────
  for (const tier of ["", "free", "pro"]) {
    const label = tier || "(unknown)";
    const store = { "smd_tier_last:anon": tier };
    if (tier === "pro") store["smd_pro_last:anon"] = "1";      // a real Pro verdict: the old SknX Pro unlock must be gone
    await boot(store);
    const h = await J(`return JSON.stringify({ tier: SMD_PRO.tierSync(), early: SMD_PRO.hasEarlyAccess(), pro: SMD_PRO.isProSync() });`);
    ok(h.tier === tier && h.early === false, `[${label}] SMD_PRO.tierSync()="${h.tier}", hasEarlyAccess() false`);
    if (tier === "pro") ok(h.pro === true, "[pro] isProSync() true (Pro verdict seeded)");
    const acts = await tileActs();
    ok(MODS.every((m) => acts.indexOf(m.act) < 0), `[${label}] no imaging tile on Home (${MODS.map((m) => m.act).filter((a) => acts.indexOf(a) >= 0).join(",") || "none"})`);
    ok(acts.indexOf("kxlearn") >= 0, `[${label}] Learn ECG tile IS on Home`);
    for (const m of MODS) {
      await closeAll();
      // Straight to the gate the tile would use; SknX gates inside its own open().
      const r = await J(`window.__cb = false;
        ${m.act === "sknx" ? `SKNX.open();` : `SMD_XACCESS.gate("${m.xa || m.act}", function(){ window.__cb = true; });`}
        return JSON.stringify({ cb: window.__cb, plan: SMD_XACCESS.planUnlocks("${m.xa || m.act}"), active: SMD_XACCESS.isActiveCached("${m.xa || m.act}") });`);
      await sleep(250);
      // SKNX.open() is wrapped by the beta notice (it shows first); continue past it to reach the gate.
      await ev(`var b = document.querySelector(".smd-beta-ov .smd-beta-b"); if (b) b.click(); return 1;`);
      await sleep(250);
      const s = await modState(m);
      ok(!r.cb && !s.open && !r.plan && !r.active, `[${label}] ${m.name} does NOT open without a code`);
      ok(s.gate, `[${label}] ${m.name} shows the access gate (${(s.gateText || "").replace(/\s+/g, " ").slice(0, 40)})`);
    }
    await closeAll();
    const direct = await J(`THOREX.open(); KARDIOX.open(); return JSON.stringify({ tx: !!document.querySelector("#thorexRoot.tx-open"), kx: !!document.querySelector("#kardioxRoot.kx-open") });`);
    await sleep(300);
    const direct2 = await J(`return JSON.stringify({ tx: !!document.querySelector("#thorexRoot.tx-open"), kx: !!document.querySelector("#kardioxRoot.kx-open"), notice: !!document.querySelector(".smd-beta-ov") });`);
    if (direct2.notice) await ev(`document.querySelector(".smd-beta-ov .smd-beta-b").click(); return 1;`);
    await sleep(300);
    const direct3 = await J(`return JSON.stringify({ tx: !!document.querySelector("#thorexRoot.tx-open"), kx: !!document.querySelector("#kardioxRoot.kx-open") });`);
    ok(!direct.tx && !direct.kx && !direct3.tx && !direct3.kx, `[${label}] THOREX.open()/KARDIOX.open() stay no-ops (master flags off)`);
  }

  // ── A) early-access tiers: tiles shown with BETA, every module OPENS past its own gates ────────
  for (const tier of ["physicianpro", "ultimate"]) {
    await boot({ "smd_tier_last:anon": tier });
    const h = await J(`return JSON.stringify({ tier: SMD_PRO.tierSync(), early: SMD_PRO.hasEarlyAccess(), pro: SMD_PRO.isProSync(),
      tx: SMD_THOREX_FLAGS.bool("smd_thorex"), kx: SMD_KARDIOX_FLAGS.bool("smd_kardiox"), sx: SKNX.isOn(), txEnt: SMD_THOREX_ENTITLEMENT.resolve(), sxEnt: SMD_SKNX_ENTITLEMENT.resolve() });`);
    ok(h.tier === tier && h.early === true, `[${tier}] hasEarlyAccess() true (pro verdict ${h.pro})`);
    ok(h.tx && h.kx && h.sx, `[${tier}] module gates pass: smd_thorex=${h.tx} smd_kardiox=${h.kx} SKNX.isOn()=${h.sx}`);
    ok(h.txEnt !== "free" && h.sxEnt !== "free", `[${tier}] entitlements read paid: thorex=${h.txEnt} sknx=${h.sxEnt}`);
    const acts = await tileActs();
    ok(MODS.every((m) => acts.indexOf(m.act) >= 0), `[${tier}] all four imaging tiles on Home`);
    const beta = await J(`var out = {}; ${JSON.stringify(MODS.map((m) => m.act))}.forEach(function(a){ var b = document.querySelector('#rnavToolsGrid .rnav-tile[data-act="' + a + '"]'); out[a] = b ? !!b.querySelector(".rnav-tile-beta") : null; }); return JSON.stringify(out);`);
    ok(MODS.every((m) => beta[m.act] === true), `[${tier}] every rendered imaging tile carries the BETA chip ${JSON.stringify(beta)}`);
    for (const m of MODS) {
      await closeAll();
      const via = await tapTile(m.act);
      ok(via.via === "tile", `[${tier}] ${m.name} tile tapped on the rendered Home grid`);
      await until(`return !!document.querySelector(".smd-beta-ov") || !!document.querySelector("${m.root}.${m.on}");`, 30, 100);
      const s1 = await modState(m);
      ok(/is in beta/.test(s1.notice) && /decision support; the clinician decides/.test(s1.notice), `[${tier}] ${m.name} beta notice shown before the module`);
      ok(!s1.gate, `[${tier}] ${m.name} no access-code gate`);
      await ev(`var b = document.querySelector(".smd-beta-ov .smd-beta-b"); if (b) b.click(); return 1;`);
      const opened = await until(`var r = document.querySelector("${m.root}"); return !!(r && r.classList.contains("${m.on}"));`, 40, 150);
      const s2 = await modState(m);
      ok(opened && s2.open && !s2.gate, `[${tier}] ${m.name} OPENS without a code`);
      if (m.act === "kardiox") {
        await until(`return !!document.querySelector("#kardioxRoot .kx-cta[data-act=kardiox-add]");`, 60, 150);
        const kx = await J(`return JSON.stringify({ cta: !!document.querySelector("#kardioxRoot .kx-cta[data-act=kardiox-add]"), learnOnly: SMD_KARDIOX_ROUTER.isLearnOnly() });`);
        ok(kx.cta && !kx.learnOnly, `[${tier}] KardiQ X opens the FULL module (Analyze an ECG present, not learn-only)`);
        await ev(`document.querySelector("#kardioxRoot .kx-cta[data-act=kardiox-add]").click(); return 1;`);
        await sleep(300);
        const src = await J(`return JSON.stringify({ gate: !!document.querySelector("#xaGate.on"), html: (document.getElementById("kxScroll")||{}).innerHTML.length });`);
        ok(!src.gate, `[${tier}] KardiQ X Analyze proceeds to capture with no gate`);
      }
      if (m.act === "thorex") {
        await sleep(400);
        const tx = await J(`var s = document.getElementById("txScroll"); return JSON.stringify({ len: s ? s.innerHTML.length : 0 });`);
        ok(tx.len > 200, `[${tier}] ThoreX landing rendered (${tx.len} chars)`);
      }
      if (m.act === "sknx") {
        const sx = await J(`var r = document.getElementById("sknxRoot"); return JSON.stringify({ len: r ? r.innerHTML.length : 0 });`);
        ok(sx.len > 200, `[${tier}] SknX screens mounted (${sx.len} chars)`);
      }
    }
    await closeAll();
    // Settings gate for a plan user reads "included with your plan", never the code entry.
    await ev(`SMD_XACCESS.openGate("thorex", function(){}); return 1;`);
    const g = await J(`var g = document.getElementById("xaGate"); return JSON.stringify({ on: g.classList.contains("on"), text: g.textContent, input: !!document.getElementById("xaCodeInput") });`);
    ok(g.on && /included with your plan/.test(g.text) && !g.input && /not yet clinically validated/.test(g.text), `[${tier}] Settings gate says included with plan + unvalidated, no code field`);
    ok(!/—/.test(g.text.replace(/KardioX AI|ThoreX AI/g, "")), `[${tier}] plan gate copy has no em-dash`);
    await closeAll();
  }

  // Kill switches still beat the plan.
  await boot({ "smd_tier_last:anon": "ultimate", smd_thorex: "0", smd_kardiox: "0" });
  {
    const acts = await tileActs();
    ok(acts.indexOf("thorex") < 0 && acts.indexOf("kardiox") < 0 && acts.indexOf("sknx") >= 0, `[ultimate + smd_thorex=0/smd_kardiox=0] those two tiles hidden, others kept`);
    await ev(`THOREX.open(); KARDIOX.open(); return 1;`);
    await sleep(300);
    await ev(`var b = document.querySelector(".smd-beta-ov .smd-beta-b"); if (b) b.click(); return 1;`);
    await sleep(400);
    const s = await J(`return JSON.stringify({ tx: !!document.querySelector("#thorexRoot.tx-open"), kx: !!document.querySelector("#kardioxRoot.kx-open") });`);
    ok(!s.tx && !s.kx, `[ultimate + kill switch] THOREX/KARDIOX open() stay no-ops`);
    await closeAll();
  }

  // ── B) Learn ECG: no code, smd_kardiox off, AI stays locked ────────────────────────────────────
  await boot({ "smd_tier_last:anon": "free" });
  {
    const pre = await J(`return JSON.stringify({ kx: SMD_KARDIOX_FLAGS.bool("smd_kardiox"), learn: SMD_KARDIOX_FLAGS.bool("smd_kardiox_learn"), xa: SMD_XACCESS.isActiveCached("kardiox") });`);
    ok(pre.kx === false && pre.learn === true && pre.xa === false, `[learn] smd_kardiox OFF, no code, smd_kardiox_learn ON`);
    // Signed out: openLearn is refused (Learn is for signed-in users).
    await ev(`KARDIOX.openLearn(); return 1;`);
    await sleep(300);
    ok(!(await ev(`return !!document.querySelector("#kardioxRoot.kx-open");`)), `[learn] signed OUT: Learn ECG does not open`);
    // Sign in (account profile stub only; no tier, no code).
    await ev(`window.SMD_ACCOUNT = window.SMD_ACCOUNT || {}; SMD_ACCOUNT.profile = function(){ return { signedIn: true, name: "Student" }; }; return 1;`);
    // The tile's Material Symbols ligature must resolve to a glyph (a missing name renders as wide text).
    await until(`return document.fonts ? document.fonts.status === "loaded" : true;`, 40, 150);
    const icw = await J(`var i = document.querySelector('#rnavToolsGrid .rnav-tile[data-act="kxlearn"] .rds-icon'), c = document.querySelector('#rnavToolsGrid .rnav-tile[data-act="clinix"] .rds-icon, #rnavToolsGrid .rnav-tile[data-act="dictate"] .rds-icon');
      return JSON.stringify({ w: i ? i.getBoundingClientRect().width : -1, ref: c ? c.getBoundingClientRect().width : -1, tt: (document.querySelector('#rnavToolsGrid .rnav-tile[data-act="kxlearn"] .rnav-tile-tt')||{}).textContent });`);
    ok(icw.tt === "Learn ECG" && icw.w > 0 && icw.w < 48, `[learn] Learn ECG tile icon renders as a glyph (width ${icw.w}px, reference ${icw.ref}px)`);
    const via = await tapTile("kxlearn");
    ok(via.via === "tile", `[learn] Learn ECG tile tapped on the rendered Home grid`);
    const opened = await until(`return !!document.querySelector("#kardioxRoot.kx-open") && !!document.querySelector("#kxScroll .kx-lib-title");`, 80, 150);
    ok(opened, `[learn] Learn ECG opens with smd_kardiox off and no code`);
    const rows = await until(`return document.querySelectorAll('#kxScroll [data-act="kxnav:lesson"]').length > 50;`, 120, 250);
    const lib = await J(`return JSON.stringify({ title: (document.querySelector("#kxScroll .kx-lib-title")||{}).textContent, rows: document.querySelectorAll('#kxScroll [data-act="kxnav:lesson"]').length, cta: !!document.querySelector('#kardioxRoot [data-act="kardiox-add"]'), notice: !!document.querySelector(".smd-beta-ov"), gate: !!document.querySelector("#xaGate.on"), learnOnly: SMD_KARDIOX_ROUTER.isLearnOnly() });`);
    ok(rows && lib.title === "Learn ECG" && lib.rows > 50, `[learn] atlas library rendered (${lib.rows} lessons listed)`);
    ok(!lib.cta && !lib.gate && lib.learnOnly, `[learn] learn-only: no Analyze CTA, no access gate`);
    await ev(`document.querySelector('#kxScroll [data-act="kxnav:lesson"]').click(); return 1;`);
    const lesson = await until(`return SMD_KARDIOX_ROUTER.isLearnOnly() && !document.querySelector("#kxScroll .kx-lib-title") && (document.getElementById("kxScroll").textContent || "").length > 200;`, 40, 150);
    ok(lesson, `[learn] a lesson opens`);
    await ev(`SMD_KARDIOX_ROUTER.nav("quiz"); return 1;`);
    await sleep(800);
    const quiz = await J(`var s = document.getElementById("kxScroll"); return JSON.stringify({ len: s.innerHTML.length, gate: !!document.querySelector("#xaGate.on"), txt: s.textContent.slice(0, 80) });`);
    ok(quiz.len > 200 && !quiz.gate, `[learn] quiz renders with no gate`);
    // Now the AI: every route in is refused and handed to the access-code gate.
    const before = await ev(`return document.getElementById("kxScroll").innerHTML;`);
    for (const key of ["source", "report", "history", "settings", "landing", "analysis"]) {
      await ev(`var g = document.getElementById("xaGate"); if (g) g.classList.remove("on"); SMD_KARDIOX_ROUTER.nav("${key}"); return 1;`);
      await sleep(250);
      const s = await J(`var g = document.getElementById("xaGate"); return JSON.stringify({ same: document.getElementById("kxScroll").innerHTML === ${JSON.stringify(before)}, gate: !!(g && g.classList.contains("on")), code: !!document.getElementById("xaCodeInput") });`);
      ok(s.same && s.gate && s.code, `[learn] AI screen "${key}" refused, access-code gate shown`);
    }
    await ev(`var g = document.getElementById("xaGate"); if (g) g.classList.remove("on"); SMD_KARDIOX_ROUTER.runPipeline({ id: "x", source: "photoLibrary" }); return 1;`);
    await sleep(250);
    const rp = await J(`return JSON.stringify({ same: document.getElementById("kxScroll").innerHTML === ${JSON.stringify(before)}, gate: !!document.querySelector("#xaGate.on") });`);
    ok(rp.same && rp.gate, `[learn] runPipeline (ECG AI) refused in learn-only mode`);
    ok(!(await ev(`return !!document.querySelector("#kardioxRoot .kx-cta");`)), `[learn] AI landing never rendered`);
    await closeAll();

    // Kill switch: localStorage smd_kardiox_learn=0 hides the tile and makes openLearn() a no-op.
    await boot({ "smd_tier_last:anon": "free", smd_kardiox_learn: "0" });
    await ev(`window.SMD_ACCOUNT = window.SMD_ACCOUNT || {}; SMD_ACCOUNT.profile = function(){ return { signedIn: true }; }; return 1;`);
    const acts = await tileActs();
    await ev(`KARDIOX.openLearn(); return 1;`);
    await sleep(400);
    ok(acts.indexOf("kxlearn") < 0 && !(await ev(`return !!document.querySelector("#kardioxRoot.kx-open");`)), `[learn] smd_kardiox_learn=0 kill switch: tile hidden, openLearn() no-op`);
  }
} catch (e) {
  console.log("FAIL harness error: " + (e && e.stack || e)); fails++;
} finally {
  try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
