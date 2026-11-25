/* PrepNucleus Ask MaiK answers medical study questions only (owner 2026-11-19: it answered "Who is indias pm").
 * Real app in headless Chromium on the fixture bank: a non-medical question is refused in the app with the scope line,
 * nothing reaches /api/ai/prep-teach; a medical follow-up still goes to the server.
 * USAGE: node test/run-prep-ask-scope-ui.mjs   (SHOTS=<dir> saves a screenshot)
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { freePort } from "./free-port.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)("playwright");
const PORT = await freePort(), BASE = `http://localhost:${PORT}/`, FIX = "/test/fixtures/prep/";
const serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const reqs = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  await ctx.route("**/api/ai/prep-teach*", async (r) => {
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch {}
    reqs.push(b);
    const last = b.messages ? b.messages[b.messages.length - 1].t : "";
    await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "Medical answer to: " + last, usage: { mt: 40 } }) });
  });
  const pg = await ctx.newPage(); pg.on("pageerror", (e) => { if (/prep|PREP/.test(e.stack || e.message)) { console.log("PAGEERR " + e.message); fails++; } });
  await pg.addInitScript(`window.SMD_PREP_SETUP=false; window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;`);
  await pg.goto(BASE + "?prep=1"); await pg.waitForFunction(() => !!(window.PREP && window.SMD_showHome && window.MaiKScope), null, { timeout: 30000 });
  await pg.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); window.SMD_AUTH = { currentUser: { uid: "s1", getIdToken: () => Promise.resolve("tok-1") } }; PREP.open(); });
  await pg.waitForFunction(() => !!document.querySelector("#smdPrep .pn-home") && !!window.PREP_ASK, null, { timeout: 20000 });
  await pg.evaluate(() => { try { localStorage.removeItem("smd_prep_ask_v1"); } catch (e) {} PREP_ASK._resetThreads(); const s = PREP._host.store(); s.ask = { m: "online", q: 1 }; PREP._host.save(); });
  const jc = async (s) => { await pg.waitForSelector(s, { state: "attached", timeout: 10000 }); await pg.evaluate((s) => document.querySelector(s).click(), s); };
  await jc("#smdPrep .pn-tile[data-s=anatomy]"); await jc("#smdPrep .pn-mod[data-m=ana-gametogenesis]"); await jc("#smdPrep [data-act=start][data-k=study]");
  await pg.waitForSelector("#smdPrep .pn-q");
  await pg.evaluate(() => { const r = PREP._st.run, it = r.items[r.i]; document.querySelector('#smdPrep .pn-opt[data-k="' + ((it.a + 1) % 4) + '"]').click(); });
  await jc("#smdPrep .pn-fb [data-act=ask]");
  await pg.waitForSelector("#paIn", { timeout: 8000 });
  const send = (t) => pg.evaluate((t) => { const x = document.getElementById("paIn"); x.focus(); x.value = t; x.dispatchEvent(new Event("input", { bubbles: true })); x.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); }, t);
  const n0 = reqs.length;
  await send("Who is indias pm"); await sleep(700);
  const off = await pg.evaluate(() => { const l = document.querySelectorAll("#pnAsk .pt-msg.ai .pa-txt"); return { last: l.length ? l[l.length - 1].textContent : "", note: (document.querySelector("#pnAsk .pa-last") || {}).textContent || "" }; });
  ok(/only help with medical and exam study questions/.test(off.last) && reqs.length === n0, "a non-medical question is refused in the app, nothing sent (" + (reqs.length - n0) + " requests): " + off.last.slice(0, 60));
  ok(!/MaiK Tokens/.test(off.note), "the refusal costs no MaiK Tokens");
  if (process.env.SHOTS) await pg.screenshot({ path: join(process.env.SHOTS, "ask-offtopic.png") });
  await send("Why not B?"); await sleep(900);
  const on = await pg.evaluate(() => { const l = document.querySelectorAll("#pnAsk .pt-msg.ai .pa-txt"); return l.length ? l[l.length - 1].textContent : ""; });
  ok(reqs.length === n0 + 1 && /Medical answer to: Why not B\?/.test(on), "a medical follow-up still goes online and is answered");
} catch (e) { console.log("FAIL " + (e && e.stack || e)); fails++; }
await browser.close(); serve.kill();
console.log(fails ? "FAILED " + fails : "ALL PASS");
process.exit(fails ? 1 : 0);
