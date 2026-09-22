/* test/opd-nfc-barcode.test.mjs — NFC tagging, Code128 file labels, 1-touch tap/scan.
 *
 * Clinics paste an NFC tag onto the patient file and print the same UID as a Code128 barcode
 * + QR on the label; a tap/scan then routes to the right station with no typing.
 *
 *   A: barcode128.js encodes to the published Code 128 chart (spot values + table invariants),
 *      checksums per the spec, and the EMITTED SVG rects decode back to the same symbols.
 *   B: opd.html carries the File Label dialog (openFileLabel), the NFC write (writeNfcTag),
 *      the background NFC + wedge-scanner listeners, ?scan=UID, and station-aware routing.
 *   C: clinic-billing.html carries reviewPatient + its own NFC/wedge listeners.
 *
 * node --test test/opd-nfc-barcode.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BC = require("../barcode128.js");
const OPD = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
const BILL = readFileSync(new URL("../clinic-billing.html", import.meta.url), "utf8");
const GATE = readFileSync(new URL("../functions/_middleware.js", import.meta.url), "utf8");
const REG = readFileSync(new URL("../patient-register.js", import.meta.url), "utf8");
const INDEX = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const NFC = readFileSync(new URL("../smd-nfc.js", import.meta.url), "utf8");

/* ── A. the pattern table, against the published Code 128 chart ────────────── */
test("the table holds 107 symbols with valid module sums", () => {
  assert.equal(BC._patterns.length, 107);
  const seen = new Set();
  BC._patterns.forEach((p, i) => {
    assert.match(p, /^[1-4]+$/, `symbol ${i} uses widths 1-4 only`);
    const sum = [...p].reduce((s, d) => s + Number(d), 0);
    assert.equal(sum, i === 106 ? 13 : 11, `symbol ${i} totals ${i === 106 ? 13 : 11} modules`);
    assert.ok(!seen.has(p), `symbol ${i} duplicates an earlier pattern`);
    seen.add(p);
  });
});

test("start/stop anchors match the published chart", () => {
  assert.equal(BC._patterns[103], "211412"); // Start A
  assert.equal(BC._patterns[104], "211214"); // Start B
  assert.equal(BC._patterns[105], "211232"); // Start C
  assert.equal(BC._patterns[106], "2331112"); // Stop
  assert.equal(BC._startB, 104);
  assert.equal(BC._stop, 106);
});

test("spot values match the published chart (subset B printable range)", () => {
  const spot = { 0: "212222", 16: "123122", 17: "123221", 33: "111323", 48: "313121",
    63: "111224", 64: "111422", 80: "111242", 95: "114113", 99: "113141",
    100: "114131", 101: "311141", 102: "411131" };
  for (const [v, p] of Object.entries(spot)) assert.equal(BC._patterns[Number(v)], p, `value ${v}`);
});

test("subset B maps ASCII 32-126 by minus 32, with a spec checksum", () => {
  assert.deepEqual(BC._encode("A").symbols, [104, 33, 34, 106]); // (104 + 33*1) % 103 = 34
  const e = BC._encode("SMD-AB12CD-0007");
  assert.equal(e.symbols[0], 104);
  assert.equal(e.symbols[e.symbols.length - 1], 106);
  const data = e.symbols.slice(1, -2);
  assert.deepEqual(data, [..."SMD-AB12CD-0007"].map((c) => c.charCodeAt(0) - 32));
  let sum = 104;
  data.forEach((v, i) => { sum += v * (i + 1); });
  assert.equal(e.checksum, sum % 103);
  assert.equal(e.checksum, 43);
  assert.equal(e.symbols[e.symbols.length - 2], 43);
});

test("the encoder refuses what subset B cannot hold", () => {
  assert.throws(() => BC._encode(""), /non-empty/);
  assert.throws(() => BC._encode("héllo"), /unsupported/);
  assert.throws(() => BC._encode("A\nB"), /unsupported/);
  assert.throws(() => BC._encode("x".repeat(65)), /too long/);
});

