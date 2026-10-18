/* Meningitis scene: entry from blood, meningeal rings, inflamed CSF, sample tube, neck sign and gauges. */
const CX = SC.CX, CY = SC.CY, WW = SC.W;
const L = { entry: $("entry"), skull: $("skull"), tube: $("csftube"), neck: $("neck"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { Org: 0.9, Inf: 0.9, Prot: 0.9, LowGlu: 0.85, Turb: 0.9, Icp: 0.8, Stiff: 0.85, neutFrac: 0.9, treat: 0 };
/* ---- static anatomy drawn once ---- */
let brainG = null, pusRing = null, arachEl = null, cloudyEl = null, fluidEl = null, headG = null, blockG = null, flexArrow = null;
const pressArrows = [], meningVess = [], tubeCells = [];
function initAnatomy() {
  /* entry vessel, left margin x 30-232 */
  mk("rect", { class: "mening-entry", x: 30, y: 228, width: 202, height: 34, rx: 17 }, L.entry);
  mk("path", { class: "mening-arrow", d: "M196 245L226 245M218 238L226 245L218 252" }, L.entry);
  /* CSF sample tube, inset x 685-932, y 58-226; tube x 788-828, y 92-192 */
  mk("rect", { class: "mening-tube", x: 788, y: 92, width: 40, height: 100, rx: 9 }, L.tube);
  fluidEl = mk("rect", { class: "mening-fluid", x: 791, y: 112, width: 34, height: 77, rx: 6, fill: "#7ab8ff", opacity: "0.28" }, L.tube);
  cloudyEl = mk("rect", { class: "mening-fluid", x: 791, y: 112, width: 34, height: 77, rx: 6, fill: "#e8d98a", opacity: "0.8" }, L.tube);
  for (let i = 0; i < 10; i++) { const c = mk("circle", { class: "sc-p p-med", r: 2.2, cx: 796 + (i % 3) * 11, cy: 124 + Math.floor(i / 3) * 18 }, L.tube); tubeCells.push(c); }
  mk("path", { class: "mening-arrow", d: "M808 84L808 92" }, L.tube);
  /* neck sign, inset x 685-932, y 240-420; head and shoulders end above y 390 */
  headG = mk("g", {}, L.neck);
  mk("circle", { class: "mening-head", cx: 775, cy: 302, r: 30 }, headG);
  mk("circle", { class: "mening-head", cx: 766, cy: 296, r: 3.2 }, headG);
  mk("path", { class: "mening-head", d: "M760 328L757 362L794 362L791 328" }, headG);
  mk("path", { class: "mening-arrow", d: "M722 378C748 366 802 366 828 378" }, L.neck);
  flexArrow = mk("path", { class: "mening-arrow", d: "M814 278C830 292 832 312 824 330M818 322L824 330L832 324" }, L.neck);
  blockG = mk("g", {}, L.neck);
  mk("path", { class: "mening-block", d: "M816 296L834 314M834 296L816 314" }, blockG);
  /* skull and meningeal rings: skull x 230-610, y 110-390 */
  mk("ellipse", { class: "mening-skull", cx: CX, cy: CY, rx: 190, ry: 140 }, L.skull);
  mk("ellipse", { class: "mening-dura", cx: CX, cy: CY, rx: 179, ry: 131 }, L.skull);
  arachEl = mk("ellipse", { class: "mening-arach", cx: CX, cy: CY, rx: 166, ry: 121 }, L.skull);
  pusRing = mk("ellipse", { class: "mening-pus", cx: CX, cy: CY, rx: 159, ry: 116, opacity: "0.6" }, L.skull);
  brainG = mk("g", {}, L.skull);
  mk("ellipse", { class: "mening-brain", cx: CX, cy: CY, rx: 152, ry: 110 }, brainG);
  const sulci = ["M310 205C340 190 370 200 395 185", "M300 265C335 250 365 262 400 248", "M445 185C475 200 505 192 535 208", "M440 250C475 238 505 250 540 236", "M350 305C385 292 420 304 455 290", "M480 300C505 290 525 298 545 288"];
  sulci.forEach((d) => mk("path", { class: "mening-sulcus", d }, brainG));
  mk("ellipse", { class: "mening-vent", cx: 396, cy: 248, rx: 17, ry: 9, transform: "rotate(-18 396 248)" }, brainG);
  mk("ellipse", { class: "mening-vent", cx: 444, cy: 248, rx: 17, ry: 9, transform: "rotate(18 444 248)" }, brainG);
  /* small meningeal vessels on the ring */
  [[330, 150], [420, 132], [510, 150], [300, 250], [545, 250]].forEach(([x, y]) => { const p = mk("path", { class: "mening-vess", d: "M" + (x - 16) + " " + y + "C" + (x - 5) + " " + (y - 8) + " " + (x + 5) + " " + (y + 8) + " " + (x + 16) + " " + y }, L.skull); meningVess.push(p); });
  /* pressure arrows outside the skull, pointing in */
  const arrows = ["M420 96L420 106M415 101L420 107L425 101", "M632 250L622 250M627 245L621 250L627 255", "M420 404L420 394M415 399L420 393L425 399"];
  arrows.forEach((d) => { const p = mk("path", { class: "mening-arrow", d }, L.skull); pressArrows.push(p); });
}
/* ---- red cells in the entry vessel ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 8; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.entry); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(38, 224), y: rnd(236, 254), v: rnd(0.8, 1.2) }); } }
/* ---- organisms: blood first, then the CSF ring ---- */
const ORG_N = 34, orgs = [];
function initOrgs() { for (let i = 0; i < ORG_N; i++) { const g = mk("g", { class: "cl cl-bac" }, L.parts); if (i % 3 === 0) { mk("ellipse", { class: "cl-b", rx: 5.6, ry: 2.8 }, g); } else { mk("circle", { class: "cl-b", r: 3.4, cx: -2.4 }, g); mk("circle", { class: "cl-b", r: 3.4, cx: 2.4 }, g); } orgs.push({ g, off: i / ORG_N, a: rnd(0, 6.28), s: 0 }); } }
/* ---- white cells riding in the CSF ring ---- */
const neuts = [], lymphs = [];
function initCells() {
  for (let i = 0; i < 14; i++) { const g = cell(L.skull, { cls: "neut", r: 9, nuc: 0.55, nucCls: "multi", seed: i + 3, wob: 0.13 }); neuts.push({ g, a: (i / 14) * 6.2832, s: 0 }); }
  for (let i = 0; i < 12; i++) { const g = cell(L.skull, { cls: "lymph", r: 7, nuc: 0.6, seed: i + 30, wob: 0.07 }); lymphs.push({ g, a: (i / 12) * 6.2832 + 0.26, s: 0 }); }
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0 }; }); }
const meds = pool(30, () => mk("circle", { class: "sc-p p-med", r: 2.3 }, L.parts));
const treats = pool(10, () => mk("path", { class: "sc-p p-treat", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, L.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [130, 270, 410, 550, 690, 830];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["org", "Organisms", "g-bac", "How many organisms are living in the cerebrospinal fluid."], ["inf", "Inflammation", "g-cyt", "White cells and inflammatory signals in the meninges and fluid."], ["prot", "Protein", "g-prot", "Protein leaks from blood into the fluid when the barrier is inflamed. It is high in bacterial and tuberculous disease."], ["glu", "Glucose fall", "g-glu", "How far cerebrospinal fluid glucose has fallen. It falls in bacterial and tuberculous disease and stays normal in most viral disease."], ["icp", "Pressure", "g-icp", "Pressure inside the skull. Inflammation, swelling and blocked fluid flow raise it."], ["stiff", "Stiffness", "g-stiff", "Neck stiffness from irritation of the meninges. Bending the neck stretches them and is resisted."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h - 18, 18, cls, name, tip); });
  const o = L.over;
  /* Pill centres checked in the header plan of mening.mjs: none overlap each other. */
  pill(o, "Organism", 100, 245, 105, 100, "The infecting organism. Bacteria, viruses and the tuberculosis bacillus can all reach the meninges.");
  pill(o, "Bloodstream", 62, 245, 105, 155, "Most organisms reach the meninges through the blood. Some spread directly from nearby infected sinuses or ears.");
  pill(o, "Meninges", CX, 116, 390, 78, "The three membranes around the brain: dura outside, arachnoid in the middle and pia on the brain surface.");
  pill(o, "CSF space", 545, 150, 510, 78, "The subarachnoid space between arachnoid and pia. It holds cerebrospinal fluid, and this is where the inflammation collects.");
  pill(o, "Cells in CSF", 268, 318, 150, 350, "White cells in the fluid: mostly neutrophils in bacterial disease, mostly lymphocytes in viral and tuberculous disease.");
  pill(o, "Raised pressure", CX, 386, 420, 420, "Raised pressure inside the skull from inflammation, swelling and poor fluid drainage. It can reduce brain perfusion.");
  pill(o, "CSF sample", 808, 190, 808, 210, "Fluid obtained for testing. Cloudy in bacterial disease, clearer in viral disease. Protein, glucose, cells and microbiology guide the picture.");
  pill(o, "Neck stiffness", 775, 340, 808, 405, "Neck stiffness: inflamed meninges resist stretching when the neck is bent, a classic sign of meningeal irritation.");
}
const acc = { med: 0, treat: 0 };
function init() { initAnatomy(); initRbc(); initOrgs(); initCells(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.Org = lerp(sm.Org, m.Org, k2); sm.Inf = lerp(sm.Inf, m.Inf, k2); sm.Prot = lerp(sm.Prot, m.Prot, k2); sm.LowGlu = lerp(sm.LowGlu, m.LowGlu, k2); sm.Turb = lerp(sm.Turb, m.Turb, k2); sm.Icp = lerp(sm.Icp, m.Icp, k1); sm.Stiff = lerp(sm.Stiff, m.Stiff, k1); sm.neutFrac = lerp(sm.neutFrac, m.neutFrac, k2); sm.treat = lerp(sm.treat, (m.abx || m.ster || m.anti) ? 1 : 0, k1);
  /* rings, pus layer and brain swelling with pressure */
  pusRing.setAttribute("stroke-width", f1(3 + 11 * sm.Turb)); pusRing.setAttribute("opacity", (sm.Turb * 0.65).toFixed(2));
  arachEl.setAttribute("opacity", (0.55 + 0.45 * sm.Turb).toFixed(2));
  const bs = 1 + 0.035 * sm.Icp;
  brainG.setAttribute("transform", "translate(" + f1(CX) + " " + f1(CY) + ") scale(" + bs.toFixed(3) + ") translate(" + f1(-CX) + " " + f1(-CY) + ")");
  meningVess.forEach((p) => p.setAttribute("opacity", (0.25 + 0.75 * sm.Inf).toFixed(2)));
  pressArrows.forEach((p) => p.setAttribute("opacity", sm.Icp.toFixed(2)));
  /* red cells flow in the entry vessel */
  rbcs.forEach((r) => { r.x += r.v * 46 * dt; if (r.x > 226) r.x = 36; place(r.g, r.x, r.y, Math.sin(tm / 500 + r.x) * 8, 1); });
  /* organisms: first part of each cycle in blood, then orbiting in the CSF ring */
  const want = Math.round(sm.Org * ORG_N);
  orgs.forEach((b, i) => { const on = i < want; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * 1.6));
    const u = (tm / 14000 + b.off) % 1;
    if (u < 0.3) { const f = u / 0.3; place(b.g, 42 + f * 180, 245 + Math.sin(tm / 300 + i) * 5, Math.sin(tm / 400 + i) * 20, b.s); }
    else { const a = b.a + (u - 0.3) * 4 + tm / 9000; place(b.g, CX + Math.cos(a) * 159, CY + Math.sin(a) * 116, a * 57.3, b.s); }
    b.g.style.opacity = b.s > 0.04 ? 1 : 0; });
  /* white cells in the CSF ring: mix follows the type of meningitis */
  const nNeu = Math.round(sm.Inf * sm.neutFrac * neuts.length), nLym = Math.round(sm.Inf * (1 - sm.neutFrac) * lymphs.length * 1.6);
  neuts.forEach((c, i) => { const on = i < nNeu; c.s = lerp(c.s, on ? 1 : 0, Math.min(1, dt * 1.4)); const a = c.a + tm / 7000; place(c.g, CX + Math.cos(a) * 159, CY + Math.sin(a) * 116, Math.sin(tm / 500 + i) * 10, c.s); c.g.style.opacity = c.s > 0.05 ? 1 : 0; });
  lymphs.forEach((c, i) => { const on = i < Math.min(lymphs.length, nLym); c.s = lerp(c.s, on ? 1 : 0, Math.min(1, dt * 1.4)); const a = c.a - tm / 8000; place(c.g, CX + Math.cos(a) * 159, CY + Math.sin(a) * 116, 0, c.s); c.g.style.opacity = c.s > 0.05 ? 1 : 0; });
  /* inflammatory mediators drift in the CSF ring */
  acc.med += dt * sm.Inf * 8; while (acc.med >= 1) { acc.med--; const p = free(meds); if (p) { const a = rnd(0, 6.28); emit(p, CX + Math.cos(a) * 166, CY + Math.sin(a) * 121, -Math.cos(a) * 10, -Math.sin(a) * 8); } }
  meds.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.2) kill(p); });
  /* treatment particles travel from blood to the CSF ring */
  acc.treat += dt * sm.treat * 3; while (acc.treat >= 1) { acc.treat--; const p = free(treats); if (p) emit(p, 44, 245, 0, 0); }
  treats.forEach((p) => { if (!p.on) return; p.t += dt; const tx = CX - 159, ty = CY; p.x += (tx - p.x) * dt * 0.55 + 20 * dt; p.y += (ty - p.y) * dt * 0.7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  /* CSF sample: cloudiness and cells follow the fluid picture */
  cloudyEl.setAttribute("opacity", (sm.Turb * 0.85).toFixed(2));
  tubeCells.forEach((c, i) => c.setAttribute("opacity", (i / tubeCells.length < sm.Inf ? 0.9 : 0.08).toFixed(2)));
  /* neck sign: the head tilts only a little when the neck is stiff */
  const tilt = -(1 - sm.Stiff) * 9 + Math.sin(tm / 900) * (1 - sm.Stiff) * 2;
  headG.setAttribute("transform", "rotate(" + f1(tilt) + " 775 335)");
  flexArrow.setAttribute("opacity", (0.35 + 0.65 * (1 - sm.Stiff)).toFixed(2));
  blockG.setAttribute("opacity", sm.Stiff.toFixed(2));
  /* gauges */
  gg.org.set(sm.Org, wordOf(sm.Org, 0.2, 0.55, ["few", "present", "many"])); gg.inf.set(sm.Inf, wordOf(sm.Inf, 0.3, 0.62, ["low", "raised", "high"])); gg.prot.set(sm.Prot, wordOf(sm.Prot, 0.3, 0.65, ["normal", "raised", "high"]));
  gg.glu.set(sm.LowGlu, wordOf(sm.LowGlu, 0.25, 0.6, ["normal", "reduced", "low"])); gg.icp.set(sm.Icp, wordOf(sm.Icp, 0.3, 0.62, ["normal", "raised", "high"])); gg.stiff.set(sm.Stiff, wordOf(sm.Stiff, 0.3, 0.62, ["supple", "stiff", "very stiff"]));
}
run({ init, step });
