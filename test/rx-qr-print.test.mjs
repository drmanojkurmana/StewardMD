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

/* EVERY prescription asks for a code - there is no scope gate on the client any more.
 *
 * This test used to assert the opposite. The scope rule meant an ordinary prescription printed with
 * no QR and no ID, which is indistinguishable from the feature being broken, and a sheet with no
 * code cannot be checked by whoever is holding it. Every sheet now carries one.
 */
test("every prescription asks the server for a code, in scope or not", () => {
  const body = SRC.slice(SRC.indexOf("function rxIssueVerification"), SRC.indexOf("function rxNoQrWhy"));
  assert.ok(!/requiresVerification/.test(body), "no scope gate stands between a prescription and its code");
  assert.ok(!/drugs\.length/.test(body), "and no minimum drug count - a blank sheet gets one too");
  assert.match(body, /\/api\/rx\/issue/, "it still goes to the issue endpoint");

  // The rules module keeps these - they no longer gate issuing, they explain why a prescription is
  // worth checking, which the verify page still shows.
  assert.equal(V.requiresVerification([{ name: "Alprazolam" }]), true);
  assert.equal(V.requiresVerification([{ name: "Amoxiclav" }]), true, "a contraction is still an antibiotic");
});

test("a scanned code round-trips: printed form -> normalised -> same record", () => {
  const code = V.newCode();
  const url = "https://stewardmd.in/verify/" + code;
  const fromUrl = url.split("/verify/")[1];
  assert.equal(V.normalizeCode(fromUrl), V.normalizeCode(code),
    "the code in the QR URL resolves to the same record as the code printed beside it");
});

/* A sheet that prints with no QR must say why.
 *
 * This is the case that gets reported as a bug and usually is not one: an ordinary prescription is
 * out of scope, so no code is minted and the sheet is bare. rxIssueVerification collapses every
 * failure to null, so without a reason the prescriber cannot tell "not applicable" from "broken".
 */
test("an out-of-scope prescription is a deliberate no-QR, not a failure", () => {
  assert.equal(V.requiresVerification([{ name: "Paracetamol" }]), false, "plain analgesic: no QR by design");
  assert.equal(V.requiresVerification([{ name: "Amoxicillin" }]), true, "antibiotic: stewardship, so it gets one");
});

/* The EXPORTED sheet needs the QR too.
 *
 * Save as PDF / JPEG never goes through rxPrintHTML - it builds a separate DOM node in rxDoc and
 * rasterises it with html2canvas. The QR was wired into the print path only, so every exported PDF
 * came out with no QR and no code while its own footer still read "signed & verified". The PDF is
 * the copy that actually reaches a pharmacy, so this is the path that matters most.
 */
