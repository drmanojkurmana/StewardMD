/* Report-reason sheet in the REAL lesson reader (Playwright WebKit, iPhone 15 profile at
 * 390x844, light and dark): the foot Report button opens the "What is wrong?" bottom sheet with
 * the seven single-choice reasons; Send with no reason shows an inline error and moves focus to
 * it; Other with an empty note is refused; a reasoned report POSTs { itemId, itemType, reason,
 * text, appVersion } to the existing /api/prep/flag path and shows the success confirmation;
 * with the network down the report queues in localStorage and flushQueue() sends it later.
 * USAGE: node test/run-prep-report-sheet-ui.mjs   (PLAYWRIGHT_CORE=...; SHOTS=<dir> saves shots)
 */
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FIX = "/test/fixtures/prep-lessons/";
const MID = "sur-breast-cancer";
const SHOTS = process.env.SHOTS || "";

async function loadPW() {
  const tries = [];
  if (process.env.PLAYWRIGHT_CORE) tries.push(process.env.PLAYWRIGHT_CORE);
  tries.push(join(HERE, "..", "node_modules", "playwright-core"));
  const npx = join(os.homedir(), ".npm", "_npx");
  try { for (const d of fs.readdirSync(npx)) tries.push(join(npx, d, "node_modules", "playwright-core")); } catch {}
  for (const p of tries) {
    if (!fs.existsSync(join(p, "index.mjs"))) continue;
    const pw = await import(pathToFileURL(join(p, "index.mjs")).href);
    try { const exe = pw.webkit.executablePath(); if (exe && fs.existsSync(exe)) return pw; } catch {}
  }
  return null;
}
const pw = await loadPW();
if (!pw) { console.log("SKIP no playwright-core with an installed WebKit (set PLAYWRIGHT_CORE)"); process.exit(0); }

const ORIGIN = "https://prep.test";
const BASE = ORIGIN + "/";
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".gz": "application/gzip", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
function serveFile(route) {
  let p = decodeURIComponent(new URL(route.request().url()).pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = join(ROOT, p.replace(/^\/+/, ""));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: "" });
  const ext = (f.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
  return route.fulfill({ status: 200, contentType: TYPES[ext] || "application/octet-stream", body: fs.readFileSync(f) });
}

