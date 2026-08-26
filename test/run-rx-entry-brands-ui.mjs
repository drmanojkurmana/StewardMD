/* Prescription: reachable from the Hospital hub, and the brand field finds brands (headless Chrome).
 *
 * Two reports, one screen:
 *   1. The Rx pad had no entry point of its own. It opened only from inside a MaiK answer or a
 *      consult, so writing a prescription for the patient in front of you meant going somewhere
 *      else first. It now sits in the Hospital hub with the other patient-facing tools.
 *   2. Typing a brand in the Rx brand field found NOTHING while the Drugs Database, on the same
 *      backend, listed it instantly. The field only ever ran MEDAPI.searchCompositions(drug) and
 *      filtered that molecule's brands; the Drugs Database runs searchBrands() too. So with the
 *      drug field holding a shorthand the composition index does not carry ("Amoxiclav"), no brand
 *      could ever appear - and the empty state still said "Type the drug first", which was untrue.
 *
 * MEDAPI is stubbed to mirror the real endpoints' shapes, including the case from the screenshots:
 * "Amoxiclav" resolves to no composition, while brand-search for "Augmen" returns Augmentin.
 *
 * USAGE: node test/run-rx-entry-brands-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8999/").replace(/\/?$/, "/");
const PORT = 9403, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/rx-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8999"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

/* Mirrors the real API: /search (compositions) and /brand-search (individual brands). */
const STUB_MEDAPI = `
window.__api = { comps: 0, brands: 0 };
window.MEDAPI = {
  searchCompositions: function (q) {
    window.__api.comps++;
    q = String(q || "").toLowerCase();
    // "Amoxiclav" is the screenshot case: a real clinical shorthand the composition index misses.
    if (q.indexOf("amoxycillin") >= 0 || q.indexOf("amoxicillin") >= 0) return Promise.resolve({ results: [{ composition: "Amoxycillin + Clavulanic Acid" }] });
    return Promise.resolve({ results: [] });
  },
  composition: function (name) {
    return Promise.resolve({ brands: [
      { brand: "Clavam 625", manufacturer: "Alkem", form: "tablet", mrp: 210 },
      { brand: "Moxikind-CV 625", manufacturer: "Mankind", form: "tablet", mrp: 190 }
    ] });
  },
  searchBrands: function (q) {
    window.__api.brands++;
    q = String(q || "").toLowerCase();
    if (!q || q.length < 3) return Promise.resolve({ results: [] });
    var all = [
      { brand: "Augmentin 625 Duo Tablet", manufacturer: "Glaxo SmithKline", form: "tablet", mrp: 223.42 },
      { brand: "Augmentin 375 Tablet", manufacturer: "Glaxo SmithKline", form: "tablet", mrp: 229 },
      { brand: "Augmentin DDS Suspension", manufacturer: "Glaxo SmithKline", form: "suspension", mrp: 173 }
    ];
    return Promise.resolve({ results: all.filter(function (b) { return b.brand.toLowerCase().indexOf(q) >= 0; }) });
  }
};
return 1;`;

