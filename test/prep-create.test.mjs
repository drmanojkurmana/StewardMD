/* PrepNucleus Layer C client (prep-source.js, prep-decks.js, prep-create.js, prep-cards.js): every pure helper.
 * What must hold: sentences are numbered once across the whole document with their page and heading; headings split
 * sections (font size in a PDF, "#", caps or colon lines in notes); running headers, footers and page numbers drop;
 * the 60-page and 300,000-character caps hold; prepScrub removes personal details and keeps every other number and
 * every newline; the step loop runs facts until 14 unused facts, mcq x2, solve x2, review x2, one batched regen, saves
 * only what passed, stops on a cap with what it has and resumes with the same idem; "10 more" sends only unused facts;
 * a 504 is retried once after 4 s with the same idem; every error code has a short message; server items map to the
 * runner's stored format (_s "deck", _m "deck-<id>") and cards to FSRS under "p:cards-<id>".
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-create.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const req = createRequire(import.meta.url);
const SR = req("../prep-source.js");
const DK = req("../prep-decks.js");
const PC = req("../prep-create.js");
const CARDS = req("../prep-cards.js");
const C = req("../specialty-core.js");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------- fixtures ---------------- */
const NOTES = [
  "# Iron deficiency anaemia",
  "Iron deficiency is the commonest cause of anaemia in Indian women of reproductive age.",
  "Serum ferritin below 15 ng/mL confirms depleted iron stores.",
  "Microcytic hypochromic red cells with pencil forms are typical on the peripheral smear.",
  "Oral ferrous sulphate 200 mg three times daily supplies about 180 mg elemental iron.",
  "Haemoglobin should rise by roughly 2 g/dL within three weeks of adequate oral therapy.",
  "Parenteral ferric carboxymaltose suits patients intolerant of tablets.",
  "",
  "MEGALOBLASTIC ANAEMIA",
  "Vitamin B12 deficiency causes subacute combined degeneration of the spinal cord.",
  "Hypersegmented neutrophils with five or more lobes appear early in folate deficiency.",
  "Pernicious anaemia results from autoantibodies against gastric intrinsic factor.",
  "Folic acid alone may worsen neurological damage when cobalamin is also lacking.",
  "Strict vegetarians frequently develop dietary cobalamin shortage over several years.",
  "Methylmalonic acid rises in cobalamin deficiency but stays normal with folate lack.",
  "",
  "Haemolytic anaemia:",
  "Spherocytes and raised osmotic fragility point towards hereditary spherocytosis.",
  "Glucose six phosphate dehydrogenase deficiency triggers haemolysis after primaquine exposure.",
  "Bite cells and Heinz bodies accompany oxidant injury to erythrocytes.",
  "Direct antiglobulin testing distinguishes immune destruction from intrinsic membrane defects.",
  "Splenectomy reduces transfusion needs in severe spherocytosis after early childhood.",
  "Raised unconjugated bilirubin and reticulocytosis reflect brisk erythrocyte turnover.",
].join("\n");

const ctx = { doc: "abc123abc123", name: "Haematology notes", exam: "neet-pg", pv: "p1", model: "gemini-3.1-flash-lite" };

/* ---------------- sha ---------------- */
test("sha256 matches node crypto (ASCII, Unicode, block edges, long input)", () => {
  for (const s of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "Hb 7 g/dL \u20B9 \uD83D\uDE00 \u00FC", "x".repeat(70000)]) {
    assert.equal(DK.sha256(s), createHash("sha256").update(s, "utf8").digest("hex"), "len " + s.length);
  }
  assert.equal(DK.sha12("abc"), createHash("sha256").update("abc").digest("hex").slice(0, 12));
});

/* ---------------- sentence numbering and headings ---------------- */
test("notes: sentences numbered across the whole document with page and heading; headings split sections", () => {
  const d = SR.docFromNotes(NOTES, "Notes");
  assert.equal(d.sents.length, 18);
  d.sents.forEach((s, i) => assert.equal(s.n, i + 1));
  assert.deepEqual(d.sections.map((s) => s.title), ["Iron deficiency anaemia", "MEGALOBLASTIC ANAEMIA", "Haemolytic anaemia"]);
  assert.deepEqual(d.sections.map((s) => s.id), ["sec-0", "sec-1", "sec-2"]);
  assert.equal(d.sents[0].h, "Iron deficiency anaemia");
  assert.equal(d.sents[6].h, "MEGALOBLASTIC ANAEMIA");
  assert.equal(d.sents[6].s, "sec-1");
  assert.equal(d.sents[17].s, "sec-2");
  assert.ok(d.sents.every((s) => s.p === 1));
  // A form feed starts a new page; numbering continues across it.
  const two = SR.docFromNotes("First page fact one is here.\fSecond page fact two is here. And a third one.", "T");
  assert.deepEqual(two.sents.map((s) => [s.n, s.p]), [[1, 1], [2, 2], [3, 2]]);
});

test("sentence split: abbreviations, initials, decimals and bullets", () => {
  assert.deepEqual(SR.splitSentences("Give 1.5 mg/kg, e.g. in sepsis. Dr. Rao agreed. J. Smith wrote it. Next one?"),
    ["Give 1.5 mg/kg, e.g. in sepsis.", "Dr. Rao agreed.", "J. Smith wrote it.", "Next one?"]);
  const d = SR.docFromNotes("Causes:\n- iron loss from bleeding\n- poor dietary intake\n1. hookworm infestation", "T");
  assert.deepEqual(d.sents.map((s) => s.tx), ["iron loss from bleeding", "poor dietary intake", "hookworm infestation"]);
  assert.equal(d.sections[0].title, "Causes");
  // A very long run-on line is cut so no sentence exceeds 500 characters.
  const long = SR.splitSentences(("word ").repeat(300));
  assert.ok(long.length >= 3 && long.every((s) => s.length <= 500));
});

test("notes headings: # lines, short caps lines, short colon lines; not ordinary sentences", () => {
  assert.equal(SR.isNoteHeading("## Treatment"), true);
  assert.equal(SR.isNoteHeading("CLINICAL FEATURES"), true);
  assert.equal(SR.isNoteHeading("Investigations:"), true);
  assert.equal(SR.isNoteHeading("Ferritin is low in iron deficiency."), false);
  assert.equal(SR.isNoteHeading("Dose: 1 g IV"), false);
});

