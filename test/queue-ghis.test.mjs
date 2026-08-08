// test/queue-ghis.test.mjs — pure GHIS roster mapping + dedup (import adapter).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapGhisRow, filterNew, staleImportedIds } from "../functions/_queue_ghis.js";

test("maps GHIS roster fields to a ticket body", () => {
  const m = mapGhisRow({ patientFirstName: "Sarah", patientLastName: "J", patientId: "MR10234", episodeId: "EP99", deptDescription: "Cardiology", employeeFirstName: "Dr Rao", queueStatus: "Waiting" });
  assert.equal(m.name, "Sarah J");
  assert.equal(m.mrn, "MR10234");
  assert.equal(m.ghisEpisodeId, "EP99");
  assert.equal(m.visitType, "new");
  assert.equal(m.priority, 0);
  assert.equal(m.mobile, "");          // roster omits mobile (lazy demographics)
});

test("infers follow-up visit type", () => {
  assert.equal(mapGhisRow({ patientFirstName: "A", episodeId: "1", visitType: "Follow-up" }).visitType, "followup");
  assert.equal(mapGhisRow({ patientFirstName: "A", episodeId: "1", visitType: "New" }).visitType, "new");
});

test("filterNew dedupes vs already-imported episodes AND within the batch, drops empties", () => {
  const rows = [
    { patientFirstName: "Sarah", episodeId: "EP1" },   // already imported -> skip
    { patientFirstName: "Mike", episodeId: "EP2" },    // new
    { patientFirstName: "Mike", episodeId: "EP2" },    // dup within batch -> skip
    { patientFirstName: "", episodeId: "EP3" }         // empty name -> skip
  ];
  const fresh = filterNew(rows, ["EP1"]);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].ghisEpisodeId, "EP2");
});

test("staleImportedIds cancels only still-waiting imports that left the EMR list", () => {
  const existing = [
    { id: "t1", ghisEpisodeId: "EP1", status: "registered" },  // still on the list -> keep
    { id: "t2", ghisEpisodeId: "EP2", status: "registered" },  // dropped off the list -> cancel
    { id: "t3", ghisEpisodeId: "EP3", status: "in_consultation" }, // doctor-touched -> keep
    { id: "t4", ghisEpisodeId: "EP4", status: "called" },      // doctor-touched -> keep
    { id: "t5", ghisEpisodeId: "", status: "registered" }      // manual (no episode) -> keep
  ];
  assert.deepEqual(staleImportedIds(existing, ["EP1"]), ["t2"]);
  // An empty batch (failed/empty fetch) must NEVER clear the queue.
  assert.deepEqual(staleImportedIds(existing, []), []);
  // All present -> nothing cancelled.
  assert.deepEqual(staleImportedIds(existing, ["EP1", "EP2"]), []);
});
