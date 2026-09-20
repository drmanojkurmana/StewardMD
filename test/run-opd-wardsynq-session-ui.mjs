/* test/run-opd-wardsynq-session-ui.mjs - LT-01 (live test 2026-09-15): the OPD desk honours a wardsynq.com sign-in.
 *
 * Real headless Chrome, the REAL opd.html over the REAL /api/queue router (in-memory Firestore, as run-opd-dept-ui.mjs).
 * wardsynq/site/shell.js records an account sign-in as smd_opd_toktype "account" with the chosen hospital in
 * smd_opd_workplace "wardsynq:<orgId>"; opd.html used to know only "firebase" and showed its own sign-in wall.
 *
 * The Firebase SDK is the one thing not real: gstatic is blocked and a stand-in `firebase` is injected whose signed-in
 * user's ID token is "acct:<email>". This server turns that bearer into the Cloudflare Access identity header the
 * router already accepts, so the account is still verified by the router, never by the page.
 *
 *   node --experimental-test-module-mocks test/run-opd-wardsynq-session-ui.mjs   (CHROME=<path> to override)
 */
import * as H from "./helpers/opd-router-harness.mjs";
import { launch } from "./wardsynq-site-cdp.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

// A doctor-admin of a WardSynQ hospital who is also a member of a second hospital: two hospitals, so without the
// workplace the console would ask which one.
const DR = "dr-admin@example.test";
H.seed();
H.org("org-w", H.OWNER_B, { mode: "wardsynq", name: "Ward Hospital" });
H.member("org-w", DR, "admin");
H.member("org-b", DR, "doctor");
H.docs.set("q_rooms/rw1", { fields: { orgId: "org-w", name: "OPD room 1", number: "1", active: true, assignment: { mode: "primary", primary: "x", doctors: ["x"] } }, updateTime: "t1" });

const boards = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/queue")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && k !== "authorization") headers.set(k, v);
    const auth = String(req.headers.authorization || "");
    if (auth.startsWith("Bearer acct:")) headers.set("Cf-Access-Authenticated-User-Email", auth.slice("Bearer acct:".length));
    if (url.pathname.indexOf("/opd-board") >= 0) boards.push(url.searchParams.get("orgId"));
    const r = await onRequest({ request: new Request("http://localhost" + req.url, { method: req.method, headers, body: req.method === "GET" ? undefined : Buffer.concat(chunks) }), env: H.ENV, waitUntil() {} });
    res.writeHead(r.status, { "Content-Type": "application/json" }); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  const p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try { const body = await readFile(p); res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const BASE = "http://localhost:" + server.address().port;

const results = [];
const b = await launch({ port: Number(process.env.CDP_PORT || 9483), width: 1200, height: 900 });
const { ev, until, nav, call } = b;
async function step(name, fn) {
  try { const r = await fn(); results.push([r === true ? "PASS" : "FAIL", name, r === true ? "" : String(r)]); }
  catch (e) { results.push(["FAIL", name, String(e && e.message || e)]); }
  const last = results[results.length - 1]; console.log(last[0], name, last[2]);
}

// The stand-in Firebase: signed in as whoever localStorage "__fb_user" names, else signed out.
await call("Network.setBlockedURLs", { urls: ["*gstatic.com*"] });
await call("Page.addScriptToEvaluateOnNewDocument", { source: `
  (function(){ var email = null; try { email = localStorage.getItem("__fb_user"); } catch (e) {}
    var user = email ? { email: email, getIdToken: function(){ return Promise.resolve("acct:" + email); } } : null;
    var auth = { currentUser: user, onAuthStateChanged: function(cb){ setTimeout(function(){ cb(user); }, 30); return function(){}; }, signOut: function(){ auth.currentUser = null; return Promise.resolve(); } };
    window.firebase = { initializeApp: function(){}, auth: Object.assign(function(){ return auth; }, { GoogleAuthProvider: function(){} }) };
  })();` });

const loginShown = `return !!document.querySelector('.login .ltabs') || null;`;
const setStorage = (o) => ev(`localStorage.clear(); ${Object.entries(o).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join(" ")} return 1;`);

await nav(BASE + "/opd.html");
await setStorage({ smd_opd_toktype: "account", smd_opd_hospital: "org-w", smd_opd_workplace: "wardsynq:org-w", __fb_user: DR });
await nav("about:blank"); await nav(BASE + "/opd.html");
await step("a wardsynq.com account session opens the OPD desk with no second sign-in", async () => {
  const ok = await until(`return !!document.querySelector('header .role') || null;`, 15000);
  if (!ok) return "no console header: " + await ev("return document.body.textContent.slice(0,300)");
  return (await ev(loginShown)) ? "the sign-in wall was shown" : true;
});
await step("it opens the hospital chosen on wardsynq.com, not the picker, with that hospital's role", async () => {
  await until(`return /admin/.test((document.querySelector('header .role .chip')||{}).textContent||'') || null;`, 8000);
  const chip = await ev(`return (document.querySelector('header .role .chip')||{}).textContent||''`);
  if (!boards.includes("org-w")) return "boards read: " + JSON.stringify(boards);
  if (boards.some((o) => o !== "org-w")) return "another hospital's board was read: " + JSON.stringify(boards);
  return chip === "admin" ? true : "role chip: " + chip;
});

boards.length = 0;
await setStorage({});
await nav("about:blank"); await nav(BASE + "/opd.html");
await step("nobody signed in: the sign-in screen, and no board is read", async () => ((await until(loginShown, 8000)) && !boards.length) ? true : "no sign-in wall, boards " + JSON.stringify(boards));

await setStorage({ smd_opd_toktype: "account", smd_opd_workplace: "wardsynq:org-w" });
await nav("about:blank"); await nav(BASE + "/opd.html");
await step("the account spelling with no Firebase user: still the sign-in screen (nothing is weakened)", async () => ((await until(loginShown, 8000)) && !boards.length) ? true : "no sign-in wall, boards " + JSON.stringify(boards));

await setStorage({ smd_opd_toktype: "account", smd_opd_workplace: "wardsynq:org-w", __fb_user: "stranger@example.test" });
await nav("about:blank"); await nav(BASE + "/opd.html");
await step("an account that is not a member of the workplace hospital is not let into it", async () => {
  await until(`return document.querySelector('.login') || document.querySelector('header .role') || null;`, 10000);
  await new Promise((r) => setTimeout(r, 800));
  return boards.includes("org-w") ? "read org-w's board: " + JSON.stringify(boards) : true;
});

const excs = b.consoleLines.filter((l) => /^EXC/.test(l));
await step("no uncaught page exceptions", async () => (excs.length ? excs.join(" | ") : true));
b.close(); server.close();
const failed = results.filter((r) => r[0] !== "PASS");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
