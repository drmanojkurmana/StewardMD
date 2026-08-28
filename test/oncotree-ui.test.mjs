/* ONCOTREE UI builders: render the real pathway state to HTML (no browser). Stubs a minimal document,
 * injects the REAL breast graph + REAL protocols, and asserts the HTML at each pathway state. The
 * headless-browser drive test (test/run-oncotree-ui.mjs) exercises real clicks on top of this. */
import { test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

// minimal DOM stubs so the module's paint()/repaint() are safe no-ops in Node
global.window = global;
global.document = { getElementById: () => null, createElement: () => ({ style: {}, addEventListener() {}, classList: { add() {}, remove() {} } }), body: { classList: { add() {}, remove() {} }, appendChild() {} }, dispatchEvent() {} };

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
require(join(ROOT, "oncotree-engine.js"));
require(join(ROOT, "oncotree-recommend.js"));
const UI = require(join(ROOT, "oncotree.js"));

const GRAPH = JSON.parse(readFileSync(join(ROOT, "kb/oncotree/breast.json"), "utf8"));
const PROTOS = {};
readdirSync(join(ROOT, "kb/protocols")).filter(f => f.startsWith("breast-")).forEach(f => {
  const p = JSON.parse(readFileSync(join(ROOT, "kb/protocols", f), "utf8")); PROTOS[p.id] = p;
});

function reset(answers) {
  const s = UI._st;
  s.graph = GRAPH; s.byId = {}; GRAPH.nodes.forEach(n => (s.byId[n.id] = n));
  s.protocols = PROTOS; s.answers = answers || {}; s.rebaseId = null;
  s.openedProtocol = null; s.selection = null; s.whyOpen = {}; s.showExcluded = false; s.view = "pathway";
  s.loaded = true; s.loading = false; s.error = null;
}
function noPlaceholders(html) {
  assert.ok(html.indexOf("undefined") < 0, "no 'undefined' in output");
  assert.ok(html.indexOf("[object Object]") < 0, "no '[object Object]' in output");
  assert.ok(html.indexOf("NaN") < 0, "no 'NaN' in output");
}

/* GRAPH-DERIVED, not hard-coded. The previous version pinned v1.1 copy ("Confirmed histology") and
 * v1.1 answer keys (n_stage, n_her2), so the whole suite died when the breast navigator was
 * rewritten to v3. These read the CURRENT graph instead, so the tests still assert that the UI
 * renders the real question and the real options without caring what this week's wording is. */
const byId = {}; GRAPH.nodes.forEach(n => (byId[n.id] = n));
const startNode = () => byId[(GRAPH.startNodeIds || [])[0]] || GRAPH.nodes[0];

/* Walk the graph answering EVERY active question, preferring an option whose id matches `prefer`.
 * Keeps going until no active question is left unanswered - stopping at the first node that merely
 * HAS protocols is not enough, because the UI keeps showing the pending question until the pathway
 * is actually complete. Returns { answers, nodeId, refs } for the reached outcome. */
function walkTo(prefer) {
  const ENG = require(join(ROOT, "oncotree-engine.js"));
  let answers = {};
  for (let i = 0; i < 12; i++) {
    const ev = ENG.evaluate(GRAPH, answers);
    const q = ev.order.map(id => byId[id]).find(n =>
      n && ev.nodes[n.id].status === "active" && n.nodeType === "question" && !answers[n.id] && (n.options || []).length);
    if (!q) break;
    const pick = (q.options.find(o => prefer && prefer.test(o.id)) || q.options[0]);
    answers = Object.assign({}, answers, { [q.id]: [pick.id] });
  }
  const ev = ENG.evaluate(GRAPH, answers);
  const nodeId = ev.order.find(id => ev.nodes[id].status === "active" && (byId[id].protocolRefs || []).length) || null;
  return { answers, nodeId, refs: nodeId ? byId[nodeId].protocolRefs : [] };
}
const HER2_PATH = walkTo(/invasive|upfront|her2pos|post/i);

test("initial state renders the first question (histology) with options", () => {
  reset({});
  const html = UI._bodyHtml();
  const q = startNode();
  const label = (q.title || q.name);
  assert.ok(html.indexOf(label) >= 0, "renders the start question: " + label);
  q.options.forEach(o => assert.ok(html.indexOf(o.label) >= 0, "renders option: " + o.label));
  noPlaceholders(html);
});

test("mid-pathway renders the progress rail + the current question", () => {
  const first = startNode();
  reset({ [first.id]: [first.options[0].id] });
  const html = UI._bodyHtml();
  assert.ok(/ot-rail/.test(html), "progress rail present");
  const ev = require(join(ROOT, "oncotree-engine.js")).evaluate(GRAPH, UI._st.answers);
  const next = ev.order.map(id => byId[id]).find(n =>
    n && ev.nodes[n.id].status === "active" && n.nodeType === "question" && !UI._st.answers[n.id]);
  assert.ok(next, "the graph advances to another question");
  assert.ok(html.indexOf(next.title || next.name) >= 0, "the current step is rendered: " + (next.title || next.name));
  noPlaceholders(html);
});

test("HER2 positive: outcome shows applicable HER2 protocol cards with unmistakable DRAFT badges", () => {
  assert.ok(HER2_PATH.nodeId, "the graph still reaches a treatment node carrying protocols");
  reset(HER2_PATH.answers);
  const html = UI._bodyHtml();
  assert.ok(/applicable protocol/.test(html));
  // At least one of the node's OWN protocol refs must be rendered - whichever they are today.
  assert.ok(HER2_PATH.refs.some(r => html.indexOf(r) >= 0 || (PROTOS[r] && html.indexOf(PROTOS[r].name) >= 0)),
    "a protocol card appears for one of " + HER2_PATH.refs.join(", "));
  assert.ok(/EXPERIMENTAL DRAFT/.test(html), "lifecycle badge is unmistakable");
  assert.ok(/ot-badge exp/.test(html), "draft badge styled distinctly");
  noPlaceholders(html);
});

test("excluded-pathways panel explains WHY via disabledBy when expanded", () => {
  reset(HER2_PATH.answers);
  UI._st.showExcluded = true;
  // Expand every excluded node, so the panel is exercised whatever the graph shape is.
  const ev = require(join(ROOT, "oncotree-engine.js")).evaluate(GRAPH, HER2_PATH.answers);
  const excluded = ev.order.filter(id => ev.nodes[id].status === "disabled" && (ev.nodes[id].disabledBy || []).length);
  assert.ok(excluded.length > 0, "answering must exclude something");
  UI._st.whyOpen = {}; excluded.forEach(id => (UI._st.whyOpen[id] = true));
  const html = UI._bodyHtml();
  assert.ok(/Not applicable/.test(html));
  assert.ok(/Excluded because/.test(html));
  // It must name the DECISION that caused the exclusion, not just say "excluded".
  const cause = byId[ev.nodes[excluded[0]].disabledBy[0].nodeId];
  // The panel labels the responsible decision by the node's short NAME ("Histology"), not its long
  // title, and pairs it with the answer given ("Excluded because Histology = Invasive breast cancer").
  const label = cause.name || cause.title;
  assert.ok(html.indexOf(label) >= 0, "names the responsible decision: " + label);
  noPlaceholders(html);
});

test("protocol detail view renders the regimen table + a DRAFT warning, never a bare approval", () => {
  reset({ n_histology: ["invasive"], n_stage: ["s2"], n_setting: ["neoadjuvant"], n_her2: ["pos"], n_hr2p: ["neg"] });
  UI._st.openedProtocol = "breast-tchp";
  const html = UI._bodyHtml();
  assert.ok(/Regimen/.test(html));
  // R1 safety semantics (calm wording): the draft must still read as AI-drafted + decision-support + verify.
  assert.ok(/AI-drafted/i.test(html));
  assert.ok(/decision support/i.test(html));
  assert.ok(/verify/i.test(html));
  assert.ok(/Back to options/.test(html));
  noPlaceholders(html);
});

test("selecting a protocol shows the handoff confirmation, not an activation", () => {
  reset({ n_histology: ["invasive"], n_stage: ["s4"], n_setting: ["metastatic"], n_her2: ["pos"], n_hr2p: ["neg"] });
  UI._select("breast-tdm1");
  const html = UI._bodyHtml();
  assert.ok(/Protocol selected/.test(html));
  assert.ok(/does NOT activate a treatment plan or compute a dose/i.test(html));
  assert.ok(/Continue in treatment workflow/.test(html));
  assert.equal(UI._st.selection.protocolId, "breast-tdm1");
  noPlaceholders(html);
});

test("interactive map: node-graph with positioned nodes, curved edges + state classes", () => {
  reset({ n_histology: ["invasive"], n_stage: ["s2"], n_setting: ["neoadjuvant"], n_her2: ["pos"], n_hr2p: ["neg"] });
  UI._st.view = "map";
  const html = UI._bodyHtml();
  assert.ok(/ot-graph-canvas/.test(html));                 // pan/zoom canvas
  assert.ok(/ot-gnode active/.test(html));                 // an active node
  assert.ok(/ot-gnode[^"]*disabled/.test(html));           // an excluded branch node
  assert.ok(/<path class="ot-edge/.test(html));            // SVG edges between nodes
  assert.ok(/left:\d+px;top:\d+px/.test(html));            // nodes are absolutely positioned (layout ran)
  assert.ok(/data-ot-act="graph-fit"/.test(html));         // zoom/fit controls present
  noPlaceholders(html);
});

test("answering prunes now-unreachable downstream answers (no stale deep answer)", () => {
  // Walk a full pathway, then flip the FIRST question to a different option so everything
  // downstream is excluded. Every stale downstream answer must be pruned, or the phenotype would
  // carry values from a branch the clinician has just navigated away from.
  const first = startNode();
  const walked = HER2_PATH.answers;
  const downstream = Object.keys(walked).filter(k => k !== first.id);
  assert.ok(downstream.length >= 2, "expected a multi-step pathway to prune");

  reset(Object.assign({}, walked));
  const other = first.options.find(o => o.id !== walked[first.id][0]);
  assert.ok(other, "the first question must offer an alternative to flip to");
  UI._answer(first.id, other.id);

  assert.deepEqual(UI._st.answers[first.id], [other.id], "the flip itself is recorded");
  const stale = downstream.filter(k => UI._st.answers[k] !== undefined);
  assert.deepEqual(stale, [], "stale answers on the abandoned branch must be pruned: " + stale.join(", "));
});

// Handoff routing: the dose flow (onco-plan-flow) self-gates on its own flags. When it is OFF (public
// release: smd_onco_protocols/_recommend def:false), the navigator must fall through to the read-only Onco
// workbench rather than close into a dead "flow is off" toast (the regression this guard prevents).
function handoffSetup() {
  reset({ n_histology: ["invasive"], n_stage: ["s4"], n_setting: ["metastatic"], n_her2: ["pos"], n_hr2p: ["neg"] });
  UI._select("breast-tdm1");   // sets st.selection.protocolId + keeps st.ctx standalone (no patientId)
}
test("handoff with the dose flow OFF opens the read-only Onco workbench (no dead-end)", () => {
  handoffSetup();
  let flowOpened = false, homeOpened = false, homeArg = null;
  global.SMD_ONCOFLOW = { isOn: () => false, openFind: () => { flowOpened = true; } };
  global.SMD_ONCOHOME = { open: (a) => { homeOpened = true; homeArg = a; } };
  UI._doHandoff();
  assert.equal(flowOpened, false, "flow must NOT open when its flags are off");
  assert.equal(homeOpened, true, "falls through to the Onco workbench");
  assert.ok(homeArg && "diagnosis" in homeArg, "carries the disease context");
  delete global.SMD_ONCOFLOW; delete global.SMD_ONCOHOME;
});
test("handoff with the dose flow ON opens the flow with the selected protocol", () => {
  handoffSetup();
  let flowOpened = false, flowProtos = null, homeOpened = false;
  global.SMD_ONCOFLOW = { isOn: () => true, openFind: (ctx, protos) => { flowOpened = true; flowProtos = protos; } };
  global.SMD_ONCOHOME = { open: () => { homeOpened = true; } };
  UI._doHandoff();
  assert.equal(flowOpened, true, "flow opens when enabled");
  assert.equal(homeOpened, false, "does not also open the workbench");
  assert.ok(Array.isArray(flowProtos) && flowProtos[0] && flowProtos[0].id === "breast-tdm1", "passes the selected protocol");
  delete global.SMD_ONCOFLOW; delete global.SMD_ONCOHOME;
});