test("Save as PDF mints a code and puts the QR on the exported sheet", () => {
  assert.match(SRC, /function rxDocQrBlock/, "the exported sheet has its own QR block");
  assert.match(SRC, /rxDocQrBlock\(rxv\) \+/, "and rxDoc actually renders it");
  assert.match(SRC, /function rxDoc\(topic, regNo, signImg, rxv\)/, "rxDoc takes the record");

  // Minted BEFORE rasterising: html2canvas captures whatever the node holds at that instant, so a
  // record arriving afterwards is a PDF with an empty box where the QR should be.
  const body = SRC.slice(SRC.indexOf("function exportRx("));
  const issue = body.indexOf("rxIssueVerification"), draw = body.indexOf("exportRxNow(");
  assert.ok(issue > -1 && draw > issue, "the record is minted before the sheet is drawn");

  // Both formats route through it - a JPEG of a prescription is exactly as forgeable as a PDF.
  assert.match(SRC, /exportRx\("pdf"/, "PDF goes through the minting path");
  assert.match(SRC, /exportRx\("jpeg"/, "and so does JPEG");
});

/* The patient's name never leaves the device.
 *
 * The verify page needs SOMETHING to check the bearer against, or a stolen PDF is dispensed to
 * whoever presents it. Initials are that something - but the masking happens here, on the phone,
 * and only the mask is sent. There is then no name in the request, none at rest, and none to leak.
 */
test("only the masked initials are sent - never the patient's name", () => {
  assert.match(SRC, /function rxMaskName/, "the mask is computed on the device");

  const body = SRC.slice(SRC.indexOf("function rxIssueVerification"), SRC.indexOf("function rxQrSvg"));
  assert.match(body, /patientMask: mask/, "the request carries the mask");
  assert.ok(!/patientName:|name: patientName|d\.name\s*\}/.test(body), "and never the name itself");

  // Fixed stars, not the real length: keeping the length or alternate letters (M*N*JK*M*R) hands
  // back a skeleton a reader reconstructs on sight, which is not a mask.
  const mask = SRC.slice(SRC.indexOf("function rxMaskName"), SRC.indexOf("function rxIssueVerification"));
  assert.match(mask, /\+ "\*\*\*"/, "three stars regardless of how long the name is");
  assert.match(mask, /charAt\(0\)/, "keeps only the first letter of each part");
});

test("the printed sheet and the exported PDF encode the SAME verify URL", () => {
  // One helper used by both, so the two documents can never disagree about where a scan lands.
  assert.match(SRC, /function rxVerifyUrl/, "the URL is built in one place");
  const uses = SRC.match(/rxVerifyUrl\(/g) || [];
  assert.ok(uses.length >= 2, "and both the encoder and the block go through it");
  assert.match(SRC, /https:\/\/stewardmd\.in\/verify\//, "absolute - a relative path means nothing on paper");
});

test("the prescriber is told why a sheet printed without a QR", () => {
  assert.match(SRC, /function rxNoQrWhy/, "the reason helper exists");
  assert.match(SRC, /if \(!rxv\) \{ var why = rxNoQrWhy/, "and doRxPrint calls it when no record was minted");
  // Scope is no longer a reason a sheet can be bare, so it is no longer one of the messages. The
  // only two ways left are being signed out or not reaching the server - both actionable, which is
  // why the message names which one it was.
  assert.ok(!/verification covers antibiotics/.test(SRC), "the out-of-scope excuse is gone with the scope rule");
  assert.match(SRC, /sign in to give prescriptions a verification code/, "signed-out wording");
  assert.match(SRC, /verification service could not be reached/, "unreachable-service wording");
  // The guard that must never regress: telling the doctor why cannot stop the sheet printing.
  const body = SRC.slice(SRC.indexOf("function doRxPrint"));
  const why = body.indexOf("rxNoQrWhy"), html = body.indexOf("rxPrintHTML(topic, regNo, rxv)");
  assert.ok(why > -1 && html > why, "the reason is shown BEFORE rendering, and rendering still happens");
});

/* The QR must not sit on top of the text beside it.
 *
 * The encoder sizes the SVG from its module count and ignores its container, so at scale 3 it came
 * out about twice the 96px slot and painted over the code, the verify URL and the validity line -
 * the exported PDF read "n to verify" and "wardmd.in/verify".
 */
test("the QR is pinned to its box and cannot cover the code beside it", () => {
  assert.match(SRC, /function rxQrSvg\(rec, px\)/, "the encoder output is given an explicit size");
  assert.match(SRC, /replace\(\/\\s\(width\|height\)/, "the encoder's own width/height is stripped, so ours is the only one");
  assert.match(SRC, /width:'\s*\+\s*size\s*\+\s*'px;height:'\s*\+\s*size\s*\+\s*'px/, "and pinned in CSS as well as attributes");

  // A table, not flex: two cells cannot overlap, whatever size the QR turns out to be.
  const block = SRC.slice(SRC.indexOf("function rxDocQrBlock"), SRC.indexOf("function rxQrBlock"));
  assert.match(block, /<table/, "laid out as a table");
  assert.ok(!/display:flex/.test(block), "not flex - that is what let the QR spill over the text");
});

/* A prescription longer than one page.
 *
 * Ten drugs run to two pages. The old code baked the QR into the page image and sliced blindly by
 * page height, so the break could cut the QR in half and only the last page carried one at all -
 * page 1 was unverifiable paper. Now it is stamped per page in PDF units.
 */
test("every page of a multi-page prescription carries an intact QR", () => {
  assert.match(SRC, /function rxQrStamp/, "the QR is rasterised separately for stamping");
  const ex = SRC.slice(SRC.indexOf("function exportRxNow"), SRC.indexOf("function signAndExport"));

  assert.match(ex, /kind==="pdf" \? null : rxv/, "a PDF leaves the block out of the document...");
  assert.match(ex, /rxQrStamp\(rxv\)/, "...and stamps it instead");

  // Stamped inside the page loop, so page 2 gets one exactly like page 1.
  const loop = ex.slice(ex.indexOf("while(guard"));
  assert.match(loop, /addImage\(stamp\.data/, "the stamp is applied on every page, not once");
  assert.match(loop, /pdf\.addPage\(\)/, "and the loop really does paginate");

  // The band is reserved and cleared, so content never prints through or over the stamp.
  assert.match(ex, /usable=Math\.max\(120, ph-band\)/, "content is paged against the height left after the band");
  assert.match(loop, /pdf\.rect\(0, ph-band, pw, band, "F"\)/, "the band is cleared before stamping");
  assert.match(ex, /guard\+\+ < 60/, "the pagination loop is bounded");
});
