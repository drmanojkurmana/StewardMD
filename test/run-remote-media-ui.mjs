/* Learning content from R2 on first view, signed-in only (remote-media.js + prep-lessons.js, owner 2026-11-12).
 * Runs the real bundle built with SMD_REMOTE_MEDIA=1; the bank and session routes are stubbed here.
 *   signed in : a CliniX photo, a lesson diagram and a gated lesson picture load once through signed URLs, become
 *               blob: images, and a moved lesson file is fetched with app proof
 *   offline   : after a reload with the bank unreachable, the same pictures still show (Cache Storage)
 *   signed out: a "sign in" placeholder and no picture request; signing in and retrying loads them
 * USAGE: SMD_REMOTE_MEDIA=1 npm run build:www && node test/run-remote-media-ui.mjs   (serves www/ itself)
 */
import { createRequire } from "node:module"; const require = createRequire(import.meta.url); const { chromium, devices } = require("playwright");
import { spawn } from "node:child_process";
import fs from "node:fs";
const ROOT = new URL("../", import.meta.url).pathname;
const port = 8993;
const srv = spawn("node", [ROOT + "test/serve.mjs", ROOT + "www", String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1200));
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
ok(/window\.SMD_REMOTE_MEDIA_ON=1;/.test(fs.readFileSync(ROOT + "www/index.html", "utf8")), "bundle built with SMD_REMOTE_MEDIA=1");
ok(!fs.existsSync(ROOT + "www/clinix/media/practicals"), "CliniX photos are not in the bundle");

const PHOTO = "/clinix/media/practicals/obg-ins-veress-needle.webp";
const DIAGRAM = "/prep/lessons/media/" + fs.readdirSync(ROOT + "prep/lessons/media").find((f) => /\.svg$/.test(f));
const GATED = "/api/prep/bank/v1/lessons/media/neck-us.webp";
const LESSON = Object.keys(JSON.parse(fs.readFileSync(ROOT + "prep/lessons/v1/index.json", "utf8")).modules)[0];

