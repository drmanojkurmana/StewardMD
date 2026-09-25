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

async function newTab(name, newWindow) {
  // A tab of its own window stays visible (document.hidden false) while another tab is driven: the console skips a
  // live refresh while hidden, so two boards watched at once need two windows.
  const targetId = (await raw("Target.createTarget", { url: "about:blank", newWindow: !!newWindow })).result.targetId;
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
/* The API as a signed-in console calls it (X-Staff-Token), over the real HTTP server. */
async function api(tok, path, body, method) {
  const r = await realFetch(BASE + "/api/queue/" + path.replace(/^\//, ""), { method: method || (body ? "POST" : "GET"), headers: Object.assign({ "Content-Type": "application/json" }, tok ? { "X-Staff-Token": tok } : {}), body: body ? JSON.stringify(body) : undefined });
  let j; try { j = await r.json(); } catch { j = {}; }
  j.__status = r.status; return j;
}
const waitFor = async (fn, ms) => { const end = Date.now() + (ms || 8000); while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); } return null; };
const events = () => [...docs].filter(([p]) => p.startsWith("q_events/")).map(([p, d]) => ({ id: p, ...d.fields }));
const byName = async (name) => { for (const x of tickets()) if ((await decName(x)) === name) return x; return null; };
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
  return scenarios3to9({ c, ids, server, asha, adminTok });
}

