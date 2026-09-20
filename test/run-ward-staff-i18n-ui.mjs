/* The staff language across the whole ward, in real headless Chrome over CDP against the REAL ward.js, ward.css
 * and i18n.js (test/ward-golden-path-harness.html stubs only the network). A fake catalog wraps every ward.* English
 * string as TE[...], and the staff shell's picker state (window.WSQ.state.navLang) is set to it, as shell.js does.
 * Proves: the page language follows the picker; the ward list, bed board, chart (header, tabs, vitals, orders, MAR)
 * and the critical results and ED boards carry no static English; the golden path still works translated (the
 * clicks use data-w-act, never words); recorded values stay verbatim; a failure shows its English under the
 * translation; switching back to English leaves no trace. Screenshots go to $CLAUDE_JOB_DIR/ward-staff-i18n-shots.
 *
 *   node test/run-ward-staff-i18n-ui.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9391, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-staff-i18n-chrome";
const SHOTS = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-staff-i18n-shots";
mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-golden-path-harness.html");
const I18N = readFileSync(join(HERE, "../wardsynq/site/i18n.js"), "utf8");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=1280,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const until = async (cond, n = 40) => { for (let i = 0; i < n; i++) { if (await ev(cond)) return true; await sleep(100); } return false; };
const shot = async (name) => { const r = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };

// What a clinician or the harness recorded: shown verbatim, never as a translation.
// (the harness server's own answers - a NEWS2 reason, a category, a report status - are recorded data too)
const RECORDED = ["Harness Testcase", "Medical A", "Paracetamol 500mg", "Chest X-ray", "SMD-H1-00099", "Clear.", "Not enough vitals recorded to score.", "imaging", "final"];
function translatedAt(html) {
  const depth = new Uint16Array(html.length + 1); let d = 0;
  for (let i = 0; i < html.length; i++) {
    if (html.startsWith("TE[", i)) { d++; depth[i] = d; depth[i + 1] = d; depth[i + 2] = d; i += 2; continue; }
    depth[i] = d; if (html[i] === "]" && d > 0) d--;
  }
  return depth;
}
/** English static text left in the ward's markup: outside TE[...], outside lang="en", not an icon, not recorded. */
function leftovers(html) {
  const depth = translatedAt(html), stack = [], out = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g; let m;
  while ((m = re.exec(html))) {
    if (m[4] != null) {
      if (depth[m.index] || stack.some((e) => e.en || e.icon || /^(textarea|script|style)$/.test(e.tag))) continue;
      let t = m[4].replace(/&[a-z]+;|&#\d+;/g, " ");
      for (const r of RECORDED) t = t.split(r).join(" ");
      t = t.trim();
      if (!/[A-Za-z]{2}/.test(t) || t.includes("TE[")) continue;
      if (/\b\d+(\.\d+)?\s?(mg|mcg|ml|mL|g|%)\b/.test(t) || /^\d{1,2} [A-Z][a-z]{2,4},? \d{1,2}:\d{2}( ?[ap]m)?$/i.test(t)) continue;
      if (t.split(/[\s,·:()\/]+/).filter(Boolean).every((w) => /^[A-Z0-9.%\-]+$/.test(w) || /^(WardSynQ|MaiK|NEWS2|mmHg|min|kg|Oral|Sept?|am|pm|wsq-[\w-]+)$/.test(w) || !/[A-Za-z]/.test(w))) continue;
      out.push(t.slice(0, 90));
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1]) { const i = stack.map((e) => e.tag).lastIndexOf(tag); if (i >= 0) stack.length = i; continue; }
    if (/^(input|br|hr|img|meta|link|col|source|wbr)$/.test(tag) || /\/\s*$/.test(m[3])) continue;
    stack.push({ tag, en: /\blang="en"/.test(m[3]), icon: /material-symbols/.test(m[3]) });
  }
  return [...new Set(out)];
}
const wardHtml = () => ev(`return document.getElementById('smdWard').innerHTML;`);
async function checkScreen(name) {
  const html = await wardHtml();
  const left = leftovers(html);
  ok(html.includes("TE[") && left.length === 0, name + ": no static English left" + (left.length ? " - " + JSON.stringify(left) : ""));
  const depth = translatedAt(html);
  // A plain-text message (st.note / st.err, set as text and escaped) cannot carry markup, so a value in it is verbatim
  // but unmarked; everything else must be marked. ("imaging" and "final" are also ordinary words of the screen.)
  const bad = RECORDED.filter((r) => !/^(imaging|final)$/.test(r)).filter((r) => { for (let i = html.indexOf(r); i >= 0; i = html.indexOf(r, i + 1)) { const before = html.slice(0, i); if (before.lastIndexOf("<") > before.lastIndexOf(">")) continue;   // an attribute (a placeholder's example), not shown data
        if (/<div class="w-(ok|err)"><span[^>]*>\w+<\/span><p>[^<]*$/.test(before.slice(-300))) continue;
        if (depth[i] && !/lang="en">[^<]*$/.test(html.slice(Math.max(0, i - 200), i))) { console.log("   at: " + html.slice(Math.max(0, i - 160), i + 40)); return true; } } return false; });
  ok(bad.length === 0, name + ": recorded values are verbatim and, inside a translation, marked lang=\"en\"" + (bad.length ? " - " + bad : ""));
  await shot(name.replace(/\W+/g, "-"));
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });
  ok(await until(`return window.__ready === true;`, 60), "real ward.js loaded into the harness");

  // The staff site's i18n.js, a fake catalog for every ward.* key, and the shell's picker state.
  await call("Runtime.evaluate", { expression: I18N });
  const keys = await ev(`var en = WSQI18n._catalogs.en, te = {}, n = 0; Object.keys(en).forEach(function (k) { if (k.indexOf("ward.") === 0) { te[k] = "TE[" + en[k] + "]"; n++; } });
    WSQI18n.register("te", "Test", te, { reviewed: false }); window.WSQ = { state: { navLang: "te" } }; return n;`);
  ok(keys > 2000, "fake catalog covers every ward.* key (" + keys + ")");

  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await until(`return document.querySelectorAll('.w-empty').length > 0;`), "the ward opened translated");
  ok(await ev(`return document.documentElement.lang;`) === "te", "the page language follows the staff picker");
  await checkScreen("ward list");

  await ev(`document.querySelector('[data-w-act="board"]').click(); return true;`);
  ok(await until(`return !!document.querySelector('.w-bedcell.free');`), "the bed board rendered");
  await ev(`var b=[].filter.call(document.querySelectorAll('.w-bedcell.free'), function(x){return x.textContent.indexOf('12')>=0})[0]; b.click(); return true;`);
  ok(await until(`return !!document.querySelector('[data-w-act="admitnew"]');`), "picking a bed opens the admit panel, by its data-w-act");
  await checkScreen("bed board");

  await ev(`document.querySelector('[data-w-act="admitnew"]').click(); return true;`);
  ok(await until(`return !!document.querySelector('.w-bed');`), "the admission went through, translated, and the ward list shows the patient");
  await ev(`document.querySelector('.w-bed').click(); return true;`);
  ok(await until(`return !!document.querySelector('[data-w-act="vitals"]');`), "the chart opened");
  await ev(`document.getElementById('wMoDrug').value='Paracetamol 500mg'; document.getElementById('wMoValue').value='500'; document.getElementById('wMoUnit').value='mg'; document.getElementById('wMoRoute').value='oral'; document.getElementById('wMoFreq').value='BD'; document.querySelector('[data-w-act="medorder"]').click(); return true;`);
  ok(await until(`return !!document.querySelector('[data-w-act^="mar:verify"]');`), "a medication ordered from the translated chart reached the round");
  const body = await ev(`var c=window.__calls.filter(function(c){return c.url.indexOf('/ward/order')>=0 || c.url.indexOf('/ward/med')>=0}); return JSON.stringify(c.length ? c[c.length-1].body : null);`);
  ok(body && body.indexOf("TE[") < 0 && body.indexOf("Paracetamol 500mg") >= 0, "what was sent is what was typed, with nothing translated in it: " + body);
  ok(await ev(`return document.querySelector('[data-w-act^="mar:verify"]').textContent.indexOf('TE[verify]') >= 0;`), "the eMAR's verb is shown translated while the action sent stays mar:verify");
  await ev(`document.getElementById('wInvCode').value='Chest X-ray'; document.querySelector('[data-w-act="investigation"]').click(); return true;`);
  await until(`return document.body.textContent.indexOf('Chest X-ray') >= 0;`);
  await checkScreen("chart");

  // A failure: the translation, and the English under it.
  await ev(`window.WARD._dispatch("back"); return true;`);
  await until(`return !!document.querySelector('.w-bed');`);
  await ev(`var f = window.__origFetch = window.fetch; window.fetch = function (u, o) { if (String(u).indexOf('/ward/list') >= 0) return Promise.reject(new Error('offline')); return f(u, o); }; document.querySelector('[data-w-act="reload"]').click(); return true;`);
  ok(await until(`return !!document.querySelector('#wBanner .w-en');`), "a failure banner appeared");
  const banner = await ev(`var b = document.getElementById('wBanner'); return b ? b.innerHTML : "";`);
  ok(/TE\[Could not reach the ward\.\]<small class="w-en" lang="en">Could not reach the ward\.<\/small>/.test(banner), "SAFETY: the failure shows the translation and the English original under it");
  await shot("failure-banner");
  await ev(`window.fetch = window.__origFetch; return true;`);

  await ev(`window.WARD._dispatch("critsboard"); return true;`);
  await until(`return !!document.querySelector('.w-crit, .w-empty, .w-hint');`);
  await sleep(300);
  await checkScreen("critical results board");
  await ev(`window.WARD._dispatch("edboard"); return true;`);
  await sleep(500);
  await checkScreen("ED board");

  // Back to English: not one TE[ left, the page language is English again.
  // (a message already on screen was written in the language picked when it appeared; dismiss it first)
  await ev(`window.WSQ.state.navLang = "en"; window.WARD._dispatch("dismiss"); window.WARD._dispatch("back"); return true;`);
  await sleep(500);
  const back = await wardHtml();
  if (back.includes("TE[")) console.log("   left: " + back.slice(back.indexOf("TE[") - 120, back.indexOf("TE[") + 80));
  ok(!back.includes("TE[") && (await ev(`return document.documentElement.lang;`)) === "en", "English picked again: the ward is all English and the page says so");
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED (screenshots: " + SHOTS + ")");
process.exit(fails ? 1 : 0);
