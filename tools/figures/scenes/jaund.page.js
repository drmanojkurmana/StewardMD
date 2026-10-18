/* Jaundice scene: red cell breakdown, unconjugated bilirubin to the liver, conjugation, bile to gut, urobilinogen to kidney. */
const layers = { spleen: $("spleen"), face: $("face"), rbcs: $("rbcs"), parts: $("parts"), samples: $("samples"), light: $("light"), over: $("over"), panel: $("panel") };
const trU = track([[148, 182], [205, 238], [290, 270], [390, 262], [448, 214]]);
const trC = track([[526, 192], [598, 208], [646, 258], [676, 314], [736, 352]]);
const trR = track([[812, 356], [850, 296], [846, 226], [828, 192]]);
/* ---- static cells ---- */
const spleenCells = [];
function initSpleen() {
  const g = mk("g", {}, layers.spleen);
  const bg = cell(g, { cls: "rbc", r: 44, seed: 3, wob: 0.08, n: 10 }); place(bg, 105, 165, 0, 1);
  for (let i = 0; i < 6; i++) { const c = cell(g, { cls: "rbc", r: 10, seed: i + 5, wob: 0.12 }); spleenCells.push({ c, x: 105 + Math.cos(i * 1.05) * 22, y: 165 + Math.sin(i * 1.05) * 20, i }); }
  const liv = mk("g", {}, layers.spleen);
  for (let i = 0; i < 10; i++) { const c = cell(liv, { cls: "endo", r: 13, seed: i + 30, wob: 0.1 }); place(c, 400 + (i % 5) * 34, 132 + Math.floor(i / 5) * 42, 0, 1); }
}
let skinO = null, eyeO = null, urineD = null, stoolP = null, rays = null;
function initFaceSamples() {
  const g = layers.face;
  mk("circle", { class: "jd-skin", cx: 235, cy: 150, r: 28 }, g);
  skinO = mk("circle", { class: "jd-jaund", cx: 235, cy: 150, r: 28, opacity: "0.3" }, g);
  mk("circle", { class: "jd-eye", cx: 226, cy: 146, r: 7 }, g); mk("circle", { class: "jd-eye", cx: 244, cy: 146, r: 7 }, g);
  eyeO = mk("g", {}, g); mk("circle", { class: "jd-jaund", cx: 226, cy: 146, r: 7, opacity: "0.3" }, eyeO); mk("circle", { class: "jd-jaund", cx: 244, cy: 146, r: 7, opacity: "0.3" }, eyeO);
  mk("circle", { class: "jd-iris", cx: 226, cy: 146, r: 3 }, g); mk("circle", { class: "jd-iris", cx: 244, cy: 146, r: 3 }, g);
  mk("path", { class: "dr-bond", d: "M226 164 Q235 170 244 164" }, g);
  const s = layers.samples;
  mk("rect", { class: "jd-box", x: 90, y: 355, width: 100, height: 57, rx: 8 }, s);
  mk("rect", { class: "jd-urine", x: 98, y: 378, width: 84, height: 26, rx: 5 }, s);
  urineD = mk("rect", { class: "jd-urine-d", x: 98, y: 378, width: 84, height: 26, rx: 5, opacity: "0" }, s);
  mk("rect", { class: "jd-box", x: 310, y: 355, width: 100, height: 57, rx: 8 }, s);
  mk("rect", { class: "jd-stool", x: 318, y: 378, width: 84, height: 26, rx: 5 }, s);
  stoolP = mk("rect", { class: "jd-stool-p", x: 318, y: 378, width: 84, height: 26, rx: 5, opacity: "0" }, s);
  rays = mk("g", { opacity: "0" }, layers.light);
  for (let i = 0; i < 5; i++) { const x = 205 + i * 15; mk("path", { class: "jd-ray", d: "M" + x + " 92 L" + (x + 6) + " 116" }, rays); }
}
/* ---- red cells in the vessel ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 14; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(30, 520), y: rnd(-8, 8), v: rnd(0.8, 1.2), rot: rnd(-16, 16) }); } }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const pU = pool(26, () => mk("circle", { class: "sc-p p-un", r: 3.4 }, layers.parts));
const pC = pool(22, () => mk("circle", { class: "sc-p p-con", r: 3.4 }, layers.parts));
const pR = pool(14, () => mk("circle", { class: "sc-p p-uro", r: 2.8 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, u) { p.on = true; p.u = u; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function ride(pl, tr, speed, dt) { pl.forEach((p) => { if (!p.on) return; p.u += speed * dt / tr.len; const pt = tr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ")"); if (p.u >= 1) kill(p); }); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["un", "Unconjugated", "g-un", "Unconjugated bilirubin from red cell breakdown. Not water soluble, bound to albumin, so it does not appear in urine."], ["con", "Conjugated", "g-con", "Conjugated bilirubin made in the liver. Water soluble, excreted in bile, and able to appear in urine when it builds up in blood."], ["jau", "Jaundice", "g-jau", "Yellow colour of skin and the whites of the eyes when bilirubin builds up in blood and tissues."], ["uri", "Urine bilirubin", "g-uri", "Bilirubin in urine. Only conjugated bilirubin can do this, so urine looks dark in hepatic and post-hepatic patterns."], ["uro", "Urobilinogen", "g-uro", "Made by gut bacteria from conjugated bilirubin. Some is reabsorbed and excreted by the kidney; it falls when bile cannot reach the gut."], ["sto", "Stool pigment", "g-sto", "Brown stool pigment (stercobilin) from bilirubin reaching the gut. Pale clay stool means bile is not reaching the gut."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Red cell breakdown", 105, 122, 110, 82, "Old red cells are broken down, mainly in the spleen. Haem from haemoglobin becomes unconjugated bilirubin.");
  pill(ox, "Yellow eye and skin", 235, 178, 235, 205, "Jaundice: yellow skin and yellow whites of the eyes when bilirubin builds up.");
  pill(ox, "Liver", 465, 104, 465, 82, "The liver takes up unconjugated bilirubin from blood and conjugates it, making it water soluble.");
  pill(ox, "Gallbladder", 628, 180, 628, 162, "The gallbladder stores bile and releases it into the bile duct after meals.");
  pill(ox, "Kidney", 822, 100, 822, 82, "The kidney excretes some reabsorbed urobilinogen, and conjugated bilirubin when it is high in blood.");
  pill(ox, "Unconjugated bilirubin", 300, 255, 300, 232, "Unconjugated bilirubin travels in blood bound to albumin to the liver. It cannot pass into urine.");
  pill(ox, "Conjugation", 490, 202, 465, 232, "In hepatocytes, bilirubin is joined to glucuronic acid. The conjugated form is water soluble and can leave in bile.");
  pill(ox, "Bile duct", 652, 258, 706, 232, "The bile duct carries bile from the liver and gallbladder to the gut. A blockage here gives a post-hepatic pattern.");
  pill(ox, "Urobilinogen", 845, 265, 855, 232, "Urobilinogen made in the gut is partly reabsorbed into blood and excreted by the kidney.");
  pill(ox, "Gut bacteria", 800, 322, 800, 292, "Gut bacteria convert conjugated bilirubin to urobilinogen and brown stool pigment.");
  pill(ox, "Urine", 140, 358, 140, 335, "Urine sample. Dark urine with bilirubin points to conjugated bilirubin in blood, as in hepatic and post-hepatic patterns.");
  pill(ox, "Stool", 360, 358, 360, 335, "Stool sample. Pale clay stool means little bilirubin is reaching the gut, as when the bile duct is blocked.");
}
const sm = { U: 0.9, C: 0.2, Flow: 0.8, Obs: 0, J: 0.5, UrineB: 0, Uro: 0.7, Stool: 0.8, photo: 0 };
const acc = { u: 0, c: 0, r: 0 };
function init() { initSpleen(); initFaceSamples(); initRbc(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4);
  ["U", "C", "Flow", "Obs", "J", "UrineB", "Uro", "Stool", "photo"].forEach((f) => { sm[f] = lerp(sm[f], m[f], k); });
  spleenCells.forEach((s, i) => { const sc = 1 - 0.25 * sm.U * (0.5 + 0.5 * Math.sin(tm / 500 + i * 1.3)); place(s.c, s.x + Math.sin(tm / 900 + i) * 2, s.y, Math.sin(tm / 700 + i) * 14, Math.max(0.45, sc)); });
  rbcs.forEach((r) => { r.x += r.v * 62 * dt; if (r.x > 535) r.x = 28; place(r.g, r.x, 272 + r.y, r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  acc.u += dt * sm.U * 7; while (acc.u >= 1) { acc.u--; const p = free(pU); if (p) emit(p, 0); }
  ride(pU, trU, 120, dt);
  acc.c += dt * sm.C * sm.Flow * 7; while (acc.c >= 1) { acc.c--; const p = free(pC); if (p) emit(p, 0); }
  ride(pC, trC, 105, dt);
  acc.r += dt * sm.Uro * 4; while (acc.r >= 1) { acc.r--; const p = free(pR); if (p) emit(p, 0); }
  ride(pR, trR, 82, dt);
  const stone = $("stone"); if (stone) { const s = 0.15 + 0.85 * sm.Obs; stone.setAttribute("transform", "translate(654 266) scale(" + s.toFixed(2) + ") translate(-654 -266)"); stone.setAttribute("opacity", (0.15 + 0.85 * sm.Obs).toFixed(2)); }
  if (skinO) { skinO.setAttribute("opacity", (sm.J * 0.72).toFixed(2)); eyeO.querySelectorAll("circle").forEach((c) => c.setAttribute("opacity", (sm.J * 0.8).toFixed(2))); }
  if (urineD) urineD.setAttribute("opacity", sm.UrineB.toFixed(2));
  if (stoolP) stoolP.setAttribute("opacity", clamp(1 - sm.Stool).toFixed(2));
  if (rays) rays.setAttribute("opacity", sm.photo.toFixed(2));
  gg.un.set(sm.U, wordOf(sm.U, 0.35, 0.7, ["low", "raised", "high"])); gg.con.set(sm.C, wordOf(sm.C, 0.35, 0.7, ["low", "raised", "high"]));
  gg.jau.set(sm.J, wordOf(sm.J, 0.3, 0.6, ["none", "mild", "marked"])); gg.uri.set(sm.UrineB, wordOf(sm.UrineB, 0.15, 0.55, ["absent", "present", "strong"]));
  gg.uro.set(sm.Uro, wordOf(sm.Uro, 0.3, 0.65, ["low", "normal", "high"])); gg.sto.set(sm.Stool, wordOf(sm.Stool, 0.3, 0.65, ["pale", "normal", "dark"]));
}
run({ init, step });
