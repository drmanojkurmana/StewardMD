/* test/rx-qr-print.test.mjs — the QR that actually gets printed on the prescription.
 *
 * The server side is tested elsewhere (rx-validity, rx-store). What is left is the part a doctor
 * sees: that a real, scannable QR is generated ON DEVICE, that it encodes the verify URL for this
 * prescription, and that failing to reach the server never stops a prescription printing.
 *
 * That last point is the one worth guarding. A doctor at a bedside with no signal must still be
 * able to print; an unverifiable prescription is exactly what exists today, so the QR may only ever
 * ADD assurance and must never withhold the prescription itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const V = require("../rx-validity.js");
const QR = require("../pglog-qr.js");

const SRC = readFileSync(new URL("../prescription.js", import.meta.url), "utf8");

test("the QR encoder is the one already shipped for printed logbooks - no new dependency", () => {
  assert.equal(typeof QR.toSvg, "function");
  const svg = QR.toSvg("https://stewardmd.in/verify/1234-5678-90AB-CDEF", { scale: 3 });
  assert.match(svg, /^<svg/, "a real SVG, generated on device");
  assert.ok(svg.length > 500, "and it has actual modules in it, not an empty frame");
});

test("the printed QR encodes the verify URL for THIS prescription", () => {
  // The URL the QR carries is what a phone camera opens, so it must be the absolute public one -
  // a relative path resolves against nothing when scanned off paper.
  assert.match(SRC, /https:\/\/stewardmd\.in\/verify\//,
    "the printed QR must point at the absolute public verify URL");
  assert.match(SRC, /SMD_PGLOG_QR\.toSvg/, "the QR is rendered on device, not fetched");
  assert.ok(!/api\.qrserver|chart\.googleapis|qrcode\.show/.test(SRC),
    "no third-party QR image service - the sheet must print with no network and no data leaving the device");
});

test("printing is FAIL-OPEN: no token, no network and no scope all still print", () => {
  // rxIssueVerification resolves to null (never rejects) on every failure path, and rxQrBlock
  // renders nothing for null - so the prescription prints without a QR rather than not at all.
  assert.match(SRC, /function rxQrBlock\(rec\) \{[\s\S]{0,80}if \(!rec \|\| !rec\.code\) return "";/,
    "no record -> no QR block, and the sheet is otherwise unchanged");
  assert.match(SRC, /\.catch\(function \(\) \{ return null; \}\)/,
    "a failed issue call resolves to null instead of rejecting");
  assert.match(SRC, /if \(!tok\) return null;/, "not signed in -> print without a QR");
});

test("the patient is never sent to the server when minting a code", () => {
  // The record is PHI-free by construction on the server; this pins the CLIENT half of that promise.
  const body = /body: JSON\.stringify\(\{([^}]*)\}\)/.exec(SRC);
  assert.ok(body, "the issue call posts a JSON body");
  const posted = body[1];
  for (const field of ["name", "age", "patient", "mrn", "phone"]) {
    assert.equal(new RegExp("\\b" + field + "\\b").test(posted), false,
      `the issue call must not post ${field}: ${posted.trim()}`);
  }
  assert.match(posted, /drugs:/, "only the drugs (and country) are posted");
});

test("only in-scope prescriptions call the server at all", () => {
  assert.match(SRC, /SMD_RX_VALIDITY\.requiresVerification\(drugs\)/,
    "scope is decided by the shared rules module, not re-derived in the UI");
  // A routine sheet must not mint a record, so no code is printed on it either.
  assert.equal(V.requiresVerification([{ name: "Amlodipine" }, { name: "Metformin" }]), false);
  assert.equal(V.requiresVerification([{ name: "Alprazolam" }]), true);
});

test("a scanned code round-trips: printed form -> normalised -> same record", () => {
  const code = V.newCode();
  const url = "https://stewardmd.in/verify/" + code;
  const fromUrl = url.split("/verify/")[1];
  assert.equal(V.normalizeCode(fromUrl), V.normalizeCode(code),
    "the code in the QR URL resolves to the same record as the code printed beside it");
});
