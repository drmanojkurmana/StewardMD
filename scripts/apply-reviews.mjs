#!/usr/bin/env node
/* StewardMD - apply a clinical review export from the in-app review desk (review-desk.js).
 *
 *   node scripts/apply-reviews.mjs <export.json>                  apply, then rebuild the touched bundles
 *   node scripts/apply-reviews.mjs <export.json> --dry            print the plan, write nothing
 *   node scripts/apply-reviews.mjs <export.json> --include-minor  also mark "approve after minor edits"
 *                                                                 items reviewed (only once the edits are made)
 *   node scripts/apply-reviews.mjs <export.json> --accept-unverified
 *                                                                 accept a reviewer whose registration the app
 *                                                                 did not verify (you vouch for them)
 *
 * What it does, per decision:
 *   approve         review.status ai_drafted -> "reviewed", review.reviewer = "<name>, Reg. No. <n>, <date>"
 *   approve-minor   written to the feedback note; status changes only with --include-minor
 *   changes         written to the feedback note; status unchanged
 * Items already reviewed or approved are never changed (the note says so). Only the "review" object of each
 * file is rewritten, in place, so the rest of the hand-formatted JSON stays byte-identical.
 * Feedback is appended to vault/handoff/review-feedback.md. The export holds content ids and comments only.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const KINDS = {
  protocol: { dir: "kb/clinical-protocols", build: "scripts/build-clinical-protocols.mjs", label: "Protocol" },
  kit: { dir: "kb/specialty-kits/src", build: "scripts/build-specialty-kits.mjs", label: "Specialty kit" },
  consent: { dir: "kb/documents/consent", build: "scripts/build-documents.mjs", label: "Consent template" },
};
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
    if (!d || !KINDS[d.kind]) e.push(`${w}: kind must be protocol, kit or consent`);
    if (!d || !ID_RE.test(d.id || "")) e.push(`${w}: id must be kebab-case`);
    if (!d || DECISIONS.indexOf(d.decision) < 0) e.push(`${w}: decision must be ${DECISIONS.join(", ")}`);
    if (d && d.decision !== "approve" && !(typeof d.comment === "string" && d.comment.trim())) e.push(`${w}: ${d.decision} needs a comment`);
    if (!d || !/^\d{4}-\d{2}-\d{2}T/.test(d.at || "")) e.push(`${w}: at must be an ISO timestamp`);
  });
  return e;
}

/** "Dr A B, Reg. No. 123, 2026-09-30" (no dashes other than the ISO date). */
export function reviewerLine(reviewer, at) {
  const name = String(reviewer.name || "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  const reg = String(reviewer.regNo || "").trim();
  return name + (reg ? ", Reg. No. " + reg : "") + ", " + String(at || "").slice(0, 10);
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

/** Rewrites only the top-level "review" object. Throws if the result is not the same document with the new review. */
export function replaceReview(text, review) {
  const span = topLevelValueSpan(text, "review");
  if (!span) throw new Error('no top-level "review" object');
  const inline = "{ " + Object.keys(review).map((k) => JSON.stringify(k) + ": " + JSON.stringify(review[k])).join(", ") + " }";
  const out = text.slice(0, span[0]) + inline + text.slice(span[1]);
  const before = JSON.parse(text), after = JSON.parse(out);
  before.review = review;
  if (!isDeepStrictEqual(before, after)) throw new Error("rewrite changed more than the review object");
  return out;
}

/** Pure plan: what would change, what goes to the feedback note, and what was skipped. */
export function plan(x, { root = ROOT, includeMinor = false, read = (f) => readFileSync(f, "utf8"), exists = existsSync } = {}) {
  const updates = [], feedback = [], skipped = [];
  x.decisions.forEach((d) => {
    const file = join(root, KINDS[d.kind].dir, d.id + ".json");
    if (!exists(file)) { skipped.push({ ...d, why: "no such " + d.kind + " in this repo" }); return; }
    const text = read(file), cur = JSON.parse(text).review || {};
    const wantsStatus = d.decision === "approve" || (d.decision === "approve-minor" && includeMinor);
    if (d.decision !== "approve") feedback.push(d);
    if (!wantsStatus) return;
    if (cur.status === "reviewed" || cur.status === "approved") { skipped.push({ ...d, why: "already " + cur.status + (cur.reviewer ? " by " + cur.reviewer : "") }); return; }
    const review = { ...cur, status: "reviewed", reviewer: reviewerLine(x.reviewer, d.at) };
    updates.push({ ...d, file, text: replaceReview(text, review), review });
  });
  return { updates, feedback, skipped };
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

function main() {
  const args = process.argv.slice(2), file = args.find((a) => !a.startsWith("--"));
  const dry = args.includes("--dry"), includeMinor = args.includes("--include-minor"), acceptUnverified = args.includes("--accept-unverified");
  if (!file) { console.error("Usage: node scripts/apply-reviews.mjs <export.json> [--dry] [--include-minor] [--accept-unverified]"); process.exit(2); }
  let x; try { x = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.error("Cannot read " + file + ": " + e.message); process.exit(1); }
  const errs = validateExport(x);
  if (errs.length) { console.error(errs.length + " problem(s) in the export:\n  " + errs.join("\n  ")); process.exit(1); }
  if (!x.reviewer.verified && !acceptUnverified) {
    console.error(`Reviewer "${x.reviewer.name}" was not verified in the app. Check their registration yourself, then rerun with --accept-unverified.`);
    process.exit(1);
  }
  const p = plan(x, { includeMinor });
  p.updates.forEach((u) => console.log(`${dry ? "Would mark" : "Marking"} ${u.kind} ${u.id} reviewed (${u.review.reviewer})`));
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
  const kinds = [...new Set(p.updates.map((u) => u.kind))];
  kinds.forEach((k) => { console.log("Rebuilding: " + KINDS[k].build); execFileSync(process.execPath, [join(ROOT, KINDS[k].build)], { stdio: "inherit" }); });
  if (kinds.length) console.log("Done. Run the unit tests, then commit the changed files.");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
