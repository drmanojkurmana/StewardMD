/* Raised ICP scene: real brain art inside a rigid skull, mass effect with shift,
 * Monro-Kellie volume pressure curve, pupil and Cushing alarms, and gauges. */
const L = {
  skull: $("skull"),
  brainMove: $("brainMove"),
  brain: $("brainSlot"),
  mass: $("mass"),
  devices: $("devices"),
  eye: $("eye"),
  monro: $("monro"),
  alarm: $("alarm"),
  parts: $("parts"),
  over: $("over"),
  panel: $("panel"),
};
const CX = 290, CY = 245;                       // centre of the skull
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

let brainO = null, eyeO = null;
let massC = [300, 205], cathTip = [260, 190];
let glowEl, coneEl, massEl, haloEl, arrowEl, flapEl, bulgeEl, wedgeEl, evdG, fluidEl;
let artPath, veinPath, trArt = null, trVein = null;
let apEl, apWord, mapBar, icpBar, cppTxt, trBp, trHr, trResp, dotEl;
let bBrain, bCsf, bVen, bMass;
let pillDrain, pillFlap, capEl, capDrug = -1;
let gg = {};
let pArt = [], pVen = [], pCsf = [], pOsm = [];
const acc = { art: 0, ven: 0, csf: 0, osm: 0 };

function pool(n, build) {
  return Array.from({ length: n }, () => {
    const e = build();
    e.setAttribute("opacity", "0");
    return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, tr: null };
  });
}
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) {
  p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.tr = null;
  p.e.setAttribute("opacity", "1");
}
function kill(p) {
  p.on = false;
  p.e.setAttribute("opacity", "0");
}

function capText(d) {
  if (d === 1) return "Head raised. Neck veins drain faster and pressure eases.";
  if (d === 2) return "Osmotic therapy pulls water from the swollen brain. Swelling falls.";
  if (d === 3) return "A drain vents fluid from inside the brain. Pressure falls.";
  if (d === 4) return "A bone flap is removed so the swollen brain has room. Pressure falls.";
  if (d === 5) return "Full bundle. Drainage, water removal and room to swell bring pressure down.";
  return "No treatment. The mass grows, pressure rises and the brain is squeezed down.";
}

/* skull and dura stay procedural; the brain and the eye are real organ art */
function initOrgans() {
  glowEl = mk("ellipse", { class: "icp-glow", cx: CX, cy: CY, rx: 238, ry: 180, opacity: "0" }, L.skull);
  mk("ellipse", { class: "icp-bone", cx: CX, cy: CY, rx: 235, ry: 178 }, L.skull);
  mk("ellipse", { class: "icp-dura", cx: CX, cy: CY, rx: 222, ry: 167 }, L.skull);
  mk("path", { class: "icp-canal", d: "M262 406 L256 440" }, L.skull);
  mk("path", { class: "icp-canal", d: "M318 406 L324 440" }, L.skull);
  coneEl = mk("ellipse", { class: "icp-cone", cx: CX, cy: 406, rx: 30, ry: 11, opacity: "0" }, L.skull);

  brainO = organ(L.brain, "brain", CX, CY, 270, {});
  const BP = brainO.ports;
  massC = [Math.round(BP.parenchyma[0] + 24), Math.round(BP.parenchyma[1] - 34)];
  massEl = mk("ellipse", { class: "icp-mass", cx: massC[0], cy: massC[1], opacity: "0" }, L.mass);
  haloEl = mk("ellipse", { class: "icp-oedema", cx: massC[0], cy: massC[1], opacity: "0" }, L.mass);
  arrowEl = mk("path", { class: "icp-arrow", opacity: "0" }, L.mass);

  /* neck artery in to the carotid port, neck vein out from under the brain */
  const CA = BP.carotid, ST = BP.stem;
  artPath = mk("path", { class: "icp-vess art", d: "M186 440 C190 402 200 360 " + f1(CA[0]) + " " + f1(CA[1]) }, L.skull);
  const V0 = [Math.round(ST[0] + 52), Math.round(ST[1] - 14)];
  veinPath = mk("path", { class: "icp-vess ven", d: "M" + V0[0] + " " + V0[1] + " C340 372 380 400 404 440" }, L.skull);
  trArt = track([[186, 440], [190, 402], CA]);
  trVein = track([V0, [340, 372], [404, 440]]);

  /* ventricular drain: chamber outside the skull, catheter to the fluid spaces */
  cathTip = [Math.round(BP.parenchyma[0] - 34), Math.round(BP.parenchyma[1] - 46)];
  evdG = mk("g", { opacity: "0" }, L.devices);
  mk("path", { class: "icp-evd", d: "M84 95 C110 98 130 102 150 108 C185 120 220 145 " + cathTip[0] + " " + cathTip[1] }, evdG);
  mk("rect", { class: "icp-chamber", x: 58, y: 66, width: 26, height: 58, rx: 5 }, evdG);
  fluidEl = mk("rect", { class: "icp-fluid", x: 60, y: 112, width: 22, height: 10, rx: 2 }, evdG);

  /* bone flap on the upper skull, brain bulge behind the opening, head up wedge */
  bulgeEl = mk("ellipse", { class: "icp-bulge", cx: 464, cy: 110, rx: 15, ry: 9, opacity: "0" }, L.devices);
  flapEl = mk("path", { class: "icp-flap", d: "M425 105 Q465 88 500 115 Q480 132 450 128 Q430 120 425 105 Z" }, L.devices);
  wedgeEl = mk("path", { class: "icp-wedge", d: "M40 440 L260 440 L260 398 Z", opacity: "0" }, L.devices);

  /* pupil monitor is real eye art; the aperture overlay dilates with herniation */
  eyeO = organ(L.eye, "eye", 648, 350, 96, {});
  const LP = eyeO.ports.lens;
  apEl = mk("circle", { class: "icp-aperture", cx: LP[0], cy: LP[1], r: 5 }, L.eye);
  apWord = mk("text", { class: "dr-pt2", x: 648, y: 404, "text-anchor": "middle" }, L.eye);
  apWord.textContent = "reactive";

  pArt = pool(10, () => mk("circle", { class: "sc-p p-art", r: 2.2 }, L.parts));
  pVen = pool(12, () => mk("circle", { class: "sc-p p-ven", r: 2.4 }, L.parts));
  pCsf = pool(8, () => mk("circle", { class: "sc-p p-csf", r: 2.0 }, evdG));
  pOsm = pool(12, () => mk("circle", { class: "sc-p p-osm", r: 1.8 }, L.parts));
}

