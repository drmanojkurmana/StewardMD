/* StewardMD LIVE smoke test — drives the deployed site with headless Chrome (CDP)
 * and asserts the user-facing flows that unit tests can't see (search → KB, evidence
 * viewer, Knowledge Library search, Print). Run after any deploy.
 *
 * USAGE:
 *   node test/run-live-smoke.mjs                       # against https://stewardmd.in
 *   BASE=http://localhost:8799/ node test/run-live-smoke.mjs   # against a local server
 *   CHROME="/path/to/Chrome" node test/run-live-smoke.mjs      # override Chrome binary
 *   exit 0 = all checks passed, 1 = a check failed.
 *
 * Requires Google Chrome. NOT shipped to users — development/test tooling only.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const RAW_BASE = process.env.BASE || "https://stewardmd.in";
const BASE = RAW_BASE + (RAW_BASE.includes("?") ? "&" : "?") + "cb=" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9361);
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/smoke-chrome-prof";

const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = (s) => { try { return JSON.parse(s || "{}"); } catch { return {}; } };

let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log(`  ${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); ok ? pass++ : fail++; };

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome devtools endpoint never came up — is Google Chrome installed?");
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {}); await call("Network.enable", {});
  await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Page.navigate", { url: BASE });

  let ready = false;
  for (let i = 0; i < 50; i++) {
    await sleep(500);
    if (await ev(`return !!(window.DX && window.DX.openRef && window.KB_ENRICHMENT && window.KB_ENRICHMENT.byId && window.KB_ENRICHMENT.byId.MALARIA);`) === true) { ready = true; break; }
  }
  if (!ready) throw new Error("DX engine / KB_ENRICHMENT not loaded within timeout");
  const gold = await ev(`var s=document.querySelector('script[src*="reasoning.js"]'); return s? (s.getAttribute('src').match(/gold\\d+/)||['?'])[0] : '?';`);
  console.log(`\nLIVE @ ${RAW_BASE}  (reasoning.js ${gold})\n`);

  // 1) Global search → Harrison Knowledge Base, malaria reachable, KB section first
  console.log("1) Global search 'malaria':");
  await ev(`var i=document.getElementById('smdSearchInput'); if(i){ i.value='malaria'; i.dispatchEvent(new Event('input',{bubbles:true})); } return 1;`);
  await sleep(600);
  const S = J(await ev(`
    var box=document.getElementById('spResults'); if(!box) return JSON.stringify({});
    var sec=document.getElementById('smdKbSec'), first=box.firstElementChild;
    return JSON.stringify({ hasKbSec:!!sec, label: sec?(sec.querySelector('.sp-section-label')||{}).textContent:null,
      kbFirst: !!(first && first.id==='smdKbSec'), hasMalaria: !!(sec && sec.querySelector('[data-kb="MALARIA"]')),
      kbCount: sec? sec.querySelectorAll('[data-kb]').length : 0 });`));
  check("Harrison KB section present", !!S.hasKbSec, S.label || "");
  check("KB section prepended above legacy results", !!S.kbFirst);
  check("Malaria reachable as a KB result", !!S.hasMalaria, S.kbCount + " KB cards");

  // 2) Evidence viewer for Malaria
  console.log("2) Malaria Harrison evidence viewer (DX.openRef):");
  await ev(`window.DX.openRef('MALARIA'); return 1;`);
  await sleep(700);
  const E = J(await ev(`
    var m=document.querySelector('#dxMgmt'); var html=m?m.innerHTML:'';
    return JSON.stringify({ hasViewer:/ev-wrap/.test(html), hasBriefing:/StewardMD clinical briefing|ev-brief/.test(html),
      hasPearls:/ev-pearl/.test(html), hasMd:/class="md-(bug|emerg|key|ix|drug|hi|sig)"/.test(html), len:html.length });`));
  check("evidence viewer rendered", !!E.hasViewer, E.len + " chars");
  check("clinician briefing present", !!E.hasBriefing);
  check("clinical pearls present", !!E.hasPearls);
  check("smart highlighting present", !!E.hasMd);

  // 3) Knowledge Library search
  console.log("3) Knowledge Library search:");
  const lib = J(await ev(`if(!(window.SB && SB.openRef)) return JSON.stringify({noSB:true}); SB.openRef('syndromes'); return JSON.stringify({opened:true});`));
  if (lib.noSB) { check("Knowledge Library (SB) available", false, "window.SB not found"); }
  else {
    await sleep(500);
    const before = await ev(`var g=document.getElementById('kblibGrid'); return g? g.querySelectorAll('[data-kb]').length : -1;`);
    await ev(`var q=document.getElementById('kblibQ'); if(q){ q.value='malaria'; q.dispatchEvent(new Event('input',{bubbles:true})); } return 1;`);
    await sleep(350);
    const after = await ev(`var g=document.getElementById('kblibGrid'); return g? g.querySelectorAll('[data-kb]').length : -1;`);
    check("Library grid populated", before > 50, before + " entries");
    check("Library search filters on 'malaria'", after > 0 && after < before, `${before} → ${after}`);
  }

  // 4) Print
  console.log("4) Print (Clinical Reasoning):");
  await ev(`window.__printed=0; window.print=function(){window.__printed++;}; return 1;`);
  await ev(`try{ window.DX._state.f={fever:true,neckStiffness:true,headache:true,photophobia:true,alteredSensorium:true}; }catch(e){}; (window.DX.openWorkspace||window.DX.open)(); return 1;`);
  await sleep(900);
  const colsLen = await ev(`var c=document.getElementById('dxCols'); return c? c.innerHTML.length : 0;`);
  await ev(`var b=document.getElementById('dxPrint'); if(b){ b.click(); } return 1;`);
  await sleep(500);
  const P = J(await ev(`
    var a=document.getElementById('dxPrintArea');
    return JSON.stringify({ printed:window.__printed||0, hasArea:!!a, len:a?a.innerHTML.length:0,
      header: a?/StewardMD — Clinical Reasoning/.test(a.innerHTML):false, rendered: a?/dx-print-rendered/.test(a.innerHTML):false,
      hasStyle:!!document.getElementById('dx-print-style') });`));
  check("differential rendered for print", colsLen > 0, "#dxCols " + colsLen + " chars");
  check("print() invoked", (P.printed || 0) >= 1);
  check("printable area built with content", !!P.hasArea && P.len > 100, P.len + " chars (header=" + P.header + " rendered=" + P.rendered + ")");
  check("print stylesheet injected", !!P.hasStyle);

  console.log(`\n${fail ? fail + " CHECK(S) FAILED" : "ALL " + pass + " LIVE CHECKS PASSED"} (${pass} passed, ${fail} failed)`);
} catch (e) {
  console.log("HARNESS ERROR:", e.message); fail++;
} finally {
  try { chrome.kill(); } catch {}
  process.exitCode = fail ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
}