/* ── A2. the emitted SVG decodes back to the same symbols ──────────────────── */
function decodeSvg(svg, scale) {
  const box = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  assert.ok(box, "the SVG declares a viewBox");
  const W = Number(box[1]);
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)]
    .map((m) => ({ x: Number(m[1]), w: Number(m[3]) }));
  const bars = rects.slice(1); // [0] is the background
  assert.ok(bars.length > 0, "bars exist");
  assert.equal(bars[0].x, 10 * scale, "10-module quiet zone before the first bar");
  const last = bars[bars.length - 1];
  assert.equal(last.x + last.w, W - 10 * scale, "10-module quiet zone after the stop bar");
  const els = [];
  bars.forEach((b, i) => {
    assert.equal(b.w % scale, 0, "bar widths are whole modules");
    els.push(b.w / scale);
    if (i < bars.length - 1) {
      const gap = bars[i + 1].x - (b.x + b.w);
      assert.equal(gap % scale, 0, "space widths are whole modules");
      els.push(gap / scale);
    }
  });
  const syms = [];
  let at = 0;
  while (at < els.length) {
    const lastSym = (els.length - at) === 7;
    const chunk = els.slice(at, at + (lastSym ? 7 : 6)).join("");
    const v = BC._patterns.indexOf(chunk);
    assert.ok(v > -1, `element run ${chunk} is a chart symbol`);
    syms.push(v);
    at += lastSym ? 7 : 6;
  }
  return { W, syms };
}

test("toSvg emits rect bars that decode to the encoded symbols", () => {
  for (const uid of ["SMD-AB12CD-0007", "A", "Token 0014", "X"]) {
    const svg = BC.toSvg(uid);
    assert.ok(svg.startsWith("<svg"), "an <svg> document");
    assert.ok(svg.includes("<rect"), "rect bars, not paths");
    const { syms } = decodeSvg(svg, 2);
    assert.deepEqual(syms, BC._encode(uid).symbols, `round-trip for ${JSON.stringify(uid)}`);
  }
});

test("toSvg sizes the canvas from the module count", () => {
  const n = "SMD-AB12CD-0007".length;
  const W = (10 * 2 + 11 * (n + 2) + 13) * 2;
  const box = /viewBox="0 0 (\d+) (\d+)"/.exec(BC.toSvg("SMD-AB12CD-0007"));
  assert.equal(Number(box[1]), W);
});

test("toSvg captions the UID by default, and toDataUri stays readable", () => {
  const svg = BC.toSvg("SMD-AB12CD-0007");
  assert.match(svg, /<text[^>]*>SMD-AB12CD-0007<\/text>/);
  assert.ok(!BC.toSvg("SMD-AB12CD-0007", { showText: false }).includes("<text"));
  const uri = BC.toDataUri("SMD-AB12CD-0007");
  assert.ok(uri.startsWith("data:image/svg+xml;charset=utf-8,"));
  assert.ok(decodeURIComponent(uri).includes("<svg"));
});

/* ── B. opd.html: the File Label dialog ────────────────────────────────────── */
test("opd.html loads the barcode + QR renderers", () => {
  assert.match(OPD, /<script src="\/pglog-qr\.js\?v=[^"]+"><\/script>/);
  assert.match(OPD, /<script src="\/barcode128\.js\?v=[^"]+"><\/script>/);
});

test("every ticket row carries a File Label button wired to openFileLabel", () => {
  const hits = OPD.match(/data-a="label"/g) || [];
  assert.ok(hits.length >= 2, `both boards render a Label button (found ${hits.length})`);
  assert.match(OPD, /else if\(a==="label"\) openFileLabel\(tid,sid\)/);
});

