// Gynaecology MBBS drills added for units gy1, gy3, gy4, gy5: stage structure, critical steps, sources,
// and the wiring (lesson test.sim -> drill id -> models.json -> competency map).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const core = require("../tokos-models/drill-core.js");
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const NEW = { mullerian: "gy1-anomalies", pcos: "gy3-diagnose", pid: "gy4-pid", fibroid: "gy5-fibroid-treat" };

for (const [id, lesson] of Object.entries(NEW)) {
  const data = JSON.parse(read(`tokos/drill/${id}.json`));

  test(`${id}: schema valid, mbbs, ai_drafted, https sources`, () => {
    assert.deepEqual(core.validate(data), []);
    assert.equal(data.kind, "drill"); assert.equal(data.level, "mbbs"); assert.equal(data.review, "ai_drafted");
    assert.ok(data.sources.length >= 1);
    for (const s of data.sources) assert.match(s.url, /^https:\/\//);
  });

  test(`${id}: every stage has one correct option, a feedback line and a valid next`, () => {
    const ids = new Set(data.stages.map((s) => s.id));
    for (const s of data.stages) {
      const correct = s.options.filter((o) => o.correct);
      assert.equal(correct.length, 1, s.id);
      assert.ok(s.options.length >= 2, s.id);
      for (const o of s.options) {
        assert.ok(o.feedback.en && o.feedback.hi, `${s.id}.${o.id} feedback`);
        if (o.next && o.next !== "end") assert.ok(ids.has(o.next), `${s.id}.${o.id} next`);
      }
      assert.ok(s.src < data.sources.length, s.id + " src");
    }
  });

  test(`${id}: ideal path has at least three critical steps and ends cleanly`, () => {
    const path = core.idealPath(data);
    const critical = path.filter((sid) => data.stages.find((s) => s.id === sid).options.find((o) => o.correct).critical);
    assert.ok(critical.length >= 3, critical.join(","));
    assert.equal(core.score(data, core.idealAttempt(data)).pct, 100);
  });

  test(`${id}: lesson links to the drill and the model is loaded and in sync`, () => {
    const l = JSON.parse(read(`tokos/learn/lessons/${lesson}.json`));
    assert.equal(l.test.sim, id);
    const models = JSON.parse(read("tokos/models.json")).models;
    assert.ok(models.includes("drill-" + id));
    assert.match(read(`tokos-models/drill-${id}.js`), new RegExp(`core\\.make\\(.*"id":"${id}"`));
  });
}
