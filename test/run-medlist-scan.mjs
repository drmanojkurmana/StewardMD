/* Medication-list scan: compress + OCR review + apply (prescription / case sheet).
 *
 * Verifies the safety-critical, locally-testable parts of the photo/PDF scan for
 * the medication list, MIRRORING test/run-icu-import.mjs:
 *   • client-side compression shrinks a large image to a JPEG under the upload cap
 *     (a raw multi-MB file is NEVER what reaches the OCR endpoint; EXIF stripped),
 *   • a STUBBED scanExtract() → the review screen lists candidate rows with
 *     confidence + include/exclude checkboxes, and NOTHING is auto-added,
 *   • "Add selected" adds the confirmed rows to MEDLIST with source "scan" +
 *     carried confidence,
 *   • a low-confidence / unmapped row is flagged "review manually" and is NOT
 *     silently mapped to a generic,
 *   • no raw JSON / provider / model text leaks into the review DOM.
 *
 * The OCR vision call itself hits /api/ai/vision (Cloudflare Function) and is
 * PROD-ONLY — here scanExtract is stubbed so the test never touches the network.
 * USAGE: BASE=http://localhost:8903/ node test/run-medlist-scan.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8903/").replace(/\/?$/, "/");
const PORT = 9377, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/medlist-scan-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8903"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false; for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.MEDLIST && MEDLIST.mount && MEDLIST._compressImage && MEDLIST.scanExtract)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("MEDLIST scan API not loaded");

  await ev(`var d=document.getElementById("ml-test"); if(!d){d=document.createElement("div"); d.id="ml-test"; document.body.appendChild(d);} return 1;`);

  // 1) compression: a big noisy image → JPEG under the ~1.6 MB upload cap
  const comp = await ev(`
    var n = 2600, cv = document.createElement("canvas"); cv.width = n; cv.height = n; var ctx = cv.getContext("2d");
    var im = ctx.createImageData(n, n); for (var i = 0; i < im.data.length; i += 4) { im.data[i]=(i*7)%255; im.data[i+1]=(i*13)%255; im.data[i+2]=(i*29)%255; im.data[i+3]=255; }
    ctx.putImageData(im, 0, 0);
    var raw = cv.toDataURL("image/png");
    return await new Promise(function(res){ MEDLIST._compressImage(raw, function(out, meta){ res(JSON.stringify({ rawKB: Math.round(raw.length*3/4/1024), outKB: meta&&meta.kb, jpeg: /^data:image\\/jpeg/.test(out||"") })); }); });
  `);
  const C = JSON.parse(comp);
  ok(C.jpeg === true, "compressed output is a JPEG data-URL (EXIF/metadata dropped by canvas re-encode)");
  ok(C.outKB > 0 && C.outKB <= 1650, "large image (" + C.rawKB + " KB raw) compressed to " + C.outKB + " KB (≤ upload cap)");

  // Sample candidate rows a real scanExtract() would resolve — mix of high (mapped),
  // medium (combo needing confirm) and low (illegible / unmapped) confidence.
  const stubRows = `[
    {detected_text:"Tab Amlodipine 5mg OD", drug:"amlodipine", strength:"5mg", route:"PO", frequency:"OD", confidence:"high"},
    {detected_text:"Cardivas 3.125 bd", drug:null, strength:"3.125", route:"", frequency:"bd", confidence:"medium"},
    {detected_text:"X…illeg… 250 bd", drug:null, strength:"250", route:"", frequency:"bd", confidence:"low"}
  ]`;

  // 2) STUB scanExtract → open scan → review screen lists rows w/ confidence +
  //    checkboxes; NOTHING auto-added to getList().
  await ev(`
    MEDLIST.clearAll();
    window.__origScan = MEDLIST.scanExtract;
    MEDLIST.scanExtract = function(dataUrl){ return Promise.resolve(${stubRows}); };
    MEDLIST.mount(document.getElementById("ml-test"));
    return 1;
  `);
  ok(await ev(`return document.querySelector("#ml-test [data-ml-scan]") && document.querySelector("#ml-test [data-ml-scan]").disabled === false`) === true, "Scan add-option is ENABLED (no longer 'Coming soon')");
  ok(await ev(`return !/Scan[^<]*Coming soon/i.test(document.querySelector("#ml-test [data-ml-scan]").textContent)`) === true, "Scan button is not labelled 'Coming soon'");

  // Drive the pipeline directly with a stubbed candidate set (bypasses file picker,
  // exactly like a returned scanExtract() would).
  await ev(`return MEDLIST._openScanReview(${stubRows}, "data:image/jpeg;base64,AAAA");`);
  await sleep(150);
  ok(await ev(`return MEDLIST.getList().length`) === 0, "opening scan review auto-adds NOTHING to the list");
  const rowCount = await ev(`return document.querySelectorAll("#ml-test [data-ml-scan-row]").length`);
  ok(rowCount === 3, "review screen lists one row per candidate (3)");
  ok(await ev(`return document.querySelectorAll("#ml-test [data-ml-scan-row] input[type=checkbox]").length`) === 3, "each review row has an include/exclude checkbox");
  const rtext = await ev(`return document.getElementById("ml-test").innerText`);
  ok(/high/i.test(rtext) && /medium/i.test(rtext) && /low/i.test(rtext), "confidence (high/medium/low) shown per row");
  ok(/Amlodipine/i.test(rtext) && /Cardivas/i.test(rtext), "detected_text preserved verbatim in review");
  ok(await ev(`return document.querySelectorAll("#ml-test [data-ml-scan-row] [data-ml-scan-edit]").length`) === 3, "each row has an editable field");

  // 4) low-confidence / unmapped rows flagged "review manually" and NOT silently mapped
  ok(/review manually/i.test(rtext), "low-confidence / unmapped row flagged 'review manually'");
  const flagged = await ev(`return document.querySelectorAll("#ml-test [data-ml-scan-row][data-ml-flagged]").length`);
  ok(flagged >= 2, "unmapped rows (Cardivas + illegible) flagged for manual review, not auto-mapped");

  // 5) SECURITY: no raw JSON / provider / model text leaks into the review DOM
  ok(await ev(`var t=document.getElementById("ml-test").innerText; return !/[{}\\[\\]]|detected_text|confidence":|gemini|openai|gpt|provider|model|api\\/ai/i.test(t)`) === true, "no raw JSON keys / provider / model strings leak in review DOM");

  // 3) "Add selected" → include only the mapped high row + the medium (after mapping),
  //    exclude the illegible one → added with source 'scan' + carried confidence.
  //    First: exclude the low-confidence illegible row.
  await ev(`
    var rows = document.querySelectorAll("#ml-test [data-ml-scan-row]");
    // uncheck the last (low-confidence illegible) row
    var last = rows[rows.length-1].querySelector("input[type=checkbox]"); last.checked = false; last.dispatchEvent(new Event("change"));
    return 1;
  `);
  await ev(`document.querySelector("#ml-test [data-ml-scan-add]").click(); return 1;`);
  await sleep(100);
  const added = JSON.parse(await ev(`return JSON.stringify(MEDLIST.getList())`));
  ok(added.length === 2, "'Add selected' adds only the 2 checked rows (illegible excluded)");
  ok(added.every(m => m.source === "scan"), "added meds carry source='scan'");
  ok(added.some(m => m.generic === "amlodipine" && m.confidence === "high"), "high-confidence mapped row added with generic + confidence carried");
  // the medium row (Ecosprin -> aspirin candidate) — when the clinician leaves it as the
  // detected text WITHOUT confirming a generic, it must NOT be silently mapped.
  const mediumRow = added.find(m => m.generic !== "amlodipine");
  ok(mediumRow && mediumRow.confidence === "medium", "medium-confidence row added carrying confidence='medium'");

  // A row whose generic was never confirmed must NOT be silently mapped to a generic.
  ok(mediumRow && !mediumRow.generic, "unconfirmed medium row NOT silently mapped to a generic");

  // Confidence badge shows on the med card for source==='scan'
  await ev(`MEDLIST.mount(document.getElementById("ml-test")); return 1;`);
  ok(await ev(`return /medium|high/i.test(document.getElementById("ml-test").innerText)`) === true, "scan confidence surfaced on med cards");

  await ev(`MEDLIST.scanExtract = window.__origScan; MEDLIST.clearAll(); return 1;`);

  console.log(fails === 0 ? "\nALL GREEN — medlist scan test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