let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const errors = [];
const posted = [];
let offline = false;
let browser;
try {
  browser = await pw.webkit.launch();
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ ...pw.devices["iPhone 15"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { if (/prep|PREP/.test(String((e && (e.stack || e.message)) || ""))) errors.push(String(e.message || e)); });
    await page.route(/^https:\/\/prep\.test\//, serveFile);
    await page.route(/^https:\/\/prep\.test\/api\/prep\/flag/, (r) => {
      if (offline) return r.abort("failed");
      try { posted.push(JSON.parse(r.request().postData() || "{}")); } catch {}
      return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });
    await page.addInitScript(`window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.SMD_APP_VERSION="sheet-test"; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;
      try{ localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1"); localStorage.removeItem("smd-report-queue-v1"); }catch(e){}`);
    await page.goto(BASE + "?prep=1");
    await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
    await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); });
    await page.evaluate(() => document.body.classList.toggle("dark", false));
    if (theme === "dark") await page.evaluate(() => document.body.classList.add("dark"));
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const until = async (fn, ms = 10000, arg) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };

    await ev((m) => window.PREP.open({ subject: "surgery" }), MID);
    ok(await until((m) => !!document.querySelector("#smdPrep .pn-mod[data-m='" + m + "']"), 20000, MID), theme + ": surgery lists the breast cancer module");
    await ev((m) => document.querySelector("#smdPrep .pn-mod[data-m='" + m + "']").click(), MID);
    ok(await until(() => !!document.querySelector("#smdPrep [data-act=l-open]"), 8000), theme + ": module screen shows a Lesson row");
    await ev(() => document.querySelector("#smdPrep [data-act=l-open]").click());
    ok(await until(() => !!document.querySelector("#smdPrep #pnLsn"), 8000), theme + ": lesson reader opens");
    ok(await until(() => !!document.querySelector("#smdPrep #pnLsn [data-action-report]"), 8000), theme + ": lesson foot shows a Report button");

    // Tapping Report opens the bottom sheet with the seven reasons.
    await ev(() => document.querySelector("#smdPrep #pnLsn [data-action-report]").click());
    ok(await until(() => !!document.querySelector(".pn-rpt-sheet [role=dialog]") || !!document.querySelector(".pn-rpt-sheet"), 5000), theme + ": Report opens the What-is-wrong sheet");
    ok(await ev(() => (document.querySelector(".pn-rpt-sheet") || { textContent: "" }).textContent.includes("What is wrong?")), theme + ": sheet asks What is wrong?");
    ok(await ev(() => document.querySelectorAll(".pn-rpt-sheet input[name=pn-rpt-reason]").length) === 7, theme + ": seven single-choice reasons");
    ok(await ev(() => { const r = document.querySelector(".pn-rpt-sheet").getBoundingClientRect(); return r.top > innerHeight * 0.3 && r.bottom <= innerHeight + 1; }) === true, theme + ": sheet docks to the bottom at 390px");
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "report-sheet-" + theme + ".png") });

    // Send with no reason: inline error, focus moves to it, nothing posts.
    const n0 = posted.length;
    await ev(() => document.querySelector(".pn-rpt-sheet .pn-rpt-send").click());
    ok(await until(() => { const e = document.querySelector(".pn-rpt-sheet .pn-rpt-err"); return !!e && !e.hidden; }, 5000), theme + ": empty Send shows the inline error");
    ok(await ev(() => document.activeElement === document.querySelector(".pn-rpt-sheet .pn-rpt-err")), theme + ": focus moves to the error");
    ok(posted.length === n0, theme + ": invalid report never posts");

    // Other with an empty note is refused; with a note it posts the full payload.
    await ev(() => { const o = document.querySelector(".pn-rpt-sheet input[value=other]"); o.checked = true; document.querySelector(".pn-rpt-sheet .pn-rpt-send").click(); });
    ok(await until(() => /short note/.test(document.querySelector(".pn-rpt-sheet .pn-rpt-err").textContent), 5000), theme + ": Other needs its note");
    await ev(() => { const t = document.querySelector(".pn-rpt-sheet .pn-rpt-text"); t.value = "The dose on line 2 is outdated."; t.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector(".pn-rpt-sheet input[value=wrong-fact]").checked = true; document.querySelector(".pn-rpt-sheet .pn-rpt-send").click(); });
    ok(await until(() => { const d = document.querySelector(".pn-rpt-sheet .pn-rpt-done"); return !!d && !d.hidden; }, 8000), theme + ": success confirmation shows");
    ok(await ev(() => /Thank you\. Report received\./.test(document.querySelector(".pn-rpt-sheet").textContent)), theme + ": confirmation copy thanks the student");
    const p = posted[posted.length - 1] || {};
    ok(p.itemType === "lesson" && p.reason === "wrong-fact" && p.text === "The dose on line 2 is outdated." && typeof p.itemId === "string" && p.itemId.length > 0 && typeof p.appVersion === "string" && p.appVersion.length > 0, theme + ": payload carries id, type, reason, text, app version via /api/prep/flag");
    ok(await ev(() => { try { const s = JSON.parse(localStorage.getItem("smd_prep_v1")); return !!(s && s.lprep && Object.keys(s.lprep).length); } catch (e) { return false; } }) === true, theme + ": reported lesson persists in the lesson store");
    await ev(() => document.querySelector(".pn-rpt-sheet [data-rpt-close]").click());
    ok(await until(() => !document.querySelector(".pn-rpt-sheet"), 5000), theme + ": Done closes the sheet");

    // Offline: the report queues, then flushQueue() sends it on reconnect.
    offline = true;
    await ev(() => document.querySelector("#smdPrep #pnLsn [data-action-report]").click());
    await until(() => !!document.querySelector(".pn-rpt-sheet"), 5000);
    await ev(() => { document.querySelector(".pn-rpt-sheet input[value=typo]").checked = true; document.querySelector(".pn-rpt-sheet .pn-rpt-send").click(); });
    ok(await until(() => { const d = document.querySelector(".pn-rpt-sheet .pn-rpt-done"); return !!d && !d.hidden; }, 8000), theme + ": offline Send still confirms");
    ok(await ev(() => { try { return (JSON.parse(localStorage.getItem("smd-report-queue-v1") || "[]")).length; } catch (e) { return -1; } }) === 1, theme + ": offline report queues in localStorage");
    offline = false;
    ok(await ev(async () => window.PREP_ACTION && (await window.PREP_ACTION.flushQueue()) === 1) === true, theme + ": flushQueue retries the queued report");
    ok(await ev(() => { try { return (JSON.parse(localStorage.getItem("smd-report-queue-v1") || "[]")).length; } catch (e) { return -1; } }) === 0, theme + ": queue drains after retry");
    await ctx.close();
  }
} catch (e) { console.log("FAIL harness: " + String((e && e.message) || e).slice(0, 300)); fails++; }
try { if (browser) await browser.close(); } catch {}
ok(errors.length === 0, "no uncaught PrepNucleus errors" + (errors.length ? ": " + errors[0].slice(0, 160) : ""));
console.log(fails ? "\n" + fails + " FAILURES" : "\nALL REPORT-SHEET PASS");
process.exit(fails ? 1 : 0);
