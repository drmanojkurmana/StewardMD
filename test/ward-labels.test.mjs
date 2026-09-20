/* test/ward-labels.test.mjs - the barcode generator and the printed labels (ward-labels.js).
 *
 * Every vector below is copied from a published source, not produced by the code under test:
 * - Code 128 symbol table, the PJJ123C checksum and the X00Y / 098x1234567y23 code-set examples:
 *   https://en.wikipedia.org/wiki/Code_128 (table from ISO/IEC 15417).
 * - QR Reed-Solomon for the 1-M "HELLO WORLD" data codewords, the 32 format strings and the version strings:
 *   https://www.thonky.com/qr-code-tutorial/error-correction-coding and .../format-version-tables (ISO/IEC 18004).
 * The whole symbols are decoded by a real BarcodeDetector in test/run-ward-labels-ui.mjs.
 *
 * node --test test/ward-labels.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../ward-labels.js", import.meta.url), "utf8");
function load(extra) { const sb = { ...(extra || {}) }; sb.window = sb; vm.createContext(sb); vm.runInContext(SRC, sb); return sb.WARD_LABELS; }
const WL = load();
// The sandbox has its own Array and Object, so values are compared as plain data.
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);

test("Code 128 symbol table matches the published patterns (spot checks by value) and every symbol is 11 modules", () => {
  const pattern = (w) => w.split("").map((n, i) => (i % 2 ? "0" : "1").repeat(Number(n))).join("");
  assert.equal(WL.C128.length, 107);
  const PUBLISHED = { 0: "11011001100", 16: "10011101100", 33: "10100011000", 54: "11101011000", 95: "10111101000", 99: "10111011110", 100: "10111101110", 103: "11010000100", 104: "11010010000", 105: "11010011100", 106: "11000111010" };
  for (const [v, p] of Object.entries(PUBLISHED)) assert.equal(pattern(WL.C128[v]), p, "value " + v);
  for (const w of WL.C128) assert.equal([...w].reduce((a, n) => a + Number(n), 0), 11);
  assert.equal(pattern("2331112"), "1100011101011", "the stop pattern");
});

test("Code 128 checksum: the published PJJ123C example (Start A) is 54", () => {
  assert.equal(WL.c128Checksum([103, 48, 42, 42, 17, 18, 19, 35]), 54);
});

test("Code 128 code sets follow the published examples", () => {
  deq(WL.code128Values("X00Y"), [104, 56, 16, 16, 57], "X00Y stays in set B");
  deq(WL.code128Values("098x1234567y23"), [104, 16, 25, 24, 88, 17, 99, 23, 45, 67, 100, 89, 18, 19], "the 16-symbol form");
  deq(WL.code128Values("123456"), [105, 12, 34, 56], "all digits start in set C");
  deq(WL.code128Values("ACC-60916T1015300"), [104, 33, 35, 35, 13, 22, 16, 25, 17, 22, 52, 17, 99, 1, 53, 0], "an accession: a trailing run of 6 digits goes to set C, the odd one first in B");
  const sym = WL.code128("X00Y");
  assert.equal(sym.checksum, (104 + 56 * 1 + 16 * 2 + 16 * 3 + 57 * 4) % 103);
  assert.equal(sym.widths.length, 6 * 6 + 7, "start + 4 data + checksum, then the 7-element stop");
  assert.throws(() => WL.code128(""), /nothing/);
  assert.throws(() => WL.code128("MRNé"), /not printable/);
});

test("QR Reed-Solomon: the published 1-M HELLO WORLD error correction codewords", () => {
  deq(WL.rsEc([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test("QR format strings for level M, all 8 masks, and version strings 7-10, as published", () => {
  const M = ["101010000010010", "101000100100101", "101111001111100", "101101101001011", "100010111111001", "100000011001110", "100111110010111", "100101010100000"];
  M.forEach((bits, mask) => assert.equal(WL.formatBits(mask).toString(2).padStart(15, "0"), bits, "mask " + mask));
  const V = { 7: "000111110010010100", 8: "001000010110111100", 9: "001001101010011001", 10: "001010010011010011" };
  for (const [v, bits] of Object.entries(V)) assert.equal(WL.versionBits(Number(v)).toString(2).padStart(18, "0"), bits, "version " + v);
});

test("QR symbol structure: version by length, finder patterns, timing, the dark module, the format copy", () => {
  const short = WL.qr("SMD-PRT-0042");
  assert.equal(short.version, 1); assert.equal(short.size, 21);
  const m = short.modules;
  const finderRow = (y, x0) => m[y].slice(x0, x0 + 7).map((v) => (v ? 1 : 0)).join("");
  assert.equal(finderRow(0, 0), "1111111"); assert.equal(finderRow(2, 0), "1011101"); assert.equal(finderRow(0, 14), "1111111");
  assert.equal(m[7].slice(0, 8).some(Boolean), false, "separator is light");
  for (let i = 8; i < 13; i++) assert.equal(m[6][i], i % 2 === 0, "timing row");
  assert.equal(m[21 - 8][8], true, "the dark module");
  // Both copies of the 15 format bits agree and name level M with the chosen mask.
  const bit = (x, y) => (m[y][x] ? 1 : 0);
  const a = [], b = [];
  for (let k = 0; k <= 5; k++) a[k] = bit(8, k);
  a[6] = bit(8, 7); a[7] = bit(8, 8); a[8] = bit(7, 8);
  for (let k = 9; k < 15; k++) a[k] = bit(14 - k, 8);
  for (let k = 0; k < 8; k++) b[k] = bit(20 - k, 8);
  for (let k = 8; k < 15; k++) b[k] = bit(8, 21 - 15 + k);
  deq(a, b);
  assert.equal(a.reduce((v, x, k) => v | (x << k), 0), WL.formatBits(short.mask));
  assert.equal(WL.qr("x".repeat(100)).version, 6);
  assert.equal(WL.qr("x".repeat(130)).version, 8);
  assert.equal(WL.qr("x".repeat(213)).version, 10);
  assert.throws(() => WL.qr("x".repeat(214)), /too long/);
  // The data stream: mode 0100, count, bytes, terminator, then pad bytes EC 11.
  const words = WL.qrCodewords([65, 66], 1);
  assert.equal(words.length, 26);
  deq(words.slice(0, 5), [0x40, 0x24, 0x14, 0x20, 0xec]);
});

const SIZES = { wristband: { widthMm: 80, heightMm: 25 }, specimen: { widthMm: 50, heightMm: 25 } };

test("wristband label: name, MRN, DOB and age, sex, allergies, the QR of the band value; the page is the label size", () => {
  const doc = WL.labelDocument("wristband", { name: "Deepa <Kumari>", mrn: "SMD-PRT-0042", dob: "1970-01-01", ageYears: 56, sex: "female", allergies: ["Penicillin", "Sulfa"], bandValue: "SMD-PRT-0042" }, SIZES);
  assert.match(doc, /@page\{size:80mm 25mm;margin:0\}/);
  assert.match(doc, /Deepa &lt;Kumari&gt;/, "escaped");
  assert.match(doc, /SMD-PRT-0042/); assert.match(doc, /1970-01-01/); assert.match(doc, /\(56 y\)/); assert.match(doc, /female/);
  assert.match(doc, /ALLERGY: Penicillin, Sulfa/);
  assert.match(doc, /<svg[^>]*class="qr"[^>]*aria-label="SMD-PRT-0042"/);
  const none = WL.labelDocument("wristband", { name: "A", mrn: "M1", allergies: [], bandValue: "M1" }, null);
  assert.match(none, /Allergies: none recorded/, "an empty list says none recorded, never no known allergies");
  assert.match(none, /@page\{size:75mm 25mm;margin:0\}/, "the default size when the hospital set none");
  const approx = WL.labelDocument("wristband", { name: "B", mrn: "M2", dob: null, ageYears: 52, allergies: [], bandValue: "M2" }, null);
  assert.match(approx, /<i>Age<\/i> 52 y/, "a date of birth the record only estimated is not printed; the age is");
  assert.doesNotMatch(approx, /DOB/);
});

test("specimen, pharmacy and slip labels carry their fields; Code 128 for the accession and the MRN", () => {
  const spec = WL.labelDocument("specimen", { name: "Ravi", mrn: "M-7", accessionNumber: "ACC-60916T1015300", test: "Serum potassium", specimenType: "Serum", collectedAt: "16 Sep 2026, 10:15", collectedBy: "Nurse Asha (E102)" }, SIZES);
  for (const s of ["Ravi", "M-7", "ACC-60916T1015300", "Serum potassium", "Serum", "16 Sep 2026, 10:15", "Nurse Asha (E102)", "@page{size:50mm 25mm;margin:0}"]) assert.ok(spec.includes(s), s);
  assert.match(spec, /<svg[^>]*class="bc"[^>]*aria-label="ACC-60916T1015300"/);
  const ph = WL.labelDocument("pharmacy", { name: "Ravi", mrn: "M-7", drug: "Ceftriaxone", dose: "1 g", route: "IV", frequency: "BD", quantity: "10 vial", batch: "B12", expiry: "2027-01-31", dispensedAt: "16 Sep 2026, 11:00", dispensedBy: "Pharm Lee (P9)" }, null);
  for (const s of ["Ceftriaxone", "1 g · IV · BD", "10 vial", "B12", "2027-01-31", "Pharm Lee (P9)", "@page{size:75mm 50mm;margin:0}"]) assert.ok(ph.includes(s), s);
  const slip = WL.labelDocument("slip", { hospital: "WSQ Ward", name: "Ravi", mrn: "M-7", ageYears: 40, sex: "male", ward: "Medical A", bed: "12", issuedAt: "16 Sep 2026, 09:00" }, null);
  for (const s of ["WSQ Ward", "Ravi", "40 y", "Medical A", "12", "@page{size:80mm 60mm;margin:0}"]) assert.ok(slip.includes(s), s);
  assert.match(slip, /aria-label="M-7"/);
  assert.equal(WL.sizeOf("specimen", { specimen: { widthMm: 5, heightMm: 25 } }).widthMm, 50, "an out-of-range size falls back to the default");
});

test("print hands one whole document to printDocument; an unknown kind or an unencodable value prints nothing", () => {
  const got = [];
  WL.printDocument = (doc) => { got.push(doc); return true; };
  assert.equal(WL.print("specimen", { name: "R", accessionNumber: "ACC-1", test: "K" }, null), true);
  assert.equal(got.length, 1); assert.match(got[0], /^<!doctype html>/);
  assert.equal(WL.print("nope", {}, null), false);
  assert.equal(WL.print("specimen", { accessionNumber: "" }, null), false, "no accession, no label");
  assert.equal(got.length, 1);
});

test("the camera layer's words are catalog keys with byte-identical English (wardsynq/site/i18n.js)", () => {
  const sb = {}; sb.window = sb; vm.createContext(sb); vm.runInContext(readFileSync(new URL("../wardsynq/site/i18n.js", import.meta.url), "utf8"), sb);
  const en = sb.WSQI18n._catalogs.en;
  let n = 0;
  for (const m of SRC.matchAll(/\bt\(("ward\.[^"]*"), ("(?:[^"\\]|\\.)*")/g)) { assert.equal(en[JSON.parse(m[1])], JSON.parse(m[2]), m[1]); n++; }
  assert.ok(n >= 2);
});

test("camera: unsupported without BarcodeDetector or getUserMedia, and scan says so rather than opening anything", async () => {
  assert.equal(WL.cameraSupported(), false);
  deq(await WL.scan(), { error: "unsupported" });
  const W2 = load({ BarcodeDetector: function () {}, navigator: {} });
  assert.equal(W2.cameraSupported(), false, "no camera API");
  const W3 = load({ BarcodeDetector: function () {}, navigator: { mediaDevices: { getUserMedia() {} } } });
  assert.equal(W3.cameraSupported(), true);
});

test("Admin > Hospital label sizes: shows what is saved, saves exactly what the server keeps, refuses a half or out-of-range size", async () => {
  const { labelSizesOf } = await import("../functions/_wardsynq/labels.js");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const c = { esc, ms: () => "" };
  const sb = { window: { WSQ: { page() {} } } }; sb.WSQ = sb.window.WSQ;
  vm.createContext(sb); vm.runInContext(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"), sb);
  const L = sb.window.WSQ._labelSizes;
  const html = L.html(c, { wardsynq: { labelSizes: { specimen: { widthMm: 60, heightMm: 30 } } } });
  assert.match(html, /id="admLbl_specimen_w" value="60"/); assert.match(html, /id="admLbl_specimen_h" value="30"/);
  assert.match(html, /id="admLbl_wristband_w" value="" placeholder="75"/, "an unset size shows the default it prints at");
  assert.doesNotMatch(html, /—/);
  const out = L.read(c, { specimen: ["60", "30"], wristband: ["", ""], pharmacy: [" 100 ", "70"] });
  deq(out, { labelSizes: { specimen: { widthMm: 60, heightMm: 30 }, pharmacy: { widthMm: 100, heightMm: 70 } } });
  deq(labelSizesOf(JSON.parse(JSON.stringify(out.labelSizes))).pharmacy, { widthMm: 100, heightMm: 70 }, "the server keeps what the screen saves");
  assert.match(L.read(c, { slip: ["80", ""] }).error, /^ID slip: give both a width and a height/);
  assert.match(L.read(c, { wristband: ["400", "25"] }).error, /^Patient wristband:/);
});
