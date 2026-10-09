/* PrepNucleus explanations in the REAL runner (headless Chrome over CDP). Items come from the synthetic fixture
 * test/fixtures/prep-explain/items.json (or ITEMS=<file>, e.g. a gitignored pilot result from tools/prep-explain.mjs)
 * and run as a practice set through PREP._host.run. Each one is answered wrong (to show "Your pick") and checked:
 * an item with x shows the key line, the topic notes, why the others are wrong and the Remember box, never "No
 * explanation is stored"; old "*" bullets render as a list; a table scrolls inside its frame and the page never scrolls
 * sideways; no uncaught PrepNucleus error.
 *
 * USAGE: CHROME=<path> node test/run-prep-explain-ui.mjs
 *   SHOTS=<dir>             screenshots: explain-<size>-<theme>-<n>.png (the viewport at the feedback) and -full.png
 *   SIZES=ipad,phone        which of iPad 820x1180 and phone 390x844 (default both); THEMES=light,dark (default both)
 *   ONLY=<n>                screenshot only the first n items per size and theme (checks still run on every item)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-explain-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep/";
const ITEMS = JSON.parse(fs.readFileSync(process.env.ITEMS ? resolve(process.env.ITEMS) : join(HERE, "fixtures", "prep-explain", "items.json"), "utf8")).items;
const SYNTH = !process.env.ITEMS;
const SIZES = { ipad: { width: 820, height: 1180, mobile: true }, phone: { width: 390, height: 844, mobile: true } };
const sizes = (process.env.SIZES || "ipad,phone").split(",").filter((s) => SIZES[s]);
const themes = (process.env.THEMES || "light,dark").split(",");
const ONLY = process.env.ONLY ? Number(process.env.ONLY) : Infinity;

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8994"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(120); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const finishAnims = `document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`;
async function capture(name, full) {
  if (!process.env.SHOTS) return;
  await sleep(120); await ev(finishAnims);
  let r;
  if (full) {
    // the whole runner body, as tall as its content, at the same width
    const h = await ev(`var b=document.querySelector("#smdPrep .pn-body"); return Math.ceil(b.scrollHeight + b.getBoundingClientRect().top + 24);`);
    const vp = await ev(`return [innerWidth, innerHeight];`);
    await call("Emulation.setDeviceMetricsOverride", { width: vp[0], height: Math.max(vp[1], h), deviceScaleFactor: 2, mobile: true });
    await sleep(200); await ev(`var b=document.querySelector("#smdPrep .pn-body"); b.scrollTop=0; return 1;`); await ev(finishAnims);
    r = await call("Page.captureScreenshot", { format: "png" });
    await call("Emulation.setDeviceMetricsOverride", { width: vp[0], height: vp[1], deviceScaleFactor: 2, mobile: true });
  } else r = await call("Page.captureScreenshot", { format: "png" });
  if (r.result) fs.writeFileSync(join(process.env.SHOTS, name + ".png"), Buffer.from(r.result.data, "base64"));
}

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE }); await until(`return !!window.PREP;`, 30000);
  await ev(`try{localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1");}catch(e){} indexedDB.deleteDatabase("prep-bank"); return 1;`);

  for (const size of sizes) {
    for (const theme of themes) {
      await call("Emulation.setDeviceMetricsOverride", { ...SIZES[size], deviceScaleFactor: 2 });
      await call("Page.navigate", { url: BASE + "?prep=1" }); await until(`return !!(window.PREP && window.SMD_showHome);`, 30000); await ev(clean);
      await ev(theme === "dark" ? `document.body.classList.add("dark"); return 1;` : `document.body.classList.remove("dark"); return 1;`);
      await ev(`PREP.open(); return 1;`);
      ok(await until(`return !!(PREP._host && document.querySelector("#smdPrep .pn-body"));`, 20000), `${size} ${theme}: PrepNucleus opens`);
      for (let i = 0; i < ITEMS.length; i++) {
        const it = ITEMS[i], tag = `${size} ${theme} #${i + 1}`;
        await ev(`localStorage.removeItem("smd_prep_v1"); PREP._host.run([${JSON.stringify(it)}], "study", "Explanations"); return 1;`);
        if (!await until(`return !!document.querySelector("#smdPrep .pn-opt[data-k='0']");`, 5000)) { ok(false, tag + ": the question shows"); continue; }
        const wrong = (it.a + 1) % it.o.length;
        await ev(`document.querySelector("#smdPrep .pn-opt[data-k='${wrong}']").click(); return 1;`);
        ok(await until(`return !!document.querySelector("#smdPrep .pn-fb");`, 4000), tag + ": the answer shows its feedback");
        const s = JSON.parse(await ev(`var f=document.querySelector("#smdPrep .pn-fb"), b=document.querySelector("#smdPrep .pn-body"), wide=[];
          document.querySelectorAll("#smdPrep .pn-fb *").forEach(function(e){ var r=e.getBoundingClientRect(); if(r.width && r.right>innerWidth+1 && !e.closest(".pn-xt")) wide.push(e.tagName+"."+e.className); });
          return JSON.stringify({ txt: f.textContent, key: !!f.querySelector(".pn-xkey"), notes: !!f.querySelector(".pn-xnotes"), heads: f.querySelectorAll(".pn-xh").length, tables: f.querySelectorAll(".pn-xt table").length,
            tblFit: Array.from(f.querySelectorAll(".pn-xt")).every(function(x){ return x.getBoundingClientRect().right <= innerWidth + 1; }),
            why: f.querySelectorAll(".pn-why li").length, mine: !!f.querySelector(".pn-why li.mine"), pearl: (f.querySelector(".pn-kp b")||{}).textContent||"", legacyLi: f.querySelectorAll(".pn-exp li").length,
            star: /(^|\\s)\\*\\S/.test(f.textContent), raw: /<[a-z]|\\*\\*|^#|\\n#/.test(f.innerText), pageX: b.scrollWidth > b.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1, wide: wide.slice(0, 3) });`));
        const hasX = !!(it.x && it.x.key);
        if (hasX) ok(s.key && s.notes && !/No explanation is stored/.test(s.txt) && s.why === it.o.length - 1 && s.mine && s.pearl === "Remember", tag + ": key line, notes, " + s.why + " reasons (your pick marked), Remember box, no 'not stored' line");
        else if (String(it.exp || "").trim()) ok(!s.star && !/No explanation is stored/.test(s.txt), tag + ": the stored explanation shows without stray asterisks" + (s.legacyLi ? " (" + s.legacyLi + " bullets)" : ""));
        else ok(/No explanation is stored|Explanation coming soon/.test(s.txt), tag + ": an item with nothing says so");
        ok(!s.raw, tag + ": no raw Markdown or HTML leaks into the text");
        ok(!s.pageX && !s.wide.length && s.tblFit, tag + ": nothing scrolls the page sideways" + (s.wide.length ? " " + s.wide.join(",") : ""));
        if (SYNTH && i === 0) ok(s.heads === 3 && s.tables === 1, tag + ": three headings and the comparison table render");
        if (SYNTH && i === 1) ok(s.legacyLi === 3, tag + ": old '*' bullets render as a 3-item list");
        if (it.img && it.img.length) {
          const fg = JSON.parse(await ev(`var f=document.querySelector("#smdPrep .pn-fb"), xi=f.querySelector(".pn-xfig img"), si=document.querySelector("#smdPrep .pn-qw > .pn-yq-fig img"), o=document.querySelector("#smdPrep .pn-opts");
            return JSON.stringify({ exp: !!xi, stem: !!si, src: (xi||si||{}).getAttribute ? (xi||si).getAttribute("src") : "", stemBeforeOpts: !!(si && (si.closest("figure").compareDocumentPosition(o) & 4)) });`));
          if (it.imgPlace === "exp") ok(fg.exp && !fg.stem && /\/img\/fx-explain-fig\.webp$/.test(fg.src), tag + ": imgPlace exp: the image sits in the feedback card, not by the stem " + fg.src);
          else ok(fg.stem && !fg.exp && fg.stemBeforeOpts, tag + ": imgPlace stem: the image sits between the stem and the options");
          ok(await until(`var i=document.querySelector("#smdPrep .pn-yq-fig img"); return !!(i && i.complete && i.naturalWidth > 0);`, 5000), tag + ": the bank image loads from <VER>/img/");
          await ev(`document.querySelector("#smdPrep .pn-yq-fig [data-act=y-zoom]").click(); return 1;`);
          ok(await until(`var z=document.querySelector(".pv .pv-img"); return !!z && z.getAttribute("src")===${JSON.stringify(fg.src)};`, 3000), tag + ": tap enlarges the same image (shared viewer)");
          await ev(`PREP.back(); return 1;`);
        }
        if (SYNTH && i === 0 && size === "phone") {
          const sc = JSON.parse(await ev(`var x=document.querySelector("#smdPrep .pn-xt"); return JSON.stringify({ sw: x.scrollWidth, cw: x.clientWidth, ov: getComputedStyle(x).overflowX, sticky: getComputedStyle(x.querySelector("tbody th")).position, role: x.getAttribute("role"), tab: x.tabIndex });`));
          ok(sc.sw > sc.cw && sc.ov === "auto" && sc.sticky === "sticky" && sc.role === "region" && sc.tab === 0, "phone: the wide table scrolls inside its own focusable frame with the first column pinned " + JSON.stringify(sc));
        }
        if (i < ONLY) {
          const name = `explain-${size}-${theme}-${String(i + 1).padStart(2, "0")}`;
          await ev(`var f=document.querySelector("#smdPrep .pn-fb"), b=document.querySelector("#smdPrep .pn-body"); b.scrollTop += f.getBoundingClientRect().top - b.getBoundingClientRect().top - 12; return 1;`);
          await capture(name, false);
          await capture(name + "-full", true);
        }
        await ev(`PREP.back(); return 1;`);
      }
    }
  }
  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.join(" | ").slice(0, 400) : ""));
} catch (e) {
  console.log("FAIL harness: " + (e && e.stack || e)); fails++;
} finally {
  try { chrome.kill("SIGKILL"); } catch {}
  try { if (serveProc) serveProc.kill(); } catch {}
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
