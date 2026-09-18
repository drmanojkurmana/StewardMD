/* functions/_wardsynq/formulary-settings.js - the hospital's formulary, edited and loaded from a CSV (R3-2, audit F3).
 *
 * THE ONLY WAY IN. wardsynq.formulary used to be written by a raw POST /org/update with no check, so an entry the ordering
 * path could not use (a restriction nobody can clear, a second entry under the same name) was saved as if it were sound.
 * /org/update now refuses the key and points here; the router's GET/POST /org/formulary and POST /org/formulary-import
 * are the two doors, and both go through planFormulary below.
 *
 * ALWAYS A DRY RUN FIRST. Without `commit` the call reports, entry by entry (or CSV row by row), what would be added,
 * changed, left as it is or removed, and every problem with its reason. A commit re-runs exactly that and writes only when
 * the result is the one the dry run showed (`confirmCount` and `planId`, which covers the list as it stood too), the
 * hr-attendance-import and legacy-import pattern. ANY problem refuses the whole save: a skipped row could be the
 * restriction that stops a last-line antibiotic being ordered, and saving the rest without it would lift that silently.
 *
 * WardSynQ ships no formulary content. What a hospital stocks and restricts is its own.
 */
import { norm, resolveFormulary } from "./formulary.js";
import { parseCsv } from "./hr-attendance.js";

const str = (v) => (v == null ? "" : String(v).trim());
/* ponytail: the list lives in the hospital's org document (Firestore caps a document at 1 MiB, shared with every other
 * setting), so it is held to this many entries; a bigger formulary needs its own collection. */
const MAX_ENTRIES = 3000;
const MAX_CSV_BYTES = 2 * 1024 * 1024;
const LIMITS = { drug: 200, code: 60, approvedBy: 120, note: 500, aliases: 200, restrictedTo: 120 };
const MAX_LIST = 20;   // aliases or specialties on one entry
const FIELDS = ["drug", "code", "aliases", "restricted", "requiresApproval", "restrictedTo", "approvedBy", "note", "controlled", "retired"];
const CSV_FIELDS = FIELDS.filter((f) => f !== "retired");
const MESSAGES = {
  no_drug_or_code: "An entry needs a drug name or a code.",
  restriction_has_no_route: "A restricted drug needs an approval or at least one specialty that may prescribe it, or nobody could ever order it.",
  duplicate: "Another entry already uses this name, alias or code. Each may belong to one entry only.",
  too_long: "A value is longer than allowed.",
  too_many: "More than 20 aliases or specialties on one entry.",
  bad_yes_no: "Use yes or no.",
  bad_value: "This value could not be read.",
};

