/* mapModuleId routing for image MCQs (tools/prep-imgqgen.mjs): blood films land in
 * haematology modules, extragonadal teratomas do not land in pat-ovary, and the
 * anatomy/surgery tables spread beyond the old single defaults.
 *
 * node --test test/prep-imgqgen.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapModuleId } from "../tools/prep-imgqgen.mjs";

test("pathology blood films route to haematology modules", () => {
  assert.equal(mapModuleId("pathology", "t", "peripheral blood smear spherocytosis"), "pat-haemolytic-hereditary");
  assert.equal(mapModuleId("pathology", "t", "blood smear smudge cells CLL"), "pat-non-hodgkin-lymphoma");
  assert.equal(mapModuleId("pathology", "t", "blood smear Auer rods acute myeloid"), "pat-acute-leukaemias");
  assert.equal(mapModuleId("pathology", "t", "bone marrow aspirate aplastic"), "pat-haematopoiesis-marrow-failure");
  assert.equal(mapModuleId("pathology", "t", "macro-ovalocytes hypersegmented neutrophils"), "pat-megaloblastic");
});

test("extragonadal teratomas do not land in pat-ovary", () => {
  assert.equal(mapModuleId("pathology", "Mature teratoma mediastinum", ""), "pat-tumour-diagnosis");
  assert.equal(mapModuleId("pathology", "Mature cystic teratoma of ovary", ""), "pat-ovary");
});

test("cytology and gross specimens route sensibly", () => {
  assert.equal(mapModuleId("pathology", "t", "thyroid FNAC cytology"), "pat-thyroid-parathyroid");
  assert.equal(mapModuleId("pathology", "t", "Pap smear koilocytes"), "pat-cervix-uterus");
  assert.equal(mapModuleId("pathology", "t", "pleural fluid cytology malignant"), "pat-tumour-diagnosis");
  assert.equal(mapModuleId("pathology", "t", "X-ray osteosarcoma sunburst"), "pat-bone");
});

test("anatomy and surgery spread beyond the old defaults", () => {
  assert.equal(mapModuleId("anatomy", "t", "cerebellar Purkinje layer"), "ana-cerebellum");
  assert.equal(mapModuleId("anatomy", "t", "placental villi histology"), "ana-implantation-placenta");
  assert.equal(mapModuleId("surgery", "t", "laparoscopic trocar pneumoperitoneum"), "sur-mis");
  assert.equal(mapModuleId("surgery", "t", "laparoscopic cholecystectomy"), "sur-gallbladder");
  assert.equal(mapModuleId("surgery", "t", "pilonidal sinus excision"), "sur-anorectal");
});

test("explicit module and cardiology overrides win", () => {
  assert.equal(mapModuleId("pathology", "t", "blood smear", { module: "pat-x" }), "pat-x");
  assert.equal(mapModuleId("ss-cardiology", "t", "ecg"), "sca-ecg");
});
