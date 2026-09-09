/* TASK 8.9: MaiK's CDS explanation driven in real headless Chrome over CDP.
 *
 * The render tests (ward-maik-cds-ui.test.mjs) prove the HTML. This proves what they cannot: that
 * the delegated clicks fire, that the explanation lands INSIDE the existing safety card rather than
 * anywhere else, that a fail-closed refusal reaches the screen as the server's own sentence, that a
 * rejection without a reason posts nothing, and - the one that matters most here - that switching to
 * a different ORDER clears the explanation, so one drug's words can never sit under another drug's
 * findings.
 *
 *   node test/run-ward-maik-cds-ui.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9393, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-maik-cds-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-maik-cds-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const text = () => ev(`return document.getElementById("smdWard").textContent;`);
const html = () => ev(`return document.getElementById("smdWard").innerHTML;`);
const calls = async (frag) => JSON.parse(await ev(`return JSON.stringify(window.__calls.filter(function(c){return c.url.indexOf(${JSON.stringify(frag)})>=0}).map(function(c){return c.body}));`));
const waitFor = async (sel, n) => { for (let i = 0; i < (n || 40); i++) { await sleep(100); if (await ev(`return !!document.querySelector(${JSON.stringify(sel)});`)) return true; } return false; };
const waitText = async (re, n) => { for (let i = 0; i < (n || 40); i++) { await sleep(100); if (re.test(await text())) return true; } return false; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });

  let ready = null;
  for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, `real ward.js loaded into the harness (${ready})`);

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  await waitFor('[data-w-act="open:enc-1"]');
  await ev(`document.querySelector('[data-w-act="open:enc-1"]').click(); return true;`);
  await waitFor('[data-w-act="pharmacyopen"]');
  await ev(`document.querySelector('[data-w-act="pharmacyopen"]').click(); return true;`);
  ok(await waitFor('[data-w-act="phpick:ord-1"]'), "the pharmacy verification queue is on screen");
  ok(await ev(`return getComputedStyle(document.querySelector(".w-card")).borderRadius !== "0px";`), "the real ward.css styled it");

  // 1. Pick the order with a real allergy finding. MaiK is offered inside that card, not elsewhere.
  await ev(`document.querySelector('[data-w-act="phpick:ord-1"]').click(); return true;`);
  ok(await waitFor('[data-w-act="maikexplain"]'), "MaiK is offered on the verdict card");
  const t1 = await text();
  ok(/ALLERGY_CLASS/.test(t1), "the deterministic finding is what the screen shows first");
  ok((t1.match(/Safety verdict/g) || []).length === 1, "there is exactly one place to read a verdict");

  // 2. Ask. The request names the order that is picked, and nothing else.
  await ev(`document.querySelector('[data-w-act="maikexplain"]').click(); return true;`);
  ok(await waitText(/documented anaphylactic/), "MaiK's explanation appears");
  const asked = await calls("/ward/maik-explain-safety");
  ok(asked.length === 1 && asked[0].orderId === "ord-1", "the ask names the picked order (" + JSON.stringify(asked[0]) + ")");
  const t2 = await text();
  ok(/MaiK computed none of this/.test(t2), "and the screen says MaiK computed none of it");
  ok(/stewardmd-1\.0\.0\+seed\+brands/.test(t2), "naming the rule pack the engine used");
  ok(/unapproved and does not gate this order/.test(t2), "and that the content is unapproved");
  ok(/overrides nothing/.test(t2), "and that reading it overrides nothing");
  ok(/ALLERGY_CLASS/.test(t2), "the engine's finding is still on the screen alongside it");

  // 3. Reject with no reason: nothing is posted, and the screen says why.
  await ev(`window.prompt = function(){ return ""; }; document.querySelector('[data-w-act="maikexplainreview:rejected"]').click(); return true;`);
  await sleep(200);
  ok((await calls("/ward/maik-review")).length === 0, "no reason, no request");
  ok(/rejection needs a reason/.test(await text()), "and the screen says a rejection needs a reason");

  // 4. Reject with a reason: it is filed, the decision is shown, no finding changed.
  await ev(`window.prompt = function(){ return "Could mislead a junior."; }; document.querySelector('[data-w-act="maikexplainreview:rejected"]').click(); return true;`);
  ok(await waitText(/Rejected by/), "the decision is shown once it is filed");
  const reviewed = await calls("/ward/maik-review");
  ok(reviewed.length === 1 && reviewed[0].decision === "rejected" && reviewed[0].reason === "Could mislead a junior.",
    "the clinician's own reason is what is filed (" + JSON.stringify(reviewed[0]) + ")");
  const t4 = await text();
  ok(/no finding changed/.test(t4), "and the screen says no finding changed");
  ok(/ALLERGY_CLASS/.test(t4), "the finding is still there afterwards");
  ok(!/data-w-act="maikexplainreview:accepted"/.test(await html()), "a second decision is not offered");

  // 5. THE WRONG-ORDER PROPERTY: picking another order clears MaiK's words entirely.
  await ev(`document.querySelector('[data-w-act="phpick:ord-2"]').click(); return true;`);
  await waitFor('[data-w-act="maikexplain"]');
  const t5 = await text();
  ok(!/documented anaphylactic/.test(t5), "the previous order's explanation is GONE from this order's card");
  ok(!/Rejected by/.test(t5), "and so is the previous decision");

  // 6. A fail-closed refusal reaches the screen as the server's own sentence.
  await ev(`document.querySelector('[data-w-act="maikexplain"]').click(); return true;`);
  ok(await waitText(/not a clean result/), "the refusal is rendered");
  const t6 = await text();
  ok(/Nothing[\s\S]*not a clean result/.test(t6) || /no allergy, interaction or dose check ran for it/.test(t6),
    "the server's own words survive to the screen");
  ok(/MaiK did not explain this/.test(t6), "and it is labelled as MaiK not explaining, not as an answer");
  ok(!/is safe|no concerns|clear\b/i.test(t6.split("MaiK did not explain this")[1] || ""), "and nothing on it reads as reassurance");
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