function initPanels() {
  /* Monro-Kellie box: shared volume bar, legend, volume pressure curve */
  mk("rect", { class: "dr-panel", x: 584, y: 44, width: 362, height: 196, rx: 8 }, L.monro);
  const MB = { x: 592, y: 80, w: 346, h: 16 };
  mk("rect", { class: "dr-panel", x: MB.x, y: MB.y, width: MB.w, height: MB.h, rx: 4 }, L.monro);
  bBrain = mk("rect", { class: "mk-brain", x: MB.x, y: MB.y, width: 270, height: MB.h }, L.monro);
  bCsf = mk("rect", { class: "mk-csf", x: MB.x + 270, y: MB.y, width: 38, height: MB.h }, L.monro);
  bVen = mk("rect", { class: "mk-blood", x: MB.x + 308, y: MB.y, width: 38, height: MB.h }, L.monro);
  bMass = mk("rect", { class: "mk-mass", x: MB.x + 346, y: MB.y, width: 0, height: MB.h }, L.monro);
  [["Brain", "mk-brain", 624], ["CSF", "mk-csf", 712], ["Blood", "mk-blood", 800], ["Mass", "mk-mass", 888]].forEach(([name, cls, lx]) => {
    mk("rect", { class: cls, x: lx - 16, y: 101, width: 10, height: 10, rx: 2 }, L.monro);
    const lt = mk("text", { class: "dr-pt2", x: lx, y: 110 }, L.monro);
    lt.textContent = name;
  });
  const CV = { x: 592, y: 120, w: 338, h: 108 };
  mk("rect", { class: "dr-panel", x: CV.x, y: CV.y, width: CV.w, height: CV.h, rx: 6 }, L.monro);
  [138, 156, 174, 192, 210].forEach((gy) => mk("line", { class: "icp-grid", x1: CV.x, y1: gy, x2: CV.x + CV.w, y2: gy }, L.monro));
  [672, 752, 832].forEach((gx) => mk("line", { class: "icp-grid", x1: gx, y1: CV.y, x2: gx, y2: CV.y + CV.h }, L.monro));
  const ch = mk("text", { class: "dr-pt2", x: CV.x + 8, y: CV.y + 14 }, L.monro);
  ch.textContent = "Volume pressure curve";
  mk("path", { class: "icp-curve", d: "M607 218 C740 218 800 212 838 192 S915 140 923 132" }, L.monro);
  dotEl = mk("circle", { cx: 607, cy: 218, r: 5, fill: "var(--c-bad)", stroke: "var(--anatomy-paper)", "stroke-width": 1.5 }, L.monro);

  /* alarms box: arterial versus intracranial bars, pupil word, vital traces */
  mk("rect", { class: "dr-panel", x: 584, y: 246, width: 362, height: 194, rx: 8 }, L.alarm);
  mapBar = mk("rect", { class: "dr-g-fill g-good", x: 592, y: 284, width: 200, height: 9, rx: 2 }, L.alarm);
  icpBar = mk("rect", { class: "dr-g-fill g-bad", x: 592, y: 295, width: 60, height: 9, rx: 2 }, L.alarm);
  cppTxt = mk("text", { class: "dr-pt2", x: 938, y: 297, "text-anchor": "end" }, L.alarm);
  cppTxt.textContent = "flow adequate";
  trBp = mk("path", { class: "icp-trace-bp" }, L.alarm);
  trHr = mk("path", { class: "icp-trace-hr" }, L.alarm);
  trResp = mk("path", { class: "icp-trace-resp" }, L.alarm);
  [["BP", 332, "var(--c-rbc)"], ["Pulse", 370, "var(--c-good)"], ["Breath", 406, "var(--c-cyt)"]].forEach(([name, ly, col]) => {
    const lt = mk("text", { class: "dr-pt2", x: 706, y: ly, fill: col }, L.alarm);
    lt.textContent = name;
  });

  /* eight short pills; drain and flap only show while their treatment runs */
  const o = L.over;
  pill(o, "Skull", 150, 100, 185, 58, "The rigid skull. It cannot stretch, so any extra volume inside raises pressure.");
  pill(o, "Brain", 250, 262, 150, 345, "The brain. A growing mass squeezes it and pushes it down toward the skull base.");
  pill(o, "Mass", massC[0], massC[1], 330, 120, "A growing mass or swelling. It takes up room meant for brain, blood and fluid.");
  pill(o, "Shift", 470, 320, 558, 360, "Shift. The brain is pushed sideways and down toward the base of the skull.");
  pillDrain = pill(o, "Drain", 150, 108, 150, 140, "A drain tube in the fluid spaces. Open fluid drains out and pressure falls.");
  pillDrain.style.opacity = "0";
  pillFlap = pill(o, "Flap open", 455, 112, 470, 60, "Bone flap removed. The swollen brain has room to bulge outward.");
  pillFlap.style.opacity = "0";
  pill(o, "Pupil", 628, 362, 596, 396, "The pupil. Pressure on the third nerve makes it wide and unreactive.");
  pill(o, "Alarm", 820, 340, 810, 262, "Body alarms. A failing brainstem raises blood pressure and slows pulse and breathing.");

  capEl = mk("text", { class: "icp-cap", x: 280, y: 428 }, o);
  capEl.textContent = capText(0);

  /* gauges */
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P);
  t.textContent = "The patient";
  [
    ["icp", "ICP", "g-bad", "Pressure inside the skull. Rises steeply once spare room runs out."],
    ["cpp", "CPP", "g-good", "Blood pushing into the brain. Falls as intracranial pressure rises."],
    ["comp", "Compliance", "g-good", "Spare room inside the skull. Gone once blood and fluid are squeezed out."],
    ["shift", "Shift", "g-clot", "How far the brain is pushed across and down by the mass."],
    ["hernia", "Herniation", "g-bad", "Brain squeezed toward the skull base, pressing the brainstem."],
    ["cush", "Cushing", "g-cyt", "Last resort reflex. High blood pressure with slow pulse and uneven breathing."],
  ].forEach(([id, name, cls, tip], i) => {
    gg[id] = gauge(P, 100 + i * 145, y0, 60, 18, cls, name, tip);
  });
}

