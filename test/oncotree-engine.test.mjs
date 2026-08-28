/* ONCOTREE engine: deterministic pathway evaluation, disabledBy provenance, phenotype collection,
 * rebase and search.
 *
 * REWRITTEN 2026-08-24. The previous version exercised the engine THROUGH the real breast graph
 * ("answer n_histology=invasive, then n_stage must be active"). That coupled engine mechanics to
 * content: when the breast navigator was rewritten from v1.1 to v3.0 the node ids changed, 14 of 16
 * tests died reading `.status` of undefined, and the engine itself lost its coverage even though
 * nothing about the engine had changed.
 *
 * So the mechanics are now tested against a SYNTHETIC fixture graph defined right here - small
 * enough to reason about, shaped exactly like the real schema, and immune to content edits. The
 * real graphs are still covered: structurally by oncotree-graph.test.mjs, and clinically by
 * oncotree-safety / oncotree-verticals. Engine tests test the engine.
 */
import { test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const E = require(join(ROOT, "oncotree-engine.js"));

/* ── the fixture ───────────────────────────────────────────────────────────────
 * q_type ──invasive──> q_marker ──pos──> tx_pos
 *   │                     └────neg──> tx_neg
 *   └──insitu──> tx_insitu
 * Deliberately contains: a branch that must disable, a marker whose "unknown" answer must disable
 * BOTH downstream branches, a required field, and a multi-key option. */
function fixture() {
  return {
    guideline: "FIXTURE", navigatorVersion: "0.0.1", diseaseId: "fixture_cancer",
    startNodeIds: ["q_type"],
    nodes: [
      { id: "q_type", nodeType: "question", nodeCategory: "criteria", name: "Histology",
        title: "Histology", phenotypeKey: "histology", required: true,
        options: [{ id: "insitu", label: "In situ", setsValue: "in_situ" },
                  { id: "invasive", label: "Invasive", setsValue: "invasive" }] },
      { id: "q_marker", nodeType: "question", nodeCategory: "criteria", name: "Marker",
        title: "Marker status", phenotypeKey: "biomarkers.MARKER", required: true,
        options: [{ id: "pos", label: "Positive", setsValue: "positive" },
                  { id: "neg", label: "Negative", setsValue: "negative" },
                  { id: "unknown", label: "Unknown" }] },
      { id: "q_setting", nodeType: "question", nodeCategory: "criteria", name: "Setting",
        title: "Setting", options: [{ id: "adj", label: "Adjuvant", sets: { setting: "adjuvant", intent: "curative" } }] },
      { id: "tx_pos", nodeType: "end", nodeCategory: "treatment", name: "Marker+ therapy",
        title: "Marker-positive therapy", pills: ["MARKER+"], showsRecommendation: true,
        protocolRefs: [], bullets: ["Targeted therapy"] },
      { id: "tx_neg", nodeType: "end", nodeCategory: "treatment", name: "Marker- therapy",
        title: "Marker-negative therapy", pills: ["MARKER-"], showsRecommendation: true,
        protocolRefs: [], bullets: ["Chemotherapy"] },
      { id: "tx_insitu", nodeType: "end", nodeCategory: "treatment", name: "In-situ therapy",
        title: "In-situ local therapy", pills: ["in situ"], showsRecommendation: true,
        protocolRefs: [], bullets: ["Local therapy"] }
    ],
    links: [
      { id: "l1", from: "q_type", to: "q_marker", fromOptions: ["invasive"] },
      { id: "l2", from: "q_type", to: "tx_insitu", fromOptions: ["insitu"] },
      { id: "l3", from: "q_marker", to: "tx_pos", fromOptions: ["pos"] },
      { id: "l4", from: "q_marker", to: "tx_neg", fromOptions: ["neg"] },
      { id: "l5", from: "q_type", to: "q_setting", fromOptions: ["invasive"] }
    ]
  };
}
const G = fixture();
const st = (answers) => E.evaluate(G, answers || {});

/* ── evaluation + provenance ───────────────────────────────────────────────── */

test("start node is active, everything downstream is unresolved before any answer", () => {
  const s = st();
  assert.equal(s.nodes.q_type.status, "active");
  assert.equal(s.nodes.q_marker.status, "unresolved");
  assert.equal(s.nodes.tx_pos.status, "unresolved");
});

test("answering the first question activates its branch and DISABLES the other, with provenance", () => {
  const s = st({ q_type: ["invasive"] });
  assert.equal(s.nodes.q_marker.status, "active");
  assert.equal(s.nodes.tx_insitu.status, "disabled");
  assert.deepEqual(s.nodes.tx_insitu.disabledBy.map(d => d.nodeId), ["q_type"],
    "an excluded branch must say WHICH answer excluded it");
});

test("the other direction disables symmetrically", () => {
  const s = st({ q_type: ["insitu"] });
  assert.equal(s.nodes.tx_insitu.status, "active");
  assert.equal(s.nodes.q_marker.status, "disabled");
  assert.equal(s.nodes.tx_pos.status, "disabled");
});

test("a positive marker reaches its treatment and disables the negative arm", () => {
  const s = st({ q_type: ["invasive"], q_marker: ["pos"] });
  assert.equal(s.nodes.tx_pos.status, "active");
  assert.equal(s.nodes.tx_neg.status, "disabled");
  assert.deepEqual(s.nodes.tx_neg.disabledBy.map(d => d.nodeId), ["q_marker"]);
});

test("a negative marker reaches the other treatment", () => {
  const s = st({ q_type: ["invasive"], q_marker: ["neg"] });
  assert.equal(s.nodes.tx_neg.status, "active");
  assert.equal(s.nodes.tx_pos.status, "disabled");
});

test("NEVER INVENTS: an 'unknown' answer contributes no phenotype and disables both arms", () => {
  // The single most important engine property: an answer the clinician could not give must not be
  // guessed into a branch.
  const s = st({ q_type: ["invasive"], q_marker: ["unknown"] });
  assert.equal(s.nodes.tx_pos.status, "disabled");
  assert.equal(s.nodes.tx_neg.status, "disabled");
  assert.equal(s.phenotype.biomarkers.MARKER, undefined,
    "an option with no setsValue must contribute nothing to the phenotype");
});

/* ── phenotype ─────────────────────────────────────────────────────────────── */

test("phenotype is collected only from ACTIVE, answered nodes", () => {
  const s = st({ q_type: ["invasive"], q_marker: ["pos"] });
  assert.equal(s.phenotype.histology, "invasive");
  // A dotted phenotypeKey nests: "biomarkers.MARKER" -> phenotype.biomarkers.MARKER.
  assert.equal(s.phenotype.biomarkers.MARKER, "positive");
});

test("phenotype ignores answers on branches that are disabled", () => {
  // Answer the marker, then switch histology so the marker branch is excluded. Its value must go.
  const s = st({ q_type: ["insitu"], q_marker: ["pos"] });
  assert.equal(s.nodes.q_marker.status, "disabled");
  assert.equal(s.phenotype.biomarkers.MARKER, undefined,
    "a stale answer on an excluded branch must not leak into the phenotype");
});

test("a multi-key option sets every key it declares", () => {
  const s = st({ q_type: ["invasive"], q_setting: ["adj"] });
  assert.equal(s.phenotype.setting, "adjuvant");
  assert.equal(s.phenotype.intent, "curative");
});

/* ── required fields ───────────────────────────────────────────────────────── */

test("required missing fields are reported on the active frontier only", () => {
  const none = st();
  assert.ok(none.missingRequired.some(m => m.id === "q_type"), "the start question is required and unanswered");
  assert.ok(!none.missingRequired.some(m => m.id === "q_marker"),
    "an unreached required node is not yet missing - only the frontier counts");
  const after = st({ q_type: ["invasive"] });
  assert.ok(after.missingRequired.some(m => m.id === "q_marker"), "now it is on the frontier");
  assert.ok(!after.missingRequired.some(m => m.id === "q_type"), "and the answered one is no longer missing");
});

test("an answered graph reports nothing missing", () => {
  const s = st({ q_type: ["invasive"], q_marker: ["pos"] });
  assert.deepEqual(s.missingRequired.map(m => m.id), []);
});

/* ── purity ────────────────────────────────────────────────────────────────── */

test("deterministic and non-mutating", () => {
  const before = JSON.stringify(G);
  const answers = { q_type: ["invasive"], q_marker: ["pos"] };
  const a = E.evaluate(G, answers);
  const b = E.evaluate(G, answers);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)),
    "same graph + same answers must give the same state");
  assert.equal(JSON.stringify(G), before, "evaluate() must not mutate the graph");
  assert.deepEqual(answers, { q_type: ["invasive"], q_marker: ["pos"] }, "nor the answers");
});

