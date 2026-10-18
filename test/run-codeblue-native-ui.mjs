/* Code Blue native watch link in headless Chrome (Playwright, system Chrome).
 * Fake WatchBridge injected by the harness fixture before load.
 * USAGE: node test/run-codeblue-native-ui.mjs   SHOTS=<dir> saves PNGs */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const require = createRequire(import.meta.url);
let pw;
try { pw = require(process.env.PLAYWRIGHT || "playwright"); } catch (e) { pw = require(join(execSync("npm root -g").toString().trim(), "playwright")); }
const PORT = process.env.PORT || 0;
const BASE = process.env.BASE || "";
let serve = null;
if (process.env.BASE || process.env.USE_SERVER) {
  serve = spawn("node", [join(HERE, "serve.mjs"), ROOT, String(PORT)], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
const HARNESS_URL = process.env.BASE ? BASE + "test/fixtures/codeblue-native-harness.html" : "file://" + join(ROOT, "test/fixtures/codeblue-native-harness.html");

let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const SHOTS = process.env.SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--no-sandbox"] });

async function scenario(width, theme, tag) {
  const page = await browser.newPage({ viewport: { width, height: width >= 820 ? 1180 : 844 } });
  await page.goto(HARNESS_URL, { waitUntil: "load" });
  await page.evaluate((t) => { window.CodeBlueLive.open({ theme: t }); }, theme);
  await page.waitForTimeout(600);
  const joinVisible = await page.locator('[data-state="watch-join"]').isVisible().catch(() => false);
  ok(joinVisible, tag + ": join card visible with running watch state");
  const joinText = joinVisible ? await page.locator('[data-state="watch-join"]').innerText() : "";
  ok(/Watch code in progress/.test(joinText) && /Adult/.test(joinText) && /04:1/.test(joinText), tag + ": join card shows elapsed and mode (" + joinText.replace(/\n/g, " ") + ")");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `cb-native-join-${tag}.png`) });
  await page.locator('[data-act="watch-join"]').click();
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => window.CodeBlueLive._rt.view() === "running"), tag + ": Join seeds running session");
  ok(await page.evaluate(() => window.CodeBlueLive._rt.watchJoined() === true), tag + ": joined flag set");
  const elapsed = await page.evaluate(() => window.CodeBlueLive._rt.elapsed());
  ok(elapsed >= 250 && elapsed < 270, tag + ": clock seeded near 04:12 (" + Math.round(elapsed) + "s)");
  const counts = await page.evaluate(() => { const s = window.CodeBlueLive._rt.session(); return window.CodeBlueLive._engine.computeCounts(s.events); });
  ok(counts.shocks === 1 && counts.epi === 1, tag + ": counts recomputed from watch events " + JSON.stringify(counts));
  ok(await page.locator('[data-state="watch-chip"]').isVisible().catch(() => false), tag + ": Watch chip in header");
  ok(await page.evaluate(() => document.querySelectorAll("#cblRoot .cbl-tllabel").length >= 3), tag + ": timeline seeded");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `cb-native-joined-${tag}.png`) });
  // Later watch state adds an event (no duplicates on re-emit)
  await page.evaluate(() => {
    const st = JSON.parse(JSON.stringify(window.__watchState));
    st.events.push({ id: "4", elapsed: 300, kind: "rhythm", label: "VF", source: "watch" });
    st.receivedAtMs = Date.now(); st.elapsed = 300;
    window.__emitWatch(st); window.__emitWatch(st);
  });
  await page.waitForTimeout(400);
  const nRhythm = await page.evaluate(() => window.CodeBlueLive._rt.session().events.filter((e) => e.id === "w-4").length);
  ok(nRhythm === 1, tag + ": later codeBlueState adds event once (got " + nRhythm + ")");
  // Tapping Shock calls codeBlueLog
  await page.evaluate(() => { window.__watchCalls.length = 0; });
  const shockBtn = page.locator('#cblRoot [data-act="tile-shock"]').first();
  if (await shockBtn.count()) { await shockBtn.click(); await page.waitForTimeout(300); }
  const logged = await page.evaluate(() => window.__watchCalls.filter((c) => c[0] === "codeBlueLog"));
  ok(logged.some((c) => c[1] && c[1].kind === "shock"), tag + ": tapping Shock calls codeBlueLog " + JSON.stringify(logged));
  ok(await page.evaluate(() => window.__watchCalls.filter((c) => c[0] === "codeBlueNotifyWatch").length === 0), tag + ": a code joined from the watch is not announced back to it");
  // Native cues scheduled (fake plugin active)
  const cues = await page.evaluate(() => window.__watchCalls.filter((c) => c[0] === "audioSetCues"));
  ok(cues.length > 0, tag + ": native cues scheduled via audioSetCues");
  // Watch ends -> prompt, End -> Debrief
  await page.evaluate(() => { const st = JSON.parse(JSON.stringify(window.__watchState)); st.running = false; window.__emitWatch(st); });
  await page.waitForTimeout(400);
  ok(await page.locator('[data-state="watch-ended"]').isVisible().catch(() => false), tag + ": watch ending shows prompt");
  await page.evaluate(() => { window.confirm = () => true; });
  await page.locator('[data-act="watch-end-yes"]').click();
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => window.CodeBlueLive._rt.view() === "ended"), tag + ": End goes to Debrief");
  await page.close();
}

