/* pglog-quick + pglog-analytics + pglog-photos + pglog-backup — the pure halves.
 * These are the parts a resident's numbers depend on, so they are tested at the boundary where a
 * wrong answer would be believed: the role ladder, the denominator of a rate, and the refusal to
 * take a photograph without consent. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const Q = require("../pglog-quick.js");
const A = require("../pglog-analytics.js");
const P = require("../pglog-photos.js");
const B = require("../pglog-backup.js");

/* ─────────────────────────── templates ─────────────────────────── */

test("every specialty the owner named has a real template, not a placeholder", () => {
  ["general-surgery", "critical-care", "dermatology", "endocrinology", "gastroenterology"].forEach((id) => {
    const t = Q.templatesFor(id);
    assert.equal(t.packId, id, id + " resolved to " + t.packId);
    assert.ok(t.procedure.length >= 10, id + " has " + t.procedure.length + " procedures");
    assert.ok(t.clinical.length >= 10, id + " has " + t.clinical.length + " presentations");
  });
});

test("a specialty id, a pack id or a plain name all reach the same template", () => {
  assert.equal(Q.packFor("ms-general-surgery"), "general-surgery");
  assert.equal(Q.packFor("general-surgery"), "general-surgery");
  assert.equal(Q.packFor("dm-critical-care-medicine"), "critical-care");
  assert.equal(Q.packFor("md-dermatology-venereology-and-leprosy"), "dermatology");
  assert.equal(Q.packFor("dm-medical-gastroenterology"), "gastroenterology");
});

test("an unknown specialty falls back to a usable generic list, never to nothing", () => {
  const t = Q.templatesFor("md-aerospace-medicine");
  assert.equal(t.packId, "generic-pg");
  assert.ok(t.procedure.length > 0 && t.clinical.length > 0);
  assert.ok(Q.templatesFor("").procedure.length > 0);
  assert.ok(Q.templatesFor(null).clinical.length > 0);
});

test("the picker puts what this resident actually logs first", () => {
  const recents = [{ title: "Appendicectomy", n: 9, at: 3 }, { title: "Wound debridement", n: 2, at: 9 }];
  const list = Q.suggestions("general-surgery", "procedure", recents, 5);
  assert.equal(list[0].title, "Appendicectomy");
  assert.equal(list[0].recent, true);
  assert.equal(list[1].title, "Wound debridement");
  // and the catalogue is not duplicated behind them
  assert.equal(list.filter((x) => x.title === "Appendicectomy").length, 1);
});

test("search matches a prefix, a fragment and word initials", () => {
  const byPrefix = Q.search("general-surgery", "procedure", "appen", [], 5);
  assert.equal(byPrefix[0].title, "Appendicectomy");
  const byFragment = Q.search("general-surgery", "procedure", "hernia", [], 5);
  assert.ok(byFragment.some((x) => /hernia/i.test(x.title)));
  const byInitials = Q.search("obstetrics-gynaecology", "procedure", "lscs", [], 5);
  assert.ok(byInitials.some((x) => /caesarean/i.test(x.title)), JSON.stringify(byInitials));
});

/* ─────────────────────────── dictation ─────────────────────────── */

test("one spoken sentence fills the fields it heard, and says what it heard", () => {
  const r = Q.parseDictation("Assisted in an appendicectomy in the emergency, no complications",
    { specialty: "general-surgery" });
  assert.equal(r.role, "assisted");
  assert.equal(r.setting, "emergency");
  assert.equal(r.title, "Appendicectomy");
  assert.equal(r.kind, "procedure");
  assert.deepEqual(r.complications, []);
  assert.ok(r.heard.some((h) => h.field === "role"));
  assert.ok(r.heard.some((h) => h.field === "title"));
});

test("\"no complications\" is never read as a complication", () => {
  ["no complications", "uneventful", "without complication"].forEach((phrase) => {
    const r = Q.parseDictation("Laparoscopic cholecystectomy performed independently, " + phrase,
      { specialty: "general-surgery" });
    assert.deepEqual(r.complications, [], phrase);
    assert.equal(r.role, "performed_independent", phrase);
  });
});

test("a complication that WAS said is captured", () => {
  const r = Q.parseDictation("Exploratory laparotomy, assisted, there was bleeding and a wound infection",
    { specialty: "general-surgery" });
  assert.ok(r.complications.includes("bleeding"));
  assert.ok(r.complications.includes("wound infection") || r.complications.includes("infection"));
});

test("the role ladder is never guessed from silence", () => {
  const r = Q.parseDictation("Saw a case of dengue in the ward", { specialty: "general-medicine" });
  assert.equal(r.role, "", "no role phrase was said, so no role is claimed");
  assert.equal(r.setting, "ipd");
});

