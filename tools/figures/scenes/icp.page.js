/* ICP scene: cranial vault, Monro-Kellie volume compliance, brain herniation pathways,
 * Cushing vital signs waveforms, dynamic pupil monitor, and patient gauges. */
const CX = 280;                                                 // midline of the cranium
const L = {
  cranium: $("cranium"),
  brain: $("brain"),
  mass: $("mass"),
  devices: $("devices"),
  pupil: $("pupil"),
  monro: $("monro"),
  cushing: $("cushing"),
  over: $("over"),
  panel: $("panel"),
};

const sm = {
  mass: 0.62,
  icp: 0.45,
  cpp: 0.40,
  compReserve: 0.45,
  shift: 0.62,
  hernia: 0.05,
  cushing: 0.0,
  map: 0.74,
  headUp: 0,
  osm: 0,
  evd: 0,
  decomp: 0,
};

let crn = {}, brn = {}, mss = {}, dev = {}, eye = {}, mkG = {}, csh = {}, gg = {};
let pArt = [], pVen = [], pCsf = [], pOsm = [];

function pool(n, build) {
  return Array.from({ length: n }, () => {
    const e = build();
    e.setAttribute("opacity", "0");
    return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 };
  });
}
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) {
  p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0;
  p.e.setAttribute("opacity", "1");
}
function kill(p) {
  p.on = false;
  p.e.setAttribute("opacity", "0");
}

