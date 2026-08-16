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

test("initial state renders the first question (histology) with options", () => {
  reset({});
  const html = UI._bodyHtml();
  assert.ok(/Confirmed histology/.test(html));
  assert.ok(/Invasive breast carcinoma/.test(html));
  noPlaceholders(html);
});

test("mid-pathway renders the progress rail + the current question", () => {
  reset({ n_histology: ["invasive"], n_stage: ["s2"] });
  const html = UI._bodyHtml();
  assert.ok(/ot-rail/.test(html), "progress rail present");
  assert.ok(/Treatment setting and intent/.test(html), "setting is the current step");
  noPlaceholders(html);
});

test("HER2 positive: outcome shows applicable HER2 protocol cards with unmistakable DRAFT badges", () => {
  reset({ n_histology: ["invasive"], n_stage: ["s2"], n_setting: ["neoadjuvant"], n_her2: ["pos"], n_hr2p: ["neg"] });
  const html = UI._bodyHtml();
  assert.ok(/applicable protocol/.test(html));
  assert.ok(/Dabrafenib|Docetaxel|Pertuzumab|TCHP|Trastuzumab|breast-tchp/i.test(html) || /breast-tch/.test(html), "a HER2 protocol card appears");
  assert.ok(/EXPERIMENTAL DRAFT/.test(html), "lifecycle badge is unmistakable");
  assert.ok(/ot-badge exp/.test(html), "draft badge styled distinctly");
  noPlaceholders(html);
});

test("excluded-pathways panel explains WHY via disabledBy when expanded", () => {
  reset({ n_histology: ["invasive"], n_stage: ["s2"], n_setting: ["neoadjuvant"], n_her2: ["pos"], n_hr2p: ["neg"] });
  UI._st.showExcluded = true;
  UI._st.whyOpen = { n_hrpos: true, n_tnbc: true };
  const html = UI._bodyHtml();
  assert.ok(/Not applicable/.test(html));
  assert.ok(/Excluded because/.test(html));
  assert.ok(/HER2 status/.test(html), "names the responsible decision");
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
  reset({ n_histology: ["invasive"], n_stage: ["s2"], n_setting: ["neoadjuvant"], n_her2: ["neg"], n_hr2n: ["pos"] });
  UI._answer("n_her2", "pos");                       // flip HER2 to positive
  // n_hr2n is now disabled, so its stale answer must have been pruned
  assert.equal(UI._st.answers.n_hr2n, undefined);
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
