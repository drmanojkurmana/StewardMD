/* Phase 8 P2 CDP test (real headless Chrome): the four P2 sub-features rendered end to end with all
 * onco flags stubbed ON. Loads the REAL onco-ctcae.js / onco-iotox.js / onco-recist.js /
 * onco-favorites.js / onco-home.js and the REAL kb/onco/ctcae + kb/onco/iotox JSON (served from repo
 * root). Asserts:
 *   - the CTCAE / IO-tox / RECIST grid cards are now ACTIVE cards (P0/P1 placeholders replaced)
 *   - CTCAE: the AE list + R1 flag render; an AE shows Grade 1-5 including an honest "not defined"; the
 *     version toggle to v4.03 shows the honest content gap (no guessed v4 deltas)
 *   - IO toxicity: organ list + general principles render; an organ shows grade principles + the
 *     specifics gap note (no fabricated doses)
 *   - RECIST: baseline 100 -> 65 = PR; -> 130 = PD; a new lesion = PD (real computation, live)
 *   - Favorites/Recent: starring a card adds it to Favourites; opening a tool records it in Recent
 * USAGE: node test/run-onco-p2-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8796, DBG = 9387, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/onco-p2-ui-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "test/onco-p2-ui-harness.html" });

  let ready = null;
  for (let i = 0; i < 60; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, "real onco-ctcae/iotox/recist/favorites/home loaded into the harness");

  await ev(`window.SMD_ONCOHOME.open(); return 1;`);
  await sleep(300);

  // ---- the P0/P1 placeholders are now ACTIVE cards ----
  ok(await ev(`return !!document.querySelector('[data-oh-act="ctcae-open"]');`) === true, "CTCAE card is now an active card (placeholder replaced)");
  ok(await ev(`return !!document.querySelector('[data-oh-act="iotox-open"]');`) === true, "IO Toxicity card is now an active card (placeholder replaced)");
  ok(await ev(`return !!document.querySelector('[data-oh-act="recist-open"]');`) === true, "RECIST card is now an active card");

  // ================= CTCAE =================
  await ev(`document.querySelector('[data-oh-act="ctcae-open"]').click(); return 1;`); await sleep(400);
  ok(await ev(`return !!(document.getElementById("smdOncoCtcae") && document.getElementById("smdOncoCtcae").classList.contains("on"));`) === true, "clicking CTCAE opens the #smdOncoCtcae overlay");
  const ctcList = (await ev(`return document.getElementById("ctcResults").textContent || "";`)) || "";
  ok(/Neutrophil count decreased/.test(ctcList), "the CTCAE AE list renders a seeded adverse event (Neutrophil count decreased)");
  ok(/Requires R1 verification|R1 verification/i.test(ctcList) || /curated CTCAE v5\.0 subset/i.test(ctcList), "the CTCAE list states its curated CTCAE v5.0 provenance");
  const ctcVbtns = await ev(`return document.querySelectorAll('#smdOncoCtcae .stg-vbtn').length;`);
  ok(Number(ctcVbtns) >= 2, `a CTCAE version toggle renders v5.0 + v4.03 (${ctcVbtns})`);

  // open Fatigue -> Grade 1..5 with an honest "not defined at this grade"
  await ev(`document.querySelector('#smdOncoCtcae [data-ctc-act="ae:fatigue"]').click(); return 1;`); await sleep(250);
  const fat = (await ev(`return document.getElementById("ctcResults").textContent || "";`)) || "";
  ok(/Grade 1/.test(fat) && /Grade 5/.test(fat), "an AE detail renders all five CTCAE grade rows");
  ok(/Fatigue relieved by rest/.test(fat), "the seeded CTCAE v5.0 grade text renders verbatim (Fatigue: relieved by rest)");
  ok(/Not defined at this grade/i.test(fat), "a grade CTCAE does not define shows the honest 'not defined at this grade', not an invented cut-off");

  // back to the list (the version toggle lives on the list), then v4.03 -> honest gap (deltas not guessed)
  await ev(`document.querySelector('#smdOncoCtcae [data-ctc-act="list"]').click(); return 1;`); await sleep(150);
  await ev(`var b=Array.prototype.filter.call(document.querySelectorAll('#smdOncoCtcae .stg-vbtn'),function(x){return /v4\\.03/.test(x.textContent);})[0]; if(b) b.click(); return 1;`); await sleep(200);
  const ctcGap = (await ev(`return document.getElementById("ctcResults").textContent || "";`)) || "";
  ok(/Consult the full NCI CTCAE v5\.0/.test(ctcGap), "switching to CTCAE v4.03 shows the honest content gap (v4 deltas not guessed)");
  await ev(`document.querySelector('#smdOncoCtcae [data-ctc-act="close"]').click(); return 1;`); await sleep(150);

  // ================= IO TOXICITY (irAE) =================
  await ev(`document.querySelector('[data-oh-act="iotox-open"]').click(); return 1;`); await sleep(400);
  ok(await ev(`return !!(document.getElementById("smdOncoIotox") && document.getElementById("smdOncoIotox").classList.contains("on"));`) === true, "clicking IO Toxicity opens the #smdOncoIotox overlay");
  const iotList = (await ev(`return document.getElementById("iotResults").textContent || "";`)) || "";
  ok(/General principles/.test(iotList), "the irAE reference renders the general management principles");
  ok(/ASCO|NCCN|SITC/.test(iotList), "the irAE reference names the grounding guidelines (ASCO/NCCN/SITC)");
  ok(/intentionally not reproduced|not reproduced here/i.test(iotList), "the specifics gap note (no doses/thresholds) is shown");
  await ev(`document.querySelector('#smdOncoIotox [data-iot-act="organ:colitis"]').click(); return 1;`); await sleep(200);
  const iotOrg = (await ev(`return document.getElementById("iotResults").textContent || "";`)) || "";
  ok(/Grade 1/.test(iotOrg) && /Grade 4/.test(iotOrg), "an organ detail renders grade-based principles (Grade 1-4)");
  ok(/second-line immunosuppress/i.test(iotOrg), "the escalation principle (second-line immunosuppression) renders");
  ok(!/\d\s*mg\b/i.test(iotOrg), "no fabricated mg dose appears in the irAE principle text");
  await ev(`document.querySelector('#smdOncoIotox [data-iot-act="close"]').click(); return 1;`); await sleep(150);

  // ================= RECIST 1.1 =================
  await ev(`document.querySelector('[data-oh-act="recist-open"]').click(); return 1;`); await sleep(300);
  ok(await ev(`return !!(document.getElementById("smdOncoRecist") && document.getElementById("smdOncoRecist").classList.contains("on"));`) === true, "clicking RECIST opens the #smdOncoRecist overlay");
  // PR: baseline 100 -> current 65
  await ev(`var b=document.getElementById('recBase'),c=document.getElementById('recCur');
    function setv(el,v){var d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; d.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true}));}
    setv(b,'100'); setv(c,'65'); return 1;`); await sleep(150);
  ok(/Partial Response \(PR\)/.test((await ev(`return document.getElementById("recResult").textContent || "";`)) || ""), "RECIST baseline 100 -> 65 computes Partial Response (PR)");
  // PD: current 130
  await ev(`var c=document.getElementById('recCur'); var d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; d.call(c,'130'); c.dispatchEvent(new Event('input',{bubbles:true})); return 1;`); await sleep(150);
  ok(/Progressive Disease \(PD\)/.test((await ev(`return document.getElementById("recResult").textContent || "";`)) || ""), "RECIST current 130 (from nadir 100) computes Progressive Disease (PD)");
  // new lesion -> PD regardless
  await ev(`var c=document.getElementById('recCur'); var d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; d.call(c,'50'); c.dispatchEvent(new Event('input',{bubbles:true}));
    var n=document.getElementById('recNew'); n.checked=true; n.dispatchEvent(new Event('change',{bubbles:true})); return 1;`); await sleep(150);
  const recNew = (await ev(`return document.getElementById("recResult").textContent || "";`)) || "";
  ok(/Progressive Disease \(PD\)/.test(recNew) && /new lesion/i.test(recNew), "a new lesion scores PD regardless of a shrinking sum");
  ok(/RECIST 1\.1/.test(recNew), "the RECIST result is cited to RECIST 1.1");
  await ev(`document.querySelector('#smdOncoRecist [data-rec-act="close"]').click(); return 1;`); await sleep(150);

  // ================= FAVORITES + RECENT =================
  // Recent: opening CTCAE/IO/RECIST above recorded them. Re-open Onco Home to repaint the dashboard.
  await ev(`window.SMD_ONCOHOME.open(); return 1;`); await sleep(250);
  const stars = await ev(`return document.querySelectorAll('#smdOncoHome .oh-star').length;`);
  ok(Number(stars) >= 1, `favorite stars render on Onco Home cards when the favorites flag is on (${stars})`);
  const dash1 = (await ev(`return document.getElementById("ohResults").textContent || "";`)) || "";
  ok(/Recent/.test(dash1) && /Toxicity \/ CTCAE/.test(dash1), "opening tools populated the Recent list (Toxicity / CTCAE)");
  // Star the RECIST GRID card (scope to .oh-grid so we do not grab the Recent chip), re-open, assert Favourites
  await ev(`var w=document.querySelector('#smdOncoHome .oh-grid [data-oh-act="recist-open"]').closest('.oh-card-wrap'); w.querySelector('.oh-star').click(); return 1;`); await sleep(150);
  await ev(`window.SMD_ONCOHOME.open(); return 1;`); await sleep(200);
  const dash2 = (await ev(`return document.getElementById("ohResults").textContent || "";`)) || "";
  ok(/Favourites/.test(dash2) && /RECIST 1\.1/.test(dash2), "starring a card adds it to the Favourites section (persisted via localStorage)");

  console.log(fails ? `\n${fails} check(s) failed` : "\nAll Onco P2 checks passed");
} catch (x) { console.error(x); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill("SIGKILL"); } catch {} try { serveProc.kill("SIGKILL"); } catch {} if (fails) process.exitCode = 1; }
