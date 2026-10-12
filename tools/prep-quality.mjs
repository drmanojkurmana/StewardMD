#!/usr/bin/env node
/* PrepNucleus item-quality sidecar: the per-question status store with audit history (plan sections 7, 11).
 * Dev-only, never shipped. $0 AI.
 *
 * WHAT. prep/quality/v1/<subject>.json + prep/quality/index.json, published to R2 prep-bank/quality/ where
 * functions/api/prep/bank/[[path]].js serves them and the app (prep-tests.js, prep.js, prep-pyq.js) reads them
 * through prep-assess.js readQuality/eligible. One record per item id that is NOT plain verified:
 *   status: draft | automated_checks_passed | requires_review | approved | rejected | retired
 *   (schema: prep/assess/schemas/item-quality.schema.json), plus status_changed_at and a history array.
 * History actions use the schema vocabulary: created, checked, flagged, status_change, key_change_proposed,
 * key_change_approved, explanation_upgraded, retired. Every status or key change carries by (actor), reason and
 * source (screen tool, student report, owner review, item statistics); nothing is ever silent.
 *
 * DEFAULT (no record): an item in a verified bank is treated as automated_checks_passed and stays eligible.
 * requires_review, rejected and retired items are EXCLUDED from engine tests, fixed papers and PYQ papers;
 * approved is set only when a qualified reviewer actually reviewed (set-status demands --reviewer).
 * Statistics (tools/prep-item-stats.mjs) only ever FLAG items for review here, never rewrite or remove.
 *
 * RUN (seed v1 from the facts on disk and live; nothing is invented). The sidecar is a generated
 * deployable (like the share-ID index): it lives in R2, not in git; --out defaults to ~/prep-data/quality/out.
 *   node tools/prep-quality.mjs seed [--api URL] [--cache dir] [--keyfix dir] [--out dir] [--no-fetch]
 *     bank flags of every live item (disputed from tools/prep-screen-keys.mjs, exp- and dup- flags from the bank
 *     build) -> requires_review; live hidden ids (/api/prep/flag?hidden=1) -> requires_review; owner key
 *     reviews (~/prep-data/keyfix rounds 1-3, all 2026-10-10) -> approved + key_change_approved, still-held
 *     -> requires_review, dropped -> retired. Withdrawn share IDs (ids index "x") cannot name their items
 *     (a share ID is a hash of its key), so they are counted in the report, not stored per item.
 *   node tools/prep-quality.mjs set-status --id <item> --status <s> --reason <text> --by <actor>
 *     [--reviewer <name>] [--subject <sid>] [--bank <b>] [--bank-version <v>] [--out dir]
 *   node tools/prep-quality.mjs record-key-change --id <item> --from <A|B|C|D|0..3> --to <...> --reason <text>
 *     --by <actor> [--approve] [--out dir]
 *     Records the change ONLY (bank files are never touched here: a re-key ships through the normal
 *     release flow, then set-status approves). Proposed -> requires_review; --approve needs --by owner:*.
 *   node tools/prep-quality.mjs sync-flags [--api URL] [--token <owner>] [--from-file f.json] [--cache dir]
 *     [--out dir]
 *     Student reports at the flag.js HIDE_AT threshold become requires_review + history (the items stay
 *     hidden as today). --from-file { hidden: [ids], reports: [{ itemId, n, reasons, subject }] } replays
 *     offline (tests use this; no network).
 *   node tools/prep-quality.mjs verify [--out dir] [--cache dir]
 *   node tools/prep-quality.mjs publish [--out dir] [--yes]
 *     Uploads to R2 prep-bank/quality/ (new versioned subject files; index.json last, short cache).
 *
 * Determinism: subject files list records sorted by item_id; history appends only (older entries are never
 * edited, reordered or dropped). `verify` enforces this plus: every status/key change has a reason,
 * timestamps never go backwards, approved needs a named reviewer in its history.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fetchLive, readPublished, appConfig, subjectIndex } from "./prep-ids.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const QUALITY_VER = "v1";
export const STATUSES = ["draft", "automated_checks_passed", "requires_review", "approved", "rejected", "retired"];
export const HIDE_AT = 3;   // same threshold as functions/api/prep/flag.js
const LETTER = { A: 0, B: 1, C: 2, D: 3 };

/* ---------- small io ---------- */
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
function writeJson(p, o) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); }
async function getJSON(url, headers = {}) {
  for (let t = 1; ; t++) {
    try {
      const r = await fetch(url, { cache: "no-store", headers });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(url + " HTTP " + r.status);
      return await r.json();
    } catch (e) { if (t >= 4) throw e; await new Promise((r) => setTimeout(r, 1500 * t)); }
  }
}