test("a procedure that is not in the template still lands in the title", () => {
  const r = Q.parseDictation("Did a rare vascular bypass today", { specialty: "general-surgery" });
  assert.ok(r.title.length > 0);
  assert.ok(/bypass/i.test(r.title + " " + r.notes));
});

/* ─────────────────────────── the draft ─────────────────────────── */

test("a quick draft is an ordinary draft, and never invents the role", () => {
  const d = Q.quickDraft({ kind: "procedure", title: "Appendicectomy", setting: "ot" },
    { today: "2026-09-24", residentId: "r1", programmeId: "p1", prefs: {} });
  assert.equal(d.kind, "procedure");
  // the model validates a procedure on procedureText / procedureId, so that is what is written
  assert.equal(d.procedureText, "Appendicectomy");
  assert.equal(d.occurredAt, "2026-09-24");
  assert.equal(d.residentId, "r1");
  assert.equal(d.role, "", "role is never defaulted — it is the claim the examiner relies on");
  assert.equal(d.source, undefined, "a quick entry is an ordinary entry; the record gains no extra field");
});

test("a clinical and an academic quick draft write the fields the model validates", () => {
  const c = Q.quickDraft({ kind: "clinical", title: "Acute appendicitis", role: "assisted" }, { today: "2026-09-24" });
  assert.equal(c.title, "Acute appendicitis", "the examiner reads the title");
  assert.equal(c.diagnosis, "Acute appendicitis", "and the analytics group on the diagnosis");
  const a = Q.quickDraft({ kind: "academic", title: "Journal club" }, { today: "2026-09-24" });
  assert.equal(a.topic, "Journal club", "academic entries validate on topic");
  assert.equal(a.academicType, "seminar");
});

test("missingFor names what still blocks a submit", () => {
  const empty = Q.quickDraft({ kind: "procedure" }, { today: "2026-09-24" });
  const miss = Q.missingFor(empty, {});
  assert.ok(miss.includes("title"));
  assert.ok(miss.includes("role"));
  const ready = Q.quickDraft({ kind: "procedure", title: "Appendicectomy", role: "assisted" }, { today: "2026-09-24" });
  assert.deepEqual(Q.missingFor(ready, {}), []);
  // a degree that requires a named supervisor says so
  assert.ok(Q.missingFor(ready, { requiresSupervisor: true }).includes("supervisor"));
});

/* ─────────────────────────── analytics ─────────────────────────── */

const ENTRIES = [
  { kind: "procedure", occurredAt: "2024-05-02", procedureName: "Appendicectomy", role: "observed", status: "verified", complications: [] },
  { kind: "procedure", occurredAt: "2024-06-11", procedureName: "Appendicectomy", role: "assisted", status: "verified", complications: [] },
  { kind: "procedure", occurredAt: "2024-07-03", procedureName: "Hernia repair", role: "assisted", status: "verified", complications: ["wound infection"] },
  { kind: "procedure", occurredAt: "2025-05-20", procedureName: "Appendicectomy", role: "performed_independent", status: "verified", complications: [] },
  { kind: "procedure", occurredAt: "2025-06-02", procedureName: "Appendicectomy", role: "performed_independent", status: "verified", complications: [] },
  { kind: "procedure", occurredAt: "2025-06-09", procedureName: "Hernia repair", role: "performed_supervised", status: "verified", complications: [] },
  { kind: "clinical", occurredAt: "2025-06-10", diagnosis: "Acute appendicitis", setting: "opd", role: "assisted", status: "verified" },
  { kind: "procedure", occurredAt: "2025-06-12", procedureName: "Appendicectomy", role: "performed_independent", status: "draft", complications: ["bleeding"] }
];

test("only verified entries are counted, and the unverified ones are shown, not hidden", () => {
  const c = A.caseload(ENTRIES, {});
  assert.equal(c.total, 7, "7 verified of 8");
  assert.equal(c.counts.total, 8);
  assert.equal(c.counts.verified, 7);
  assert.equal(c.counts.draft, 1);
  assert.deepEqual(c.countedStatuses, ["verified"]);
});

test("a month with no entries is present with zero, so a gap is visible", () => {
  const c = A.caseload(ENTRIES, {});
  const months = c.months.map((m) => m.month);
  assert.ok(months.includes("2024-08"), "the quiet months are in the series");
  assert.ok(months.includes("2025-01"));
  assert.equal(c.months.find((m) => m.month === "2024-08").n, 0);
});

test("a complication rate below the safe N is returned as a count, not a percentage", () => {
  const r = A.complicationRate(ENTRIES, {});
  assert.equal(r.n, 6, "6 verified procedures");
  assert.equal(r.withComplication, 1);
  assert.equal(r.pct, null, "6 procedures is too few for a percentage");
  assert.equal(r.lowN, true);
  assert.equal(r.minN, A.MIN_RATE_N);
});