const AC_TEXT = `var b=document.querySelector(".rx-ac"); return b ? b.textContent.trim().slice(0,120) : "NO BOX";`;
const AC_ITEMS = `return [].slice.call(document.querySelectorAll(".rx-ac-item .rx-ac-g")).map(function(e){return e.textContent.trim();}).join(" | ") || "none";`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  /* The app registers a stale-while-revalidate service worker, so a warm profile can serve a
   * previously cached bundle and the edits under test never load. Drop it, reload once, then wait. */
  await sleep(1500);
  await ev(`if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) navigator.serviceWorker.getRegistrations().then(function(rs){ rs.forEach(function(r){ r.unregister(); }); }); return 1;`);
  await call("Page.navigate", { url: BASE + "?nosw=1" });
  let ready = false;
  for (let i = 0; i < 120; i++) { await sleep(500); if (await ev(`return !!(window.SMD_RX && window.SMD_showHome && window.MEDAPI)`) === true) { ready = true; break; } }
  ok(ready, "app and the prescription module load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`SMD_showHome(); return 1;`); await sleep(700);

  // Stub the verification gate and the drug API UP FRONT: SMD_VERIFY.isVerified() is the single
  // seam SMD_RX.open() consults, so a verified stub renders the real pad exactly as it would for a
  // real doctor, straight from the tile.
  await ev(`window.SMD_VERIFY = { isVerified: function(){ return Promise.resolve(true); }, openPanel: function(){} }; return 1;`);
  await ev(STUB_MEDAPI);

  // ── 1. the Hospital hub carries a Prescription tile ──
  await ev(`var b=document.querySelector('[data-act="hospital"]'); if(b) b.click(); return 1;`); await sleep(900);
  const tiles = await ev(`return [].slice.call(document.querySelectorAll('#hvSheet [data-mi]')).map(function(b){return b.getAttribute("data-mi");}).join(",");`);
  ok(tiles.indexOf("rx") >= 0, "the Hospital hub offers a Prescription tile (tiles: " + tiles + ")");
  ok(await ev(`var b=document.querySelector('#hvSheet [data-mi="rx"] .tl'); return b?b.textContent.trim():"";`) === "Prescription",
    "the tile is labelled Prescription");

  // Tapping it must reach the Rx module, not silently do nothing. SMD_RX.open owns the
  // doctor-verification gate, so we assert the call, not which of its two screens appears.
  await ev(`window.__rxOpened = 0; var _o = SMD_RX.open; SMD_RX.open = function(){ window.__rxOpened++; return _o.apply(this, arguments); }; return 1;`);
  await ev(`var b=document.querySelector('#hvSheet [data-mi="rx"]'); if(b) b.click(); return 1;`); await sleep(900);
  ok(await ev(`return window.__rxOpened;`) === 1, "tapping the tile opens the prescription pad directly");

  // ── 2. the pad opens ready to type ──
  for (let i = 0; i < 25; i++) { await sleep(300); if (await ev(`return !!document.querySelector('[data-f="brand"]');`) === true) break; }
  ok(await ev(`return !!document.querySelector('[data-f="brand"]');`) === true,
    "the pad opens with a drug line already there, so there is nothing to hunt for first");
  ok(await ev(`return document.querySelectorAll('#rxLines [data-f="brand"]').length;`) === 1, "exactly one blank drug row, not a pile");

  // The screenshot's exact case: drug = "Amoxiclav" (no composition match), brand = "Augmen".
  await ev(`var d=document.querySelector('[data-f="drug"]'); d.value="Amoxiclav"; d.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
  await ev(`var b=document.querySelector('[data-f="brand"]'); b.focus(); return 1;`); await sleep(900);
  await ev(`var b=document.querySelector('[data-f="brand"]'); b.value="Augmen"; b.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
  await sleep(1400);
  const items = await ev(AC_ITEMS);
  ok(items.indexOf("Augmentin") >= 0,
    "typing a brand finds it even when the drug field holds a shorthand the composition index misses (got: " + items + ")");
  ok(await ev(`return window.__api.brands > 0;`) === true, "the brand-name endpoint is actually queried (it never was before)");
  ok((await ev(AC_TEXT)).indexOf("Type the drug first") === -1,
    'the misleading "Type the drug first" empty state is gone once a drug IS typed');

  // A molecule the index DOES know must still list its brands, as before.
  /* NOTE: the molecule path (a drug the composition index DOES know) and the empty-drug message are
   * covered deterministically in test/rx-brand-match.test.mjs. They are deliberately NOT asserted
   * here: this app reloads itself when the guest session expires (app.js), which lands mid-run and
   * wipes the pad, so a long browser script is flaky for reasons that have nothing to do with the
   * code under test. Keep this harness short and about what only a browser can show. */

  console.log(fails === 0 ? "\nALL GREEN — Rx reachable from Hospital, and the brand field finds brands" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
