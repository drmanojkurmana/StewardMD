/* PrepNucleus radnotes (the owner's radiology notes) in the REAL app (headless Chrome over CDP), on a synthetic fixture
 * (test/fixtures/prep-radnotes/api: no text or figure from the notes).
 * What must hold: a module lists every lesson whose index entry names it (3, then Show all); a lesson opens by its key
 * and keeps progress under it; its figures resolve to img/radnotes/ or v1/lessons/media/ under the bank API and all load
 * when the lesson opens; the module pool is the bank file
 * plus overlay/radnotes3/<subject>/<module>.json (the radnotes release folder; its figures stay in img/radnotes/), once per id, keys untouched; the lesson's quick questions draw overlay
 * items, and the overlay image MCQ shows its figure; on native the figure URL carries https://stewardmd.in.
 *
 * USAGE: node test/run-prep-radnotes-ui.mjs   (CHROME=<path>; SHOTS=<dir> saves screenshots, PN_LIGHT=1 in light)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const LOADER_V = (await import("node:fs")).readFileSync(new URL("../prep-loader.js", import.meta.url), "utf8").match(/var V = "([^"]+)"/)[1];
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-rn-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep-radnotes/";
const MID = "rad-gi", KEY = "radnotes-fx-abd-air";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
// Screenshots land on the final frame: after 150 ms (Motion starts its animations on the next frame), finite animations
// (entrances, ring draw) are finished; loops keep running.
const shotCall = async (p) => { await sleep(150); await ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`); return call("Page.captureScreenshot", p); };
const evA = async (e) => { const r = await call("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const shot = async (name) => {
  if (!process.env.SHOTS) return;
  await sleep(320);
  const r = await shotCall({ format: "png" });
  if (r.result) fs.writeFileSync(join(process.env.SHOTS, "radnotes-" + (process.env.PN_LIGHT ? "light-" : "dark-") + name + ".png"), Buffer.from(r.result.data, "base64"));
};
const step = () => ev(`var p=document.querySelector("#smdPrep .pn-t p"); return p ? p.textContent : "";`);
const store = (expr) => ev(`var s=JSON.parse(localStorage.getItem("smd_prep_v1")); return ${expr};`);

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url);
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_SETUP=false; window.SMD_PREP_FLAG_API="/test/fixtures/prep/hidden.json"; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  reqs.length = 0;
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  if (process.env.PN_LIGHT) await ev(`if (!document.getElementById("pnNoTr")) { var t = document.createElement("style"); t.id = "pnNoTr"; t.textContent = "*{transition:none!important}"; document.head.appendChild(t); } document.body.classList.remove("dark"); return 1;`); else await ev(`document.body.classList.add("dark"); return 1;`);

  // ---- module screen: every lesson naming the module is listed (3, then Show all)
  await ev(`PREP.open({ subject: "radiology" }); return 1;`);
  ok(await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m=${MID}]');`, 20000), "Radiology lists the GI module");
  await click(`#smdPrep .pn-mod[data-m=${MID}]`);
  ok(await until(`return document.querySelectorAll("#smdPrep #pnLsnSlot [data-act=l-open]").length === 3;`, 8000), "the module screen lists 3 of its radnotes lessons");
  ok(/Show all 5 lessons/.test(await ev(`var b=document.querySelector("#smdPrep [data-act=l-more]"); return b ? b.textContent : "";`)), "and a Show all 5 lessons row");
  await shot("module");
  await click("#smdPrep [data-act=l-more]");
  ok(await until(`return document.querySelectorAll("#smdPrep #pnLsnSlot [data-act=l-open]").length === 5 && !document.querySelector("#smdPrep [data-act=l-more]");`, 4000), "Show all lists all 5");
  ok(await ev(`return !document.querySelector('#smdPrep [data-l="radnotes-fx-chest"]');`) === true, "a lesson of another module is not listed here");
  ok(await ev(`var b=document.querySelector('#smdPrep [data-l="${KEY}"]'); return !!b && b.getAttribute("data-m")==="${MID}" && /Fixture: free gas/.test(b.textContent);`) === true, "each row names its lesson key, its module and its title");

  // ---- the lesson opens by its key; its figure loads through the bank API base
  await click(`#smdPrep [data-l="${KEY}"]`);
  ok(await until(`return (document.querySelector("#smdPrep .pn-t p")||{}).textContent === "Step 1 of 4";`, 8000), "the radnotes lesson opens in the reader");
  ok(reqs.some((u) => u.includes(FIX + "api/v1/lessons/" + KEY + ".json")), "the lesson file loads by its key");
  { const t0 = Date.now(); while (Date.now() - t0 < 5000 && !reqs.some((u) => u.includes(FIX + "api/v1/lessons/media/rb-fx-p001-2.webp"))) await sleep(120); }
  ok(reqs.some((u) => u.includes(FIX + "api/v1/lessons/media/rb-fx-p001-2.webp")), "opening the lesson fetches every figure at once, step 4's included (offline after one open)");
  await click("#smdPrep [data-act=l-next]");
  ok(await until(`var i=document.querySelector("#smdPrep .pn-vfig img"); return !!i && i.complete && i.naturalWidth > 0;`, 8000), "step 2's figure loads");
  ok(await ev(`return document.querySelector("#smdPrep .pn-vfig img").getAttribute("src");`) === FIX + "api/img/radnotes/rn-fx-p001-1.webp", "the figure resolves to img/radnotes/ under the bank API");
  await shot("figure");
  ok(await store(`!!s.ls["${KEY}"] && s.ls["${KEY}"].i === 1 && !s.ls["${MID}"]`) === true, "progress is kept under the lesson key, not the module");
  await click("#smdPrep [data-act=l-next]"); await click("#smdPrep [data-act=l-next]");
  ok(await until(`var i=document.querySelector("#smdPrep .pn-vfig img"); return !!i && i.complete && i.naturalWidth > 0 && i.getAttribute("src") === ${JSON.stringify(FIX + "api/v1/lessons/media/rb-fx-p001-2.webp")};`, 8000), "step 4's figure resolves to v1/lessons/media/ under the bank API and loads");
  await click("#smdPrep [data-act=l-next]");
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=l-quiz]");`, 4000), "the lesson finishes with its quick questions");

  // ---- the module pool: bank + overlay, deduped by id, keys untouched
  const pool = JSON.parse(await evA(`PREP._host.loadModule("radiology", "${MID}").then(function (it) { return JSON.stringify(it.map(function (x) { return [x.id, x.a, x._ov || "", x._m, x.set || ""]; })); })`));
  ok(pool.map((p) => p[0]).join(",") === "fx-rgi-1,fx-rgi-2,rn-fx-dup,rn-fx-0001,rn-fx-0002", "the module's pool is the bank file plus its overlay items, once each: " + pool.map((p) => p[0]).join(","));
  ok(pool.find((p) => p[0] === "rn-fx-dup")[1] === 2 && pool.find((p) => p[0] === "rn-fx-0002")[1] === 0, "answer keys unchanged (a clash keeps the bank copy)");
  ok(pool.filter((p) => p[2] === "radnotes3" && p[3] === MID).length === 2, "overlay items are tagged with their set (the radnotes3 release) and module");
  ok(reqs.some((u) => u.includes(FIX + "api/overlay/radnotes3/radiology/" + MID + ".json")), "the overlay loads from overlay/radnotes3/radiology/<module>.json");

  // ---- the lesson's quiz draws overlay items; the image MCQ shows its figure
  await click("#smdPrep [data-act=l-quiz]");
  const seen = [];
  for (let k = 0; k < 3; k++) {
    if (!await until(`return !!document.querySelector("#smdPrep .pn-opt[data-k='0']") && !document.querySelector("#smdPrep .pn-fb");`, 5000)) { ok(false, "quiz question " + (k + 1) + " shows"); break; }
    const q = JSON.parse(await ev(`var i=document.querySelector("#smdPrep .pn-qw .pn-vfig img"); return JSON.stringify({ q: document.querySelector("#smdPrep .pn-q").textContent, src: i ? i.getAttribute("src") : "", w: i ? i.naturalWidth : 0 });`));
    if (q.src) { await until(`var i=document.querySelector("#smdPrep .pn-qw .pn-vfig img"); return i.complete && i.naturalWidth > 0;`, 5000); q.w = await ev(`return document.querySelector("#smdPrep .pn-qw .pn-vfig img").naturalWidth;`); if (/figure/.test(q.q)) await shot("image-mcq"); }
    seen.push(q);
    await click("#smdPrep .pn-opt[data-k='0']");
    await until(`return !!document.querySelector("#smdPrep .pn-fb");`, 4000);
    await click("#smdPrep [data-act=next]");
  }
  ok(seen.length === 3 && seen.some((q) => /free gas/.test(q.q)) && seen.some((q) => /what does the figure show/.test(q.q)) && seen.some((q) => /bank question one/.test(q.q)), "the quick questions are the lesson's overlay and bank items: " + seen.map((q) => q.q).join(" | "));
  const im = seen.find((q) => /figure/.test(q.q)) || {};
  ok(im.src === FIX + "api/img/radnotes/rn-fx-p001-1.webp" && im.w > 0, "the overlay image MCQ shows its figure from img/radnotes/ (" + im.src + ")");
  ok(seen.filter((q) => !/figure/.test(q.q)).every((q) => !q.src), "text questions draw no figure");
  ok(await store(`!!s.cards["p:${MID}:rn-fx-0002"] || Object.keys(s.cards).some(function(k){ return k.indexOf("p:${MID}")===0; })`) === true, "answers schedule FSRS cards under the module deck");

  // ---- native: image URLs get the API origin
  const nat = await ev(`window.SMD_API_BASE="https://stewardmd.in"; var it={ id:"n", img:["rn-a-1.webp"], imgPlace:"stem", _ov:"radnotes" }, h={ bankApi:"/api/prep/bank/", esc: PREP._host.esc }; var r=PREP_PYQ.figure(it, h, "stem"); window.SMD_API_BASE=""; return r;`);
  ok(/src="https:\/\/stewardmd\.in\/[^"]*\/img\/radnotes\/rn-a-1\.webp"/.test(nat || ""), "native: an overlay figure URL carries https://stewardmd.in and img/radnotes/");
  await ev(`PREP.close(); return 1;`);
  ok(!reqs.some((u) => /\/api\/(ai|prep\/bank)\//.test(u) && !u.includes(FIX)), "no request to /api/ai or the live bank");
  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ").slice(0, 400) : ""));
} catch (e) {
  console.log("FAIL harness: " + (e && e.stack || e)); fails++;
} finally {
  try { chrome.kill("SIGKILL"); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