function init() {
  /* ================= 1. Cranium & Neck Vessels ================= */
  // Jugular veins & Carotid arteries in neck
  mk("path", { class: "icp-vess ven", d: "M232 350C232 375 224 400 220 426" }, L.cranium);
  mk("path", { class: "icp-vess ven", d: "M328 350C328 375 336 400 340 426" }, L.cranium);
  mk("path", { class: "icp-vess art", d: "M248 426C248 395 254 370 258 350" }, L.cranium);
  mk("path", { class: "icp-vess art", d: "M312 426C312 395 306 370 302 350" }, L.cranium);

  // Skull bone: compound path between outer and inner tables
  const skullPath = "M160 326 C145 220 190 76 280 76 C370 76 415 220 400 326 L366 342 L340 338 L330 354 L330 422 L230 422 L230 354 L220 338 L194 342 Z " +
                    "M174 322 L204 334 L234 334 L242 348 L318 348 L326 334 L356 334 L386 322 C400 224 358 90 280 90 C202 90 160 224 174 322 Z";
  crn.skull = mk("path", { class: "icp-bone", "fill-rule": "evenodd", d: skullPath }, L.cranium);

  // Superior sagittal sinus at vertex
  mk("path", { class: "icp-csf", d: "M268 86C275 80 285 80 292 86L280 96Z" }, L.cranium);

  // Craniectomy bone flap on right calvarium (visible/closed initially)
  crn.flap = mk("path", { class: "icp-flap", d: "M398 126 C416 195 408 245 396 295 L384 290 C394 242 402 195 386 128 Z" }, L.cranium);

  /* ================= 2. Brain Parenchyma & Ventricles ================= */
  // Cerebral hemispheres (left & right)
  brn.hemiL = mk("path", { class: "icp-brain" }, L.brain);
  brn.hemiR = mk("path", { class: "icp-brain" }, L.brain);

  // Cortical sulci decorative lines
  brn.sulci = mk("g", {}, L.brain);
  [
    "M188 180 C202 186 214 182 225 188",
    "M182 230 C196 235 210 230 222 238",
    "M195 135 C208 142 218 138 230 144",
    "M212 102 C222 112 232 110 240 120",
    "M372 180 C358 186 346 182 335 188",
    "M378 230 C364 235 350 230 338 238",
    "M365 135 C352 142 342 138 330 144",
    "M348 102 C338 112 328 110 320 120",
  ].forEach((d) => mk("path", { class: "icp-sulcus", d }, brn.sulci));

  // Tentorium cerebelli (dural shelf with central notch)
  crn.tentL = mk("path", { class: "icp-dura", d: "M174 268 L254 252" }, L.brain);
  crn.tentR = mk("path", { class: "icp-dura", d: "M386 268 L306 252" }, L.brain);

  // Cerebellum (in posterior fossa)
  brn.cerebL = mk("path", { class: "icp-stem", d: "M184 274 C184 330 230 344 256 342 L254 256 Z" }, L.brain);
  brn.cerebR = mk("path", { class: "icp-stem", d: "M376 274 C376 330 330 344 304 342 L306 256 Z" }, L.brain);

  // Cerebellar tonsils (protrude down into foramen magnum during coning)
  brn.tonsilL = mk("path", { class: "icp-stem" }, L.brain);
  brn.tonsilR = mk("path", { class: "icp-stem" }, L.brain);

  // Brainstem: midbrain (incisura), pons, medulla (foramen magnum), upper cervical cord
  brn.stem = mk("path", { class: "icp-stem" }, L.brain);

  // Ventricles: Lateral ventricles (L & R), Third ventricle, Aqueduct, Fourth ventricle
  brn.ventL = mk("path", { class: "icp-csf" }, L.brain);
  brn.ventR = mk("path", { class: "icp-csf" }, L.brain);
  brn.vent3 = mk("path", { class: "icp-csf" }, L.brain);
  brn.vent4 = mk("path", { class: "icp-csf", d: "M276 288 L284 288 L282 324 L278 324 Z" }, L.brain);

  // Falx cerebri (midline dural partition down to corpus callosum)
  brn.falx = mk("path", { class: "icp-dura" }, L.brain);

  // Oculomotor nerve (CN III) running from midbrain past uncus
  brn.cn3 = mk("path", { class: "icp-dura", stroke: "var(--c-neut)", "stroke-width": "1.4" }, L.brain);

  // Uncal herniation protrusion past tentorial edge
  brn.uncus = mk("path", { class: "icp-brain" }, L.brain);

  /* ================= 3. Space-Occupying Mass & Oedema ================= */
  // Oedema halo around mass
  mss.oedema = mk("ellipse", { class: "icp-oedema", cx: 342, cy: 172 }, L.mass);
  // Mass lesion core
  mss.core = mk("ellipse", { class: "icp-mass", cx: 342, cy: 172 }, L.mass);

  /* ================= 4. Devices & Interventions ================= */
  // EVD: catheter, drip chamber, collection burette
  dev.g = mk("g", { opacity: "0" }, L.devices);
  mk("path", { class: "icp-evd", d: "M242 162 C230 110 220 90 212 88 L140 70 C100 60 70 80 66 110" }, dev.g);
  // Drip burette at x=66, y=110
  mk("rect", { class: "icp-chamber", x: 54, y: 110, width: 24, height: 60, rx: 5 }, dev.g);
  mk("rect", { class: "icp-fluid", x: 56, y: 145, width: 20, height: 23, rx: 2 }, dev.g);
  mk("line", { x1: 58, y1: 125, x2: 64, y2: 125, stroke: "var(--anatomy-mid)", "stroke-width": "0.8" }, dev.g);
  mk("line", { x1: 58, y1: 135, x2: 66, y2: 135, stroke: "var(--anatomy-mid)", "stroke-width": "0.8" }, dev.g);
  mk("line", { x1: 58, y1: 145, x2: 64, y2: 145, stroke: "var(--anatomy-mid)", "stroke-width": "0.8" }, dev.g);

  // Particle pools
  pArt = pool(12, () => mk("circle", { class: "sc-p p-art", r: 2.2 }, L.cranium));
  pVen = pool(12, () => mk("circle", { class: "sc-p p-ven", r: 2.4 }, L.cranium));
  pCsf = pool(10, () => mk("circle", { class: "sc-p p-csf", r: 2.0 }, dev.g));
  pOsm = pool(12, () => mk("circle", { class: "sc-p p-osm", r: 1.8 }, L.mass));

  /* ================= 5. Right Pupil Monitor ================= */
  const epX = 505, epY = 356;
  mk("rect", { class: "dr-panel", x: epX - 40, y: epY - 44, width: 80, height: 86, rx: 8 }, L.pupil);
  mk("circle", { cx: epX, cy: epY - 4, r: 20, fill: "var(--anatomy-paper)", stroke: "var(--anatomy-mid)", "stroke-width": "1" }, L.pupil);
  mk("circle", { class: "icp-iris", cx: epX, cy: epY - 4, r: 17 }, L.pupil);
  eye.aperture = mk("circle", { class: "icp-aperture", cx: epX, cy: epY - 4, r: 5 }, L.pupil);
  eye.txt = mk("text", { class: "dr-pt2", x: epX, y: epY + 30, "text-anchor": "middle", fill: "var(--anatomy-strong)" }, L.pupil);
  eye.txt.textContent = "reactive";

  /* ================= 6. Monro-Kellie Box (Right Top) ================= */
  const MB = { x: 604, y: 78, w: 322, h: 20 };
  // Volume Stack Bar
  mk("rect", { class: "dr-panel", x: MB.x, y: MB.y, width: MB.w, height: MB.h, rx: 4 }, L.monro);
  mkG.bBrain = mk("rect", { class: "mk-brain", x: MB.x, y: MB.y, width: 250, height: MB.h, rx: 3 }, L.monro);
  mkG.bCsf = mk("rect", { class: "mk-csf", x: MB.x + 250, y: MB.y, width: 36, height: MB.h }, L.monro);
  mkG.bVen = mk("rect", { class: "mk-blood", x: MB.x + 286, y: MB.y, width: 36, height: MB.h }, L.monro);
  mkG.bMass = mk("rect", { class: "mk-mass", x: MB.x + 322, y: MB.y, width: 0, height: MB.h, rx: 3 }, L.monro);

  // Legend under stack bar
  const lgY = MB.y + MB.h + 14;
  const leg = [
    ["Brain", "mk-brain", MB.x + 20],
    ["CSF", "mk-csf", MB.x + 105],
    ["Blood", "mk-blood", MB.x + 185],
    ["Mass", "mk-mass", MB.x + 265],
  ];
  leg.forEach(([name, cls, lx]) => {
    mk("rect", { class: cls, x: lx - 14, y: lgY - 7, width: 9, height: 9, rx: 2 }, L.monro);
    const lt = mk("text", { class: "dr-pt2", x: lx, y: lgY }, L.monro);
    lt.textContent = name;
  });

  // Volume-Pressure Curve Mini-Plot
  const CV = { x: 604, y: 146, w: 322, h: 80 };
  mk("rect", { class: "dr-panel", x: CV.x, y: CV.y, width: CV.w, height: CV.h, rx: 6 }, L.monro);
  for (let gy = CV.y + 18; gy < CV.y + CV.h; gy += 18) {
    mk("line", { class: "icp-grid", x1: CV.x, y1: gy, x2: CV.x + CV.w, y2: gy }, L.monro);
  }
  for (let gx = CV.x + 40; gx < CV.x + CV.w; gx += 50) {
    mk("line", { class: "icp-grid", x1: gx, y1: CV.y, x2: gx, y2: CV.y + CV.h }, L.monro);
  }
  mk("text", { class: "dr-pt2", x: CV.x + 8, y: CV.y + 14 }, L.monro).textContent = "ICP vs volume curve";
  mkG.compCurve = mk("path", { class: "icp-curve-comp", opacity: "0" }, L.monro);
  mk("path", { class: "icp-curve", d: "M" + (CV.x + 15) + " " + (CV.y + CV.h - 10) +
                                   " C " + (CV.x + 150) + " " + (CV.y + CV.h - 10) + ", " +
                                   (CV.x + 210) + " " + (CV.y + CV.h - 16) + ", " +
                                   (CV.x + 250) + " " + (CV.y + CV.h - 36) +
                                   " S " + (CV.x + 295) + " " + (CV.y + 16) + ", " +
                                   (CV.x + 308) + " " + (CV.y + 14) }, L.monro);
  mkG.dot = mk("circle", { cx: CV.x + 15, cy: CV.y + CV.h - 10, r: 5, fill: "var(--c-bad)", stroke: "var(--anatomy-paper)", "stroke-width": "1.5" }, L.monro);

  /* ================= 7. Cushing Response & Perfusion Box (Right Bottom) ================= */
  const CB = { x: 604, y: 288, w: 322, h: 22 };
  mk("rect", { class: "dr-panel", x: CB.x, y: CB.y, width: CB.w, height: CB.h, rx: 4 }, L.cushing);
  csh.mapBar = mk("rect", { class: "dr-g-fill g-good", x: CB.x, y: CB.y, width: 220, height: 10, rx: 2 }, L.cushing);
  csh.icpBar = mk("rect", { class: "dr-g-fill g-bad", x: CB.x, y: CB.y + 12, width: 40, height: 10, rx: 2 }, L.cushing);
  csh.cppTxt = mk("text", { class: "dr-pt2", x: CB.x + CB.w - 6, y: CB.y + 15, "text-anchor": "end" }, L.cushing);
  csh.cppTxt.textContent = "CPP: adequate";

  // Waveforms canvas (Arterial BP, Heart rate, Respiration)
  const WF = { x: 604, y: 326, w: 322, h: 102 };
  mk("rect", { class: "dr-panel", x: WF.x, y: WF.y, width: WF.w, height: WF.h, rx: 6 }, L.cushing);
  mk("line", { class: "icp-grid", x1: WF.x + 82, y1: WF.y, x2: WF.x + 82, y2: WF.y + WF.h }, L.cushing);
  for (let gy = WF.y + 18; gy < WF.y + WF.h; gy += 18) {
    mk("line", { class: "icp-grid", x1: WF.x, y1: gy, x2: WF.x + WF.w, y2: gy }, L.cushing);
  }
  csh.traceBp = mk("path", { class: "icp-trace-bp" }, L.cushing);
  csh.traceHr = mk("path", { class: "icp-trace-hr" }, L.cushing);
  csh.traceResp = mk("path", { class: "icp-trace-resp" }, L.cushing);

  mk("text", { class: "dr-pt2", x: WF.x + 8, y: WF.y + 26, fill: "var(--c-rbc)" }, L.cushing).textContent = "Arterial BP";
  mk("text", { class: "dr-pt2", x: WF.x + 8, y: WF.y + 60, fill: "var(--c-good)" }, L.cushing).textContent = "Heart rate";
  mk("text", { class: "dr-pt2", x: WF.x + 8, y: WF.y + 90, fill: "var(--c-cyt)" }, L.cushing).textContent = "Respiration";

  /* ================= 8. Label Pills ================= */
  const o = L.over;
  pill(o, "Rigid cranium", 175, 95, 95, 86, "The inextensible bony skull. Because its volume is fixed, any expansion in brain, blood, CSF or a new mass must displace another component.");
  pill(o, "Falx cerebri", 280, 115, 280, 72, "The tough midline dural partition between the cerebral hemispheres. Lateral mass effect forces brain tissue underneath its free edge.");
  pill(o, "Mass or oedema", 350, 150, 460, 72, "An expanding space-occupying lesion such as a haematoma, contusion, tumour or cerebral oedema that takes up intracranial volume.");

  pill(o, "Lateral ventricle", 235, 165, 95, 150, "CSF-filled lateral ventricular horns. The ipsilateral ventricle is effaced by mass effect, while CSF is displaced into the spinal space.");
  pill(o, "Subfalcine shift", 270, 175, 480, 135, "The cingulate gyrus herniates across the midline beneath the rigid falx cerebri, compressing pericallosal anterior cerebral arteries.");

  pill(o, "Tentorium", 220, 260, 85, 235, "The rigid dural shelf dividing supratentorial hemispheres from the cerebellum and brainstem. Its central opening is the tentorial notch.");
  pill(o, "Uncal herniation", 320, 260, 480, 195, "The medial temporal uncus herniates downward through the tentorial notch, squeezing the midbrain and ipsilateral oculomotor nerve.");

  pill(o, "Foramen magnum", 240, 345, 95, 320, "The large skull base opening through which the brainstem connects to the spinal cord. Rigid bone surrounds this critical exit.");
  pill(o, "Pupil (CN III)", 505, 335, 495, 260, "Compression of the third cranial nerve by the herniating uncus paralyzes parasympathetic pupillomotor fibers, causing a dilated, unreactive pupil.");

  pill(o, "Brainstem", 275, 370, 185, 395, "Contains the midbrain, pons and medulla oblongata, housing vital cardiovascular and respiratory pacemaker nuclei.");
  pill(o, "Tonsillar coning", 312, 355, 475, 422, "Cerebellar tonsils are forced downward into the foramen magnum, directly compressing the medulla oblongata and causing respiratory arrest.");

  pill(o, "Volume buffer", 660, 88, 680, 130, "Monro-Kellie doctrine: intracranial volume is shared between brain, venous blood, CSF and mass. Venous blood and CSF serve as initial buffers.");
  pill(o, "Compliance curve", 790, 180, 845, 130, "Volume-pressure relationship: flat during initial compensation, then steep exponential pressure rise once compensatory buffers are exhausted.");

  pill(o, "Perfusion margin", 700, 293, 690, 274, "Cerebral perfusion pressure equals mean arterial pressure minus intracranial pressure. As ICP rises, perfusion margin narrows.");
  pill(o, "Cushing triad", 760, 355, 845, 274, "Life-threatening autonomic response to medullary ischaemia: severe arterial hypertension, reflex bradycardia and respiratory irregularity.");

  // Treatment indicator pills
  const pillHead = pill(o, "Head elevation", 232, 380, 85, 395, "Head elevation with neutral neck alignment accelerates jugular venous drainage and reduces intracranial venous blood volume without dropping arterial pressure.");
  pillHead.setAttribute("id", "p-head"); pillHead.style.opacity = "0";

  const pillOsm = pill(o, "Osmotic therapy", 342, 140, 360, 105, "Mannitol or hypertonic saline creates an intravascular osmotic gradient, drawing free water from swollen brain parenchyma across the blood-brain barrier.");
  pillOsm.setAttribute("id", "p-osm"); pillOsm.style.opacity = "0";

  const pillEvd = pill(o, "CSF drainage", 212, 88, 180, 105, "An external ventricular drain in the lateral ventricle directly vents CSF, immediately decompressing intracranial volume.");
  pillEvd.setAttribute("id", "p-evd"); pillEvd.style.opacity = "0";

  const pillDec = pill(o, "Craniectomy", 396, 210, 410, 155, "Surgical removal of a cranial bone flap converts the closed rigid cranium into an open compliant space, letting swollen brain expand outward.");
  pillDec.setAttribute("id", "p-dec"); pillDec.style.opacity = "0";

  /* ================= 9. Bottom Gauges Panel ================= */
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: 476 }, P).textContent = "The patient";

  [
    ["icp", "ICP", "g-bad", "Intracranial pressure: normal in health; rises steeply once compensatory reserve is exhausted."],
    ["cpp", "CPP", "g-good", "Cerebral perfusion pressure: MAP minus ICP. Collapses as ICP climbs, causing brain ischaemia."],
    ["comp", "Compliance", "g-good", "Cranial volume reserve: ability of the intracranial space to accommodate added volume without a pressure spike."],
    ["shift", "Midline shift", "g-clot", "Lateral displacement of cerebral hemispheres across the falx cerebri from unilateral mass effect."],
    ["hernia", "Herniation", "g-bad", "Transtentorial uncal and foramen magnum tonsillar descent compressing brainstem structures."],
    ["cush", "Cushing reflex", "g-cyt", "Autonomic response to medullary compression: arterial hypertension, reflex bradycardia and respiratory irregularity."],
  ].forEach(([id, name, cls, tip], i) => {
    gg[id] = gauge(P, 100 + i * 145, y0, 60, 18, cls, name, tip);
  });
}

