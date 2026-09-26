/* test/run-medcore-ui.mjs — the Medical Core panel in a real browser, both ways round.
 *
 * Two properties, and the first one matters more:
 *   1. `?medcore=0` IS A COMPLETE NO-OP. No panel, no window.SMD_MEDCORE, and nothing fetched.
 *      The flag now ships ON, so this is the escape hatch rather than the default, which makes it
 *      MORE important to assert, not less: it is the only way back if the panel misbehaves in the
 *      field, and it has to work without a rebuild.
 *   2. THE SHIPPED DEFAULT renders the two deterministic lists over the ICU state the app already
 *      holds, and nothing else: no probability, no alert, no notification, no network call
 *      carrying a value. It is labelled BETA.
 *
 * It drives the real dashboard through ICU.ingestMonitor / savePatient / open, the same way the
 * other ICU browser tests do, because a unit test cannot tell you the panel is actually painted.
 *
 * USAGE: node test/run-medcore-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8934/").replace(/\/?$/, "/");
const PORT = 9461, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/medcore-ui-chrome";
const CHROME = process.env.CHROME || [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"
].find((p) => existsSync(p));

let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8934"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
if (!CHROME) { console.log("SKIP no chrome binary found; set CHROME="); process.exit(0); }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--no-sandbox", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => {
  const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : null;
};
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

const NOW = Date.now();
/* The v2 dashboard opens on the unit board; the workspace this panel lives in is one tap in
 * (data-icu-act="openpt"), so the test taps it exactly as a clinician does. */
const chartPatient = `
  try { for (var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k&&k.indexOf("stewardmd_icu_patients")===0) localStorage.removeItem(k); } } catch(e){}
  try { localStorage.setItem("smd_icu_groups","0"); } catch(e){}
  ICU.reset(); ICU.ingestPatient({ name: "Core Pt", bed: "4", age: 65, sex: "M", weightKg: 72 });
  var S = ICU.state();
  S.vitals.push({ ts: Date.now() - 180*60000, map: 78, hr: 98, spo2: 97 });
  S.vitals.push({ ts: Date.now() - 20*60000,  map: 55, hr: 128 });
  ICU.savePatient(); ICU.open();
  var card = document.querySelector('[data-icu-act^="openpt"]');
  if (card) card.click();
  return document.querySelectorAll(".icu-wrap").length;`;

async function openWorkspace() {
  await ev(chartPatient);
  for (let i = 0; i < 40; i++) {
    if (await ev(`return document.querySelectorAll(".icu-wrap").length`) > 0) return true;
    await sleep(250);
  }
  return false;
}

async function boot(query) {
  await call("Page.navigate", { url: BASE + query });
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.savePatient)`) === true) return true; }
  return false;
}

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});

  /* ---------------------------------------------------------------- 1. the escape hatch */
  ok(await boot("?tour=0&medcore=0"), "app loads with Medical Core forced off via ?medcore=0");
  ok(await openWorkspace(), "the patient workspace opens");
  const off = await J(`
    return JSON.stringify({
      flag: !!(window.SMD_MEDCORE_FLAGS && SMD_MEDCORE_FLAGS.bool("smd_medcore")),
      shadow: !!(window.SMD_MEDCORE_FLAGS && SMD_MEDCORE_FLAGS.bool("smd_medcore_shadow")),
      api: !!window.SMD_MEDCORE,
      panels: document.querySelectorAll(".icu-mc-sub").length,
      vitalTiles: document.querySelectorAll(".icu-vitals").length
    });`);
  ok(off && off.flag === false, "?medcore=0 overrides the default-on master flag");
  ok(off && off.shadow === false, "smd_medcore_shadow reads false");
  ok(off && off.api === false, "window.SMD_MEDCORE is not defined when the flag is off");
  ok(off && off.panels === 0, "no Medical Core panel is painted when the flag is off");
  ok(off && off.vitalTiles > 0, "the rest of the ICU dashboard still renders normally");

  /* ---------------------------------------------------------------- 2. the shipped default */
  ok(await boot("?tour=0"), "app loads with no medcore param at all (the shipped default)");
  await ev(`return 1;`);
  let api = false;
  for (let i = 0; i < 40; i++) { if (await ev(`return !!window.SMD_MEDCORE`) === true) { api = true; break; } await sleep(250); }
  ok(api, "medcore-boot installs window.SMD_MEDCORE when the flag is on");

  ok(await openWorkspace(), "the patient workspace opens with the flag on");
  const on = await J(`
    var subs = [].slice.call(document.querySelectorAll(".icu-mc-sub")).map(function(e){return e.textContent;});
    var rows = [].slice.call(document.querySelectorAll(".icu-mc-row")).map(function(e){return e.textContent.replace(/\\s+/g," ").trim();});
    return JSON.stringify({
      subs: subs, rows: rows,
      packs: window.SMD_MEDCORE.packs(),
      foot: (document.querySelector(".icu-mc-foot")||{}).textContent || "",
      heading: [].slice.call(document.querySelectorAll(".icu-sec-lbl"))
        .map(function(e){return e.textContent.replace(/\\s+/g," ").trim();})
        .filter(function(t){return /Medical Core/.test(t);}).join(" | ")
    });`);
  ok(on && /Medical Core/.test(on.heading) && /BETA/.test(on.heading),
    "the panel is labelled BETA now that it is on by default: " + ((on && on.heading) || "(no heading)"));
  ok(on && /no model/i.test(on.heading),
    "the heading says there is no model behind it: " + ((on && on.heading) || ""));
  ok(on && on.subs.indexOf("What changed") !== -1, "the What changed list is painted");
  ok(on && on.subs.indexOf("Missing information") !== -1, "the Missing information list is painted");
  ok(on && on.rows.some((r) => /MAP/.test(r) && /78/.test(r) && /55/.test(r)), "the falling MAP is shown with both ends: " + JSON.stringify((on && on.rows) || []).slice(0, 220));
  ok(on && on.rows.some((r) => /Respiratory rate|Conscious level/.test(r)), "an uncharted core observation is listed as missing");
  ok(on && /no prediction, no alert/i.test(on.foot), "the panel states what it is not");
  ok(on && /Not a complete list/.test(on.foot),
    "the panel says its lists are FILTERED - a clinician reading a short list as a clear patient has been misled by omission");
  ok(on && on.packs && on.packs.approval.every((a) => a === "unapproved"), "the clinical packs report themselves unapproved");

  /* ------------------------------------------------- 3. it is a panel, not a second alert path */
  const inert = await J(`
    var before = (ICU.state().alerts||[]).length;
    var sum = window.SMD_MEDCORE.summary(ICU.state(), { asOf: Date.now() });
    return JSON.stringify({
      alertsUnchanged: (ICU.state().alerts||[]).length === before,
      summaryShape: Object.keys(sum).sort().join(","),
      hasProbability: JSON.stringify(sum).indexOf("probability") !== -1,
      subjectKey: sum.provenance && sum.provenance.sources ? sum.provenance.sources.join(",") : ""
    });`);
  ok(inert && inert.alertsUnchanged, "asking Medical Core changes no alert state");
  ok(inert && inert.summaryShape === "asOf,changed,missingInformation,provenance,schema", "the summary carries only the deterministic lists: " + (inert && inert.summaryShape));
  ok(inert && inert.hasProbability === false, "there is no probability anywhere in Phase 1 output");
} catch (e) {
  ok(false, "harness error: " + (e && e.message));
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  process.exit(fails ? 1 : 0);
}