const item = (str, size, x, y, extra) => Object.assign({ str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, hasEOL: false }, extra || {});
test("PDF text layer: font size from transform, lines by baseline, heading split by size", () => {
  assert.equal(SR.fontSize([12, 0, 0, 12, 50, 700]), 12);
  assert.equal(SR.fontSize([0, 18, -18, 0, 0, 0]), 18);   // rotated text keeps its size
  assert.equal(SR.fontSize(null), 0);
  const items = [
    item("Acute leukaemia", 20, 50, 760, { hasEOL: true }),
    item("Acute myeloid leukaemia shows more than 20% myeloblasts in the", 11, 50, 730),
    item("marrow.", 11, 50, 716, { hasEOL: true }),
    item("Auer rods are needle shaped granule ", 11, 50, 702),
    item("aggregates.", 11, 230, 702, { hasEOL: true }),
    item("Management", 16, 50, 670, { hasEOL: true }),
    item("Induction uses cytarabine with an anthracycline for seven plus three days.", 11, 50, 650, { hasEOL: true }),
  ];
  const lines = SR.itemsToLines(items);
  assert.deepEqual(lines.map((l) => l.size), [20, 11, 11, 11, 16, 11]);
  assert.equal(lines[3].tx, "Auer rods are needle shaped granule aggregates.");
  const d = SR.docFromPdfPages([{ p: 7, lines }], "AML.pdf");
  assert.deepEqual(d.sections.map((s) => s.title), ["Acute leukaemia", "Management"]);
  assert.deepEqual(d.sents.map((s) => [s.n, s.p, s.h]), [[1, 7, "Acute leukaemia"], [2, 7, "Acute leukaemia"], [3, 7, "Management"]]);
  assert.equal(d.sents[0].tx, "Acute myeloid leukaemia shows more than 20% myeloblasts in the marrow.");
  // Items on one baseline with a gap get a space; a line-end hyphen joins the word.
  const hy = SR.docFromPdfPages([{ p: 1, lines: [{ tx: "Thrombo-", size: 11 }, { tx: "cytopenia follows chemotherapy. Platelets fall early.", size: 11 }] }], "x");
  assert.equal(hy.sents[0].tx, "Thrombocytopenia follows chemotherapy.");
});

test("PDF cleaning: running headers, footers and page numbers drop; a sentence keeps the page it starts on", () => {
  const body = [
    ["Marrow failure presents with pancytopenia.", "Aplastic anaemia follows drugs, viruses or", "radiation in many adults."],
    ["Fanconi anaemia is inherited and shows", "thumb anomalies with short stature.", "Chromosome breakage testing confirms it."],
    ["Paroxysmal nocturnal haemoglobinuria lacks", "CD55 and CD59 on red cells.", "Flow cytometry is the test of choice."],
    ["Pure red cell aplasia may accompany", "thymoma in older patients.", "Parvovirus B19 causes transient aplastic crisis."],
  ];
  const pages = body.map((b, k) => ({ p: k + 1, lines: [{ tx: "Harrison Chapter 104", size: 9 }].concat(b.map((tx) => ({ tx, size: 11 })), [{ tx: "Page " + (k + 1) + " of 4", size: 9 }]) }));
  const d = SR.docFromPdfPages(pages, "H.pdf");
  assert.ok(!d.sents.some((s) => /Harrison Chapter|Page \d/.test(s.tx)), "header and page numbers removed");
  assert.deepEqual(d.sents.map((s) => s.tx), [
    "Marrow failure presents with pancytopenia.", "Aplastic anaemia follows drugs, viruses or radiation in many adults.",
    "Fanconi anaemia is inherited and shows thumb anomalies with short stature.", "Chromosome breakage testing confirms it.",
    "Paroxysmal nocturnal haemoglobinuria lacks CD55 and CD59 on red cells.", "Flow cytometry is the test of choice.",
    "Pure red cell aplasia may accompany thymoma in older patients.", "Parvovirus B19 causes transient aplastic crisis."]);
  assert.deepEqual(d.sents.map((s) => s.p), [1, 1, 2, 2, 3, 3, 4, 4]);
  // A sentence that runs across a page break keeps its first page.
  const span = SR.docFromPdfPages([{ p: 4, lines: [{ tx: "Blasts crowd the", size: 11 }] }, { p: 5, lines: [{ tx: "marrow space. Then anaemia follows.", size: 11 }] }], "x");
  assert.deepEqual(span.sents.map((s) => [s.n, s.p]), [[1, 4], [2, 5]]);
});

/* ---------------- scanned pages (Phase 3b): OCR fallback ---------------- */
const GARBAGE = Array.from({ length: 40 }, (_, i) => String.fromCharCode(0xFFFD, 0x25A1 + (i % 3)) + "x" + String.fromCharCode(0xE000 + i)).join(" ");
const BODY = "Acute myeloid leukaemia shows more than twenty percent myeloblasts in the marrow. Auer rods are needle shaped granules. Disseminated intravascular coagulation complicates the promyelocytic subtype. Induction uses cytarabine.";
test("non-word share and the per-page decision: under 200 characters or over 10% non-words goes to OCR", () => {
  assert.equal(SR.nonWordRatio("Iron 100 mg daily, B12 and PML-RARA t(15;17) at 37.5 C in 90% of cases."), 0);
  assert.equal(SR.nonWordRatio(String.fromCharCode(0x2022) + " Iron - low -- " + String.fromCharCode(0x2013) + " stores"), 0, "bullets and dashes are not counted");
  assert.ok(SR.nonWordRatio(GARBAGE) > 0.9);
  assert.ok(SR.nonWordRatio(BODY + " " + String.fromCharCode(0xFFFD)) < 0.1);
  const good = [{ tx: BODY }], short = [{ tx: "Index" }], bad = [{ tx: GARBAGE + " " + BODY }];
  assert.deepEqual(SR.pageDecision(good, true), { use: "text", why: "" });
  assert.deepEqual(SR.pageDecision([], true), { use: "ocr", why: "no-text" });
  assert.deepEqual(SR.pageDecision(short, true), { use: "ocr", why: "little-text" });
  assert.deepEqual(SR.pageDecision(bad, true), { use: "ocr", why: "garbled" });
  // Web build (no OCR): a short page keeps its text, an empty one or a garbled one is skipped.
  assert.deepEqual(SR.pageDecision(short, false), { use: "text", why: "little-text" });
  assert.deepEqual(SR.pageDecision([], false), { use: "skip", why: "no-text" });
  assert.deepEqual(SR.pageDecision(bad, false), { use: "skip", why: "garbled" });
  assert.deepEqual(SR.ocrToLines({ text: "TREATMENT\n  Give ATRA early.  \n\n" }), [{ tx: "TREATMENT", size: 0, ocr: true }, { tx: "Give ATRA early.", size: 0, ocr: true }]);
  assert.deepEqual(SR.ocrToLines({ lines: ["A line"], text: "ignored" }), [{ tx: "A line", size: 0, ocr: true }]);
});

