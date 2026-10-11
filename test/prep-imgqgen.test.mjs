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

test("medicine routes chest, neuro and hand images", () => {
  assert.equal(mapModuleId("medicine", "lobar-pneumonia-cxr", "right upper lobe consolidation air bronchogram"), "med-pneumonia");
  assert.equal(mapModuleId("medicine", "cavitary-tb-cxr", "cavitary tuberculosis"), "med-tb");
  assert.equal(mapModuleId("medicine", "pneumothorax-cxr", "pneumothorax pleural line"), "med-pleural");
  assert.equal(mapModuleId("medicine", "cardiomegaly-cxr", "cardiomegaly Kerley B"), "med-heart-failure");
  assert.equal(mapModuleId("medicine", "ards-cxr", "ARDS bilateral white-out"), "med-resp-failure");
  assert.equal(mapModuleId("medicine", "mca-infarct-ct", "stroke infarct MCA territory"), "med-stroke");
  assert.equal(mapModuleId("medicine", "subdural-ct", "subdural hematoma crescent"), "med-ich");
  assert.equal(mapModuleId("medicine", "rheumatoid-hand", "rheumatoid ulnar deviation"), "med-ra");
  assert.equal(mapModuleId("medicine", "gouty-tophus", "gout tophi hand"), "med-crystal");
  assert.equal(mapModuleId("medicine", "osler-nodes", "Osler nodes Janeway lesions"), "med-endocarditis");
  assert.equal(mapModuleId("medicine", "t", "thus the patient improved"), "med-clinical-cardiology");
  assert.equal(mapModuleId("medicine", "lung-abscess-ct", "Pulmonaler Abszess CT"), "med-pneumonia");
  assert.equal(mapModuleId("medicine", "part-solid-lung-nodule-ct", "part solid lung nodule"), "med-lung-cancer");
  assert.equal(mapModuleId("medicine", "subarachnoid-haemorrhage-ct", "subarachnoid haemorrhage"), "med-ich");
  assert.equal(mapModuleId("medicine", "digital-clubbing-ipf", "clubbing IPF"), "med-ild");
  assert.equal(mapModuleId("medicine", "t", "rheumatoid nodule elbow"), "med-ra");
});

test("paediatrics routes neonatal, growth and cardiac images", () => {
  assert.equal(mapModuleId("paediatrics", "rickets-wrist", "cupping fraying wrist"), "ped-micronutrients");
  assert.equal(mapModuleId("paediatrics", "measles-rash", "measles Koplik spots"), "ped-exanthems");
  assert.equal(mapModuleId("paediatrics", "rds-cxr", "respiratory distress ground glass neonate"), "ped-neonatal-respiratory");
  assert.equal(mapModuleId("paediatrics", "double-bubble", "duodenal atresia double bubble"), "ped-gi-disorders");
  assert.equal(mapModuleId("paediatrics", "intussusception-usg", "target sign intussusception"), "ped-gi-disorders");
  assert.equal(mapModuleId("paediatrics", "tof-cxr", "tetralogy boot-shaped"), "ped-congenital-heart");
  assert.equal(mapModuleId("paediatrics", "simian-crease", "Down syndrome simian crease"), "ped-chromosomal");
  assert.equal(mapModuleId("paediatrics", "kwashiorkor", "flaky paint dermatosis"), "ped-malnutrition");
  assert.equal(mapModuleId("paediatrics", "ddh-xray", "developmental dysplasia Barlow"), "ped-newborn-care");
  assert.equal(mapModuleId("paediatrics", "double-bubble-duodenal-atresia-xray", "Double-Bubble"), "ped-gi-disorders");
  assert.equal(mapModuleId("paediatrics", "umbilical-granulation", "Umbilical Granulation"), "ped-newborn-care");
  assert.equal(mapModuleId("paediatrics", "hand-foot-and-mouth-disease-sole", "HFMD sole"), "ped-exanthems");
  assert.equal(mapModuleId("paediatrics", "neonatal-scalp-hematomas-layers", "Scalp hematomas"), "ped-newborn-care");
});

test("obstetrics-gynaecology routes usg and tracing images", () => {
  assert.equal(mapModuleId("obstetrics-gynaecology", "molar-usg", "snowstorm molar pregnancy"), "obg-gtd");
  assert.equal(mapModuleId("obstetrics-gynaecology", "ectopic-usg", "adnexal mass ectopic pregnancy"), "obg-ectopic");
  assert.equal(mapModuleId("obstetrics-gynaecology", "fibroid-usg", "fibroid uterus"), "obg-fibroid");
  assert.equal(mapModuleId("obstetrics-gynaecology", "pcos-usg", "polycystic ovaries string of pearls"), "obg-pcos-hirsutism");
  assert.equal(mapModuleId("obstetrics-gynaecology", "ctg-late", "CTG late decelerations"), "obg-fetal-growth-surveillance");
  assert.equal(mapModuleId("obstetrics-gynaecology", "previa-usg", "placenta previa"), "obg-aph");
  assert.equal(mapModuleId("obstetrics-gynaecology", "twins-usg", "lambda sign twins"), "obg-multiple-pregnancy");
  assert.equal(mapModuleId("obstetrics-gynaecology", "t", "delivery via LSCS"), "obg-operative-obstetrics");
  assert.equal(mapModuleId("obstetrics-gynaecology", "t", "referred via clinic"), "obg-gyn-procedures");
  assert.equal(mapModuleId("obstetrics-gynaecology", "bilateral-ovarian-serous-carcinoma-gross", "ovarian serous carcinoma"), "obg-ovarian-cancer");
  assert.equal(mapModuleId("obstetrics-gynaecology", "ovarian-serous-cystadenoma", "serous cystadenoma"), "obg-benign-ovarian");
});

