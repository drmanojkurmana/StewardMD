import { test } from "node:test";
import assert from "node:assert/strict";
import { versionSummaries, personName } from "../functions/_wardsynq/record-detail.js";

const v = (version, recordedAt, fields = {}, by = "dr.a@x.test", effectiveAt) => ({
  resourceType: "MedicationOrder", id: "mo1", version,
  writtenBy: { id: by },
  meta: { recordedAt, effectiveAt: effectiveAt || recordedAt },
  ...fields,
});

test("versions come back oldest first, with who wrote each and when", () => {
  const out = versionSummaries([
    v(1, "2026-09-10T09:00:00.000Z", { drug: "Amoxicillin" }),
    v(2, "2026-09-10T11:00:00.000Z", { drug: "Amoxicillin", dose: { value: 1, unit: "g" } }, "dr.b@x.test"),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].version, 1);
  assert.equal(out[0].byName, "dr.a");
  assert.equal(out[1].byName, "dr.b");
  assert.equal(out[1].current, true);
  assert.equal(out[0].current, undefined, "only the last version is current");
});

test("what changed between versions is named, and noise is left out", () => {
  const out = versionSummaries([
    v(1, "2026-09-10T09:00:00.000Z", { drug: "Amoxicillin", route: "oral" }),
    v(2, "2026-09-10T11:00:00.000Z", { drug: "Amoxicillin", route: "iv" }),
  ]);
  assert.deepEqual(out[1].changed, ["route"]);
  // meta, version and writtenBy differ on every version and would drown the real answer.
  assert.ok(!out[1].changed.includes("meta"));
  assert.ok(!out[1].changed.includes("version"));
  assert.ok(!out[1].changed.includes("writtenBy"));
});

test("the first version has nothing to compare against, so nothing is claimed to have changed", () => {
  const out = versionSummaries([v(1, "2026-09-10T09:00:00.000Z", { drug: "A" })]);
  assert.equal(out[0].changed, undefined);
  assert.equal(out[0].current, true);
});

test("an opaque account is not given an invented name", () => {
  assert.equal(personName("fb:DcGIzIXwxURU0G9L4J5jehluENl1"), "a clinician account");
  assert.equal(personName("dr.mehta@hospital.test"), "dr.mehta");
  assert.equal(personName(""), "");
});

test("who acted on whose behalf survives, because an AI draft is not authored by the clinician", () => {
  const out = versionSummaries([{
    resourceType: "ClinicalNote", id: "n1", version: 1,
    writtenBy: { id: "ai:maik", onBehalfOf: "dr.a@x.test" },
    meta: { recordedAt: "2026-09-10T09:00:00.000Z", effectiveAt: "2026-09-10T09:00:00.000Z" },
  }]);
  assert.equal(out[0].by, "ai:maik");
  assert.equal(out[0].onBehalfOf, "dr.a@x.test");
});

test("a correction is marked as corrected rather than quietly replacing what came before", () => {
  const out = versionSummaries([
    v(1, "2026-09-10T09:00:00.000Z", { drug: "Amoxicillin" }),
    { ...v(2, "2026-09-10T11:00:00.000Z", { drug: "Co-amoxiclav" }), meta: { recordedAt: "2026-09-10T11:00:00.000Z", effectiveAt: "2026-09-10T11:00:00.000Z", amendedAt: "2026-09-10T11:00:00.000Z" } },
  ]);
  assert.equal(out[1].amendedAt, "2026-09-10T11:00:00.000Z");
  // And the version it corrected is still there to read.
  assert.equal(out[0].version, 1);
  assert.equal(out.length, 2);
});

test("where a record came from is carried, so an outside feed is not read as ours", () => {
  const out = versionSummaries([{
    resourceType: "Observation", id: "o1", version: 1,
    writtenBy: { id: "svc:feed" },
    meta: { recordedAt: "2026-09-10T09:00:00.000Z", effectiveAt: "2026-09-10T09:00:00.000Z", source: { system: "lab-genhosp" } },
  }]);
  assert.equal(out[0].source, "lab-genhosp");
});

test("an empty history produces nothing rather than throwing", () => {
  assert.deepEqual(versionSummaries([]), []);
  assert.deepEqual(versionSummaries(null), []);
});
