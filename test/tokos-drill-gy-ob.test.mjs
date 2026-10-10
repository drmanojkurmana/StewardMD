// Drills for MBBS units gy7, gy9, gy12 and ob8: stage structure, critical steps, https sources, and the wiring
// (lesson test.sim -> drill id -> models.json -> competency map).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { render } from "../tools/tokos-build-drills.mjs";

const require = createRequire(import.meta.url);
const core = require("../tokos-models/drill-core.js");
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const NEW = { ovulation: "gy7-treatment-ladder", hrt: "gy9-hrt-regimens", pmb: "gy12-pmb", steroids: "ob8-preterm-steroids" };

for (const [id, lesson] of Object.entries(NEW)) {
  const data = JSON.parse(read(`tokos/drill/${id}.json`));

  test(`${id}: schema valid, mbbs, ai_drafted, https sources`, () => {
    assert.deepEqual(core.validate(data), []);
    assert.equal(data.kind, "drill"); assert.equal(data.level, "mbbs"); assert.equal(data.review, "ai_drafted");
    assert.ok(data.sources.length >= 1);
    for (const s of data.sources) assert.match(s.url, /^https:\/\//);
  });

  test(`${id}: every stage has a bilingual prompt, one correct option, feedback and a valid next`, () => {
    const ids = new Set(data.stages.map((s) => s.id));
    assert.ok(data.stages.length >= 3, "at least three stages");
    for (const s of data.stages) {
      assert.ok(s.prompt.en && s.prompt.hi, `${s.id} prompt`);
      assert.ok(Number.isInteger(s.src) && s.src < data.sources.length, `${s.id} src`);
      assert.ok(s.timeSec > 0, `${s.id} timeSec`);
      assert.equal(s.options.filter((o) => o.correct).length, 1, `${s.id} one correct`);
      assert.ok(s.options.length >= 2, `${s.id} options`);
      for (const o of s.options) {
        assert.ok(o.text.en && o.text.hi, `${s.id}.${o.id} text`);
        assert.ok(o.feedback.en && o.feedback.hi, `${s.id}.${o.id} feedback`);
        assert.ok(!o.critical || o.correct, `${s.id}.${o.id} critical only when correct`);
        if (o.next && o.next !== "end") assert.ok(ids.has(o.next), `${s.id}.${o.id} next`);
      }
    }
  });

  test(`${id}: ideal path has at least three critical steps, scores 100 and ends cleanly`, () => {
    const path = core.idealPath(data);
    const critical = path.filter((sid) => data.stages.find((s) => s.id === sid).options.find((o) => o.correct).critical);
    assert.ok(critical.length >= 3, critical.join(","));
    assert.equal(core.score(data, core.idealAttempt(data)).pct, 100);
  });

  test(`${id}: lesson links to the drill, the model is listed and in sync`, () => {
    const l = JSON.parse(read(`tokos/learn/lessons/${lesson}.json`));
    assert.equal(l.test.sim, id);
    const models = JSON.parse(read("tokos/models.json")).models;
    assert.ok(models.includes("drill-" + id));
    assert.equal(read(`tokos-models/drill-${id}.js`), render(data), "run node tools/tokos-build-drills.mjs");
  });
}
