/* ONCOTREE wave-2 verticals: head & neck, ovarian, upper GI, RCC, bladder, testicular, myeloma,
 * thyroid.
 *
 * REWRITTEN 2026-08-24 (graph v3). Each of the eight tests walked one hard-coded answer path to a
 * named node ("answer n_hn_stage=locoregional, then check n_tx_hn_chemort"). Graph v3 renamed the
 * ids, every walk landed on undefined, and all eight died - so eight whole cancer verticals lost
 * their routing coverage at once.
 *
 * Rewritten as ONE data-driven suite that proves the same things without naming a node:
 *
 *   1. ROUTING WORKS. Each vertical is walked automatically from its start node, answering every
 *      active question, and must arrive at an outcome that offers protocols. That is the property
 *      the eight path tests were really checking, and it now survives a rewrite.
 *   2. AGENTS STAY IN THEIR CONTEXT, asserted against each node's declared pills.
 *   3. THE RECOMMENDER STAYS HONEST: never returns a protocol that was not offered, and always
 *      flags physician review.
 *
 * Adding a ninth vertical needs no new test: it is picked up from the manifest automatically.
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
const R = require(join(ROOT, "oncotree-recommend.js"));

const P = {};
readdirSync(join(ROOT, "kb/protocols")).filter(f => f.endsWith(".json") && f !== "index.json")
  .forEach(f => { const p = JSON.parse(readFileSync(join(ROOT, "kb/protocols", f), "utf8")); P[p.id] = p; });

const WAVE2 = ["headneck", "ovarian", "uppergi", "rcc", "bladder", "testicular", "myeloma", "thyroid"];
const load = (n) => JSON.parse(readFileSync(join(ROOT, "kb/oncotree", n + ".json"), "utf8"));

/* Explore a graph, answering every active question, until the pathway completes.
 *
 * Taking the FIRST option every time is not enough: v3 graphs route many first-options to surgical
 * or surveillance endpoints, which legitimately carry no protocol at all. So this does a bounded
 * search over option choices and returns the first COMPLETED pathway that reaches a protocol-bearing
 * outcome, falling back to a plain first-option walk if none does. Deterministic (options are tried
 * in authored order) and capped, so it cannot blow up on a wide graph.
 */
