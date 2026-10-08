/* PrepNucleus Radiology NEET-SS best module in the REAL app (headless Chrome over CDP): the subject's own bank version
 * (v7, from the taxonomy bv), the lesson reader showing a figure that is a bank path (v7/ss-radiology/img/...) through
 * the bank API, and the lesson quiz drawing its 3 items from the v7 module file.
 * Default: the made-up fixture in test/fixtures/prep-radss/ (synthetic test pattern, fixture text). REAL=<dir> runs on a
 * real build output holding v7/ss-radiology/{index.json,mcq,img} and v1/lessons/{index.json,<module>.json}
 * (e.g. REAL=~/prep-data/radnotes/ss/out) with the app's own prep/taxonomy.json, and also loads every image of every
 * module file and checks every item and lesson for source or AI words.
 * What must hold: the NEET-SS tab lists Radiology; the module shows a Lesson row; the reader shows the figure step with
 * the image loaded from <bank api>/v7/ss-radiology/img/; tapping it enlarges the same image; the 3 quick questions run;
 * practice shows an image question with its image from v7; nothing is wider than a 390 px phone; no source, licence or
 * AI label in the lesson or the question; no request to /api/ai or the live bank; no uncaught PrepNucleus error.
 *
 * USAGE: node test/run-prep-radss-ui.mjs   (CHROME=<path>; SHOTS=<dir>; REAL=<dir> [MODULE=<id>])
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..");
const LOADER_V = fs.readFileSync(join(ROOT, "prep-loader.js"), "utf8").match(/var V = "([^"]+)"/)[1];
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-radss-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const SID = "ss-radiology", VER = "v7";

let FIX = "/test/fixtures/prep-radss/", realDir = null, MID = "srd-msk-tumour", src = null;
if (process.env.REAL) {
  src = resolve(process.env.REAL.replace(/^~/, process.env.HOME));
  realDir = join(HERE, "fixtures", ".radss-real-" + process.pid);
  fs.mkdirSync(join(realDir, "bank", VER, SID), { recursive: true });
  fs.copyFileSync(join(ROOT, "prep/taxonomy.json"), join(realDir, "taxonomy.json"));
  fs.copyFileSync(join(src, VER, SID, "index.json"), join(realDir, "bank", VER, SID, "index.json"));
  fs.writeFileSync(join(realDir, "hidden.json"), '{"ids":[]}');
  fs.symlinkSync(src, join(realDir, "api"));
  FIX = "/test/fixtures/.radss-real-" + process.pid + "/";
  // a module with a lesson whose steps show a figure, else any module with a lesson
  const ix = JSON.parse(fs.readFileSync(join(src, "v1", "lessons", "index.json"), "utf8")).modules;
  const withFig = Object.keys(ix).filter((m) => /^srd-/.test(m) && fs.existsSync(join(src, "v1", "lessons", m + ".json"))).filter((m) => JSON.parse(fs.readFileSync(join(src, "v1", "lessons", m + ".json"), "utf8")).steps.some((s) => s.vis && s.vis.kind === "image"));
  MID = process.env.MODULE || withFig[0] || Object.keys(ix).find((m) => /^srd-/.test(m));
}
const REAL = !!realDir;

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const evA = async (e) => { const r = await call("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const text = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g," ").trim() : "";`);
const shot = async (name) => {
  if (!process.env.SHOTS) return;
  fs.mkdirSync(process.env.SHOTS, { recursive: true });
  await sleep(350);
  await ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`);
  const r = await call("Page.captureScreenshot", { format: "png" });
  if (r.result) fs.writeFileSync(join(process.env.SHOTS, "radss-" + name + ".png"), Buffer.from(r.result.data, "base64"));
};
const overflow = () => ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); var o=[]; document.querySelectorAll("#smdPrep *").forEach(function(e){ var r=e.getBoundingClientRect(); if(r.width && r.right>innerWidth+1 && !e.closest(".pn-filters,.pn-tabs,.pn-zoom-sc,.pn-stack-z,.pn-vtbl")) o.push(e.className||e.tagName); }); return o.slice(0,5).join("|");`);
const LABELS = /\b(AI|AI-generated|Radiopaedia|PMC|PubMed|Creative Commons|licen[cs]e|case report|textbook|et al)\b/;

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
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false; window.speechSynthesis && (window.speechSynthesis.speak = function(){});` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);
  reqs.length = 0;
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  await ev(`document.body.classList.add("dark"); return 1;`);

  // ---- NEET-SS tab -> Radiology -> module with a lesson
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=exam][data-v=neet-ss]");`, 20000), "PrepNucleus opens with exam tabs");
  await click(`#smdPrep [data-act=exam][data-v=neet-ss]`);
  ok(await until(`return !!document.querySelector('#smdPrep [data-act=subject][data-s="${SID}"]');`, 8000), "the NEET-SS tab lists Radiology");
  await click(`#smdPrep [data-act=subject][data-s="${SID}"]`);
  ok(await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m="${MID}"]');`, 8000), "Radiology lists the module " + MID);
  await shot("subject");
  await click(`#smdPrep .pn-mod[data-m="${MID}"]`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=l-open]");`, 8000), "the module screen shows a Lesson row");
  await shot("module");

  // ---- lesson reader: walk to the figure step
  await click("#smdPrep [data-act=l-open]");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-lsn-tx");`, 8000), "Lesson opens the reader");
  const nSteps = +(await ev(`return document.querySelectorAll("#smdPrep .pn-lsn-prog i").length;`));
  ok(nSteps >= 4 && nSteps <= 8, "the lesson has 4 to 8 steps (" + nSteps + ")");
  let lessonText = "", figSeen = false;
  for (let k = 0; k < nSteps; k++) {
    lessonText += " " + (await text("#smdPrep .pn-lsn-tx")) + " " + (await text("#smdPrep .pn-vis"));
    const of = await overflow(); if (of) ok(false, "step " + (k + 1) + " is wider than the screen: " + of);
    if (!figSeen && await ev(`return !!document.querySelector("#smdPrep .pn-vfig img");`) === true) {
      figSeen = true;
      const s = await ev(`return document.querySelector("#smdPrep .pn-vfig img").src;`);
      ok(new RegExp(FIX.replace(/[.]/g, "\\.") + "api/" + VER + "/" + SID + "/img/[a-z0-9-]+\\.webp$").test(s), "the lesson figure loads through the bank API from the v7 path: " + s);
      ok(await until(`var i=document.querySelector("#smdPrep .pn-vfig img"); return !!(i && i.complete && i.naturalWidth > 0);`, 8000), "the lesson figure loads");
      await shot("lesson-figure");
      await click("#smdPrep [data-act=l-zoom]");
      ok(await until(`var i=document.querySelector("#smdPrep #pnZoom img"); return !!(i && i.src === ${JSON.stringify(s)});`, 3000), "tapping the figure enlarges the same image");
      await ev(`PREP.back(); return 1;`);
      ok(await until(`return !document.querySelector("#smdPrep #pnZoom") && !!document.querySelector("#smdPrep .pn-lsn-tx");`, 3000), "back() closes the enlarged figure first");
    }
    if (k < nSteps - 1) await click("#smdPrep [data-act=l-next]");
    await sleep(120);
  }
  ok(figSeen, "a lesson step shows a figure");
  ok(!LABELS.test(lessonText), "no source, licence or AI label in the lesson" + (LABELS.test(lessonText) ? ": " + lessonText.match(LABELS)[0] : ""));
  ok(!/[‒-―]/.test(lessonText), "no long dash in the lesson");
  await click("#smdPrep [data-act=l-next]");
  ok(await until(`return !!document.querySelector("#smdPrep [data-act=l-quiz]");`, 5000), "the last step offers the quick questions");
  await shot("lesson-end");
  await click("#smdPrep [data-act=l-quiz]");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q");`, 8000), "the quick questions start");
  ok(reqs.some((u) => u.includes(FIX + "api/" + VER + "/" + SID + "/mcq/" + MID + ".json")), "the quiz items come from the v7 module file");
  await ev(`PREP.back(); return 1;`); await sleep(300);

  // ---- practice: an image question from v7
  await ev(`PREP.close(); return 1;`);
  await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
  await ev(`PREP.open(); return 1;`);
  if (await until(`return !!document.querySelector("#smdPrep [data-act=exam][data-v=neet-ss]");`, 20000)) await click(`#smdPrep [data-act=exam][data-v=neet-ss]`);
  if (await until(`return !!document.querySelector('#smdPrep [data-act=subject][data-s="${SID}"]');`, 8000)) await click(`#smdPrep [data-act=subject][data-s="${SID}"]`);
  if (await until(`return !!document.querySelector('#smdPrep .pn-mod[data-m="${MID}"]');`, 8000)) await click(`#smdPrep .pn-mod[data-m="${MID}"]`);
  if (await until(`return !!document.querySelector("#smdPrep [data-act=start][data-k=study]");`, 8000)) await click(`#smdPrep [data-act=start][data-k=study]`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-q");`, 8000), "practice starts");
  let hit = false;
  for (let i = 0; i < 40 && !hit; i++) {
    hit = await ev(`return !!document.querySelector("#smdPrep .pn-q") && !!document.querySelector("#smdPrep .pn-yq-fig img");`) === true;
    if (hit) break;
    if (await ev(`return !!document.querySelector("#smdPrep [data-act=donerun]");`) === true) break;
    if (!(await ev(`return !!document.querySelector("#smdPrep .pn-fb");`))) await click(`#smdPrep [data-act=answer][data-k="0"]`);
    await click("#smdPrep [data-act=next]"); await sleep(150);
  }
  ok(hit, "an image question is reached");
  if (hit) {
    ok(await until(`var i=document.querySelector("#smdPrep .pn-yq-fig img"); return !!(i && i.complete && i.naturalWidth > 0);`, 8000), "the question image loads");
    ok(await ev(`return /\\/api\\/v7\\/ss-radiology\\/img\\/[a-z0-9-]+\\.webp$/.test(document.querySelector("#smdPrep .pn-yq-fig img").src);`) === true, "the question image comes from the v7 path");
    ok(await overflow() === "", "the image question fits the screen");
    await shot("question");
    await click(`#smdPrep [data-act=answer][data-k="0"]`);
    ok(await until(`return !!document.querySelector("#smdPrep .pn-fb");`, 3000), "answering shows the explanation");
    const runText = await ev(`return document.querySelector("#smdPrep .pn-run").textContent;`);
    ok(!LABELS.test(runText), "no source, licence or AI label on the question or explanation");
    await shot("explanation");
  }

  // ---- REAL: every module file's items and images
  if (REAL) {
    const r = await evA(`(async function () {
      var api = ${JSON.stringify(FIX + "api/" + VER + "/" + SID + "/")}, ix = await (await fetch(api + "index.json")).json(), bad = [], n = 0, imgs = [];
      for (var t of ix.topics) { var f = await (await fetch(api + "mcq/" + t.id + ".json")).json(); for (var it of f.items) { n++; if (it.img) imgs = imgs.concat(it.img); if (${LABELS}.test(it.q + " " + it.exp + " " + it.kp + " " + JSON.stringify(it.x))) bad.push(it.id); } }
      var loaded = 0;
      await Promise.all(imgs.map(function (p) { return new Promise(function (res) { var im = new Image(); im.onload = function () { if (im.naturalWidth > 0) loaded++; res(); }; im.onerror = res; im.src = ${JSON.stringify(FIX + "api/")} + p; }); }));
      return { n: n, imgs: imgs.length, loaded: loaded, bad: bad, topics: ix.topics.length };
    })()`);
    ok(r && r.n > 0, "real bank: " + (r && r.n) + " items in " + (r && r.topics) + " modules");
    ok(r && r.loaded === r.imgs, "real bank: every image loads (" + (r && r.loaded) + " of " + (r && r.imgs) + ")");
    ok(r && r.bad.length === 0, "real bank: no source, licence or AI words in any item" + (r && r.bad.length ? ": " + r.bad.slice(0, 5).join(",") : ""));
  }

  // ---- network, errors
  ok(reqs.some((u) => u.includes("/prep-lessons.js?v=" + LOADER_V)), "prep-lessons.js loads at the current token (" + LOADER_V + ")");
  ok(!reqs.some((u) => /\/api\/(ai|prep\/bank)/.test(u)), "no request to /api/ai or the live bank");
  await ev(`PREP.close(); return 1;`);
  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ").slice(0, 400) : ""));
} catch (e) {
  console.log("FAIL harness: " + (e && e.stack || e)); fails++;
} finally {
  try { chrome.kill("SIGKILL"); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
  await sleep(300);
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  try { if (realDir) fs.rmSync(realDir, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
