/* test/opd-console-sync.test.mjs — patients added on the web console (stewardmd.in/opd) must reach
 * the doctor's app queue.
 *
 * REPORTED 2026-08-24: patients the nurse (or the doctor) added at stewardmd.in/opd never showed up in
 * the phone app's OPD dashboard for a personal clinic. Two independent causes, both covered here.
 *
 *  1) DAY BUCKET. The session key bakes in the date (_queue_engine.js sessionId()). The server computes
 *     the clinic day in IST (opdDate: now()+05:30); opd.html used to send a UTC day
 *     (new Date().toISOString().slice(0,10)). Between 00:00 and 05:30 IST those differ, so the console
 *     wrote to YESTERDAY's session while the app read TODAY's. Same clinic, same room, zero overlap.
 *
 *  2) THE POOL. The console's add button registers into a doctor-less pool session
 *     (doctorUid "__pool__"), and the app polls only its OWN room session - so without a separate
 *     "Route to a room" tap the patient was invisible to the doctor forever.
 *
 * node --test test/opd-console-sync.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ENGINE = readFileSync(new URL("../functions/_queue_engine.js", import.meta.url), "utf8");
const CONSOLE_HTML = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
const ROUTER = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");

// The two implementations of "what day is it at this clinic", lifted from the two files.
const serverIstDay = (nowMs) => new Date(nowMs + 19800000).toISOString().slice(0, 10);
const utcDay = (nowMs) => new Date(nowMs).toISOString().slice(0, 10);

test("BUG 1: the console now computes the clinic day in IST, matching the server", () => {
  assert.match(CONSOLE_HTML, /function istDay\(\)\{ return new Date\(Date\.now\(\)\+19800000\)/,
    "opd.html must define an IST day helper");
  assert.match(CONSOLE_HTML, /date:istDay\(\)/, "the console state must use it");
  assert.doesNotMatch(CONSOLE_HTML, /date:new Date\(\)\.toISOString\(\)\.slice\(0,10\)/,
    "the UTC day must be gone - it is the whole bug");
});

test("BUG 1: the server still defines the clinic day as IST (the contract the console matches)", () => {
  assert.match(ENGINE, /now\(\)\s*\+\s*19800000/, "_queue_engine opdDate must stay IST");
});

test("BUG 1: UTC and IST really do disagree in the small hours (the reported window)", () => {
  // 2026-08-23 20:00 UTC == 2026-08-24 01:30 IST - exactly when the screenshots were taken.
  const t = Date.parse("2026-08-23T20:00:00Z");
  assert.equal(utcDay(t), "2026-08-23");
  assert.equal(serverIstDay(t), "2026-08-24");
  assert.notEqual(utcDay(t), serverIstDay(t), "this mismatch is what split the session key");
  // ...and agree during the working day, which is why it was never noticed in clinic hours.
  const noon = Date.parse("2026-08-24T06:30:00Z");   // 12:00 IST
  assert.equal(utcDay(noon), serverIstDay(noon));
});

test("BUG 2: a pool session and a room session are different buckets by construction", () => {
  // sessionId(hospitalId, doctorUid, dept, date) - the pool uses a synthetic doctor.
  const sessionId = (h, d, dept, date) => [h, d, dept, date].join("__");
  const pool = sessionId("org1", "__pool__", "", "2026-08-24");
  const room = sessionId("org1", "dr-uid", "", "2026-08-24");
  assert.notEqual(pool, room, "a pooled ticket is NOT in the doctor's session");
  assert.match(ENGINE, /POOL_DOCTOR\s*=\s*"__pool__"/);
  assert.match(ENGINE, /listTickets[\s\S]{0,200}field:\s*"sessionId"/,
    "tickets are fetched by sessionId only, so a pooled ticket can never surface in a room queue");
});

test("BUG 2: the pool handler auto-routes when the clinic has exactly one staffed room", () => {
  const pool = ROUTER.slice(ROUTER.indexOf('if (seg === "pool")'), ROUTER.indexOf('if (seg === "assign-room")'));
  assert.match(pool, /listRooms/, "must look at the org's rooms");
  assert.match(pool, /resolveRoomDoctor/, "only rooms that actually have a doctor count");
  assert.match(pool, /staffed\.length === 1/, "auto-route ONLY the unambiguous single-room case");
  assert.match(pool, /assignToRoom/, "and route it into that room's session");
  assert.match(pool, /catch/, "routing is best-effort - a failure must not lose the ticket");
});

test("BUG 2: multi-room orgs keep the explicit triage step (no silent mis-routing)", () => {
  const pool = ROUTER.slice(ROUTER.indexOf('if (seg === "pool")'), ROUTER.indexOf('if (seg === "assign-room")'));
  assert.doesNotMatch(pool, /staffed\.length\s*>=\s*1/, "must not grab the first of several rooms");
  assert.doesNotMatch(pool, /staffed\[0\][\s\S]{0,40}length\s*>\s*1/, "no >1 auto-pick");
});