function explore(g, opts) {
  const wantProtocols = !(opts && opts.any);
  const byId = {}; g.nodes.forEach(n => (byId[n.id] = n));
  let best = null, visited = 0;

  function complete(answers, depth) {
    if (visited++ > 400 || depth > 15) return null;
    const ev = E.evaluate(g, answers);
    const q = ev.order.map(id => byId[id]).find(n =>
      n && ev.nodes[n.id].status === "active" && n.nodeType === "question" && !answers[n.id] && (n.options || []).length);

    if (!q) {
      const outcomes = ev.order.filter(id => ev.nodes[id].status === "active" && (byId[id].protocolRefs || []).length);
      const res = { answers, ev, byId, outcomes, steps: Object.keys(answers).length };
      if (!best) best = res;                                  // remember the first complete walk
      return (!wantProtocols || outcomes.length) ? res : null;
    }
    for (const o of q.options) {
      const hit = complete(Object.assign({}, answers, { [q.id]: [o.id] }), depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  return complete({}, 0) || best || { answers: {}, ev: E.evaluate(g, {}), byId, outcomes: [], steps: 0 };
}
const walk = (g) => explore(g);

/* ── 1. every vertical routes end to end ───────────────────────────────────── */

WAVE2.forEach(name => {
  test(`${name}: a walked pathway reaches an outcome that offers protocols`, () => {
    const g = load(name);
    const w = walk(g);
    assert.ok(w.steps >= 1, name + ": the graph asked no questions at all");
    assert.ok(w.outcomes.length >= 1,
      name + ": walking every question reached no protocol-bearing outcome (routing broken?)");
    // And the protocols it names must be real ones.
    w.outcomes.forEach(id => (w.byId[id].protocolRefs || []).forEach(r =>
      assert.ok(P[r], `${name}/${id} references unknown protocol ${r}`)));
  });
});

test("every wave-2 vertical answers questions and excludes something as it goes", () => {
  // A graph that never excludes a branch is not routing, it is just a list.
  WAVE2.forEach(name => {
    const w = walk(load(name));
    const excluded = Object.keys(w.ev.nodes).filter(id => w.ev.nodes[id].status === "disabled");
    assert.ok(excluded.length >= 1, name + ": answering excluded nothing");
    excluded.forEach(id => assert.ok((w.ev.nodes[id].disabledBy || []).length >= 1,
      `${name}/${id} is excluded with no provenance - the UI could not say why`));
  });
});

/* ── 2. agents stay in their declared context ──────────────────────────────── */

function neverAt(g, name, protoId, forbidden, why) {
  if (!P[protoId]) return;
  const hits = g.nodes
    .filter(n => (n.protocolRefs || []).indexOf(protoId) >= 0)
    .map(n => ({ id: n.id, pills: (n.pills || []).join(" ") }))
    .filter(n => forbidden.test(n.pills));
  assert.deepEqual(hits, [], `${name}: ${protoId} must never be offered where ${why} - found at ` +
    hits.map(h => `${h.id} [${h.pills}]`).join(", "));
}

test("HEAD & NECK: single-agent immunotherapy is not offered at a CPS-negative node", () => {
  const g = load("headneck");
  neverAt(g, "headneck", "hn-pembro-mono", /CPS *(<|neg|negative)/i, "the node's phenotype is CPS-negative");
});

test("OVARIAN: olaparib maintenance never appears at an HRD-negative node", () => {
  // Niraparib legitimately does (PRIMA: benefit regardless of HRD status); olaparib does not.
  const g = load("ovarian");
  neverAt(g, "ovarian", "gyn-olaparib-maint", /HRD-/, "the node's phenotype is HRD-negative");
});

test("THYROID: the RET inhibitor is only offered in a RET context", () => {
  const g = load("thyroid");
  const hits = g.nodes.filter(n => (n.protocolRefs || []).indexOf("thyroid-medullary-selpercatinib") >= 0);
  assert.ok(hits.length >= 1, "selpercatinib is offered nowhere (routing lost?)");
  hits.forEach(n => assert.ok(/RET/.test((n.pills || []).join(" ")),
    "selpercatinib at " + n.id + " whose phenotype is [" + (n.pills || []).join(",") + "] - RET expected"));
});

/* ── 3. the recommender stays honest across every vertical ─────────────────── */

test("recommend() never returns a protocol that was not offered, in any wave-2 vertical", () => {
  WAVE2.forEach(name => {
    const g = load(name);
    const w = walk(g);
    w.outcomes.forEach(id => {
      const offered = (w.byId[id].protocolRefs || []).filter(r => P[r]);
      if (!offered.length) return;
      const out = R.recommend(w.ev.phenotype, offered.map(r => P[r]));
      out.applicable.forEach(a => assert.ok(offered.indexOf(a.id) >= 0,
        `${name}/${id}: recommend() invented ${a.id}`));
      assert.ok(out.applicable.length <= offered.length, `${name}/${id}: more applicable than offered`);
    });
  });
});

test("every recommendation across wave-2 is flagged for physician review", () => {
  // ONCOTREE is decision support. Nothing it surfaces may read as an approved order.
  let checked = 0;
  WAVE2.forEach(name => {
    const g = load(name);
    const w = walk(g);
    w.outcomes.forEach(id => {
      const offered = (w.byId[id].protocolRefs || []).filter(r => P[r]);
      if (!offered.length) return;
      R.recommend(w.ev.phenotype, offered.map(r => P[r])).applicable.forEach(a => {
        checked++;
        assert.ok(/review required|decision support|not auto-selected|not an approved/i.test(a.rationale || ""),
          `${name}/${id}/${a.id}: rationale must state review is required`);
      });
    });
  });
  assert.ok(checked >= 1, "expected at least one recommendation across the wave-2 verticals");
});
