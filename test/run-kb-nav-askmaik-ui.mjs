/* Disease-name navigation + "Ask MaiK" on Knowledge pages (2026-10-04). Real headless Chrome, real app:
 *   "pneumonia" in MaiK -> one Edge card listing several Knowledge pages (+ "Ask MaiK anyway");
 *   tapping a page opens the Knowledge reader; the reader shows "Ask MaiK" (44 px, labelled);
 *   tapping it opens MaiK with the "About: <disease>" chip; Research is reachable and seeds the topic;
 *   a question is asked about the topic; the chip clears. Light and dark screenshots in SHOTS.
 * USAGE: BASE=http://localhost:8996/ node test/run-kb-nav-askmaik-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9419, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/kb-nav-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || "/tmp/stewardmd-kbnav";
fs.mkdirSync(SHOTS, { recursive: true });

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const shot = async (name) => { const r = await call("Page.captureScreenshot", { format: "jpeg", quality: 70 }); if (r.result) fs.writeFileSync(join(SHOTS, name + ".jpg"), Buffer.from(r.result.data, "base64")); };
const waitFor = async (expr, n = 50) => { for (let i = 0; i < n; i++) { if (await ev(`return !!(${expr})`) === true) return true; await sleep(200); } return false; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  ok(await waitFor(`window.SMD_askMaik && window.SMD_askMaikTopic && window.SMD_EDGE && window.MaiKKB && window.MaiKKB.kbPages`, 75), "app, MaiK, Edge and MaiKKB load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); localStorage.setItem("smd_edge","1"); return 1;`);
  // No cloud in this test: AI calls are refused and counted.
  await ev(`window.__ai = []; var _f = window.fetch; window.fetch = function (u, o) { if (/\\/api\\/ai\\//.test(String(u))) { window.__ai.push(String(u)); return Promise.reject(new Error("offline in test")); } return _f.apply(this, arguments); }; return 1;`);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(900);
  ok(await waitFor(`window.KB_ENRICHMENT && KB_ENRICHMENT.byId && KB_ENRICHMENT.byId.CAP && window.SMD_REASON && SMD_REASON.hasDiseaseRef`, 100), "Knowledge Base and the reader load");

  // 1. "pneumonia" -> one card with several pages
  await ev(`try { __MAIK_TEST.setTopic(null); } catch (e) {} var q=document.getElementById("maikQ"); q.value="pneumonia"; q.dispatchEvent(new Event("input",{bubbles:true})); document.getElementById("maikSend").click(); return 1;`);
  await waitFor(`document.querySelector("#maikBody .maik-kbgroup")`);
  const card = await ev(`var g=document.querySelector("#maikBody .maik-kbgroup"); if(!g) return null; var b=[].slice.call(g.querySelectorAll("[data-kb-more]")); return { n: b.length, ids: b.map(function(x){return x.getAttribute("data-kb-more");}), ask: !!g.querySelector("[data-maik-edgeask]"), h: parseFloat(getComputedStyle(b[0]).minHeight), more: !!g.querySelector("details summary"), text: g.parentNode.innerText };`);
  ok(card && card.n >= 2 && card.ids.includes("CAP"), `"pneumonia": one card with ${card && card.n} Knowledge pages (CAP among them)`);
  ok(card && card.ask, "card keeps \"Ask MaiK anyway\"");
  ok(card && card.h >= 44, `page buttons have min-height ${card && card.h} px (CSS px; the app zooms the page)`);
  ok(card && !/—/.test(card.text), "no em-dash on the card");
  ok((await ev(`return window.__ai.filter(function(u){return !/\\/health/.test(u);}).length`)) === 0, "no cloud call for the card (warm-up health ping aside)");
  await shot("1-pneumonia-card");

  // 2. tap CAP -> reader
  await ev(`document.querySelector('#maikBody .maik-kbgroup [data-kb-more="CAP"]').click(); return 1;`);
  ok(await waitFor(`document.querySelector("#dxMgmt.dx-reader.on .dx-mgmt-name")`), "tapping a page opens its Knowledge reader");
  ok(!(await ev(`return !!document.getElementById("maikSheet") && document.getElementById("maikSheet").classList.contains("on")`)), "MaiK closed in front of the reader");
  const ask = await ev(`var a=document.querySelector("#dxMgmt .dx-reader-askmaik"); if(!a) return null; var r=a.getBoundingClientRect(); return { h: parseFloat(getComputedStyle(a).minHeight), w: Math.round(r.width), label: a.getAttribute("aria-label"), text: a.innerText.trim(), name: document.querySelector("#dxMgmt .dx-mgmt-name").innerText.trim() };`);
  ok(ask && ask.text.replace(/\s+/g, " ") === "Ask MaiK" && ask.h >= 44 && ask.w >= 44, `reader shows "Ask MaiK" (${ask && ask.w}x${ask && ask.h})`);
  ok(ask && /^Ask MaiK about /.test(ask.label || ""), "with an aria label naming the disease");
  await shot("2-reader-askmaik");

  // 3. tap -> MaiK with the topic chip
  await ev(`document.querySelector("#dxMgmt .dx-reader-askmaik").click(); return 1;`);
  ok(await waitFor(`document.getElementById("maikTopicBar") && !document.getElementById("maikTopicBar").hidden`), "MaiK opens with the topic bar"); await sleep(900);
  const chip = await ev(`return document.getElementById("maikTopicName").innerText;`);
  ok(chip === "About: " + ask.name, `chip reads "${chip}"`);
  ok(await ev(`var t=__MAIK_TEST.getTopic(); return !!(t && t.topic === ${JSON.stringify(ask.name)});`), "MaiK's topic is the page's disease");
  const modes = await ev(`return [].slice.call(document.querySelectorAll("[data-maik-tmode]")).map(function(b){return b.getAttribute("data-maik-tmode")+":"+b.getAttribute("aria-pressed")+":"+parseFloat(getComputedStyle(b).minHeight);});`);
  ok(modes && modes.length === 2 && modes[0].startsWith("ask:true") && modes.every((m) => +m.split(":")[2] >= 44), "Ask (selected) and Research choices, 44 px: " + JSON.stringify(modes));
  ok((await ev(`var x=document.getElementById("maikTopicX"); return x.getAttribute("aria-label");`)) === "Clear topic", "chip clear button is labelled");
  await shot("3-maik-topic-chip");

  // 4. Research: Evidence Review mode on, seeded with the topic
  await ev(`document.querySelector('[data-maik-tmode="research"]').click(); return 1;`); await sleep(200);
  const rs = await ev(`return { on: document.getElementById("maikResearch").classList.contains("on"), q: document.getElementById("maikQ").value, checked: document.querySelector('[data-maik-tmode="research"]').getAttribute("aria-pressed") };`);
  ok(rs && rs.on && rs.checked === "true" && rs.q === ask.name, "Research turns Evidence Review on and seeds the topic: " + JSON.stringify(rs));
  await shot("4-research");
  await ev(`document.querySelector('[data-maik-tmode="ask"]').click(); document.getElementById("maikQ").value=""; return 1;`); await sleep(150);
  ok(!(await ev(`return document.getElementById("maikResearch").classList.contains("on");`)), "Ask turns Research off");

  // 5. a question is scoped to the topic (the cloud is refused here; the request carries the disease)
  await ev(`window.__ai = []; var q=document.getElementById("maikQ"); q.value="first line antibiotics"; q.dispatchEvent(new Event("input",{bubbles:true})); document.getElementById("maikSend").click(); return 1;`);
  await sleep(2500);
  const tp = await ev(`var t=__MAIK_TEST.getTopic(); return t ? t.topic : null;`);
  ok(tp === ask.name, "the question stays on the page's disease (topic " + tp + ")");

  // 6. dark mode + clear the chip
  await ev(`document.body.classList.add("dark"); return 1;`); await sleep(200); await shot("5-maik-dark");
  await ev(`document.getElementById("maikTopicX").click(); return 1;`); await sleep(150);
  ok(await ev(`return document.getElementById("maikTopicBar").hidden;`), "clearing the chip hides it");
  // reader in dark
  await ev(`try { document.getElementById("maikClose") && document.getElementById("maikClose").click(); } catch (e) {} return 1;`); await sleep(500);
  await shot("6-reader-dark");
} catch (e) { console.log("FAIL harness: " + (e && e.stack || e)); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); console.log(fails ? fails + " failed" : "all passed"); process.exit(fails === 0 ? 0 : 1); }
