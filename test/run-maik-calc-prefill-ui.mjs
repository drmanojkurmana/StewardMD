/* MaiK calculator PREFILL (flag smd_calc_prefill): "crcl 72F 58kg cr 1.4" opens CrCl already filled,
 * shows every value with the words it came from, the calculator's own result, and what was not
 * stated. Edge Wave 0 (vault/plans/Edge-Master-Plan.md). Real headless browser against the real app.
 * Real headless browser against the real app.
 *
 * Reported 2026-09-02 with a screenshot: "HACOR score" was sent to the cloud model (a paid turn),
 * which returned a fabricated formula, while the "Open calculators" chip under the answer did
 * nothing when tapped. Two defects:
 *   1. the delegated chip handler's closest() selector stopped at data-maik-q/data-maik-web, so the
 *      data-maik-tool branch below it was unreachable - every tool chip was dead;
 *   2. nothing resolved a score NAME against the calculator registry before spending tokens.
 *
 * USAGE: BASE=http://localhost:8996/ CHROME=<chrome binary> node test/run-maik-calc-prefill-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9412, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-calcpf-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

const overlayOn = () => ev(`var o=document.getElementById("mcOverlay"); return !!(o && o.classList.contains("on"));`);
const overlayText = () => ev(`var o=document.getElementById("mcOverlay"); return o ? o.innerText : "";`);
const closeCalc = async () => { await ev(`var c=document.getElementById("mcClose"); if(c) c.click(); return 1;`); await sleep(300); };
const openMaik = async () => { await ev(`SMD_askMaik(""); return 1;`); await sleep(900); };

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
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_askMaik && window.MEDCALC && MEDCALC.find && window.SMD_CPARAMS && window.SMD_CALC_PREFILL)`) === true) { ready = true; break; } }
  ok(ready, "the app, MaiK, the calculators, the parser and the prefill mapper load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await openMaik();
  await ev(`window.__aiCalls = 0; var _f = window.fetch; window.fetch = function (u, o) { try { if (String(u).indexOf("/api/ai") > -1) window.__aiCalls++; } catch (e) {} return _f.apply(this, arguments); }; return 1;`);

  // ── flag OFF (default): behaviour unchanged ──
  await ev(`localStorage.removeItem("smd_calc_prefill"); return 1;`);
  ok(await ev(`return __MAIK_TEST.route("crcl 72F 58kg cr 1.4", null).kind;`) !== "calculator", "flag OFF: a request with values keeps the old route");
  ok(!/maik-calc-pf/.test(String(await ev(`return __MAIK_TEST.calcHTML(__MAIK_TEST.calcFor("crcl"), "crcl 72F 58kg cr 1.4");`))), "flag OFF: no prefill block on the card");

  // ── flag ON ──
  await ev(`localStorage.setItem("smd_calc_prefill","1"); return 1;`);
  ok(await ev(`var r = __MAIK_TEST.route("crcl 72F 58kg cr 1.4", null); return r.kind + ":" + (r.calc && r.calc.id);`) === "calculator:crcl", "flag ON: 'crcl 72F 58kg cr 1.4' routes to CrCl");
  ok(await ev(`var r = __MAIK_TEST.route("meld 3.0 bili 3.2 inr 1.8 creat 2.1 na 128", null); return r.calc && r.calc.id;`) === "meld3", "the score VERSION is kept: 'meld 3.0 ...' opens MELD 3.0");

  await ev(`var q=document.getElementById("maikQ"); q.value="crcl 72F 58kg cr 1.4"; q.dispatchEvent(new Event("input",{bubbles:true})); document.getElementById("maikSend").click(); return 1;`);
  await sleep(1000);
  const card = String(await ev(`var c=[].slice.call(document.querySelectorAll("#maikBody .maik-calc")).pop(); return c ? c.innerText : "";`));
  ok(/From your words/.test(card), "the card shows the values it found");
  ok(/Age:\s*72/.test(card) && /Weight:\s*58 kg/.test(card) && /Serum creatinine:\s*1\.4 mg\/dL/.test(card) && /Sex:\s*Female/.test(card), "each value is listed with its unit");
  ok(/"cr 1\.4"/.test(card), "with the exact words it came from");
  ok(/Result:\s*33 mL\/min/.test(card), "the result is the calculator's own (33 mL/min)");
  ok(await ev(`return window.__aiCalls;`) === 0, "ZERO paid model calls");

  await ev(`[].slice.call(document.querySelectorAll('#maikBody [data-maik-calc="crcl"][data-maik-calcq]')).pop().click(); return 1;`); await sleep(700);
  ok(await overlayOn() === true, "tapping 'with these values' opens the calculator");
  const vals = await ev(`function v(i){var e=document.getElementById("mc_crcl_"+i); return e ? e.value : null;} return [v("age"),v("wt"),v("scr"),v("sex")].join("|");`);
  ok(vals === "72|58|1.4|f", "the calculator inputs are prefilled (" + vals + ")");
  ok(/33/.test(String(await ev(`var p=document.getElementById("mcPanel_crcl"); return p ? p.innerText : "";`))), "and the calculator shows its computed result");
  await closeCalc();

  // ── clinical meaning ──
  await openMaik();
  const past = String(await ev(`return __MAIK_TEST.calcHTML(__MAIK_TEST.calcFor("crcl"), "crcl 60 yo male 70 kg, creatinine was 1.4 last month, now 2.1");`));
  ok(/Serum creatinine:<\/b> 2\.1/.test(past) && !/Serum creatinine:<\/b> 1\.4/.test(past), "the CURRENT creatinine (2.1) is used, not last month's (1.4)");
  const curb = String(await ev(`return __MAIK_TEST.calcHTML(__MAIK_TEST.calcFor("curb65"), "curb65 78 yo RR 32");`));
  ok(/Not stated:/.test(curb) && /Confusion/.test(curb), "CURB-65 with missing items says what was NOT stated");
  ok(/With the stated values/.test(curb) && /not counted/.test(curb), "and labels the score as partial instead of complete");
  const wrong = String(await ev(`return __MAIK_TEST.calcHTML(__MAIK_TEST.calcFor("crcl"), "crcl age 72 wt 58");`));
  ok(/Age:<\/b> 72/.test(wrong) && /Weight:<\/b> 58 kg/.test(wrong), "neighbouring labels are not swapped (age 72, weight 58)");

  // ── restored thread: values are re-derived at tap time ──
  await ev(`var b=document.getElementById("maikBody"); var d=document.createElement("div"); d.className="maik-b ai"; d.id="restoredpf"; d.innerHTML=__MAIK_TEST.calcHTML(__MAIK_TEST.calcFor("anion gap"), "anion gap na 138 cl 100 hco3 12"); b.appendChild(d); b.innerHTML = b.innerHTML; return 1;`);
  await ev(`document.querySelector('#restoredpf [data-maik-calcq]').click(); return 1;`); await sleep(700);
  const ag = await ev(`function v(i){var e=document.getElementById("mc_anion_gap_"+i); return e ? e.value : null;} return [v("na"),v("cl"),v("hco3")].join("|");`);
  ok(ag === "138|100|12", "a restored thread still opens prefilled (" + ag + ")");
  await closeCalc();
  // ── Universal Search: the numbers used to hide the calculator entirely ──
  await ev(`if (window.SMD_SEARCH && SMD_SEARCH.open) SMD_SEARCH.open(); return 1;`); await sleep(400);
  await ev(`SMD_SEARCH.setQuery("crcl 72F 58kg cr 1.4"); return 1;`); await sleep(500);
  const first = String(await ev(`var r=document.querySelector('#usBody .us-row[data-cat="calcs"]'); return r ? r.innerText : "";`));
  ok(/CrCl.*with your values/.test(first), "search finds CrCl for 'crcl 72F 58kg cr 1.4' (" + first.replace(/\s+/g, " ").slice(0, 80) + ")");
  ok(/33 mL\/min/.test(first), "and previews the calculator's own result");
  await ev(`document.querySelector('#usBody .us-row[data-cat="calcs"]').click(); return 1;`); await sleep(700);
  const sv = await ev(`function v(i){var e=document.getElementById("mc_crcl_"+i); return e ? e.value : null;} return [v("age"),v("wt"),v("scr"),v("sex")].join("|");`);
  ok(sv === "72|58|1.4|f", "tapping it opens CrCl prefilled (" + sv + ")");
  await closeCalc();
  await ev(`localStorage.removeItem("smd_calc_prefill"); return 1;`);

  console.log(fails === 0 ? "\nALL GREEN — calculators open prefilled from the doctor's words, with sources and honest gaps" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