const it11 = (str, y) => ({ str, transform: [11, 0, 0, 11, 50, y], width: str.length * 5, hasEOL: true });
function mockPdf(pages) {
  return { getPage: async (p) => ({ id: p, getTextContent: async () => ({ items: pages[p] || [] }) }) };
}
const PDF = {
  1: [it11(BODY, 700)],                                    // a digital page
  2: [],                                                   // a scan: no text layer
  3: [it11(GARBAGE, 700)],                                 // a broken text layer
  4: [it11("Index", 700)],                                 // a short digital page
  5: [],                                                   // a scan OCR cannot read
};
const OCR_TEXT = { 2: "MANAGEMENT\nInduction combines cytarabine with an anthracycline for seven days.\nAll trans retinoic acid treats the promyelocytic subtype.",
  3: "Tumour lysis is prevented with hydration and allopurinol.", 4: "Ix" };
test("readPages: text layer first, then on-device OCR for scanned or garbled pages; progress; failures and the cap", async () => {
  const seen = [], progress = [];
  const ocr = async (img) => { seen.push(img); const p = Number(img.slice(-1)); if (p === 5) throw new Error("vision failed"); return { text: OCR_TEXT[p] || "" }; };
  const render = async (page) => "data:image/jpeg;base64,PAGE" + page.id;
  const rd = await SR.readPages(mockPdf(PDF), [1, 2, 3, 4, 5], (d, n, ph) => progress.push(ph + d + "/" + n), { ocr, render });
  assert.deepEqual(seen, ["data:image/jpeg;base64,PAGE2", "data:image/jpeg;base64,PAGE3", "data:image/jpeg;base64,PAGE4", "data:image/jpeg;base64,PAGE5"], "only pages that need it are rendered and OCR'd");
  assert.deepEqual(progress, ["text1/5", "text2/5", "text3/5", "text4/5", "text5/5", "ocr1/4", "ocr2/4", "ocr3/4", "ocr4/4"]);
  assert.deepEqual(rd.ocrPages, [2, 3]);
  assert.deepEqual(rd.skipped, [{ p: 5, why: "ocr-failed" }]);
  assert.deepEqual(rd.scanned, [2, 3, 4, 5]);
  assert.deepEqual(rd.pages.map((pg) => [pg.p, !!pg.ocr]), [[1, false], [2, true], [3, true], [4, false]], "page 4 keeps its text layer: OCR read less");
  // The same sentence pipeline: numbered across the document, OCR pages marked, caps-line heading from OCR.
  const doc = SR.docFromPdfPages(rd.pages, "AML.pdf");
  assert.deepEqual(doc.ocrPages, [2, 3]);
  const ocrS = doc.sents.filter((x) => x.o);
  assert.deepEqual(ocrS.map((x) => x.p), [2, 2, 3]);
  assert.equal(ocrS[0].h, "MANAGEMENT");
  assert.ok(doc.sents.every((x, i) => x.n === i + 1));
  assert.ok(!doc.sents.some((x) => x.tx === "MANAGEMENT"), "the OCR heading is not sent as a sentence");
  const chunk = SR.chunkPayload(SR.chunkSentences(doc.sents)[0]);
  assert.ok(chunk.sents.every((x) => !("o" in x)), "the OCR mark stays on the phone");
  assert.equal(PC.readNote(rd, true), "2 pages read by on-device OCR. 1 page could not be read by OCR.");
});

test("readPages without OCR (web build) and with the OCR page cap", async () => {
  const web = await SR.readPages(mockPdf(PDF), [1, 2, 3, 4, 5]);
  assert.deepEqual(web.ocrPages, []);
  assert.deepEqual(web.skipped, [{ p: 2, why: "no-text" }, { p: 3, why: "garbled" }, { p: 5, why: "no-text" }]);
  assert.deepEqual(web.pages.map((pg) => pg.p), [1, 4]);
  assert.equal(PC.readNote(web, false), "2 pages skipped: scanned pages are read only in the StewardMD phone app, not on the web. 1 page skipped: their text could not be read cleanly.");
  const scanOnly = await SR.readPages(mockPdf(PDF), [2, 5]);
  assert.equal(scanOnly.pages.length, 0);
  assert.match(PC.unreadableMessage(scanOnly, false), /read only in the StewardMD phone app, not on the web/);
  assert.match(PC.unreadableMessage({ skipped: [{ p: 3, why: "garbled" }] }, false), /could not be read cleanly/);
  assert.match(PC.unreadableMessage({ skipped: [{ p: 2, why: "ocr-failed" }] }, true), /No readable text/);
  let calls = 0;
  const capped = await SR.readPages(mockPdf(PDF), [2, 3, 5], null, { ocrCap: 1, render: async (pg) => "img" + pg.id, ocr: async (img) => { calls++; return { text: OCR_TEXT[Number(img.slice(-1))] || "" }; } });
  assert.equal(calls, 1, "OCR stops at the page cap");
  assert.deepEqual(capped.ocrPages, [2]);
  assert.deepEqual(capped.skipped, [{ p: 3, why: "ocr-cap" }, { p: 5, why: "ocr-cap" }], "past the cap a page needing OCR is skipped and says why");
  assert.equal(PC.readNote(capped, true), "1 page read by on-device OCR. 2 pages skipped: up to 20 scanned pages are read by OCR in one deck.");
  // A slow OCR call is abandoned at its time limit and the page is reported.
  const slow = await SR.readPages(mockPdf(PDF), [2], null, { ocrMs: 30, render: async () => "img", ocr: () => new Promise(() => {}) });
  assert.deepEqual(slow.skipped, [{ p: 2, why: "ocr-failed" }]);
  assert.equal(SR.OCR_PAGE_CAP, 20);
});

/* ---------------- page picker and caps ---------------- */
test("page picker and the 60-page cap", () => {
  assert.deepEqual(SR.parsePages("1-3, 5, 3", 10), { pages: [1, 2, 3, 5] });
  assert.deepEqual(SR.parsePages("8-12", 10), { pages: [8, 9, 10] });
  assert.match(SR.parsePages("1-61", 200).error, /60 pages or fewer/);
  assert.equal(SR.parsePages("1-60", 200).pages.length, 60);
  assert.match(SR.parsePages("", 10).error, /at least one page/);
  assert.match(SR.parsePages("abc", 10).error, /1-20, 25/);
  assert.match(SR.parsePages("5-2", 10).error, /1-20, 25/);
  assert.match(SR.parsePages("11", 10).error, /has 10 pages/);
  assert.equal(SR.defaultPages(200), "1-60");
  assert.equal(SR.defaultPages(12), "1-12");
  assert.deepEqual(SR.pageSpan([3, 4, 9]), [3, 9]);
});

test("deck caps: too little text, too much text, too many pages", () => {
  const ok = SR.docFromNotes(NOTES, "N");
  assert.equal(SR.capCheck(ok, 1).ok, true);
  assert.match(SR.capCheck(SR.docFromNotes("Short. Notes. Here.", "N"), 1).error, /too little text/);
  const big = { sents: Array.from({ length: 700 }, (_, i) => ({ tx: "x".repeat(450) + i })) };
  assert.match(SR.capCheck(big, 10).error, /too much text/);
  assert.match(SR.capCheck(ok, 61).error, /60 pages or fewer/);
  assert.equal(SR.CHARS_CAP, 300000);
  assert.equal(SR.PAGE_CAP, 60);
});

