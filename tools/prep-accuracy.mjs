#!/usr/bin/env node
// PrepNucleus public accuracy page data: prep/accuracy.json, read by prep/accuracy.html and PrepSocial.openAccuracy().
// Computed only from files in the repo; a figure with no source is null and the page says "not yet published".
//
// RUN   node tools/prep-accuracy.mjs [--root .] [--out prep/accuracy.json] [--date YYYY-MM-DD]
//
// Sources
//   keys     the newest prep/bank/v1/screen-<date>.json (tools/prep-screen-keys.mjs): an independent model answered every
//            bank question blind; "disputed" means it clearly picked another option. Disputed questions are hidden.
//   ai       prep/fill/<module>.json (tools/prep-fill.mjs: AI questions, per gate rejections), prep/lessons/v1/*.json
//            (tools/prep-lessons.mjs: AI lessons, steps redone or dropped by the checks), prep/cards/v1/*.json.
//   reports  student reports and auto-hides live in KV behind /api/prep/flag; no static export exists yet, so null.
//   fixTime  median time from a report to its fix: no record of fixes exists yet, so null.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Plain words for the AI question gates; the keys are tools/prep-fill.mjs WHY codes.
export const GATES = {
  g1: "Exactly four options", g2: "Key not repeated as a distractor", g3: "No duplicate options",
  g5: "Key not much longer or shorter than the distractors", g9b: "Every number in the key is in the source",
  g12: "Not too similar to another question", verbatim: "Does not copy source wording", "verbatim-pack": "Does not copy source wording",
  book: "Names no book, edition or page", solve: "An independent solver picks the same answer", review: "Passes a second review",
  "bad-output": "Valid model reply",
};
const r4 = (x) => Math.round(x * 10000) / 10000;
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/* compute({ screen, names, fills, lessons, cards, fixHours, date }) -> the accuracy.json object. Pure.
   screen: a screen-<date>.json object or null; names: { subjectId: "Name" }; fills: fill report objects;
   lessons, cards: lesson and deck objects; fixHours: hours from report to fix, one per fixed report (none yet). */
export function compute({ screen = null, names = {}, fills = [], lessons = [], cards = [], fixHours = [], date, sources = {} }) {
  let keys = null;
  if (screen && Array.isArray(screen.subjects)) {
    const subjects = screen.subjects.filter((s) => s && s.id && s.screened > 0).map((s) => ({
      id: s.id, name: names[s.id] || s.id, screened: s.screened, disputed: s.disputed || 0, rate: r4((s.disputed || 0) / s.screened),
    })).sort((a, b) => b.rate - a.rate || (a.id < b.id ? -1 : 1));
    const screened = subjects.reduce((a, s) => a + s.screened, 0), disputed = subjects.reduce((a, s) => a + s.disputed, 0);
    keys = { date: screen.date || null, model: screen.model || null, bank: screen.bank || null, screened, disputed, rate: screened ? r4(disputed / screened) : null, subjects };
  }
  const fl = fills.filter((f) => f && f.module && f.stats);
  let questions = null;
  if (fl.length) {
    const byGate = {};
    let generated = 0, accepted = 0, regenerated = 0;
    fl.forEach((f) => {
      generated += f.stats.generated || 0; accepted += f.stats.accepted || 0; regenerated += f.stats.regenerated || 0;
      Object.entries(f.stats.rejected || {}).forEach(([g, n]) => { byGate[g] = (byGate[g] || 0) + n; });
    });
    const gates = Object.keys(GATES).filter((g) => g !== "verbatim-pack" && g !== "bad-output").map((g) => ({
      id: g, label: GATES[g], rejected: (byGate[g] || 0) + (g === "verbatim" ? byGate["verbatim-pack"] || 0 : 0),
    }));
    Object.keys(byGate).forEach((g) => { if (!GATES[g]) gates.push({ id: g, label: g, rejected: byGate[g] }); });
    if (byGate["bad-output"]) gates.push({ id: "bad-output", label: GATES["bad-output"], rejected: byGate["bad-output"] });
    questions = { modules: fl.length, generated, accepted, regenerated, rejected: generated - accepted, passRate: generated ? r4(accepted / generated) : null, gates };
  }
  const ai = lessons.filter((l) => l && l.gen === "AI" && l.checks && Array.isArray(l.steps));
  let lessonStats = null;
  if (ai.length) {
    let kept = 0, redone = 0, dropped = 0;
    ai.forEach((l) => { kept += l.steps.length; redone += Number(l.checks.redone) || 0; dropped += Number(l.checks.dropped) || 0; });
    const drafted = kept + dropped;
    lessonStats = { lessons: ai.length, hand: lessons.filter((l) => l && l.gen === "hand").length, steps: kept, redone, dropped,
      firstPass: drafted ? r4((kept - redone) / drafted) : null, passRate: drafted ? r4(kept / drafted) : null,
      checks: ["shape", "numbers", "drugs", "verbatim", "selfCheck"] };
  }
  const allCards = cards.flatMap((d) => (d && Array.isArray(d.cards) ? d.cards : []));
  const cardStats = { decks: cards.length, cards: allCards.length, ai: allCards.filter((c) => c.gen === "AI").length, hand: allCards.filter((c) => c.gen !== "AI").length };
  const fixMedian = median(fixHours.filter((h) => Number.isFinite(h) && h >= 0));
  return {
    v: 1, generated: date, sources,
    keys,
    reports: { reported: null, autoHidden: null, hideAfter: 3, note: "Student reports are stored on the server; a published count is not yet exported." },
    ai: { questions, lessons: lessonStats, cards: cardStats },
    fixTime: { medianHours: fixMedian == null ? null : Math.round(fixMedian * 10) / 10, fixed: fixHours.length },
  };
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const jsonIn = (dir, skip) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !(skip || []).includes(f)).sort() : []);

