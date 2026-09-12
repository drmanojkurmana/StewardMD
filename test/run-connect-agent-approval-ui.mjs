/* THE OWNER'S DOOR TO AN APPROVAL.
 *
 * A doctor onboards their hospital from the phone; the adapter the agent writes is inert until a
 * human approves it. That approval existed ONLY inside the phone sheet, so an owner looking at
 * stewardmd.in/admin had nowhere to approve from and a real version sat AWAITING_APPROVAL with no
 * door to it (2026-09-12). This drives the REAL admin/connect-emr.html in headless Chrome with the
 * page's own api() seam stubbed: nothing is asserted about the network, only about what an owner
 * can see and press.
 *
 *   node test/run-connect-agent-approval-ui.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = 9457, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/agent-approval-chrome-" + process.pid;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
async function waitFor(expr, ms) { const end = Date.now() + (ms || 6000); while (Date.now() < end) { await sleep(150); if (await ev(expr)) return true; } return false; }
const APPROVE_BTN = `document.evaluate("//button[text()='Approve']", document, null, 9, null).singleNodeValue`;
const REJECT_BTN = `document.evaluate("//button[text()='Reject']", document, null, 9, null).singleNodeValue`;

const VERSION = {
  ok: true, id: "ver-1", state: "AWAITING_APPROVAL", deploymentId: "dep-1",
  operations: [
    { opId: "list_worklist", type: "list_worklist", resource: "worklist", method: "GET", pathTemplate: "/Doctor/Home" },
    { opId: "list_medications", type: "list_medications", resource: "medications", method: "GET", pathTemplate: "/Doctor/Home" },
    { opId: "list_labs", type: "list_labs", resource: "labs", method: "GET", pathTemplate: "/Doctor/Labs" },
  ],
};
const STUB = `
window.__posted = [];
window.__connections = [
  { deploymentId: "dep-1", origins: ["https://gimsrlogin.gitam.edu"], activeVersionId: null, pendingVersionId: "ver-1", lastSessionState: "AUTHENTICATED" },
  { deploymentId: "dep-2", origins: ["https://other.example"], activeVersionId: "v-old", pendingVersionId: null, lastSessionState: null }
];
window.ConnectEMR.__setApi(function (path, opts) {
  window.__posted.push({ path: path, method: (opts && opts.method) || "GET" });
  if (path.indexOf("/agent/connections") >= 0) return Promise.resolve({ s: 200, d: { ok: true, connections: window.__connections } });
  if (path.indexOf("/approve") >= 0) return Promise.resolve({ s: 200, d: window.__approveReply || { ok: true, state: "ACTIVE" } });
  if (path.indexOf("/reject") >= 0) return Promise.resolve({ s: 200, d: { ok: true, state: "REVOKED" } });
  if (path.indexOf("/agent/versions/") >= 0) return Promise.resolve({ s: 200, d: ${JSON.stringify(VERSION)} });
  return Promise.resolve({ s: 200, d: { ok: true } });
});
window.ConnectEMR.setTenant("t-1");
return 1;
`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.navigate", { url: "file://" + join(ROOT, "admin", "connect-emr.html") });
  ok(await waitFor(`return !!(window.ConnectEMR && window.ConnectEMR.loadAgentPending);`, 8000), "the admin console exposes the approvals loader");

  await ev(STUB);
  await ev(`document.getElementById("work").style.display=""; window.ConnectEMR.loadAgentPending(); return 1;`);

  ok(await waitFor(`return document.getElementById("agentPending").innerText.indexOf("gimsrlogin.gitam.edu") >= 0;`, 6000),
    "a hospital waiting for approval is listed by its own address");
  ok(await ev(`return document.getElementById("agentPending").innerText.indexOf("other.example") < 0;`) === true,
    "a connection with nothing pending is not listed");
  ok(await waitFor(`var t=document.getElementById("agentPending").innerText; return t.indexOf("Worklist")>=0 && t.indexOf("Medications")>=0 && t.indexOf("Lab results")>=0;`, 6000),
    "it says what the connection would be able to read, in clinical words");
  ok(await ev(`return document.getElementById("agentPending").innerText.indexOf("cannot order, prescribe or change") >= 0;`) === true,
    "it states the connection is read-only");
  ok(await waitFor(`return !!(${APPROVE_BTN});`, 4000), "an Approve button is offered");
  ok(await ev(`return !!(${REJECT_BTN});`) === true, "a Reject button is offered");

  await ev(`${APPROVE_BTN}.click(); return 1;`);
  ok(await waitFor(`return window.__posted.some(function(p){ return p.path.indexOf("/approve")>=0 && p.method==="POST"; });`, 4000),
    "Approve posts to the approval endpoint the phone uses");
  ok(await waitFor(`return document.getElementById("agentPending").innerText.indexOf("Approved") >= 0;`, 4000),
    "the owner is told it is approved and the hospital is connected");

  // A refusal from the server must be shown as the server's own reason, never swallowed.
  await ev(`window.__approveReply = { ok:false, error:"forbidden", detail:"only an owner may approve" }; window.ConnectEMR.loadAgentPending(); return 1;`);
  await waitFor(`return !!(${APPROVE_BTN});`, 6000);
  await ev(`${APPROVE_BTN}.click(); return 1;`);
  ok(await waitFor(`return document.getElementById("agentPending").innerText.indexOf("only an owner may approve") >= 0;`, 4000),
    "a refusal shows the server's own reason");

  ok(await ev(`return document.getElementById("agentPending").innerText.indexOf("\\u2014") < 0;`) === true, "approval copy has no em-dash");
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails === 0 ? "\nALL GREEN - connect agent approval UI passed" : `\n${fails} FAILED`);
process.exit(fails ? 1 : 0);