/* ---------------- prepScrub ---------------- */
test("prepScrub: removes personal details, keeps every other number and every newline", () => {
  const t = [
    "HAEMATOLOGY WARD PROTOCOL 2024",
    "Patient name: Ramesh Kumar, 45 M",
    "MRN: 4455667 UHID 22-3344 IP No. 7788 bed 12 Ward 4B",
    "Call +91 98765 43210 or 9876543210 or 080-2345-6789, mail ramesh.k@example.com",
    "Aadhaar 2345 6789 0123",
    "Dose | 1000 mg | q8h",
    "WBC 12,400 /uL, platelets 1,50,000, cases in 2019 2020 2021 rose; bed rest and ward rounds daily.",
  ].join("\n");
  const f = SR.scrubFind(t);
  assert.deepEqual({ email: f.email, phone: f.phone, aadhaar: f.aadhaar, name: f.name }, { email: 1, phone: 3, aadhaar: 1, name: 1 });
  assert.equal(f.id, 5);
  const out = SR.prepScrub(t);
  assert.equal(out.split("\n").length, 7, "newlines kept");
  for (const keep of ["HAEMATOLOGY WARD PROTOCOL 2024", "1000 mg", "q8h", "WBC 12,400", "1,50,000", "2019 2020 2021", "bed rest", "ward rounds", "Dose | 1000 mg | q8h"]) assert.ok(out.includes(keep), "kept " + keep);
  for (const gone of ["Ramesh", "4455667", "22-3344", "7788", "bed 12", "Ward 4B", "98765", "9876543210", "2345-6789", "example.com", "2345 6789 0123"]) assert.ok(!out.includes(gone), "removed " + gone);
  assert.equal(SR.scrubFind("Iron 100 mg daily for 3 months; Hb 7.2 g/dL in 2023.").total, 0);
  assert.equal(SR.scrubSummary({ name: 1, phone: 2, email: 0, aadhaar: 1, id: 0 }), "1 patient name, 2 phone numbers, 1 Aadhaar-like number");
});

/* ---------------- chunks ---------------- */
test("chunks stay inside a section and under the token budget; first chunk of each section comes first", () => {
  const d = SR.docFromNotes(NOTES, "N");
  const cs = SR.chunkSentences(d.sents, 60);
  assert.ok(cs.length > 3);
  cs.forEach((c, i) => { assert.equal(c.i, i); assert.ok(c.sents.every((s) => s.s === c.sec)); assert.ok(c.tok <= 60 || c.sents.length === 1); });
  const order = SR.chunkOrder(cs);
  const secs = order.map((i) => cs[i].sec);
  assert.deepEqual(secs.slice(0, 3), ["sec-0", "sec-1", "sec-2"]);
  assert.deepEqual(order.slice().sort((a, b) => a - b), cs.map((c) => c.i));
  assert.deepEqual(Object.keys(SR.chunkPayload(cs[0]).sents[0]).sort(), ["h", "n", "p", "tx"], "the local section id stays on the phone");
  assert.equal(SR.chunkSentences(d.sents).length, 3, "default budget: one chunk per section here");
});

/* ---------------- ids, idem, mix, lines ---------------- */
test("idem key: sha12 of op plus payload, stable, ignores an existing idem; deck id is gen_<sha12>", () => {
  const body = { op: "facts", deckId: "gen_x", exam: "neet-pg", profileV: 1, pv: "p1", chunk: { i: 0, sents: [{ n: 1, p: 1, h: "", tx: "A" }] } };
  const k = PC.idemKey("facts", body);
  assert.match(k, /^[0-9a-f]{12}$/);
  assert.equal(k, DK.sha12("facts" + JSON.stringify(body)));
  assert.equal(PC.idemKey("facts", Object.assign({ idem: "zzz" }, body)), DK.sha12("facts" + JSON.stringify(body)));
  assert.notEqual(PC.idemKey("facts", Object.assign({}, body, { chunk: { i: 1, sents: [] } })), k);
  assert.notEqual(PC.idemKey("mcq", body), k);
  const id = PC.deckIdFor({ uid: "u1", sha: "s", exam: "neet-pg", profileV: 1 });
  assert.match(id, /^gen_[0-9a-f]{12}$/);
  assert.equal(id, "gen_" + DK.sha12("u1|s|neet-pg|1|p1|gemini-3.1-flash-lite"));
  assert.notEqual(PC.deckIdFor({ uid: "u2", sha: "s", exam: "neet-pg", profileV: 1 }), id);
});

test("mix from the profile: weights 0 to 1 that sum to 1", () => {
  // The server reads weights 0 to 1 (a count map would be a 400 bad-input "mix").
  const m = PC.mixFor(7);
  assert.deepEqual(m.dl, { 1: 0.3, 2: 0.5, 3: 0.2 });
  assert.deepEqual(m.cog, { recall: 0.4, application: 0.4, reasoning: 0.2 });
  assert.deepEqual(PC.mixFor(3, { d: { 1: 2, 2: 2 }, cog: { recall: 1 } }), { dl: { 1: 0.5, 2: 0.5 }, cog: { recall: 1 } });
  assert.ok(Object.values(m.dl).every((v) => v >= 0 && v <= 1));
});

test("cap and cost lines from the server's counters", () => {
  const caps = PC.capsFrom({ monthDecks: 7, dayDecks: 2 }, "2026-10-05");
  assert.equal(PC.capLine(caps, "2026-10-05"), "7 of 10 decks this month, 2 of 3 today");
  assert.equal(PC.capLine(caps, "2026-10-06"), "7 of 10 decks this month");
  assert.equal(PC.capLine(caps, "2026-11-01"), "");
  assert.equal(PC.capsFrom({ inTok: 4 }, "2026-10-05"), null);
  assert.deepEqual(PC.capsAfterStop(caps, "month-decks", "2026-10-05"), { month: 10, day: 2, at: "2026-10-05" });
  assert.deepEqual(PC.capsAfterStop(caps, "daily-decks", "2026-10-06"), { month: 7, day: 3, at: "2026-10-06" });
  assert.deepEqual(PC.capsAfterStop(null, "month-decks", "2026-10-06"), { month: 10, day: null, at: "2026-10-06" });
  assert.equal(PC.capsAfterStop(caps, "ai-failed", "2026-10-05"), caps);
  const cost = PC.addUsage(PC.addUsage({ inTok: 0, outTok: 0, thinkTok: 0, inr: 0 }, { inTok: 1000, outTok: 200, thinkTok: 0, inr: 0.054 }), { inTok: 500, outTok: 100, inr: 0.02 });
  assert.deepEqual(cost, { inTok: 1500, outTok: 300, thinkTok: 0, inr: 0.074 });
  assert.equal(PC.costLine(cost), "AI cost so far: Rs 0.07 (1800 tokens)");
  assert.equal(PC.costLine({ inTok: 0, outTok: 0 }), "");
});

