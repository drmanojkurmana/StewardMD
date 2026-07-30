// MaiK Evidence Engine (kb/ai/maik-evidence.js) — Part 2 module tests.
// Ranking hierarchy, dedupe/merge bundle, personalization, confidence policy, contradiction
// detection, precise citations. Mostly synthetic evidence (no KB needed); guideline() loads
// the treatment KB.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shim = (k, v) => { try { if (!globalThis[k]) globalThis[k] = v; } catch (e) {} };
shim("window", globalThis); shim("self", globalThis);
shim("document", { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), addEventListener() {} });
shim("localStorage", { getItem: () => null, setItem() {} });
shim("location", { href: "https://stewardmd.in/", search: "" });
const opt = r => { try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r }); } catch (e) {} };
["kb/dist/kb.core.js", "kb/dist/kb.rag.js"].forEach(opt);
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "kb/ai/maik-evidence.js"), "utf8"), { filename: "maik-evidence.js" });
const E = globalThis.MaiKEvidence;

test("module loads", () => { assert.ok(E && typeof E.rank === "function"); });

test("Stage 2 — ranking by source hierarchy (StewardMD > national > international > expert)", () => {
  const r = E.rank([
    { source: "guideline", ref: "WHO 2021" },
    { source: "expert", ref: "expert opinion piece" },
    { source: "kb", ref: "StewardMD KB · CAP" },
    { source: "guideline", ref: "ICMR AMR 2019" }
  ]);
  assert.equal(r[0].source, "kb", "StewardMD KB ranks first");
  assert.equal(r[0].tier, 1);
  assert.ok(r[1].tier === 2, "ICMR (national) second");
  assert.ok(r[2].tier === 3, "WHO (international) third");
  assert.ok(r[3].tier >= 4, "expert opinion last");
});

test("Stage 3 — bundle dedupes + merges overlapping recommendations", () => {
  const b = E.bundle([
    { source: "kb", ref: "StewardMD", data: { text: "Amoxicillin-clavulanate 625 mg TDS; add azithromycin for atypicals" } },
    { source: "guideline", ref: "IDSA 2019", data: { recommendations: ["Amoxicillin-clavulanate 625 mg TDS", "Consider a macrolide for atypical cover"] } }
  ]);
  // the duplicate amox-clav claim is merged (not listed twice) and carries BOTH sources
  const amox = b.claims.find(c => /amoxicillin/i.test(c.text));
  assert.ok(amox, "amox-clav claim present");
  assert.ok(amox.sources.length >= 2, "merged claim keeps both supporting sources");
  assert.ok(b.claims.length >= 2 && b.claims.length <= 3, "overlapping claims collapsed");
  assert.equal(b.topTier, 1, "top authority is StewardMD");
});

test("Stage 5 — personalization infers audience without asking", () => {
  assert.equal(E.personalize({ query: { raw: "vasopressor titration protocol in the ICU" } }).audience, "icu");
  assert.equal(E.personalize({ query: { raw: "explain nephrotic syndrome to the patient in simple terms" } }).audience, "patient");
  assert.equal(E.personalize({ query: { raw: "mnemonic for causes of pancreatitis for exam" } }).audience, "student");
  assert.equal(E.personalize({ query: { raw: "management of DKA" } }).audience, "clinician");
  assert.equal(E.personalize({ audience: "patient" }).style.length > 0, true);
});

test("Stage 9 — multi-factor confidence + low-confidence policy", () => {
  assert.equal(E.confidence({ retrieval: 0.95, agreement: 0.9, guideline: 0.9, ontology: 0.9, drug: 0.9, calculator: 0.9, gemini: 0.9 }).action, "answer");
  const low = E.confidence({ retrieval: 0.2, agreement: 0.2, ontology: 0.3 });
  assert.ok(low.low && low.action !== "answer", "low confidence never answers confidently");
  assert.equal(E.confidence({ retrieval: 0.2, ambiguous: true }).action, "ask");
});

test("Stage 10 — contradiction detection surfaces disagreement", () => {
  const c = E.contradictions([
    { source: "guideline", ref: "Society A", data: { text: "First-line: amoxicillin" } },
    { source: "guideline", ref: "Society B", data: { text: "First-line: azithromycin" } }
  ]);
  assert.ok(c.length >= 1 && c[0].conflict, "a conflict is detected");
  assert.ok(/amoxicillin/.test(c[0].reason) && /azithromycin/.test(c[0].reason), "both agents named in the reason");
  assert.ok(c[0].consensus, "a consensus (higher-authority) side is identified, not silently chosen");
});

test("Stage 11 — citations are precise (one per source, no generic)", () => {
  const cites = E.citations([
    { source: "kb", tier: 1, data: { disease: "Community Acquired Pneumonia" } },
    { source: "guideline", tier: 3, society: "IDSA/ATS", year: "2019" },
    { source: "guideline", tier: 3, ref: "various sources" }   // generic → rejected
  ]);
  assert.ok(cites.length === 2, "generic citation rejected");
  assert.ok(cites.some(c => /StewardMD/i.test(c.label)));
  assert.ok(cites.some(c => /IDSA\/ATS \(2019\)/.test(c.label)), "guideline citation carries society + year");
  assert.deepEqual(cites.map(c => c.n), [1, 2], "citations are numbered");
});

test("Stage 8 — guideline accessor reads the treatment KB (if loaded)", () => {
  if (!globalThis.KB_RAG || !globalThis.KB_RAG.treatments) { console.log("  (KB_RAG not loaded — skipping)"); return; }
  const anyId = Object.keys(globalThis.KB_RAG.treatments)[0];
  const g = E.guideline(anyId);
  assert.ok(g && g.conceptId === anyId, "returns a normalized guideline view for a known concept");
  assert.equal(E.guideline("no_such_concept_xyz"), null);
});
