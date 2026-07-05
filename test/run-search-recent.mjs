/* StewardMD — main search bar: recent-search history replaces the example chips.
 * Asserts: the hardcoded example chips (Malaria/PipTaz/…) are gone; #spChips is empty when
 * there's no history; committed searches (Enter) are recorded and shown as 🕘 recent chips on
 * reopen; a recent chip re-runs the search; Clear empties the history.
 * USAGE: BASE=http://localhost:5173/ node test/run-search-recent.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:5173/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9521);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR||"/tmp")}/tmp/recent-chrome`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const chk = (n, ok, d) => { console.log(`  ${ok?"✅":"❌"} ${n}${d?" — "+d:""}`); if (!ok) fails++; };
const openSearch = async () => { await ev(`window.closeSearch&&window.closeSearch(); return 1;`); await ev(`window.openSearch&&window.openSearch(); return 1;`); await sleep(450); };
const chipsText = () => ev(`var c=document.getElementById("smdRecentBox");return c&&c.style.display!=="none"?c.innerText:""`);
const spChipsHidden = () => ev(`var c=document.getElementById("spChips");if(!c)return true;var d=getComputedStyle(c).display;return d==="none"`);
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await ev(`if(navigator.serviceWorker)navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});return 1;`);
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() });
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return typeof window.openSearch==="function"`) === true) break; }
  await ev(`["introPoster","splash","accountGate","smdBootSplash","consentOverlay"].forEach(function(k){var e=document.getElementById(k);if(e)e.remove();}); localStorage.removeItem("smd_recent_searches"); return 1;`);

  // 1) example chips hidden; empty history → no recent box shown
  await openSearch();
  chk("native example chips (#spChips) hidden", await spChipsHidden() === true);
  chk("example chips not visible to the user (no Malaria/PipTaz/MELD)", !/Malaria|PipTaz|MELD|Vancomycin/i.test(await chipsText()));
  chk("empty history → no recent box shown", (await chipsText()).trim() === "");
  chk("input placeholder no longer lists examples", await ev(`var i=document.getElementById("smdSearchInput");return i? !/malaria|piptaz|meld/i.test(i.placeholder||"") : false`) === true, await ev(`return (document.getElementById("smdSearchInput")||{}).placeholder`));

  // 2) commit two searches via Enter → recorded
  async function commit(q) {
    await ev(`var i=document.getElementById("smdSearchInput"); i.value=${JSON.stringify(q)}; i.dispatchEvent(new Event("input",{bubbles:true})); i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})); return 1;`);
    await sleep(120);
  }
  await commit("meningitis"); await commit("dka");
  chk("committed searches stored in localStorage (most-recent first)", JSON.parse(await ev(`return localStorage.getItem("smd_recent_searches")`) || "[]").slice(0,2).join(",") === "dka,meningitis");

  // 3) reopen → recent chips shown (🕘), examples still gone
  await openSearch();
  const t1 = await chipsText();
  chk("recent searches shown on reopen", /Recent searches/i.test(t1) && /dka/i.test(t1) && /meningitis/i.test(t1), t1.replace(/\n/g," ").slice(0, 80));
  chk("recent chips use the 🕘 marker", /🕘/.test(t1));

  // 4) clicking a recent chip re-runs the search (fills the input)
  await ev(`var b=document.querySelector('#smdRecentBox .smd-recent-chip[data-rq="meningitis"]'); if(b)b.click(); return 1;`);
  await sleep(150);
  chk("clicking a recent chip fills the search input", (await ev(`return (document.getElementById("smdSearchInput")||{}).value`)) === "meningitis");

  // 5) Clear empties history
  await openSearch();
  await ev(`var c=document.getElementById("smdRecentClear"); if(c)c.click(); return 1;`);
  await sleep(120);
  chk("Clear empties recent history", (await ev(`return localStorage.getItem("smd_recent_searches")`)) === null && (await chipsText()).trim() === "");

  console.log(`\n${fails ? "❌ " + fails + " FAILED" : "✅ ALL GREEN — recent search history"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