/* ---------------- errors ---------------- */
test("every error code maps to a short plain message; both { error } and { reason } shapes", () => {
  const cases = [
    [400, { error: "bad-input" }, "bad-input"], [401, {}, "sign-in"], [402, { error: "needs-plan" }, "needs-plan"], [413, { error: "too-large" }, "too-large"],
    [429, { error: "rate" }, "rate"], [429, { error: "limit", reason: "circuit-breaker" }, "circuit-breaker"], [429, { reason: "daily-calls" }, "daily-calls"],
    [429, { error: "daily-decks" }, "daily-decks"], [429, { error: "month-decks", reason: "month-decks" }, "month-decks"], [429, { reason: "token-cap" }, "token-cap"],
    [502, { error: "ai-failed" }, "ai-failed"], [504, null, "ai-timeout"], [0, null, "offline"], [500, { error: "boom" }, "unknown"], [429, {}, "rate"],
  ];
  for (const [st, body, code] of cases) {
    assert.equal(PC.errorCode(st, body), code, st + " " + JSON.stringify(body));
    const msg = PC.errorMessage(st, body);
    assert.ok(msg && msg.length < 110 && /\.$/.test(msg) && !/[\u2013\u2014]/.test(msg), code + ": " + msg);
  }
  assert.match(PC.errorMessage(429, { error: "month-decks" }), /10 decks this month/);
  assert.match(PC.errorMessage(429, { reason: "daily-decks" }), /3 decks today/);
  assert.equal(PC.errorCode(400, { error: "bad-input", reason: "deck-not-started" }), "deck-not-started");
  assert.equal(PC.canRetry("deck-not-started"), false);
  assert.equal(PC.canRetry("month-decks"), false);
  assert.equal(PC.canRetry("ai-timeout"), true);
  assert.equal(PC.shouldRetry(504, 0), 4000);
  assert.equal(PC.shouldRetry(504, 1), 0);
  assert.equal(PC.shouldRetry(502, 0), 0);
  assert.equal(PC.shouldRetry(429, 0, "rate", 5), 5000);
  assert.equal(PC.shouldRetry(429, 0, "month-decks"), 0);
});

/* ---------------- callOp ---------------- */
function resp(status, body) { return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) }; }
function deps(replies, extra) {
  const sent = [], waits = [];
  return Object.assign({ sent, waits, url: "/api/ai/prep-generate", token: async () => "tok",
    wait: async (ms) => { waits.push(ms); },
    fetch: async (url, o) => { sent.push({ url, o, body: JSON.parse(o.body) }); const r = replies.shift(); if (r instanceof Error) throw r; return r; } }, extra || {});
}
test("callOp: bearer token, idem added; a 504 is retried once after 4 s with the same idem", async () => {
  const d = deps([resp(504, { error: "ai-timeout" }), resp(200, { facts: [], usage: {} })]);
  const out = await PC.callOp({ op: "facts", deckId: "gen_a", chunk: { i: 0 } }, d);
  assert.deepEqual(out, { facts: [], usage: {} });
  assert.equal(d.sent.length, 2);
  assert.deepEqual(d.waits, [4000]);
  assert.equal(d.sent[0].body.idem, d.sent[1].body.idem);
  assert.equal(d.sent[0].body.idem, PC.idemKey("facts", { op: "facts", deckId: "gen_a", chunk: { i: 0 } }));
  assert.equal(d.sent[0].o.headers.Authorization, "Bearer tok");
  assert.equal(d.sent[0].o.method, "POST");
});
test("callOp: a second 504 fails with ai-timeout; no retry for other errors", async () => {
  const d = deps([resp(504, {}), resp(504, {})]);
  await assert.rejects(PC.callOp({ op: "mcq" }, d), (e) => e.code === "ai-timeout" && e.status === 504);
  assert.equal(d.sent.length, 2);
  const d2 = deps([resp(429, { error: "month-decks" })]);
  await assert.rejects(PC.callOp({ op: "facts" }, d2), (e) => e.code === "month-decks");
  assert.equal(d2.sent.length, 1);
  const d3 = deps([resp(429, { error: "rate", retryAfter: 3 }), resp(200, { ok: 1 })]);
  assert.deepEqual(await PC.callOp({ op: "solve" }, d3), { ok: 1 });
  assert.deepEqual(d3.waits, [3500]);
});
test("callOp: no token is sign-in without a request; network failure is offline; junk 200 is ai-failed", async () => {
  const d = deps([], { token: async () => null });
  await assert.rejects(PC.callOp({ op: "facts" }, d), (e) => e.code === "sign-in");
  assert.equal(d.sent.length, 0);
  await assert.rejects(PC.callOp({ op: "facts" }, deps([new TypeError("Failed to fetch")])), (e) => e.code === "offline");
  await assert.rejects(PC.callOp({ op: "facts" }, deps([resp(200, "<html>")])), (e) => e.code === "ai-failed");
  const ab = new Error("aborted"); ab.name = "AbortError";
  const d4 = deps([ab, resp(200, { ok: 2 })]);
  assert.deepEqual(await PC.callOp({ op: "facts" }, d4), { ok: 2 }, "the phone's own timeout counts as a 504");
});

