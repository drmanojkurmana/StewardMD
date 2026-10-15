/* NEET-SS group flow (owner 2026-10-14) in the REAL app, Playwright Chromium, against a generated bank
 * (2 medical + 2 surgical + biostatistics SS subjects): first-time flow asks Step 1 who-you-are then Step 2
 * shortlist on separate pages; Home shows only the group with See-all on its own page; switching groups keeps
 * history. 390px and iPad widths, dark and light (SHOTS=<dir> saves screenshots).
 * USAGE: node test/run-neetss-flow-ui.mjs   (VP=390x844|820x1180, PN_LIGHT=1, CHROME=, ENGINES=)
 */
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.SHOTS || "";
const VP = (process.env.VP || "390x844").split("x").map(Number);
const DARK = !process.env.PN_LIGHT;
const TAG = VP[0] + "-" + (DARK ? "dark" : "light");
const DASH = new RegExp("[" + String.fromCharCode(8211, 8212) + "]");

async function loadPW() {
  const tries = [join(HERE, "..", "node_modules", "playwright-core")];
  try { for (const d of fs.readdirSync(join(process.env.HOME || "/root", ".npm", "_npx"))) tries.push(join(process.env.HOME || "/root", ".npm", "_npx", d, "node_modules", "playwright-core")); } catch {}
  if (process.env.PLAYWRIGHT_CORE) tries.unshift(process.env.PLAYWRIGHT_CORE);
  for (const p of tries) {
    if (!fs.existsSync(join(p, "index.mjs"))) continue;
    const pw = await import(pathToFileURL(join(p, "index.mjs")).href);
    try { const exe = pw.chromium.executablePath(); if (exe && fs.existsSync(exe)) return pw; } catch {}
  }
  return null;
}
const pw = await loadPW();
if (!pw) { console.log("SKIP no playwright-core with an installed Chromium"); process.exit(0); }

const ORIGIN = "https://neetss.test", BASE = ORIGIN + "/", ROOT = join(HERE, ".."), FIX = "/nsfix/";
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
function serveFile(route) {
  let p = decodeURIComponent(new URL(route.request().url()).pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = join(ROOT, p.replace(/^\/+/, ""));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: "" });
  const ext = (f.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
  return route.fulfill({ status: 200, contentType: TYPES[ext] || "application/octet-stream", body: fs.readFileSync(f) });
}
/* ---- generated bank ---- */
const SS = ["ss-cardiology", "ss-neurology", "ss-urology", "ss-neurosurgery", "ss-biostatistics"];
const cap = (s) => s.replace(/^ss-/, "").split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const subj = (id, ex, branch) => ({ id, code: id.slice(0, 3), name: { en: cap(id) }, ex, sections: [{ id: id + "-s", name: { en: "Core" }, modules: [0, 1].map((k) => ({ id: id + "-m" + k, name: { en: cap(id) + " topic " + (k + 1) }, size: "m" })) }] });
const TAX = { v: 1, branches: [{ id: "mbbs", name: "MBBS", subjects: [subj("anatomy", ["neet-pg"], "mbbs")] }, { id: "ss-medicine", name: "SS", subjects: SS.map((s) => subj(s, ["neet-ss"])) }] };
const N = 8;
const index = (sid) => ({ id: sid, topics: [0, 1].map((k) => ({ id: sid + "-m" + k, title: { en: cap(sid) + " topic " + (k + 1) }, group: sid + "-s", count: N, all: N, usmle: 0, file: "mcq/" + sid + "-m" + k + ".json", size: "m" })), counts: { total: 2 * N } });
function serveFix(route) {
  const p = new URL(route.request().url()).pathname.slice(FIX.length);
  let m;
  if (p === "taxonomy.json") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TAX) });
  if ((m = /^bank\/v1\/([a-z-]+)\/index\.json$/.exec(p))) {
    if (m[1] !== "anatomy" && !SS.includes(m[1])) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(index(m[1])) });
  }
  if (p === "hidden.json") return route.fulfill({ status: 200, contentType: "application/json", body: '{"ids":[]}' });
  return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
}

