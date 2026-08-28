/* MaiK companion art — real headless browser.
 *
 * Stetho Buddy is a RESIDENT: he sits on the composer's top edge from the moment MaiK opens,
 * idles in place (shuffle + blink, never travelling), perks up while an answer generates, and
 * leaves when MaiK closes. Medibot joins him in the pending bubble once a question is sent.
 * Pinned here because it is all hand-authored art on a hand-rolled frame clock — a dropped frame,
 * a stray colour, a timer that outlives the sheet, or a character that starts walking again are
 * all invisible to a unit test.
 *
 * USAGE: node test/run-maik-busy-art-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:8989/").replace(/\/?$/, "/");
const PORT = 9387, userDir = process.env.CLAUDE_JOB_DIR + "/busy-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const serve = spawn("node", ["test/serve.mjs", ".", "8989"], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await call("Page.navigate", { url: BASE });
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!window.SMD_askMaik`) === true) break; }
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); document.body.classList.add("dark"); return 1;`);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(1400);

  // ── the resident: there from the moment MaiK opens, before anything is asked ──
  ok(await ev(`return !!document.querySelector(".maik-cmp .mkw");`) === true, "Stetho Buddy is present as soon as MaiK opens");
  const fills = await ev(`return [].slice.call(document.querySelectorAll(".mkw rect")).map(function(r){return r.getAttribute("fill");}).filter(function(v,i,a){return a.indexOf(v)===i;}).sort().join(",");`);
  ok(fills === "#04211E,#0E6E63,#14807A,#2DD4BF", "dark-teal palette only — got " + fills);
  const w = parseFloat(await ev(`return document.querySelector(".mkw svg").getAttribute("width");`));
  ok(Math.abs(w - 13 * 2.3) < 0.01, "rendered 15% larger than the original 2x (" + w + "px, was 26)");
  ok(await ev(`return document.querySelectorAll(".mkw .mkw-svg > g").length;`) === 3, "three frames: rest, step, blink");
  const blinkEyes = await ev(`var g=document.querySelectorAll(".mkw .mkw-svg > g")[2]; return [].slice.call(g.querySelectorAll("rect")).filter(function(r){return r.getAttribute("fill")==="#04211E";}).length;`);
  ok(blinkEyes === 0, "the blink frame has no open eyes");

  // ── he does NOT travel ──
  const anim = await ev(`return getComputedStyle(document.querySelector(".mkw-a")).animationName;`);
  ok(anim === "mkwBreathe", "his animation is the in-place breathe, not a walk — got " + anim);
  const x1 = await ev(`return Math.round(document.querySelector(".mkw-a").getBoundingClientRect().left);`);
  await sleep(1200);
  const x2 = await ev(`return Math.round(document.querySelector(".mkw-a").getBoundingClientRect().left);`);
  ok(x1 === x2, "he stays put across a second of animation (" + x1 + " -> " + x2 + ")");

  // ── he is alive: the frame actually changes over an idle cycle ──
  const seen = {};
  for (let i = 0; i < 55; i++) {
    seen[await ev(`var g=document.querySelectorAll(".mkw .mkw-svg > g"); for (var n=0;n<g.length;n++) if (g[n].style.display==="block") return n; return -1;`)] = 1;
    await sleep(120);
  }
  ok(Object.keys(seen).length >= 2, "he shuffles/blinks on his own — frames seen: " + Object.keys(seen).sort().join(","));

  // ── sending a question perks him up AND brings Medibot ──
  await ev(`__MAIK_TEST.buddyBusy(true); return 1;`); await sleep(150);
  ok(await ev(`return document.querySelector(".mkw").classList.contains("busy");`) === true, "a question in flight perks him up");
  await ev(`
    var b=document.getElementById("maikBody");
    var d=document.createElement("div"); d.className="maik-b ai";
    d.innerHTML='<div class="maik-buffer"><div class="maik-buffer-head">'+__MAIK_TEST.botSVG(30)+'<span class="maik-buffer-txt">Reviewing the evidence</span></div><div class="maik-sk"><span></span><span></span><span></span></div></div>';
    b.appendChild(d); return 1;`);
  ok(await ev(`return !!document.querySelector("#maikBody .maik-bot");`) === true, "Medibot appears in the pending bubble");
  ok(await ev(`return document.querySelectorAll("#maikBody .maik-bot .mkb-ping").length;`) === 2, "with his chest rings");
  ok(await ev(`return !!document.querySelector(".maik-cmp .mkw");`) === true, "and Buddy is still there alongside him");
  await ev(`__MAIK_TEST.buddyBusy(false); return 1;`); await sleep(150);
  ok(await ev(`return document.querySelector(".mkw").classList.contains("busy");`) === false, "he settles back when the answer lands");

  // ── closing MaiK takes him with it (and stops his timer) ──
  await ev(`var c=document.getElementById("maikClose"); if(c) c.click(); return 1;`); await sleep(500);
  ok(await ev(`return !document.querySelector(".maik-cmp .mkw");`) === true, "he leaves when MaiK closes");

} catch (e) { console.log("ERR", e); fails++; }
finally { chrome.kill(); serve.kill(); }
console.log(fails ? "FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