/* ---------------- mapping ---------------- */
test("server item -> stored item for the runner; card; gates; paragraph; near duplicates", () => {
  const d = SR.docFromNotes(NOTES, "N"), byN = {};
  d.sents.forEach((s) => { byN[s.n] = s; });
  const chunk = SR.chunkSentences(d.sents)[1];
  const f = PC.factRecord({ fid: "f_1", ft: "B12 lack damages the cord.", cq: "What does B12 lack damage?", sn: [7], fk: "recall", quote: "x" }, "gen_a", chunk, byN);
  assert.deepEqual(f, { id: "f_1", deckId: "gen_a", ft: "B12 lack damages the cord.", cq: "What does B12 lack damage?", sn: [7], fk: "recall", p: [1], h: "MEGALOBLASTIC ANAEMIA", sec: "sec-1", used: false, chunk: 1 });
  assert.equal(PC.factRecord({ fid: "f_2", ft: "x", cq: "y", sn: [1] }, "gen_a", chunk, byN), null, "a fact citing outside its chunk is dropped");
  const it = { id: "q_abc", q: "Which lesion follows B12 deficiency?", o: ["SACD", "Wernicke", "Tabes", "ALS"], a: 0, r: ["Dorsal columns", "Thiamine", "Syphilis", "Motor"], et: [null, "confused", "dx", "dx"],
    exp: "Dorsal columns", kp: "Check B12 before folate.", d: 3, cog: "recall", fid: "f_1", prov: "AI", rv: { solved: true, pass: true, old: false } };
  const s = PC.toStored(it, f, "gen_a", ctx);
  assert.equal(s.id, "q_abc"); assert.equal(s.a, 0); assert.equal(s.exp, "Dorsal columns"); assert.equal(s.t, "sec-1"); assert.equal(s.d, 3);
  assert.equal(s._s, "deck"); assert.equal(s._m, "deck-gen_a"); assert.equal(s.deckId, "gen_a");
  assert.equal(s.prov, "AI"); assert.equal(s.gen, "AI"); assert.deepEqual(s.ex, ["neet-pg"]);
  assert.equal(PC.toStored(Object.assign({}, it, { prov: "USR" }), f, "gen_a", ctx).prov, "USR", "the server's prov is kept");
  assert.equal(PC.toStored(Object.assign({}, it, { prov: "XYZ" }), f, "gen_a", ctx).prov, "USR", "an unknown prov becomes USR");
  assert.deepEqual(s.src, { doc: "abc123abc123", name: "Haematology notes", p: [1], h: "MEGALOBLASTIC ANAEMIA", sn: [7] });
  assert.equal(PC.toStored(Object.assign({}, it, { o: ["a", "b", "c"] }), f, "gen_a", ctx), null);
  assert.equal(PC.toStored(Object.assign({}, it, { a: 4 }), f, "gen_a", ctx), null);
  assert.equal(PC.toStored(Object.assign({}, it, { o: ["a", "", "c", "d"] }), f, "gen_a", ctx), null);
  assert.equal(PC.toStored(Object.assign({}, it, { exp: "" }), f, "gen_a", ctx).exp, "Dorsal columns", "exp falls back to r[a]");
  assert.match(PC.toStored(Object.assign({}, it, { id: "" }), f, "gen_a", ctx).id, /^q_[0-9a-f]{12}$/);
  const card = PC.toCard(f, "gen_a", ctx);
  assert.equal(card.id, "c_" + DK.sha12("gen_a" + "f_1"));
  assert.equal(card.front, f.cq); assert.equal(card.back, f.ft); assert.equal(card.deckId, "gen_a");
  assert.equal(PC.gatesPass({ g4: true, g6: true, g7: true, g8: true, g9: true, g10: true, g11: true, old: true }), true);
  assert.equal(PC.gatesPass({ g4: true, g6: true, g7: true, g8: true, g9: true, g10: true }), false, "a missing gate is a fail");
  assert.equal(PC.gatesPass(null), false);
  const para = PC.paraFor([7], byN);
  assert.ok(para.startsWith("[4] ") && para.includes("[10] ") && !para.includes("[11] "));
  assert.equal(PC.nearDup("Which drug treats iron deficiency in pregnancy best", ["Which drug best treats iron deficiency in pregnancy"]), true);
  assert.equal(PC.nearDup("Which smear finding marks folate deficiency", ["Which drug treats iron deficiency in pregnancy"]), false);
});

test("deck manifest (6.7) and topics", () => {
  const m = DK.newManifest({ id: "gen_a", title: "T", exam: "neet-pg", profileV: 1, pv: "p1", model: "gemini-3.1-flash-lite", source: { type: "paste", name: "", pages: null, sha: "s" }, now: 5 });
  assert.equal(m.prov, "AI"); assert.equal(m.label, "AI-generated educational content"); assert.equal(m.v, 1);
  assert.deepEqual(m.stats, { facts: 0, generated: 0, accepted: 0, rejected: 0, regenerated: 0, cards: 0 });
  assert.deepEqual(m.cost, { inTok: 0, outTok: 0, thinkTok: 0, inr: 0, stopped: null });
  const topics = DK.topicsFor("gen_a", [{ t: "sec-1" }, { t: "sec-1" }, { t: "sec-0" }], [{ id: "sec-0", title: "Iron" }, { id: "sec-1", title: "B12" }, { id: "sec-2", title: "Haem" }]);
  assert.deepEqual(topics, [{ id: "sec-0", title: { en: "Iron" }, count: 1, file: "idb:gen_a/sec-0" }, { id: "sec-1", title: { en: "B12" }, count: 2, file: "idb:gen_a/sec-1" }]);
  assert.equal(DK.questionCount({ topics }), 3);
  assert.deepEqual(DK.sortDecks([{ id: "a", created: 1 }, { id: "b", created: 3 }]).map((x) => x.id), ["b", "a"]);
});

/* ---------------- the step loop against a fake server ---------------- */
function fakeServer(opts) {
  opts = opts || {};
  const log = [];
  let calls = 0;
  const send = async (body) => {
    calls++;
    log.push(body.op);
    if (opts.failAt && opts.failAt(calls, body)) { const e = PC.opError(opts.failStatus || 429, opts.failBody || { error: "month-decks" }); throw e; }
    const usage = { inTok: 100, outTok: 50, thinkTok: 0, inr: 0.01, dayDecks: 1, monthDecks: 4 };
    if (body.op === "facts") return { facts: body.chunk.sents.slice(0, opts.perChunk || 15).map((s) => ({ fid: "f_" + DK.sha12(body.deckId + s.n), ft: s.tx, cq: "Recall: " + s.tx, sn: [s.n], fk: "recall", quote: s.tx, p: s.p, h: s.h })), usage };
    if (body.op === "mcq") {
      return { items: body.facts.map((f) => ({ id: "q_" + DK.sha12(f.fid + (body.avoid ? "r" : "")), q: (body.avoid ? "Rewritten: " : "Concerning this point: ") + f.ft, o: ["alpha " + f.fi, "beta", "gamma", "delta"], a: f.fi % 4,
        r: ["w", "x", "y", "z"], et: [null, "knowledge", "knowledge", "knowledge"], exp: "because", kp: "pearl", d: 2, cog: "recall", fid: f.fid, prov: "AI", rv: null })), usage };
    }
    const fails = (list, q) => !q.q.startsWith("Rewritten") && (list || []).some((w) => q.q.includes(w));
    if (body.op === "solve") return { solved: body.q.map((q) => ({ id: q.id, ok: !fails(opts.solveFail, q), ot: q.o[q.a] })), usage };
    if (body.op === "review") return { gates: body.q.map((q, i) => { const bad = fails(opts.reviewFail, q); return { i, g4: true, g6: true, g7: !bad, g8: true, g9: true, g10: true, g11: true, old: false, why: bad ? "distractor also right" : "" }; }), usage };
    throw new Error("op " + body.op);
  };
  return { send, log, get calls() { return calls; } };
}
function memStore() {
  const s = { src: {}, decks: {}, facts: {}, items: {}, cards: {} };
  const put = (o, key) => async (recs) => { (Array.isArray(recs) ? recs : [recs]).forEach((r) => { o[r[key]] = JSON.parse(JSON.stringify(r)); }); };
  return { s, putSrc: put(s.src, "deckId"), putDeck: put(s.decks, "id"), putFacts: put(s.facts, "id"), putItems: put(s.items, "id"), putCards: put(s.cards, "id") };
}
function freshJob(text, target, extra) {
  const doc = SR.docFromNotes(text || NOTES, "Notes");
  const m = DK.newManifest({ id: "gen_t", title: "T", exam: "neet-pg", profileV: 1, pv: "p1", model: PC.MODEL, source: { type: "paste", name: "", pages: null, sha: DK.sha256(SR.docText(doc)) } });
  return PC.newJob(Object.assign({ m, sents: doc.sents, sections: doc.sections, facts: [], items: [], saved: false, target: target || 10, ctx }, extra || {}));
}
// Small chunks so the loop has several sections to pull facts from.
const SMALL = (s) => { s.chunks = SR.chunkSentences(s.sents, 130); s.order = SR.chunkOrder(s.chunks); return s; };