/* ---------- live bank scan (the ids cache: { items: [{ id, flags }] }, no question text) ---------- */
/* scanCache(cache, root) -> { byId: Map(id -> { subject, bank, bank_version, module, flags }), counts }.
   Shape mirrors tools/prep-ids.mjs collect(): bank modules at <bv>/<sid>/mcq/<mod>.json, overlays at
   overlay/<set>/<sid>/<mod>.json, PYQ at <pyq>/pyq/<file>. */
export function scanCache(cache, root = ROOT) {
  const cfg = appConfig(root), byId = new Map();
  const counts = { items: 0, flagged: 0 };
  const read = (p) => { const f = path.join(cache, p); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null; };
  const add = (it, subject, bank, bank_version, module) => {
    if (!it || it.id == null) return;
    const id = String(it.id);
    if (!byId.has(id)) byId.set(id, { subject, bank, bank_version, module, flags: it.flags || [] });
    counts.items++;
    if (it.flags && it.flags.length) counts.flagged++;
  };
  for (const s of cfg.subjects) {
    for (const t of (subjectIndex(s.id, s.bv, root).topics || [])) {
      for (const it of ((read(`${s.bv}/${s.id}/mcq/${t.id}.json`) || {}).items) || []) add(it, s.id, "bank module", s.bv, t.id);
      for (const set of cfg.overlays[s.id] || []) {
        for (const it of ((read(`overlay/${set}/${s.id}/${t.id}.json`) || {}).items) || []) add(it, s.id, "overlay:" + set, set, t.id);
      }
    }
  }
  const pf = read("pyq-index.json");
  const py = pf && read(`${cfg.pyq}/pyq/${pf.file}`);
  for (const it of ((py || {}).items) || []) add(it, "pyq", "pyq:" + cfg.pyq, (pf && pf.file) || cfg.pyq, "pyq");
  return { byId, counts };
}

/* ---------- keyfix rounds (owner key reviews; all 2026-10-10) ---------- */
/* keyfixState(dir) -> Map(id -> { status, history entries, reviewer }). Round 1 changelog (244: 211 applied,
   33 held) is overlaid by round 2 decisions (33) and round 3 decisions (15): the last outcome per id wins.
   applied/rebuilt/split -> approved; held -> requires_review; dropped -> retired. */
