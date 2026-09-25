/* MaiK audit fixes, batch B (2026-09-25) — real headless browser.
 *
 * T31 offline notice; T48 conversations stored as a small index plus one key each (old inline records
 * still open); T29 sign-out wipes MaiK's per-account data; T30 answer actions sit above the rating;
 * T65 "No" on a reopened answer asks why. SMD_AI's cloud calls are stubbed: no network.
 *
 * USAGE: node test/run-maik-audit-b-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8994/").replace(/\/?$/, "/");
const PORT = 9394, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-audit-b-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8994"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const Q = "Treatment of hypertension?";
const OLD = '<div class="maik-b you">' + Q + '</div><div class="maik-b ai"><p>First-line therapy is amlodipine 5 mg once daily.</p><div class="maik-fb"><span class="maik-fb-q">Was this helpful?</span><span class="maik-acts"><button type="button" class="maik-fb-b maik-act">Copy</button><button type="button" class="maik-fb-b maik-act">Regenerate</button><button type="button" class="maik-fb-b maik-act">Edit</button></span><button type="button" class="maik-fb-b">Yes</button><button type="button" class="maik-fb-b">No</button></div></div>';

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_askMaik && window.SMD_AI)`) === true) { ready = true; break; } }
  ok(ready, "the app and MaiK load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();});
    localStorage.setItem("smd_device_id","auditb"); localStorage.setItem("smd_maik_convos_d_auditb", JSON.stringify([{ id: "old1", title: ${JSON.stringify(Q)}, html: ${JSON.stringify(OLD)}, ts: Date.now() }])); return 1;`);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(1300);

  // T31
  ok(await ev(`return document.getElementById("maikOffline").hidden`) === true, "online: no offline notice");
  await call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await sleep(400);
  ok(await ev(`return document.getElementById("maikOffline").hidden`) === false, "offline: the notice shows above the composer");
  await call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await sleep(400);
  ok(await ev(`return document.getElementById("maikOffline").hidden`) === true, "back online: the notice goes");

  // T48: an old inline record still opens, and is migrated to its own key on the next index write.
  await ev(`document.getElementById("maikMenu").click(); return 1;`); await sleep(400);
  await ev(`document.querySelector('[data-conv="old1"]').click(); return 1;`); await sleep(500);
  ok(/amlodipine 5 mg/.test(await ev(`return document.getElementById("maikBody").textContent`)), "an old inline conversation still opens");
  // T30: actions above the rating
  const order = await ev(`var f = document.querySelector("#maikBody .maik-fb"), a = f.querySelector(".maik-acts").getBoundingClientRect(), y = f.querySelector(".maik-fb > .maik-fb-b:not(.maik-act)").getBoundingClientRect(); return a.top < y.top;`);
  ok(order === true, "Copy, Regenerate and Edit sit above Was-this-helpful and Yes/No");
  // T65: No on a reopened answer asks why
  await ev(`var n = [].slice.call(document.querySelectorAll("#maikBody .maik-fb > .maik-fb-b")).filter(function (b) { return b.textContent.trim() === "No"; })[0]; n.click(); return 1;`); await sleep(300);
  ok(await ev(`return !!document.querySelector("#maikBody .maik-fb-reason")`) === true, "No on a reopened answer asks why");
  await ev(`[].slice.call(document.querySelectorAll("#maikBody .maik-fb-reasonrow .maik-fb-b")).filter(function (b) { return b.textContent === "Skip"; })[0].click(); return 1;`); await sleep(200);
  ok(/Thanks, noted/.test(await ev(`return document.querySelector("#maikBody .maik-fb-q").textContent`)), "Skip closes it with a thank-you");
  // a new answer is written the new way
  await ev(`window.SMD_AI.explainGroundedStream = window.SMD_AI.explainGrounded = function () { return Promise.resolve({ text: "Losartan 50 mg daily is an alternative.", mode: "grounded" }); }; return 1;`);
  await ev(`var e = document.getElementById("maikQ"); e.value = "what about losartan"; document.getElementById("maikSend").click(); return 1;`); await sleep(2500);
  const idx = JSON.parse(await ev(`return localStorage.getItem("smd_maik_convos_d_auditb")`) || "[]");
  ok(idx.length >= 1 && idx.every((r) => !("html" in r)), `the conversation index holds no HTML (${idx.length} entries)`);
  const own = await ev(`return localStorage.getItem("smd_maik_convh_d_auditb_old1") || ""`);
  const ownTxt = own.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  ok(/amlodipine 5 mg/.test(ownTxt) && /losartan/i.test(ownTxt), "the conversation's HTML (old answer plus the new turn) lives under its own key");

  // T29: sign-out wipes this account's MaiK data
  await ev(`localStorage.setItem("smd_maik_me_d_auditb", JSON.stringify({ spec: "Internal Medicine" })); window.dispatchEvent(new Event("smd:signout")); return 1;`); await sleep(200);
  const left = await ev(`var o = []; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (/^smd_maik_(convos|convh|thread|active|me)_.*auditb|^smd_maik_routes$/.test(k)) o.push(k); } return o.join(",");`);
  ok(left === "", `sign-out leaves none of this account's MaiK data (${left || "none"})`);

  console.log(fails === 0 ? "\nALL GREEN: audit batch B behaves in a real browser" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
