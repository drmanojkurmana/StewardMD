/* Item-quality sidecar (tools/prep-quality.mjs, plan sections 7 and 11).
 * What must hold:
 *  - seed maps facts to records only: bank flags -> requires_review, hidden ids -> requires_review,
 *    owner key reviews -> approved + key_change_approved, dropped -> retired; clean items get no record
 *    (implicit automated_checks_passed); exp-pending never seeds; tombstoned share IDs are counted, not stored;
 *  - history is append-only (older entries never edited/reordered/dropped) and every status or key change
 *    carries a reason; approved needs a named human reviewer; key changes need from != to;
 *  - the tool never touches bank files: it reads the cache and writes only the sidecar dir;
 *  - requires_review/rejected/retired items are excluded from the assembler, the fixed-paper build and the
 *    app pools (prep.js, prep-pyq.js); the uploader lists quality/ with index.json last.
 * No network: fixtures only. node --test test/prep-quality.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import * as Q from "../tools/prep-quality.mjs";
import { listFiles } from "../tools/prep-upload-bank.mjs";
import * as T from "../tools/prep-fixed-tests.mjs";

const require = createRequire(import.meta.url);
const A = require("../prep-assess.js");
const PURE = require("../prep.js");
const PYQ = require("../prep-pyq.js");

const AT = "2026-10-12T00:00:00.000Z";
const loc = (subject, bank = "bank module", bank_version = "v5", module = "m1", flags = []) => ({ subject, bank, bank_version, module, flags });
const byId = new Map([
  ["clean-1", loc("anatomy")],
  ["disp-1", loc("anatomy", "bank module", "v5", "m1", ["disputed"])],
  ["exp-1", loc("medicine", "bank module", "v5", "m1", ["exp-letter", "exp-text"])],
  ["dup-1", loc("medicine", "bank module", "v5", "m1", ["dup-key"])],
  ["pend-1", loc("medicine", "bank module", "v5", "m1", ["exp-pending"])],
  ["ov-1", loc("surgery", "overlay:maik1", "maik1", "m1", ["disputed"])],
  ["pyq-1", loc("pyq", "pyq:v5", "items-aaaaaaaa.json", "pyq", ["disputed"])],
]);
const keyfix = new Map([
  ["kf-ok", { status: "approved", reviewer: "owner", key: { value: 2, confidence: "verified_human" }, entry: { at: "2026-10-10T00:00:00.000Z", by: "owner", action: "key_change_approved", from: "A", to: "C", reason: "owner key verdict applied", source: "owner review" } }],
  ["kf-held", { status: "requires_review", entry: { at: "2026-10-10T00:00:00.000Z", by: "owner", action: "flagged", reason: "held for the figure", source: "owner review" } }],
  ["kf-drop", { status: "retired", entry: { at: "2026-10-10T00:00:00.000Z", by: "owner", action: "retired", reason: "dropped: duplicate of another item", source: "owner review" } }],
]);
// kf-ok/kf-held live in radiology; kf-drop has no live home (removed before the seed).
byId.set("kf-ok", loc("ss-radiology"));
byId.set("kf-held", loc("ss-radiology"));
byId.set("hid-1", loc("physiology"));

function seeded(tmp) {
  const { files, report } = Q.seed({ byId, hidden: ["hid-1", "disp-1"], keyfix, tombstones: 1171, at: AT });
  Q.writeSidecar(tmp, Q.QUALITY_VER, files, { generated_at: AT });
  return { files, report };
}

test("seed: flags become requires_review with sourced history; clean and exp-pending items get no record", () => {
  const { files, report } = Q.seed({ byId, hidden: [], keyfix: new Map(), at: AT });
  const all = [...files.values()].flat();
  const ids = all.map((r) => r.item_id);
  assert.ok(!ids.includes("clean-1"), "a clean item gets no record (implicit automated_checks_passed)");
  assert.ok(!ids.includes("pend-1"), "exp-pending (explanation unwritten) is not a quality verdict");
  assert.ok(!ids.includes("kf-ok") && !ids.includes("kf-held"), "no keyfix input, no keyfix records");
  for (const id of ["disp-1", "exp-1", "dup-1", "ov-1", "pyq-1"]) {
    const r = all.find((x) => x.item_id === id);
    assert.equal(r.status, "requires_review", id);
    assert.equal(r.status_changed_at, AT);
    assert.ok(r.history.length >= 1 && r.history.every((h) => h.at && h.by && h.action && h.reason && h.source), id);
  }
  const d = all.find((x) => x.item_id === "disp-1");
  assert.equal(d.history[0].by, "prep-screen-keys");
  assert.equal(d.history[0].source, "screen tool");
  assert.equal(d.history[0].action, "flagged");
  assert.match(d.history[0].reason, /blind solve/);
  const e = all.find((x) => x.item_id === "exp-1");
  assert.equal(e.history.length, 2, "one entry per bank flag");
  assert.equal(e.history[0].by, "prep-build-bank");
  assert.equal(files.get("surgery")[0].bank, "overlay:maik1");
  assert.equal(files.get("surgery")[0].bank_version, "maik1");
  assert.equal(files.get("pyq")[0].bank, "pyq:v5");
  assert.equal(report.tombstones_withdrawn_share_ids, 0);
  assert.ok(!ids.some((id) => /tomb/.test(id)), "tombstones are counted, never stored per item");
});

test("seed: hidden ids become requires_review; keyfix overlays flags with the last outcome per id", () => {
  const { files, report } = Q.seed({ byId, hidden: ["hid-1", "disp-1"], keyfix, tombstones: 1171, at: AT });
  const all = [...files.values()].flat();
  const h = all.find((x) => x.item_id === "hid-1");
  assert.equal(h.status, "requires_review");
  assert.equal(h.history[0].by, "prep-flag");
  assert.equal(h.history[0].source, "student report");
  const d = all.find((x) => x.item_id === "disp-1");
  assert.equal(d.history.length, 2, "bank flag + hidden report both kept");
  const k = all.find((x) => x.item_id === "kf-ok");
  assert.equal(k.status, "approved");
  assert.equal(k.status_changed_at, "2026-10-10T00:00:00.000Z", "the review date, not the seed date");
  assert.deepEqual(k.key, { value: 2, confidence: "verified_human" });
  assert.equal(k.history[0].action, "key_change_approved");
  assert.equal(all.find((x) => x.item_id === "kf-held").status, "requires_review");
  const drop = all.find((x) => x.item_id === "kf-drop");
  assert.equal(drop.status, "retired");
  assert.equal(drop.bank, "unknown", "removed items keep an honest unknown home");
  assert.ok((files.get("review") || []).some((x) => x.item_id === "kf-drop"), "homeless ids go to review.json");
  assert.equal(report.keyfix_approved, 1);
  assert.equal(report.keyfix_review, 1);
  assert.equal(report.keyfix_retired, 1);
  assert.equal(report.tombstones_withdrawn_share_ids, 1171);
  for (const [, list] of files) {
    const s = list.map((r) => r.item_id);
    assert.deepEqual([...s].sort(), s, "records sorted by item_id");
  }
});

test("keyfixState: round 1 overlaid by rounds 2 and 3, last outcome per id wins", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qkf-"));
  try {
    fs.writeFileSync(path.join(dir, "changelog.json"), JSON.stringify([
      { n: 1, id: "a1", verdict_type: "key", owner_verdict: "C", action: "applied", old_key: "A", new_key: "C", destination: "ss-radiology v12/m", change: "old key A -> new key C" },
      { n: 2, id: "h1", verdict_type: "key", owner_verdict: "hold", action: "held" },
      { n: 3, id: "h2", verdict_type: "key", owner_verdict: "hold", action: "held" },
    ]));
    fs.mkdirSync(path.join(dir, "round2"));
    fs.writeFileSync(path.join(dir, "round2", "decisions.json"), JSON.stringify([
      { n: 2, id: "h1", verdict: "B", outcome: "applied", reason: "keyed B" },
      { n: 3, id: "h2", verdict: "held", outcome: "held", reason: "needs the figure" },
    ]));
    fs.mkdirSync(path.join(dir, "round3"));
    fs.writeFileSync(path.join(dir, "round3", "decisions.json"), JSON.stringify([
      { n: 3, id: "h2", verdict: "drop", outcome: "dropped", action: "apply", hold_reason: "" },
      { n: 4, id: "h3", verdict: "key E", outcome: "dropped", action: "hold", hold_reason: "kept for the owner" },
    ]));
    const st = Q.keyfixState(dir);
    assert.equal(st.get("a1").status, "approved");
    assert.deepEqual(st.get("a1").key, { value: 2, confidence: "verified_human" });
    assert.equal(st.get("h1").status, "approved", "round 1 hold resolved by round 2");
    assert.equal(st.get("h2").status, "retired", "round 3 drop wins over the round 2 hold");
    assert.equal(st.get("h3").status, "requires_review", "a hold wins over a dropped outcome (not shipped, still undecided)");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("set-status: reason required, approved needs a human reviewer, history append-only", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qss-"));
  try {
    seeded(tmp);
    const loaded = Q.loadSidecar(tmp);
    const before = JSON.parse(JSON.stringify(loaded.ids.get("disp-1").rec.history));
    assert.throws(() => Q.setStatus(loaded, { id: "disp-1", status: "approved", by: "reviewer:dr" }), /reason/);
    assert.throws(() => Q.setStatus(loaded, { id: "disp-1", status: "approved", reason: "looks fine now", by: "reviewer:dr" }), /reviewer/);
    assert.throws(() => Q.setStatus(loaded, { id: "disp-1", status: "approved", reason: "verified against the book", by: "tool:x", reviewer: "tool:x" }), /never a tool/);
    assert.throws(() => Q.setStatus(loaded, { id: "disp-1", status: "bogus", reason: "long enough reason", by: "owner:a" }), /unknown status/);
    const r = Q.setStatus(loaded, { id: "disp-1", status: "approved", reason: "verified against the standard textbook", by: "reviewer:dr-a", reviewer: "dr-a", at: "2026-10-13T00:00:00.000Z" });
    assert.equal(r.rec.status, "approved");
    assert.equal(r.rec.status_changed_at, "2026-10-13T00:00:00.000Z");
    assert.deepEqual(r.rec.history.slice(0, before.length), before, "older entries byte-identical");
    const last = r.rec.history[r.rec.history.length - 1];
    assert.deepEqual([last.action, last.from, last.to, last.reviewer], ["status_change", "requires_review", "approved", "dr-a"]);
    Q.saveSubject(tmp, r.subj, loaded.files.get(r.subj));
    const again = Q.loadSidecar(tmp);
    assert.equal(again.ids.get("disp-1").rec.history.length, before.length + 1);
    // a brand-new record lands in the named subject file with a created entry first
    const n = Q.setStatus(loaded, { id: "new-1", subject: "anatomy", status: "rejected", reason: "two options defensible, unfixable", by: "reviewer:dr-b", reviewer: "dr-b", bank: "bank module", bank_version: "v5", at: AT });
    assert.equal(n.created, true);
    assert.equal(n.rec.history[0].action, "created");
    assert.equal(n.subj, "anatomy");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("record-key-change: reason and distinct keys required; proposing reopens review; bank files untouched", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qkc-"));
  try {
    seeded(tmp);
    const bankFile = path.join(tmp, "bank-fixture.json");
    fs.writeFileSync(bankFile, JSON.stringify({ items: [{ id: "kf-ok", a: 2 }] }));
    const before = fs.readFileSync(bankFile, "utf8");
    const loaded = Q.loadSidecar(tmp);
    assert.throws(() => Q.recordKeyChange(loaded, { id: "kf-ok", from: "A", to: "B", by: "owner:x" }), /reason/);
    assert.throws(() => Q.recordKeyChange(loaded, { id: "kf-ok", from: "B", to: "B", reason: "a long enough reason", by: "owner:x" }), /same/);
    assert.throws(() => Q.recordKeyChange(loaded, { id: "kf-ok", from: "E", to: "B", reason: "a long enough reason", by: "owner:x" }), /A-D or 0-3/);
    assert.throws(() => Q.recordKeyChange(loaded, { id: "nope", from: "A", to: "B", reason: "a long enough reason", by: "owner:x" }), /no quality record/);
    const h0 = loaded.ids.get("kf-ok").rec.history.length;
    const p = Q.recordKeyChange(loaded, { id: "kf-ok", from: 2, to: "D", reason: "second erratum: the book's own key is D", by: "reviewer:dr-c", at: AT });
    assert.equal(p.rec.history[h0].action, "key_change_proposed");
    assert.deepEqual([p.rec.history[h0].from, p.rec.history[h0].to], [2, 3]);
    assert.equal(p.rec.status, "requires_review", "a proposed re-key reopens review");
    assert.throws(() => Q.recordKeyChange(loaded, { id: "kf-ok", from: "A", to: "B", reason: "a long enough reason", by: "reviewer:dr-c", approve: true }), /owner-sanctioned/);
    const a = Q.recordKeyChange(loaded, { id: "kf-ok", from: "C", to: "D", reason: "owner accepted the erratum", by: "owner:dr-m", approve: true, at: AT });
    assert.equal(a.rec.history[a.rec.history.length - 1].action, "key_change_approved");
    assert.equal(fs.readFileSync(bankFile, "utf8"), before, "bank bytes untouched");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("sync-flags: threshold reports become requires_review with history; idempotent; retired untouched", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qsf-"));
  try {
    seeded(tmp);
    const loaded = Q.loadSidecar(tmp);
    const byId2 = new Map([["rep-1", loc("anatomy")]]);
    const feed = { hidden: ["rep-1", "kf-ok"], reports: [{ itemId: "rep-1", n: 5, reasons: { "wrong-key": 4, unclear: 1 }, subject: "anatomy" }, { itemId: "low-1", n: 2, reasons: { typo: 2 } }] };
    const r1 = Q.syncFlags(loaded, { ...feed, byId: byId2, at: AT });
    assert.equal(r1.touched, 2);
    const rep = loaded.ids.get("rep-1").rec;
    assert.equal(rep.status, "requires_review");
    assert.match(rep.history[rep.history.length - 1].reason, /5 separate student reports \(wrong-keyx4, unclearx1\)/);
    assert.equal(loaded.ids.get("kf-ok").rec.status, "requires_review", "a dispute reopens an approval");
    assert.ok(!loaded.ids.get("low-1"), "under-threshold reports write nothing");
    const h1 = rep.history.length;
    const r2 = Q.syncFlags(loaded, { ...feed, byId: byId2, at: AT });
    assert.equal(r2.entries, 0, "second sync appends nothing");
    assert.equal(rep.history.length, h1);
    const drop = loaded.ids.get("kf-drop").rec;
    Q.syncFlags(loaded, { hidden: ["kf-drop"], at: AT });
    assert.equal(drop.status, "retired", "reports never resurrect a retired item");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("verify: passes a good sidecar; catches silent, reordered, reviewer-less and duplicated records", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qvf-"));
  try {
    seeded(tmp);
    const good = Q.verifySidecar(tmp);
    assert.deepEqual(good.errors, []);
    assert.ok(good.records > 5 && good.subjects >= 4);
    // break one file four ways
    const p = path.join(tmp, "v1", "anatomy.json");
    const f = JSON.parse(fs.readFileSync(p, "utf8"));
    f.records.push({ item_id: "bad-1", bank: "b", bank_version: "v", status: "approved", status_changed_at: AT, history: [{ at: AT, by: "tool:x", action: "status_change", reason: "x" }] });
    f.records.push({ item_id: "bad-2", bank: "b", bank_version: "v", status: "bogus", status_changed_at: AT, history: [{ at: AT, by: "a", action: "created", reason: "r" }] });
    f.records.push({ item_id: "bad-3", bank: "b", bank_version: "v", status: "requires_review", status_changed_at: AT, history: [{ at: "2026-10-13T00:00:00.000Z", by: "a", action: "flagged", reason: "r" }, { at: AT, by: "a", action: "flagged", reason: "r" }] });
    f.records.push({ item_id: "bad-4", bank: "b", bank_version: "v", status: "requires_review", status_changed_at: AT, history: [{ at: AT, by: "a", action: "status_change" }] });
    f.records.push(JSON.parse(JSON.stringify(f.records.find((r) => r.item_id === "disp-1"))));
    fs.writeFileSync(p, JSON.stringify(f));
    const bad = Q.verifySidecar(tmp);
    assert.ok(bad.errors.some((e) => /bad-1.*reviewer/), bad.errors.join("\n"));
    assert.ok(bad.errors.some((e) => /bad-2.*unknown status/), bad.errors.join("\n"));
    assert.ok(bad.errors.some((e) => /bad-3.*backwards/), bad.errors.join("\n"));
    assert.ok(bad.errors.some((e) => /bad-4.*without reason/), bad.errors.join("\n"));
    assert.ok(bad.errors.some((e) => /disp-1.*two files|not sorted/), bad.errors.join("\n"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("assembler: seeded requires_review/rejected/retired items never enter a test; approved and clean do", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qasm-"));
  try {
    seeded(tmp);
    const qual = {};
    for (const f of fs.readdirSync(path.join(tmp, "v1"))) Object.assign(qual, A.readQuality(JSON.parse(fs.readFileSync(path.join(tmp, "v1", f), "utf8"))));
    const mk = (id) => ({ id, q: `Stem for ${id} with enough distinct words for dedup purposes here`, o: ["a", "b", "c", "d"], a: 0, d: 2, _s: "anatomy", _m: "m1" });
    assert.match(A.eligible(mk("disp-1"), { quality: qual }), /status:requires_review/);
    assert.match(A.eligible(mk("kf-held"), { quality: qual }), /status:requires_review/);
    assert.match(A.eligible(mk("kf-drop"), { quality: qual }), /status:retired/);
    assert.equal(A.eligible(mk("kf-ok"), { quality: qual }), "", "owner-approved stays eligible");
    assert.equal(A.eligible(mk("clean-1"), { quality: qual }), "", "no record stays eligible");
    const p = A.profile("neet-pg");
    const bank = [{ s: "anatomy", m: "m1", items: ["disp-1", "kf-held", "kf-drop", "kf-ok", "clean-1", ...Array.from({ length: 20 }, (_, i) => `fresh-${i}`)].map(mk) }];
    const r = A.assemble(p, "subject_mini", { count: 25, seed: "q", quality: qual }, bank);
    assert.ok(r.ok);
    const ids = r.items.map((it) => it.id);
    assert.ok(!ids.includes("disp-1") && !ids.includes("kf-held") && !ids.includes("kf-drop"), "blocked ids absent: " + ids.join(","));
    assert.ok(ids.includes("kf-ok") && ids.includes("clean-1"));
    assert.ok((r.dropped["status:requires_review"] || 0) >= 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("fixed papers: buildPaper with the sidecar leaves blocked items out", () => {
  const tax = T.loadTaxonomy();
  const bank = ["anatomy", "physiology", "medicine", "surgery"].map((s) => ({
    s, m: "m1",
    items: Array.from({ length: 60 }, (_, i) => ({ id: `${s}-m1-${i}`, q: `Stem ${s} number ${i} with enough distinct words for dedup purposes`, o: ["a", "b", "c", "d"], a: i % 4, d: 2, _s: s, _m: "m1" })),
  }));
  const qual = { "anatomy-m1-0": { item_id: "anatomy-m1-0", status: "requires_review" }, "medicine-m1-1": { item_id: "medicine-m1-1", status: "retired" } };
  const r = T.buildPaper(tax, "neet-pg", "mini", "all", 1, bank, { v5: ["anatomy", "medicine", "physiology", "surgery"] }, {}, qual, AT);
  assert.ok(r.paper, JSON.stringify(r.shortfall));
  const ids = r.paper.items.map((t) => t[2]);
  assert.ok(!ids.includes("anatomy-m1-0") && !ids.includes("medicine-m1-1"));
  const sizes = T.poolSizes(bank, { quality: qual });
  assert.equal(Object.values(sizes).reduce((a, x) => a + x, 0), 4 * 60 - 2);
});

test("app pools: prep.js and prep-pyq.js usable/poolFor honour the sidecar, old calls unchanged", () => {
  const qual = {
    rr: { item_id: "rr", status: "requires_review" },
    rej: { item_id: "rej", status: "rejected" },
    ret: { item_id: "ret", status: "retired" },
    dk: { item_id: "dk", status: "approved", key: { value: 0, confidence: "disputed" } },
    rf: { item_id: "rf", status: "approved", rubric: { "OPT-03": "fail" } },
    ok: { item_id: "ok", status: "approved" },
    ac: { item_id: "ac", status: "automated_checks_passed" },
  };
  for (const id of ["rr", "rej", "ret", "dk", "rf"]) {
    assert.equal(PURE.usable({ id }, {}, qual), false, "prep.js blocks " + id);
    assert.equal(PYQ.usable({ id }, {}, qual), false, "prep-pyq.js blocks " + id);
  }
  assert.equal(PURE.usable({ id: "ok" }, {}, qual), true);
  assert.equal(PYQ.usable({ id: "ok", flags: ["exp-pending"] }, {}, qual), true, "exp-pending still tolerated");
  assert.equal(PYQ.usable({ id: "rr", flags: ["exp-pending"] }, {}, qual), false, "but a blocked record wins");
  assert.equal(PURE.usable({ id: "no-record" }, {}, qual), true);
  // old two-argument calls behave exactly as before
  assert.equal(PURE.usable({ id: "rr" }, {}), true);
  assert.equal(PURE.usable({ id: "x", flags: ["disputed"] }, {}), false);
  assert.equal(PURE.usable({ id: "x" }, { x: 1 }), false);
  assert.equal(PYQ.usable({ id: "x" }, { x: 1 }), false);
  const pool = PURE.poolFor([{ id: "rr" }, { id: "ok" }, { id: "fresh" }], "neet-pg", {}, qual);
  assert.deepEqual(pool.map((it) => it.id), ["ok", "fresh"]);
  assert.equal(PURE.poolFor([{ id: "rr" }], "neet-pg", {}).length, 1, "no map, no filter");
});

test("uploader: --as quality lists quality/ keys with index.json last", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qup-"));
  try {
    fs.mkdirSync(path.join(dir, "v1"));
    fs.writeFileSync(path.join(dir, "index.json"), "{}");
    fs.writeFileSync(path.join(dir, "v1", "anatomy.json"), "{}");
    const files = listFiles(dir, "quality");
    assert.deepEqual(files.map((f) => f.key), ["prep-bank/quality/v1/anatomy.json", "prep-bank/quality/index.json"]);
    assert.equal(files[1].last, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("scanCache reads the ids-cache shape: bank, overlay and pyq homes with flags", () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "qsc-"));
  try {
    // the scan only looks where the real taxonomy points: reuse this checkout's first anatomy topic
    const ix = JSON.parse(fs.readFileSync(new URL("../prep/bank/v5/anatomy/index.json", import.meta.url), "utf8"));
    const t0 = ix.topics[0].id;
    const w = (rel, j) => { const f = path.join(cache, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(j)); };
    w(`v5/anatomy/mcq/${t0}.json`, { items: [{ id: "b1", flags: ["disputed"] }, { id: "b2" }] });
    w("pyq-index.json", { file: "items-aaaaaaaa.json" });
    w("v5/pyq/items-aaaaaaaa.json", { items: [{ id: "p1", flags: ["dup-stem"] }] });
    const { byId: m, counts } = Q.scanCache(cache);
    assert.deepEqual(m.get("b1").flags, ["disputed"]);
    assert.equal(m.get("b1").bank_version, "v5");
    assert.equal(m.get("b1").subject, "anatomy");
    assert.equal(m.get("p1").subject, "pyq");
    assert.deepEqual(m.get("p1").flags, ["dup-stem"]);
    assert.ok(counts.items >= 3);
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
});