function updateAnatomy(dt) {
  const sh = sm.shift * 18;                     // lateral midline displacement in px
  const hn = sm.hernia;                         // herniation intensity (0 to 1)
  const dec = sm.decomp;                        // surgical decompression intensity (0 to 1)

  // Calvarium bone flap (craniectomy)
  if (dec > 0.05) {
    crn.flap.setAttribute("transform", "translate(" + f1(dec * 32) + " " + f1(-dec * 12) + ") rotate(" + f1(dec * 18) + " 396 295)");
    crn.flap.setAttribute("opacity", (1 - dec * 0.7).toFixed(2));
  } else {
    crn.flap.setAttribute("transform", "");
    crn.flap.setAttribute("opacity", "1");
  }

  // Falx cerebri bowing
  const fxD = "M280 90 Q" + f1(280 - sh * 0.6) + " 135 " + f1(280 - sh) + " 180";
  brn.falx.setAttribute("d", fxD);

  // Left & Right Hemispheres (with durotomy bulge outward on right if decompressed)
  const rBulge = dec * 22;
  const hemiLD = "M280 90 C202 90 174 224 174 266 L254 252 L" + f1(280 - sh) + " 180 Q" + f1(280 - sh * 0.6) + " 135 280 90 Z";
  const hemiRD = "M280 90 Q" + f1(280 - sh * 0.6) + " 135 " + f1(280 - sh) + " 180 L306 252 L386 266 C" +
                 f1(386 + rBulge) + " 224 " + f1(358 + rBulge * 0.8) + " 90 280 90 Z";
  brn.hemiL.setAttribute("d", hemiLD);
  brn.hemiR.setAttribute("d", hemiRD);

  // Color shade change on cortex with severe ischaemia (dusky hue)
  const isch = clamp((0.50 - sm.cpp) * 2.2);
  const cortexColor = "color-mix(in srgb, var(--c-endo) " + f1(28 - isch * 12) + "%, color-mix(in srgb, #605060 " + f1(isch * 45) + "%, var(--anatomy-paper)))";
  brn.hemiL.style.fill = cortexColor;
  brn.hemiR.style.fill = cortexColor;

  // Lateral Ventricles: left shifts, right effaces
  const vlX = 236 - sh * 0.8;
  const vlW = 14 + (sm.evd > 0.3 ? -3 : 0);
  brn.ventL.setAttribute("d", "M" + f1(vlX) + " 142 C" + f1(vlX - vlW) + " 160 " + f1(vlX - vlW) + " 178 " + f1(vlX) + " 188 C" + f1(vlX + 4) + " 172 " + f1(vlX + 4) + " 155 " + f1(vlX) + " 142 Z");

  const vrX = 324 - sh * 0.9;
  const vrW = Math.max(1.8, 14 * (1 - sm.mass * 0.9));  // effacement
  brn.ventR.setAttribute("d", "M" + f1(vrX) + " 142 C" + f1(vrX + vrW) + " 160 " + f1(vrX + vrW) + " 178 " + f1(vrX) + " 188 C" + f1(vrX - 2) + " 172 " + f1(vrX - 2) + " 155 " + f1(vrX) + " 142 Z");

  // Third Ventricle on midline
  const v3X = 280 - sh * 0.95;
  brn.vent3.setAttribute("d", "M" + f1(v3X - 2) + " 192 L" + f1(v3X + 2) + " 192 L" + f1(v3X + 2) + " 226 L" + f1(v3X - 2) + " 226 Z");

  // Brainstem: midbrain shifts slightly, medulla compressed
  const stmX = 280 - sh * 0.25;
  brn.stem.setAttribute("d", "M" + f1(stmX - 12) + " 250 L" + f1(stmX + 12) + " 250 " +
                             "C" + f1(stmX + 16) + " 270 " + f1(stmX + 16) + " 305 " + f1(stmX + 10) + " 315 " +
                             "L" + f1(stmX + 9 - hn * 3) + " 348 L" + f1(stmX + 8) + " 416 " +
                             "L" + f1(stmX - 8) + " 416 L" + f1(stmX - 9 + hn * 2) + " 348 " +
                             "L" + f1(stmX - 10) + " 315 C" + f1(stmX - 16) + " 305 " + f1(stmX - 16) + " 270 " + f1(stmX - 12) + " 250 Z");

  // Cerebellar Tonsils: coning down past foramen magnum (y=348)
  const tonsilDrop = hn * 18;
  brn.tonsilL.setAttribute("d", "M248 335 C244 344 246 " + f1(348 + tonsilDrop * 0.7) + " 254 " + f1(348 + tonsilDrop * 0.7) + " C260 " + f1(348 + tonsilDrop * 0.7) + " 262 342 260 335 Z");
  brn.tonsilR.setAttribute("d", "M300 335 C298 342 300 " + f1(348 + tonsilDrop) + " 306 " + f1(348 + tonsilDrop) + " C314 " + f1(348 + tonsilDrop) + " 316 344 312 335 Z");

  // Uncal herniation (medial temporal uncus descending past tentorium into posterior fossa)
  const uncY = 250 + hn * 18;
  brn.uncus.setAttribute("d", "M304 248 C318 248 322 " + f1(uncY) + " 312 " + f1(uncY) + " C304 " + f1(uncY) + " 298 254 304 248 Z");
  brn.uncus.setAttribute("opacity", (hn > 0.05 ? clamp(hn * 1.5).toFixed(2) : "0"));

  // Oculomotor nerve (CN III) stretched and compressed by uncus
  const cn3Y = 254 + hn * 14;
  brn.cn3.setAttribute("d", "M" + f1(stmX + 10) + " 252 Q312 " + f1(cn3Y) + " 350 274");

  // Mass core & Oedema halo
  const mR = sm.mass * 30;
  mss.core.setAttribute("rx", f1(Math.max(0.1, mR)));
  mss.core.setAttribute("ry", f1(Math.max(0.1, mR * 0.88)));
  mss.core.setAttribute("opacity", clamp(sm.mass * 1.5).toFixed(2));

  const oedR = sm.mass * 52 * (1 - sm.osm * 0.35);
  mss.oedema.setAttribute("rx", f1(Math.max(0.1, oedR)));
  mss.oedema.setAttribute("ry", f1(Math.max(0.1, oedR * 0.85)));
  mss.oedema.setAttribute("opacity", clamp(sm.mass * 1.1).toFixed(2));

  // Right Pupil aperture
  const pRad = 4.5 + hn * 10.5;
  eye.aperture.setAttribute("r", f1(pRad));
  const pWord = hn > 0.45 ? "blown" : hn > 0.15 ? "sluggish" : "reactive";
  if (eye.txt.textContent !== pWord) eye.txt.textContent = pWord;
  eye.txt.setAttribute("fill", hn > 0.45 ? "var(--c-bad)" : hn > 0.15 ? "var(--c-neut)" : "var(--anatomy-strong)");

  // EVD device visibility
  dev.g.setAttribute("opacity", sm.evd > 0.05 ? "1" : "0");

  // Treatment badges / pills opacity
  const opF = (v) => clamp(v).toFixed(2);
  const pHead = $("p-head"), pOsm = $("p-osm"), pEvd = $("p-evd"), pDec = $("p-dec");
  if (pHead) pHead.style.opacity = opF(sm.headUp);
  if (pOsm) pOsm.style.opacity = opF(sm.osm);
  if (pEvd) pEvd.style.opacity = opF(sm.evd);
  if (pDec) pDec.style.opacity = opF(sm.decomp);
}

