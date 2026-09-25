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
  assert.match(html, /pending clinical review/i);
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