function init() { initOrgans(); initPanels(); }

function updateBrain() {
  const dx = sm.shift * 14, dy = sm.hernia * 12;
  L.brainMove.setAttribute("transform", "translate(" + f1(dx) + " " + f1(dy) + ")");

  /* mass core and water halo shrink with osmotic therapy and evacuation */
  const mR = 10 + 42 * sm.mass;
  massEl.setAttribute("rx", f1(Math.max(0.5, mR)));
  massEl.setAttribute("ry", f1(Math.max(0.5, mR * 0.85)));
  massEl.setAttribute("opacity", clamp(sm.mass * 1.6).toFixed(2));
  const oR = mR * 1.5 * (1 - 0.3 * sm.osm);
  haloEl.setAttribute("rx", f1(Math.max(0.5, oR)));
  haloEl.setAttribute("ry", f1(Math.max(0.5, oR * 0.85)));
  haloEl.setAttribute("opacity", clamp(sm.mass).toFixed(2));
  glowEl.setAttribute("opacity", (sm.icp * 0.38).toFixed(2));

  /* shift arrow grows and lengthens as the brain is pushed down */
  const ax = 470 + dx, y1 = 296 + dy * 0.5, y2 = 330 + sm.hernia * 22;
  arrowEl.setAttribute("d", "M" + f1(ax) + " " + f1(y1) + " L" + f1(ax) + " " + f1(y2)
    + " M" + f1(ax - 8) + " " + f1(y2 - 8) + " L" + f1(ax) + " " + f1(y2) + " L" + f1(ax + 8) + " " + f1(y2 - 8));
  arrowEl.setAttribute("opacity", clamp((sm.shift - 0.15) * 1.8).toFixed(2));
  coneEl.setAttribute("opacity", clamp((sm.hernia - 0.1) * 2).toFixed(2));

  /* devices: flap lifts, wedge slides in, drain appears, vein widens */
  flapEl.setAttribute("transform", "translate(" + f1(sm.decomp * 34) + " " + f1(-sm.decomp * 16) + ") rotate(" + f1(sm.decomp * 24) + " 462 112)");
  bulgeEl.setAttribute("opacity", clamp(sm.decomp * 1.2).toFixed(2));
  wedgeEl.setAttribute("opacity", clamp(sm.headUp * 1.2).toFixed(2));
  evdG.setAttribute("opacity", clamp(sm.evd * 1.2).toFixed(2));
  veinPath.setAttribute("stroke-width", f1(3 + 3 * sm.headUp));
  const fh = 6 + 16 * sm.evd;
  fluidEl.setAttribute("y", f1(122 - fh));
  fluidEl.setAttribute("height", f1(fh));
  pillDrain.style.opacity = clamp(sm.evd * 1.2).toFixed(2);
  pillFlap.style.opacity = clamp(sm.decomp * 1.2).toFixed(2);

  /* pupil blows as herniation squeezes the third nerve */
  apEl.setAttribute("r", f1(4.5 + sm.hernia * 10.5));
  const pWord = sm.hernia > 0.45 ? "blown" : sm.hernia > 0.15 ? "sluggish" : "reactive";
  if (apWord.textContent !== pWord) apWord.textContent = pWord;
}

