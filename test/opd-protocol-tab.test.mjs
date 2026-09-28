// OPD EMR Protocol tab (opd-emr.js protocolTab): clinical protocols (kb-protocols.js) + oncology
// regimens in one list, branch filter, cancer-type filter, search, in-tab reader, flags.
// Regressions from the owner's 2026-09-25 screenshot: a literal "&amp;" in the header, em dashes,
// and a placeholder dash under every regimen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);

globalThis.SMD_QUEUE_FLAGS = { bool: (k) => !(globalThis.__off || {})[k] };
require("../kb-protocols-flags.js");
require("../kb-protocols.js");
const OPDEMR = require("../opd-emr.js");
const RCHOP = JSON.parse(readFileSync(new URL("../kb/protocols/rchop.json", import.meta.url), "utf8"));
const AC = JSON.parse(readFileSync(new URL("../kb/protocols/breast-ac.json", import.meta.url), "utf8"));
const SEPSIS = JSON.parse(readFileSync(new URL("../kb/clinical-protocols/sepsis-septic-shock.json", import.meta.url), "utf8"));

const INDEX = {
  count: 3,
  bases: [{ key: "international", label: "International", count: 2 }, { key: "india", label: "India", count: 1 }],
  subjects: [{ key: "critical-care", label: "Critical Care", count: 1 }, { key: "endocrinology", label: "Endocrinology and Diabetes", count: 2 }],
  protocols: [
    { id: "sepsis-septic-shock", title: SEPSIS.title, subject: "critical-care", population: "Adults", basis: "international", aliases: SEPSIS.aliases, summary: SEPSIS.summary, sources: ["SCCM 2021"], status: "ai_drafted" },
    { id: "diabetic-ketoacidosis", title: "Diabetic ketoacidosis (adult)", subject: "endocrinology", population: "Adults", basis: "international", aliases: ["DKA"], summary: "Fluids, fixed-rate insulin and potassium.", sources: ["ADA 2024"], status: "ai_drafted" },
    { id: "thyroid-storm", title: "Thyroid storm", subject: "endocrinology", population: "Adults", basis: "india", counterpart: "sepsis-septic-shock", aliases: [], summary: "Thionamide, iodine after, beta-blocker, steroid.", sources: ["ATA 2016"], status: "ai_drafted" }
  ]
};
const state = (extra) => Object.assign({ tab: "protocol", loading: false, error: "", patient: { name: "T", mrn: "M1" }, writeOn: true,
  oncoProtocols: [RCHOP, AC], oncoProtocolsLoaded: true, oncoProtocolsReady: true, kbpIndex: INDEX, protoQuery: "", protoBranch: "all", protoOncoType: "" }, extra || {});
const render = (extra) => OPDEMR._render(state(extra));
const count = (html, re) => (html.match(re) || []).length;

test("header text is not double-escaped and the tab carries no em or en dash", () => {
  const html = render();
  assert.ok(!html.includes("&amp;amp;"), "no double-escaped ampersand");
  const tab = html.slice(html.indexOf('data-oe-act="proto-branch:all"') - 2000);
  assert.doesNotMatch(tab, /[–—]/);
});