test("openFileLabel renders clinic, token, patient, date, MRN, barcode, QR, print", () => {
  assert.match(OPD, /function openFileLabel\(ticketId,sid\)/);
  assert.match(OPD, /SMD_BARCODE&&SMD_BARCODE\.toSvg\(uid/);
  assert.match(OPD, /SMD_PGLOG_QR&&SMD_PGLOG_QR\.toSvg\(uid/);
  assert.match(OPD, /Print Label \/ Sticker/);
  assert.match(OPD, /Write NFC Tag/);
  assert.match(OPD, /window\.print\(\)/);
  assert.match(OPD, /@media print/);
  assert.match(OPD, /Token \'/);
  assert.match(OPD, /MRN \'/);
});

test("writeNfcTag writes the UID via NDEFReader.write and fails spoken", () => {
  assert.match(OPD, /function writeNfcTag\(uid\)/);
  assert.match(OPD, /new NDEFReader\(\)/);
  assert.match(OPD, /\.write\(uid\)/);
  assert.match(OPD, /NFC writing is not available/);
});

/* ── B2. opd.html: 1-touch tap/scan ────────────────────────────────────────── */
test("opd.html listens in the background for NFC taps and wedge-scanner bursts", () => {
  assert.match(OPD, /function startNfcListener\(\)/);
  assert.match(OPD, /\.scan\(\)/);
  assert.match(OPD, /onreading=function/);
  assert.match(OPD, /function startScannerListener\(\)/);
  assert.match(OPD, /now-scanLast>45/);
  assert.match(OPD, /e\.key==="Enter"/);
  assert.match(OPD, /startNfcListener\(\);/);
  assert.match(OPD, /startScannerListener\(\);/);
});

test("opd.html honours ?scan=UID once the board has rendered", () => {
  assert.match(OPD, /get\("scan"\)/);
  assert.match(OPD, /function consumePendingScan\(\)/);
  assert.match(OPD, /renderNurseStation\(r\); consumePendingScan\(\)/);
  assert.match(OPD, /renderBoard\(\); consumePendingScan\(\)/);
});

test("a scan routes by station: doctor, nurse, pharmacy, cashier", () => {
  assert.match(OPD, /function handleScannedUid\(uid\)/);
  // Doctor: an active consultation opens the chart, otherwise the tap starts it.
  assert.match(OPD, /openNotes\(hit\.sid,hit\.tid,nm\)/);
  assert.match(OPD, /post\("status",\{sessionId:hit\.sid,ticketId:hit\.tid,status:"in_consultation"\}\)/);
  // Nurse (and the floor roles that take vitals): the vitals sheet.
  assert.match(OPD, /openVitals\(hit\.sid,hit\.tid,nm\)/);
  // Pharmacy: the dispense queue with this patient highlighted.
  assert.match(OPD, /role==="pharmacy"[^]*?station=pharmacy&patientId=/);
  // Cashier: straight to the billing station with the patient preselected.
  assert.match(OPD, /role==="cashier"[^]*?\/clinic-billing\?patientId="\+encodeURIComponent\(uid\)/);
});

/* ── C. clinic-billing.html: instant patient select on scan ────────────────── */
test("clinic-billing.html loads the barcode + QR renderers", () => {
  assert.match(BILL, /<script src="\/pglog-qr\.js\?v=[^"]+"><\/script>/);
  assert.match(BILL, /<script src="\/barcode128\.js\?v=[^"]+"><\/script>/);
});

test("a scan on the billing station instantly reviews the patient", () => {
  assert.match(BILL, /function reviewPatient\(uid\)/);
  assert.match(BILL, /lookupView\(uid\);\s*\n?\s*loadPatient\(uid\);/);
  assert.match(BILL, /function startNfcListener\(\)/);
  assert.match(BILL, /function startScannerListener\(\)/);
  assert.match(BILL, /reviewPatient\(v\)/);
  assert.match(BILL, /now - billScanLast > 45/);
  assert.match(BILL, /get\("scan"\)/);
});

test("the pharmacy station highlights the scanned patient in the dispense queue", () => {
  assert.match(BILL, /renderPharmacy\(\(r\.orders\)\|\|\[\], r\.truncated \? r\.cap : 0, hl\)/);
  assert.match(BILL, /function renderPharmacy\(orders, cap, hl\)/);
  assert.match(BILL, /o\.patientId === hl/);
});

/* ── D. the web gate lets the two renderer scripts through ─────────────────── */
test("the middleware pass-through covers both renderer scripts", () => {
  assert.match(GATE, /url\.pathname === "\/barcode128\.js"/);
  assert.match(GATE, /url\.pathname === "\/pglog-qr\.js"/);
});

/* ── E. walk-in tagging: registration ends in Write NFC Tag, never a silent close ── */
test("the check-in done card offers 1-touch NFC write (+ File Label on the console)", () => {
  assert.match(REG, /id="prWriteNfc" data-a="write-nfc"/);
  assert.match(REG, /data-a="print-label"/);
  assert.match(REG, /root\.openFileLabel/, "the label button exists only where the dialog does");
  assert.match(REG, /var NFC = root\.SMD_NFC/);
  assert.match(REG, /NFC\.writeTag\(\{ text: sid \|\| mrn, url: "https:\/\/stewardmd\.in\/opd\?uid=" \+ encodeURIComponent\(sid \|\| mrn\) \}, \{ verifyReadBack: true \}\)/, "Wave 3: the canonical StewardID (or MRN) with read-back verification");
  assert.match(REG, /Hold tag against phone\.\.\./);
  assert.match(REG, /NFC Tag Written!/);
  assert.match(REG, /Could not write the tag\. Try again\./);
});

test("a pending temporary ID is never offered for a tag or a label", () => {
  assert.match(REG, /if \(!pending && res\.mrn\)/);
});

test("a console walk-in add ends in a tag-the-folder confirmation", () => {
  assert.match(OPD, /if\(tkt\) openWalkinDone\(tkt\)/);
  assert.match(OPD, /function openWalkinDone\(tkt\)/);
  assert.match(OPD, /Walk-in Patient Added/);
  assert.match(OPD, /id="wNfc"/);
  assert.match(OPD, /writeNfcTag\(uhid\)/);
  assert.match(OPD, /Print File Label/);
  assert.match(OPD, /openFileLabel\(tkt\.id\)/);
});

test("the console exposes its label dialog to the shared check-in sheet", () => {
  assert.match(OPD, /window\.openFileLabel=openFileLabel/);
});

/* ── F. follow-up tap: an unknown UHID offers check-in + full chart ─────────── */
test("a scan with no queue entry opens the follow-up card, not a dead end", () => {
  assert.match(OPD, /if\(!hit\)\{ openFollowupCard\(uid\); return; \}/);
  assert.match(OPD, /function openFollowupCard\(uid\)/);
  assert.match(OPD, /Follow-up Patient Scanned/);
  assert.match(OPD, /Queue for Consultation/);
  assert.match(OPD, /Open Full Patient Chart/);
  assert.match(OPD, /post\("ticket",\{sessionId:sVal,name:nm,mrn:uid,visitType:"followup"\}/);
  assert.match(OPD, /OPDEMR\.openProfile\(\{patientId:uid,mrn:uid\}\)/);
});

test("the written deep link (?uid=) is honoured like ?scan=", () => {
  assert.match(OPD, /_pq\.get\("scan"\)\|\|_pq\.get\("uid"\)\|\|_pq\.get\("patientId"\)/);
});

/* ── G. the app shell routes taps to the full chart, blanks to the sheet ────── */
test("index.html loads the NFC bridge and boots the app listener", () => {
  assert.match(INDEX, /<script src="\/smd-nfc\.js\?v=nfc-2" defer><\/script>/);
  assert.match(INDEX, /SMD_NFC\.initAppListener\(\{/);
  assert.match(INDEX, /onUhid: onNfcUhid/);
  assert.match(INDEX, /NFC Tag: UHID " \+ uhid/);
  assert.match(INDEX, /_openTicketEmr\(t\.id\)/, "a queued patient opens through the workplace router");
  assert.match(INDEX, /OPDEMR\.openProfile\(\{ patientId: uhid, mrn: uhid, name: "Patient " \+ uhid \}\)/, "a follow-up opens the full chart by UHID");
  assert.match(INDEX, /currentPatient: function/, "the blank-tag sheet can write the open patient");
});

test("smd-nfc.js carries the parser, the sheet and the listener", () => {
  assert.match(NFC, /parseTagUhid: parseTagUhid/);
  assert.match(NFC, /isEmptyTag: isEmptyTag/);
  assert.match(NFC, /showEmptyTagPrompt: showEmptyTagPrompt/);
  assert.match(NFC, /initAppListener: function \(options\)/);
  assert.match(NFC, /NFC Tag Detected \(Empty \/ Blank\)/);
  assert.match(NFC, /Write Current Patient \(/);
  assert.match(NFC, /Write to Tag/);
});
