/* test/kardia-protocols.test.mjs - Kardia WP10 POCUS protocol data
 * (kardia/practice/protocols.json): schema, sources, views and the
 * pulse check pause limit. Uses the validator exported by
 * kardia-practice.js so the app and the test share one schema. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const PR = require("../kardia-practice.js");
const data = JSON.parse(readFileSync(new URL("../kardia/practice/protocols.json", import.meta.url), "utf8"));
const views = JSON.parse(readFileSync(new URL("../kardia/views.json", import.meta.url), "utf8"));
const viewIds = new Set(views.views.map((v) => v.id));

test("protocols file: ai_drafted, British spelling, no em or en dashes", () => {
  assert.equal(data.review.status, "ai_drafted");
  const raw = readFileSync(new URL("../kardia/practice/protocols.json", import.meta.url), "utf8");
  assert.ok(!/[–—]/.test(raw), "no em or en dashes");
});

test("all six protocols are present with valid schema", () => {
  const ids = data.protocols.map((p) => p.id);
  assert.deepEqual(ids, ["fast", "efast", "rush", "blue", "ivc", "pulse_check"]);
  for (const p of data.protocols) {
    assert.deepEqual(PR.validateProtocol(p), [], p.id + " validates");
    assert.ok(p.timeLimitSec > 0, p.id + " is timed");
    assert.ok(p.level && p.level.length, p.id + " names its levels");
  }
});

test("every protocol step view exists in the views catalogue", () => {
  for (const p of data.protocols) {
    for (const s of p.steps) {
      assert.ok(viewIds.has(s.view), p.id + " step view " + s.view + " exists in views.json");
    }
  }
});

test("pulse check protocol carries the 10 second pause limit and sources", () => {
  const pulse = data.protocols.find((p) => p.id === "pulse_check");
  assert.equal(pulse.pauseLimitSec, 10);
  const src = pulse.sources.join(" ");
  assert.match(src, /ERC|AHA/);
  assert.match(src, /ACEP/);
  assert.equal(pulse.links.codeBlue, true, "pulse check offers the Code Blue link");
});

test("FAST and eFAST run their windows in fixed order", () => {
  const fast = data.protocols.find((p) => p.id === "fast");
  assert.deepEqual(fast.steps.map((s) => s.view),
    ["pocus_fast_ruq", "pocus_fast_luq", "pocus_fast_pelvis", "pocus_fast_subxiphoid"]);
  const efast = data.protocols.find((p) => p.id === "efast");
  assert.equal(efast.steps[0].view, "pocus_efast_lung_right", "lungs first in chest trauma");
  assert.equal(efast.steps[1].view, "pocus_efast_lung_left");
});

test("validator rejects broken protocols", () => {
  assert.ok(PR.validateProtocol(null).length > 0);
  assert.ok(PR.validateProtocol({ id: "x" }).length > 0);
  const bad = JSON.parse(JSON.stringify(data.protocols[0]));
  bad.steps[0].decision.answer = 99;
  assert.ok(PR.validateProtocol(bad).some((e) => /answer/.test(e)));
});
