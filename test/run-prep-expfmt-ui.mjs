/* PrepNucleus explanation formatting in the REAL app (headless Chrome over CDP): a stored explanation with
 * an answer sentence, drugs, doses, per-option reasons, a key point and a REF line renders as a strong key
 * line, bolded terms, "why wrong" bullets, a Remember callout and a reference chip at 390 px, light and
 * dark; an Ask MaiK answer with Markdown bold and bullets renders as strong text and a real list.
 * Screenshots go to SHOTS=<dir>.
 *
 * USAGE: node test/run-prep-expfmt-ui.mjs   (BASE=http://localhost:PORT/ for a running server; SHOTS=<dir> saves PNGs)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-expfmt-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FLAGS = (process.env.CHROME_FLAGS || "").split(/\s+/).filter(Boolean);

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu", "--force-device-scale-factor=2"].concat(FLAGS), { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const shotCall = async (p) => { await sleep(200); await ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`); return call("Page.captureScreenshot", p); };
const until = async (e, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(200); } return false; };
let fails = 0, intercepted = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const shot = async (name, dark) => {
  if (!process.env.SHOTS) return;
  const fsx = await import("node:fs");
  fsx.mkdirSync(process.env.SHOTS, { recursive: true });
  await ev(`document.body.classList.${dark ? "add" : "remove"}("dark"); return 1;`);
  await sleep(400);
  const r = await shotCall({ format: "png" });
  if (r.result) fsx.writeFileSync(join(process.env.SHOTS, "expfmt-" + name + "-" + (dark ? "dark" : "light") + ".png"), Buffer.from(r.result.data, "base64"));
};
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);

const ITEM = {
  id: "xf-ans", q: "A 30-year-old woman has beaded renal arteries on angiography. Most likely cause?",
  o: ["Atheroma", "Fibromuscular dysplasia", "Arteritis", "Embolism"], a: 1,
  exp: "Ans. is b i.e. Fibromuscular dysplasia. Beaded look of the mid renal artery in young women is characteristic. Give aspirin 75 mg daily. Ref: Harrison 21/e p1120",
  r: ["Atheroma narrows the ostium in older patients.", "Fibromuscular dysplasia gives mid-artery beads.",
    "Arteritis thickens the wall smoothly.", "An embolism cuts off flow suddenly."],
  kp: "Mid-artery beads in a young woman: think fibromuscular dysplasia.",
  _s: "ss-nephrology", _m: "ss-renovascular"
};
const MAIK_MD = "**Fibromuscular dysplasia** is the answer here.\n- Mid-artery beads in a young woman\n- Atheroma sits at the ostium instead";

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Fetch.requestPaused") {
      intercepted++;
      call("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify({ text: MAIK_MD, usage: { mt: 40 }, wallet: { balanceMt: 1900, costCapOn: true } })).toString("base64") });
      return;
    }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/PREP_EXPFMT|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/ai/prep-teach*" }] });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const FIX = "/test/fixtures/prep/";
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_QGEN=false; window.SMD_PREP_SETUP=false; window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); window.SMD_AUTH = { currentUser: { uid: "s1", getIdToken: function () { return Promise.resolve("tok-1"); } } }; return 1;`;
  const load = async (url) => { await call("Page.navigate", { url }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean); await ev(`SMD_showHome(); return 1;`); await sleep(500); };
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.removeItem("smd_prep"); localStorage.removeItem("smd_prep_v1"); localStorage.removeItem("smd_prep_ask_v1");}catch(e){} localStorage.setItem("smd_home_tools", JSON.stringify({ prep: true })); indexedDB.deleteDatabase("prep-bank"); return 1;`);
  await load(BASE + "?prep=1");
  ok(await until(`return !!document.querySelector('.rnav-tile[data-act=prep]');`, 10000), "?prep=1: the tile renders");
  await click(".rnav-tile[data-act=prep]");
  ok(await until(`return PREP.isOpen() && !!document.querySelector("#smdPrep .pn-tile[data-s=anatomy]");`, 20000), "tile opens PrepNucleus home");
  ok(await ev(`return !!window.PREP_EXPFMT && typeof PREP_EXPFMT.exp === "function";`) === true, "prep-expfmt.js loaded with formatter API");
  await ev(`var s=PREP._host.store(); s.ask={m:"online",q:1}; PREP._host.save(); return 1;`);

  const start = await ev(`PREP._host.run([${JSON.stringify(ITEM)}], "study", "Explanation format check"); return !!document.querySelector("#smdPrep .pn-q");`);
  ok(start === true, "study run starts with the formatted explanation item");
  await ev(`document.querySelectorAll("#smdPrep .pn-opt")[1].click(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-fb");`, 10000), "feedback opens");
  ok(await ev(`var k=document.querySelector("#smdPrep .pn-fb .pn-xkey strong"); return !!k && k.textContent.indexOf("Ans. is b i.e. Fibromuscular dysplasia.") === 0;`) === true, "answer sentence lifts into a strong key line");
  ok(await ev(`var ss=Array.from(document.querySelectorAll("#smdPrep .pn-fb .pn-exp strong")).map(function(e){return e.textContent;}).join("|"); return ss.indexOf("aspirin")>=0 && ss.indexOf("75 mg")>=0;`) === true, "drug and dose embolden in the explanation");
  ok(await ev(`return document.querySelectorAll("#smdPrep .pn-fb .pn-why > li").length === 3;`) === true, "why-the-others-wrong lists 3 bullets");
  ok(await ev(`var k=document.querySelector("#smdPrep .pn-fb .pn-kp"); return !!k && k.textContent.indexOf("Mid-artery beads")>=0;`) === true, "Remember callout shows the key point");
  ok(await ev(`var c=document.querySelector("#smdPrep .pn-fb .pn-xchip"); return !!c && c.textContent.indexOf("Harrison")>=0;`) === true, "reference chip shows the book line");
  ok(await ev(`return !!document.querySelector('#smdPrep .pn-fb .pn-exp strong') && document.querySelector("#smdPrep .pn-fb .pn-exp").tagName === "DIV";`) === true, "explanation uses strong semantics in its block");
  await shot("fb", false); await shot("fb", true);

  // ---- Ask MaiK: a fresh thread opens empty by design (resume() never auto-calls), so send a real doubt
  // like a student would; the mocked teach endpoint answers with Markdown bold and bullets.
  await click('#smdPrep .pn-fb [data-act=ask]');
  ok(await until(`return !!document.getElementById("paIn");`, 8000), "Ask MaiK sheet opens");
  await ev(`var c=document.querySelector('#pnAsk [data-act=ak-consent]'); if(c) c.click(); return 1;`);
  await sleep(1500);
  await ev(`var n=document.querySelectorAll("#pnAsk .pt-msg.ai .pt-ans-b").length;
    if(!n){ var t=document.getElementById("paIn"); if(t){ t.focus(); t.value="Explain simply"; t.dispatchEvent(new Event("input",{bubbles:true})); t.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true})); } } return 1;`);
  console.log("ask state: " + await ev(`var w=document.getElementById("pnAsk"); return w ? ("typing=" + !!w.querySelector('[data-key=typing]') + " empty=" + !!w.querySelector(".pa-empty") + " consent=" + !!w.querySelector("[data-act=ak-consent]") + " ai=" + w.querySelectorAll(".pt-msg.ai").length) : "no-sheet";`));
  console.log("ask turns: " + await ev(`var t=[]; try{var s=JSON.parse(localStorage.getItem("smd_prep_ask_v1")||"{}"); var ks=Object.keys(s.threads||{}); if(ks.length){var us=s.threads[ks[0]].turns||[]; for(var k=0;k<us.length;k++){var u=us[k]; t.push((u.r||"?")+":"+(u.t&&u.t.text?u.t.text:(typeof u.t==="string"?u.t:"")).slice(0,80));}} return t.join(" // ")||"none";}catch(e){return "ERR "+e;}`));
  console.log("ask dom: stored=" + await ev(`return document.querySelectorAll("#pnAsk .pt-stored").length;`) + " bubbles=" + await ev(`return document.querySelectorAll("#pnAsk .pa-txt").length;`) + " strongs=" + await ev(`return document.querySelectorAll("#pnAsk .pa-txt strong").length;`));
  console.log("ask path: " + await ev(`return "pa-ul(old)=" + !!document.querySelector("#pnAsk .pa-txt ul.pa-ul") + " plain-ul(new)=" + !!document.querySelector("#pnAsk .pa-txt ul:not(.pa-ul)");`));
  console.log("ask first-bubble: " + await ev(`var b=document.querySelector("#pnAsk .pa-txt"); return b?b.innerHTML.slice(0,400):"none";`));
  ok(await until(`return document.querySelectorAll("#pnAsk .pt-msg.ai .pt-ans-b").length >= 1;`, 20000), "MaiK answers");
  // The answer reveals word by word (reveal(); off under reduced motion): assert the settled text, not a frame.
  ok(await until(`return !document.querySelector(\"#pnAsk .pa-rev\") && !document.querySelector(\"#pnAsk [data-key=typing]\");`, 10000), "answer reveal settles");
  ok(await ev(`var b=document.querySelector("#pnAsk .pt-msg.ai .pa-txt"); return !!b && !!b.querySelector("strong") && b.querySelector("strong").textContent.indexOf("Fibromuscular dysplasia")>=0;`) === true, "MaiK answer renders Markdown bold as strong");
  ok(await ev(`return document.querySelectorAll("#pnAsk .pt-msg.ai .pa-txt ul > li").length === 2;`) === true, "MaiK answer renders Markdown bullets as a 2-item list");
  ok(await ev(`var s=document.querySelector("#pnAsk .pt-stored .pn-xkey strong"); return !!s && s.textContent.indexOf("Ans. is b")>=0;`) === true, "stored explanation under the answer keeps the key line");
  await shot("ask", false); await shot("ask", true);

  // ---- compliance at 390 px
  const lum = (c) => { const x = c.match(/[\d.]+/g).map(Number).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2]; };
  const ratio = (f, b) => (Math.max(lum(f), lum(b)) + 0.05) / (Math.min(lum(f), lum(b)) + 0.05);
  const cols = `var m=document.querySelector("#smdPrep .pn-fb .pn-xkey strong"); if(!m) return "none";
    function opaque(c){var a=String(c).match(/[\\d.]+/g); return !a || a.length<3 || !(+a[0]===0&&+a[1]===0&&+a[2]===0&&a.length>3&&+a[3]===0);}
    var el=m, b=null; while(el){var c=getComputedStyle(el).backgroundColor; if(opaque(c)){b=c;break;} el=el.parentElement;}
    if(!b) b=getComputedStyle(document.body).backgroundColor;
    return getComputedStyle(m).color + " on " + b;`;
  await ev(`document.body.classList.remove("dark"); return 1;`); await sleep(300);
  const [fL, bL] = String(await ev(cols)).split(" on ");
  const crLight = bL === undefined ? 0 : ratio(fL, bL);
  ok(crLight >= 4.5, "light: key-line contrast " + (bL === undefined ? String(await ev(cols)) : crLight.toFixed(2) + ":1"));
  await ev(`document.body.classList.add("dark"); return 1;`); await sleep(300);
  const [fD, bD] = String(await ev(cols)).split(" on ");
  const crDark = bD === undefined ? 0 : ratio(fD, bD);
  ok(crDark >= 4.5, "dark: key-line contrast " + (bD === undefined ? String(await ev(cols)) : crDark.toFixed(2) + ":1"));
  ok(await ev(`return document.documentElement.clientWidth <= 390 && document.querySelector("#smdPrep").scrollWidth <= 391;`) === true, "390 px: no horizontal scroll");
  ok(await ev(`return document.getAnimations().filter(function(a){var t=a.effect&&a.effect.target; return t&&t.closest&&t.closest(".pn-exp,.pn-xkey,.pn-xchip,.pa-txt");}).length === 0;`) === true, "explanation adds no animation");
  ok(errors.length === 0, "no PREP page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
  console.log("teach requests intercepted: " + intercepted);
  console.log(fails ? `FAILED ${fails}` : "ALL PASS");
} catch (e) { console.log("FAIL harness: " + (e && e.stack || e)); fails++; }
try { ws && ws.close(); } catch {}
chrome.kill();
if (serveProc) serveProc.kill();
process.exit(fails ? 1 : 0);
