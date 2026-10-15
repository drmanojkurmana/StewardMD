/**
 * test/prep-links-onco.test.mjs
 *
 * Tests the connection between Cancer KB articles, Oncology Protocols, and MCQs:
 * 1. Stamping an MCQ with an evidenced cancer article carries protocol_ids
 * 2. An MCQ with a non-cancer concept does NOT get oncology protocol_ids
 * 3. Module fallback cancer topic does NOT add protocol_ids (owner's no wrong links rule)
 * 4. prep-reason.js renders the "Protocols" row: "See protocols (N)"
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stampLinks, oncoEvKbId } from "../tools/prep-links.mjs";
import mapClient from "../cancer-protocols-map.js";
import prepReason from "../prep-reason.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("prep-links-onco: stampLinks carries oncology protocol_ids for evidenced cancer question", () => {
  const items = [
    {
      id: "q_cervix_1",
      q: "A 45-year-old woman is diagnosed with locally advanced cervical carcinoma (FIGO stage IIB). What is the standard treatment?",
      o: [
        "Concurrent chemoradiation with weekly cisplatin",
        "Neoadjuvant chemotherapy followed by radical hysterectomy",
        "Radiation therapy alone",
        "Simple hysterectomy"
      ],
      a: 0,
      exp: "Concurrent chemoradiation (CCRT) with weekly cisplatin is the standard of care for locally advanced cervical carcinoma."
    }
  ];

  stampLinks(items, { sid: "obstetrics-gynaecology", mid: "obg-cervical-cancer" });
  assert.ok(items[0].x && items[0].x.links, "item is stamped with links");

  const links = items[0].x.links;
  assert.ok(links.kb_ids && links.kb_ids.includes("cervical_cancer"), "cervical_cancer is stamped in kb_ids");
  assert.ok(links.protocol_ids && links.protocol_ids.length > 0, "oncology protocol_ids are carried");

  // Should contain cervical protocols like cervical-cisplatin-weekly
  assert.ok(links.protocol_ids.includes("cervical-cisplatin-weekly"), "carries cervical-cisplatin-weekly protocol ID");
  assert.ok(links.protocol_ids.includes("cervical-pembrolizumab"), "carries cervical-pembrolizumab protocol ID");
});

test("prep-links-onco: non-cancer question does NOT carry oncology protocol_ids", () => {
  const items = [
    {
      id: "q_cardiac_1",
      q: "A 55-year-old man presents with acute chest pain and ST-segment elevation. What is the immediate intervention?",
      o: [
        "Primary percutaneous coronary intervention",
        "Beta blockers",
        "Observation",
        "Thrombolysis"
      ],
      a: 0,
      exp: "Primary PCI is the treatment of choice for STEMI."
    }
  ];

  stampLinks(items, { sid: "medicine", mid: "med-acs" });
  const links = (items[0].x && items[0].x.links) || {};
  // None of the cancer protocols should be present
  const oncoProtos = mapClient.getProtocols("cervical_cancer").map((p) => p.id);
  const foundOnco = (links.protocol_ids || []).filter((id) => oncoProtos.includes(id));
  assert.equal(foundOnco.length, 0, "non-cancer question carries 0 oncology protocols");
});

test("prep-links-onco: distractor-only cancer mention does NOT attach oncology protocols", () => {
  // Real case: CIDP item (ss-neurology) where "amyloid" appears only in a wrong
  // option and the reasons. The index promotes it to a kt/ev=1 chapter row, but
  // chemotherapy regimens must not ride along (owner: no wrong links).
  const it = {
    id: "q_c5f0be10723d",
    q: "A biopsy specimen is taken from a patient with a chronic progressive neuropathy showing classic demyelinating features. Which histologic finding is most characteristic of CIDP?",
    o: [
      "Onion bulb formation",
      "Endoneurial amyloid deposits",
      "Axonal spheroids",
      "Vasculitic nerve infarction"
    ],
    a: 0,
    exp: "Onion bulbs, composed of concentrically arranged Schwann cells around thinly myelinated fibers, are classic findings."
  };
  const links = [{ k: "kb", id: "amyloidosis", title: "Amyloidosis", c: 75, v: "kt", ev: 1 }];
  const modKbIds = ["immune_mediated_necrotising_myopathy"];
  assert.equal(oncoEvKbId(links, it, modKbIds), null, "distractor-only kt cancer yields no protocol article");
});

test("prep-links-onco: module-topic cancer DOES attach oncology protocols", () => {
  // MPN-module item evidenced to the module's own mapped topic keeps protocols.
  const it = {
    id: "q_mpn_1",
    q: "Myelofibrosis leading to a dry tap on bone marrow aspiration is seen with which condition?",
    o: ["Myeloproliferative neoplasm", "Iron deficiency", "Aplastic anemia", "Thalassemia"],
    a: 0,
    exp: "Dry tap suggests marrow fibrosis in myeloproliferative disease."
  };
  const links = [{ k: "kb", id: "polycythemia_vera_and_other_myeloprolifera", title: "Polycythemia Vera and Other Myeloproliferative Neoplasms", c: 75, v: "kt", ev: 1 }];
  const modKbIds = ["polycythemia_vera_and_other_myeloprolifera"];
  assert.equal(oncoEvKbId(links, it, modKbIds), "polycythemia_vera_and_other_myeloprolifera", "module-topic kt cancer yields its article");
});

test("prep-links-onco: specific-tier evidence attaches even outside the module topic", () => {
  // srcPack-verified lung item in its NSCLC module: specific tier always counts.
  const it = {
    id: "q_lung_1",
    q: "A 62-year-old heavy smoker presents with persistent cough and a normal chest radiograph. What is the next step?",
    o: ["CT chest", "Bronchoscopy", "Observation", "Antibiotics"],
    a: 0,
    exp: "CT in high-risk patients with persistent symptoms."
  };
  const links = [{ k: "kb", id: "lung_cancer", title: "Lung Cancer", c: 95, v: "sp" }];
  assert.equal(oncoEvKbId(links, it, ["something_else"]), "lung_cancer", "specific-tier kb yields its article");
});

test("prep-links-onco: topic-tier cancer named in stem or key DOES attach", () => {
  const it = {
    id: "q_cervix_2",
    q: "A 45-year-old woman is diagnosed with locally advanced cervical carcinoma (FIGO stage IIB). What is the standard treatment?",
    o: ["Concurrent chemoradiation", "Surgery", "Radiation alone", "Observation"],
    a: 0,
    exp: "CCRT is standard."
  };
  const links = [{ k: "kb", id: "cervical_cancer", title: "Cervical Cancer", c: 75, v: "kt", ev: 1 }];
  assert.equal(oncoEvKbId(links, it, ["unrelated_module_topic"]), "cervical_cancer", "stem-named kt cancer yields its article");
});

test("prep-links-onco: prep-reason kmTargets generates cp target for evidenced cancer MCQ", () => {
  const links = [
    { k: "kb", id: "cervical_cancer", title: "Cervical Cancer", c: 95, v: "q" },
    { k: "ls", id: "obg-cervical-cancer", title: "Cervical Cancer Management", c: 75, v: "lt" }
  ];

  const km = prepReason.kmTargets({
    links: links,
    okLessons: [{ key: "obg-cervical-cancer", title: "Cervical Cancer Management" }],
    lesson: null,
    cards: false,
    itemCards: false,
    sid: "obstetrics-gynaecology",
    mid: "obg-cervical-cancer",
    mt: "Cervical cancer"
  });

  assert.ok(km.cancerProtocols, "cancerProtocols metadata is populated");
  assert.equal(km.cancerProtocols.articleId, "cervical_cancer");
  assert.equal(km.cancerProtocols.totalProtocols, 7);

  const cpTarget = km.allTargets.find((t) => t.k === "cp");
  assert.ok(cpTarget, "allTargets includes cp target");
  assert.equal(cpTarget.id, "cervical_cancer");
  assert.equal(cpTarget.title, "See protocols (7)");
  assert.equal(cpTarget.act, "r-cancer-protocols");
});

test("prep-links-onco: prep-reason knowMoreHtml renders the Protocols row after KB/lesson links", () => {
  const cancerProto = mapClient.get("cervical_cancer");
  const tg = [
    { k: "kb", id: "cervical_cancer", title: "Cervical Cancer", act: "r-kb", attrs: ' data-id="cervical_cancer"' },
    { k: "ls", id: "obg-cervical-cancer", title: "Cervical Cancer Lesson", act: "l-open", attrs: ' data-l="obg-cervical-cancer"' }
  ];

  const html = prepReason.knowMoreHtml({
    targets: tg,
    allTargets: tg.concat([{ k: "cp", id: "cervical_cancer", title: "See protocols (7)", act: "r-cancer-protocols" }]),
    cancerProtocols: cancerProto,
    iid: "q_cervix_test"
  });

  assert.ok(html.includes("Know more"), "contains Know more header");
  assert.ok(html.includes("pn-km-duo"), "contains KB and Lesson duo row");
  assert.ok(html.includes("pn-km-proto-row"), "contains dedicated protocols row");
  assert.ok(html.includes("See protocols (7)"), "displays 'See protocols (7)' button");
  assert.ok(html.includes('data-act="r-cancer-protocols"'), "button has data-act='r-cancer-protocols'");
  assert.ok(html.includes('data-cancer="cervical_cancer"'), "button has data-cancer='cervical_cancer'");

  // Position: protocol row should come after pn-km-duo
  const duoIdx = html.indexOf("pn-km-duo");
  const protoIdx = html.indexOf("pn-km-proto-row");
  assert.ok(protoIdx > duoIdx, "Protocols row sits after the KB/lesson links");
});