test("All lists every clinical protocol and every regimen, with branch chips for each subject + Oncology", () => {
  const html = render();
  assert.equal(count(html, /data-oe-act="proto-open:/g), 3);
  assert.equal(count(html, /data-oe-act="proto-assign:/g), 2);
  const chips = [...html.matchAll(/data-oe-act="proto-branch:([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(chips, ["all", "oncology", "critical-care", "endocrinology"]);
  assert.ok(html.includes("Diffuse large B-cell lymphoma") && html.includes("Breast cancer"), "regimen subtitles name the cancer type");
});

test("a clinical branch shows only that subject; Oncology shows only regimens + a cancer-type picker", () => {
  let html = render({ protoBranch: "endocrinology" });
  assert.equal(count(html, /data-oe-act="proto-open:/g), 2);
  assert.equal(count(html, /data-oe-act="proto-assign:/g), 0);
  assert.ok(!html.includes('data-oe-inp="proto-type"'));
  html = render({ protoBranch: "oncology" });
  assert.equal(count(html, /data-oe-act="proto-open:/g), 0);
  assert.equal(count(html, /data-oe-act="proto-assign:/g), 2);
  assert.ok(html.includes('data-oe-inp="proto-type"'));
  html = render({ protoBranch: "oncology", protoOncoType: "breast_cancer" });
  assert.equal(count(html, /data-oe-act="proto-assign:/g), 1);
  assert.ok(html.includes('data-oe-act="proto-assign:breast-ac"'));
});

test("search: abbreviation, cancer type with spaces, regimen drug, and a clear empty state", () => {
  assert.ok(render({ protoQuery: "dka" }).includes('data-oe-act="proto-open:diabetic-ketoacidosis"'));
  let html = render({ protoQuery: "breast cancer" });
  assert.ok(html.includes("proto-assign:breast-ac") && !html.includes("proto-assign:rchop"));
  html = render({ protoQuery: "rituximab" });
  assert.ok(html.includes("proto-assign:rchop") && !html.includes("proto-assign:breast-ac"));
  assert.ok(render({ protoQuery: "lymphoma" }).includes("proto-assign:rchop"));
  assert.match(render({ protoQuery: "zzqq" }), /No protocol matches/);
});

test("read-only lists regimens as view only", () => {
  const html = render({ writeOn: false });
  assert.equal(count(html, /data-oe-act="proto-assign:/g), 0);
  assert.ok(html.includes("view only"));
});

test("an open clinical protocol renders the shared reader inside the tab with a Back control", () => {
  const html = render({ protoOpenId: SEPSIS.id, protoDoc: SEPSIS });
  assert.ok(html.includes('class="kbp-embed kblib-tool-protocols"'));
  assert.ok(html.includes('data-oe-act="proto-close"') && html.includes('aria-label="Back to protocols"'));
  assert.ok(html.includes('id="oeKbpSources"'), "embedded ids are prefixed so they never collide with the Knowledge Library");
  assert.equal(count(html, /class="kbp-sec kbp-k-/g), SEPSIS.sections.length);
  assert.doesNotMatch(html, /pending clinical review|Draft,/i);
  assert.match(html, /Verify every dose and threshold against the source/);
});

test("flags: oncology off keeps clinical protocols; both off says so", () => {
  globalThis.__off = { smd_onco_protocols: true };
  try {
    const html = render();
    assert.equal(count(html, /data-oe-act="proto-open:/g), 3);
    assert.ok(!html.includes("proto-branch:oncology") && !html.includes("proto-assign:"));
    const on = globalThis.SMD_KBPROTO_FLAGS.on;
    globalThis.SMD_KBPROTO_FLAGS.on = () => false;
    try { assert.match(render(), /Protocols are not enabled/); } finally { globalThis.SMD_KBPROTO_FLAGS.on = on; }
  } finally { globalThis.__off = {}; }
});

test("guideline basis: International / India filter, row pills, oncology counts as International", () => {
  let html = render();
  assert.deepEqual([...html.matchAll(/data-oe-act="proto-basis:([^"]+)"/g)].map((m) => m[1]), ["all", "international", "india"]);
  assert.ok(html.includes('oe-proto-bpill oe-b-international') && html.includes('oe-proto-bpill oe-b-india'));
  html = render({ protoBasis: "india" });
  assert.equal(count(html, /data-oe-act="proto-open:/g), 1);
  assert.ok(html.includes("proto-open:thyroid-storm"));
  assert.equal(count(html, /data-oe-act="proto-assign:/g), 0, "regimens are international, hidden under India");
  html = render({ protoBasis: "international" });
  assert.equal(count(html, /data-oe-act="proto-open:/g), 2);
  assert.equal(count(html, /data-oe-act="proto-assign:/g), 2);
});

test("reader links the other guideline version through the OPD action system", () => {
  const doc = Object.assign({}, SEPSIS, { basis: "international", counterpart: "thyroid-storm" });
  globalThis.SMD_KBPROTO._state.index = INDEX;
  try {
    const html = render({ protoOpenId: doc.id, protoDoc: doc });
    assert.ok(html.includes('class="kbp-twin" data-oe-act="proto-open:thyroid-storm"'));
    assert.ok(html.includes("India national guidelines") && html.includes("Thyroid storm"));
  } finally { globalThis.SMD_KBPROTO._state.index = null; }
});


/* ---- Assign a clinical protocol into the case sheet (2026-09-26, flag smd_protocol_assign) --------
 * The owner's ask: "protocols cant be assigned like oncology protocols". An oncology regimen attaches
 * a server-side draft plan; a clinical protocol has no plan object, so it is assigned the way the
 * specialty kit adds findings - the doctor ticks the instructions and they land in the case sheet as
 * editable text. The composer is pure (kb-protocols.js), so it is tested against the real sepsis file.
 */
const KBP = globalThis.SMD_KBPROTO;
const FLAGS = globalThis.SMD_KBPROTO_FLAGS;
const withAssign = (on, fn) => { const was = FLAGS.assignOn; FLAGS.assignOn = () => on; try { return fn(); } finally { FLAGS.assignOn = was; } };

test("assignLines: one line per instruction plus the drugs, with safe defaults", () => {
  const lines = KBP.assignLines(SEPSIS);
  const items = SEPSIS.sections.reduce((n, s) => n + s.items.length, 0);
  assert.equal(lines.length, items + (SEPSIS.drugs || []).length);
  assert.ok(lines.every((l) => l.id && l.text && l.field && l.group));
  // Reading matter and dose-bearing lines are never ticked for the doctor.
  assert.ok(lines.filter((l) => ["recognise", "pitfalls", "special", "drugs"].includes(l.kind)).every((l) => l.on === false));
  assert.ok(lines.filter((l) => ["immediate", "treatment", "monitoring", "escalate", "disposition", "investigations"].includes(l.kind)).every((l) => l.on === true));
  assert.ok(lines.filter((l) => l.kind === "prevention").every((l) => l.field === "diet_lifestyle_advice"));
});

test("assignText: a numbered case-sheet block per field, headed by the protocol and its sources", () => {
  const lines = KBP.assignLines(SEPSIS);
  const res = KBP.assignText(SEPSIS, lines.filter((l) => l.on).map((l) => l.id));
  assert.ok(res.count > 0);
  const plan = res.blocks.filter((b) => b.field === "management_plan")[0];
  assert.ok(plan, "a management plan block");
  assert.ok(plan.text.startsWith("Protocol: " + SEPSIS.title), plan.text.slice(0, 80));
  assert.match(plan.text, /\n1\. /, "instructions are numbered");
  assert.match(plan.text, /Verify every dose and threshold against the source/);
  assert.equal(KBP.assignText(SEPSIS, []).count, 0, "nothing ticked writes nothing");
  assert.doesNotMatch(plan.text, /[–—]/, "no en or em dash");
});

test("assignText: only the ticked lines, in the protocol's own order", () => {
  const lines = KBP.assignLines(SEPSIS).filter((l) => l.field === "management_plan");
  const res = KBP.assignText(SEPSIS, [lines[1].id, lines[0].id]);
  assert.equal(res.count, 2);
  const body = res.blocks[0].text;
  assert.ok(body.indexOf(lines[0].text) < body.indexOf(lines[1].text), "document order, not tick order");
});

test("protocol rows offer Assign beside Open in write mode only", () => {
  let html = render();
  assert.equal(count(html, /data-oe-act="proto-as-open:/g), 3, "every clinical protocol can be assigned");
  html = render({ writeOn: false });
  assert.equal(count(html, /data-oe-act="proto-as-open:/g), 0, "read-only session offers no Assign");
  assert.ok(html.includes('data-oe-act="proto-open:sepsis-septic-shock"'), "but it still opens");
  withAssign(false, () => {
    assert.equal(count(render(), /data-oe-act="proto-as-open:/g), 0, "flag off hides Assign");
  });
});

test("the reader carries the tick list, its counts and the write gate", () => {
  const open = { protoOpenId: SEPSIS.id, protoDoc: SEPSIS, assessLoaded: true };
  let html = render(open);
  assert.ok(html.includes("Assign to this patient"), "closed: one button");
  html = render(Object.assign({}, open, { protoAssign: { id: SEPSIS.id, sel: {} } }));
  const on = KBP.assignLines(SEPSIS).filter((l) => l.on).length;
  assert.equal(count(html, /data-oe-act="proto-as-line:/g), KBP.assignLines(SEPSIS).length);
  assert.equal(count(html, /checked data-oe-act="proto-as-line:/g), on, "the defaults are ticked");
  assert.match(html, new RegExp(on + " instructions"));
  assert.ok(html.includes('data-oe-act="proto-as-apply"') && !html.includes("proto-as-apply\" disabled"));
  // Nothing ticked, and the read-only / still-loading gates.
  const none = {}; KBP.assignLines(SEPSIS).forEach((l) => { none[l.id] = false; });
  html = render(Object.assign({}, open, { protoAssign: { id: SEPSIS.id, sel: none } }));
  assert.ok(html.includes("Nothing ticked yet") && html.includes("disabled"));
  html = render(Object.assign({}, open, { writeOn: false, protoAssign: { id: SEPSIS.id, sel: {} } }));
  assert.ok(html.includes("Open the patient in write mode"), "says why it cannot be added");
  assert.ok(!render(Object.assign({}, open, { writeOn: false })).includes("Assign to this patient"), "read-only reader offers no Assign at all");
  assert.ok(render(Object.assign({}, open, { assessAuthorized: true, protoAssign: { id: SEPSIS.id, sel: {} } })).includes("authorised and locked"), "an authorised assessment says so");
});

/* ---- OncoTree hand-off: a staged regimen has to be findable (2026-09-26) -------------------------
 * "Continue in treatment workflow" stages a dose draft in the review panel on the Assessment tab. The
 * ONCQIS tab used to answer "No active treatment plan for this patient yet", so the hand-off looked
 * like it had done nothing (owner). It now names the staged regimen and points at the review panel.
 */
test("ONCQIS: a staged regimen is named and points at the Assessment tab", () => {
  const html = OPDEMR._render(state({ tab: "onco", oncoDraft: { protocolId: RCHOP.id, template: RCHOP, params: {}, calculatedDoses: [], overrides: [] } }));
  assert.match(html, /is staged for this patient/);
  assert.ok(html.includes(RCHOP.name || RCHOP.id));
  assert.match(html, /data-oe-act="tab:assess"/);
  assert.doesNotMatch(html, /No active treatment plan/);
});

test("ONCQIS: with nothing staged it says so and names where to find a regimen", () => {
  const html = OPDEMR._render(state({ tab: "onco" }));
  assert.match(html, /No active treatment plan for this patient yet/);
});

/* ---- Every instruction is editable before it is added (owner, 2026-09-27) -------------------------
 * "keep drug doses unticked and editable and protocols editable too". A dose or a threshold often has
 * to match local practice, so the wording can be changed in the tick list, not only after it lands in
 * the form. Drug doses still start unticked.
 */
test("assignText: the doctor's own wording wins over the protocol's", () => {
  const lines = KBP.assignLines(SEPSIS);
  const edits = { [lines[0].id]: "  Piperacillin-tazobactam 4.5 g IV as per our antibiogram  " };
  const res = KBP.assignText(SEPSIS, [lines[0].id], edits);
  assert.match(res.blocks[0].text, /Piperacillin-tazobactam 4\.5 g IV as per our antibiogram/);
  assert.ok(!res.blocks[0].text.includes(lines[0].text), "the original wording is replaced, not appended");
  // Blank or whitespace-only edits fall back to the protocol's own text.
  assert.match(KBP.assignText(SEPSIS, [lines[0].id], { [lines[0].id]: "   " }).blocks[0].text, new RegExp(lines[0].text.slice(0, 25).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(KBP.assignText(SEPSIS, [], edits).count, 0, "an edit alone adds nothing");
});

test("assignHTML: an Edit control per line, a textarea for the open one, Undo only once changed", () => {
  const lines = KBP.assignLines(SEPSIS);
  let html = KBP.assignHTML(SEPSIS, {}, {});
  assert.equal((html.match(/proto-as-edit:/g) || []).length, lines.length, "every line can be edited");
  assert.ok(!html.includes("kbp-as-tx"), "no textarea until one is opened");
  html = KBP.assignHTML(SEPSIS, {}, { editing: lines[0].id });
  assert.equal((html.match(/kbp-as-tx/g) || []).length, 1, "only the open line is a textarea");
  assert.ok(html.includes('data-kbp-inp="proto-as-txt:' + lines[0].id + '"'));
  assert.ok(!html.includes("proto-as-undo:"), "nothing to undo yet");
  html = KBP.assignHTML(SEPSIS, {}, { editing: lines[0].id, edits: { [lines[0].id]: "my wording" } });
  assert.ok(html.includes("proto-as-undo:" + lines[0].id) && html.includes("my wording"));
  assert.match(KBP.assignHTML(SEPSIS, {}, { edits: { [lines[0].id]: "my wording" } }), /kbp-as-to edited/, "an edited line is marked in the list");
});

test("the drug doses stay unticked, and are editable like every other line", () => {
  const drugs = KBP.assignLines(SEPSIS).filter((l) => l.kind === "drugs");
  assert.ok(drugs.length, "this protocol carries drugs");
  assert.ok(drugs.every((l) => l.on === false), "never ticked for the doctor");
  const html = KBP.assignHTML(SEPSIS, {}, { editing: drugs[0].id });
  assert.ok(html.includes('data-kbp-inp="proto-as-txt:' + drugs[0].id + '"'), "the dose line opens for editing");
  assert.match(KBP.assignText(SEPSIS, [drugs[0].id], { [drugs[0].id]: "Meropenem 1 g IV 8 hourly" }).blocks[0].text, /Meropenem 1 g IV 8 hourly/);
});

test("the OPD panel carries the edit state, and Reset clears the edits too", () => {
  const lines = KBP.assignLines(SEPSIS);
  const open = { protoOpenId: SEPSIS.id, protoDoc: SEPSIS, assessLoaded: true };
  const html = render(Object.assign({}, open, {
    protoAssign: { id: SEPSIS.id, sel: {}, edits: { [lines[0].id]: "local wording" }, editing: lines[0].id }
  }));
  assert.ok(html.includes('data-oe-inp="proto-as-txt:' + lines[0].id + '"'), "the textarea uses the OPD input system");
  assert.ok(html.includes("local wording"));
  assert.ok(html.includes('data-oe-act="proto-as-reset"'));
});

/* ---- The legal line (owner, 2026-09-27) ---------------------------------------------------------- */
test("the assign panel and the reader both name the doctor as responsible, not StewardMD", () => {
  assert.match(KBP.DUTY_LINE, /treating doctor is responsible/);
  assert.match(KBP.DUTY_LINE, /StewardMD accepts no liability/);
  const panel = render({ protoOpenId: SEPSIS.id, protoDoc: SEPSIS, assessLoaded: true, protoAssign: { id: SEPSIS.id, sel: {} } });
  assert.ok(panel.includes("kbp-as-duty") && panel.includes("StewardMD accepts no liability"));
  assert.ok(KBP.readerHTML(SEPSIS, {}).includes(KBP.DUTY_LINE), "the reader's own footer carries it");
});