function updateMonroKellie() {
  const MB = { x: 604, w: 322 };
  // Proportions of Monro-Kellie compartments
  const mFrac = clamp(sm.mass * 0.24);
  const cFrac = clamp(0.10 * (1 - sm.mass * 1.05 + 0.45 * sm.evd));
  const vFrac = clamp(0.10 * (1 - sm.mass * 1.0 + 0.30 * sm.headUp));
  const bFrac = clamp(1 - (mFrac + cFrac + vFrac));

  const wBrain = bFrac * MB.w;
  const wCsf = cFrac * MB.w;
  const wVen = vFrac * MB.w;
  const wMass = mFrac * MB.w;

  mkG.bBrain.setAttribute("width", f1(wBrain));
  mkG.bCsf.setAttribute("x", f1(MB.x + wBrain));
  mkG.bCsf.setAttribute("width", f1(wCsf));
  mkG.bVen.setAttribute("x", f1(MB.x + wBrain + wCsf));
  mkG.bVen.setAttribute("width", f1(wVen));
  mkG.bMass.setAttribute("x", f1(MB.x + wBrain + wCsf + wVen));
  mkG.bMass.setAttribute("width", f1(wMass));

  // Compliance Curve Cursor Position
  const CV = { x: 604, y: 146, w: 322, h: 80 };
  const uVol = clamp(mFrac / 0.24);
  // Path formula calculation
  const dotX = CV.x + 15 + uVol * (CV.w - 30);
  const curveNorm = Math.pow(uVol, 2.6);
  const decompRelief = sm.decomp * 0.65;
  const dotY = CV.y + CV.h - 10 - clamp(curveNorm * (1 - decompRelief)) * (CV.h - 22);

  mkG.dot.setAttribute("cx", f1(dotX));
  mkG.dot.setAttribute("cy", f1(dotY));
  mkG.dot.setAttribute("fill", sm.icp > 0.58 ? "var(--c-bad)" : sm.icp > 0.26 ? "var(--c-neut)" : "var(--c-good)");
}