test("a rate with no denominator is null, never zero", () => {
  assert.equal(A.complicationRate([], {}), null);
  assert.equal(A.complicationRate([{ kind: "clinical", occurredAt: "2025-01-01", status: "verified" }], {}), null);
});

test("a percentage appears once there are enough procedures to divide by", () => {
  const many = [];
  for (let i = 0; i < 40; i++) {
    many.push({ kind: "procedure", occurredAt: "2025-03-" + String((i % 28) + 1).padStart(2, "0"),
      procedureName: "Appendicectomy", role: "assisted", status: "verified",
      complications: i < 4 ? ["bleeding"] : [] });
  }
  const r = A.complicationRate(many, {});
  assert.equal(r.n, 40);
  assert.equal(r.withComplication, 4);
  assert.equal(r.pct, 10);
  assert.equal(r.lowN, false);
});

test("independence is measured year on year, on the role ladder", () => {
  const t = A.independenceTrend(ENTRIES, {});
  assert.equal(t.basis, "calendar_year");
  const y24 = t.years.find((y) => y.year === "2024");
  const y25 = t.years.find((y) => y.year === "2025");
  assert.equal(y24.n, 3);
  assert.equal(y24.independentShare, 0, "nothing independent in year one");
  assert.equal(y25.n, 3);
  assert.ok(y25.independentShare > y24.independentShare);
  assert.equal(t.direction, "rising");
});

test("a training-year mapping is used when the caller supplies one, and the basis says so", () => {
  const t = A.independenceTrend(ENTRIES, {
    yearOf: (e) => "Year " + (Number(String(e.occurredAt).slice(0, 4)) - 2023)
  });
  assert.equal(t.basis, "training_year");
  assert.deepEqual(t.years.map((y) => y.year), ["Year 1", "Year 2"]);
});

test("every figure carries the self-reported disclaimer", () => {
  assert.ok(A.caseload(ENTRIES, {}).disclaimer.includes("not an audited outcome statistic"));
  assert.ok(A.complicationRate(ENTRIES, {}).disclaimer.includes("self-reported"));
  assert.ok(A.independenceTrend(ENTRIES, {}).disclaimer.length > 40);
});

test("the top lists group case-insensitively and keep the role split", () => {
  const rows = A.topItems(ENTRIES, { kind: "procedure" });
  const appy = rows.find((r) => /appendicectomy/i.test(r.title));
  assert.equal(appy.n, 4, "4 verified appendicectomies");
  assert.equal(appy.roles.performed_independent, 2);
  assert.equal(appy.roles.observed, 1);
});

/* ─────────────────────────── CSV ─────────────────────────── */

test("CSV has a header, one row per entry, in date order", () => {
  const csv = A.toCsv(ENTRIES, {});
  const lines = csv.split("\r\n");
  assert.equal(lines[0].split(",")[0], "date");
  assert.equal(lines.length, ENTRIES.length + 1);
  assert.ok(lines[1].startsWith("2024-05-02"));
});

test("a cell that Excel would execute as a formula is neutralised", () => {
  const csv = A.toCsv([{ kind: "procedure", occurredAt: "2025-01-01", procedureName: "=cmd|calc", status: "verified" }], {});
  assert.ok(csv.includes("'=cmd|calc"), csv);
});

test("commas, quotes and newlines survive a round trip", () => {
  const csv = A.toCsv([{ kind: "procedure", occurredAt: "2025-01-01", procedureName: 'Repair, "open", right', notes: "line1\nline2", status: "verified" }], {});
  assert.ok(csv.includes('"Repair, ""open"", right"'), csv);
  assert.ok(csv.includes('"line1\nline2"'));
});

/* ─────────────────────────── photographs ─────────────────────────── */

test("a photograph without consent is refused, and the reason is a sentence a resident can read", () => {
  // In node there is no IndexedDB, so availability is the first gate that fires; the point being
  // asserted is that every refusal has a sentence a resident can act on.
  assert.equal(P.refuseReason({ consent: false, deidentified: true }, 0), "unavailable");
  const reasons = ["unavailable", "no_consent", "not_deidentified", "too_many"];
  reasons.forEach((r) => assert.ok(P.refusalText(r).length > 10, r));
  assert.ok(P.refusalText("no_consent").toLowerCase().includes("consent"));
});

