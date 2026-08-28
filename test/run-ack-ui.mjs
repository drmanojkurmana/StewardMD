/* Acknowledgements roster — real-browser test.
 *
 * REDESIGN 2026-08-27 (owner: "it looks too big"). The sheet used to clone #ackCard and force every
 * hover tooltip open inline: twelve people x a full bio each, about three screens of wall. It is
 * now an accordion built by reading #ackCard.
 *
 * The load-bearing property is that #ackCard REMAINS the single source of truth — a contributor is
 * added by adding one <span> there and nothing else. So this drives the real page, not a fixture:
 * a fixture with hand-written markup would keep passing after the parser stopped matching reality.
 *
 * USAGE: BASE=http://localhost:8991/ node test/run-ack-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8991/").replace(/\/?$/, "/");
const PORT = 9398;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ack-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8991"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [
  ...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=390,844"
], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => {
  const r = await call("Runtime.evaluate", {
    expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`,
    returnByValue: true, awaitPromise: true
  });
  return r.result && r.result.result ? r.result.result.value : null;
};
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      ws = new WebSocket(j.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
      return true;
    } catch { await sleep(300); }
  }
  return false;
}

try {
  if (!await connect()) throw new Error("could not attach to Chrome");
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.navigate", { url: BASE });

  let ready = false;
  for (let i = 0; i < 80; i++) {
    await sleep(400);
    if (await ev(`return typeof window.openAck === "function" && !!document.getElementById("ackCard")`) === true) { ready = true; break; }
  }
  ok(ready, "app loaded with openAck() and the #ackCard source present");
  if (!ready) throw new Error("app never became ready");

  // #ackCard must stay the source of truth — adding a name there is the whole contributor workflow.
  const srcCount = await ev(`return document.querySelectorAll("#ackCard .ack-contrib-name, #ackCard .creator-name").length`);
  ok(srcCount >= 12, `#ackCard holds every person (${srcCount})`);

  await ev(`window.openAck(); return 1;`);
  await sleep(500);
  /* Both the About tab and the sheet render a roster (they share one builder), so pick the one
     actually on screen — a document-wide query hits the hidden About copy first, where innerText
     falls back to raw text and every "is it collapsed" assertion silently inverts. */
  const VIS = `[].slice.call(document.querySelectorAll(".smd-ack")).filter(function(e){return e.getBoundingClientRect().height>0})[0]`;
  ok(await ev(`return !!${VIS}`) === true, "roster renders on screen (not the old cloned card)");
  ok(await ev(`return document.querySelector(".hv-ack-inline") === null`) === true,
     "the old force-every-bio-open clone is gone");

  const rows = await ev(`return ${VIS}.querySelectorAll(".smd-ack-row").length`);
  ok(rows === srcCount, `every person from #ackCard became a row (${rows}/${srcCount}) — nobody silently dropped`);

  // The point of the redesign: collapsed by default.
  ok(await ev(`return ${VIS}.querySelectorAll(".smd-ack-row.is-open").length === 0`) === true,
     "every bio starts COLLAPSED — this is what fixes 'too big'");

  // ...and the page is actually short now.
  const h = await ev(`return Math.round(${VIS}.getBoundingClientRect().height);`);
  ok(h > 0 && h < 1900, `roster is compact (${h}px for ${rows} people, was ~3 screens of bios)`);

  // The new contributor, read straight out of #ackCard.
  const txt = String(await ev(`return ${VIS}.innerText`));
  ok(/Sri Harsha Gora/.test(txt), "Dr. Sri Harsha Gora is listed");
  ok(/Field Testing & Bug Reports/i.test(txt), "his role shows on the collapsed row");

  // Names and roles are visible without tapping; bios are not.
  ok(/Dr\. Manoj Kumar Kurmana/.test(txt) && /Diwakar Kurmana/.test(txt), "founders are listed");
  ok(!/published in PubMed/i.test(txt), "long bios are NOT in the collapsed view");

  // Tap to expand.
  ok(await ev(`
     var rows=[].slice.call(${VIS}.querySelectorAll(".smd-ack-row"));
     var r=rows.filter(function(x){return /Sri Harsha Gora/.test(x.innerText)})[0];
     r.querySelector(".smd-ack-hit").click();
     return r.classList.contains("is-open");`) === true, "tapping a row opens that person's bio");
  ok(/uses StewardMD on the wards/i.test(String(await ev(`return ${VIS}.innerText`))),
     "the bio text appears once opened");
  ok(await ev(`var r=[].slice.call(${VIS}.querySelectorAll(".smd-ack-row")).filter(function(x){return /Sri Harsha Gora/.test(x.innerText)})[0];
               return r.querySelector(".smd-ack-hit").getAttribute("aria-expanded") === "true";`) === true,
     "aria-expanded tracks the open state");

  // One at a time — twelve open accordions would be the same wall again.
  ok(await ev(`
     var rows=[].slice.call(${VIS}.querySelectorAll(".smd-ack-row"));
     var other=rows.filter(function(x){return /Maniram Kumhar/.test(x.innerText)})[0];
     other.querySelector(".smd-ack-hit").click();
     return ${VIS}.querySelectorAll(".smd-ack-row.is-open").length === 1;`) === true,
     "only ONE row stays open at a time");

  // Tapping the open row closes it.
  ok(await ev(`
     var r=${VIS}.querySelector(".smd-ack-row.is-open");
     r.querySelector(".smd-ack-hit").click();
     return ${VIS}.querySelectorAll(".smd-ack-row.is-open").length === 0;`) === true,
     "tapping an open row closes it again");

  // The founder card keeps its links, which are the reason its bio is worth opening at all.
  ok(await ev(`
     var rows=[].slice.call(${VIS}.querySelectorAll(".smd-ack-row"));
     var f=rows.filter(function(x){return /Manoj Kumar Kurmana/.test(x.innerText)})[0];
     f.querySelector(".smd-ack-hit").click();
     return f.querySelectorAll(".smd-ack-lnk").length >= 2;`) === true,
     "founder keeps LinkedIn + email links");
  ok(await ev(`return ${VIS}.querySelectorAll(".smd-ack-av").length === 2`) === true,
     "the two founders get initials avatars, contributors do not");

  // The CTA survived the rewrite.
  ok(/Want your name here\?/.test(String(await ev(`return ${VIS}.innerText`))),
     "'Want your name here?' block carried over");

  console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed");
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
process.exit(fails ? 1 : 0);
