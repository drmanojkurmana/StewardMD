/* OPD plan, all items together: the real console (opd.html) and wall display (opd-display.html) in headless Chrome,
 * against the REAL queue router (test/opd-fullstack-server.mjs: in-memory Firestore, real routes, real SSE).
 *
 * Every step checks the server's state (the harness docs map, the captured outbound messages) AND the screen.
 *
 *   node --experimental-test-module-mocks test/run-opd-fullstack-e2e.mjs [--shot <dir>]
 *
 * Chrome: /Applications/Google Chrome.app (or $CHROME). Firebase's gstatic scripts are blocked (staff PIN sign-in
 * does not use them; the page treats them as absent), so the run is hermetic.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const realFetch = globalThis.fetch;   // the harness replaces fetch with its capture stub; CDP discovery needs the real one
const S = await import("./opd-fullstack-server.mjs");
const { H, seed, start, log } = S;
const { docs, sent, ORG, ADMIN, DOCTOR, LAB, ENV, as } = H;

const PORT = Number(process.env.OPD_E2E_PORT || 8933), CDP = PORT + 1000;
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const SHOT = process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : ((process.env.CLAUDE_JOB_DIR || "/tmp") + "/opd-fullstack-shots");
mkdirSync(SHOT, { recursive: true });

let fails = 0;
const results = {};
let scen = "";
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + (scen ? "[" + scen + "] " : "") + m); if (!c) { fails++; results[scen] = "FAIL"; } else if (!results[scen]) results[scen] = "PASS"; };
const section = (s) => { scen = s; console.log("\n== " + s); };
const tickets = () => [...docs].filter(([p]) => p.startsWith("q_tickets/")).map(([p, d]) => ({ id: p.slice(10), ...d.fields }));
const ticketBy = (pred) => tickets().filter(pred)[0];
const decName = async (t) => { try { const { decPHI } = await import("../functions/_queue.js"); return await decPHI(ENV, t.encName); } catch { return ""; } };

// ---- CDP: one browser, several tabs, each with its own flat session ----
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/opd-fullstack-chrome-" + CDP;
rmSync(userDir, { recursive: true, force: true });
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--mute-audio", "--window-size=1400,1000"].concat(process.platform === "linux" ? ["--no-sandbox"] : []), { stdio: "ignore" });
let ws, msgId = 1;
const pending = new Map(), tabs = new Map();
const raw = (method, params, sessionId) => { const id = msgId++; return new Promise((r) => { pending.set(id, r); ws.send(JSON.stringify({ id, method, params: params || {}, sessionId })); }); };

async function newTab(name) {
  const targetId = (await raw("Target.createTarget", { url: "about:blank" })).result.targetId;
  const sessionId = (await raw("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  const t = { name, targetId, sessionId, errors: [], responses: [], sse: [] };
  tabs.set(sessionId, t);
  t.call = (m, p) => raw(m, p, sessionId);
  await t.call("Runtime.enable"); await t.call("Page.enable"); await t.call("Network.enable");
  await t.call("Network.setCacheDisabled", { cacheDisabled: true });
  await t.call("Network.setBlockedURLs", { urls: ["*gstatic.com*"] });
  await t.call("Page.setLifecycleEventsEnabled", { enabled: true }).catch(() => {});
  t.ev = async (expr) => {
    const r = await t.call("Runtime.evaluate", { expression: `(async function(){try{${expr}}catch(x){return '__ERR__'+(x&&x.message||x)}})()`, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return "__ERR__" + (r.result.exceptionDetails.text || "exception");
    return r.result && r.result.result ? r.result.result.value : null;
  };
  t.until = async (expr, ms) => { const end = Date.now() + (ms || 8000); while (Date.now() < end) { const v = await t.ev(expr); if (v && !String(v).startsWith("__ERR__")) return v; await sleep(150); } return null; };
  t.nav = async (url) => { await t.call("Page.navigate", { url }); await sleep(400); };
  t.shot = async (n) => { const r = await t.call("Page.captureScreenshot", { format: "png" }); if (r.result) { const f = join(SHOT, n + ".png"); writeFileSync(f, Buffer.from(r.result.data, "base64")); console.log("   screenshot " + f); } };
  t.click = (sel) => t.ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return 'no '+${JSON.stringify(sel)}; b.click(); return 1;`);
  t.close = async () => { await raw("Target.closeTarget", { targetId }); tabs.delete(sessionId); };
  return t;
}

// ---- the console, signed in the way the page does it: a staff PIN session in localStorage (opd.html LS_TOK/LS_TT/LS_HOSP) ----
async function consoleTab(name, token) {
  const t = await newTab(name);
  await t.nav(BASE + "/opd.html");
  await t.ev(`localStorage.setItem("smd_opd_staff_tok", ${JSON.stringify(token)}); localStorage.setItem("smd_opd_toktype","staff"); localStorage.setItem("smd_opd_hospital", ${JSON.stringify(ORG)}); return 1;`);
  await t.nav(BASE + "/opd.html");
  return t;
}
const boardText = (t) => t.ev(`return (document.getElementById("app")||{}).innerText||""`);

async function main() {
  const ids = await seed();
  const server = await start(PORT);
  let ver; for (let i = 0; i < 80 && !ver; i++) { try { ver = await (await realFetch(`http://localhost:${CDP}/json/version`)).json(); } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    const t = m.sessionId && tabs.get(m.sessionId); if (!t) return;
    if (m.method === "Runtime.exceptionThrown") t.errors.push("EXC " + ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") t.errors.push("ERROR " + m.params.args.map((a) => a.value || a.description || "").join(" "));
    if (m.method === "Network.responseReceived") t.responses.push({ url: m.params.response.url, status: m.params.response.status, type: m.params.type, mime: m.params.response.mimeType });
    if (m.method === "Network.loadingFailed" && !/gstatic/.test(m.params.errorText + "")) t.responses.push({ url: m.params.requestId, status: 0, failed: m.params.errorText, type: m.params.type });
  };
  const adminTok = await H.staffToken(ORG, H.idFor(ADMIN));

  // ---------------------------------------------------------------- 1
  section("1 boot");
  const c = await consoleTab("console", adminTok);
  ok(!!(await c.until(`return document.getElementById("walk") && document.querySelector(".opd-flow-board") ? 1 : 0`, 10000)), "console boots signed in: the board and + Walk-in render");
  ok(!!(await c.until(`return document.querySelector("#opdPulse .p-row") ? 1 : 0`, 6000)), "the pulse card renders its tiles");
  const txt1 = await boardText(c);
  await c.click('[data-opd-view="rooms"]');
  const rv = await boardText(c);   // the board lists Room 2 first, so each room is looked for on its own
  ok(/Room 1/.test(rv) && /Room 2/.test(rv), "the Rooms view lists both rooms");
  await c.shot("1b-rooms-view");
  await c.click('[data-opd-view="flow"]');
  await c.shot("1-console-boot");
  ok(c.errors.length === 0, "no console exceptions: " + c.errors.slice(0, 3).join(" | "));

  // ---------------------------------------------------------------- 2
  section("2 walk-in");
  await c.click("#walk");
  ok(!!(await c.until(`return document.getElementById("pr_name") ? 1 : 0`, 6000)), "+ Walk-in opens the real check-in sheet (patient-register.js)");
  await c.ev(`function set(id, v) { var e = document.getElementById("pr_" + id); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }
    set("name", "Asha Rao"); set("ageYears", "67"); set("mobile", "9876543210");
    document.querySelector('[data-seg="gender"] [data-v="female"]').click();
    var d = document.getElementById("pr_departmentId"); if (d && d.options.length > 1) { d.selectedIndex = 1; d.dispatchEvent(new Event("change", { bubbles: true })); }
    return 1;`);
  await c.shot("2a-checkin-sheet");
  await c.click("#prSave");
  const asha = await (async () => { for (let i = 0; i < 40; i++) { const t = tickets().filter((x) => x.status && x.mrn); for (const x of t) if ((await decName(x)) === "Asha Rao") return x; await new Promise((r) => setTimeout(r, 200)); } return null; })();
  ok(!!asha, "server: a ticket exists for Asha Rao");
  ok(!!(asha && asha.mrn && [...docs.keys()].some((k) => k.startsWith("q_patients/") || k.includes(asha.mrn))), "server: the patient is registered with an MRN " + (asha && asha.mrn));
  ok(!!(asha && asha.token), "server: a token is issued " + (asha && asha.token));
  ok(!!(await c.until(`return /Asha Rao/.test(document.querySelector(".opd-flow-board").innerText) ? 1 : 0`, 6000)), "the patient's card is on the board");
  await c.click("#prDone"); await c.ev(`var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){return x.textContent.trim()==="Done"&&x.offsetParent;})[0]; if(b) b.click(); return 1;`);
  await c.shot("2b-board-with-walkin");
  ok(c.errors.length === 0, "no console exceptions: " + c.errors.slice(0, 3).join(" | "));
  return { c, ids, server, asha };
}

try {
  const ctx = await main();
  globalThis.__ctx = ctx;
} catch (e) { console.error("HARNESS ERROR:", e && e.stack || e); fails++; }
finally {
  console.log("\nSCENARIOS " + JSON.stringify(results));
  console.log(fails === 0 ? "ALL GREEN" : fails + " FAILED");
  try { ws && ws.close(); } catch {}
  try { chrome.kill("SIGKILL"); } catch {}
  process.exit(fails === 0 ? 0 : 1);
}