let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// CHROME= picks a binary; on this Mac the registry headless shell segfaults, so the full
// Chromium binary is preferred when present; otherwise the registry default (CI installs it).
import os from "node:os";
const FULL = join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const launchOpts = process.env.CHROME ? { executablePath: process.env.CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] }
  : fs.existsSync(FULL) ? { executablePath: FULL, args: ["--no-sandbox", "--disable-dev-shm-usage"] }
  : { args: ["--no-sandbox", "--disable-dev-shm-usage"] };
const browser = await pw.chromium.launch(launchOpts);
const ctx = await browser.newContext({ viewport: { width: VP[0], height: VP[1] }, deviceScaleFactor: 2, isMobile: VP[0] < 700, hasTouch: true, serviceWorkers: "block" });
const page = await ctx.newPage();
const errors = [], reqs = [];
page.on("pageerror", (e) => { if (/prep|PREP/i.test(String((e && (e.stack || e.message)) || ""))) errors.push(String(e.message || e)); });
page.on("request", (r) => reqs.push(r.url()));
await page.route(/^https:\/\/neetss\.test\/nsfix\//, serveFix);
await page.route(/^https:\/\/neetss\.test\//, serveFile);
await page.addInitScript(`window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.SMD_PREP_OVERLAYS={};
  window.confirm=function(){return true;}; try{localStorage.setItem("smd_prep","1");if(!sessionStorage.getItem("nsfix-boot")){sessionStorage.setItem("nsfix-boot","1");["smd_prep_v1","smd_prep_setup","smd_prep_tt"].forEach(function(k){localStorage.removeItem(k);});}}catch(e){}`);
await page.goto(BASE);
await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); });
await page.evaluate((dark) => document.body.classList.toggle("dark", !!dark), DARK);
const until = async (fn, ms = 15000) => { try { await page.waitForFunction(fn, null, { timeout: ms }); return true; } catch { return false; } };
const ev = (fn, arg) => page.evaluate(fn, arg);
const tap = (sel) => page.evaluate((s) => { const b = document.querySelector(s); if (!b) return false; b.click(); return true; }, sel);
const txt = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; }, sel);
async function shot(name) { if (!SHOTS) return; await sleep(400); await page.screenshot({ path: join(SHOTS, "neetss-" + name + "-" + TAG + ".png") }); }
const tiles = () => page.evaluate(() => [].map.call(document.querySelectorAll("#pnGrid .pn-tile"), (b) => b.getAttribute("data-s")).join(","));
const noXScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
  // ---- first-time flow: exam -> Step 1 -> Step 2, each on its own page
  await ev(() => PREP.open());
  ok(await until(() => !!document.querySelector("#smdPrep .pl-q")), "first open shows onboarding");
  console.log("DIAG smdPrep: " + await ev(() => { const r = document.querySelector("#smdPrep"); return (r ? r.textContent : "(no #smdPrep)").replace(/\s+/g, " ").trim().slice(0, 300); }));
  ok((await txt("#smdPrep .pl-q") || "").includes("Which exam"), "exam step first");
  await tap('#smdPrep [data-act=p-f-exam][data-v="neet-ss"]');
  ok(await until(() => /who you are/.test(document.querySelector("#smdPrep .pl-ob").textContent)), "NEET-SS names what is next, no long group scroll");
  ok(await ev(() => !document.querySelector('#smdPrep [data-act="p-f-group"]')), "exam step has no inline group list");
  await tap("#smdPrep [data-act=p-ob-next]");
  ok(await until(() => /Who are you/.test(document.querySelector("#smdPrep .pl-q").textContent)), "Step 1 on its own page");
  const cards = await ev(() => Array.from(document.querySelectorAll('#smdPrep [data-act="p-f-group"]')).map((b) => b.textContent.replace(/\s+/g, " ").trim()).join(" | "));
  ok((cards.match(/data-v/g) || []).length === 0 && cards.split(" | ").length === 15, "Step 1 offers the fifteen feeder groups: " + cards.split(" | ").length);
  ok(/Radiodiagnosis/.test(cards) && /own paper/.test(cards), "radiodiagnosis and own-paper groups listed with degree and includes lines");
  ok(await ev(() => document.querySelectorAll('#smdPrep [role="radio"][aria-checked="true"]').length) === 0, "nothing preselected");
  ok(await ev(() => document.querySelector("#smdPrep [data-act=p-ob-next]").disabled) === true, "Step 1 Continue waits for a pick");
  await shot("step1");
  await tap('#smdPrep [data-act="p-f-group"][data-v="surgical"]');
  ok(await ev(() => document.querySelector('#smdPrep [data-act="p-f-group"][data-v="surgical"]').getAttribute("aria-checked")) === "true", "surgical card selects");
  await tap("#smdPrep [data-act=p-ob-next]");
  ok(await until(() => /Pick your super-specialty/.test(document.querySelector("#smdPrep .pl-q").textContent)), "Step 2 on its own page");
  ok(await until(() => /MCQs/.test(document.querySelector("#smdPrep .pl-ob").textContent), 20000), "Step 2 fills module and MCQ counts");
  const spec = await txt("#smdPrep .pl-ob");
  ok(/Surgical group: only these subjects/.test(spec), "Step 2 names the group scope");
  ok(/All Surgical subjects/.test(spec) && /Mixed/.test(spec), "All-subjects mixed row first");
  ok(/Urology/.test(spec) && /Neurosurgery/.test(spec) && /Biostatistics/.test(spec), "only the surgical shortlist");
  ok(!/Cardiology/.test(spec), "no medical subjects for a surgical student");
  ok(await ev(() => !!document.querySelector('#smdPrep [data-act="p-f-who"]')), "visible Change group control");
  ok(await ev(() => !new RegExp("[" + String.fromCharCode(8211, 8212) + "]").test(document.getElementById("smdPrep").innerText)), "no en or em dash on Step 2");
  await shot("step2");
  // Change group goes back to Step 1 with the pick kept.
  await tap('#smdPrep [data-act="p-f-who"]');
  ok(await until(() => /Who are you/.test(document.querySelector("#smdPrep .pl-q").textContent)), "Change group returns to Step 1");
  ok(await ev(() => document.querySelector('#smdPrep [data-act="p-f-group"][data-v="surgical"]').getAttribute("aria-checked")) === "true", "pick kept");
  await tap("#smdPrep [data-act=p-ob-next]");
  ok(await until(() => /Pick your super-specialty/.test(document.querySelector("#smdPrep .pl-q").textContent)), "forward to Step 2 again");
  await tap("#smdPrep [data-act=p-ob-next]");
  ok(await until(() => /When is your exam/.test(document.querySelector("#smdPrep .pl-q").textContent)), "Continue reaches the date step");
  // Skip the rest: the exam and group stay remembered.
  await tap("#smdPrep [data-act=p-skip]"); await tap("#smdPrep [data-act=p-skip]"); await tap("#smdPrep [data-act=p-skip]");
  ok(await until(() => !!document.querySelector("#smdPrep #pnHome"), 20000), "skip lands on home");
  ok(await ev(() => JSON.parse(localStorage.getItem("smd_prep_v1")).pl.group) === "surgical", "group remembered in the store");

  // ---- home: only the group, mixed row, change control, see-all on its own page
  ok(await until(() => !!document.querySelector("#smdPrep #pnGrid .pn-tile"), 20000), "home tiles draw");
  const homeTiles = await tiles();
  ok(/ss-urology/.test(homeTiles) && /ss-neurosurgery/.test(homeTiles) && /ss-biostatistics/.test(homeTiles), "home shows the surgical shortlist: " + homeTiles);
  ok(!/ss-cardiology/.test(homeTiles) && !/ss-neurology/.test(homeTiles), "no long scroll of every subject");
  const scopeLine = await txt("#smdPrep .pn-small");
  ok(/Surgical group/.test(await page.evaluate(() => document.querySelector("#smdPrep #pnHome").textContent)) && await ev(() => !!document.querySelector('#smdPrep [data-act="p-settings"].pn-link, #smdPrep .pn-small [data-act="p-settings"]')), "group named with a Change group control");
  ok(await ev(() => !!document.querySelector('#smdPrep [data-act="ss-mixed"]')) && /All Surgical subjects/.test(await txt('#smdPrep [data-act="ss-mixed"]')), "mixed row first");
  ok(await ev(() => !!document.querySelector('#smdPrep [data-act="ss-all"]')), "See all subjects control");
  ok(await noXScroll(), "no horizontal scroll on home at " + VP[0] + "px");
  await shot("home");
  // See all subjects opens the full list on its own page, not inline.
  await tap('#smdPrep [data-act="ss-all"]');
  ok(await until(() => !!document.querySelector('#smdPrep .pn-tile[data-s="ss-cardiology"]') && document.querySelectorAll("#smdPrep #pnGrid .pn-tile").length === 5, 20000), "full list page holds every subject");
  ok(await ev(() => !document.querySelector("#smdPrep #pnHome")), "full list is its own page, not inline");
  await ev(() => PREP.back());
  ok(await until(() => !!document.querySelector("#smdPrep #pnHome") && !!document.querySelector('#smdPrep [data-act="ss-all"]')), "back returns to the scoped home");
  // Mixed row prefills the custom module with the group.
  await tap('#smdPrep [data-act="ss-mixed"]');
  ok(await until(() => /Custom module/.test(document.body.textContent) && !!document.querySelector('#smdPrep [data-act="cmsub"]'), 20000), "custom module opens prefilled");
  const chips = await ev(() => Array.from(document.querySelectorAll('#smdPrep [data-act="cmsub"]')).map((b) => b.getAttribute("data-v") + ":" + b.getAttribute("aria-pressed")).join(","));
  ok(/ss-urology:1/.test(chips) || /ss-urology:true/.test(chips), "group subjects preselected: " + chips);
  ok(!/ss-cardiology/.test(chips), "no out-of-group chips");
  await ev(() => PREP.back());

  // ---- switching group keeps history, bookmarks and confidence
  // Seed through a reload: the app caches the store in memory, so a direct
  // localStorage write would be overwritten by the next in-app save.
  await ev(() => { const s = JSON.parse(localStorage.getItem("smd_prep_v1")); s.bm = { "seed-q1": ["ss-urology", "ss-urology-m0"] }; s.mod = { "ss-urology-m0": { t: 4, ok: 3 } }; localStorage.setItem("smd_prep_v1", JSON.stringify(s)); return 1; });
  await page.reload();
  await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
  await ev(() => PREP.open());
  ok(await until(() => !!document.querySelector("#smdPrep #pnHome"), 20000), "seeded store reopens on home");
  await tap('#smdPrep [data-act="p-settings"]');
  ok(await until(() => !!document.querySelector("#pnPlanSheet"), 10000), "settings sheet opens");
  await tap('#pnPlanSheet [data-act="p-f-group"][data-v="medical"]');
  await tap('#pnPlanSheet [data-act="p-save"]');
  ok(await until(() => !!document.querySelector("#smdPrep #pnHome"), 10000), "save returns home");
  ok(await ev(() => { const s = JSON.parse(localStorage.getItem("smd_prep_v1")); const m = (s.mod || {})["ss-urology-m0"] || {}; return s.pl.group + "|" + Object.keys(s.bm || {}).length + "|" + m.t + "|" + m.ok; }) === "medical|1|4|3", "group switched, history kept");
  ok(await until(() => !!(document.querySelector('#smdPrep #pnGrid .pn-tile[data-s="ss-cardiology"]') && !document.querySelector('#smdPrep #pnGrid .pn-tile[data-s="ss-urology"]')), 20000), "home follows the new group");
  // Returning users land straight on their group's list.
  await page.reload();
  await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
  await ev(() => PREP.open());
  ok(await until(() => !!document.querySelector("#smdPrep #pnHome") && !document.querySelector("#smdPrep .pl-q"), 20000), "no onboarding twice");
  ok(await until(() => !!document.querySelector('#smdPrep #pnGrid .pn-tile[data-s="ss-cardiology"]'), 20000), "group list straight away");

  // ---- controls and hygiene
  const small = await ev(() => [].filter.call(document.querySelectorAll("#smdPrep .pl-opt, #smdPrep .pn-btn, #smdPrep [data-act=ss-mixed]"), (b) => b.offsetParent && b.getBoundingClientRect().height < 41).map((b) => (b.getAttribute("data-act") || b.className) + ":" + Math.round(b.getBoundingClientRect().height)).join(","));
  ok(!small, "new controls at least 44px: " + (small || "all pass"));
  ok(!reqs.some((u) => /\/api\/ai/.test(u)), "no AI calls");
  ok(errors.length === 0, "no PrepNucleus page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" // ") : ""));
} catch (e) {
  console.log("FAIL harness error: " + (e && e.message));
  fails++;
}
await browser.close();
console.log(fails ? "RESULT FAIL" : "RESULT PASS");
process.exit(fails ? 1 : 0);
