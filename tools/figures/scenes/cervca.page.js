/* Cervical cancer scene: HPV entry, basal infection, E6 and E7 action, CIN, invasion and treatment effects. */
const layers = { epi: $("epi"), nests: $("nests"), vessels: $("vessels"), mol: $("mol"), parts: $("parts"), treat: $("treat"), over: $("over"), panel: $("panel"), bm: $("bm") };
const gg = {};
const epiCells = [], nestG = [];
let p53G = null, rbG = null, divG = null, coneEl = null, scanEl = null, abG = null, ringG = null, rayG = null;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0, ty: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, tx, ty) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.tx = tx || 0; p.ty = ty || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const hpvP = pool(24, () => mk("circle", { class: "sc-p p-hpv", r: 3 }, layers.parts));
const e6P = pool(12, () => mk("circle", { class: "sc-p p-e6", r: 2.6 }, layers.parts));
const e7P = pool(12, () => mk("circle", { class: "sc-p p-e7", r: 2.6 }, layers.parts));
const chemoP = pool(14, () => mk("circle", { class: "sc-p p-chemo", r: 2.6 }, layers.parts));
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 430, 590, 750];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The cervix";
  [["hpv", "HPV", "g-hpv", "Persistent high risk HPV activity in the epithelium. Vaccination prevents new infection."], ["dys", "Abnormal", "g-dys", "Abnormal epithelial cells: few and low in early change, filling the epithelium in CIN, and present throughout in invasive cancer."], ["inv", "Invasion", "g-bad", "Cancer cells breaking through the basement membrane into the stroma below."], ["grow", "Growth", "g-cyt", "Growth signals after E6 removes p53 and E7 switches off Rb, so damaged cells survive and divide."], ["res", "Response", "g-good", "How much the chosen prevention or treatment is expected to help at this stage, in teaching terms."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "HPV 16 and 18", 150, 140, 130, 92, "High risk HPV types 16 and 18 cause most cervical cancers. Virus in the canal reaches basal cells, mainly at the transformation zone.");
  pill(ox, "Transformation zone", 340, 172, 330, 92, "Transformation zone: where columnar epithelium is replaced by squamous epithelium. Most CIN and cervical cancers start here.");
  const vac = pill(ox, "Vaccination", 520, 146, 520, 92, "HPV vaccination: antibodies block new HPV infection at the surface. It prevents infection but does not clear cancer already present."); vac.setAttribute("id", "vac-pill");
  const scr = pill(ox, "Screening", 430, 280, 445, 118, "Screening by cervical cytology and HPV testing finds CIN before invasion, so abnormal cells can be removed."); scr.setAttribute("id", "scr-pill");
  const leep = pill(ox, "LEEP loop", 260, 250, 180, 118, "LEEP excision: a wire loop removes the transformation zone containing CIN. It treats precancer, not invasive cancer spread in the stroma."); leep.setAttribute("id", "leep-pill");
  pill(ox, "Basal cells", 95, 326, 95, 388, "Basal cells: the dividing layer on the basement membrane. HPV infects these cells and can persist in them.");
  pill(ox, "Abnormal cells", 520, 290, 545, 388, "Abnormal cells of CIN: dark, crowded cells that fail to mature. In CIN they fill more and more of the epithelium, up to its full thickness.");
  pill(ox, "Basement membrane", 600, 342, 560, 365, "Basement membrane: the sheet under the epithelium. CIN stays above it. Invasive cancer breaks through it into the stroma.");
  const surg = pill(ox, "Surgery and rays", 320, 388, 315, 425, "Surgery and chemoradiation for invasive cancer: surgery removes the cervix and nearby tissue, and radiation with chemotherapy treats disease in the pelvis."); surg.setAttribute("id", "surg-pill");
  pill(ox, "E6", 725, 150, 695, 110, "E6: a viral HPV protein. It targets p53 for destruction.");
  pill(ox, "p53 lost", 855, 150, 855, 110, "p53: a tumour suppressor that stops damaged cells or triggers their death. E6 removes it, so damaged cells survive.");
  pill(ox, "E7", 725, 262, 695, 222, "E7: a viral HPV protein. It binds Rb and switches it off.");
  pill(ox, "Rb off", 855, 262, 855, 222, "Rb: a tumour suppressor that holds the cell cycle brake. E7 inactivates it, so cells divide when they should not.");
  pill(ox, "Cell division", 790, 368, 790, 322, "Uncontrolled cell division: with p53 lost and Rb off, abnormal cells multiply, fill the epithelium and can invade.");
}
function init() {
  for (let r = 0; r < 5; r++) for (let c = 0; c < 11; c++) {
    const x = 85 + c * 51, y = 186 + r * 35, g = cell(layers.epi, { cls: "epi", r: 19, nuc: 0.34, seed: r * 11 + c, wob: 0.1, n: 8 });
    epiCells.push({ g, x, y, fromBottom: 4 - r, tz: x >= 240 && x <= 440 });
  }
  mk("path", { class: "cc-vessel", d: "M78 410C180 398 260 418 360 406C460 394 540 412 606 402" }, layers.vessels);
  [[200, 388], [320, 398], [440, 388]].forEach(([x, y], i) => { const g = mk("g", {}, layers.nests); for (let j = 0; j < 4; j++) cell(g, { cls: "inv", r: 11, nuc: 0.45, seed: i * 4 + j, wob: 0.16, x: Math.cos(j * 1.7) * 11, y: Math.sin(j * 1.9) * 7 }); nestG.push({ g, x, y }); });
  const M = layers.mol;
  mk("path", { class: "dr-bond", d: "M748 150L828 150" }, M); mk("path", { class: "dr-bond", d: "M748 262L828 262" }, M); mk("path", { class: "dr-bond", d: "M790 292L790 340" }, M);
  const e6 = mk("g", {}, M); cell(e6, { cls: "e6", r: 20, nuc: 0.4, seed: 3, wob: 0.14 }); place(e6, 725, 150, 0, 1);
  p53G = mk("g", {}, M); cell(p53G, { cls: "p53", r: 20, nuc: 0.38, seed: 5, wob: 0.12 }); place(p53G, 855, 150, 0, 1);
  const e7 = mk("g", {}, M); cell(e7, { cls: "e7", r: 20, nuc: 0.4, seed: 7, wob: 0.14 }); place(e7, 725, 262, 0, 1);
  rbG = mk("g", {}, M); cell(rbG, { cls: "rb", r: 20, nuc: 0.38, seed: 9, wob: 0.12 }); place(rbG, 855, 262, 0, 1);
  divG = mk("g", {}, M); cell(divG, { cls: "div", r: 21, nuc: 0.42, seed: 11, wob: 0.15 }); mk("circle", { class: "cc-metdot", cx: -9, cy: -7, r: 3 }, divG); place(divG, 790, 368, 0, 1);
  const T = layers.treat;
  abG = mk("g", { opacity: "0" }, T); [120, 210, 300, 390, 480, 560].forEach((x) => { const a = mk("path", { class: "cc-ab", d: "M0 -7L0 2M0 -2L-5 -7M0 -2L5 -7" }, abG); a.setAttribute("transform", "translate(" + x + " 146)"); });
  scanEl = mk("path", { class: "cc-scan", d: "M100 172L100 330", opacity: "0" }, T);
  coneEl = mk("path", { class: "cc-cone", d: "M250 168L430 168L385 342L295 342Z", opacity: "0" }, T);
  ringG = mk("g", { opacity: "0" }, T); nestG.forEach((n) => mk("circle", { class: "cc-ring", cx: n.x, cy: n.y, r: 30 }, ringG));
  rayG = mk("g", { opacity: "0" }, T); nestG.forEach((n) => { [-14, 0, 14].forEach((dx) => mk("path", { class: "cc-ray", d: "M" + (n.x + dx) + " 350L" + (n.x + dx * 0.4) + " 372" }, rayG)); });
  initPanel();
}
const sm = { H: 0.7, D: 0.2, I: 0, P: 0.3, R: 0, vac: 0, scr: 0, leep: 0, rad: 0 };
const acc = { hpv: 0, e6: 0, e7: 0, chemo: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 1.2), k2 = Math.min(1, dt * 0.7);
  sm.H = lerp(sm.H, m.H, k2); sm.D = lerp(sm.D, m.D, k2); sm.I = lerp(sm.I, m.I, k2); sm.P = lerp(sm.P, m.P, k2); sm.R = lerp(sm.R, m.R, k2);
  sm.vac = lerp(sm.vac, drug === 1 ? 1 : 0, k); sm.scr = lerp(sm.scr, drug === 1 ? 1 : 0, k); sm.leep = lerp(sm.leep, drug === 2 ? 1 : 0, k); sm.rad = lerp(sm.rad, drug === 3 ? 1 : 0, k);
  epiCells.forEach((c) => { const dys = (c.fromBottom + 0.5) / 5 <= sm.D; c.g.setAttribute("class", "cl cl-" + (dys ? "dys" : c.fromBottom === 0 ? "basal" : "epi")); const s = dys && c.tz ? 1 - 0.55 * sm.leep : 1; place(c.g, c.x, c.y + Math.sin(tm / 900 + c.x) * 0.7, 0, s); c.g.style.opacity = dys && c.tz ? (1 - 0.35 * sm.leep).toFixed(2) : "1"; });
  layers.bm.setAttribute("opacity", (1 - 0.45 * sm.I).toFixed(2)); layers.bm.setAttribute("stroke-dasharray", f1(70 - 45 * sm.I) + " " + f1(2 + 16 * sm.I));
  nestG.forEach((n, i) => { const s = clamp((sm.I - 0.08 * i) * 1.5, 0.04, 1.15) * (1 - 0.35 * sm.rad); place(n.g, n.x, n.y, Math.sin(tm / 800 + i) * 4, s); n.g.style.opacity = sm.I > 0.06 ? "1" : "0"; });
  place(p53G, 855, 150, 0, clamp(1 - 0.58 * sm.H, 0.4, 1)); place(rbG, 855, 262, 0, clamp(1 - 0.58 * sm.H, 0.4, 1)); place(divG, 790, 368, Math.sin(tm / 700) * 5, 0.75 + 0.45 * sm.P);
  abG.setAttribute("opacity", sm.vac.toFixed(2)); coneEl.setAttribute("opacity", (sm.leep * 0.95).toFixed(2)); ringG.setAttribute("opacity", (sm.rad * 0.9).toFixed(2)); rayG.setAttribute("opacity", (sm.rad * (0.55 + 0.3 * Math.sin(tm / 180))).toFixed(2));
  const scanX = 100 + (Math.sin(tm / 1400) * 0.5 + 0.5) * 500; scanEl.setAttribute("d", "M" + f1(scanX) + " 172L" + f1(scanX) + " 330"); scanEl.setAttribute("opacity", (sm.scr * 0.9).toFixed(2));
  $("vac-pill").style.opacity = sm.vac.toFixed(2); $("scr-pill").style.opacity = sm.scr.toFixed(2); $("leep-pill").style.opacity = sm.leep.toFixed(2); $("surg-pill").style.opacity = sm.rad.toFixed(2);
  acc.hpv += dt * sm.H * (1 - 0.85 * sm.vac) * 7; while (acc.hpv >= 1) { acc.hpv--; const p = free(hpvP); if (p) emit(p, rnd(90, 590), 140, rnd(-4, 4), rnd(28, 42), 0, 0); }
  hpvP.forEach((p) => { if (!p.on) return; p.x = clamp(p.x + p.vx * dt, 70, 610); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(clamp(p.y, 52, 330)) + ")"); if (p.y > 328) kill(p); });
  acc.e6 += dt * sm.H * 5; while (acc.e6 >= 1) { acc.e6--; const p = free(e6P); if (p) emit(p, 748, 150, 42, rnd(-5, 5), 832, 150); }
  e6P.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 660, 936)) + " " + f1(clamp(p.y, 60, 430)) + ")"); if (p.x > 830) kill(p); });
  acc.e7 += dt * sm.H * 5; while (acc.e7 >= 1) { acc.e7--; const p = free(e7P); if (p) emit(p, 748, 262, 42, rnd(-5, 5), 832, 262); }
  e7P.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 660, 936)) + " " + f1(clamp(p.y, 60, 430)) + ")"); if (p.x > 830) kill(p); });
  acc.chemo += dt * sm.rad * 8; while (acc.chemo >= 1) { acc.chemo--; const p = free(chemoP); if (p) { const n = pick(nestG); emit(p, n.x + rnd(-50, 50), 352, 0, 0, n.x + rnd(-12, 12), n.y); } }
  chemoP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (p.tx - p.x) * dt * 1.4; p.y += (p.ty - p.y) * dt * 1.4; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 60, 620)) + " " + f1(clamp(p.y, 346, 428)) + ")"); p.e.setAttribute("opacity", clamp(1.2 - p.t * 0.4).toFixed(2)); if (p.t > 3) kill(p); });
  gg.hpv.set(sm.H, wordOf(sm.H, 0.3, 0.62, ["cleared", "present", "persistent"])); gg.dys.set(sm.D, wordOf(sm.D, 0.3, 0.62, ["few", "some", "many"])); gg.inv.set(sm.I, wordOf(sm.I, 0.2, 0.55, ["none", "possible", "present"])); gg.grow.set(sm.P, wordOf(sm.P, 0.3, 0.62, ["low", "raised", "high"])); gg.res.set(sm.R, wordOf(sm.R, 0.25, 0.55, ["none", "partial", "good"]));
}
run({ init, step });