/* fromRepo(root, date) -> compute() over the repo's files. */
export function fromRepo(root, date) {
  const bank = path.join(root, "prep/bank/v1");
  const screens = jsonIn(bank).filter((f) => /^screen-\d{4}-\d{2}-\d{2}\.json$/.test(f));
  const screenFile = screens.length ? screens[screens.length - 1] : null;
  const names = {};
  const taxFile = path.join(root, "prep/taxonomy.json");
  if (fs.existsSync(taxFile)) (readJson(taxFile).branches || []).forEach((b) => (b.subjects || []).forEach((s) => { names[s.id] = (s.name && s.name.en) || s.id; }));
  const fillDir = path.join(root, "prep/fill"), lessonDir = path.join(root, "prep/lessons/v1"), cardDir = path.join(root, "prep/cards/v1");
  // ponytail: per-module fill outputs stay out of git (Pages 20,000-file cap); prep/fill/reports.json keeps module + stats.
  const repFile = path.join(fillDir, "reports.json");
  const fills = fs.existsSync(repFile) ? readJson(repFile) : jsonIn(fillDir, ["shortfall.json", "reports.json"]).map((f) => readJson(path.join(fillDir, f)));
  const lessons = jsonIn(lessonDir, ["index.json"]).map((f) => readJson(path.join(lessonDir, f)));
  const cards = jsonIn(cardDir, ["index.json"]).map((f) => readJson(path.join(cardDir, f)));
  return compute({ screen: screenFile ? readJson(path.join(bank, screenFile)) : null, names, fills, lessons, cards, fixHours: [], date,
    sources: { keys: screenFile ? "prep/bank/v1/" + screenFile : null, questions: "prep/fill/reports.json", lessons: "prep/lessons/v1/*.json", cards: "prep/cards/v1/*.json" } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const root = path.resolve(arg("--root", path.join(path.dirname(fileURLToPath(import.meta.url)), "..")));
  const out = path.resolve(root, arg("--out", "prep/accuracy.json"));
  const date = arg("--date", new Date().toISOString().slice(0, 10));
  if (process.argv.includes("--pack-fill")) {  // fold the per-module fill outputs into reports.json (gate stats only)
    const dir = path.join(root, "prep/fill");
    const reps = jsonIn(dir, ["shortfall.json", "reports.json"]).map((f) => readJson(path.join(dir, f))).filter((r) => r && r.module && r.stats).map((r) => ({ module: r.module, stats: r.stats }));
    fs.writeFileSync(path.join(dir, "reports.json"), JSON.stringify(reps) + "\n");
    console.log("wrote prep/fill/reports.json: " + reps.length + " modules");
  }
  const j = fromRepo(root, date);
  fs.writeFileSync(out, JSON.stringify(j, null, 1) + "\n");
  console.log(`wrote ${path.relative(root, out)}: ${j.keys ? j.keys.disputed + " of " + j.keys.screened + " keys disputed" : "no screen"}; ` +
    `${j.ai.questions ? j.ai.questions.accepted + " of " + j.ai.questions.generated + " AI questions passed" : "no fill reports"}`);
}
