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
      assert.ok((n.options || []).length >= 2, n.id + " question needs >=2 options");
      const oids = n.options.map(o => o.id);
      assert.equal(oids.length, new Set(oids).size, n.id + " duplicate option id");
      n.options.forEach(o => { assert.ok(o.id && o.label, n.id + " option missing id/label"); });
    });
  });

  test(`${file}: every protocolRef resolves to a real Standard Protocol (no fabricated protocol)`, () => {
    nodes.forEach(n => (n.protocolRefs || []).forEach(ref => {
      assert.ok(protoIds.has(ref), n.id + " references missing protocol: " + ref);
      assert.ok(existsSync(join(ROOT, "kb/protocols", ref + ".json")), "protocol file missing: " + ref);
    }));
  });

  test(`${file}: treatment/end nodes that show recommendations carry protocolRefs`, () => {
    nodes.filter(n => n.showsRecommendation || n.nodeType === "end").forEach(n => {
      assert.ok((n.protocolRefs || []).length >= 1, n.id + " outcome node has no protocolRefs");
    });
  });
}
