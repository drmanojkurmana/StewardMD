/* RxChoice™ in a real browser: the prescription pad still works, the panel is opt-in, the four cards
 * render, DOCTOR PRESCRIBED never disappears, SELECT changes the BRAND and nothing else, and with the
 * flag off the pad is exactly what it was before RxChoice existed.
 *
 * Unit tests (test/rxchoice-core.test.mjs) already cover matching, pricing and ranking. This harness
 * is only for what no unit test can show: that the layer is reachable from the pad, that it writes
 * the right input, and that it leaves the doctor's drug/dose/frequency/duration alone.
 *
 * MEDAPI is stubbed with records in the live database's exact shape, including the case that shaped
 * the safety rules - a combination whose composition carries NO strengths, so strength lives in the
 * brand name ("Augmentin 625 Tablet") - plus products that must be refused: a wrong strength, a
 * syrup, a single-ingredient product and a discontinued one.
 *
 * USAGE: node test/run-rxchoice-ui.mjs
 *   CHROME=/opt/pw-browsers/chromium node test/run-rxchoice-ui.mjs
 */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8998/").replace(/\/?$/, "/");
const PORT = 9404, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/rxc-chrome";
/* A FRESH profile every run. Phase 2 below turns the master flag OFF by writing smd_rxchoice=0 into
 * localStorage, and Chrome keeps that localStorage in this fixed user-data-dir - so the NEXT run
 * booted with the flag already off, rendered no button, and failed 12 checks that have nothing to
 * do with the code under test. The first run on a clean machine passes and every later one lies. */
rmSync(userDir, { recursive: true, force: true });
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8998"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-sandbox", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

/* Records in the live database's shape: { id, brand, composition, manufacturer, mrp, form, pack,
 * discontinued }. The composition carries no strengths, exactly as the real combination rows do. */
const STUB = `
window.__api = { comps: 0, brands: 0, compCalls: [] };
var COMP = "Amoxycillin + Clavulanic Acid";
var ROWS = [
  { id: 1, brand: "Augmentin 625 Duo Tablet", composition: COMP, manufacturer: "Glaxo SmithKline Pharmaceuticals Ltd", mrp: 223.42, form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
  { id: 2, brand: "Clavam 625 Tablet",        composition: COMP, manufacturer: "Alkem Laboratories Ltd",              mrp: 181,    form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
  { id: 3, brand: "Moxclav 625 Tablet",       composition: COMP, manufacturer: "Wanbury Ltd",                         mrp: 96,     form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
  { id: 4, brand: "Advent 625 Tablet",        composition: COMP, manufacturer: "Cipla Ltd",                           mrp: 198,    form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
  { id: 5, brand: "Clavam 375 Tablet",        composition: COMP, manufacturer: "Alkem Laboratories Ltd",              mrp: 88,     form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
  { id: 6, brand: "Clavam 625 Dry Syrup",     composition: COMP, manufacturer: "Alkem Laboratories Ltd",              mrp: 70,     form: "syrup",  pack: "bottle of 30 ml",     discontinued: 0 },
  { id: 7, brand: "Mox 500 Capsule",          composition: "Amoxycillin (500mg)", manufacturer: "Ranbaxy",             mrp: 40,     form: "capsule",pack: "strip of 15 capsules",discontinued: 0 },
  { id: 8, brand: "Gone CV 625 Tablet",       composition: COMP, manufacturer: "Cipla Ltd",                           mrp: 50,     form: "tablet", pack: "strip of 10 tablets", discontinued: 1 }
];
window.MEDAPI = {
  searchCompositions: function (q) { window.__api.comps++; q = String(q||"").toLowerCase();
    return Promise.resolve({ results: (q.indexOf("amox") >= 0) ? [{ composition: COMP }] : [] }); },
  composition: function (name) { window.__api.compCalls.push(name);
    return Promise.resolve({ composition: name, brands: ROWS.filter(function (r) { return r.composition === name; }) }); },
  searchBrands: function (q) { window.__api.brands++; q = String(q||"").toLowerCase();
    if (!q || q.length < 2) return Promise.resolve({ results: [] });
    return Promise.resolve({ results: ROWS.filter(function (r) { return r.brand.toLowerCase().indexOf(q) >= 0; }) }); }
};
return 1;`;

const CARDS = `return [].slice.call(document.querySelectorAll(".rxc-card .rxc-cat")).map(function(e){return e.textContent.trim();}).join(" | ") || "none";`;
const BRANDS = `return [].slice.call(document.querySelectorAll(".rxc-card .rxc-br")).map(function(e){return e.textContent.trim();}).join(" | ") || "none";`;
/* The pad seeds an ADVICE row ("Lifestyle & general measures") above the drug rows, and an advice row
 * carries a [data-f="drug"] input of its own - so every selector here is scoped to .rx-line:not(.adv),
 * the way a doctor sees it. A bare [data-f="drug"] would address the advice row instead. */
