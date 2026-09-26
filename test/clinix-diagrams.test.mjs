import test from "node:test";
import assert from "node:assert/strict";
import Diagrams from "../clinix-diagrams.js";

test("diagrams registry exports all expected components", () => {
  assert.ok(Diagrams, "clinix-diagrams module must export API");
  assert.ok(typeof Diagrams.has === "function");
  assert.ok(typeof Diagrams.render === "function");
  assert.ok(typeof Diagrams.soundFor === "function");
  assert.ok(Array.isArray(Diagrams.PRECORDIAL));
  assert.ok(Array.isArray(Diagrams.DERMATOMES));
});

test("every registered diagram renders a valid non-empty SVG", () => {
  const ids = Object.keys(Diagrams.DIAGRAMS);
  assert.ok(ids.length >= 19, `expected at least 19 diagrams, got ${ids.length}`);
  for (const id of ids) {
    assert.ok(Diagrams.has(id), `Diagrams.has('${id}') should be true`);
    const svg = Diagrams.render(id, {});
    assert.ok(typeof svg === "string" && svg.includes("<svg"), `${id} must render an SVG element`);
    assert.ok(svg.includes("</svg>"), `${id} must close the SVG element`);
  }
});

test("diagram.precordium renders precordial auscultation sites and radiation paths", () => {
  const html = Diagrams.render("diagram.precordium", { selected: "mitral" });
  assert.ok(html.includes("cx-dia--precordium"), "must contain precordium class");
  assert.ok(html.includes("Carotid Radiation"), "must show carotid radiation vector");
  assert.ok(html.includes("Axilla (MR)"), "must show axilla radiation vector");
  assert.ok(html.includes("playing: mr_murmur"), "selected mitral zone must show playing: mr_murmur");

  // Verify sound mappings
  assert.equal(Diagrams.soundFor("aortic"), "as_murmur");
  assert.equal(Diagrams.soundFor("mitral"), "mr_murmur");
  assert.equal(Diagrams.soundFor("pulm"), "s1s2_split");
  assert.equal(Diagrams.soundFor("erbs"), "ar_murmur");
  assert.equal(Diagrams.soundFor("tricuspid"), "s1s2_normal");
});

test("diagram.jvp renders all clinical wave modes and ECG rhythm reference", () => {
  const modes = ["normal", "cannon", "absent_a", "giant_v", "friedreich"];
  for (const mode of modes) {
    const html = Diagrams.render("diagram.jvp", { mode });
    assert.ok(html.includes("cx-dia--jvp"), `mode ${mode} must render jvp SVG`);
    assert.ok(html.includes("ECG (timing reference)"), `mode ${mode} must include ECG reference line`);
    assert.ok(html.includes("cx-dia-toggle"), `mode ${mode} must include mode toggle buttons`);
  }

  const cannon = Diagrams.render("diagram.jvp", { mode: "cannon" });
  assert.ok(cannon.includes("Cannon &#39;a&#39; Wave") || cannon.includes("Cannon 'a' Wave"));
  assert.ok(cannon.includes("AV dissociation"));

  const afib = Diagrams.render("diagram.jvp", { mode: "absent_a" });
  assert.ok(afib.includes("no a"));
  assert.ok(afib.includes("Atrial Fibrillation"));

  const tr = Diagrams.render("diagram.jvp", { mode: "giant_v" });
  assert.ok(tr.includes("giant cv fusion"));
  assert.ok(tr.includes("Tricuspid Regurgitation"));

  const fried = Diagrams.render("diagram.jvp", { mode: "friedreich" });
  assert.ok(fried.includes("steep"));
  assert.ok(fried.includes("Constrictive Pericarditis"));
});

test("diagram.dermatomes renders sensory landmarks and deep tendon reflex arcs", () => {
  const html = Diagrams.render("diagram.dermatomes", { selected: "c5" });
  assert.ok(html.includes("cx-dia--dermatomes"));
  assert.ok(html.includes("Biceps reflex (C5, C6)"));
  assert.ok(html.includes("Musculocutaneous nerve"));

  const htmlL4 = Diagrams.render("diagram.dermatomes", { selected: "l4" });
  assert.ok(htmlL4.includes("Patellar reflex (L3, L4)"));
  assert.ok(htmlL4.includes("Femoral nerve"));

  const htmlS1 = Diagrams.render("diagram.dermatomes", { selected: "s1" });
  assert.ok(htmlS1.includes("Achilles reflex (S1, S2)"));
  assert.ok(htmlS1.includes("Tibial nerve"));
});