async function scenarios3to9(ctx) {
  const { c, ids, adminTok } = ctx;
  const [room1, room2] = ids.rooms;
  const doctorTok = await H.staffToken(ORG, H.idFor(DOCTOR));

  // ---------------------------------------------------------------- 3
  section("3 priority");
  const poolTicket = ctx.asha;
  ok(!!(await c.until(`return document.querySelector('[data-assign=${JSON.stringify(poolTicket.id)}]') ? 1 : 0`, 6000)), "the walk-in has a Route to a room button");
  await c.click(`[data-assign="${poolTicket.id}"]`);
  ok(!!(await c.until(`return document.getElementById("rsel") ? 1 : 0`, 4000)), "Route opens the room picker");
  await c.ev(`var s=document.getElementById("rsel"); s.value=${JSON.stringify(room1.id)}; s.dispatchEvent(new Event("change",{bubbles:true})); return s.value;`);
  await c.shot("3a-route-sheet");
  await c.click("#ok");
  let asha = await waitFor(async () => { const t = await byName("Asha Rao"); return t && t.roomId === room1.id && ["waiting", "registered"].includes(t.status) ? t : null; }, 6000);
  ok(!!asha, "server: Asha is routed to Room 1 and waiting " + JSON.stringify(asha && { roomId: asha.roomId, status: asha.status, sessionId: asha.sessionId }));
  asha = asha || (await byName("Asha Rao"));
  ok(!!(await c.until(`return document.querySelector('[data-a="prio"][data-t=${JSON.stringify(asha.id)}]') ? 1 : 0`, 6000)), "the routed row shows its Priority button");
  await c.click(`[data-a="prio"][data-t="${asha.id}"]`);
  ok(!!(await c.until(`return document.querySelector('.cats [data-c="senior"]') ? 1 : 0`, 4000)), "Priority opens the reason sheet");
  await c.click('.cats [data-c="senior"]');
  await c.shot("3b-priority-sheet");
  await c.click("#ok");
  const pr = await waitFor(() => { const t = docs.get("q_tickets/" + asha.id); return t && t.fields.priority === 1 ? t.fields : null; }, 6000);
  ok(!!pr && pr.priorityReason === "senior", "server: priority 1, reason senior " + JSON.stringify(pr && { p: pr.priority, r: pr.priorityReason }));
  const aud = events().filter((e) => e.action === "priority" && e.ticketId === asha.id);
  ok(aud.length === 1 && /"reason":"senior"/.test(aud[0].meta || ""), "server: one audit row, action priority, with the reason " + JSON.stringify(aud.map((e) => e.meta)));
  ok(!!(await c.until(`return /Senior citizen/.test(document.getElementById("app").innerText) ? 1 : 0`, 6000)), "the screen shows the reason (Senior citizen)");
  const noReason = await api(adminTok, "priority", { sessionId: asha.sessionId, ticketId: asha.id });
  ok(noReason.__status === 400 && noReason.error === "reason_required", "POST /priority without a reason: 400 reason_required " + JSON.stringify(noReason));
  ok(docs.get("q_tickets/" + asha.id).fields.priority === 1 && events().filter((e) => e.action === "priority").length === 1, "and nothing changed, nothing audited");
  await c.shot("3c-priority-set");
  ok(c.errors.length === 0, "no console exceptions: " + c.errors.slice(0, 3).join(" | "));

  // ---------------------------------------------------------------- 4
  section("4 live boards");
  ENV.QUEUE_LINK_BASE = BASE;
  const link = await api(adminTok, "display-link", { orgId: ORG });
  ok(link.__status === 200 && link.url && link.url.startsWith(BASE + "/opd-display?t="), "display-link minted on this server " + (link.url || JSON.stringify(link)).slice(0, 60));
  const d = await newTab("display", true);
  await d.nav(link.url);
  ok(!!(await d.until(`return /Room 1/.test(document.body.innerText) && /Room 2/.test(document.body.innerText) ? 1 : 0`, 8000)), "the wall display shows both rooms");
  await sleep(1500);   // both tabs settle on their /live stream
  const liveReq = () => d.responses.filter((r) => /\/api\/queue\/live\?t=/.test(r.url)).length;
  ok(liveReq() > 0, "the display opened /api/queue/live " + liveReq());
  const tok = String(asha.token || "");
  const t0 = Date.now();
  const st4 = await api(doctorTok, "status", { sessionId: asha.sessionId, ticketId: asha.id, status: "in_consultation" });
  ok(st4.__status === 200, "API: Asha in consultation " + st4.__status);
  const [dispMs, conMs] = await Promise.all([
    d.until(`var c=[].slice.call(document.querySelectorAll(".card")).filter(function(x){return /Room 1/.test(x.innerText);})[0]; return c && /In consultation/i.test(c.innerText) ? 1 : 0`, 6000).then((v) => (v ? Date.now() - t0 : null)),
    c.until(`var l=document.querySelector('[data-opd-lane="consult"]'); return l && /Asha Rao/.test(l.innerText) ? 1 : 0`, 6000).then((v) => (v ? Date.now() - t0 : null)),
  ]);
  ok(dispMs != null && dispMs < 3500, "the display shows Room 1 in consultation in " + dispMs + " ms (under 3.5 s, inside the 6 s poll)");
  ok(conMs != null && conMs < 3500, "the console moves Asha to Consulting in " + conMs + " ms");
  await d.shot("4a-display"); await c.shot("4b-console-consulting");
  // A change heard while the console tab is hidden is kept, and the board catches up when the tab is shown again.
  await c.call("Page.bringToFront");
  const cover = await newTab("cover");
  await cover.call("Page.bringToFront");
  const hidden = await c.until(`return document.hidden ? 1 : 0`, 3000);
  ok(!!hidden, "the console tab is hidden behind another tab");
  const st4b = await api(doctorTok, "status", { sessionId: asha.sessionId, ticketId: asha.id, status: "at_diagnostics" });
  ok(st4b.__status === 200, "API: Asha sent for tests while the console is hidden");
  await sleep(2600);   // the change is heard (2 s stream tick) while hidden
  await cover.close(); await c.call("Page.bringToFront");
  const t1 = Date.now();
  const back = await c.until(`var l=document.querySelector('[data-opd-lane="tests"]'); return !document.hidden && l && /Asha Rao/.test(l.innerText) ? 1 : 0`, 5000);
  ok(!!back && Date.now() - t1 < 2500, "shown again, the console catches up at once (" + (Date.now() - t1) + " ms), not at the next change");
  ok(d.errors.length === 0, "no display exceptions: " + d.errors.slice(0, 3).join(" | "));
  ok(c.errors.length === 0, "no console exceptions: " + c.errors.slice(0, 3).join(" | "));

  // ---------------------------------------------------------------- 5
  section("5 offline desk");
  // Its own origin (127.0.0.1), so its IndexedDB outbox and series are its own, not the first tab's.
  const OBASE = BASE.replace("localhost", "127.0.0.1");
  const seriesCalls = () => log.filter((x) => x.path === "/api/queue/offline-series").length;
  const before5 = seriesCalls();
  const o = await newTab("offline-desk");
  await o.nav(OBASE + "/opd.html");
  await o.ev(`localStorage.setItem("smd_opd_staff_tok", ${JSON.stringify(adminTok)}); localStorage.setItem("smd_opd_toktype","staff"); localStorage.setItem("smd_opd_hospital", ${JSON.stringify(ORG)}); return 1;`);
  await o.nav(OBASE + "/opd.html");
  ok(!!(await o.until(`return document.getElementById("walk") ? 1 : 0`, 10000)), "a fresh desk boots");
  const reserved = await waitFor(() => seriesCalls() > before5, 4000);
  ok(!!reserved, "the desk reserves its offline series on load, before any refresh (" + (seriesCalls() - before5) + " calls)");
  await sleep(500);
  await o.call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  ok(!!(await o.until(`var b=document.getElementById("offBar"); return b && !b.hidden && /Check-in continues/.test(b.innerText) ? 1 : 0`, 4000)), "offline: the bar says check-in continues on this desk");
  await o.click("#walk");
  ok(!!(await o.until(`return document.getElementById("pr_name") ? 1 : 0`, 6000)), "offline: + Walk-in still opens the check-in sheet");
  await o.ev(`function set(id, v) { var e = document.getElementById("pr_" + id); if(!e) return; e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }
    set("name", "Offline Kumar"); set("ageYears", "40"); set("mobile", "9876501234");
    var g=document.querySelector('[data-seg="gender"] [data-v="male"]'); if(g) g.click(); return 1;`);
  await o.click("#prSave");
  const offTok = await o.until(`var m=(document.body.innerText.match(/\\b(O[A-Z])-(\\d+)\\b/)||[]); return m[0]||0`, 8000);
  ok(!!offTok && /^O[A-Z]-1$/.test(offTok), "offline check-in shows the slip number " + offTok);
  await o.shot("5a-offline-slip");
  ok(!(await byName("Offline Kumar")), "server: nothing reached the queue while offline");
  const slipAt = Date.now();
  await o.close();
  // Reopened with the server still unreachable (a page cannot load with the network off, so the API is blocked instead).
  const o2 = await newTab("offline-desk-2");
  await o2.call("Network.setBlockedURLs", { urls: ["*gstatic.com*", "*/api/queue/*"] });
  await o2.nav(OBASE + "/opd.html");
  const kept = await o2.until(`return new Promise(function(res){ var q=indexedDB.open("smd-opd-offline"); q.onsuccess=function(){ try{ var t=q.result.transaction("desk","readonly").objectStore("desk").getAll(); t.onsuccess=function(){ var n=0; (t.result||[]).forEach(function(v){ n+=(v&&v.items||[]).length; }); res(n); }; }catch(e){ res(0); } }; q.onerror=function(){ res(0); }; })`, 5000);
  ok(kept === 1, "tab closed and reopened: the check-in is still pending in IndexedDB (" + kept + ")");
  ok(!(await byName("Offline Kumar")), "server: still not queued while unreachable");
  await o2.call("Network.setBlockedURLs", { urls: ["*gstatic.com*"] });
  const syncAt = Date.now();
  await o2.nav(OBASE + "/opd.html");
  const synced = await waitFor(async () => { const t = await byName("Offline Kumar"); return t && t.token ? t : null; }, 12000);
  ok(!!synced && synced.token === offTok && synced.offline === true, "online: synced into the pool with the slip's token " + (synced && synced.token));
  ok(!!synced && synced.registeredAt <= slipAt && synced.registeredAt < syncAt, "and its arrival time is when the slip was printed, not the sync (" + (synced && (syncAt - synced.registeredAt)) + " ms earlier)");
  ok(!!synced && synced.sessionId && /pool/.test(synced.sessionId), "into the walk-in pool");
  ok(!!(await o2.until(`return /Offline Kumar/.test(document.getElementById("app").innerText) ? 1 : 0`, 6000)), "the synced patient is on the desk's board");
  await o2.shot("5b-synced");
  ok(o2.errors.filter((e) => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|NetworkError/.test(e)).length === 0, "no console exceptions: " + o2.errors.slice(0, 3).join(" | "));
  await o2.close();

  return ctx;
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