const ROW = (n = 0) => `document.querySelectorAll("#rxLines .rx-line:not(.adv)")[${n}]`;
const FIELD = (f, n = 0) => `var r=${ROW(n)}; var e=r&&r.querySelector('[data-f="${f}"]'); return e?e.value:"NO FIELD";`;
const SET = (n, pairs) => `var r=${ROW(n)}; if(!r) return "NO ROW";` +
  pairs.map(([f, v]) => `var e=r.querySelector('[data-f="${f}"]'); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event("input",{bubbles:true}));`).join("") + `return 1;`;

async function openPad() {
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`window.SMD_VERIFY = { isVerified: function(){ return Promise.resolve(true); }, openPanel: function(){} }; return 1;`);
  await ev(STUB);
  await ev(`SMD_RX.open({ topic: "Acute bacterial pharyngitis" }); return 1;`);
  for (let i = 0; i < 30; i++) { await sleep(300); if (await ev(`return !!document.querySelector('#rxLines [data-f="brand"]');`) === true) break; }
}
// The doctor writes the prescription FIRST — that is the whole premise of the feature.
async function writeRx() {
  await ev(SET(0, [["drug", "Amoxycillin + Clavulanic Acid"], ["brand", "Augmentin 625 Duo Tablet"], ["dose", "1 tab"], ["freq", "BD"], ["duration", "5 days"]]));
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Page.navigate", { url: BASE });
  // The app ships a stale-while-revalidate service worker, so a warm profile can serve a cached
  // bundle and the files under test never load. Drop it and reload once.
  await sleep(1500);
  await ev(`if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) navigator.serviceWorker.getRegistrations().then(function(rs){ rs.forEach(function(r){ r.unregister(); }); }); return 1;`);
  await call("Page.navigate", { url: BASE + "?nosw=1" });
  let ready = false;
  for (let i = 0; i < 120; i++) { await sleep(500); if (await ev(`return !!(window.SMD_RX && window.SMD_RXCHOICE && window.SMD_RXCHOICE_UI && window.SMD_RXCHOICE_FLAGS);`) === true) { ready = true; break; } }
  ok(ready, "the app, the prescription pad and all three RxChoice files load");

  // ── 1. the existing pad still works, untouched ──
  await openPad();
  ok(await ev(`return document.querySelectorAll("#rxLines .rx-line:not(.adv)").length;`) === 1, "the pad still opens with one blank drug row (simple prescription unchanged)");
  await writeRx();
  ok(await ev(FIELD("drug")) === "Amoxycillin + Clavulanic Acid", "the drug the doctor typed is in the drug field");

  // ── 2. RxChoice is opt-in: a button on a finished prescription, nothing automatic ──
  ok(await ev(`return !!document.querySelector("#rxcOpen");`) === true, "the pad offers an RxChoice button");
  ok(await ev(`return document.querySelectorAll("#rxLines .rx-line.adv").length;`) >= 1, "the pad still seeds its advice row");
  ok(await ev(`return !document.querySelector(".rxc-sheet.on");`) === true, "nothing opened on its own: RxChoice is opt-in");
  await ev(`document.querySelector("#rxcOpen").click(); return 1;`);
  for (let i = 0; i < 40; i++) { await sleep(250); if ((await ev(CARDS)).indexOf("GENERIC") >= 0) break; }

  // ── 3. four categories, from the database, with the doctor's product among them ──
  const cats = await ev(CARDS);
  ok(/GENERIC/.test(cats) && /BALANCED/.test(cats) && /PREMIUM/.test(cats) && /PRESCRIBED/.test(cats),
    "all four categories render (" + cats + ")");
  ok(cats.indexOf("BALANCED") >= 0, "Balanced category is present");
  ok(cats.indexOf("⭐") === -1, "No star emoji in categories");
  const labs = (await ev(`return [].slice.call(document.querySelectorAll(".rxc-card .rxc-lab")).map(function(e){return e.textContent.trim();}).join("|");`) || "").toUpperCase();
  ok(labs.indexOf("RECOMMENDED VALUE") >= 0, "Balanced is labelled Recommended Value, not 'best medicine' (" + labs + ")");
  // Here the best-value product IS the cheapest one. The card says so rather than pretending the two
  // recommendations are different products.
  ok(labs.indexOf("ALSO THE LOWEST COST") >= 0, "a Balanced pick that coincides with Generic says so on the card");
  ok((await ev(`return document.querySelector(".rxc-wrap").textContent;`) || "").toUpperCase().indexOf("BEST MEDICINE") === -1,
    "nothing on the panel claims a 'best medicine'");
  const brands = await ev(BRANDS);
  ok(brands.indexOf("Augmentin 625 Duo Tablet") >= 0, "DOCTOR PRESCRIBED still shows the doctor's own product (" + brands + ")");
  ok(brands.indexOf("Moxclav 625 Tablet") >= 0, "the cheapest exact match is offered as GENERIC");
  // The refusals the safety rules exist for must not appear as products.
  ["Clavam 375", "Dry Syrup", "Mox 500", "Gone CV"].forEach((bad) =>
    ok(brands.indexOf(bad) === -1, "excluded from the cards: " + bad));
  ok(await ev(`return !!document.querySelector(".rxc-cost");`) === true, "a course cost is shown, not a bare pack MRP");
  ok((await ev(`return document.querySelector(".rxc-cost").textContent;`) || "").indexOf("for this course") >= 0, "the cost is stated as a course cost");
  // The pad's own brand picker also queries /composition, so this asserts the SUBJECT of every call,
  // not the call count: RxChoice never asks for any composition but the prescribed one.
  const compCalls = await ev(`return window.__api.compCalls.join(" ;; ");`);
  ok(compCalls.length > 0 && compCalls.split(" ;; ").every((c) => c === "Amoxycillin + Clavulanic Acid"),
    "every product came from the StewardMD Drug Database, queried only for the prescribed composition (" + compCalls + ")");

  // ── 4. SELECT changes the BRAND and nothing else ──
  const before = await Promise.all(["drug", "dose", "freq", "duration"].map((f) => ev(FIELD(f))));
  await ev(`var b=[].slice.call(document.querySelectorAll(".rxc-card")).filter(function(c){return /GENERIC/.test(c.textContent);})[0].querySelector(".rxc-btn"); b.click(); return 1;`);
  await sleep(600);
  ok(await ev(FIELD("brand")) === "Moxclav 625 Tablet", "SELECT wrote the chosen product into the brand field");
  const after = await Promise.all(["drug", "dose", "freq", "duration"].map((f) => ev(FIELD(f))));
  ok(JSON.stringify(before) === JSON.stringify(after), "drug, dose, frequency and duration are untouched (" + after.join(" / ") + ")");

  // KEEP returns the doctor's original product immediately.
  await ev(`var b=[].slice.call(document.querySelectorAll(".rxc-card")).filter(function(c){return /PRESCRIBED/.test(c.textContent);})[0].querySelector(".rxc-btn"); b.click(); return 1;`);
  await sleep(600);
  ok(await ev(FIELD("brand")) === "Augmentin 625 Duo Tablet", "KEEP restores the doctor's original product in one tap");

  // ── 5. closing RxChoice leaves a working prescription pad ──
  await ev(`var x=document.querySelector("#rxcX"); if(x) x.click(); return 1;`); await sleep(500);
  ok(await ev(`return !document.querySelector(".rxc-sheet.on");`) === true, "RxChoice closes");
  ok(await ev(`return !!document.querySelector("#rxExport");`) === true, "Sign & Export is still there afterwards");
  await ev(`document.querySelector("#rxAdd").click(); return 1;`); await sleep(400);
  ok(await ev(`return document.querySelectorAll("#rxLines .rx-line:not(.adv)").length;`) === 2, "+ Add drug still works after RxChoice");

  // ── 6. an unpriceable line is honest rather than populated with four guesses ──
  await ev(SET(1, [["drug", "Amoxycillin + Clavulanic Acid"], ["brand", "Clavam 625 Tablet"], ["dose", "1 tab"], ["freq", "SOS"], ["duration", ""]]));
  await ev(`document.querySelector("#rxcOpen").click(); return 1;`);
  for (let i = 0; i < 40; i++) { await sleep(250); if (await ev(`return !!document.querySelector(".rxc-empty");`) === true) break; }
  const emptyTxt = await ev(`var e=document.querySelector(".rxc-empty"); return e?e.textContent:"";`);
  ok(/Dose, frequency and duration/.test(emptyTxt), "a line with no countable course says why instead of inventing one (" + emptyTxt.slice(0, 60) + ")");
  ok((await ev(BRANDS)).indexOf("Clavam 625 Tablet") >= 0, "and that line's original product is still on screen");
  await ev(`var x=document.querySelector("#rxcX"); if(x) x.click(); return 1;`); await sleep(400);

  // ── 7. flag OFF restores the pre-RxChoice pad exactly ──
  await ev(`localStorage.setItem("smd_rxchoice","0"); return 1;`);
  await call("Page.navigate", { url: BASE + "?nosw=1" });
  for (let i = 0; i < 120; i++) { await sleep(500); if (await ev(`return !!(window.SMD_RX && window.SMD_RXCHOICE_FLAGS);`) === true) break; }
  ok(await ev(`return SMD_RXCHOICE_FLAGS.on();`) === false, "the master flag is off");
  await openPad();
  ok(await ev(`return !!document.querySelector("#rxcOpen");`) === false, "with the flag off the pad renders NO RxChoice button");
  await writeRx();
  ok(await ev(FIELD("brand")) === "Augmentin 625 Duo Tablet", "and the prescription pad works exactly as before");
  ok(await ev(`return !!document.querySelector("#rxExport");`) === true, "Sign & Export unaffected");
  await ev(`localStorage.removeItem("smd_rxchoice"); return 1;`);

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
} catch (e) {
  console.log("HARNESS ERROR:", e && e.message || e); fails++;
} finally {
  try { chrome.kill(); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
  process.exit(fails ? 1 : 0);
}