async function sha16(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const labelOf = (e) => (e && (str(e.drug) || str(e.code))) || "";
const keyOf = (e) => (str(e.code) ? "c:" + norm(e.code) : "n:" + norm(e.drug));
const problem = (reason, extra) => ({ reason, message: MESSAGES[reason], ...(extra || {}) });

/** PURE. One entry as it is stored: only the known fields, trimmed, empty ones left out. -> { entry, problems[] } */
function cleanEntry(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  if (!r) return { entry: {}, problems: [problem("bad_value")] };
  const problems = [], e = {};
  for (const f of ["drug", "code", "approvedBy", "note"]) {
    if (r[f] != null && typeof r[f] === "object") { problems.push(problem("bad_value", { field: f })); continue; }
    const v = str(r[f]);
    if (v.length > LIMITS[f]) problems.push(problem("too_long", { field: f }));
    if (v) e[f] = v;
  }
  for (const f of ["aliases", "restrictedTo"]) {
    if (r[f] == null) continue;
    if (!Array.isArray(r[f])) { problems.push(problem("bad_value", { field: f })); continue; }
    const list = [...new Set(r[f].map(str).filter(Boolean))];
    if (list.length > MAX_LIST) problems.push(problem("too_many", { field: f }));
    if (list.some((x) => x.length > LIMITS[f])) problems.push(problem("too_long", { field: f }));
    if (list.length) e[f] = list;
  }
  for (const f of ["restricted", "requiresApproval", "controlled", "retired"]) {
    if (r[f] != null && typeof r[f] !== "boolean") problems.push(problem("bad_value", { field: f }));
    if (r[f] === true) e[f] = true;
  }
  return { entry: e, problems };
}

/**
 * PURE. The list checked as a whole. Every problem carries the index of the entry it belongs to. The restriction rule is
 * formulary.js resolveFormulary's own (the one ordering applies); a name, alias or code used by two entries is reported
 * because lookup would silently take whichever came last.
 */
function checkFormulary(list) {
  const rows = Array.isArray(list) ? list : [];
  const cleaned = rows.map(cleanEntry);
  const problems = [];
  cleaned.forEach((c, index) => c.problems.forEach((p) => problems.push({ index, label: labelOf(c.entry), ...p })));
  const active = [];
  cleaned.forEach((c, index) => { if (!c.entry.retired) active.push(index); });
  const resolved = resolveFormulary(active.map((i) => cleaned[i].entry));
  for (const p of resolved.problems || []) {
    const index = active[p.index];
    problems.push({ index, label: labelOf(cleaned[index].entry), ...problem(p.reason) });
  }
  const owner = new Map();
  cleaned.forEach((c, index) => {
    const e = c.entry;
    const keys = new Set([...[e.drug, ...(e.aliases || [])].filter((n) => norm(n)).map((n) => "n:" + norm(n)), ...(norm(e.code) ? ["c:" + norm(e.code)] : [])]);
    for (const k of keys) {
      if (owner.has(k)) { problems.push({ index, label: labelOf(e), ...problem("duplicate", { clash: labelOf(cleaned[owner.get(k)].entry) }) }); break; }
      owner.set(k, index);
    }
  });
  return { entries: cleaned.map((c) => c.entry), problems };
}

/**
 * The plan for replacing `before` with `after` (both raw lists) and the off-formulary reason switch. Rows follow `after`;
 * `removed` names entries in `before` that `after` no longer has. changeCount is what a commit's confirmCount must equal.
 * -> { ok, entries, requireReasonOffFormulary, rows[{index, label, status, problems?}], removed[], counts, changeCount, planId, problems }
 */
async function planFormulary(before, after, flagBefore, flagAfter) {
  const prev = checkFormulary(before).entries;
  const next = checkFormulary(after);
  if (next.entries.length > MAX_ENTRIES) next.problems.push({ index: -1, label: "", reason: "too_many_entries", message: `A formulary holds at most ${MAX_ENTRIES} entries here.` });
  const prevByKey = new Map(prev.map((e) => [keyOf(e), e]));
  const seen = new Set();
  const rows = next.entries.map((e, index) => {
    const mine = next.problems.filter((p) => p.index === index);
    const old = prevByKey.get(keyOf(e));
    if (old) seen.add(keyOf(e));
    const status = mine.length ? "invalid" : !old ? "add" : JSON.stringify(old) === JSON.stringify(e) ? "unchanged" : "change";
    return { index, label: labelOf(e), status, ...(mine.length ? { problems: mine.map((p) => ({ reason: p.reason, message: p.message, ...(p.field ? { field: p.field } : {}), ...(p.clash ? { clash: p.clash } : {}) })) } : {}) };
  });
  const removed = prev.filter((e) => !seen.has(keyOf(e))).map(labelOf);
  const flagChanged = !!flagBefore !== !!flagAfter;
  const count = (s) => rows.filter((r) => r.status === s).length;
  const counts = { add: count("add"), change: count("change"), unchanged: count("unchanged"), invalid: count("invalid"), remove: removed.length, setting: flagChanged ? 1 : 0 };
  const changeCount = counts.add + counts.change + counts.remove + counts.setting;
  const planId = await sha16(JSON.stringify([prev, !!flagBefore, next.entries, !!flagAfter]));
  return { ok: next.problems.length === 0, entries: next.entries, requireReasonOffFormulary: !!flagAfter, rows, removed, counts, changeCount, planId, problems: next.problems };
}

/** PURE. The audit row's meta: counts, the reason and as many names as fit the chain's 200 characters, then "+N more". */
function auditMeta(plan, reason, via) {
  const names = [
    ...plan.rows.filter((r) => r.status === "add").map((r) => "+" + r.label),
    ...plan.rows.filter((r) => r.status === "change").map((r) => "~" + r.label),
    ...plan.removed.map((l) => "-" + l),
  ];
  const head = `${via} add ${plan.counts.add} change ${plan.counts.change} remove ${plan.counts.remove}${plan.counts.setting ? " reason-switch " + (plan.requireReasonOffFormulary ? "on" : "off") : ""} plan ${plan.planId} why ${str(reason).slice(0, 60)} :`;
  /* ponytail: the org audit chain keeps 200 characters of meta (_q_audit_chain.js), so a large load names its first entries
   * and counts the rest; the plan id ties the row to the dry run that listed them all. A per-entry trail needs its own store. */
  let out = head, shown = 0;
  for (const n of names) {
    const rest = names.length - shown - 1;
    const tail = rest > 0 ? ` +${rest} more` : "";
    if ((out + " " + n + tail).length > 200) break;
    out += " " + n; shown++;
  }
  return shown < names.length ? out + ` +${names.length - shown} more` : out;
}

const yesNo = (v) => { const x = str(v).toLowerCase(); return x === "" ? null : ["yes", "y", "true", "1"].includes(x) ? true : ["no", "n", "false", "0"].includes(x) ? false : undefined; };
const splitList = (v) => str(v).split(/[;|]/).map(str).filter(Boolean);

/**
 * PURE. The CSV against the list as it stands. Without a mapping: headers and a sample to map from. With a mapping and a
 * mode ("merge": rows add or replace the matching entry, the rest stay; "replace": the file becomes the formulary) the
 * resulting list, each result entry marked with the CSV row it came from, and the CSV rows' own reading problems.
 * -> { step: "map", ... } | { step: "plan", list, sourceRow[], rowProblems: Map(row -> problems[]) } | { error, message, status }
 */
function readFormularyCsv(csv, mapping, mode, current) {
  const text = String(csv == null ? "" : csv);
  if (!text.trim()) return { status: 422, error: "csv_required", message: "Choose the CSV file." };
  if (text.length > MAX_CSV_BYTES) return { status: 413, error: "csv_too_large", message: "The file is larger than 2 MB." };
  const lines = parseCsv(text);
  const dataRows = Math.max(0, lines.length - 1);
  if (dataRows > MAX_ENTRIES) return { status: 413, error: "too_many_rows", message: `The file has ${dataRows} rows. A formulary holds at most ${MAX_ENTRIES} entries here.` };
  if (!mapping || typeof mapping !== "object") {
    return { step: "map", fields: CSV_FIELDS, headers: (lines[0] || []).map((h) => str(h).slice(0, 60)), sample: lines.slice(1, 4).map((l) => l.map((x) => str(x).slice(0, 60))), rowCount: dataRows, maxEntries: MAX_ENTRIES };
  }
  if (mode !== "merge" && mode !== "replace") return { status: 422, error: "mode_required", message: "Choose whether the file is added to the formulary or replaces it." };
  const col = (f) => (mapping[f] === undefined || mapping[f] === null || mapping[f] === "" ? -1 : Number(mapping[f]));
  if (col("drug") < 0 && col("code") < 0) return { status: 422, error: "mapping_incomplete", message: "Choose the column that holds the drug name or the code." };
  const rowProblems = new Map();
  const fromFile = lines.slice(1).map((l, i) => {
    const row = i + 2, cell = (f) => (col(f) >= 0 ? l[col(f)] : undefined), raw = {};
    for (const f of ["drug", "code", "approvedBy", "note"]) if (cell(f) !== undefined) raw[f] = cell(f);
    for (const f of ["aliases", "restrictedTo"]) if (cell(f) !== undefined) raw[f] = splitList(cell(f));
    for (const f of ["restricted", "requiresApproval", "controlled"]) {
      if (cell(f) === undefined) continue;
      const b = yesNo(cell(f));
      if (b === undefined) rowProblems.set(row, [...(rowProblems.get(row) || []), problem("bad_yes_no", { field: f })]);
      else if (b) raw[f] = true;
    }
    return { row, raw };
  });
  const base = mode === "merge" ? (Array.isArray(current) ? current.slice() : []) : [];
  const sourceRow = base.map(() => null), cleanBase = base.map((x) => cleanEntry(x).entry);
  // The same entry: the same code, or the same name when either has no code. Never a near match (formulary.js).
  const same = (a, b) => (norm(a.code) && norm(b.code) ? norm(a.code) === norm(b.code) : !!norm(a.drug) && norm(a.drug) === norm(b.drug));
  for (const { row, raw } of fromFile) {
    // Merge replaces the matching entry with the file's row (which also brings a retired entry back); replace starts empty.
    // A second row for an entry the file already matched is added as its own entry, and so reported as a duplicate.
    // ponytail: a linear scan per row, 3000 x 3000 at most; index by key if files grow.
    const mine = cleanEntry(raw).entry;
    const at = mode === "merge" ? cleanBase.findIndex((x, i) => sourceRow[i] === null && same(x, mine)) : -1;
    if (at >= 0) { base[at] = raw; sourceRow[at] = row; }
    else { base.push(raw); sourceRow.push(row); }
  }
  return { step: "plan", list: base, sourceRow, rowProblems };
}

export { MAX_ENTRIES, CSV_FIELDS, cleanEntry, checkFormulary, planFormulary, auditMeta, readFormularyCsv };
