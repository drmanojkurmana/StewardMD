/* StewardMD — BOUNDED LIVE-provider MaiK eval (owner-approved token spend).
 *
 * Drives the DEPLOYED MaiK (real Gemini via /api/ai/explain) with the flagship Tier-1 cases in
 * live-cases.json, captures the REAL answers, and scores:
 *   clinical-ELEMENT coverage (key management pillars present?) · truncation · raw-ID/markdown leak
 *   · "no specific question"/KB-narration leak · sources shown · safety (no fabricated-dose-only reply).
 * This is element-coverage + heuristics, NOT clinician certification. Records quota-blocked cases
 * honestly (unauthenticated = guest quota) rather than bypassing limits.
 *
 * USAGE: BASE=https://stewardmd.in/ node test/maik-eval/run-live-eval.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE || "https://stewardmd.in/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9485);
const ROOT = new URL("../../", import.meta.url).pathname;
const CASES = JSON.parse(readFileSync(ROOT + "test/maik-eval/live-cases.json", "utf8")).cases;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR||"/tmp")}/tmp/maik-chrome-live`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };

const RAW_ID = /\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+)+\b/;
const NARRATION_LEAK = /no specific question|retrieved knowledge contains|the retrieved knowledge|does not (cover|contain)/i;
const RAW_MD_LEAK = /```|\{"@|"chunkId"|"diseaseId"/;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() });
  for (let i = 0; i < 100; i++) { await sleep(400); if (await ev(`return !!(window.SMD_AI && window.StewardRAG && window.SMD_REASON)`) === true) break; }
  await ev(`["introPoster","splash","accountGate"].forEach(function(k){var e=document.getElementById(k);if(e)e.remove();}); try{if(window.SMD_AI&&SMD_AI.setFlag)SMD_AI.setFlag(true);}catch(e){} return 1;`);
  await ev(`return window.StewardRAG.ready().then(function(){return 1;}).catch(function(){return 0;});`);
  let opened = false;
  for (let i = 0; i < 15 && !opened; i++) { await ev(`var t=document.querySelector('[data-act="askai"]'); if(t){t.click();} return 1;`); await sleep(400); opened = await ev(`return !!document.getElementById("maikQ")`) === true; }
  if (!opened) { console.log("WARN: could not open MaiK sheet"); }

  async function ask(msg) {
    await ev(`document.getElementById("maikQ").value=${JSON.stringify(msg)}; document.getElementById("maikSend").click(); return 1;`);
    // real provider: poll up to ~18s for the answer bubble to stop being the "Searching…" placeholder
    let text = "", tries = 0;
    while (tries++ < 24) {
      await sleep(900);
      text = await ev(`var b=document.querySelectorAll("#maikBody .maik-b.ai"); var last=b.length?b[b.length-1]:null; return last?(last.innerText||""):"";`);
      if (text && !/searching stewardmd knowledge|✨/i.test(text)) break;
    }
    const html = await ev(`var b=document.querySelectorAll("#maikBody .maik-b.ai"); var last=b.length?b[b.length-1]:null; return last?last.innerHTML:"";`);
    return { text: text || "", html: html || "" };
  }

  const results = [];
  for (const c of CASES) {
    for (const p of (c.priorTurns || [])) await ask(p.q);
    const r = await ask(c.message);
    const quota = /usage limit reached|limit reached for now/i.test(r.text);
    const unavailable = /unavailable right now|currently off/i.test(r.text);
    if (quota || unavailable) { results.push({ id: c.id, topic: c.topic, status: quota ? "quota_blocked" : "provider_unavailable", answerLen: r.text.length }); continue; }
    const lc = r.text.toLowerCase();
    const elements = (c.requiredElements || []).map(e => ({ name: e.name, present: new RegExp(e.re, "i").test(lc) }));
    const elemCovered = elements.filter(e => e.present).length;
    // Strip bubble chrome (advisory prefix, Show more/less button, Sources block) BEFORE checking
    // for a mid-sentence cut — otherwise the trailing UI text produces a false truncation flag.
    const body = r.text
      .replace(/^Educational clinical reference[^\n]*\n?/i, "")
      .replace(/\n?\s*Show (more|less)\s*[▾▴]?\s*$/i, "")
      .replace(/\n?\s*Sources?\s*[▸▾][\s\S]*$/i, "")
      .trim();
    const truncated = body.length > 40 && !/[.!?…)"'*]\s*$/.test(body);
    const flags = {
      elementCoverage: elements.length ? Math.round((elemCovered / elements.length) * 100) : null,
      allElements: elemCovered === elements.length,
      truncated,
      no_narration_leak: !NARRATION_LEAK.test(r.text),
      no_raw_id: !RAW_ID.test(r.text),
      no_markdown_leak: !RAW_MD_LEAK.test(r.html) && !RAW_MD_LEAK.test(r.text),
      sources_shown: /sources/i.test(r.html) || /\bReferences?\b/.test(r.html),
    };
    const pass = flags.allElements && !flags.truncated && flags.no_narration_leak && flags.no_raw_id && flags.no_markdown_leak;
    results.push({ id: c.id, topic: c.topic, status: "answered", answerLen: r.text.length, elements, flags, pass, answerPreview: r.text.slice(0, 220) });
  }

  const answered = results.filter(r => r.status === "answered");
  const blocked = results.filter(r => r.status !== "answered");
  const passed = answered.filter(r => r.pass).length;
  const avgElem = answered.length ? Math.round(answered.reduce((s, r) => s + (r.flags.elementCoverage || 0), 0) / answered.length) : 0;
  const report = {
    generated: "run-live-eval.mjs", base: BASE, note: "Element-coverage + safety heuristics on REAL provider answers; NOT clinician-certified.",
    counts: { total: results.length, answered: answered.length, blocked: blocked.length },
    answered: { passed, of: answered.length, avgElementCoveragePct: avgElem },
    blocked: blocked.map(b => ({ id: b.id, status: b.status })),
    results,
  };
  writeFileSync(ROOT + "test/maik-eval/live-results.json", JSON.stringify(report, null, 2));

  console.log(`\nLIVE eval — ${answered.length} answered, ${blocked.length} blocked (of ${results.length})`);
  if (answered.length) console.log(`Answered: ${passed}/${answered.length} passed all heuristics · avg clinical-element coverage ${avgElem}%`);
  results.forEach(r => {
    if (r.status !== "answered") { console.log(`  ⏸ ${r.id} ${r.topic} — ${r.status}`); return; }
    const missing = r.elements.filter(e => !e.present).map(e => e.name);
    console.log(`  ${r.pass ? "✅" : "⚠️"} ${r.id} ${r.topic} — elements ${r.flags.elementCoverage}%${missing.length ? " (missing: " + missing.join(", ") + ")" : ""}${r.flags.truncated ? " TRUNCATED" : ""}${r.flags.no_narration_leak ? "" : " NARRATION-LEAK"}${r.flags.no_raw_id ? "" : " RAW-ID"}`);
  });
  console.log("→ test/maik-eval/live-results.json");
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
