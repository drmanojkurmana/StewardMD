/* scripts/wardsynq-cutover-check.mjs — the pre-flight before anybody flips the flag.
 *
 * `smd_wardsynq_cutover` puts a real adapter on the live ward path of a mobile app clinicians are
 * using. Before a site enables it, somebody should be able to run the adapter over representative
 * bundles OFF the ward and read what it did, rather than discovering the answer during a round.
 * That is this.
 *
 * It runs the identical code path the flag enables: the same installLiveGhis, the same governed
 * store, the same actor. What it does not do is touch a real chart, because the host it installs
 * onto is a stand-in whose ingestFromWard returns what the real one returns and writes nothing.
 *
 *   node scripts/wardsynq-cutover-check.mjs
 *   node scripts/wardsynq-cutover-check.mjs --json
 *
 * Exit code is 1 if the adapter errored or failed to write, so this can gate a release. It is
 * deliberately 0 on ISSUES and DIVERGENCES: an unmapped lab name and a differing row count are
 * things to read, not things to block on, and a gate that fires on them is a gate somebody disables.
 */

import { installLiveGhis } from "../wardsynq/wardsynq-ghis-live.js";
import { GovernedStore, makeActor, KIND, TIER } from "../wardsynq/wardsynq-actors.js";
import { ClinicalStore, MemoryBackend } from "../wardsynq/wardsynq-store.js";
import { ClinicalEventBus } from "../wardsynq/wardsynq-events.js";

/* The flag, ON. This is what ?wardsynq_cutover=1 resolves to in the browser; here it is supplied
   directly so the check does not depend on a DOM. */
const flags = { get: (key) => key === "smd_wardsynq_cutover" };

/**
 * Bundles shaped like the real GHIS payload, including all three documented traps.
 *
 * These are the shapes the adapter's own tests pin, reproduced here so the pre-flight exercises the
 * things that actually go wrong rather than a clean happy path nobody ever receives.
 */
const BUNDLES = [
  {
    label: "a routine ward round",
    bundle: {
      patientId: "GH-40118",              // trap 3: this IS the MRN. There is no separate UHID.
      episodeId: "EP-9912",
      ts: "2026-09-05T08:00:00.000Z",
      patientFirstName: "Anjali", employeeFirstName: "Dr Rao",
      dob: "67",                          // trap 1: an AGE in years, as a string. Not a date.
      gender: "F", bedName: "MICU 04", deptDescription: "Medical ICU",
      labs: [
        { test: "Potassium", result: "5.4", units: "mmol/L", date: "05/09/2026", low: "3.5", high: "5.1" },
        { test: "Creatinine", result: "1.42", units: "mg/dL", date: "05/09/2026", low: "0.6", high: "1.1" },
        { test: "Haemoglobin", result: "10.8", units: "g/dL", date: "05/09/2026" },
      ],
    },
  },
  {
    label: "the same bundle redelivered after a reconnect",
    bundle: null,   // filled in below with the identical object
  },
  {
    label: "a bundle carrying a lab this build has no code for",
    bundle: {
      patientId: "GH-40118", episodeId: "EP-9912", ts: "2026-09-05T12:00:00.000Z",
      patientFirstName: "Anjali", dob: "67", gender: "F", bedName: "MICU 04",
      labs: [
        { test: "Potassium", result: "5.1", units: "mmol/L", date: "05/09/2026" },
        { test: "Procalcitonin", result: "2.9", units: "ng/mL", date: "05/09/2026" },
      ],
    },
  },
  {
    label: "a bundle with a malformed row and an unparseable date",
    bundle: {
      patientId: "GH-40119", episodeId: "EP-9913", ts: "2026-09-05T13:00:00.000Z",
      patientFirstName: "Ravi", dob: "54", gender: "M", bedName: "Ward 3A",
      labs: [
        { test: "", result: "9", units: "mmol/L" },                              // no test name
        { test: "Sodium", result: "not done", units: "mmol/L", date: "yesterday" }, // no value, no date
        { test: "Sodium", result: "138", units: "mmol/L", date: "05/09/2026" },
      ],
    },
  },
  {
    label: "a bundle that is nonsense, to prove the ward round survives it",
    bundle: { patientId: null, labs: "not an array" },
  },
];
BUNDLES[1].bundle = BUNDLES[0].bundle;   // literally the same object: a reconnect, not a copy

/** A stand-in for window.ICU. Returns what the real ingestFromWard returns; writes nothing. */
function makeHost(legacyApplied) {
  return {
    ingestFromWard(bundle) {
      // The real function returns an `applied` map keyed by ICU field, plus conflicts. Reproduced
      // only closely enough for the divergence check to have something to compare against.
      const applied = {};
      for (const row of Array.isArray(bundle && bundle.labs) ? bundle.labs : []) {
        const v = Number.parseFloat(row.result);
        if (Number.isFinite(v) && legacyApplied.has(String(row.test || "").toLowerCase())) {
          applied[String(row.test).toLowerCase()] = { source: "Ward Sync", ts: bundle.ts };
        }
      }
      return { applied, conflicts: [], source: "Ward Sync" };
    },
  };
}