export function keyfixState(dir) {
  const out = new Map();
  const put = (id, e) => { if (id) out.set(String(id), e); };
  const r1 = JSON.parse(fs.readFileSync(path.join(dir, "changelog.json"), "utf8"));
  for (const x of r1) {
    if (x.action === "applied") {
      const ni = LETTER[String(x.new_key || "").trim()];
      put(x.id, {
        status: "approved", reviewer: "owner",
        key: ni == null ? undefined : { value: ni, confidence: "verified_human" },
        entry: { at: "2026-10-10T00:00:00.000Z", by: "owner", action: "key_change_approved", from: x.old_key || undefined, to: x.new_key || undefined, reason: x.change || x.owner_verdict || "owner key verdict applied", evidence: "keyfix round 1 (2026-10-10): " + (x.owner_verdict || x.verdict_type || ""), source: "owner review" },
      });
    } else put(x.id, { status: "requires_review", entry: { at: "2026-10-10T00:00:00.000Z", by: "owner", action: "flagged", reason: "held in keyfix round 1 for owner review", source: "owner review" } });
  }
  const r2 = JSON.parse(fs.readFileSync(path.join(dir, "round2", "decisions.json"), "utf8"));
  for (const x of r2) {
    const o = String(x.outcome || "");
    if (o === "dropped") put(x.id, { status: "retired", entry: { at: "2026-10-10T00:00:00.000Z", by: "owner", action: "retired", reason: x.reason || "dropped in keyfix round 2: " + (x.verdict || ""), source: "owner review" } });
    else if (o === "held") put(x.id, { status: "requires_review", entry: { at: "2026-10-10T00:00:00.000Z", by: "owner", action: "flagged", reason: x.reason || "held in keyfix round 2: " + (x.verdict || ""), source: "owner review" } });
    else put(x.id, { status: "approved", reviewer: "owner", entry: { at: "2026-10-10T00:00:00.000Z", by: "owner", action: "key_change_approved", reason: (x.verdict ? x.verdict + ". " : "") + (x.reason || "owner key verdict applied") + " (" + o + " in keyfix round 2, shipped v14/radmax6)", source: "owner review" } });
  }
  const r3 = JSON.parse(fs.readFileSync(path.join(dir, "round3", "decisions.json"), "utf8"));
  for (const x of r3) {
    // A hold wins over the outcome: round 3 marks its 2 held items outcome "dropped" (not shipped) with
    // action "hold" (kept for the owner, still undecided). Only an applied drop retires.
    if (x.action === "hold") put(x.id, { status: "requires_review", entry: { at: "2026-10-10T00:00:00.000Z", by: "owner", action: "flagged", reason: x.hold_reason || "held in keyfix round 3", source: "owner review" } });
    else if (String(x.outcome || "") === "dropped") put(x.id, { status: "retired", entry: { at: "2026-10-10T00:00:00.000Z", by: "owner", action: "retired", reason: x.hold_reason || ("dropped in keyfix round 3: " + (x.verdict || "")), source: "owner review" } });
    else put(x.id, { status: "approved", reviewer: "owner", entry: { at: "2026-10-10T00:00:00.000Z", by: "owner", action: "key_change_approved", reason: (x.verdict ? x.verdict + ". " : "") + (x.outcome || "applied") + " in keyfix round 3 (shipped v15)", source: "owner review" } });
  }
  for (const [, e] of out) if (e.entry.from === undefined) delete e.entry.from;
  return out;
}

/* ---------- records ---------- */
function entry(at, by, action, o = {}) {
  const e = { at, by, action };
  for (const k of ["from", "to", "reason", "evidence", "source", "reviewer"]) if (o[k] !== undefined) e[k] = o[k];
  return e;
}
function blank(id, loc) {
  return { item_id: String(id), bank: (loc && loc.bank) || "unknown", bank_version: (loc && loc.bank_version) || "unknown", status: "draft", status_changed_at: null, history: [] };
}
/* applySeed(rec, status, e, at): first seed entry sets status + stamp; later seeds append (keyfix overlays flags). */
function applySeed(rec, status, e, at, key) {
  rec.history.push(e);
  rec.status = status; rec.status_changed_at = e.at || at;
  if (key) rec.key = key;
  return rec;
}
const FLAG_BY = { disputed: "prep-screen-keys" };
function flagReason(f) {
  return { disputed: "independent blind solve chose a different answer than the key (tools/prep-screen-keys.mjs)", "exp-letter": "the explanation names a different option letter than the key", "exp-text": "the explanation restates a different option than the key", "dup-key": "the source holds this question twice with different keys", "dup-stem": "the same stem appears elsewhere with a different key" }[f] || ("bank flag: " + f);
}

/* seed({ byId, hidden, keyfix, tombstones, at }) -> { files: Map(subject -> records), report }.
   Pure (no io): tests drive it with fixtures. Placement: the subject file of the item's live home;
   ids with no live home go to "review" (audit trail only: the client loads per-subject files). */
