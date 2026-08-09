// test/fbfirestore-codec.test.mjs — the Firestore value codec must round-trip nested objects + arrays
// (the OPD org/room/membership/timeline model relies on this; scalars unchanged).
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeValue, decodeValue, encodeFields, decodeFields } from "../functions/_fbfirestore.js";

const rt = (v) => decodeValue(encodeValue(v));

test("scalars round-trip unchanged", () => {
  assert.equal(rt("hi"), "hi");
  assert.equal(rt(42), 42);
  assert.equal(rt(3.5), 3.5);
  assert.equal(rt(true), true);
  assert.equal(rt(null), null);
});

test("arrays round-trip (incl empty + array of strings)", () => {
  assert.deepEqual(rt([]), []);
  assert.deepEqual(rt(["d1", "d2"]), ["d1", "d2"]);
  assert.deepEqual(rt([1, 2, 3]), [1, 2, 3]);
});

test("nested objects round-trip — room assignment, membership scope, thresholds", () => {
  assert.deepEqual(rt({ mode: "primary", doctors: ["dA", "dB"], primary: "dA" }), { mode: "primary", doctors: ["dA", "dB"], primary: "dA" });
  assert.deepEqual(rt({ mode: "unassigned", doctors: [], primary: null }), { mode: "unassigned", doctors: [], primary: null });
  assert.deepEqual(rt({ departments: ["cardio"], opds: [], rooms: ["r1", "r2"] }), { departments: ["cardio"], opds: [], rooms: ["r1", "r2"] });
  assert.deepEqual(rt({ moderate: 3, busy: 6 }), { moderate: 3, busy: 6 });
});

test("array of nested objects (timeline entries) round-trips", () => {
  const entries = [{ ts: 111, kind: "note", by: "u1", enc: "x" }, { ts: 222, kind: "vitals", by: "u2", enc: "y" }];
  assert.deepEqual(rt(entries), entries);
});

test("encodeFields/decodeFields round-trip a full room-ish doc", () => {
  const doc = { id: "r1", orgId: "o1", name: "Room 1", assignment: { mode: "primary", doctors: ["d1"], primary: "d1" } };
  assert.deepEqual(decodeFields(encodeFields(doc)), doc);
});