function updateCushing(dt) {
  const CB = { x: 604, w: 322 };
  // MAP and ICP bars
  const wMap = clamp(sm.map) * (CB.w - 70);
  const wIcp = clamp(sm.icp) * (CB.w - 70);
  csh.mapBar.setAttribute("width", f1(wMap));
  csh.icpBar.setAttribute("width", f1(wIcp));

  const cppWord = "CPP: " + (sm.cpp < 0.35 ? "compromised" : sm.cpp < 0.54 ? "threatened" : "adequate");
  if (csh.cppTxt.textContent !== cppWord) csh.cppTxt.textContent = cppWord;
  csh.cppTxt.setAttribute("fill", sm.cpp < 0.35 ? "var(--c-bad)" : sm.cpp < 0.54 ? "var(--c-neut)" : "var(--c-good)");

  // Waveforms drawing (dedicated label column on left, traces run x = 690 to 920)
  const WF = { x: 604, y: 326, w: 322, h: 102 };
  const cshAct = sm.cushing;

  // Waveform frequencies and amplitudes
  // 1. Blood Pressure: surges with hypertension
  const bpAmp = 6 + cshAct * 9;
  const bpBase = WF.y + 24 - cshAct * 7;

  // 2. Heart Rate: bradycardia slows down frequency
  const hrRate = 1.0 - cshAct * 0.55;           // slower rhythm in bradycardia
  const hrBase = WF.y + 60;

  // 3. Respiration: irregular, shallow, apnoeic in severe coning
  const respBase = WF.y + 92;
  const respAmp = Math.max(2, 6 * (1 - cshAct * 0.6));

  const xStart = WF.x + 86, xEnd = WF.x + WF.w - 6;
  let dBp = "", dHr = "", dResp = "";
  for (let x = xStart; x <= xEnd; x += 3) {
    const age = (xEnd - x) / 75;
    const t = tm / 1000 - age;

    // BP pulse waveform
    const pBp = ((t * 1.3) % 1 + 1) % 1;
    const yBp = bpBase - bpAmp * (pBp < 0.25 ? Math.sin(pBp / 0.25 * Math.PI) : -0.2 * Math.sin((pBp - 0.25) / 0.75 * Math.PI));
    dBp += (x === xStart ? "M" : "L") + x + " " + f1(yBp);

    // HR rhythm wave (ECG QRS spikes)
    const pHr = ((t * hrRate * 1.4) % 1 + 1) % 1;
    let yHr = hrBase;
    if (pHr > 0.20 && pHr < 0.24) yHr -= 12;
    else if (pHr >= 0.24 && pHr < 0.28) yHr += 4;
    dHr += (x === xStart ? "M" : "L") + x + " " + f1(yHr);

    // Breathing rhythm wave (irregular ataxic breaths with high cushing)
    const pResp = ((t * 0.35) % 1 + 1) % 1;
    const irreg = cshAct > 0.4 ? 0.4 * Math.sin(t * 1.8) : 0;
    const yResp = respBase + respAmp * Math.sin(pResp * 6.283 + irreg);
    dResp += (x === xStart ? "M" : "L") + x + " " + f1(yResp);
  }
  csh.traceBp.setAttribute("d", dBp);
  csh.traceHr.setAttribute("d", dHr);
  csh.traceResp.setAttribute("d", dResp);
}

