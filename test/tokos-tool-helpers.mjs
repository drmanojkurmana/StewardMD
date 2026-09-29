// Shared checks for the Tokos calculator model tests. Not a test file itself (no .test suffix).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

export const load = (id) => createRequire(import.meta.url)(`../tokos-models/tool-${id}.js`);
const bi = (x, where) => { assert.ok(x && typeof x.en === "string" && x.en && typeof x.hi === "string" && x.hi, `${where} needs en and hi`); assert.ok(!/[—–]/.test(x.en + x.hi), `${where} must not contain dashes used as em-dash`); };

export function shape(m, id) {
  assert.ok(!/\u2014/.test(readFileSync(new URL(`../tokos-models/tool-${id}.js`, import.meta.url), "utf8")), "no em-dash in model file");
  assert.equal(m.id, id); assert.equal(m.kind, "tool"); assert.equal(m.review, "ai_drafted");
  assert.ok(["obstetrics", "gynaecology"].includes(m.group)); assert.ok(["mbbs", "resident"].includes(m.level));
  bi(m.title, "title");
  assert.ok(m.sources.length >= 1 && m.sources.every((s) => s.label && /^https:\/\//.test(s.url)), "sources with https url");
  assert.ok(m.inputs.length >= 1);
  for (const i of m.inputs) { bi(i.label, `input ${i.id} label`); assert.ok(["number", "select", "date", "bool"].includes(i.type)); if (i.type === "select") { assert.ok(i.options.length >= 2); i.options.forEach((o) => bi(o.label, `option ${o.value}`)); } }
  assert.ok(m.examples.length >= 1);
}

export function examples(m) {
  m.examples.forEach((e, n) => {
    const r = m.compute(e.values);
    assert.equal(r.ok, true, `example ${n} ${JSON.stringify(e.values)} should be ok`);
    for (const k of Object.keys(e.expect)) {
      const got = k === "label" ? r.label.en : r[k];
      if (e.tol !== undefined && k === "value") assert.ok(Math.abs(got - e.expect[k]) <= e.tol, `example ${n} ${k}: ${got} vs ${e.expect[k]} (tol ${e.tol})`);
      else assert.equal(got, e.expect[k], `example ${n} ${k}`);
    }
    bi(r.label, "label"); bi(r.rule, "rule"); assert.ok(r.lines.length >= 1); r.lines.forEach((l, j) => bi(l, `line ${j}`));
    if (r.band !== undefined) assert.ok(["normal", "caution", "danger"].includes(r.band));
  });
}

export function rejects(m, cases) {
  cases.forEach((v, n) => {
    const r = m.compute(v);
    assert.equal(r.ok, false, `case ${n} ${JSON.stringify(v)} should be rejected`);
    bi(r.error, `case ${n} error`);
  });
}
