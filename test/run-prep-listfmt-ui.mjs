/* PrepNucleus list formatting in the REAL app (headless Chrome over CDP): the owner's item Q-8AV-4D5-GR7
 * (arrange, glued a. to f.) and a match-the-following sample render as a neat list / two-column table at 390 px,
 * light and dark, with list and table semantics and an accessible option order. Screenshots go to SHOTS=<dir>.
 *
 * USAGE: node test/run-prep-listfmt-ui.mjs   (BASE=http://localhost:PORT/ for a running server; SHOTS=<dir> saves PNGs)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-listfmt-" + PORT + "-" + Date.now();
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
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const shot = async (name, dark) => {
  if (!process.env.SHOTS) return;
  await ev(`document.body.classList.${dark ? "add" : "remove"}("dark"); return 1;`);
  await sleep(400);
  const r = await shotCall({ format: "png" });
  if (r.result) (await import("node:fs")).writeFileSync(join(process.env.SHOTS, "listfmt-" + name + "-" + (dark ? "dark" : "light") + ".png"), Buffer.from(r.result.data, "base64"));
};

const OWNER_Q = "Arrange the incidence of various types of breast cancers in increasing incidence. a. PTEN ( Cowden disease )b. Sporadic breast cancerc. Hereditary breast cancerd. BRCA1e. BRCA2f. Familial breast cancer";
const OWNER_E = "Breast cancer Incidence Sporadic breast cancer 65-75 % Familial breast cancer 20-30 % Hereditary breast cancer 5-10 % BRCA1 45 % BRCA 2 35 % p53 ( Li-Fraumeni syndrome ) 1 % STK11/LKB1a (Peutz-Jegherssyndrome), PTENa (Cowdendisease), MSH2/MLH1a ( Muir-Torresyndrome), ATMa (Ataxiatelangiectasia ) Less than 1 % Unknown 20 %";
const MATCH_Q = "Match each interstitial lung disease pattern with its characteristic imaging finding.\nColumn A\nA. UIP\nB. NSIP\nC. LCH\nD. COP\nColumn B\n1. Honeycombing\n2. Sub-pleural sparing\n3. Bizarre cysts\n4. Atoll sign";

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/PREP_LISTFMT|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_ONBOARD=false; window.confirm=function(){return true;};` });
  await call("Page.navigate", { url: BASE + "?prep=1" });
  await until(`return !!(window.PREP && window.SMD_showHome);`, 30000);
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); SMD_showHome(); return 1;`);
  await sleep(500);
  await ev(`document.querySelector('.rnav-tile[data-act=prep]').click(); return 1;`);
  ok(await until(`return PREP.isOpen() && !!window.PREP_LISTFMT;`, 20000), "PrepNucleus opens with prep-listfmt.js loaded");
  ok(await ev(`return typeof PREP_LISTFMT.parse === "function" && typeof PREP_LISTFMT.stem === "function";`) === true, "parser API present in page");

  const start = await ev(`PREP._host.run([
    { id: "lf-owner", q: ${JSON.stringify(OWNER_Q)}, o: ["a,b,c,d,e,f", "a,d,b,c,f,e", "c,a,f,d,b,e", "a,c,f,e,d,b"], a: 3, exp: ${JSON.stringify(OWNER_E)}, _s: "surgery", _m: "sur-breast-cancer" },
    { id: "lf-match", q: ${JSON.stringify(MATCH_Q)}, o: ["A-1, B-2, C-3, D-4", "A-2, B-1, C-4, D-3", "A-3, B-4, C-1, D-2", "A-4, B-3, C-2, D-1"], a: 0, exp: "Honeycombing marks UIP.", _s: "ss-pulmonology", _m: "ss-ild" }
  ], "study", "List format check"); return !!document.querySelector("#smdPrep .pn-q");`);
  ok(start === true, "study run starts with the two list items");

  // ---- owner's arrange item: neat list, sequence option chips
  ok(await ev(`return document.querySelectorAll("#smdPrep .pn-q .pn-lf > li").length === 6;`) === true, "owner stem renders 6 list rows");
  ok(await ev(`return Array.from(document.querySelectorAll("#smdPrep .pn-q .pn-lf-m")).map(function(e){return e.textContent;}).join(" ") === "a) b) c) d) e) f)";`) === true, "labels read a) to f)");
  ok(await ev(`return !/cancerc|disease\\)b/.test(document.querySelector("#smdPrep .pn-q").textContent);`) === true, "no glued joints left");
  ok(await ev(`var l=document.querySelector("#smdPrep .pn-q .pn-lf"); return l && l.tagName === "OL" && l.querySelectorAll(":scope > li").length === 6;`) === true, "list semantics: one OL with 6 LI");
  ok(await ev(`var s=document.querySelector("#smdPrep .pn-opt .pn-seq"); return !!s && s.getAttribute("aria-label") === "Order: a, d, b, c, f, e";`) === true, "first option is an accessible order chip row");
  await shot("owner-q", false);
  await ev(`document.querySelectorAll("#smdPrep .pn-opt")[3].click(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-fb");`, 10000), "feedback opens");
  ok(await ev(`return document.querySelectorAll("#smdPrep .pn-exp table.pn-lf-v tbody tr").length === 8;`) === true, "explanation table has 8 label/value rows");
  ok(await ev(`return !!document.querySelector('#smdPrep .pn-exp th[scope="row"]') && !!document.querySelector('#smdPrep .pn-exp [role="region"]');`) === true, "value rows use row headers in a labelled region");
  await shot("owner-fb", false);

  // ---- match-the-following sample
  await ev(`document.querySelector('#smdPrep [data-act=next]').click(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-lf-t thead");`, 10000), "match stem renders a table");
  ok(await ev(`return Array.from(document.querySelectorAll("#smdPrep .pn-lf-t thead th")).map(function(e){return e.textContent;}).join("|") === "Column I|Column II";`) === true, "Column I / Column II headers");
  ok(await ev(`return document.querySelectorAll("#smdPrep .pn-lf-t tbody tr").length === 4 && !!document.querySelector("#smdPrep .pn-xt[role=region]");`) === true, "4 paired rows in a labelled scroll region");
  ok(await ev(`var t=document.querySelector("#smdPrep .pn-lf-t"); return t.tagName === "TABLE" && t.querySelectorAll('th[scope="col"]').length === 2;`) === true, "table semantics: 2 column headers");
  await ev(`document.querySelectorAll("#smdPrep .pn-opt")[0].click(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep .pn-fb");`, 10000), "match feedback opens");
  ok(await ev(`var s=document.querySelector("#smdPrep .pn-opt .pn-pairs"); return !!s && /pairs with/.test(s.getAttribute("aria-label"));`) === true, "match option pairs carry an accessible label");
  await shot("match-fb", false);

  // ---- compliance at 390 px: no sideways scroll, labels contrast, no motion, dark palette
  const contrast = `var m=document.querySelector("#smdPrep .pn-lf-m") || document.querySelector("#smdPrep .pn-pair-s"); if(!m) return 0;
    function lum(c){var x=c.match(/[\\d.]+/g).map(Number).slice(0,3).map(function(v){v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}); return 0.2126*x[0]+0.7152*x[1]+0.0722*x[2];}
    var f=getComputedStyle(m).color, b=getComputedStyle(m.closest(".pn-opt")||m.parentElement).backgroundColor;
    var l1=lum(f), l2=lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);`;
  await ev(`document.body.classList.remove("dark"); return 1;`); await sleep(300);
  const crLight = await ev(`return (${contrast});`);
  ok(crLight >= 4.5, "light: muted labels contrast " + Number(crLight).toFixed(2) + ":1");
  await shot("match-fb", true);
  const crDark = await ev(`return (${contrast});`);
  ok(crDark >= 4.5, "dark: muted labels contrast " + Number(crDark).toFixed(2) + ":1");
  ok(await ev(`return document.documentElement.clientWidth <= 390 && document.querySelector("#smdPrep").scrollWidth <= 391;`) === true, "390 px: no horizontal scroll");
  ok(await ev(`return document.getAnimations().filter(function(a){var t=a.effect&&a.effect.target; return t&&t.closest&&t.closest(".pn-lf,.pn-seq,.pn-pairs,.pn-lf-t");}).length === 0;`) === true, "list/table/chips add no animation");
  ok(errors.length === 0, "no PREP page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
  console.log(fails ? `FAILED ${fails}` : "ALL PASS");
} catch (e) { console.log("FAIL harness: " + (e && e.stack || e)); fails++; }
try { ws && ws.close(); } catch {}
chrome.kill();
if (serveProc) serveProc.kill();
process.exit(fails ? 1 : 0);
