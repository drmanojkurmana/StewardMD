/* Endometriosis scene: uterus with implants, cyclical bleeding, inflammation, adhesions, chocolate cyst, pain and treatments. */
const L = { cells: $("cells"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel") };
let uterusO = null, UP = null, capEl = null, capDrug = -1;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const cellP = pool(22, () => mk("circle", { class: "sc-p p-cell", r: 2.6 }, L.parts));
const medP = pool(26, () => mk("circle", { class: "sc-p p-med", r: 2.3 }, L.parts));
const dropP = pool(26, () => mk("path", { class: "p-drop", d: "M0 -3.6C2.4 -.6 3 1 3 2A3 3 0 0 1 -3 2C-3 1 -2.4 -.6 0 -3.6Z" }, L.parts));
function capsuleG(parent) { const g = mk("g", {}, parent); mk("rect", { class: "p-pill", x: -7, y: -3.5, width: 14, height: 7, rx: 3.5 }, g); mk("rect", { class: "p-pill2", x: 0, y: -3.5, width: 7, height: 7, rx: 3.5 }, g); return g; }
const capP = pool(10, () => capsuleG(L.parts));
const hormP = pool(12, () => capsuleG(L.parts));
function capText(d) {
  if (d === 1) return "Pain relief blocks pain signals. Implants and cyst stay the same.";
  if (d === 2) return "Hormonal treatment pauses the cycle. Bleeding stops and implants shrink.";
  if (d === 3) return "Surgery removes implants and the cyst. Pain eases and fertility improves.";
  return "No treatment. Implants bleed with each cycle, causing pain.";
}
/* implant clusters on the peritoneum, clear of the uterus body, tubes and ovaries */
const IMP = [[218, 330], [300, 378], [672, 346], [736, 302], [580, 398], [258, 282]];
let impEls = [], healEls = [], adhEls = [], flashEls = [], waveEls = [], dockEls = [], cystG = null, cystC = [629, 252], DOCKS = [];
function xmark(x, y, r) { const g = mk("g", { opacity: 0 }, L.marks); mk("circle", { class: "end-x", cx: x, cy: y, r: r }, g); mk("path", { class: "end-xx", d: "M" + (x - 5) + " " + (y - 5) + "l10 10M" + (x + 5) + " " + (y - 5) + "l-10 10" }, g); return g; }
let markEls = [];
function init() {
  uterusO = organ($("uterusSlot"), "uterus", 480, 285, 330, {});
  UP = uterusO.ports;
  cystC = [UP.ovR[0], UP.ovR[1]];
  DOCKS = [[UP.fundus[0], UP.fundus[1] - 9], [UP.ovL[0], UP.ovL[1] - 8], [UP.ovR[0], UP.ovR[1] - 8]];
  const C = L.cells;
  /* soft inflammation halos behind the implant fields */
  [[255, 330, 110, 70], [695, 335, 120, 75]].forEach(([x, y, rx, ry]) => mk("ellipse", { class: "end-halo", cx: x, cy: y, rx: rx, ry: ry, opacity: 0 }, C));
  /* cyclical waves leaving the uterus, stilled by hormonal suppression */
  waveEls = [0, 1].map(() => mk("ellipse", { class: "end-wave", cx: 480, cy: 295, rx: 150, ry: 125, opacity: 0 }, C));
  /* hormone receptors on fundus and ovaries; blockers dock here */
  DOCKS.forEach(([x, y]) => mk("path", { class: "end-rec", d: "M" + (x - 8) + " " + y + " A8 8 0 0 1 " + (x + 8) + " " + y }, C));
  dockEls = DOCKS.map(([x, y]) => { const g = mk("g", { opacity: 0 }, C); mk("rect", { class: "end-dock", x: x - 7, y: y - 10, width: 14, height: 7, rx: 3.5 }, g); return g; });
  /* implant clusters */
  impEls = IMP.map(([x, y]) => { const g = mk("g", {}, C);
    [[0, 0, 8], [-10, 6, 5.5], [9, 7, 6]].forEach(([dx, dy, r]) => mk("circle", { class: "end-implant", cx: f1(dx), cy: f1(dy), r: r }, g));
    return { g, x, y }; });
  /* pale healing beds left where surgery cleared implants */
  healEls = IMP.map(([x, y]) => { const e = mk("ellipse", { class: "end-heal", cx: x, cy: y, rx: 13, ry: 11, opacity: 0 }, C); return e; });
  /* adhesions: ovary to uterus on both sides, uterus to peritoneum, implant field to peritoneum */
  adhEls = [
    mk("path", { class: "end-adh", d: "M" + f1(UP.ovL[0]) + " " + f1(UP.ovL[1] + 18) + "C370 300 400 300 432 295" }, C),
    mk("path", { class: "end-adh", d: "M" + f1(UP.ovR[0]) + " " + f1(UP.ovR[1] + 18) + "C590 300 560 300 528 295" }, C),
    mk("path", { class: "end-adh", d: "M468 388C460 400 452 402 444 400" }, C),
    mk("path", { class: "end-adh", d: "M665 358C655 378 640 388 620 390" }, C),
  ];
  /* the endometrioma over the right ovary */
  cystG = mk("g", {}, C);
  mk("circle", { class: "end-cyst", cx: f1(cystC[0]), cy: f1(cystC[1]), r: 22 }, cystG);
  mk("circle", { class: "end-cyst-in", cx: f1(cystC[0]), cy: f1(cystC[1]), r: 12 }, cystG);
  /* pain flashes near the uterus and the implant fields */
  flashEls = [
    mk("path", { class: "end-pain", d: "M196 296L208 310L196 324L210 338", opacity: 0 }, C),
    mk("path", { class: "end-pain", d: "M548 296L560 310L548 324L562 338", opacity: 0 }, C),
    mk("path", { class: "end-pain", d: "M700 300L712 314L700 328L714 342", opacity: 0 }, C),
    mk("path", { class: "end-pain", d: "M288 344L300 358L288 372L302 386", opacity: 0 }, C),
  ];
  /* surgery crosses over the cyst and two implant fields */
  markEls = [xmark(cystC[0], cystC[1], 12), xmark(672, 346, 10), xmark(218, 330, 10)];
  /* six short pills: three above the anatomy, three below; caption carries the story */
  const O = L.over;
  pill(O, "Ovary", 322, 240, 200, 168, "The ovary. Implants on or in it, and adhesions around it, can reduce fertility. A blood filled cyst inside it is an endometrioma.");
  pill(O, "Tube", 379, 242, 470, 168, "The fallopian tube. Menstrual tissue can pass back through it into the pelvis, and adhesions can later distort it.");
  pill(O, "Cyst", cystC[0], cystC[1] - 20, 700, 168, "An endometrioma, often called a chocolate cyst: old blood from implants bleeding inside the ovary again and again.");
  pill(O, "Implants", 218, 330, 250, 412, "Implants of tissue like the womb lining, growing outside the uterus. They bleed with each cycle, causing period pain and pain during sex.");
  pill(O, "Uterus", 438, 330, 390, 412, "The uterus. Its lining is shed each cycle; in endometriosis, similar tissue also grows outside it and bleeds there.");
  pill(O, "Adhesions", 643, 374, 640, 412, "Adhesions: bands of scar tissue from repeated inflammation. They stick organs together and can distort the tubes and ovaries.");
  capEl = mk("text", { class: "end-cap", x: 30, y: 434 }, O); capEl.textContent = capText(0);
  const P = L.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["impl", "Implants", "g-bad", "How much tissue like the womb lining is growing outside the uterus."], ["infl", "Inflammation", "g-infl", "Inflammation around implants as they bleed with each cycle."], ["adh", "Adhesions", "g-adh", "Scar bands sticking organs together after repeated bleeding and inflammation."], ["cyst", "Cyst", "g-cyst", "An endometrioma in the ovary, a cyst of old blood from repeated bleeding."], ["pain", "Pain", "g-pain", "Pain: period pain, pain during sex and chronic pelvic pain. Pain relief lowers this without changing the implants."], ["fert", "Subfertility", "g-fert", "Reduced fertility from adhesions distorting the tubes and ovaries, cysts and inflammation. Higher means more reduced."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
}
const gg = {};
const sm = { impl: 0.4, infl: 0.3, adh: 0.2, cyst: 0.2, pain: 0.3, fert: 0.2, analg: 0, horm: 0, surg: 0 };
const acc = { cell: 0, med: 0, drop: 0, cap: 0, horm: 0 };
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9);
  ["impl", "infl", "adh", "cyst", "pain", "fert", "analg", "horm", "surg"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  /* inflammation halos breathe with burden and settle with treatment */
  L.cells.querySelectorAll(".end-halo").forEach((e, i) => e.setAttribute("opacity", (0.42 * sm.infl * (1 + 0.08 * Math.sin(tm / 800 + i * 2))).toFixed(2)));
  /* cycle waves expand from the uterus unless hormonal treatment pauses cycling */
  waveEls.forEach((e, i) => { const fr = ((tm / 2600) + i * 0.5) % 1, sc = 1 + fr * 0.12;
    place(e, 480, 295, 0, sc); e.setAttribute("opacity", ((1 - fr) * 0.4 * (1 - sm.horm)).toFixed(2)); });
  /* blockers parked on their receptors while hormonal treatment is on */
  dockEls.forEach((e) => e.setAttribute("opacity", sm.horm.toFixed(2)));
  /* implants grow and pulse with the cycle, stilled and shrunk by hormonal treatment */
  impEls.forEach((e, i) => { const s = clamp((sm.impl - 0.06 * i) * 1.5) * (1 + 0.06 * Math.sin(tm / 600 + i * 1.7) * (1 - sm.horm));
    place(e.g, e.x, e.y, 0, 0.15 + 0.85 * s); e.g.style.opacity = s > 0.04 ? 1 : 0; });
  /* healing beds appear where surgery cleared implants */
  healEls.forEach((e, i) => { const gone = clamp((0.35 - (sm.impl - 0.06 * i)) * 3);
    e.setAttribute("opacity", (sm.surg * gone).toFixed(2)); });
  adhEls.forEach((e) => e.setAttribute("opacity", (0.15 + 0.7 * sm.adh).toFixed(2)));
  const cs = clamp(sm.cyst * 1.5);
  cystG.setAttribute("transform", "translate(" + f1(cystC[0] - cystC[0] * cs) + " " + f1(cystC[1] - cystC[1] * cs) + ") scale(" + cs.toFixed(3) + ")");
  cystG.style.opacity = cs > 0.04 ? 1 : 0;
  /* pain flashes blink with pain and fade when pain relief blocks the signal */
  flashEls.forEach((e, i) => e.setAttribute("opacity", (sm.pain * (0.3 + 0.7 * Math.abs(Math.sin(tm / 300 + i * 2.1)))).toFixed(2)));
  markEls.forEach((e) => e.setAttribute("opacity", sm.surg.toFixed(2)));
  /* tissue cells spill from the tube ends toward the implant fields */
  acc.cell += dt * (2 + 6 * sm.impl) * (1 - 0.5 * sm.horm);
  while (acc.cell >= 1) { acc.cell--; const p = free(cellP);
    if (p) { const left = Math.random() < 0.5; emit(p, left ? UP.ovL[0] - 18 : UP.ovR[0] + 18, 262, left ? -rnd(8, 18) : rnd(8, 18), rnd(14, 26), 0); } }
  cellP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 60, 900); p.y = clamp(p.y, 150, 425);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.2) kill(p); });
  /* inflammatory signals rise from the implants */
  acc.med += dt * sm.infl * 9;
  while (acc.med >= 1) { acc.med--; const p = free(medP); if (p) { const s = pick(IMP); emit(p, s[0] + rnd(-8, 8), s[1] - 6, rnd(-5, 5), -rnd(14, 26), 0); } }
  medP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 60, 900); p.y = clamp(p.y, 150, 425);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.4).toFixed(2)); if (p.t > 2.4) kill(p); });
  /* cyclical bleeding: drops fall from implants unless cycling is paused */
  acc.drop += dt * sm.infl * (1 - 0.8 * sm.horm) * 8;
  while (acc.drop >= 1) { acc.drop--; const p = free(dropP); if (p) { const s = pick(IMP); emit(p, s[0] + rnd(-7, 7), s[1] + 8, rnd(-3, 3), rnd(12, 22), 0); } }
  dropP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.y = clamp(p.y, 150, 425);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.8) kill(p); });
  /* pain relief capsules travel to the uterus and damp the pain signal */
  acc.cap += dt * sm.analg * 2.6;
  while (acc.cap >= 1) { acc.cap--; const p = free(capP); if (p) emit(p, rnd(30, 90), 300, 0, 0, 0); }
  capP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (470 - p.x) * dt * 0.55 + 20 * dt; p.y += (300 - p.y) * dt * 0.7;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 90) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  /* hormonal capsules travel to the fundus and ovaries and park on their receptors */
  acc.horm += dt * sm.horm * 3;
  while (acc.horm >= 1) { acc.horm--; const p = free(hormP); if (p) emit(p, rnd(860, 920), 300, 0, 0, Math.floor(rnd(0, 3))); }
  hormP.forEach((p) => { if (!p.on) return; p.t += dt; const D = DOCKS[p.k];
    p.x += (D[0] - p.x) * dt * 0.8 - 20 * dt; p.y += (D[1] - p.y) * dt * 0.9;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(-p.t * 90) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  gg.impl.set(sm.impl, wordOf(sm.impl, 0.3, 0.62, ["few", "scattered", "extensive"])); gg.infl.set(sm.infl, wordOf(sm.infl, 0.3, 0.6, ["quiet", "active", "severe"]));
  gg.adh.set(sm.adh, wordOf(sm.adh, 0.3, 0.6, ["none", "some", "dense"])); gg.cyst.set(sm.cyst, wordOf(sm.cyst, 0.22, 0.5, ["absent", "present", "large"]));
  gg.pain.set(sm.pain, wordOf(sm.pain, 0.28, 0.58, ["mild", "present", "severe"])); gg.fert.set(sm.fert, wordOf(sm.fert, 0.3, 0.6, ["preserved", "reduced", "markedly reduced"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
