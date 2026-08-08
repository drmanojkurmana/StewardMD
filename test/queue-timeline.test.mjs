// test/queue-timeline.test.mjs — pure encounter-timeline helpers (kind validation, link-expiry clamp,
// live-window check). The I/O (encrypt/Firestore) is exercised on-device, not here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tlKind, clampExtendMs, timelineLive, TL_KINDS } from "../functions/_queue_timeline.js";

test("tlKind normalises + falls back to 'note' for anything unknown", () => {
  assert.equal(tlKind("MEDICATION"), "medication");
  assert.equal(tlKind("vitals"), "vitals");
  assert.equal(tlKind("checkout"), "checkout");
  assert.equal(tlKind("garbage"), "note");
  assert.equal(tlKind(""), "note");
  assert.equal(tlKind(undefined), "note");
  for (const k of TL_KINDS) assert.equal(tlKind(k), k);
});

test("clampExtendMs: default 7d, clamped to [1,30]", () => {
  const t = 1000000000000;
  const DAY = 86400000;
  assert.equal(clampExtendMs(t, 7), t + 7 * DAY);
  assert.equal(clampExtendMs(t, 30), t + 30 * DAY);
  assert.equal(clampExtendMs(t, 999), t + 30 * DAY);   // capped at 30
  assert.equal(clampExtendMs(t, 0), t + 1 * DAY);       // floored at 1
  assert.equal(clampExtendMs(t, -5), t + 1 * DAY);
  assert.equal(clampExtendMs(t, undefined), t + 7 * DAY); // default
});

test("timelineLive: only after checkout (linkExpiresAt set) and before it lapses", () => {
  const t = 1000000000000;
  assert.equal(timelineLive({ linkExpiresAt: t + 1000 }, t), true);
  assert.equal(timelineLive({ linkExpiresAt: t - 1000 }, t), false);  // expired
  assert.equal(timelineLive({ linkExpiresAt: 0 }, t), false);         // not checked out yet
  assert.equal(timelineLive(null, t), false);
  assert.equal(timelineLive({}, t), false);
});
