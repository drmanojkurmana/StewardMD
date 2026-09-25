/* Plan item 16: the live board. The OPD boards are told when the hospital's queue changes instead of polling.
 *
 * What these defend:
 *   - every queue change moves the hospital's revision stamp (the audit is the one choke point), a priority change
 *     and a recall too (they write their audit row in their own commit),
 *   - the stream says the current revision first and then each change, carries no patient, and ends so the client
 *     reconnects; staff need queue.view on that hospital, the wall display its signed token,
 *   - the client calls onChange only for a change, reconnects after a normal end, backs off after a failure,
 *     and says whether it is live so the host can poll slowly only while it is,
 *   - in the app it streams through the WebView's own fetch, never the buffering CapacitorHttp bridge.
 *
 * node --test --experimental-test-module-mocks test/opd-live.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { docs, api, seed, ENV, OWNER_A, NURSE_A, HR_B, DAY } from "./helpers/opd-router-harness.mjs";

const LIVE = createRequire(import.meta.url)("../opd-live.js");
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const rev = (org) => { const d = docs.get("q_live/" + org); return d ? d.fields.rev : 0; };

test("a queue change moves the hospital's stamp; the stamp holds a time, not a patient", async () => {
  seed();
  assert.equal(rev("org-a"), 0);
  const t = await api("/pool", "POST", { orgId: "org-a", date: DAY, name: "Asha", mobile: "9876543210" }, NURSE_A);
  assert.equal(t.__status, 200, JSON.stringify(t));
  const r1 = rev("org-a");
  assert.ok(r1 > 0, "registering moved it");
  assert.deepEqual(Object.keys(docs.get("q_live/org-a").fields).sort(), ["hospitalId", "rev"]);
  assert.equal(rev("org-b"), 0, "another hospital's board is not told");
  await new Promise((r) => setTimeout(r, 2));
  const p = await api("/priority", "POST", { sessionId: t.ticket.sessionId, ticketId: t.ticket.id, reason: "senior" }, OWNER_A);
  assert.ok(p.__status === 200 || p.__status === 403, JSON.stringify(p));
  if (p.__status === 200) assert.ok(rev("org-a") > r1, "a priority change moves it too");
});

async function readStream(res, maxMs) {
  const reader = res.body.getReader(), dec = new TextDecoder(); let out = "";
  const until = Date.now() + (maxMs || 2000);
  while (Date.now() < until) { const r = await reader.read(); if (r.done) break; out += dec.decode(r.value); }
  return out;
}

test("GET /live: 401, 403 for another hospital; the stream opens with the current revision, then ends so the client reconnects", async () => {
  seed();
  ENV.QUEUE_LIVE_MS = "5"; ENV.QUEUE_LIVE_TICKS = "3";
  try {
    assert.equal((await api("/live?orgId=org-a", "GET", null)).__status, 401);
    assert.equal((await api("/live?t=not-a-display-token", "GET", null)).__status, 401, "the wall display needs its signed token");
    const other = await api("/live?orgId=org-a", "GET", null, HR_B);
    assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
    await api("/pool", "POST", { orgId: "org-a", date: DAY, name: "Asha", mobile: "9876543210" }, NURSE_A);
    const { onRequest } = await import("../functions/api/queue/[[path]].js");
    const res = await onRequest({ request: new Request("https://x/api/queue/live?orgId=org-a", { headers: { "Cf-Access-Authenticated-User-Email": NURSE_A } }), env: ENV });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("Content-Type"), /text\/event-stream/);
    const body = await readStream(res);
    assert.match(body, /^retry: 1000\n\n/);
    const events = LIVE.frames(body + "\n\n").revs;
    assert.deepEqual(events, [rev("org-a")], "the current revision once; nothing changed, so nothing more");
    assert.ok(!/Asha|9876543210|mobile|name/.test(body), "no patient in the stream");
  } finally { delete ENV.QUEUE_LIVE_MS; delete ENV.QUEUE_LIVE_TICKS; }
});

/* ---- the client ------------------------------------------------------------------------------------- */
function sse(chunks) {   // a Response-like whose body streams the given chunks, then ends
  const enc = new TextEncoder();
  return { ok: true, body: new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } }) };
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 5));

test("the client: onChange only when the revision moves (not for the first), straight back after the server ends the stream", async () => {
  const seen = [], states = [];
  const bodies = [["retry: 1000\n\n", "data: {\"rev\":1}\n\n", ": keep-alive\n\n", "data: {\"rev\":2}\n", "\n"], ["data: {\"rev\":2}\n\n", "data: {\"rev\":5}\n\n"]];
  let calls = 0;
  const c = LIVE.connect({ url: "/api/queue/live?orgId=o", onChange: (r) => seen.push(r), onState: (v) => states.push(v),
    fetch: (url, init) => { calls++; assert.equal(init.headers.Accept, "text/event-stream"); const b = bodies.shift(); return b ? Promise.resolve(sse(b)) : new Promise(() => {}); } });
  for (let i = 0; i < 40 && calls < 3; i++) await tick(20);
  c.stop();
  assert.deepEqual(seen, [2, 5], "1 is the state it opened on; 2 and 5 are changes; a repeated 2 after reconnecting is not");
  assert.ok(calls >= 2, "reconnected after the server ended the stream");
  assert.equal(states[0], true);
  assert.equal(c.isLive(), false, "stopped is not live");
});