function updateParticles(dt) {
  // Arterial particles into skull base
  if (Math.random() < dt * 6) {
    const p = free(pArt);
    if (p) emit(p, pick([254, 306]) + rnd(-3, 3), 422, rnd(-2, 2), -rnd(45, 75));
  }
  pArt.forEach((p) => {
    if (!p.on) return;
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.t > 1.8 || p.y < 280) kill(p);
  });

  // Jugular venous particles down neck (accelerated by head elevation)
  const venRate = 4 + sm.headUp * 10;
  if (Math.random() < dt * venRate) {
    const p = free(pVen);
    if (p) emit(p, pick([228, 332]) + rnd(-4, 4), 350, rnd(-2, 2), rnd(40, 70 + sm.headUp * 50));
  }
  pVen.forEach((p) => {
    if (!p.on) return;
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.t > 1.6 || p.y > 426) kill(p);
  });

  // EVD drops dripping in burette
  if (sm.evd > 0.3 && Math.random() < dt * 4) {
    const p = free(pCsf);
    if (p) emit(p, 66 + rnd(-2, 2), 116, 0, rnd(25, 45));
  }
  pCsf.forEach((p) => {
    if (!p.on) return;
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.t > 1.0 || p.y > 146) kill(p);
  });

  // Osmotic draw particles from swollen tissue into capillaries
  if (sm.osm > 0.3 && Math.random() < dt * sm.osm * 6) {
    const p = free(pOsm);
    if (p) emit(p, 342 + rnd(-25, 25), 172 + rnd(-25, 25), rnd(-15, 15), rnd(-15, 15));
  }
  pOsm.forEach((p) => {
    if (!p.on) return;
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.t > 1.4) kill(p);
  });
}

