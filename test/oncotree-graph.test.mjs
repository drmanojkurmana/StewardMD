/* ONCOTREE navigator-graph integrity: guards every kb/oncotree/*.json against the classes of authoring
 * error that would produce a broken pathway (orphan/unreachable nodes, dangling links, duplicate ids,
 * protocolRefs that do not resolve to a real protocol, malformed options). A new disease graph that
 * violates any of these fails here rather than in the app. */
import { test } from "node:test";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIR = join(ROOT, "kb/oncotree");
const graphs = readdirSync(DIR).filter(f => f.endsWith(".json"));
const protoIds = new Set(readdirSync(join(ROOT, "kb/protocols")).filter(f => f.endsWith(".json")).map(f => f.replace(".json", "")));

test("at least one navigator graph is authored", () => { assert.ok(graphs.length >= 1); });

for (const file of graphs) {
  const g = JSON.parse(readFileSync(join(DIR, file), "utf8"));
  const nodes = g.nodes || [], links = g.links || [];
  const ids = nodes.map(n => n.id);
  const idSet = new Set(ids);

  test(`${file}: required top-level fields`, () => {
    ["guideline", "navigatorVersion", "diseaseId", "startNodeIds", "nodes", "links"].forEach(k =>
      assert.ok(g[k] != null, "missing " + k));
    assert.ok(Array.isArray(g.startNodeIds) && g.startNodeIds.length >= 1);
    g.startNodeIds.forEach(s => assert.ok(idSet.has(s), "startNodeId not a node: " + s));
  });

  test(`${file}: node ids are unique`, () => {
    assert.equal(ids.length, idSet.size, "duplicate node id in " + file);
  });

  test(`${file}: every link endpoint resolves to a node`, () => {
    links.forEach(l => {
      assert.ok(idSet.has(l.from), l.id + " from missing: " + l.from);
      assert.ok(idSet.has(l.to), l.id + " to missing: " + l.to);
    });
  });

  test(`${file}: every non-start node is reachable from a start node`, () => {
    const adj = {}; ids.forEach(id => (adj[id] = []));
    links.forEach(l => adj[l.from] && adj[l.from].push(l.to));
    const seen = new Set(g.startNodeIds), q = g.startNodeIds.slice();
    while (q.length) { const id = q.shift(); (adj[id] || []).forEach(t => { if (!seen.has(t)) { seen.add(t); q.push(t); } }); }
    ids.forEach(id => assert.ok(seen.has(id), "unreachable/orphan node: " + id));
  });

  test(`${file}: link fromOptions reference real options on the source node`, () => {
    const byId = {}; nodes.forEach(n => (byId[n.id] = n));
    links.forEach(l => {
      (l.fromOptions || []).forEach(optId => {
        const src = byId[l.from];
        assert.ok((src.options || []).some(o => o.id === optId), l.id + " fromOptions '" + optId + "' not an option of " + l.from);
      });
    });
  });

  test(`${file}: question nodes have options with unique ids + labels`, () => {
    nodes.filter(n => n.nodeType === "question").forEach(n => {
      const opts = n.options || [];
      assert.ok(opts.length >= 1, n.id + " question has no options at all");
      // Graph v3 introduced single-option "workup then continue" steps (n_dcis_wk, n_inv_wk ...):
      // an acknowledge-and-proceed node, not a branch. Requiring >= 2 options was a v1.1 assumption
      // that every question forks. A node that forks must still offer a real choice.
      const isContinueStep = opts.length === 1 && /^(continue|next|proceed|ack)$/i.test(opts[0].id || "");
      if (!isContinueStep) {
        assert.ok(opts.length >= 2, n.id + " branching question needs >=2 options (or a single 'continue' step)");
      }
      const oids = opts.map(o => o.id);
      assert.equal(oids.length, new Set(oids).size, n.id + " duplicate option id");
      opts.forEach(o => { assert.ok(o.id && o.label, n.id + " option missing id/label"); });
    });
  });

  test(`${file}: every protocolRef resolves to a real Standard Protocol (no fabricated protocol)`, () => {
    nodes.forEach(n => (n.protocolRefs || []).forEach(ref => {
      assert.ok(protoIds.has(ref), n.id + " references missing protocol: " + ref);
      assert.ok(existsSync(join(ROOT, "kb/protocols", ref + ".json")), "protocol file missing: " + ref);
    }));
  });

  test(`${file}: outcome nodes actually recommend something (protocol or written guidance)`, () => {
    // v1.1 assumed every endpoint dispenses a systemic-therapy protocol, so it demanded protocolRefs.
    // v3 added SURGICAL, LOCAL-THERAPY and SURVEILLANCE endpoints, which legitimately have no
    // chemotherapy protocol to name - breast n_tx_dcis_erneg literally records "endocrine therapy is
    // not indicated", so a protocolRef there would be WRONG, not missing.
    //
    // The safety property worth keeping is not "has a protocolRef", it is "is not an empty
    // recommendation": an outcome node must hand the clinician either a named protocol or written
    // guidance. That is what this now asserts.
    nodes.filter(n => n.showsRecommendation || n.nodeType === "end").forEach(n => {
      const refs = (n.protocolRefs || []).length;
      const bullets = (n.bullets || []).filter(b => String(b || "").trim()).length;
      assert.ok(refs >= 1 || bullets >= 1,
        n.id + " outcome node recommends nothing: no protocolRefs and no bullets");
    });
  });

}