export function seed({ byId, hidden = [], keyfix = new Map(), tombstones = 0, at = new Date().toISOString() }) {
  const recs = new Map(), files = new Map();
  const get = (id) => { if (!recs.has(id)) recs.set(id, blank(id, byId.get(id))); return recs.get(id); };
  const report = { flagged: 0, hidden: 0, keyfix_approved: 0, keyfix_review: 0, keyfix_retired: 0, tombstones_withdrawn_share_ids: tombstones };
  for (const [id, loc] of byId) {
    const flags = (loc.flags || []).filter((f) => f !== "exp-pending");
    if (!flags.length) continue;
    const rec = get(id);
    for (const f of flags) rec.history.push(entry(at, FLAG_BY[f] || "prep-build-bank", "flagged", { reason: flagReason(f), source: f === "disputed" ? "screen tool" : "bank build" }));
    rec.status = "requires_review"; rec.status_changed_at = at;
    report.flagged++;
  }
  for (const id of hidden) {
    const rec = get(String(id));
    rec.history.push(entry(at, "prep-flag", "flagged", { reason: "hidden after repeated student reports (functions/api/prep/flag.js)", source: "student report" }));
    if (rec.status !== "retired" && rec.status !== "rejected") { rec.status = "requires_review"; rec.status_changed_at = at; }
    report.hidden++;
  }
  for (const [id, k] of keyfix) {
    const rec = get(String(id));
    applySeed(rec, k.status, k.entry, at, k.key);
    if (k.status === "approved") report.keyfix_approved++;
    else if (k.status === "retired") report.keyfix_retired++;
    else report.keyfix_review++;
  }
  for (const [id, rec] of recs) {
    const loc = byId.get(id);
    const subj = (loc && loc.subject) || "review";
    if (!files.has(subj)) files.set(subj, []);
    files.get(subj).push(rec);
  }
  for (const [, list] of files) list.sort((a, b) => (a.item_id < b.item_id ? -1 : 1));
  report.records = recs.size; report.subjects = files.size;
  return { files, report };
}