test("step loop: facts until 14 unused, mcq x2, solve x2, review x2, regen once (batched), save what passed", async () => {
  const job = SMALL(freshJob());
  const srv = fakeServer({ perChunk: 4, solveFail: ["Serum ferritin"], reviewFail: ["Hypersegmented"] });
  const store = memStore();
  const caps = [];
  const res = await PC.runRound(job, { send: srv.send, store, today: "2026-10-05", onCaps: (c) => caps.push(c) });
  assert.deepEqual(srv.log, ["facts", "facts", "facts", "facts", "mcq", "mcq", "solve", "solve", "review", "review", "mcq", "solve", "review"]);
  assert.equal(res.ok, true);
  const fresh = Object.values(store.s.items);
  assert.equal(res.accepted, fresh.length);
  assert.equal(fresh.length, 14, "12 first-pass plus 2 regenerated");
  assert.ok(fresh.every((it) => it._s === "deck" && it._m === "deck-gen_t" && it.deckId === "gen_t" && it.rv && it.rv.pass && it.o.length === 4));
  assert.equal(job.m.stats.facts, 14);
  assert.equal(job.m.stats.generated, 16);
  assert.equal(job.m.stats.rejected, 2);
  assert.equal(job.m.stats.regenerated, 2);
  assert.equal(job.m.stats.accepted, 14);
  assert.equal(job.m.stats.cards, 14);
  assert.equal(Object.keys(store.s.cards).length, 14);
  assert.ok(store.s.src.gen_t && store.s.src.gen_t.sents.length === 18, "source sentences saved with the deck");
  assert.equal(store.s.decks.gen_t.cost.inTok, 1300);
  assert.equal(DK.questionCount(store.s.decks.gen_t), 14);
  assert.deepEqual(caps.at(-1), { month: 4, day: 1, at: "2026-10-05" });
  const used = Object.values(store.s.facts).filter((f) => f.used).length;
  assert.equal(used, 14);
});

test("step loop: the regen request carries the failed facts and their reasons; the mcq request carries facts, sentences and mix", async () => {
  const job = SMALL(freshJob());
  const bodies = [];
  const srv = fakeServer({ perChunk: 4, reviewFail: ["Hypersegmented"] });
  await PC.runRound(job, { send: (b) => { bodies.push(JSON.parse(JSON.stringify(b))); return srv.send(b); }, store: memStore() });
  const mcq = bodies.filter((b) => b.op === "mcq");
  assert.equal(mcq[0].facts.length, 7);
  assert.deepEqual(Object.keys(mcq[0].facts[0]).sort(), ["cq", "fi", "fid", "fk", "ft", "h", "p", "sents", "sn", "t"]);
  assert.equal(mcq[0].facts[0].t, "sec-0", "the section id rides along so the server stamps item.t");
  assert.equal(mcq[0].facts[0].sents[0].tx, mcq[0].facts[0].ft);
  assert.deepEqual(mcq[0].mix.dl, { 1: 0.3, 2: 0.5, 3: 0.2 });
  const regen = mcq[2];
  assert.equal(regen.facts.length, 1);
  assert.deepEqual(regen.avoid, { fi: 0, why: "distractor also right" }, "one failed fact: the contract's single avoid object");
  const rv = bodies.find((b) => b.op === "review");
  assert.equal(Object.keys(rv.para).length, rv.q.length);
  bodies.forEach((b) => { assert.equal(b.deckId, "gen_t"); assert.equal(b.exam, "neet-pg"); assert.equal(b.pv, "p1"); assert.equal(b.profileV, 1); });
  const solve = bodies.find((b) => b.op === "solve");
  assert.deepEqual(Object.keys(solve.q[0]).sort(), ["a", "id", "o", "q"], "solve sends stem, options and key only");
});

test("step loop: a cap error stops with what was saved; resume re-sends the same op; a month cap is recorded", async () => {
  const job = SMALL(freshJob());
  const store = memStore();
  const srv = fakeServer({ perChunk: 4, failAt: (n, b) => b.op === "solve" });
  const res = await PC.runRound(job, { send: srv.send, store });
  assert.equal(res.ok, false);
  assert.equal(res.code, "month-decks");
  assert.match(res.message, /10 decks this month/);
  assert.equal(res.retry, false);
  assert.equal(store.s.decks.gen_t.cost.stopped, "month-decks");
  assert.equal(Object.keys(store.s.items).length, 0);
  assert.equal(Object.keys(store.s.facts).length, 14, "facts and cards made before the stop stay saved");
  assert.equal(Object.keys(store.s.cards).length, 14);
  // A timeout is retryable; the next run starts with the op that failed (same body, so the same idem).
  const job2 = SMALL(freshJob());
  const seen = [];
  let failOnce = true;
  const srv2 = fakeServer({ perChunk: 4 });
  const send2 = (b) => { seen.push(PC.idemKey(b.op, b)); if (b.op === "mcq" && failOnce) { failOnce = false; return Promise.reject(PC.opError(504, { error: "ai-timeout" })); } return srv2.send(b); };
  const st2 = memStore();
  const r1 = await PC.runRound(job2, { send: send2, store: st2 });
  assert.equal(r1.ok, false); assert.equal(r1.code, "ai-timeout"); assert.equal(r1.retry, true);
  const failedIdem = seen.at(-1), mark = seen.length;
  job2.stopped = null;
  const r2 = await PC.runRound(job2, { send: send2, store: st2 });
  assert.equal(r2.ok, true);
  assert.equal(seen[mark], failedIdem, "the resumed mcq carries the same idem");
  assert.equal(r2.accepted, 14);
});

