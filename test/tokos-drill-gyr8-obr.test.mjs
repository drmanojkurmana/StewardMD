// Drills for gyr8 (consent), obr1 (fgr), obr6 (cardiac) and obr8 (cerclage): stage structure, critical steps,
// https sources, and the wiring (lesson test.sim -> drill id -> models.json -> competency map).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { render } from "../tools/tokos-build-drills.mjs";

const require = createRequire(import.meta.url);
const core = require("../tokos-models/drill-core.js");
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const NEW = { consent: "gyr8-consent", fgr: "obr1-fgr-delivery", cardiac: "obr6-cardiac-delivery", cerclage: "obr8-cerclage" };
const COMPETENCY = { consent: "OG35.10", fgr: "OG12.11", cardiac: "OG12.4", cerclage: "OG15.1" };

for (const [id, lesson] of Object.entries(NEW)) {
  const data = JSON.parse(read(`tokos/drill/${id}.json`));

  test(`${id}: schema valid, ai_drafted, https sources, level matches the lesson`, () => {
    assert.deepEqual(core.validate(data), []);
    assert.equal(data.kind, "drill"); assert.equal(data.review, "ai_drafted");
    assert.equal(data.level, JSON.parse(read(`tokos/learn/lessons/${lesson}.json`)).level);
    assert.ok(data.sources.length >= 1);
    for (const s of data.sources) assert.match(s.url, /^https:\/\//);
  });

  test(`${id}: every stage has a bilingual prompt, one correct option, feedback and a valid next`, () => {
    const ids = new Set(data.stages.map((s) => s.id));
    assert.equal(data.stages.length, 3, "three stages");
    for (const s of data.stages) {
      assert.ok(s.prompt.en && s.prompt.hi, `${s.id} prompt`);
      assert.ok(Number.isInteger(s.src) && s.src < data.sources.length, `${s.id} src`);
      assert.ok(s.timeSec > 0, `${s.id} timeSec`);
      assert.equal(s.options.filter((o) => o.correct).length, 1, `${s.id} one correct`);
      assert.equal(s.options.length, 3, `${s.id} options`);
      for (const o of s.options) {
        assert.ok(o.text.en && o.text.hi, `${s.id}.${o.id} text`);
        assert.ok(o.feedback.en && o.feedback.hi, `${s.id}.${o.id} feedback`);
        assert.ok(!o.critical || o.correct, `${s.id}.${o.id} critical only when correct`);
        if (o.next && o.next !== "end") assert.ok(ids.has(o.next), `${s.id}.${o.id} next`);
      }
    }
  });

  test(`${id}: ideal path has three critical steps, scores 100 and ends cleanly`, () => {
    const path = core.idealPath(data);
    const critical = path.filter((sid) => data.stages.find((s) => s.id === sid).options.find((o) => o.correct).critical);
    assert.equal(critical.length, 3, critical.join(","));
    assert.equal(core.score(data, core.idealAttempt(data)).pct, 100);
  });

  test(`${id}: lesson links to the drill, the model is listed, in sync, and mapped to its competency`, () => {
    const l = JSON.parse(read(`tokos/learn/lessons/${lesson}.json`));
    assert.equal(l.test.sim, id);
    const index = JSON.parse(read("tokos/learn/index.json"));
    assert.equal(index.lessons[lesson].test.sim, id, "index.json carries the sim link");
    const models = JSON.parse(read("tokos/models.json")).models;
    assert.ok(models.includes("drill-" + id));
    assert.equal(read(`tokos-models/drill-${id}.js`), render(data), "run node tools/tokos-build-drills.mjs");
    const map = JSON.parse(read("tokos/learn/competency-map.json")).map;
    assert.ok(map[COMPETENCY[id]].items.includes("drill:" + id), `${COMPETENCY[id]} lists drill:${id}`);
  });
}
