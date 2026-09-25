/* StewardMD - universal search. Asserts: header button opens #usPanel; empty state shows Browse;
 * typing finds a tool, a calculator and a setting; chips filter; Enter opens the first result;
 * recents are recorded under smd_recent_searches; Escape closes; ?usearch=0 leaves the legacy
 * #smdSearchPanel in charge (kill switch is a no-op path).
 * USAGE: BASE=http://localhost:5173/ node test/run-universal-search.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:5173/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9523);
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR || "/tmp")}/tmp/usearch-chrome`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const chk = (n, ok, d) => { console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); if (!ok) fails++; };
async function boot(url) {
  await ev(`if(navigator.serviceWorker)navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});return 1;`);
  await call("Page.navigate", { url });
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return typeof window.openSearch==="function" && !!window.SMD_HOME_TOOLS`) === true) break; }
  await ev(`["introPoster","splash","accountGate","smdBootSplash","consentOverlay","introOverlay"].forEach(function(k){var e=document.getElementById(k);if(e)e.remove();}); localStorage.removeItem("smd_recent_searches"); return 1;`);
}
const type = async (q) => { await ev(`var i=document.getElementById("usInput"); i.value=${JSON.stringify(q)}; i.dispatchEvent(new Event("input",{bubbles:true})); return 1;`); await sleep(350); };
const rows = () => ev(`return Array.from(document.querySelectorAll("#usBody .us-row")).map(function(r){return r.getAttribute("data-cat")+":"+r.querySelector(".us-row-t").textContent})`);
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});

  await boot(BASE + "?cb=" + Date.now());
  await ev(`document.getElementById("smdSearchBtn").click(); return 1;`); await sleep(400);
  chk("header button opens the universal panel", await ev(`var p=document.getElementById("usPanel");return !!p && !p.hidden && p.classList.contains("on")`) === true);
  chk("legacy panel stays closed", await ev(`var p=document.getElementById("smdSearchPanel");return !p || !p.classList.contains("open")`) === true);
  chk("input is focused synchronously", await ev(`return document.activeElement && document.activeElement.id==="usInput"`) === true);
  chk("empty state shows Browse tiles for every category", await ev(`return document.querySelectorAll("#usBody .us-browse").length`) === 9);   // tools, calcs, drugs, kb, proto, kits, syn, icd, settings

  await type("antibiogram");
  const r1 = await rows();
  chk("a tool is the first hit for a module name", /^tools:Antibiogram/.test(r1[0] || ""), r1[0]);
  chk("chips rendered with All first and aria-pressed", await ev(`var c=document.querySelectorAll("#usChips .us-chip");return c.length>1 && c[0].getAttribute("data-cat")==="all" && c[0].getAttribute("aria-pressed")==="true"`) === true);
  chk("Ask MaiK row is always last", /^ask:Ask MaiK about "antibiogram"/.test(r1[r1.length - 1] || ""), r1[r1.length - 1]);

  await type("meld");
  chk("a calculator is found by name", (await rows()).some(r => /^calcs:MELD/i.test(r)));
  await type("response time");
  chk("a setting is found by its toggle title", (await rows()).some(r => /^settings:Show AI response time/.test(r)));
  await type("dark mode");
  chk("appearance is found by an alias", (await rows()).some(r => /^tools:Appearance/.test(r)));
  await type("menigitis");
  chk("a misspelling still finds a syndrome (fuzzy)", (await rows()).some(r => /^syn:.*Meningitis/i.test(r)));

  await type("ins");
  await ev(`var c=document.querySelector('#usChips .us-chip[data-cat="calcs"]'); if(c)c.click(); return 1;`); await sleep(100);
  const filtered = await rows();
  chk("selecting a chip filters to one category", filtered.every(r => /^calcs:|^ask:/.test(r)) && filtered.length > 5, String(filtered.length));
  chk("sections other than the chosen one and Ask are gone", await ev(`return document.querySelectorAll("#usBody .us-sec[data-cat]").length`) === 2);

  await ev(`var c=document.querySelector('#usChips .us-chip[data-cat="all"]'); c.click(); return 1;`); await sleep(100);
  await type("antibiogram");
  await ev(`var i=document.getElementById("usInput"); i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})); return 1;`); await sleep(300);
  chk("Enter opens the first result and closes the panel", await ev(`return document.getElementById("usPanel").hidden===true`) === true);
  chk("committed query stored under smd_recent_searches", JSON.parse(await ev(`return localStorage.getItem("smd_recent_searches")`) || "[]")[0] === "antibiogram");
  await ev(`try{ABG.close()}catch(e){} return 1;`);

  await ev(`window.openSearch(); return 1;`); await sleep(350);
  await type("");
  chk("recent chip shown on reopen with an empty query", await ev(`return !!document.querySelector('#usBody .us-recent[data-q="antibiogram"]')`) === true);
  await ev(`var i=document.getElementById("usInput"); i.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); return 1;`); await sleep(300);
  chk("Escape closes", await ev(`return document.getElementById("usPanel").hidden===true`) === true);

  await ev(`window.openSearch(); return 1;`); await sleep(100); await type("zzqxv"); await sleep(400);
  chk("no-results state still offers Ask MaiK", await ev(`return !!document.querySelector("#usBody .us-empty") && document.querySelectorAll('#usBody .us-row[data-cat="ask"]').length===1`) === true);
  await ev(`window.closeSearch(); return 1;`); await sleep(300);

  // desktop shortcut: Cmd+K / Ctrl+K
  await ev(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,bubbles:true})); return 1;`); await sleep(350);
  chk("Cmd+K opens the universal panel", await ev(`var p=document.getElementById("usPanel");return !!p && !p.hidden && p.classList.contains("on")`) === true);
  await ev(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,bubbles:true})); return 1;`); await sleep(300);
  chk("Cmd+K closes the universal panel", await ev(`return document.getElementById("usPanel").hidden===true`) === true);

  // rapid re-open race guard
  await ev(`window.openSearch(); window.closeSearch(); window.openSearch(); return 1;`); await sleep(350);
  chk("rapid re-open stays open (no close-timer race)", await ev(`var p=document.getElementById("usPanel");return !!p && !p.hidden && p.classList.contains("on")`) === true);
  await ev(`window.closeSearch(); return 1;`); await sleep(300);

  // recent item single deletion
  await ev(`window.openSearch(); return 1;`); await sleep(300);
  await ev(`var b=document.querySelector('#usBody .us-recent[data-q="antibiogram"] .us-recent-del'); if(b)b.click(); return 1;`); await sleep(100);
  chk("single recent item deletion works", await ev(`return !document.querySelector('#usBody .us-recent[data-q="antibiogram"]')`) === true);
  chk("smd_recent_searches updated after deletion", JSON.parse(await ev(`return localStorage.getItem("smd_recent_searches")`) || "[]").indexOf("antibiogram") === -1);
  await ev(`window.closeSearch(); return 1;`); await sleep(300);

  // clean close guarantees: no invisible touch traps, input disabled, homepage unobstructed
  chk("after close: panel display is none", await ev(`var p=document.getElementById("usPanel");return window.getComputedStyle(p).display==="none"`) === true);
  chk("after close: panel pointer-events is none", await ev(`var p=document.getElementById("usPanel");return window.getComputedStyle(p).pointerEvents==="none"`) === true);
  chk("after close: input is disabled", await ev(`return document.getElementById("usInput").disabled===true`) === true);
  chk("after close: backdrop display is none", await ev(`var b=document.getElementById("usBackdrop");return window.getComputedStyle(b).display==="none"`) === true);
  chk("after close: body scroll is unlocked", await ev(`return !document.body.classList.contains("us-open")`) === true);
  chk("after close: elementFromPoint is never intercepted by panel or backdrop", await ev(`var hit=document.elementFromPoint(100, 100);return hit && !hit.closest("#usPanel") && !hit.closest("#usBackdrop")`) === true);

  // kill switch: legacy panel must be the one that opens
  await boot(BASE + "?usearch=0&cb=" + Date.now());
  await ev(`document.getElementById("smdSearchBtn").click(); return 1;`); await sleep(400);
  chk("?usearch=0: legacy panel opens", await ev(`var p=document.getElementById("smdSearchPanel");return !!p && p.classList.contains("open")`) === true);
  chk("?usearch=0: universal panel never created", await ev(`return !document.getElementById("usPanel")`) === true);

  console.log(`\n${fails ? "❌ " + fails + " FAILED" : "✅ ALL GREEN — universal search"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
