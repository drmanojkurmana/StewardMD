// RadioAnatome clinical notes — schema, coverage and content-policy checks for atlas/notes.json.
// Run: node test/atlas-notes.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { globSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("x FAIL:", n); } };

const raw = readFileSync(join(ROOT, "atlas/notes.json"), "utf8");
let data;
try { data = JSON.parse(raw); ok("notes.json is valid JSON", true); }
catch (e) { ok("notes.json is valid JSON: " + e.message, false); data = { v: 1, review: "ai_drafted", notes: {} }; }

ok("contract shape: v === 1", data.v === 1);
ok("contract shape: top-level review is ai_drafted", data.review === "ai_drafted");
ok("contract shape: notes is an object", data.notes && typeof data.notes === "object");

// Structure ids present across all real atlas modules (skip atlas/3d — not a slice module).
const files = globSync(join(ROOT, "atlas/*/atlas.json")).filter((f) => !f.includes("/atlas/3d/"));
ok("found atlas module files", files.length > 0);

const allIds = new Set();
for (const f of files) {
  const mod = JSON.parse(readFileSync(f, "utf8"));
  for (const id of Object.keys(mod.structures || {})) allIds.add(id);
}

// Pure container ids: whole-body/whole-skeleton wrappers with no distinct imaging identity of
// their own, deliberately omitted from notes.json per docs/radioanatome/PREMIUM_PLAN_2026-09-25.md.
const OMITTED = new Set(["torso", "skeleton"]);

ok("every non-container structure id has a note",
  [...allIds].filter((id) => !OMITTED.has(id) && !data.notes[id]).length === 0);

const EM_DASH = "—";
const EN_DASH = "–";
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

let allLenOk = true, allReviewOk = true, allDashOk = true, allEmojiOk = true, allUrlOk = true;
for (const [id, n] of Object.entries(data.notes)) {
  if (typeof n.clinical !== "string" || n.clinical.length === 0 || n.clinical.length > 300) allLenOk = false;
  if (typeof n.imaging !== "string" || n.imaging.length === 0 || n.imaging.length > 240) allLenOk = false;
  if (n.review !== "ai_drafted") allReviewOk = false;
  for (const t of [n.clinical, n.imaging]) {
    if (t.includes(EM_DASH) || t.includes(EN_DASH)) allDashOk = false;
    if (EMOJI_RE.test(t)) allEmojiOk = false;
    if (t.toLowerCase().includes("http")) allUrlOk = false;
  }
  if (!id) fail++; // keep id referenced for lint-cleanliness
}
ok("clinical <= 300 chars, imaging <= 240 chars, both non-empty", allLenOk);
ok("every note has review === ai_drafted", allReviewOk);
ok("no em dash or en dash in any note", allDashOk);
ok("no emoji in any note", allEmojiOk);
ok("no URLs in any note", allUrlOk);

console.log(fail === 0 ? "ALL " + pass + " PASS" : pass + " pass / " + fail + " FAIL");
process.exit(fail ? 1 : 0);