test("evaluate tolerates junk answers without throwing or inventing", () => {
  const s = E.evaluate(G, { q_type: ["not_an_option"], nonexistent_node: ["x"] });
  assert.equal(s.nodes.q_marker.status, "disabled", "an unmatched answer satisfies no conditional link");
  assert.equal(s.phenotype.histology, undefined);
});

/* ── search ────────────────────────────────────────────────────────────────── */

test("search finds nodes by text and groups them by category", () => {
  const r = E.search(G, "therapy");
  assert.ok(r.all.length >= 3, "matches the three treatment nodes");
  assert.ok(r.groups.treatment.length >= 3);
  assert.deepEqual(E.search(G, "").all, [], "an empty query matches nothing");
  assert.deepEqual(E.search(G, "zzzz").all, [], "a miss returns nothing rather than everything");
});

test("search matches option labels and pills, not just titles", () => {
  assert.ok(E.search(G, "in situ").all.length >= 1, "option label / pill text is searchable");
});

/* ── the real graphs are still structurally sound ──────────────────────────── */

test("every shipped graph evaluates cleanly from a cold start", () => {
  // Content-independent smoke over the REAL navigators: whatever their shape, the engine must
  // produce a state with a start node and no crash. Catches a malformed graph without asserting
  // anything about clinical routing (that lives in oncotree-safety / -verticals).
  const dir = join(ROOT, "kb/oncotree");
  const files = readdirSync(dir).filter(f => f.endsWith(".json") && f !== "index.json");
  assert.ok(files.length >= 10, "expected the navigator library to be present");
  files.forEach(f => {
    const g = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (!Array.isArray(g.nodes)) return;
    const s = E.evaluate(g, {});
    assert.ok(s && s.nodes, f + ": evaluate() returned no state");
    assert.ok(Object.keys(s.nodes).length === g.nodes.length, f + ": every node must appear in the state");
    assert.ok(s.order.length === g.nodes.length, f + ": topological order must cover every node");
    const active = Object.keys(s.nodes).filter(id => s.nodes[id].status === "active");
    assert.ok(active.length >= 1, f + ": a cold graph must have at least one active start node");
  });
});

test("no shipped graph has an orphan link or a dangling endpoint", () => {
  const dir = join(ROOT, "kb/oncotree");
  readdirSync(dir).filter(f => f.endsWith(".json") && f !== "index.json").forEach(f => {
    const g = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (!Array.isArray(g.nodes)) return;
    const ids = new Set(g.nodes.map(n => n.id));
    (g.links || []).forEach(l => {
      assert.ok(ids.has(l.from), f + ": link " + l.id + " from unknown node " + l.from);
      assert.ok(ids.has(l.to), f + ": link " + l.id + " to unknown node " + l.to);
    });
  });
});
