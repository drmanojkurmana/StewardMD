import test from "node:test";
import assert from "node:assert/strict";
import D from "../clinix-diagrams.js";

test("diagram.jvpwave renders valid SVG across all pathological modes and interactive zones", () => {
  assert.ok(D.has("diagram.jvpwave"), "diagram.jvpwave must be registered in DIAGRAMS");

  // Normal mode
  const normalHtml = D.render("diagram.jvpwave", { focus: "normal" });
  assert.ok(normalHtml.includes("<svg"), "normal render must contain <svg");
  assert.ok(normalHtml.includes("S1") && normalHtml.includes("S2"), "must show heart sound markers S1 and S2");
  assert.ok(normalHtml.includes("QRS"), "must show synchronous ECG tracing");

  // TR mode
  const trHtml = D.render("diagram.jvpwave", { focus: "tr" });
  assert.ok(trHtml.includes("Lancisi") || trHtml.includes("c-v wave"), "TR mode must display giant c-v wave note");
  assert.ok(trHtml.includes("x descent lost"), "TR mode must indicate lost x descent");

  // Constrictive pericarditis mode
  const cpHtml = D.render("diagram.jvpwave", { focus: "constriction" });
  assert.ok(cpHtml.includes("Friedreich") || cpHtml.includes("steep y"), "Constriction mode must show Friedreich steep y descent");

  // Cannon a waves mode
  const chbHtml = D.render("diagram.jvpwave", { focus: "chb" });
  assert.ok(chbHtml.includes("CANNON a wave"), "CHB mode must display cannon a wave label");

  // Interactive zone selection
  const aSelectHtml = D.render("diagram.jvpwave", { selected: "a" });
  assert.ok(aSelectHtml.includes("Right atrial contraction"), "selecting 'a' must explain right atrial contraction");
  assert.ok(aSelectHtml.includes("GIANT in pulmonary hypertension"), "selecting 'a' must give high-yield clinical pearl");

  const vSelectHtml = D.render("diagram.jvpwave", { selected: "v" });
  assert.ok(vSelectHtml.includes("closed tricuspid valve"), "selecting 'v' must explain atrial filling against closed valve");
});

test("diagram.auscultareas renders 5 areas, murmur radiation vectors, and connects to cardiac audio", () => {
  assert.ok(D.has("diagram.auscultareas"), "diagram.auscultareas must be registered in DIAGRAMS");

  const html = D.render("diagram.auscultareas", {});
  assert.ok(html.includes("<svg"), "must contain SVG chest silhouette");
  assert.ok(html.includes("To carotids (AS)"), "must show aortic stenosis radiation to carotids");
  assert.ok(html.includes("To axilla (MR)"), "must show mitral regurgitation radiation to axilla");

  // Audio linkage
  assert.ok(D.soundFor("mitral") === "mr_murmur" || D.soundFor("mitral") === "mr", "mitral area must link to murmur sound");
  assert.ok(D.soundFor("aortic") === "as_murmur" || D.soundFor("aortic") === "as", "aortic area must link to murmur sound");
  assert.ok(D.soundFor("erbs") === "ar_murmur" || D.soundFor("erbs") === "ar", "erbs area must link to murmur sound");

  // Area details on tap
  const mitralHtml = D.render("diagram.auscultareas", { selected: "mitral" });
  assert.ok(mitralHtml.includes("LEFT LATERAL DECUBITUS"), "mitral selection must advise left lateral position");
  assert.ok(mitralHtml.includes("Bell for MS"), "mitral selection must mention bell for mitral stenosis");
});

test("diagram.cngaze renders H-pattern and cardinal oculomotor palsies", () => {
  assert.ok(D.has("diagram.cngaze"), "diagram.cngaze must be registered");

  const hHtml = D.render("diagram.cngaze", { mode: "hpattern" });
  assert.ok(hHtml.includes("H\" in space"), "must render H-pattern guide");

  // CN III palsy
  const cn3Html = D.render("diagram.cngaze", { mode: "cn3palsy" });
  assert.ok(cn3Html.includes("Down and Out") || cn3Html.includes("Ptosis"), "CN III palsy must show ptosis / down-and-out");

  // Horner syndrome
  const hornerHtml = D.render("diagram.cngaze", { mode: "horner" });
  assert.ok(hornerHtml.includes("Horner Syndrome") || hornerHtml.includes("miosis"), "Horner mode must note miosis/ptosis");

  // Clickable cardinal gaze positions
  const soHtml = D.render("diagram.cngaze", { selected: "dn_l" });
  assert.ok(soHtml.includes("Superior Oblique (CN IV)"), "down-left must test CN IV Superior Oblique");
});

test("diagram.facialpalsy illustrates UMN forehead sparing vs LMN Bell's palsy", () => {
  assert.ok(D.has("diagram.facialpalsy"), "diagram.facialpalsy must be registered");

  // UMN stroke mode
  const umnHtml = D.render("diagram.facialpalsy", { mode: "umn" });
  assert.ok(umnHtml.includes("FOREHEAD SPARED"), "UMN mode must highlight forehead sparing");
  assert.ok(umnHtml.includes("bilateral"), "UMN note must explain bilateral cortical innervation");

  // LMN Bell's mode
  const lmnHtml = D.render("diagram.facialpalsy", { mode: "lmn" });
  assert.ok(lmnHtml.includes("Wrinkles LOST"), "LMN mode must highlight loss of forehead wrinkles");
  assert.ok(lmnHtml.includes("Bell's phenomenon"), "LMN mode must describe Bell's phenomenon");
});

test("diagram.shiftingdullness demonstrates fluid shifts and 3-hand fluid thrill", () => {
  assert.ok(D.has("diagram.shiftingdullness"), "diagram.shiftingdullness must be registered");

  const supineHtml = D.render("diagram.shiftingdullness", { mode: "supine" });
  assert.ok(supineHtml.includes("TYMPANITIC (Air)"), "supine must show central tympany");
  assert.ok(supineHtml.includes("DULL"), "supine must show flank dullness");

  const shiftHtml = D.render("diagram.shiftingdullness", { mode: "shift" });
  assert.ok(shiftHtml.includes("TURNS TYMPANITIC!"), "shift mode must highlight flank turning tympanitic");

  const thrillHtml = D.render("diagram.shiftingdullness", { mode: "thrill" });
  assert.ok(thrillHtml.includes("Damps fat wave") || thrillHtml.includes("damping"), "thrill mode must explain damping hand");
});

test("diagram.sensorylevel maps dermatomal landmarks to spinal roots and reflex arcs", () => {
  assert.ok(D.has("diagram.sensorylevel"), "diagram.sensorylevel must be registered");

  // T10 umbilicus
  const t10Html = D.render("diagram.sensorylevel", { selected: "t10" });
  assert.ok(t10Html.includes("Umbilicus"), "T10 must name umbilicus");
  assert.ok(t10Html.includes("Beevor sign"), "T10 must cite Beevor sign");

  // C6 thumb
  const c6Html = D.render("diagram.sensorylevel", { selected: "c6" });
  assert.ok(c6Html.includes("Supinator"), "C6 must link to Supinator reflex");

  // L4 knee
  const l4Html = D.render("diagram.sensorylevel", { selected: "l4" });
  assert.ok(l4Html.includes("Knee jerk"), "L4 must link to knee jerk");
});