function step(dt, m) {
  const kFast = Math.min(1, dt * 2.0);
  const kSlow = Math.min(1, dt * 1.0);

  ["mass", "headUp", "osm", "evd", "decomp"].forEach((q) => {
    sm[q] = lerp(sm[q], m[q], kFast);
  });
  ["icp", "cpp", "compReserve", "shift", "hernia", "cushing", "map"].forEach((q) => {
    sm[q] = lerp(sm[q], m[q], kSlow);
  });

  updateAnatomy(dt);
  updateMonroKellie();
  updateCushing(dt);
  updateParticles(dt);

  // Update Gauges
  gg.icp.set(sm.icp, wordOf(sm.icp, 0.26, 0.58, ["normal", "elevated", "critical"]));
  gg.cpp.set(sm.cpp, wordOf(sm.cpp, 0.35, 0.54, ["poor", "reduced", "normal"]));
  gg.comp.set(sm.compReserve, wordOf(sm.compReserve, 0.30, 0.65, ["exhausted", "reduced", "normal"]));
  gg.shift.set(sm.shift, wordOf(sm.shift, 0.25, 0.55, ["none", "moderate", "severe"]));
  gg.hernia.set(sm.hernia, wordOf(sm.hernia, 0.20, 0.50, ["none", "impending", "severe"]));
  gg.cush.set(sm.cushing, wordOf(sm.cushing, 0.25, 0.60, ["absent", "impending", "active"]));
}

run({ init, step });