test("diagram.cranial renders interactive ventral brainstem atlas with origin, exit, supplies, and lesions", () => {
  // Test CN VII (Facial)
  const htmlCn7 = Diagrams.render("diagram.cranial", { selected: "cn7" });
  assert.ok(htmlCn7.includes("cx-dia--cranial"));
  assert.ok(htmlCn7.includes("CN VII: Facial Nerve"));
  assert.ok(htmlCn7.includes("Cerebellopontine angle"));
  assert.ok(htmlCn7.includes("Stylomastoid foramen"));
  assert.ok(htmlCn7.includes("Bell&#39;s Palsy") || htmlCn7.includes("Bell's Palsy"));
  assert.ok(htmlCn7.includes("FOREHEAD SPARED"));

  // Test CN III (Oculomotor)
  const htmlCn3 = Diagrams.render("diagram.cranial", { selected: "cn3" });
  assert.ok(htmlCn3.includes("CN III: Oculomotor Nerve"));
  assert.ok(htmlCn3.includes("Interpeduncular fossa"));
  assert.ok(htmlCn3.includes("Down-and-Out"));
  assert.ok(htmlCn3.includes("Sphincter pupillae"));

  // Test CN XII (Hypoglossal)
  const htmlCn12 = Diagrams.render("diagram.cranial", { selected: "cn12" });
  assert.ok(htmlCn12.includes("CN XII: Hypoglossal Nerve"));
  assert.ok(htmlCn12.includes("Pre-olivary sulcus"));
  assert.ok(htmlCn12.includes("lick the wound"));

  // Test atlas image mapping
  assert.ok(Diagrams.hasAtlas("diagram.cranial"));
  assert.equal(Diagrams.getAtlas("diagram.cranial").src, "clinix-cranial-nerves-brainstem.jpg");
});

test("diagram.clubbing renders nail-to-nail opposition, Schamroth sign, 5 grades, and fluctuation test", () => {
  // Normal
  const normal = Diagrams.render("diagram.clubbing", { view: "normal" });
  assert.ok(normal.includes("DIAMOND WINDOW OPEN"));
  assert.ok(normal.includes("cx-dia-window-light"));
  assert.ok(normal.includes("Lovibond ~160°"));

  // Clubbed
  const clubbed = Diagrams.render("diagram.clubbing", { view: "clubbed" });
  assert.ok(clubbed.includes("SCHAMROTH SIGN POSITIVE"));
  assert.ok(clubbed.includes("Window Obliterated"));

  // 5 Grades
  const grades = Diagrams.render("diagram.clubbing", { view: "grades" });
  assert.ok(grades.includes("Five Clinical Grades of Finger Clubbing"));
  assert.ok(grades.includes("Grade 1"));
  assert.ok(grades.includes("Grade 5"));
  assert.ok(grades.includes("Hypertrophic Osteoarthropathy"));

  // Fluctuation Test
  const fluct = Diagrams.render("diagram.clubbing", { view: "fluctuation" });
  assert.ok(fluct.includes("Bimanual Fluctuation Test"));
  assert.ok(fluct.includes("Examiner index fingers support pulp"));

  // Atlas mapping
  assert.ok(Diagrams.hasAtlas("diagram.clubbing"));
  assert.equal(Diagrams.getAtlas("diagram.clubbing").src, "clinix-schamroth-sign.jpg");
});

test("diagram.expansion renders calibrated metric excursion with floating thumbs, unilateral lag, and anchored error", () => {
  // Floating
  const floatHtml = Diagrams.render("diagram.expansion", { mode: "float" });
  assert.ok(floatHtml.includes("cx-dia--float"));
  assert.ok(floatHtml.includes("Symmetric Normal Excursion: ≥ 5.0 cm"));
  assert.ok(floatHtml.includes("MIDLINE AXIS"));

  // Unilateral
  const unilatHtml = Diagrams.render("diagram.expansion", { mode: "unilateral" });
  assert.ok(unilatHtml.includes("cx-dia--unilateral"));
  assert.ok(unilatHtml.includes("Unilateral Lag"));
  assert.ok(unilatHtml.includes("Effusion / Collapse"));

  // Anchored Technical Error
  const anchoredHtml = Diagrams.render("diagram.expansion", { mode: "anchored" });
  assert.ok(anchoredHtml.includes("cx-dia--anchored"));
  assert.ok(anchoredHtml.includes("Technical Error: Thumbs anchored to skin"));
  assert.ok(anchoredHtml.includes("Commonest Examination Trap"));
});

test("diagram.cerebellum renders VANISHED mnemonic and test demonstrations", () => {
  const tremor = Diagrams.render("diagram.cerebellum", { selected: "i" });
  assert.ok(tremor.includes("Intention Tremor"));
  assert.ok(tremor.includes("cx-dia-tremor-line"));
  assert.ok(tremor.includes("Past-Pointing"));

  const dysdiadocho = Diagrams.render("diagram.cerebellum", { selected: "d" });
  assert.ok(dysdiadocho.includes("Dysdiadochokinesia"));
  assert.ok(dysdiadocho.includes("Holmes Rebound"));

  const pendular = Diagrams.render("diagram.cerebellum", { selected: "h" });
  assert.ok(pendular.includes("Pendular Knee Jerk"));
});

test("diagram.facialpalsy renders UMN forehead sparing vs LMN complete hemifacial paralysis", () => {
  const umn = Diagrams.render("diagram.facialpalsy", { mode: "umn" });
  assert.ok(umn.includes("UMN STROKE"));
  assert.ok(umn.includes("FOREHEAD SPARED"));

  const lmn = Diagrams.render("diagram.facialpalsy", { mode: "lmn" });
  assert.ok(lmn.includes("BELL&#39;S PALSY (LMN)") || lmn.includes("BELL'S PALSY (LMN)"));
  assert.ok(lmn.includes("Bell&#39;s sign") || lmn.includes("Bell's sign"));
});

test("diagram.auscultareas accurately reflects retrosternal heart position", () => {
  const html = Diagrams.render("diagram.auscultareas", {});
  assert.ok(html.includes("Retrosternal Heart"));
  assert.ok(html.includes("1/3 Right"));
  assert.ok(html.includes("2/3 Left"));
});