test("the consent record travels with the photograph reference", () => {
  const ref = P.reference({ id: "p1", size: 1234, sha256: "abc", addedAt: 5,
    consent: { given: true, deidentified: true, at: 5 } });
  assert.equal(ref.consent.given, true);
  assert.equal(ref.consent.deidentified, true);
  assert.equal(ref.consent.at, 5);
  assert.equal(ref.consent.text, P.CONSENT_TEXT);
  assert.equal(ref.local, true, "the pixels stay on the device");
});

test("a reference carries no filename, because a camera filename can carry a patient name", () => {
  const ref = P.reference({ id: "p1", name: "RAMESH_KUMAR_MRN4432.jpg" });
  assert.equal(ref.name, undefined);
  assert.equal(JSON.stringify(ref).includes("RAMESH"), false);
});

test("consent is asserted per photograph and the guidance says what to keep out of frame", () => {
  assert.ok(P.GUIDANCE.length >= 4);
  assert.ok(P.GUIDANCE.join(" ").toLowerCase().includes("face"));
  assert.ok(P.CONSENT_TEXT.toLowerCase().includes("consent"));
  assert.ok(P.STORAGE_WARNING.toLowerCase().includes("never uploaded"));
});

/* ─────────────────────────── backup ─────────────────────────── */

test("a short password and a mismatch are both refused before anything is encrypted", () => {
  assert.equal(B.checkPassword("short", "short").ok, false);
  assert.equal(B.checkPassword("longenough1", "longenough2").error, "mismatch");
  assert.equal(B.checkPassword("longenough1", "longenough1").ok, true);
});

test("the backup holds what exists only on the device, and not the verified server record", () => {
  const doc = B.buildBackup({
    at: 10, account: "u1", drafts: [{ localId: "d1" }], queue: ["d1"],
    photos: [{ id: "p1", dataUrl: "data:," }], serverEntryIds: ["e1", "e2"]
  });
  assert.equal(doc.counts.drafts, 1);
  assert.equal(doc.counts.photos, 1);
  assert.equal(doc.counts.onServer, 2);
  assert.equal(doc.serverEntryIds.length, 2, "ids only — the verified entries themselves are not copied");
  assert.equal(JSON.stringify(doc).includes("\"entries\""), false);
});

test("the envelope carries only what a restore cannot begin without", () => {
  const env = JSON.parse(B.wrapEnvelope("SALT", "CIPHER", 99));
  assert.deepEqual(Object.keys(env).sort(), ["app", "at", "cipher", "envelope", "kdf"]);
  assert.equal(env.kdf.iterations, 200000);
  assert.equal(env.at, 99);
  // Nothing identifying outside the ciphertext. kdf.name is the algorithm ("PBKDF2"), so the
  // check is on the envelope's own keys and on the values, not on the substring "name".
  assert.deepEqual(Object.keys(env.kdf).sort(), ["hash", "iterations", "name", "salt"]);
  assert.equal(env.kdf.name, "PBKDF2");
  ["resident", "institution", "programme", "count", "draft", "photo"].forEach((w) => {
    assert.equal(Object.keys(env).some((k) => k.toLowerCase().includes(w)), false, w + " must not be an envelope field");
  });
});

test("a plaintext or foreign file is refused on read", () => {
  assert.equal(B.parseEnvelope("not json").error, "unreadable");
  assert.equal(B.parseEnvelope(JSON.stringify({ envelope: 99, cipher: "x", kdf: { salt: "s" } })).error, "wrong_envelope");
  assert.equal(B.parseEnvelope(JSON.stringify({ envelope: 1, drafts: [] })).error, "not_encrypted");
  assert.equal(B.parseEnvelope(B.wrapEnvelope("s", "c", 1)).ok, true);
});

test("restore is additive and never rolls back newer local work", () => {
  const local = [{ localId: "a", updatedAt: 200 }, { localId: "b", updatedAt: 100 }];
  const backup = [{ localId: "a", updatedAt: 100 }, { localId: "b", updatedAt: 300 }, { localId: "c", updatedAt: 50 }];
  const plan = B.mergePlan(local, backup);
  assert.deepEqual(plan.add.map((x) => x.localId), ["c"], "only the missing draft is added");
  assert.deepEqual(plan.replace.map((x) => x.localId), ["b"], "only a strictly newer copy replaces");
  assert.deepEqual(plan.keep.map((x) => x.localId), ["a"], "newer local work is kept");
});

test("restoring twice is a no-op", () => {
  const backup = [{ localId: "c", updatedAt: 50 }];
  const after = B.mergePlan(backup, backup);
  assert.equal(after.add.length, 0);
  assert.equal(after.replace.length, 0);
});

test("the Drive filename carries no identifier", () => {
  assert.equal(/\d{4}|resident|name|hospital/i.test(B.BACKUP_NAME.replace(/smdlogbk/, "")), false, B.BACKUP_NAME);
});