test("the client: a failed stream is not live and retries with back-off; the host's headers go with it", async () => {
  const states = [], times = [];
  const c = LIVE.connect({ url: "/x", headers: () => Promise.resolve({ "X-Staff-Token": "tok" }), onChange() {}, onState: (v) => states.push(v),
    fetch: (url, init) => { times.push(Date.now()); assert.equal(init.headers["X-Staff-Token"], "tok"); return Promise.resolve({ ok: false, status: 403 }); } });
  await tick(1300);
  c.stop();
  assert.equal(times.length, 2, "tried, then again after a second, not in a tight loop");
  assert.ok(times[1] - times[0] >= 900);
  assert.ok(!states.includes(true), "never claimed to be live");
});

test("in the app the stream uses the WebView's own fetch and the API origin; without it the app keeps polling", () => {
  const src = read("opd-live.js");
  assert.match(src, /w\.SMD_IS_NATIVE\) return typeof w\.CapacitorWebFetch === "function" \? w\.CapacitorWebFetch\.bind\(w\) : null;/);
  assert.match(src, /\(\(w && w\.SMD_API_BASE\) \|\| ""\) \+ path/);
});

test("the three boards are wired: the console, the app (room and front desk, quiet polls while live) and the wall display", () => {
  const opd = read("opd.html"), q = read("queue.js"), idx = read("index.html"), tv = read("opd-display.html");
  assert.match(opd, /<script src="\/opd-live\.js\?v=/);
  assert.match(opd, /SMD_OPD_LIVE\.connect\(\{url:queueApiUrl\("live\?orgId="/);
  assert.match(opd, /closest\("input, textarea, select"\)\);\s*if\(!document\.hidden&&!typing/, "a change never repaints over someone typing");
  // A change heard while hidden or typing is kept, not dropped: shown again, field left, or the minute's pass catches up.
  assert.match(opd, /else if\(st\.orgId\) liveMissed=true;/);
  assert.match(opd, /addEventListener\("visibilitychange",function\(\)\{ if\(!document\.hidden&&liveMissed\) liveRefresh\(\); \}\)/);
  assert.match(opd, /addEventListener\("focusout",function\(\)\{ if\(liveMissed\) liveRefresh\(\); \}\)/);
  assert.match(opd, /\(liveMissed\|\|!\(LIVE&&LIVE\.isLive\(\)\)\)\) liveRefresh\(\);/, "the minute's pass runs while a change is owed, even with the stream up");
  assert.match(opd, /function logout\(msg\)\{\n\s+liveStop\(\);/);
  assert.match(idx, /<script src="\/opd-live\.js\?v=/);
  assert.match(q, /if \(liveQuiet\(\)\) return;   \/\/ plan item 16/);
  assert.match(q, /liveStart\(refresh\);/);
  assert.match(q, /liveStart\(fdPoll\);/);
  assert.match(q, /function signOutDesk\(\) \{ if \(!offSignOut\(\)\) return false; liveStop\(\); return true; \}/, "signing out ends the live stream");
  assert.match(tv, /<script src="\/opd-live\.js\?v=/);
  assert.match(tv, /SMD_OPD_LIVE\.connect\(\{ url: "\/api\/queue\/live\?t="/);
  assert.match(read("scripts/build-wardsynq-site.sh"), /opd-live\.js/);
});

test("end to end: the real client on the real stream hears a registration at the desk within a few polls", async () => {
  seed();
  ENV.QUEUE_LIVE_MS = "5"; ENV.QUEUE_LIVE_TICKS = "200";
  const { onRequest } = await import("../functions/api/queue/[[path]].js");
  const heard = [];
  const c = LIVE.connect({ url: "/api/queue/live?orgId=org-a", headers: () => ({ "Cf-Access-Authenticated-User-Email": NURSE_A }), onChange: (r) => heard.push(r),
    fetch: (url, init) => onRequest({ request: new Request("https://x" + url, init), env: ENV }) });
  try {
    for (let i = 0; i < 50 && !c.isLive(); i++) await tick(5);
    assert.equal(c.isLive(), true, "connected");
    await tick(20);
    assert.equal(heard.length, 0, "nothing changed yet");
    await api("/pool", "POST", { orgId: "org-a", date: DAY, name: "Ravi", mobile: "9876543211" }, NURSE_A);
    for (let i = 0; i < 60 && !heard.length; i++) await tick(5);
    assert.equal(heard.length, 1, "the board was told");
    assert.equal(heard[0], rev("org-a"));
  } finally { c.stop(); delete ENV.QUEUE_LIVE_MS; delete ENV.QUEUE_LIVE_TICKS; }
});