export function writeSidecar(dir, ver, files, meta = {}) {
  const subjects = {};
  for (const [subj, records] of [...files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    writeJson(path.join(dir, ver, subj + ".json"), { v: 1, subject: subj, quality_version: ver, generated_at: meta.generated_at || new Date().toISOString(), records });
    subjects[subj] = ver + "/" + subj + ".json";
  }
  writeJson(path.join(dir, "index.json"), { v: 1, generated_at: meta.generated_at || new Date().toISOString(), version: ver, subjects, ...meta.indexExtra });
  return subjects;
}

/* ---------- read / mutate ---------- */
export function loadSidecar(dir) {
  const ix = readJson(path.join(dir, "index.json"));
  const files = new Map(), ids = new Map();
  for (const [subj, name] of Object.entries(ix.subjects || {})) {
    const f = readJson(path.join(dir, name));
    files.set(subj, f);
    for (const r of f.records || []) ids.set(String(r.item_id), { subj, rec: r });
  }
  return { ix, files, ids };
}
export function saveSubject(dir, subj, file) {
  file.records.sort((a, b) => (a.item_id < b.item_id ? -1 : 1));
  writeJson(path.join(dir, file.quality_version && subj ? file.quality_version + "/" + subj + ".json" : QUALITY_VER + "/" + subj + ".json"), file);
}
function need(cond, msg) { if (!cond) throw new Error(msg); }

/* setStatus(ids, files, { id, status, reason, by, reviewer, subject, bank, bank_version, at })
   -> { rec, subj, created }. Pure over loaded maps; the caller saves. */
export function setStatus(loaded, o) {
  need(o.id != null && String(o.id).length >= 1, "set-status needs --id");
  need(STATUSES.includes(o.status), "unknown status " + o.status + " (want " + STATUSES.join("|") + ")");
  need(o.reason && String(o.reason).trim().length >= 8, "set-status needs --reason (at least 8 characters, never silent)");
  need(o.by && String(o.by).trim(), "set-status needs --by (actor: role or tool name)");
  if (o.status === "approved") need(o.reviewer && String(o.reviewer).trim() && !/^(tool|system):/.test(o.reviewer), "approved needs --reviewer <qualified reviewer> (a person, never a tool)");
  const at = o.at || new Date().toISOString();
  const id = String(o.id);
  let subj = loaded.ids.get(id)?.subj || o.subject || "review";
  let rec = loaded.ids.get(id)?.rec;
  const created = !rec;
  if (!rec) {
    rec = blank(id, { bank: o.bank, bank_version: o.bank_version });
    rec.history.push(entry(at, "prep-quality", "created", { reason: "record created", source: "review" }));
    if (!loaded.files.has(subj)) loaded.files.set(subj, { v: 1, subject: subj, quality_version: QUALITY_VER, generated_at: at, records: [] });
    loaded.files.get(subj).records.push(rec);
    loaded.ids.set(id, { subj, rec });
  }
  const from = rec.status;
  rec.history.push(entry(at, o.by, "status_change", { from, to: o.status, reason: String(o.reason).trim(), source: o.source || "review", ...(o.reviewer ? { reviewer: o.reviewer } : {}) }));
  rec.status = o.status; rec.status_changed_at = at;
  return { rec, subj, created };
}

function keyIdx(v) {
  const s = String(v).trim().toUpperCase();
  if (/^[A-D]$/.test(s)) return LETTER[s];
  if (/^[0-3]$/.test(s)) return Number(s);
  return null;
}
/* recordKeyChange(loaded, { id, from, to, reason, by, approve, at }) -> { rec, subj }.
   Never touches bank files (this tool only writes the sidecar dir). */
export function recordKeyChange(loaded, o) {
  need(o.id != null, "record-key-change needs --id");
  const from = keyIdx(o.from ?? ""), to = keyIdx(o.to ?? "");
  need(from != null && to != null, "record-key-change needs --from/--to as A-D or 0-3");
  need(from !== to, "record-key-change --from and --to are the same (" + o.from + ")");
  need(o.reason && String(o.reason).trim().length >= 8, "record-key-change needs --reason (at least 8 characters, never silent)");
  need(o.by && String(o.by).trim(), "record-key-change needs --by (actor)");
  if (o.approve) need(/^owner:/.test(o.by), "record-key-change --approve needs --by owner:<name> (owner-sanctioned only)");
  const at = o.at || new Date().toISOString();
  const id = String(o.id);
  const hit = loaded.ids.get(id);
  need(hit, "record-key-change: no quality record for " + id + " (set-status first, so the item's home is known)");
  const e = entry(at, o.by, o.approve ? "key_change_approved" : "key_change_proposed", { from, to, reason: String(o.reason).trim(), source: o.source || "review" });
  hit.rec.history.push(e);
  if (!o.approve && hit.rec.status !== "rejected" && hit.rec.status !== "retired") { hit.rec.status = "requires_review"; hit.rec.status_changed_at = at; }
  return { rec: hit.rec, subj: hit.subj };
}

/* syncFlags(loaded, { hidden, reports, byId, at }) -> { touched, entries }. Pure merge of live reports:
   hidden ids and reports at/over HIDE_AT become requires_review + a flagged history entry (approved is
   reopened: a dispute outranks an old approval). Idempotent: an identical entry is never appended twice. */
export function syncFlags(loaded, { hidden = [], reports = [], byId = new Map(), at = new Date().toISOString() }) {
  const want = new Map();
  for (const id of hidden) if (!want.has(String(id))) want.set(String(id), null);
  for (const r of reports || []) {
    if ((r.n || 0) >= HIDE_AT) want.set(String(r.itemId || r.item_id), r);
    else if (r.itemId && !want.has(String(r.itemId))) { /* under threshold: no record */ }
  }
  let touched = 0, entries = 0;
  for (const [id, r] of want) {
    const reason = r ? `${r.n} separate student reports (${Object.entries(r.reasons || {}).map(([k, v]) => k + "x" + v).join(", ") || "reasons unknown"})` : "hidden after repeated student reports (functions/api/prep/flag.js)";
    let hit = loaded.ids.get(id);
    if (!hit) {
      const loc = byId.get(id);
      const subj = (loc && loc.subject) || (r && r.subject) || "review";
      const rec = blank(id, loc);
      rec.history.push(entry(at, "prep-quality", "created", { reason: "record created", source: "review" }));
      if (!loaded.files.has(subj)) loaded.files.set(subj, { v: 1, subject: subj, quality_version: QUALITY_VER, generated_at: at, records: [] });
      loaded.files.get(subj).records.push(rec);
      loaded.ids.set(id, { subj, rec });
      hit = { subj, rec };
    }
    const dup = hit.rec.history.some((h) => h.action === "flagged" && h.by === "prep-flag" && h.reason === reason);
    if (!dup) { hit.rec.history.push(entry(at, "prep-flag", "flagged", { reason, source: "student report" })); entries++; }
    if (hit.rec.status !== "retired" && hit.rec.status !== "rejected" && hit.rec.status !== "requires_review") { hit.rec.status = "requires_review"; hit.rec.status_changed_at = at; }
    else if (hit.rec.status === "approved") { hit.rec.status = "requires_review"; hit.rec.status_changed_at = at; }
    touched++;
  }
  return { touched, entries };
}

/* ---------- verify ---------- */
const ACTIONS = ["created", "checked", "flagged", "status_change", "key_change_proposed", "key_change_approved", "explanation_upgraded", "retired"];
export function verifySidecar(dir, { cache = null, root = ROOT } = {}) {
  const errors = [], warns = [];
  const ix = readJson(path.join(dir, "index.json"));
  if (!ix || ix.v !== 1 || !ix.subjects || typeof ix.subjects !== "object") errors.push("index.json: want { v: 1, subjects: {...} }");
  const seen = new Map();
  for (const [subj, name] of Object.entries((ix && ix.subjects) || {})) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) { errors.push(subj + ": " + name + " missing"); continue; }
    const f = readJson(p);
    if (!Array.isArray(f.records)) { errors.push(subj + ": no records array"); continue; }
    let prev = "";
    for (const r of f.records) {
      const id = String(r.item_id ?? "");
      if (!id) { errors.push(subj + ": record without item_id"); continue; }
      if (id < prev) errors.push(subj + ": records not sorted by item_id (at " + id + ")");
      prev = id;
      if (seen.has(id)) errors.push(id + ": in two files (" + seen.get(id) + ", " + subj + ")");
      else seen.set(id, subj);
      for (const k of ["item_id", "bank", "bank_version", "status", "history"]) if (r[k] == null) errors.push(id + ": missing " + k);
      if (!STATUSES.includes(r.status)) errors.push(id + ": unknown status " + r.status);
      if (!Array.isArray(r.history) || !r.history.length) { errors.push(id + ": empty history"); continue; }
      let pat = "";
      for (const h of r.history) {
        if (!h.at || !h.by || !h.action) { errors.push(id + ": history entry without at/by/action"); continue; }
        if (!ACTIONS.includes(h.action)) errors.push(id + ": unknown history action " + h.action);
        if (h.at < pat) errors.push(id + ": history timestamps go backwards (append-only violated at " + h.at + ")");
        pat = h.at;
        if ((h.action === "status_change" || h.action === "key_change_proposed" || h.action === "key_change_approved" || h.action === "retired") && !(h.reason && String(h.reason).trim())) errors.push(id + ": " + h.action + " without reason");
      }
      if (r.status === "approved") {
        const ok = r.history.some((h) => h.reviewer || /^(reviewer|owner):|^owner$/.test(h.by));
        if (!ok) errors.push(id + ": approved without a named reviewer in its history");
      }
      if (r.key && (r.key.value == null || r.key.confidence == null)) errors.push(id + ": key without value/confidence");
    }
  }
  if (cache) {
    const { byId } = scanCache(cache, root);
    for (const [id, subj] of seen) {
      if (!byId.has(id)) {
        const rec = readJson(path.join(dir, ix.subjects[subj])).records.find((r) => String(r.item_id) === id);
        if (rec && rec.status !== "retired") warns.push(id + ": not in the live bank (" + rec.status + ")");
      }
    }
  }
  return { errors, warns, records: seen.size, subjects: Object.keys((ix && ix.subjects) || {}).length };
}