try {
  await scenario(390, "night-shift", "390-dark");
  await scenario(390, "ward-light", "390-light");
  await scenario(820, "night-shift", "820-dark");
  await scenario(820, "ward-light", "820-light");
  // Absent otherwise: no watch state running
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(HARNESS_URL, { waitUntil: "load" });
  await page.evaluate(() => { window.__watchState = { running: false, rosc: false, elapsed: 0, receivedAtMs: Date.now(), mode: "adult", events: [] }; window.CodeBlueLive.open({}); });
  await page.waitForTimeout(500);
  ok(!(await page.locator('[data-state="watch-join"]').isVisible().catch(() => false)), "absent: no join card when watch not running");
  // Banner tap path: open with join directly
  await page.evaluate(() => { window.CodeBlueLive.close(); window.__watchState = { running: true, rosc: false, elapsed: 252, receivedAtMs: Date.now(), mode: "adult", events: [{ id: "1", elapsed: 5, kind: "cprStart", label: "CPR started" }] }; window.CodeBlueLive.open({ join: true }); });
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => window.CodeBlueLive._rt.view() === "running" && window.CodeBlueLive._rt.watchJoined()), "banner: open({join:true}) opens joined");
  await page.close();
  // Phone to watch: a LIVE code started here notifies the watch once; END notifies; TRAINING and a joined code never do.
  const pn = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await pn.goto(HARNESS_URL, { waitUntil: "load" });
  await pn.evaluate(() => { window.__watchState = { running: false, rosc: false, elapsed: 0, receivedAtMs: Date.now(), mode: "adult", events: [] }; window.__watchCalls.length = 0; window.CodeBlueLive.open({}); });
  await pn.waitForTimeout(500);
  await pn.locator('[data-act="start"]').click();
  await pn.waitForTimeout(600);
  const startCalls = await pn.evaluate(() => window.__watchCalls.filter((c) => c[0] === "codeBlueNotifyWatch"));
  ok(startCalls.length === 1 && startCalls[0][1].running === true && startCalls[0][1].mode === "adult" && typeof startCalls[0][1].startedAtMs === "number" && Math.abs(startCalls[0][1].startedAtMs - Date.now()) < 5000, "phone to watch: LIVE start calls codeBlueNotifyWatch once with mode and startedAtMs " + JSON.stringify(startCalls));
  await pn.evaluate(() => { window.confirm = () => true; });
  await pn.locator('[data-act="end"]').first().click();
  await pn.waitForTimeout(600);
  const endCalls = await pn.evaluate(() => window.__watchCalls.filter((c) => c[0] === "codeBlueNotifyWatch" && c[1].running === false));
  ok(endCalls.length >= 1, "phone to watch: ending the code notifies the watch (running false)");
  await pn.evaluate(() => { window.CodeBlueLive.close(); window.__watchCalls.length = 0; window.CodeBlueLive.open({ training: true }); });
  await pn.waitForTimeout(400);
  await pn.locator('[data-act="start"]').click();
  await pn.waitForTimeout(600);
  ok(await pn.evaluate(() => window.__watchCalls.filter((c) => c[0] === "codeBlueNotifyWatch").length === 0), "phone to watch: TRAINING never notifies the watch");
  await pn.close();
} finally {
  await browser.close(); if (serve) serve.kill();
}
console.log(fails ? `FAILURES: ${fails}` : "ALL PASS");
process.exit(fails ? 1 : 0);
