import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import FLAGS from "../sknx-flags.js";

/* THE WAIVER REGISTER (rewritten 2026-08-24).
 *
 * Three tests here asserted that smd_sknx, smd_sknx_rx and smd_sknx_realvision default to FALSE.
 * On 2026-08-15 the owner deliberately waived that and set them ON for dev/testing. From that day
 * the three tests could NEVER pass - a permanently-red alarm, which is precisely how it stopped
 * being read: it sat inside a 109-failure CI for over a week and nobody looked.
 *
 * A safety check that cannot go green is not a safety check. So the intent is kept and inverted:
 * instead of asserting a default nobody intends to restore yet, the register below records exactly
 * WHICH flags are waived and WHY, and the tests fail if
 *
 *   - a flag is defaulted ON that is not in the register (a new accidental default-on), or
 *   - a waived flag loses its PUBLIC-RELEASE-GATE marker (the release obligation goes undocumented).
 *
 * To ship publicly: set every WAIVED flag below to def:false in sknx-flags.js, empty this register,
 * and this file will still pass. That is the whole point - it goes green when the gate is closed
 * AND when it is deliberately open, and red only when something changed that nobody declared.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "sknx-flags.js"), "utf8");

// flag -> why it is deliberately ON. Owner waiver 2026-08-15.
const WAIVED = {
  smd_sknx:            "master flag, dev/testing so SknX is reachable at all",
  smd_sknx_ondevice:   "on-device analysis path",
  smd_sknx_cloud:      "EXPERIMENTAL cloud classifier - SENDS THE IMAGE OFF-DEVICE and has NO melanoma class",
  smd_sknx_haptics:    "haptics, not a clinical gate",
  smd_sknx_rx:         "Phase 3 clinician-confirmed Rx draft - needs R1 + R3-DPDP + R7 before release",
  smd_sknx_realvision: "EXPERIMENTAL on-device ONNX classifier, uncalibrated public model",
};

test("localStorage '1' enables it for a device", () => {
  const store = { smd_sknx: "1" };
  assert.equal(FLAGS.bool("smd_sknx", { store, query: "" }), true);
});
test("?sknx=1 query wins over localStorage '0'", () => {
  const store = { smd_sknx: "0" };
  assert.equal(FLAGS.bool("smd_sknx", { store, query: "?sknx=1" }), true);
});
test("smd_sknx_haptics is registered and defaults to true when unset", () => {
  const store = {};
  assert.equal(FLAGS.bool("smd_sknx_haptics", { store, query: "" }), true);
});
test("smd_sknx_rx can be enabled per-device via ?sknxrx=1 (dev/testing only)", () => {
  const store = {};
  assert.equal(FLAGS.bool("smd_sknx_rx", { store, query: "?sknxrx=1" }), true);
});
test("smd_sknx_rx localStorage '1' enables it for a device", () => {
  const store = { smd_sknx_rx: "1" };
  assert.equal(FLAGS.bool("smd_sknx_rx", { store, query: "" }), true);
});
test("smd_sknx_realvision enables via ?sknxrv=1", () => {
  const store = {};
  assert.equal(FLAGS.bool("smd_sknx_realvision", { store, query: "?sknxrv=1" }), true);
});

/* ── the waiver register ───────────────────────────────────────────────────── */

test("every flag defaulted ON is a declared waiver, not an accident", () => {
  const on = Object.keys(FLAGS.DEFS).filter(k => FLAGS.bool(k, { store: {}, query: "" }));
  const undeclared = on.filter(k => !WAIVED[k]);
  assert.deepEqual(undeclared, [],
    "these flags default ON but are not in the waiver register: " + undeclared.join(", ") +
    " - either turn them off or declare why they are open");
});

test("every declared waiver is actually still open (the register does not rot)", () => {
  // The other direction: if the gate has been closed, the register must be trimmed, so it never
  // claims a risk that no longer exists.
  const stale = Object.keys(WAIVED).filter(k => FLAGS.DEFS[k] && !FLAGS.bool(k, { store: {}, query: "" }));
  assert.deepEqual(stale, [],
    "these are recorded as waived but now default OFF - remove them from the register: " + stale.join(", "));
});

test("every clinically-gated waiver carries its PUBLIC-RELEASE-GATE marker in the source", () => {
  // The obligation must be greppable in the file someone will actually edit before release.
  ["smd_sknx", "smd_sknx_cloud", "smd_sknx_rx"].forEach(k => {
    const line = SRC.split("\n").find(l => l.indexOf(k + ":") >= 0) || "";
    assert.ok(/PUBLIC-RELEASE-GATE/.test(line),
      k + " is waived ON but its definition carries no PUBLIC-RELEASE-GATE note");
  });
});

test("the two highest-risk waivers state their specific risk, not just that they are on", () => {
  // smd_sknx_cloud sends the image off-device and has no melanoma class; smd_sknx_rx drafts a
  // prescription. Both must say so where they are defined.
  const cloud = SRC.split("\n").find(l => l.indexOf("smd_sknx_cloud:") >= 0) || "";
  assert.ok(/off-device|SENDS the image/i.test(cloud), "smd_sknx_cloud must state that it sends the image off-device");
  assert.ok(/melanoma/i.test(cloud), "smd_sknx_cloud must state that it has no melanoma class");
  const rx = SRC.split("\n").find(l => l.indexOf("smd_sknx_rx:") >= 0) || "";
  assert.ok(/R1|DPDP|R7/.test(rx), "smd_sknx_rx must name the sign-offs it still needs");
});
