/* test/wardsynq-observability.test.mjs — the smallest observability layer, proven.
 *
 * node --test test/wardsynq-observability.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { KIND, logEvent } from "../functions/_wardsynq/observability.js";

function capture() {
  const lines = [];
  return { io: { log: (s) => lines.push(["log", s]), error: (s) => lines.push(["error", s]) }, lines };
}

test("a request error emits ONE structured, valid-JSON line on console.error", () => {
  const { io, lines } = capture();
  logEvent(KIND.REQUEST_ERROR, { route: "ward", status: 500, durationMs: 42.7, code: "TypeError" }, io);
  assert.equal(lines.length, 1);
  assert.equal(lines[0][0], "error", "errors and security events go to console.error, never console.log");
  const line = JSON.parse(lines[0][1]);
  assert.equal(line.kind, "request_error");
  assert.equal(line.route, "ward");
  assert.equal(line.status, 500);
  assert.equal(line.durationMs, 43, "rounded, never a fractional millisecond nobody asked for");
  assert.equal(line.code, "TypeError");
  assert.ok(line.at, "every line is timestamped");
});

test("a notification/AI/integration failure logs quietly to console.log, not console.error", () => {
  for (const kind of [KIND.NOTIFY_FAILED, KIND.AI_FAILED, KIND.INTEGRATION_FAILED]) {
    const { io, lines } = capture();
    logEvent(kind, { code: "NO_CHANNEL" }, io);
    assert.equal(lines[0][0], "log", `${kind} is operational noise, not an incident`);
  }
});

test("a security event goes to console.error, the same channel as a request error", () => {
  const { io, lines } = capture();
  logEvent(KIND.SECURITY_EVENT, { code: "source_unauthorized" }, io);
  assert.equal(lines[0][0], "error");
});

test("PHI CANNOT PASS THROUGH: there is no field shaped to carry a name, a note, or free text longer than a route segment", () => {
  const { io, lines } = capture();
  // Somebody hands this a patient's name and a clinical note by mistake, in every field that exists.
  logEvent(KIND.REQUEST_ERROR, {
    route: "Mrs Testcase, DOB 1970-01-01, admitted with chest pain and a penicillin allergy, MRN GH-9981",
    status: 500,
    detail: "Patient reports chest pain since this morning, allergic to penicillin (anaphylaxis, severe).",
    code: "TypeError",
  }, io);
  const line = JSON.parse(lines[0][1]);
  // The whole defence is a HARD LENGTH CAP, not a content filter that could miss something: 200
  // characters is far short of what a clinical narrative needs, so a free-text field truncates to
  // something unusable as PHI long before this line asserts anything about its CONTENT.
  assert.ok(line.route.length <= 200);
  assert.ok(line.detail.length <= 200);
  // And there is no field at all named patientId, mrn, name, note, or anything shaped for one -
  // the schema itself is the boundary. Every key on the emitted line is one of the allow-listed six.
  assert.deepEqual(new Set(Object.keys(line)), new Set(["at", "kind", "route", "status", "durationMs", "code", "detail", "tenantId", "actorKind"]));
});

test("an unknown kind is refused rather than logged under a made-up label", () => {
  const { io, lines } = capture();
  logEvent("something-nobody-defined", { route: "ward" }, io);
  assert.equal(lines.length, 0);
});

test("a broken io (a console that throws) never propagates - observability cannot be why a request fails", () => {
  const broken = { log: () => { throw new Error("stdout is gone"); }, error: () => { throw new Error("stderr is gone"); } };
  assert.doesNotThrow(() => logEvent(KIND.REQUEST_ERROR, { route: "ward" }, broken));
  assert.doesNotThrow(() => logEvent(KIND.NOTIFY_FAILED, {}, broken));
});

test("missing/garbage fields degrade to null rather than throwing or emitting undefined/NaN", () => {
  const { io, lines } = capture();
  logEvent(KIND.REQUEST_ERROR, { status: "not-a-number", durationMs: NaN, route: "", detail: null }, io);
  const line = JSON.parse(lines[0][1]);
  assert.equal(line.status, null);
  assert.equal(line.durationMs, null);
  assert.equal(line.route, null);
  assert.equal(line.detail, null);
});