test("ent routes otoscopy, audiology and endoscopy images", () => {
  assert.equal(mapModuleId("ent", "csom-perforation", "chronic suppurative otitis media central perforation"), "ent-csom");
  assert.equal(mapModuleId("ent", "aom", "acute otitis media bulging tympanic membrane"), "ent-aom-ome");
  assert.equal(mapModuleId("ent", "quinsy", "peritonsillar abscess uvula pushed"), "ent-tonsils-adenoids");
  assert.equal(mapModuleId("ent", "cord-palsy", "vocal cord palsy paramedian"), "ent-vocal-cord-palsy");
  assert.equal(mapModuleId("ent", "polyps", "nasal polyps endoscopy"), "ent-rhinitis-polyps");
});

test("forensic-medicine routes injuries, asphyxia and poisons", () => {
  assert.equal(mapModuleId("forensic-medicine", "stab", "stab wound clean cut margins"), "fmt-mechanical-injuries");
  assert.equal(mapModuleId("forensic-medicine", "hanging", "ligature mark neck hanging furrow"), "fmt-asphyxia");
  assert.equal(mapModuleId("forensic-medicine", "gsw", "gunshot entry wound tattooing"), "fmt-firearm");
  assert.equal(mapModuleId("forensic-medicine", "datura", "datura thornapple plant"), "fmt-plant-animal");
  assert.equal(mapModuleId("forensic-medicine", "lividity", "postmortem hypostasis lividity"), "fmt-early-changes");
});

test("ss-neurology/nephrology/pulmonology route to imaging-led modules", () => {
  assert.equal(mapModuleId("ss-neurology", "mca", "CT head MCA infarct insular ribbon"), "sne-acute-stroke-thrombolysis");
  assert.equal(mapModuleId("ss-neurology", "ms", "MRI Dawson fingers multiple sclerosis"), "sne-multiple-sclerosis");
  assert.equal(mapModuleId("ss-nephrology", "crescents", "crescentic glomerulonephritis RBC casts"), "snp-rpgn-anca-vasculitis");
  assert.equal(mapModuleId("ss-nephrology", "stone", "staghorn calculus KUB"), "snp-nephrolithiasis");
  assert.equal(mapModuleId("ss-pulmonology", "tb", "tree-in-bud tuberculosis CT"), "spu-tb");
  assert.equal(mapModuleId("ss-pulmonology", "effusion", "pleural effusion meniscus CXR"), "spu-pleural");
});

test("ss-gastroenterology/hepatology/endocrinology route to their modules", () => {
  assert.equal(mapModuleId("ss-gastroenterology", "crohn", "cobblestone Crohn colonoscopy aphthae"), "sgi-crohn-disease");
  assert.equal(mapModuleId("ss-gastroenterology", "polyp", "adenoma polyp colonoscopy"), "sgi-colorectal-neoplasia");
  assert.equal(mapModuleId("ss-hepatology", "hcc", "HCC arterial enhancement washout"), "shp-hepatocellular-carcinoma");
  assert.equal(mapModuleId("ss-hepatology", "ascites", "ascitic fluid SAAG cirrhosis"), "shp-ascites-sbp-hrs");
  assert.equal(mapModuleId("ss-endocrinology", "goitre", "multinodular goitre thyroid nodule USG"), "sen-thyroid-nodules-cancer");
  assert.equal(mapModuleId("ss-endocrinology", "cushing", "purple striae Cushing buffalo hump"), "sen-cushing-syndrome");
});

test("ss-haematology/oncology/rheumatology route to their modules", () => {
  assert.equal(mapModuleId("ss-haematology", "sickle", "sickle cells drepanocytes smear"), "shm-hereditary-haemolytic-anaemia");
  assert.equal(mapModuleId("ss-haematology", "auer", "Auer rods AML blasts"), "shm-acute-myeloid-leukaemia");
  assert.equal(mapModuleId("ss-medical-oncology", "melanoma", "melanoma irregular borders BRAF"), "son-melanoma");
  assert.equal(mapModuleId("ss-medical-oncology", "mets", "brain mets MRI rings"), "son-brain-mets");
  assert.equal(mapModuleId("ss-rheumatology-immunology", "gout", "monosodium urate needles gout"), "srh-gout");
  assert.equal(mapModuleId("ss-rheumatology-immunology", "ra", "rheumatoid ulnar drift anti-CCP"), "srh-ra-management");
});

test("ss-infectious-diseases/critical-care/general-medicine route to their modules", () => {
  assert.equal(mapModuleId("ss-infectious-diseases", "eschar", "scrub typhus eschar fever"), "sid-rickettsia");
  assert.equal(mapModuleId("ss-infectious-diseases", "thrush", "candida thrush tongue HIV"), "sid-candida");
  assert.equal(mapModuleId("ss-critical-care", "ards", "ARDS bilateral opacities CXR"), "scc-ards-def");
  assert.equal(mapModuleId("ss-critical-care", "vf", "ventricular fibrillation arrest CPR"), "scc-cardiac-arrest");
  assert.equal(mapModuleId("ss-general-medicine", "afib", "atrial fibrillation ECG irregular"), "sgm-ecg");
  assert.equal(mapModuleId("ss-general-medicine", "pneumonia", "lobar pneumonia consolidation"), "sgm-pneumonia");
});
