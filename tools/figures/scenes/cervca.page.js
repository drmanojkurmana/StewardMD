/* Cervical cancer scene: HPV entry through a real cervix, basal infection, E6 and E7 action, CIN, invasion and treatment effects. */
const layers = { epi: $("epi"), nests: $("nests"), vessels: $("vessels"), mol: $("mol"), parts: $("parts"), treat: $("treat"), over: $("over"), panel: $("panel"), bm: $("bm") };
const gg = {};
const epiCells = [], nestG = [];
let uterusO = null, cervix = [150, 246];
let p53G = null, rbG = null, divG = null, coneEl = null, scanEl = null, abG = null, ringG = null, rayG = null;
let capEl = null, capKey = "";
function capText(l, d) {
  if (d === 3) return l === 2 ? "Surgery plus chemoradiation kills the cancer. Growth stops." : l === 1 ? "Surgery removes the abnormal cells with the tissue." : "Strong treatment is not needed at this early stage.";
  if (d === 2) return l === 2 ? "LEEP cannot remove deep cancer. Stronger treatment is needed." : "LEEP removes the abnormal patch. Healthy lining grows back.";
  if (d === 1) return l === 2 ? "Vaccine cannot clear cancer already present." : l === 1 ? "Vaccine plus screening finds abnormal cells early." : "Vaccine blocks HPV. Infection clears.";
  return l === 2 ? "No treatment. Cancer breaks through and spreads below." : l === 1 ? "No treatment. Abnormal cells fill the lining." : "No treatment. HPV infects the lining and abnormal cells appear.";
}
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, tt: 0, trap: false, tx: 0, ty: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, tx, ty) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.tt = 0; p.trap = false; p.tx = tx || 0; p.ty = ty || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const hpvP = pool(24, () => mk("circle", { class: "sc-p p-hpv", r: 3 }, layers.parts));
const e6P = pool(12, () => mk("circle", { class: "sc-p p-e6", r: 2.6 }, layers.parts));
const e7P = pool(12, () => mk("circle", { class: "sc-p p-e7", r: 2.6 }, layers.parts));
const chemoP = pool(14, () => mk("circle", { class: "sc-p p-chemo", r: 2.6 }, layers.parts));
function initOrgans() {
  uterusO = organ($("uterusSlot"), "uterus", 150, 185, 185, {});
  cervix = uterusO.ports.out;
  $("canal").setAttribute("d", "M" + f1(cervix[0]) + " " + f1(cervix[1]) + " C" + f1(cervix[0] + 60) + " " + f1(cervix[1] + 12) + " " + f1(cervix[0] + 100) + " " + f1(cervix[1] + 34) + " 298 302");
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 430, 590, 750];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The cervix";
  [["hpv", "HPV", "g-hpv", "Persistent high risk HPV activity in the lining. Vaccination prevents new infection."], ["dys", "Abnormal", "g-dys", "Abnormal lining cells: a few low down in early change, filling the lining in CIN."], ["inv", "Invasion", "g-bad", "Cancer cells breaking through the basement membrane into the tissue below."], ["grow", "Growth", "g-cyt", "Growth signals after E6 removes p53 and E7 switches off Rb, so damaged cells survive and divide."], ["res", "Response", "g-good", "How much the chosen prevention or treatment is expected to help at this stage, in teaching terms."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Uterus", 120, 130, 100, 70, "Uterus: the womb. Its lower neck is the cervix, where most cervical cancers start.");
  pill(ox, "HPV", 205, 258, 250, 95, "HPV: high risk types passed on by close contact. Virus enters through the cervix.");
  pill(ox, "Cervix lining", 470, 196, 470, 70, "Cervix lining: layers of flat cells. New cells are made at the bottom and mature toward the top.");
  pill(ox, "E6 blocks p53", 790, 150, 790, 100, "E6 is a viral protein that removes p53, the brake that would stop a damaged cell.");
  pill(ox, "Abnormal cells", 470, 272, 430, 405, "Abnormal cells of CIN: dark crowded cells that fail to mature and fill more of the lining.");
  pill(ox, "Basement membrane", 320, 340, 195, 405, "Basement membrane: the sheet under the lining. CIN stays above it.");
  pill(ox, "Invasion", 570, 386, 622, 405, "Invasion: cancer breaks through the sheet and grows in nests in the tissue below.");
  pill(ox, "E7 blocks Rb", 830, 262, 800, 322, "E7 is a viral protein that switches off Rb, the brake on cell division.");
  capEl = mk("text", { class: "cc-cap", x: 30, y: 432 }, ox); capEl.textContent = capText(0, 0);
}
function init() {
  initOrgans();
  for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++) {
    const x = 302 + c * 46, y = 200 + r * 33, g = cell(layers.epi, { cls: "epi", r: 18, nuc: 0.34, seed: r * 7 + c, wob: 0.1, n: 8 });
    epiCells.push({ g, x, y, fromBottom: 3 - r, tz: x >= 380 && x <= 545 });
  }
  mk("path", { class: "cc-vessel", d: "M300 410C380 400 480 416 616 404" }, layers.vessels);
  [[380, 388], [480, 394], [570, 386]].forEach(([x, y], i) => { const g = mk("g", {}, layers.nests); for (let j = 0; j < 4; j++) cell(g, { cls: "inv", r: 11, nuc: 0.45, seed: i * 4 + j, wob: 0.16, x: Math.cos(j * 1.7) * 11, y: Math.sin(j * 1.9) * 7 }); nestG.push({ g, x, y }); });
  const M = layers.mol;
  mk("path", { class: "cc-bond", d: "M748 150L828 150" }, M); mk("path", { class: "cc-bond", d: "M748 262L828 262" }, M); mk("path", { class: "cc-bond", d: "M790 292L790 340" }, M);
  const e6 = mk("g", {}, M); cell(e6, { cls: "e6", r: 20, nuc: 0.4, seed: 3, wob: 0.14 }); place(e6, 725, 150, 0, 1);
  p53G = mk("g", {}, M); cell(p53G, { cls: "p53", r: 20, nuc: 0.38, seed: 5, wob: 0.12 }); place(p53G, 855, 150, 0, 1);
  const e7 = mk("g", {}, M); cell(e7, { cls: "e7", r: 20, nuc: 0.4, seed: 7, wob: 0.14 }); place(e7, 725, 262, 0, 1);
  rbG = mk("g", {}, M); cell(rbG, { cls: "rb", r: 20, nuc: 0.38, seed: 9, wob: 0.12 }); place(rbG, 855, 262, 0, 1);
  divG = mk("g", {}, M); cell(divG, { cls: "div", r: 21, nuc: 0.42, seed: 11, wob: 0.15 }); mk("circle", { class: "cc-metdot", cx: -9, cy: -7, r: 3 }, divG); place(divG, 790, 368, 0, 1);
  const T = layers.treat;
  abG = mk("g", { opacity: "0" }, T); for (let x = 310; x <= 590; x += 40) { const a = mk("path", { class: "cc-ab", d: "M0 -7L0 2M0 -2L-5 -7M0 -2L5 -7" }, abG); a.setAttribute("transform", "translate(" + x + " 282)"); }
  scanEl = mk("path", { class: "cc-scan", d: "M300 190L300 330", opacity: "0" }, T);
  coneEl = mk("path", { class: "cc-cone", d: "M370 168L550 168L505 340L415 340Z", opacity: "0" }, T);
  ringG = mk("g", { opacity: "0" }, T); nestG.forEach((n) => mk("circle", { class: "cc-ring", cx: n.x, cy: n.y, r: 30 }, ringG));
  rayG = mk("g", { opacity: "0" }, T); nestG.forEach((n) => { [-14, 0, 14].forEach((dx) => mk("path", { class: "cc-ray", d: "M" + (n.x + dx) + " 350L" + (n.x + dx * 0.4) + " 372" }, rayG)); });
  initPanel();
}
const sm = { H: 0.7, D: 0.2, I: 0, P: 0.3, R: 0, vac: 0, leep: 0, rad: 0 };
const acc = { hpv: 0, e6: 0, e7: 0, chemo: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 1.2), k2 = Math.min(1, dt * 0.7);
  sm.H = lerp(sm.H, m.H, k2); sm.D = lerp(sm.D, m.D, k2); sm.I = lerp(sm.I, m.I, k2); sm.P = lerp(sm.P, m.P, k2); sm.R = lerp(sm.R, m.R, k2);
  sm.vac = lerp(sm.vac, drug === 1 ? 1 : 0, k); sm.leep = lerp(sm.leep, drug === 2 ? 1 : 0, k); sm.rad = lerp(sm.rad, drug === 3 ? 1 : 0, k);
  epiCells.forEach((c) => { const dys = (c.fromBottom + 0.5) / 4 <= sm.D; c.g.setAttribute("class", "cl cl-" + (dys ? "dys" : c.fromBottom === 0 ? "basal" : "epi")); const s = dys && c.tz ? 1 - 0.55 * sm.leep : 1; place(c.g, c.x, c.y + Math.sin(tm / 900 + c.x) * 0.7, 0, s); c.g.style.opacity = dys && c.tz ? (1 - 0.35 * sm.leep).toFixed(2) : "1"; });
  layers.bm.setAttribute("opacity", (1 - 0.45 * sm.I).toFixed(2)); layers.bm.setAttribute("stroke-dasharray", f1(70 - 45 * sm.I) + " " + f1(2 + 16 * sm.I));
  nestG.forEach((n, i) => { const s = clamp((sm.I - 0.08 * i) * 1.5, 0.04, 1.15) * (1 - 0.55 * sm.rad); place(n.g, n.x, n.y, Math.sin(tm / 800 + i) * 4, Math.max(0.02, s)); n.g.style.opacity = sm.I > 0.06 ? (1 - 0.65 * sm.rad).toFixed(2) : "0"; });
  place(p53G, 855, 150, 0, clamp(1 - 0.58 * sm.H, 0.4, 1)); place(rbG, 855, 262, 0, clamp(1 - 0.58 * sm.H, 0.4, 1)); place(divG, 790, 368, Math.sin(tm / 700) * 5, 0.75 + 0.45 * sm.P);
  abG.setAttribute("opacity", sm.vac.toFixed(2)); coneEl.setAttribute("opacity", (sm.leep * (0.85 + 0.1 * Math.sin(tm / 300))).toFixed(2)); ringG.setAttribute("opacity", (sm.rad * 0.9).toFixed(2)); rayG.setAttribute("opacity", (sm.rad * (0.55 + 0.3 * Math.sin(tm / 180))).toFixed(2));
  const scanX = 290 + (Math.sin(tm / 1400) * 0.5 + 0.5) * 340; scanEl.setAttribute("d", "M" + f1(scanX) + " 190L" + f1(scanX) + " 330"); scanEl.setAttribute("opacity", (sm.vac * 0.9).toFixed(2));
  acc.hpv += dt * sm.H * (1 - 0.85 * sm.vac) * 7; while (acc.hpv >= 1) { acc.hpv--; const p = free(hpvP); if (p) { emit(p, cervix[0] + rnd(-8, 8), cervix[1] + rnd(-4, 4), rnd(34, 60), rnd(8, 26), 0, 0); p.e.setAttribute("class", "sc-p p-hpv"); } }
  hpvP.forEach((p) => { if (!p.on) return;
    if (p.trap) { p.tt += dt; p.e.setAttribute("opacity", clamp(1 - p.tt / 0.8).toFixed(2)); if (p.tt > 0.8) kill(p); return; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (sm.vac > 0.4 && p.x > 285 && p.x < 620 && Math.random() < sm.vac * dt * 6) { p.trap = true; p.tt = 0; p.e.setAttribute("class", "sc-p p-trap"); return; }
    p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 60, 640)) + " " + f1(clamp(p.y, 52, 332)) + ")"); if (p.y > 330 || p.x > 638) kill(p); });
  acc.e6 += dt * sm.H * 5; while (acc.e6 >= 1) { acc.e6--; const p = free(e6P); if (p) emit(p, 748, 150, 42, rnd(-5, 5), 832, 150); }
  e6P.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 660, 936)) + " " + f1(clamp(p.y, 60, 430)) + ")"); if (p.x > 830) kill(p); });
  acc.e7 += dt * sm.H * 5; while (acc.e7 >= 1) { acc.e7--; const p = free(e7P); if (p) emit(p, 748, 262, 42, rnd(-5, 5), 832, 262); }
  e7P.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 660, 936)) + " " + f1(clamp(p.y, 60, 430)) + ")"); if (p.x > 830) kill(p); });
  acc.chemo += dt * sm.rad * 8; while (acc.chemo >= 1) { acc.chemo--; const p = free(chemoP); if (p) { const n = pick(nestG); emit(p, n.x + rnd(-50, 50), 352, 0, 0, n.x + rnd(-12, 12), n.y); } }
  chemoP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (p.tx - p.x) * dt * 1.4; p.y += (p.ty - p.y) * dt * 1.4; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 286, 630)) + " " + f1(clamp(p.y, 344, 428)) + ")"); p.e.setAttribute("opacity", clamp(1.2 - p.t * 0.4).toFixed(2)); if (p.t > 3) kill(p); });
  gg.hpv.set(sm.H, wordOf(sm.H, 0.3, 0.62, ["cleared", "present", "persistent"])); gg.dys.set(sm.D, wordOf(sm.D, 0.3, 0.62, ["few", "some", "many"])); gg.inv.set(sm.I, wordOf(sm.I, 0.2, 0.55, ["none", "possible", "present"])); gg.grow.set(sm.P, wordOf(sm.P, 0.3, 0.62, ["low", "raised", "high"])); gg.res.set(sm.R, wordOf(sm.R, 0.25, 0.55, ["none", "partial", "good"]));
  const key = level + ":" + drug; if (key !== capKey) { capKey = key; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