/* ---------- cli ---------- */
function upload(dir, yes) {
  // --no-ids: the sidecar names existing items, so the share-ID index needs no rebuild.
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [path.join(ROOT, "tools/prep-upload-bank.mjs"), "--dir", dir, "--as", "quality", "--jobs", "8", "--no-ids"].concat(yes ? ["--yes"] : []), { stdio: "inherit" });
    p.on("close", (c) => (c === 0 ? res() : rej(new Error("upload failed"))));
  });
}
async function main(argv = process.argv.slice(2)) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const cmd = argv[0];
  const api = arg("--api", "https://stewardmd.in/api/prep/bank/").replace(/\/?$/, "/");
  const dir = path.resolve(arg("--out", arg("--dir", path.join(os.homedir(), "prep-data/quality/out"))));
  if (cmd === "seed") {
    const cache = path.resolve(arg("--cache", path.join(os.homedir(), "prep-data/ids/cache")));
    const keyfix = arg("--keyfix", path.join(os.homedir(), "prep-data/keyfix"));
    const at = new Date().toISOString();
    if (!argv.includes("--no-fetch")) await fetchLive({ api, cache });
    const { byId, counts } = scanCache(cache);
    const hid = await getJSON(api.replace(/\/api\/prep\/bank\/$/, "/api/prep/flag?hidden=1")).catch(() => ({ ids: [] }));
    const pub = await readPublished(api).catch(() => null);
    const tomb = pub ? Object.values(pub.e).filter((v) => v === "x").length : 0;
    const kx = fs.existsSync(path.join(keyfix, "changelog.json")) ? keyfixState(keyfix) : new Map();
    const { files, report } = seed({ byId, hidden: (hid && hid.ids) || [], keyfix: kx, tombstones: tomb, at });
    writeSidecar(dir, QUALITY_VER, files, { generated_at: at });
    console.log(`seed: ${counts.items} live items scanned, ${report.records} records in ${report.subjects} subject files -> ${dir}`);
    console.log(`  flagged=${report.flagged} hidden=${report.hidden} keyfix(approved=${report.keyfix_approved} review=${report.keyfix_review} retired=${report.keyfix_retired}) tombstoned_share_ids=${report.tombstones_withdrawn_share_ids} (counted, not stored: a share ID cannot name its item)`);
    return;
  }
  if (cmd === "set-status") {
    const loaded = loadSidecar(dir);
    const r = setStatus(loaded, { id: arg("--id"), status: arg("--status"), reason: arg("--reason"), by: arg("--by"), reviewer: arg("--reviewer"), subject: arg("--subject"), bank: arg("--bank"), bank_version: arg("--bank-version") });
    saveSubject(dir, r.subj, loaded.files.get(r.subj));
    console.log(`set-status: ${r.rec.item_id} -> ${r.rec.status} (${r.subj}, history ${r.rec.history.length}${r.created ? ", new record" : ""})`);
    return;
  }
  if (cmd === "record-key-change") {
    const loaded = loadSidecar(dir);
    const r = recordKeyChange(loaded, { id: arg("--id"), from: arg("--from"), to: arg("--to"), reason: arg("--reason"), by: arg("--by"), approve: argv.includes("--approve") });
    saveSubject(dir, r.subj, loaded.files.get(r.subj));
    console.log(`record-key-change: ${r.rec.item_id} ${arg("--from")}->${arg("--to")} (${argv.includes("--approve") ? "approved" : "proposed"}, history ${r.rec.history.length})`);
    return;
  }
  if (cmd === "sync-flags") {
    const loaded = loadSidecar(dir);
    let hidden = [], reports = [];
    if (arg("--from-file", null)) {
      const f = JSON.parse(fs.readFileSync(path.resolve(arg("--from-file")), "utf8"));
      hidden = f.hidden || []; reports = f.reports || [];
    } else {
      const base = api.replace(/\/api\/prep\/bank\/$/, "/api/prep/flag");
      const h = await getJSON(base + "?hidden=1").catch(() => ({ ids: [] }));
      hidden = (h && h.ids) || [];
      const tok = arg("--token", process.env.PREP_FLAG_TOKEN || "");
      if (tok) { const t = await getJSON(base + "?top=1", { "X-Admin-Token": tok }).catch(() => null); reports = (t && t.items) || []; }
      else console.log("sync-flags: no --token, merging hidden ids only (counts/reasons need the owner endpoint)");
    }
    const cache = arg("--cache", null);
    const byId = cache ? scanCache(path.resolve(cache)).byId : new Map();
    const r = syncFlags(loaded, { hidden, reports, byId });
    for (const [subj, f] of loaded.files) saveSubject(dir, subj, f);
    console.log(`sync-flags: ${r.touched} items require review, ${r.entries} new history entries`);
    return;
  }
  if (cmd === "verify") {
    const r = verifySidecar(dir, { cache: arg("--cache", null) ? path.resolve(arg("--cache")) : null });
    for (const w of r.warns.slice(0, 20)) console.log("warn: " + w);
    if (r.warns.length > 20) console.log(`warn: ... ${r.warns.length - 20} more`);
    if (r.errors.length) { for (const e of r.errors.slice(0, 40)) console.error("error: " + e); throw new Error(r.errors.length + " errors"); }
    console.log(`verify: ${r.records} records in ${r.subjects} subject files, history append-only, all changes reasoned`);
    return;
  }
  if (cmd === "publish") {
    await upload(dir, argv.includes("--yes"));
    return;
  }
  console.log("usage: node tools/prep-quality.mjs seed|set-status|record-key-change|sync-flags|verify|publish [...]");
  process.exit(2);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message || e); process.exit(1); });