function updateMonro() {
  const MB = { x: 592, w: 346 };
  const mFrac = clamp(sm.mass * 0.24);
  const cFrac = clamp(0.10 * (1 - sm.mass * 1.05 + 0.45 * sm.evd));
  const vFrac = clamp(0.10 * (1 - sm.mass * 1.0 + 0.30 * sm.headUp));
  const bFrac = clamp(1 - (mFrac + cFrac + vFrac));
  const wBrain = bFrac * MB.w, wCsf = cFrac * MB.w, wVen = vFrac * MB.w, wMass = mFrac * MB.w;
  bBrain.setAttribute("width", f1(wBrain));
  bCsf.setAttribute("x", f1(MB.x + wBrain));
  bCsf.setAttribute("width", f1(wCsf));
  bVen.setAttribute("x", f1(MB.x + wBrain + wCsf));
  bVen.setAttribute("width", f1(wVen));
  bMass.setAttribute("x", f1(MB.x + wBrain + wCsf + wVen));
  bMass.setAttribute("width", f1(wMass));

  const uVol = clamp(mFrac / 0.24);
  const dotX = 607 + uVol * 308;
  const curveNorm = Math.pow(uVol, 2.6);
  const dotY = 218 - clamp(curveNorm * (1 - sm.decomp * 0.65)) * 78;
  dotEl.setAttribute("cx", f1(dotX));
  dotEl.setAttribute("cy", f1(dotY));
  dotEl.setAttribute("fill", sm.icp > 0.58 ? "var(--c-bad)" : sm.icp > 0.26 ? "var(--c-neut)" : "var(--c-good)");
}

