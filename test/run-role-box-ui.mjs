/* Role box (owner 2026-09-26): real index.html in headless Chrome.
 *   - the sign-up profile form asks "I am a" first and does not demand a degree from a student;
 *   - Home locks the tools outside the role (grey tile, lock, after the open ones) and a locked tap
 *     explains itself instead of opening the tool;
 *   - no role chosen = nothing locked; smd_role_gates=0 = nothing locked; changing the role re-renders.
 * USAGE: node test/run-role-box-ui.mjs   (CHROME=/path/to/chrome CHROME_FLAGS=--no-sandbox) */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9433, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/role-box-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--window-size=390,844"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

// State of the Home tools grid: which acts are open / locked, in DOM order.
const GRID = `var g=document.getElementById("rnavToolsGrid"); if(!g) return JSON.stringify(null);
  var open=[],locked=[],order=[]; g.querySelectorAll(".rnav-tile[data-act]").forEach(function(b){ var a=b.getAttribute("data-act"); if(a==="customizetools")return; order.push(a); (b.classList.contains("role-locked")?locked:open).push(a); });
  return JSON.stringify({open:open,locked:locked,order:order});`;
async function setRole(r) { await ev(`${r ? `SMD_ROLE.set("${r}")` : `localStorage.removeItem("smd_role"); document.dispatchEvent(new CustomEvent("smd:role-changed",{detail:{}}))`}; return 1;`); await sleep(250); return J(GRID); }

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.SMD_ROLE && window.SMD_PROFILE_SETUP && document.getElementById("rnavToolsGrid"))`) === true) { ready = true; break; } }
  if (!ready) throw new Error("home grid / SMD_ROLE / SMD_PROFILE_SETUP not ready");
  // Make the tools under test visible on the grid regardless of the default customisation.
  await ev(`try{localStorage.removeItem("smd_role_gates");}catch(e){} return 1;`);

  // 1) sign-up form: role first, student not blocked on degree/speciality
  const pf = await J(`var P=SMD_PROFILE_SETUP; return JSON.stringify({first:P.FIELDS[0].key, opts:P.FIELDS[0].opts,
    missEmpty:P.missing({}), missStudent:P.missing({role:"student",name:"A",phone:"9999999999",hospital:"X"}),
    missDoctor:P.missing({role:"doctor",name:"A",phone:"9999999999",hospital:"X"})});`);
  ok(pf.first === "role", "profile form asks the role first");
  ok(JSON.stringify(pf.opts) === JSON.stringify(["Medical student (UG)", "Intern", "PG Resident", "Doctor (practising)"]), "four roles offered: " + pf.opts);
  ok(pf.missEmpty.indexOf("role") >= 0, "role is required");
  ok(pf.missStudent.length === 0, "a student is not asked for degree / speciality: " + pf.missStudent);
  ok(pf.missDoctor.indexOf("degree") >= 0 && pf.missDoctor.indexOf("speciality") >= 0, "a doctor still is");

  // 2) no role: nothing locked
  let g = await setRole(null);
  ok(g && g.locked.length === 0 && g.open.length > 0, "no role chosen: nothing locked (" + (g && g.open.length) + " open)");

  // 3) student
  g = await setRole("student");
  const studentLocked = ["pglog", "followcare", "queue", "icu", "insulin"].filter((a) => g.order.indexOf(a) >= 0);
  ok(studentLocked.length > 0 && studentLocked.every((a) => g.locked.indexOf(a) >= 0), "student: clinical/practice tools locked " + JSON.stringify(studentLocked));
  ok(g.open.indexOf("atlas") >= 0 || g.open.indexOf("guidelines") >= 0 || g.open.indexOf("interactions") >= 0, "student: learning tools stay open");
  const lastOpen = Math.max.apply(null, g.open.map((a) => g.order.indexOf(a)));
  const firstLocked = Math.min.apply(null, g.locked.map((a) => g.order.indexOf(a)));
  ok(lastOpen < firstLocked, "locked tiles sit after the open ones");
  const style = await J(`var b=document.querySelector('#rnavToolsGrid .role-locked'); return JSON.stringify(b?{op:getComputedStyle(b).opacity, lock:!!b.querySelector(".rnav-tile-lock"), aria:b.getAttribute("aria-label")}:null);`);
  ok(style && +style.op < 0.9 && style.lock && /locked for your role/.test(style.aria), "locked tile is dimmed, shows a lock, and says so to screen readers");

  // 4) a locked tap explains, does not open
  const locked1 = g.locked[0];
  await ev(`window.__opened=false; document.querySelector('#rnavToolsGrid [data-act="${locked1}"]').click(); return 1;`);
  await sleep(400);
  const sheet = await J(`var s=document.getElementById("hvSheet"); return JSON.stringify(s?{on:s.classList.contains("on"), text:s.innerText.slice(0,300)}:null);`);
  ok(sheet && sheet.on && /locked for your role/i.test(sheet.text) && /Medical student/.test(sheet.text), "locked tap opens the explainer: " + (sheet && sheet.text.replace(/\s+/g, " ").slice(0, 120)));
  ok(sheet && /Change my role/.test(sheet.text), "explainer offers 'Change my role' for a declared role");
  ok(!/—/.test(sheet ? sheet.text : ""), "no em-dash in the explainer");
  await ev(`var b=document.querySelector('#hvSheet [data-rl="close"]'); if(b) b.click(); return 1;`); await sleep(300);

  // 5) search does not offer locked tools
  const searchActs = await J(`return JSON.stringify(SMD_HOME_TOOLS().map(function(t){return t.act;}));`);
  ok(searchActs.indexOf("pglog") < 0 && searchActs.indexOf("queue") < 0, "search list excludes the student's locked tools");

  // 6) doctor: practice open, PG logbook locked
  g = await setRole("doctor");
  ok(g.locked.length === 0, "doctor: nothing locked, eLogbook included (" + JSON.stringify(g.locked) + ")");
  // 7) resident: logbook open, OPD locked
  g = await setRole("resident");
  ok((g.order.indexOf("pglog") < 0 || g.open.indexOf("pglog") >= 0) && (g.order.indexOf("queue") < 0 || g.locked.indexOf("queue") >= 0), "PG resident: logbook open, OPD locked");

  // 8) kill switch
  await ev(`localStorage.setItem("smd_role_gates","0"); return 1;`);
  g = await setRole("student");
  ok(g.locked.length === 0, "smd_role_gates=0 unlocks everything");
  await ev(`localStorage.removeItem("smd_role_gates"); localStorage.removeItem("smd_role"); return 1;`);

  // 9) a verified role from the server wins over the declared one
  const v = await J(`localStorage.setItem("smd_role","student"); var save=SMD_PRO.proState; SMD_PRO.proState=function(){return {role:"physician"};}; var r=SMD_ROLE.current(); SMD_PRO.proState=save; return JSON.stringify(r);`);
  ok(v === "doctor", "verified role (physician) beats a declared student: " + v);
} catch (e) { console.log("FAIL harness: " + (e && e.message || e)); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
