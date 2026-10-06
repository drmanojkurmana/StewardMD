#!/usr/bin/env node
/* StewardMD - apply a clinical review export from the in-app review desk (review-desk.js).
 *
 *   node scripts/apply-reviews.mjs <export.json>                  apply, then rebuild the touched bundles
 *   node scripts/apply-reviews.mjs <export.json> --dry            print the plan, write nothing
 *   node scripts/apply-reviews.mjs <export.json> --include-minor  also mark "approve after minor edits"
 *                                                                 items reviewed (only once the edits are made)
 *   node scripts/apply-reviews.mjs <reviews-all.json>             the server download (GET /api/kits/reviews/all,
 *                                                                 owner only): { reviews: [export, ...] }, applied in turn
 *   node scripts/apply-reviews.mjs <export.json> --accept-unverified
 *                                                                 accept a reviewer whose registration the app
 *                                                                 did not verify (you vouch for them)
 *
 * What it does, per decision:
 *   approve         review.status ai_drafted -> "reviewed", review.reviewer = "<name>, Reg. No. <n>, <date>"
 *   approve-minor   written to the feedback note; status changes only with --include-minor
 *   changes         written to the feedback note; status unchanged
 * Tokós (kind "tokos", no build step: build-www.sh copies tokos/ as is):
 *   case-<id>       approve sets that case's review in tokos/decks/ctg.json to { by, date, the suggested labels as
 *                   approved (TOKOS_CTG.suggestedReview, tokos-ctg.js), complete: true }. ctg.json is machine-generated with
 *                   JSON.stringify(deck, null, 1), so it is rewritten the same way; the script first checks the file
 *                   is exactly that form, so every byte outside the case's review stays the same.
 *   rationale, checklist, calipers
 *                   approve sets review / reviewChecklist / reviewCalipers in tokos/rationale.json to "reviewed"
 *                   (rewritten in place like the other content).
 *   Tokós 2.0 content (tokosTarget below). Every approve is also recorded in tokos/reviews.json {v, items: {id:
 *   {status, reviewer}}}, which the Review Desk reads for these items and which "already reviewed" checks:
 *   unit-<unitId>   every lesson of the unit: its review becomes {status: "reviewed", reviewer, verify kept}
 *   drill-<id>      tokos/drill/<id>.json review "reviewed", then tools/tokos-build-drills.mjs regenerates the model
 *   sim-labour, tool-<id>, explorer-<id>
 *                   the model file tokos-models/<file>.js: review: "ai_drafted" becomes review: "reviewed", reviewedBy
 *   clinic-fetal-planes, clinic-hc-biometry
 *                   the deck's top-level review "reviewed" (the teaching points in tokos-clinic-us.js go with it)
 *   bank-<topicId>  the ledger only (the bank files are generated from MedMCQA; its key flags were checked)
 * Items already reviewed or approved are never changed (the note says so). Only the "review" object of each
 * file is rewritten, in place, so the rest of the hand-formatted JSON stays byte-identical.
 * Feedback is appended to vault/handoff/review-feedback.md. The export holds content ids and comments only.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const KINDS = {
  protocol: { dir: "kb/clinical-protocols", build: "scripts/build-clinical-protocols.mjs", label: "Protocol" },
  kit: { dir: "kb/specialty-kits/src", build: "scripts/build-specialty-kits.mjs", label: "Specialty kit" },
  consent: { dir: "kb/documents/consent", build: "scripts/build-documents.mjs", label: "Consent template" },
  tokos: { dir: "tokos", build: null, label: "Tokós" },
  narke: { dir: "narke", build: null, label: "Narkē" },
};
// Tokós text blocks: review-desk id -> the top-level key of tokos/rationale.json that holds its review.
export const TOKOS_TEXT = { rationale: "review", checklist: "reviewChecklist", calipers: "reviewCalipers" };
const TOKOS_CTG = createRequire(import.meta.url)("../tokos-ctg.js");
export const TOKOS_LEDGER = "tokos/reviews.json";

/** Tokós 2.0 desk id -> the files an approve rewrites and how, or null for an id this repo does not have. */
export function tokosTarget(id, root, read, exists, host = "tokos") {
  let m;
  const H = host, HM = host + "-models";
  const J = (f) => JSON.parse(read(join(root, f)));
  if ((m = /^unit-([a-z]+\d+)$/.exec(id))) {
    const f = H + "/learn/units/" + m[1] + ".json";
    return exists(join(root, f)) ? { files: J(f).lessons.map((l) => ({ file: join(root, H + "/learn/lessons", l + ".json"), how: "lesson" })) } : null;
  }
  if ((m = /^drill-([a-z-]+)$/.exec(id))) return { files: [{ file: join(root, H + "/drill", m[1] + ".json"), how: "string" }], build: "tools/tokos-build-drills.mjs" + (H === "tokos" ? "" : " --host " + H) };
  if (H === "tokos" && id === "sim-labour") return { files: [{ file: join(root, "tokos-models/drill-labour.js"), how: "js" }] };
  if (/^(tool|explorer)-[a-z0-9-]+$/.test(id)) return { files: [{ file: join(root, HM, id + ".js"), how: "js" }] };
  if (H === "narke" && /^clinic-(capno|monitor)$/.test(id)) return exists(join(root, "narke-models/signals.js")) ? { files: [] } : null; // ledger only
  if (H === "tokos" && (m = /^clinic-(fetal-planes|hc-biometry)$/.exec(id))) return { files: [{ file: join(root, "tokos/decks", m[1] + ".json"), how: "string" }] };
  if ((m = /^bank-([a-z-]+)$/.exec(id))) {
    const f = H + "/decks/mcq/index.json";
    return exists(join(root, f)) && J(f).topics.some((t) => t.id === m[1]) ? { files: [] } : null;
  }
  return null;
}
/** One file's approve rewrite. Only the review changes; anything else throws. */
export function tokosRewrite(text, how, line) {
  if (how === "lesson") {
    const cur = JSON.parse(text).review;
    if (cur && typeof cur === "object") return replaceReview(text, { ...cur, status: "reviewed", reviewer: line });
    return swapDrafted(text, { status: "reviewed", reviewer: line });
  }
  if (how === "string") return swapDrafted(text, "reviewed");
  const hits = text.split('review: "ai_drafted"').length - 1;
  if (hits !== 1) throw new Error('expected one review: "ai_drafted" in the model, found ' + hits);
  return text.replace('review: "ai_drafted"', 'review: "reviewed", reviewedBy: ' + JSON.stringify(line));
}
// A top-level "review": "ai_drafted" among the leading scalar keys (lessons, drill JSON and clinic decks put it there)
// becomes `value`, written inline; nothing else in the text changes.
function swapDrafted(text, value) {
  const m = /^(\{\s*(?:"[^"]*"\s*:\s*(?:"(?:[^"\\]|\\.)*"|[-\w.]+)\s*,\s*)*?"review"\s*:\s*)"ai_drafted"/.exec(text);
  if (!m) throw new Error('no top-level "review": "ai_drafted" among the leading keys');
  const out = text.slice(0, m[1].length) + (typeof value === "string" ? JSON.stringify(value) : "{ " + Object.keys(value).map((k) => JSON.stringify(k) + ": " + JSON.stringify(value[k])).join(", ") + " }") + text.slice(m[0].length), before = JSON.parse(text), after = JSON.parse(out);
  before.review = value;
  if (!isDeepStrictEqual(before, after)) throw new Error("rewrite changed more than the review");
  return out;
}
const DECISIONS = ["approve", "approve-minor", "changes"];
const FEEDBACK = "vault/handoff/review-feedback.md";
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Validates the export file. Returns a list of errors (empty = usable). */
export function validateExport(x) {
  const e = [];
  if (!x || typeof x !== "object") return ["export: not a JSON object"];
  if (x.schema !== 1) e.push("export: schema must be 1");
  const r = x.reviewer;
  if (!r || typeof r.name !== "string" || !r.name.trim()) e.push("export: reviewer.name required");
  if (r && r.regNo != null && typeof r.regNo !== "string") e.push("export: reviewer.regNo must be a string");
  if (!Array.isArray(x.decisions) || !x.decisions.length) e.push("export: no decisions");
  else x.decisions.forEach((d, i) => {
    const w = `decisions[${i}]`;
    if (!d || !KINDS[d.kind]) e.push(`${w}: kind must be protocol, kit, consent, tokos or narke`);
    if (!d || !ID_RE.test(d.id || "")) e.push(`${w}: id must be kebab-case`);
    if (!d || DECISIONS.indexOf(d.decision) < 0) e.push(`${w}: decision must be ${DECISIONS.join(", ")}`);
    if (d && d.decision !== "approve" && !(typeof d.comment === "string" && d.comment.trim())) e.push(`${w}: ${d.decision} needs a comment`);
    if (!d || !/^\d{4}-\d{2}-\d{2}T/.test(d.at || "")) e.push(`${w}: at must be an ISO timestamp`);
  });
  return e;
}

/** "Dr A B, Reg. No. 123, 2026-09-30" (no dashes other than the ISO date). */
export function reviewerLine(reviewer, at) { return reviewerName(reviewer) + ", " + String(at || "").slice(0, 10); }
/** "Dr A B, Reg. No. 123" */
export function reviewerName(reviewer) {
  const name = String(reviewer.name || "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  const reg = String(reviewer.regNo || "").trim();
  return name + (reg ? ", Reg. No. " + reg : "");
}

/** Span [start, end) of the value of the top-level key `key` in JSON text, or null. */
export function topLevelValueSpan(text, key) {
  let depth = 0, i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const str = text.slice(i + 1, j);
      i = j + 1;
      if (depth === 1 && str === key) {
        let k = i; while (/\s/.test(text[k])) k++;
        if (text[k] !== ":") continue;
        k++; while (/\s/.test(text[k])) k++;
        const start = k; let d = 0;
        for (; k < n; k++) {
          const ch = text[k];
          if (ch === '"') { k++; while (k < n && text[k] !== '"') k += text[k] === "\\" ? 2 : 1; continue; }
          if (ch === "{" || ch === "[") d++;
          else if (ch === "}" || ch === "]") { d--; if (d === 0) return [start, k + 1]; }
        }
        return null;
      }
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    i++;
  }
  return null;
}

/** Rewrites only the top-level "review" object (or `key`). Throws if the result is not the same document with the new review. */
export function replaceReview(text, review, key = "review") {
  const span = topLevelValueSpan(text, key);
  if (!span) throw new Error('no top-level "' + key + '" object');
  const inline = "{ " + Object.keys(review).map((k) => JSON.stringify(k) + ": " + JSON.stringify(review[k])).join(", ") + " }";
  const out = text.slice(0, span[0]) + inline + text.slice(span[1]);
  const before = JSON.parse(text), after = JSON.parse(out);
  before[key] = review;
  if (!isDeepStrictEqual(before, after)) throw new Error("rewrite changed more than the review object");
  return out;
}

/** Tokós case approve: the case's new review, and the deck text with only that review changed. */
export function tokosCaseReview(text, caseId, reviewer, at) {
  const deck = JSON.parse(text);
  if (JSON.stringify(deck, null, 1) !== text) throw new Error("tokos/decks/ctg.json is not in its generated form (JSON.stringify(deck, null, 1)); regenerate or fix it first");
  const c = deck.cases.find((k) => k.id === caseId);
  const review = { by: reviewerName(reviewer), date: String(at).slice(0, 10), ...TOKOS_CTG.suggestedReview(c), complete: true };
  c.review = review;
  return { review, text: JSON.stringify(deck, null, 1) };
}

/** Pure plan: what would change, what goes to the feedback note, and what was skipped. */
export function plan(x, { root = ROOT, includeMinor = false, read = (f) => readFileSync(f, "utf8"), exists = existsSync } = {}) {
  const updates = [], feedback = [], skipped = [], texts = {};
  const get = (f) => (texts[f] != null ? texts[f] : (texts[f] = read(f)));   // several decisions can touch one file
  x.decisions.forEach((d) => {
    const tc = d.kind === "tokos" && /^case-(\d+)$/.exec(d.id), tk = d.kind === "tokos" && TOKOS_TEXT[d.id];
    if (d.kind === "narke" || (d.kind === "tokos" && !tc && !tk)) return planTokos(d);
    const file = d.kind !== "tokos" ? join(root, KINDS[d.kind].dir, d.id + ".json")
      : tc ? join(root, "tokos/decks/ctg.json") : tk ? join(root, "tokos/rationale.json") : null;
    if (!file || !exists(file)) { skipped.push({ ...d, why: "no such " + d.kind + " item in this repo" }); return; }
    const text = get(file), doc = JSON.parse(text);
    const tcase = tc ? (doc.cases || []).find((k) => k.id === tc[1]) : null;
    if (tc && !tcase) { skipped.push({ ...d, why: "no such Tokós case in this repo" }); return; }
    const cur = (tcase ? tcase.review : doc[tk || "review"]) || {};
    const wantsStatus = d.decision === "approve" || (d.decision === "approve-minor" && includeMinor);
    if (d.decision !== "approve") feedback.push(d);
    if (!wantsStatus) return;
    if (tcase ? cur.complete === true : cur.status === "reviewed" || cur.status === "approved") {
      skipped.push({ ...d, why: "already " + (tcase ? "reviewed" : cur.status) + (cur.reviewer || cur.by ? " by " + (cur.reviewer || cur.by) : "") }); return;
    }
    let u;
    if (tcase) u = tokosCaseReview(text, tcase.id, x.reviewer, d.at);
    else { const review = { ...cur, status: "reviewed", reviewer: reviewerLine(x.reviewer, d.at) }; u = { review, text: replaceReview(text, review, tk || "review") }; }
    texts[file] = u.text;
    updates.push({ ...d, file, text: u.text, review: u.review });
  });
  return { updates, feedback, skipped };

  function planTokos(d) {
    const t = tokosTarget(d.id, root, read, exists, d.kind);
    if (!t || t.files.some((f) => !exists(f.file))) { skipped.push({ ...d, why: "no such " + KINDS[d.kind].label + " item in this repo" }); return; }
    const lf = join(root, d.kind === "tokos" ? TOKOS_LEDGER : d.kind + "/reviews.json"), ledger = texts[lf] != null || exists(lf) ? JSON.parse(get(lf)) : { v: 1, items: {} };
    const wantsStatus = d.decision === "approve" || (d.decision === "approve-minor" && includeMinor);
    if (d.decision !== "approve") feedback.push(d);
    if (!wantsStatus) return;
    const cur = ledger.items[d.id];
    if (cur) { skipped.push({ ...d, why: "already " + cur.status + " by " + cur.reviewer }); return; }
    const line = reviewerLine(x.reviewer, d.at);
    t.files.forEach((f) => {
      const text = tokosRewrite(get(f.file), f.how, line);
      texts[f.file] = text;
      updates.push({ ...d, file: f.file, text, review: { status: "reviewed", reviewer: line }, build: t.build });
    });
    ledger.items[d.id] = { status: "reviewed", reviewer: line };
    texts[lf] = JSON.stringify(ledger, null, 1) + "\n";
    updates.push({ ...d, file: lf, text: texts[lf], review: ledger.items[d.id], ledger: true });
  }
}

/** Markdown appended to the feedback note. */
export function feedbackMarkdown(x, p, today) {
  const r = x.reviewer, lines = [];
  lines.push("", `## ${today}: ${r.name}${r.regNo ? ", Reg. No. " + r.regNo : ""}${r.verified ? " (registration verified in app)" : " (registration not verified in app)"}`, "");
  lines.push(`Export ${x.exportedAt || "(no timestamp)"}: ${x.decisions.length} decision(s), ${p.updates.length} marked reviewed.`, "");
  const label = { approve: "Approved", "approve-minor": "Approve after minor edits", changes: "Needs changes" };
  p.feedback.forEach((d) => {
    lines.push(`- [ ] **${KINDS[d.kind].label} \`${d.id}\`**: ${label[d.decision]}`);
    String(d.comment || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).forEach((s) => lines.push("  > " + s));
  });
  p.skipped.forEach((d) => lines.push(`- Skipped ${KINDS[d.kind].label} \`${d.id}\`: ${d.why}`));
  return lines.join("\n") + "\n";
}

/** The cache-token bump a Tokós approval needs (models and data load at the loader's ?v= token), or "". */
export function tokosBump(kinds, root = ROOT) {
  const isNarke = (k) => k === "narke" || / --host narke$/.test(k);
  if (kinds.some(isNarke)) {
    const n = (/var V = "(nrk)(\d+)";/.exec(readFileSync(join(root, "narke-loader.js"), "utf8")) || []);
    const c = n[1] ? n[1] + n[2] : "nrkN", x = n[1] ? n[1] + (+n[2] + 1) : "nrkN+1";
    const msg = `Narkē content changed: bump the cache token ${c} -> ${x} in narke-loader.js (var V = "${x}") and in index.html (<script src="/narke-loader.js?v=${x}">), and in test/narke-wiring.test.mjs.`;
    if (!kinds.some((k) => k === "tokos" || /tokos/.test(k))) return msg;
    return msg + " " + tokosBump(kinds.filter((k) => !isNarke(k)), root);
  }
  if (!kinds.some((k) => k === "tokos" || /tokos/.test(k))) return "";
  const v = (/var V = "(tok)(\d+)";/.exec(readFileSync(join(root, "tokos-loader.js"), "utf8")) || []);
  const cur = v[1] ? v[1] + v[2] : "tokN", next = v[1] ? v[1] + (+v[2] + 1) : "tokN+1";
  return `Tokós content changed: bump the cache token ${cur} -> ${next} in tokos-loader.js (var V = "${next}") and in index.html (<script src="/tokos-loader.js?v=${next}">), and in test/tokos-wiring.test.mjs and test/run-tokos-app-ui.mjs.`;
}

function main() {
  const args = process.argv.slice(2), file = args.find((a) => !a.startsWith("--"));
  const dry = args.includes("--dry"), includeMinor = args.includes("--include-minor"), acceptUnverified = args.includes("--accept-unverified");
  if (!file) { console.error("Usage: node scripts/apply-reviews.mjs <export.json> [--dry] [--include-minor] [--accept-unverified]"); process.exit(2); }
  let raw; try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.error("Cannot read " + file + ": " + e.message); process.exit(1); }
  const exports = raw && Array.isArray(raw.reviews) ? raw.reviews : [raw];
  for (const x of exports) {
    const errs = validateExport(x);
    if (errs.length) { console.error(errs.length + " problem(s) in the export" + (x && x.reviewer ? " from " + x.reviewer.name : "") + ":\n  " + errs.join("\n  ")); process.exit(1); }
    if (!x.reviewer.verified && !acceptUnverified) {
      console.error(`Reviewer "${x.reviewer.name}" was not verified in the app. Check their registration yourself, then rerun with --accept-unverified.`);
      process.exit(1);
    }
  }
  const kinds = new Set();
  for (const x of exports) applyOne(x, { dry, includeMinor }, kinds);
  if (dry) return;
  [...new Set([...kinds].map((k) => (KINDS[k] ? KINDS[k].build : k)))].filter(Boolean).forEach((b) => { console.log("Rebuilding: " + b); const [f, ...a] = b.split(" "); execFileSync(process.execPath, [join(ROOT, f), ...a], { stdio: "inherit" }); });
  if (kinds.size) console.log("Done. Run the unit tests, then commit the changed files.");
  const tb = tokosBump([...kinds]);
  if (tb) console.log(tb);
}
function applyOne(x, { dry, includeMinor }, kinds) {
  const p = plan(x, { includeMinor });
  p.updates.filter((u) => !u.ledger).forEach((u) => console.log(`${dry ? "Would mark" : "Marking"} ${u.kind} ${u.id} reviewed (${u.review.reviewer || u.review.by})`));
  p.feedback.forEach((d) => console.log(`Feedback: ${d.kind} ${d.id} (${d.decision})`));
  p.skipped.forEach((d) => console.log(`Skipped: ${d.kind} ${d.id}: ${d.why}`));
  if (dry) return;
  p.updates.forEach((u) => writeFileSync(u.file, u.text));
  if (p.feedback.length || p.skipped.length) {
    const f = join(ROOT, FEEDBACK);
    mkdirSync(dirname(f), { recursive: true });
    if (!existsSync(f)) writeFileSync(f, "---\ntags: [handoff, clinical-content, review]\n---\n# Clinical review feedback\n\nAppended by `scripts/apply-reviews.mjs` from review-desk exports. Tick an item once the content is fixed, then ask the reviewer to look again.\n");
    appendFileSync(f, feedbackMarkdown(x, p, new Date().toISOString().slice(0, 10)));
    console.log("Feedback written to " + FEEDBACK);
  }
  p.updates.forEach((u) => kinds.add(u.build || u.kind)); // a Tokós item can name its own rebuild (drills)
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
