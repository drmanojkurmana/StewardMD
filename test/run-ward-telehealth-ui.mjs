/* Video visits on the scheduling screen, driven in real headless Chrome over CDP against the REAL ward.js and
 * ward.css (test/ward-telehealth-harness.html stubs only the network): the Video visit box appears only while
 * the hospital has video on, ticking it asks who agreed and for the consent box without losing what was typed,
 * both are required before anything is sent, Book and Book anyway send teleconsult + teleConsent, the diary shows
 * the Video chip, a consent the record refused is said, video turned off is refused in words and the box goes,
 * and an arrival after video was turned off says the patient joined as an in-person visit.
 *
 *   node test/run-ward-telehealth-ui.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9433, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-telehealth-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-telehealth-harness.html");
const args = ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"];
if (process.getuid && process.getuid() === 0) args.push("--no-sandbox");
const chrome = spawn(CHROME, args, { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const fill = (id, v) => ev(`document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(v)}; return true;`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click(); return true;`);
const text = (s) => `return document.getElementById("smdWard").textContent.indexOf(${JSON.stringify(s)}) >= 0`;
async function waitFor(expr, tries) { for (let i = 0; i < (tries || 30); i++) { await sleep(120); if (await ev(expr)) return true; } return false; }
const bookCalls = () => ev(`return JSON.stringify(window.__calls.filter(function (c) { return c.url.indexOf("/ward/book") >= 0 && c.method === "POST"; }).map(function (c) { return c.body; }));`).then(JSON.parse);
const form = async (patient, start) => { await fill("wSchedClinician", "dr-video"); await fill("wSchedPatient", patient); await fill("wSchedStart", start); await fill("wSchedMinutes", "15"); await fill("wSchedReason", "Review"); };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });
  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the video visit harness");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="scheduling"]');`), "the ward list carries a Scheduling button");
  await click('[data-w-act="scheduling"]');
  ok(await waitFor(`return !!document.getElementById("wSchedTele");`), "video is on: the booking form offers a Video visit box");
  ok(await ev(`return !document.getElementById("wSchedTeleGiver") && !document.getElementById("wSchedTeleAgreed");`), "who agreed is not asked until the box is ticked");
  ok(await ev(`return document.getElementById("wSchedTele").closest("label").getBoundingClientRect().height >= 44;`), "the Video visit box is a 44px target with its label");

  await form("pat-1", "2026-09-26T10:00:00.000Z");
  await click("#wSchedTele");
  ok(await waitFor(`return !!document.getElementById("wSchedTeleGiver") && !!document.getElementById("wSchedTeleAgreed");`), "ticking it asks who agreed and for the consent box");
  ok(await ev(`return document.getElementById("wSchedPatient").value === "pat-1" && document.getElementById("wSchedReason").value === "Review";`), "what was already typed is kept");
  ok(await ev(`return document.getElementById("wSchedTeleAgreed").closest("label").getBoundingClientRect().height >= 44 && document.getElementById("wSchedTeleGiver").getBoundingClientRect().height >= 44;`), "the consent box and the who-agreed list are 44px targets");

  await click('[data-w-act="apptbook"]');
  ok(await waitFor(text("Choose who agreed to the video consultation.")), "Book without who agreed is stopped, in words");
  await fill("wSchedTeleGiver", "next-of-kin");
  await click('[data-w-act="apptbook"]');
  ok(await waitFor(text("Record that they agreed to a video consultation before booking one.")), "Book without the consent box is stopped, in words");
  ok((await bookCalls()).length === 0, "nothing was sent while either was missing");

  await click("#wSchedTeleAgreed");
  await click('[data-w-act="apptbook"]');
  ok(await waitFor(text("Agreed to a video visit: Next of kin")), "the booked video appointment shows who agreed");
  let sent = await bookCalls();
  ok(sent.length === 1 && sent[0].teleconsult === true && sent[0].teleConsent && sent[0].teleConsent.givenBy === "next-of-kin" && sent[0].teleConsent.agreed === true && sent[0].overbook === false, "Book sent teleconsult and teleConsent { givenBy, agreed }");
  ok(await ev(`return Array.prototype.some.call(document.querySelectorAll(".w-tag"), function (e) { return e.textContent.indexOf("Video") >= 0; });`), "the diary row carries a Video chip");
  ok(await ev(`return !document.getElementById("wSchedTele").checked && !document.getElementById("wSchedTeleGiver");`), "after booking the form is back to an ordinary visit");

  // Book anyway (overbook) sends the same consent.
  await form("pat-2", "2026-09-26T10:00:00.000Z");
  await click("#wSchedTele");
  await waitFor(`return !!document.getElementById("wSchedTeleGiver");`);
  await fill("wSchedTeleGiver", "patient"); await click("#wSchedTeleAgreed");
  await click('[data-w-act="apptoverbook"]');
  ok(await waitFor(`return document.querySelectorAll('[data-w-act^="apptarrived:"]').length === 2;`), "the overbooked video appointment is in the diary");
  sent = await bookCalls();
  ok(sent.length === 2 && sent[1].overbook === true && sent[1].teleconsult === true && sent[1].teleConsent.givenBy === "patient", "Book anyway sent overbook with teleconsult and teleConsent");

  // The consent could not go on the patient's record: said, the booking stands.
  await form("pat-norecord", "2026-09-26T11:00:00.000Z");
  await click("#wSchedTele");
  await waitFor(`return !!document.getElementById("wSchedTeleGiver");`);
  await fill("wSchedTeleGiver", "parent"); await click("#wSchedTeleAgreed");
  await click('[data-w-act="apptbook"]');
  ok(await waitFor(text("it could not be added to the patient's record")), "a consent the patient record refused is said");

  // Video turned off after the diary loaded: refused in words, and the box goes on the reload.
  await ev(`window.__teleOn = false; return true;`);
  await form("pat-3", "2026-09-26T12:00:00.000Z");
  await click("#wSchedTele");
  await waitFor(`return !!document.getElementById("wSchedTeleGiver");`);
  await fill("wSchedTeleGiver", "patient"); await click("#wSchedTeleAgreed");
  await click('[data-w-act="apptbook"]');
  ok(await waitFor(text("Video visits are turned off for this hospital. Book an in-person visit instead.")), "video_off is said in words");
  ok(await waitFor(`return !document.getElementById("wSchedTele");`), "the reloaded diary no longer offers a video visit");

  // The first video appointment arrives after video was turned off.
  await click('[data-w-act="apptarrived:appt-1"]');
  ok(await waitFor(text("The patient joined the queue as an in-person visit, because video visits are now turned off for this hospital.")), "arrival with video off says the patient joined as an in-person visit");
} catch (e) {
  console.log("FAIL harness error: " + (e && e.message)); fails++;
} finally {
  try { chrome.kill(); } catch (e) {}
  console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
  process.exit(fails ? 1 : 0);
}