/* The legacy path only has ICU keys for what it maps. Procalcitonin is not one of them, which is
   what produces a real divergence below rather than a contrived one. */
const LEGACY_KEYS = new Set(["potassium", "creatinine", "haemoglobin", "sodium"]);

async function main() {
  const asJson = process.argv.includes("--json");

  const raw = new ClinicalStore({ backend: new MemoryBackend() });
  const governed = new GovernedStore({ store: raw });
  // The same actor kind the browser path uses. An adapter is capped at DRAFT by the actor model.
  const adapter = makeActor({ id: "ghis-adapter", kind: KIND.ADAPTER, tier: TIER.DRAFT });
  const store = governed.asStoreFor(adapter);

  const bus = new ClinicalEventBus();
  const events = [];
  bus.on("interop.ingested", (e) => events.push(e));

  const host = makeHost(LEGACY_KEYS);
  const live = installLiveGhis({ host, flags, store, bus });

  if (!live.installed) {
    console.error(`could not install: ${live.reason}`);
    process.exit(1);
  }

  const perBundle = [];
  for (const { label, bundle } of BUNDLES) {
    const before = live.report();
    const legacy = host.ingestFromWard(bundle);
    // Let any async store write settle before reading the counters.
    await new Promise((r) => setImmediate(r));
    const after = live.report();
    perBundle.push({
      label,
      legacyApplied: Object.keys(legacy.applied || {}).length,
      written: after.written - before.written,
      duplicatesSkipped: after.skippedDuplicate - before.skippedDuplicate,
      newIssues: after.issues.length - before.issues.length,
      adapterErrors: after.adapterErrors - before.adapterErrors,
    });
  }

  const report = live.report();
  const stored = await raw.all ? await raw.all() : null;

  if (asJson) {
    console.log(JSON.stringify({ report, perBundle, events: events.length }, null, 2));
  } else {
    print(report, perBundle, events, adapter, stored);
  }

  // Errors gate; issues and divergences do not. A gate that fires on an unmapped lab name is a gate
  // somebody switches off, and then it is not a gate.
  process.exit(report.adapterErrors > 0 || report.writeErrors > 0 ? 1 : 0);
}

function print(report, perBundle, events, adapter, stored) {
  const line = (s = "") => console.log(s);

  line("WardSynQ GHIS cut-over pre-flight");
  line("=================================");
  line();
  line(`flag smd_wardsynq_cutover : ON (this run only; the shipped default is OFF)`);
  line(`actor                     : ${adapter.id}, kind ${adapter.kind}, tier ${adapter.tier}`);
  line(`                            an adapter is capped at DRAFT, so this cannot commit a record`);
  line();

  line("Per bundle");
  line("----------");
  for (const b of perBundle) {
    line(`  ${b.label}`);
    line(`      legacy applied ${b.legacyApplied}   canonical written ${b.written}` +
      `${b.duplicatesSkipped ? `   duplicates skipped ${b.duplicatesSkipped}` : ""}` +
      `${b.newIssues ? `   issues ${b.newIssues}` : ""}` +
      `${b.adapterErrors ? `   ADAPTER ERRORS ${b.adapterErrors}` : ""}`);
  }
  line();

  line("Totals");
  line("------");
  line(`  bundles seen       ${report.bundlesSeen}`);
  line(`  observations mapped${String(report.observationsMapped).padStart(3)}`);
  line(`  records written    ${report.written}`);
  line(`  duplicates skipped ${report.skippedDuplicate}`);
  line(`  adapter errors     ${report.adapterErrors}`);
  line(`  write errors       ${report.writeErrors}`);
  line(`  bus events         ${events.length}`);
  line();

  if (report.issues.length) {
    line(`Issues (${report.issues.length}) — read these, they are not failures`);
    line("--------------------------------------------------");
    for (const i of report.issues) line(`  ${i.code}: ${i.message}`);
    line();
  }

  if (report.divergences.length) {
    line(`Divergences (${report.divergences.length})`);
    line("-----------------");
    for (const d of report.divergences) {
      line(`  legacy ${d.legacyRows} rows vs canonical ${d.canonicalRows} rows at ${d.at}`);
    }
    line(`  ${report.divergences[0].note}`);
    line();
  }

  line("Reading");
  line("-------");
  line(`  ${report.reading}`);
  line();
  line(`  ${report.clinicalNote}`);
  line();
  line("To enable on a device: open the app with ?wardsynq_cutover=1, or set");
  line("localStorage smd_wardsynq_cutover = 1. The shipped default stays OFF.");
  line("To stop it mid-round: call halt() on the object installLiveGhis() returned.");
}

main().catch((err) => { console.error(err); process.exit(1); });