test("step loop: '10 more' sends only unused facts, pulls more chunks, and ends when the source is used up", async () => {
  const store = memStore();
  const job = SMALL(freshJob());
  await PC.runRound(job, { send: fakeServer({ perChunk: 4 }).send, store });
  const facts = Object.values(store.s.facts), items = Object.values(store.s.items);
  const usedBefore = new Set(facts.filter((f) => f.used).map((f) => f.id));
  const more = SMALL(PC.newJob({ m: store.s.decks.gen_t, sents: store.s.src.gen_t.sents, sections: store.s.src.gen_t.sections, facts, items, saved: true, target: 10, ctx }));
  const bodies = [];
  const srv = fakeServer({ perChunk: 4 });
  const res = await PC.runRound(more, { send: (b) => { bodies.push(b); return srv.send(b); }, store });
  const sentFids = bodies.filter((b) => b.op === "mcq").flatMap((b) => b.facts.map((f) => f.fid));
  assert.ok(sentFids.length > 0);
  assert.ok(sentFids.every((fid) => !usedBefore.has(fid)), "no used fact is sent again");
  assert.equal(new Set(bodies.filter((b) => b.op === "facts").map((b) => b.chunk.i)).size, bodies.filter((b) => b.op === "facts").length, "a chunk is read once");
  assert.equal(res.ok, true);
  assert.equal(res.accepted, 4, "the last 4 facts make 4 questions");
  assert.equal(res.more, false, "all 18 sentences are now used");
  const last = await PC.runRound(SMALL(PC.newJob({ m: store.s.decks.gen_t, sents: store.s.src.gen_t.sents, sections: store.s.src.gen_t.sections, facts: Object.values(store.s.facts), items: Object.values(store.s.items), saved: true, target: 10, ctx })), { send: fakeServer().send, store });
  assert.deepEqual(last, { ok: true, accepted: 0, more: false, stopped: false });
});

test("nextOp: a round's batches are capped, so cost has a ceiling; stop request ends after the current op", () => {
  const job = SMALL(freshJob());
  assert.equal(job.round.maxBatches, 2);
  assert.deepEqual(PC.nextOp(job), { op: "facts", chunk: job.order[0] });
  job.round.started = 2;
  assert.equal(PC.nextOp(job), null);
  const j2 = freshJob(); j2.stopReq = true;
  assert.equal(PC.nextOp(j2), null);
  assert.equal(PC.newRound(20).maxBatches, 4);
});

test("a duplicate stem from the server is not saved twice", async () => {
  const job = SMALL(freshJob());
  const srv = fakeServer({ perChunk: 4 });
  const store = memStore();
  const send = async (b) => { const r = await srv.send(b); if (b.op === "mcq") r.items.forEach((it) => { it.q = "Which finding is typical of iron deficiency anaemia in women"; }); return r; };
  const res = await PC.runRound(job, { send, store });
  assert.equal(Object.keys(store.s.items).length, 1);
  assert.equal(res.accepted, 1);
});

/* ---------------- host store: progress, delete ---------------- */
test("deck progress and delete purge the deck's FSRS cards, counts and bookmarks only", () => {
  const s = { cards: { "p:deck-gen_a:q1": [5, 2, 10, 11, 1, 0], "p:deck-gen_a:q2": [5, 2, 10, 20, 1, 0], "p:cards-gen_a:c1": [5, 2, 10, 9, 1, 0], "p:anatomy-1:q9": [5, 2, 10, 9, 1, 0] },
    conf: { "p:deck-gen_a": {}, "p:anatomy-1": {} }, mod: { "deck-gen_a": { t: 2, ok: 1 }, "anatomy-1": { t: 1, ok: 1 } }, bm: { q1: ["deck", "deck-gen_a", 1], q9: ["anatomy", "anatomy-1", 1] }, last: { s: "deck", m: "deck-gen_a" } };
  assert.deepEqual(PC.deckProgress(s, "gen_a", 12), { answered: 2, due: 1, cardsSeen: 1, cardsDue: 1 });
  PC.purgeStore(s, "gen_a");
  assert.deepEqual(Object.keys(s.cards), ["p:anatomy-1:q9"]);
  assert.deepEqual(Object.keys(s.conf), ["p:anatomy-1"]);
  assert.deepEqual(Object.keys(s.mod), ["anatomy-1"]);
  assert.deepEqual(Object.keys(s.bm), ["q9"]);
  assert.equal(s.last, null);
});

test("default deck title: the file name, else the first heading, else the first words", () => {
  assert.equal(PC.defaultTitle(SR.docFromNotes(NOTES, ""), "Harrison AML.pdf"), "Harrison AML");
  assert.equal(PC.defaultTitle(SR.docFromNotes(NOTES, ""), ""), "Iron deficiency anaemia");
  assert.equal(PC.defaultTitle(SR.docFromNotes("Ferritin falls first in iron deficiency anaemia. More here.", ""), ""), "Ferritin falls first in iron deficiency");
});

/* ---------------- flashcards ---------------- */
test("cards: due queue from FSRS (due first, then new), grading Good or Again under p:cards-<id>", () => {
  const cards = Array.from({ length: 14 }, (_, i) => ({ id: "c_" + i, fid: "f_" + i, front: "Q" + i, back: "A" + i, deckId: "gen_a", src: { p: [3], h: "Iron", sn: [i] } }));
  const store = C.emptyStore();
  let q = CARDS.dueQueue(cards, store, 100, C, { rnd: () => 0.5 });
  assert.equal(q.length, 10, "10 new cards at most");
  CARDS.grade(store, C, cards[0], false, 100);
  CARDS.grade(store, C, cards[1], true, 100);
  assert.ok(store.cards["p:cards-gen_a:c_0"]);
  assert.equal(store.cards["p:cards-gen_a:c_0"][3], 101, "I did not: due tomorrow");
  assert.ok(store.cards["p:cards-gen_a:c_1"][3] > 101, "I knew it: later");
  q = CARDS.dueQueue(cards, store, 101, C, { rnd: () => 0.5 });
  assert.equal(q[0].id, "c_0", "the due card comes first");
  assert.ok(!q.some((c) => c.id === "c_1"), "a card not yet due is not shown");
  assert.equal(CARDS.dueQueue(cards, store, 101, C, { all: true }).length, 14 - 1);
  assert.equal(CARDS.srcLine(cards[0]), "From your source: Iron", "heading only: the app shows no page numbers");
  assert.equal(CARDS.srcLine({ src: { p: [3, 4], h: "" } }), "");
  assert.equal(CARDS.nextDueText(store, cards, 100), "Next cards are due tomorrow.");
});

/* ---------------- house rules ---------------- */
test("client files: ES5 only, no em or en dash, no console logging of source text", () => {
  for (const f of ["prep-source.js", "prep-decks.js", "prep-create.js", "prep-cards.js", "prep-create.css", "test/prep-create.test.mjs"]) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.ok(!/[\u2013\u2014]/.test(src), f + ": no em or en dash");
    if (!f.endsWith(".js")) continue;
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
    assert.ok(!/=>/.test(code), f + ": no arrow functions");
    assert.ok(!/\b(let|const|class)\s/.test(code), f + ": no let, const or class");
    assert.ok(!/`/.test(code), f + ": no template literals");
    assert.ok(!/console\.(log|info|warn|error)/.test(code), f + ": no console logging");
  }
});
