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

test("dermatology routes across its modules", () => {
  assert.equal(mapModuleId("dermatology", "t", "psoriasis plaque Auspitz sign"), "der-psoriasis");
  assert.equal(mapModuleId("dermatology", "t", "tinea corporis annular ringworm"), "der-fungal");
  assert.equal(mapModuleId("dermatology", "t", "herpes zoster dermatomal vesicles"), "der-viral-parasitic");
  assert.equal(mapModuleId("dermatology", "t", "secondary syphilis rash palms soles"), "der-sti");
  assert.equal(mapModuleId("dermatology", "t", "melanoma skin lesion"), "der-skin-malignancy");
  assert.equal(mapModuleId("dermatology", "t", "vitiligo depigmentation"), "der-pigmentary");
  assert.equal(mapModuleId("dermatology", "t", "something unrecognised xyz"), "der-structure-lesions");
});

test("microbiology routes across its modules", () => {
  assert.equal(mapModuleId("microbiology", "t", "Gram stain staphylococcus clusters"), "mic-staphylococcus");
  assert.equal(mapModuleId("microbiology", "t", "Ziehl-Neelsen acid-fast bacilli"), "mic-tuberculosis");
  assert.equal(mapModuleId("microbiology", "t", "Ascaris fertilized egg stool"), "mic-nematodes");
  assert.equal(mapModuleId("microbiology", "t", "Plasmodium vivax ring forms"), "mic-blood-tissue-protozoa");
  assert.equal(mapModuleId("microbiology", "t", "blood agar beta hemolysis"), "mic-culture-identification");
  assert.equal(mapModuleId("microbiology", "t", "Tzanck smear multinucleated giant cells"), "mic-herpesviruses");
  assert.equal(mapModuleId("microbiology", "e-coli-emb-metallic-sheen", "E. coli culture metallic sheen"), "mic-enterobacteriaceae");
  assert.equal(mapModuleId("microbiology", "gram-stain-e-coli", "E choli Gram"), "mic-enterobacteriaceae");
  assert.equal(mapModuleId("microbiology", "oral-candidiasis-thrush", "tongue thrush"), "mic-systemic-opportunistic-mycoses");
  assert.equal(mapModuleId("microbiology", "gram-stain-diphtheroid-rods", "Diphtheroid"), "mic-gram-positive-bacilli");
  assert.equal(mapModuleId("microbiology", "alpha-beta-hemolytic-streptococci-blood-agar", "streptococci"), "mic-streptococcus");
  assert.equal(mapModuleId("microbiology", "hpv-lsil-pap-smear-thinprep", "ThinPrep Pap smear HPV"), "mic-other-dna-viruses");
});

test("dermatology common names route past the default", () => {
  assert.equal(mapModuleId("dermatology", "seborrheic-dermatitis-infantile-cradle-cap", "Cradle cap"), "der-eczema");
  assert.equal(mapModuleId("dermatology", "tinea-pedis-vesicular", "Tinea pedis"), "der-fungal");
  assert.equal(mapModuleId("dermatology", "tinea-versicolor-malassezia-sem", "Malassezia spores"), "der-fungal");
  assert.equal(mapModuleId("dermatology", "cellulitis-leg", "Cellulitis of leg"), "der-bacterial");
  assert.equal(mapModuleId("dermatology", "verruca-vulgaris-toe", "Verruca vulgaris"), "der-viral-parasitic");
  assert.equal(mapModuleId("dermatology", "rhinopyma", "Rhinopyma"), "der-acne-rosacea");
});

test("orthopaedics routes across its modules", () => {
  assert.equal(mapModuleId("orthopaedics", "t", "Colles fracture dinner fork"), "ort-forearm-wrist-injuries");
  assert.equal(mapModuleId("orthopaedics", "t", "Pott spine paradiscal lesion"), "ort-tb-spine");
  assert.equal(mapModuleId("orthopaedics", "t", "osteosarcoma Codman triangle sunburst"), "ort-malignant-bone-tumours");
  assert.equal(mapModuleId("orthopaedics", "t", "rickets cupping fraying wrist"), "ort-metabolic-bone");
  assert.equal(mapModuleId("orthopaedics", "t", "ankylosing spondylitis bamboo spine"), "ort-arthritis");
  assert.equal(mapModuleId("orthopaedics", "t", "clubfoot CTEV Ponseti"), "ort-ctev");
  assert.equal(mapModuleId("orthopaedics", "ischial-apophysis-avulsion", "Apophysenloesung Sitzbein"), "ort-pelvis-acetabulum");
});