const browser = await chromium.launch();
async function run(name, { signedIn, bankUp, ctx }) {
  ctx = ctx || await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  const hits = [];
  await page.route("**/api/prep/session", (r) => signedIn
    ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sessionId: "s1", sessionKey: "a".repeat(64), expiresAt: Math.floor(Date.now() / 1000) + 600 }) })
    : r.fulfill({ status: 401, contentType: "application/json", body: '{"code":"login-required"}' }));
  await page.route("**/api/prep/bank/**", (r) => {
    const u = new URL(r.request().url()), p = decodeURIComponent(u.pathname.replace(/^.*\/api\/prep\/bank\//, ""));
    hits.push({ p, sig: u.searchParams.has("sig"), proof: !!r.request().headers()["x-smd-signature"] });
    if (!bankUp) return r.fulfill({ status: 503, body: "down" });
    const signed = u.searchParams.has("sig") || r.request().headers()["x-smd-signature"];
    if (!signed) return r.fulfill({ status: 401, contentType: "application/json", body: '{"code":"login-required"}' });
    const local = p.startsWith("app/") ? ROOT + p.slice(4) : p === "v1/lessons/media/neck-us.webp" ? ROOT + "clinix/media/practicals/obg-ins-veress-needle.webp" : null;
    if (!local || !fs.existsSync(local)) return r.fulfill({ status: 404, body: "{}" });
    r.fulfill({ status: 200, contentType: /\.svg$/.test(local) ? "image/svg+xml" : /\.json$/.test(local) ? "application/json" : "image/webp", body: fs.readFileSync(local) });
  });
  await page.addInitScript((si) => { window.__si = si; }, signedIn);
  await page.goto(`http://localhost:${port}/`, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  if (process.env.RM_DEBUG) console.log("DEBUG", name, await page.evaluate(async () => ({ keys: await caches.keys(), media: (await (await caches.open("smd-media-v1")).keys()).length, sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller) })));
  await page.evaluate(([a, b, c]) => {
    window.SMD_IDTOKEN = function () { return window.__si ? "tok" : null; };
    window.SMD_IDTOKEN_REFRESH = function () { return Promise.resolve(window.__si ? "tok" : null); };
    ["introPoster", "splash", "accountGate", "introOverlay"].forEach(function (k) { var e = document.getElementById(k); if (e) e.remove(); });
    var box = document.createElement("div"); box.id = "rmTest"; box.style.cssText = "position:fixed;top:0;left:0;z-index:99999;background:#fff";
    box.innerHTML = '<img id="i1" width="120" height="80" src="' + a + '"><img id="i2" width="120" height="80" src="' + b + '"><img id="i3" width="120" height="80" src="' + c + '">';
    document.body.appendChild(box);
  }, [PHOTO, DIAGRAM, GATED]);
  await page.waitForTimeout(3000);
  const st = await page.evaluate(() => ["i1", "i2", "i3"].map((id) => { const e = document.getElementById(id); return { state: e.getAttribute("data-smd-rm-state"), src: e.src.slice(0, 30), w: e.naturalWidth }; }));
  return { page, ctx, st, hits, errs };
}

// 1. signed in, online
let r = await run("signed-in", { signedIn: true, bankUp: true });
ok(r.st.every((x) => x.state === "ok" && x.src.startsWith("blob:") && x.w > 0), "signed in: photo, diagram and lesson picture load as on-phone images " + JSON.stringify(r.st));
const imgHits = r.hits.filter((h) => /\.(?:webp|svg)$/.test(h.p));
ok(imgHits.length === 3 && imgHits.every((h) => h.sig), "each picture fetched once, through a signed URL (" + imgHits.map((h) => h.p).join(", ") + ")");
const lesson = await r.page.evaluate((k) => window.PREP_BANK_CLIENT.fetchBankJSON("/api/prep/bank/app/prep/lessons/v1/" + k + ".json").then((j) => !!(j && j.steps), (e) => String(e)), LESSON);
ok(lesson === true && r.hits.some((h) => h.p.startsWith("app/prep/lessons/v1/") && h.proof), "a moved lesson file is fetched with app proof");
// The lesson reader's own loader: a lesson that used to ship in the app comes from R2 once, then from the phone.
const viaReader = await r.page.evaluate((k) => new Promise((res) => {
  const go = () => {
    const mem = {}; window.__lh = { cacheGet: (key) => Promise.resolve(mem[key] || null), cachePut: (key, v) => { mem[key] = v; return Promise.resolve(); }, _mem: mem };
    window.PREP_LESSONS.file(k, window.__lh).then((f) => res({ ok: !!(f && f.steps && f.steps.length), cached: Object.keys(mem).some((x) => x.indexOf(k) >= 0) }), (e) => res({ err: String(e) }));
  };
  if (window.PREP_LESSONS) return go();
  const sc = document.createElement("script"); sc.src = "/prep-lessons.js"; sc.onload = go; document.head.appendChild(sc);
}), LESSON);
ok(viaReader.ok && viaReader.cached && r.hits.some((h) => h.p === "app/prep/lessons/v1/" + LESSON + ".json" && h.proof), "the lesson reader loads a moved lesson from R2 with app proof and keeps it " + JSON.stringify(viaReader));
ok(r.errs.length === 0, "no page errors " + r.errs.join(" | "));

// 2. same phone, bank unreachable: pictures come from the phone's cache
const ctx = r.ctx; await r.page.close();
r = await run("offline", { signedIn: true, bankUp: false, ctx });
ok(r.st.every((x) => x.state === "ok" && x.src.startsWith("blob:") && x.w > 0), "offline after first view: pictures still show " + JSON.stringify(r.st));
ok(r.hits.filter((h) => /\.(?:webp|svg)$/.test(h.p)).length === 0, "no picture request when the phone has it");
await ctx.close();

// 3. signed out on a fresh phone
r = await run("signed-out", { signedIn: false, bankUp: true });
ok(r.st.every((x) => x.state === "signin" && x.src.startsWith("data:image/svg+xml")), "signed out: 'Sign in to see this picture' placeholder " + JSON.stringify(r.st.map((x) => x.state)));
ok(r.hits.filter((h) => /\.(?:webp|svg)$/.test(h.p)).length === 0, "signed out: no picture is requested");
await r.page.evaluate(() => { window.__si = true; window.PREP_BANK_CLIENT.clearSession && window.PREP_BANK_CLIENT.clearSession(); window.SMD_REMOTE_MEDIA.retry(); });
await r.page.unroute("**/api/prep/session");
await r.page.route("**/api/prep/session", (rt) => rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sessionId: "s1", sessionKey: "a".repeat(64), expiresAt: Math.floor(Date.now() / 1000) + 600 }) }));
await r.page.evaluate(() => window.SMD_REMOTE_MEDIA.retry());
await r.page.waitForTimeout(2500);
const after = await r.page.evaluate(() => ["i1", "i2", "i3"].map((id) => document.getElementById(id).getAttribute("data-smd-rm-state")));
ok(after.every((s) => s === "ok"), "after signing in, the same pictures load " + JSON.stringify(after));
await r.page.screenshot({ path: (process.env.CLAUDE_JOB_DIR || "/tmp") + "/remote-media.png" });

await browser.close(); srv.kill(); process.exit(fails ? 1 : 0);