function updateAlarm() {
  mapBar.setAttribute("width", f1(clamp(sm.map) * 258));
  icpBar.setAttribute("width", f1(clamp(sm.icp) * 258));
  const flowWord = "flow " + (sm.cpp < 0.35 ? "failing" : sm.cpp < 0.54 ? "threatened" : "adequate");
  if (cppTxt.textContent !== flowWord) cppTxt.textContent = flowWord;
  const cshAct = sm.cushing;
  const bpAmp = 6 + cshAct * 9, bpBase = 330 - cshAct * 7;
  const hrRate = 1.0 - cshAct * 0.55, hrBase = 370;
  const respBase = 406, respAmp = Math.max(2, 6 * (1 - cshAct * 0.6));
  let dBp = "", dHr = "", dResp = "";
  for (let x = 762; x <= 932; x += 3) {
    const age = (932 - x) / 60, t = tm / 1000 - age;
    const pBp = ((t * 1.3) % 1 + 1) % 1;
    const yBp = bpBase - bpAmp * (pBp < 0.25 ? Math.sin(pBp / 0.25 * Math.PI) : -0.2 * Math.sin((pBp - 0.25) / 0.75 * Math.PI));
    dBp += (x === 762 ? "M" : "L") + x + " " + f1(yBp);
    const pHr = ((t * hrRate * 1.4) % 1 + 1) % 1;
    let yHr = hrBase;
    if (pHr > 0.20 && pHr < 0.24) yHr -= 12;
    else if (pHr >= 0.24 && pHr < 0.28) yHr += 4;
    dHr += (x === 762 ? "M" : "L") + x + " " + f1(yHr);
    const pResp = ((t * 0.35) % 1 + 1) % 1;
    const irreg = cshAct > 0.4 ? 0.4 * Math.sin(t * 1.8) : 0;
    dResp += (x === 762 ? "M" : "L") + x + " " + f1(respBase + respAmp * Math.sin(pResp * 6.283 + irreg));
  }
  trBp.setAttribute("d", dBp);
  trHr.setAttribute("d", dHr);
  trResp.setAttribute("d", dResp);
}

function updateFlow(dt) {
  /* arterial blood climbs into the head along the carotid track */
  acc.art += dt * 5;
  while (acc.art >= 1) {
    acc.art--;
    const p = free(pArt);
    if (p) { p.on = true; p.tr = trArt; p.u = 0; p.t = 0; p.e.setAttribute("opacity", "1"); }
  }
  pArt.forEach((p) => {
    if (!p.on) return;
    p.u += dt * 90 / p.tr.len;
    const q = p.tr.at(Math.min(1, p.u));
    p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")");
    if (p.u >= 1) kill(p);
  });
  /* venous blood leaves down the neck; head elevation speeds the drain */
  acc.ven += dt * (3 + 9 * sm.headUp);
  while (acc.ven >= 1) {
    acc.ven--;
    const p = free(pVen);
    if (p) { p.on = true; p.tr = trVein; p.u = 0; p.t = 0; p.e.setAttribute("opacity", "1"); }
  }
  pVen.forEach((p) => {
    if (!p.on) return;
    p.u += dt * (80 + 60 * sm.headUp) / p.tr.len;
    const q = p.tr.at(Math.min(1, p.u));
    p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")");
    if (p.u >= 1) kill(p);
  });
  /* drain chamber drips while the ventricular catheter is open */
  if (sm.evd > 0.3 && Math.random() < dt * 4) {
    const p = free(pCsf);
    if (p) emit(p, 71 + rnd(-2, 2), 78, 0, rnd(25, 45));
  }
  pCsf.forEach((p) => {
    if (!p.on) return;
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.t > 1.0 || p.y > 116) kill(p);
  });
  /* osmotic therapy draws water from the swollen rim into the blood */
  if (sm.osm > 0.3 && Math.random() < dt * sm.osm * 6) {
    const p = free(pOsm);
    if (p) emit(p, massC[0] + rnd(-30, 30), massC[1] + rnd(-30, 30), rnd(-15, 15), rnd(-15, 15));
  }
  pOsm.forEach((p) => {
    if (!p.on) return;
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2));
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
  updateBrain();
  updateMonro();
  updateAlarm();
  updateFlow(dt);
  gg.icp.set(sm.icp, wordOf(sm.icp, 0.26, 0.58, ["normal", "elevated", "critical"]));
  gg.cpp.set(sm.cpp, wordOf(sm.cpp, 0.35, 0.54, ["compromised", "threatened", "adequate"]));
  gg.comp.set(sm.compReserve, wordOf(sm.compReserve, 0.30, 0.65, ["exhausted", "reduced", "normal"]));
  gg.shift.set(sm.shift, sm.hernia > 0.45 ? "herniating" : sm.shift > 0.25 ? "midline shift" : "none");
  gg.hernia.set(sm.hernia, wordOf(sm.hernia, 0.20, 0.50, ["none", "impending", "severe"]));
  gg.cush.set(sm.cushing, wordOf(sm.cushing, 0.25, 0.60, ["absent", "impending", "active"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}

run({ init, step });
