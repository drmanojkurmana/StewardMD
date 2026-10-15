/**
 * test/cancer-protocols-map.test.mjs
 *
 * Unit tests for the Cancer Knowledge Library <-> Oncology Protocols bidirectional map:
 * - 304 protocols in kb/protocols mapped to KB cancer articles
 * - 0 unmapped protocols
 * - Cervical cancer mapped to 7 protocols across 4 settings
 * - Bidirectional lookup: get(), getProtocols(), getReverse()
 * - Regimen one-liner formatting
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadAllData,
  buildCancerProtocolMap,
  formatRegimen,
  deriveSetting
} from "../tools/build-cancer-protocol-map.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const mapClient = await import("../cancer-protocols-map.js").then((m) => m.default || m);

test("cancer-protocols-map: maps all 304 oncology protocols with 0 unmapped", () => {
  const result = buildCancerProtocolMap(loadAllData(ROOT));
  assert.equal(result.totalProtocolsInKb, 304, "all 304 protocols loaded from kb/protocols");
  assert.equal(result.unmappedProtocols.length, 0, "every protocol maps to at least one cancer KB article");
  assert.ok(result.articlesWithProtocolsCount >= 70, "at least 70 cancer articles have protocols");
});

test("cancer-protocols-map: cervical cancer article maps to 7 protocols across 4 settings", () => {
  const cerv = mapClient.get("cervical_cancer");
  assert.ok(cerv, "cervical_cancer exists in map");
  assert.equal(cerv.articleId, "cervical_cancer");
  assert.equal(cerv.articleTitle, "Cervical Cancer");
  assert.equal(cerv.totalProtocols, 7, "exactly 7 protocols for cervical cancer");

  const settings = cerv.settings;
  assert.ok(settings.includes("Concurrent Chemoradiation"), "has Concurrent Chemoradiation setting");
  assert.ok(settings.includes("Adjuvant"), "has Adjuvant setting");
  assert.ok(settings.includes("Recurrent / Metastatic"), "has Recurrent / Metastatic setting");
  assert.ok(settings.includes("Neuroendocrine / Small Cell"), "has Neuroendocrine / Small Cell setting");

  const pids = cerv.protocols.map((p) => p.id);
  assert.ok(pids.includes("cervical-cisplatin-weekly"), "includes weekly cisplatin radiosensitizer");
  assert.ok(pids.includes("cervical-pembrolizumab"), "includes pembrolizumab");
  assert.ok(pids.includes("gyn-carbo-paclitaxel-bev"), "includes carboplatin + paclitaxel + bevacizumab");
  assert.ok(pids.includes("gyn-carbo-paclitaxel"), "includes carboplatin + paclitaxel q3w");
  assert.ok(pids.includes("cervical-tisotumab-vedotin"), "includes tisotumab vedotin");
  assert.ok(pids.includes("sclc-topotecan"), "includes topotecan");
  assert.ok(pids.includes("sclc-platinum-etoposide"), "includes platinum + etoposide");

  // Regimen formatting check
  const weeklyCis = cerv.protocols.find((p) => p.id === "cervical-cisplatin-weekly");
  assert.ok(weeklyCis.regimen.includes("Cisplatin 40 mg/m2 IV D1"), "regimen one-liner formatted correctly");
});

test("cancer-protocols-map: client API methods get, getProtocols, getReverse, isCancer", () => {
  assert.equal(mapClient.isCancer("cervical_cancer"), true);
  assert.equal(mapClient.isCancer("non_existent_disease"), false);

  const protos = mapClient.getProtocols("cervical_cancer");
  assert.equal(protos.length, 7);

  // Reverse lookup: cervical-cisplatin-weekly should point back to cervical_cancer
  const rev = mapClient.getReverse("cervical-cisplatin-weekly");
  assert.ok(rev.some((x) => x.id === "cervical_cancer"), "reverse lookup points back to cervical cancer");

  // Non-existent lookups
  assert.equal(mapClient.get(""), null);
  assert.deepEqual(mapClient.getProtocols("not_a_disease"), []);
  assert.deepEqual(mapClient.getReverse("not_a_protocol"), []);
});

test("cancer-protocols-map: regimen formatter formats doses, routes, cycle length", () => {
  const p = {
    drugs: [
      { name: "Cisplatin", dosePerUnit: 40, unit: "mg/m2", route: "IV", days: [1] }
    ],
    cycleLengthDays: 7,
    cycles: 6
  };
  const reg = formatRegimen(p);
  assert.equal(reg, "Cisplatin 40 mg/m2 IV D1 (q7d x 6)");
});
