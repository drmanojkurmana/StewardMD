/* Knowledge Library search + Related topics in the real app (headless Chrome), phone viewport.
 *   - Discover search finds diseases by abbreviation, misspelling, British spelling and plural;
 *   - typing stays fast once the index is built (index build and one query timed);
 *   - the disease reader ends with 3 to 6 Related topics; tapping one opens it, Back returns to the first;
 *   - the Related list fits the phone (no sideways scroll) and its rows are 44px or taller.
 * USAGE: node test/run-kb-search-ui.mjs   (screenshots in $SHOTS or /tmp/stewardmd-kb-search)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const PORT = Number(process.env.PORT || 9036), CDP = Number(process.env.CDP_PORT || 9436);
const SHOTS = process.env.SHOTS || "/tmp/stewardmd-kb-search";
const server = spawn("node", [repo + "test/serve.mjs", repo, String(PORT)], { stdio: "ignore" });
const chrome = spawn(process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/kb-search-chrome-${process.pid}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let ws, sid, id = 0, failures = 0; const pending = new Map();
const call = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params, sessionId: sid })); });
const ev = async (expression) => { const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };
const ok = (pass, label) => { console.log(`${pass ? "PASS" : "FAIL"} ${label}`); if (!pass) failures++; };
async function shot(name) { await sleep(250); await mkdir(SHOTS, { recursive: true }); const r = await call("Page.captureScreenshot", { format: "png" }); await writeFile(`${SHOTS}/${name}.png`, Buffer.from(r.result.data, "base64")); }
const type = (q) => ev(`(()=>{const i=document.querySelector('#kblibQ');i.value=${JSON.stringify(q)};i.dispatchEvent(new Event('input',{bubbles:true}));return document.querySelector('#kblibGrid .kblib-row')?.getAttribute('data-kb')||''})()`);

try {
  let version; for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const created = await call("Target.createTarget", { url: "about:blank" });
  sid = (await call("Target.attachToTarget", { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: `http://localhost:${PORT}/` });
  for (let i = 0; i < 120; i++) { if (await ev("!!window.SB?.__smdKbWrapped && !!window.SMD_KBSEARCH && Object.keys(window.KB_ENRICHMENT?.byId||{}).length>4000")) break; await sleep(250); }
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());document.body.classList.remove('dark');SB.openRef('syndromes')`);
  await sleep(600);
  ok(await ev("!!window.SMD_KBSEARCH"), "kb-search.js is loaded");

  const cases = [["mi", "acs"], ["dka", "dka"], ["tb", "PULMONARY_TB"], ["pnuemonia", /pneumonia/i], ["menigitis", "MENINGITIS"], ["haemorrhage", /hemorrhage|haemorrhage/i],
    ["tumour", "tumour_lysis_syndrome"], ["seizures", "seizures_and_epilepsy"], ["heart attack", "acs"]];
  for (const [q, want] of cases) {
    const top = await type(q);
    const name = await ev(`document.querySelector('#kblibGrid .kblib-row .kblib-name')?.textContent||''`);
    ok(want instanceof RegExp ? want.test(name) : top === want, `search "${q}" -> ${top} (${name})`);
  }
  await shot("search-pnuemonia");
  const t = await ev(`(()=>{const i=document.querySelector('#kblibQ');const s=performance.now();for(const q of ['h','he','hea','hear','heart','heart f','heart fa']){i.value=q;i.dispatchEvent(new Event('input',{bubbles:true}));}return performance.now()-s})()`);
  ok(t < 2500, `7 keystrokes painted in ${Math.round(t)} ms`);
  ok(await ev(`document.querySelector('#kblibGrid').textContent.includes('No matches')===false`), "typing keeps results");
  await type("zzzzzzzzzzzz");
  ok(await ev(`document.querySelector('#kblibGrid').textContent.includes('No matches')`), "nonsense still shows No matches");

  // Related topics
  let first = "CAP";
  await ev(`DX.openRef(${JSON.stringify(first)},{from:'knowledge-library'})`);
  await sleep(700);
  const rel = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#dxMgmt .kbr-related .kbr-rel')].map(b=>({id:b.dataset.kbrel,h:b.getBoundingClientRect().height,r:b.getBoundingClientRect().right})))`));
  ok(rel.length >= 3 && rel.length <= 6, `Related topics: ${rel.length} links`);
  ok(rel.every((r) => r.h >= 44), "related rows are at least 44px tall");
  ok(await ev(`(()=>{const b=document.querySelector('#dxMgmt .dx-mgmt-body');return b.scrollWidth<=b.clientWidth+1})()`), "reader has no sideways scroll with Related topics");
  ok(await ev(`!!document.querySelector('#dxMgmt .kbr-sec--related h3') && document.querySelector('#dxMgmt .kbr-sec--related').previousElementSibling.id!==''`), "Related sits after the last section");
  await ev(`document.querySelector('#dxMgmt .kbr-related').scrollIntoView({block:'center'})`);
  await shot("related-cap");
  const target = rel[0].id;
  await ev(`document.querySelector('#dxMgmt .kbr-rel').click()`);
  await sleep(700);
  const title = await ev(`document.querySelector('#dxMgmt .dx-mgmt-name')?.textContent||''`);
  const want = await ev(`KB_ENRICHMENT.byId[${JSON.stringify(target)}].name`);
  ok(title === want, `tapping a related topic opens it (${title})`);
  ok(await ev(`/^\\u2039 /.test(document.querySelector('#dxMgmtBack')?.textContent||'')`), "Back names where it returns");
  await ev(`document.querySelector('#dxMgmtBack').click()`);
  await sleep(700);
  ok((await ev(`document.querySelector('#dxMgmt .dx-mgmt-name')?.textContent||''`)) === (await ev(`KB_ENRICHMENT.byId[${JSON.stringify(first)}].name`)), "Back returns to the first disease");
  await ev(`document.querySelector('#dxMgmtBack').click()`);
  await sleep(500);
  ok(await ev(`document.querySelector('#sbrefOverlay').classList.contains('open')`), "second Back returns to the Library");
} catch (e) { console.log("ERROR", e.message); failures++; }
finally { try { ws?.close(); } catch {} chrome.kill(); server.kill(); }
console.log(failures ? `${failures} FAILURE(S)` : "ALL PASS");
process.exit(failures ? 1 : 0);
