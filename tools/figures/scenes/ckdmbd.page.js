/* CKD-MBD scene: kidney and bowel organs, parathyroid gland, phosphate, calcium, PTH and bone. */
const layers = { kid: $("kidneySlot"), gland: $("glandSlot"), gut: $("gutSlot"), bone: $("boneg"), osteo: $("osteocells"), rbcs: $("rbcs"), parts: $("parts"), cells: $("cells"), over: $("over"), panel: $("panel"), lumen: $("lumen"), trap: $("trap"), pit: $("pit"), mat: $("bonemat") };
let kidneyO = null, glandO = null, gutO = null, capEl = null, capDrug = -1, casrRing = null;
const GCX = 480, GCY = 140, GW = 84;
let trVit = null, trPth = null, trCm = null;
let casrBase = [504, 116], outBase = [524, 143];
function initOrgans() {
  kidneyO = organ(layers.kid, "kidney", 130, 155, 120, {});
  glandO = organ(layers.gland, "parathyroid", GCX, GCY, GW, {});
  gutO = organ(layers.gut, "bowel", 465, 385, 110, {});
  const KP = kidneyO.ports, GP = glandO.ports, BP = gutO.ports;
  $("vitPath").setAttribute("d", "M" + f1(KP.pelvis[0]) + " " + f1(KP.pelvis[1]) + " C240 200 340 300 " + f1(BP.coils[0]) + " " + f1(BP.coils[1]));
  $("pthPath").setAttribute("d", "M" + f1(GP.out[0]) + " " + f1(GP.out[1]) + " C590 138 640 128 700 126");
  casrBase = GP.casr.slice(); outBase = GP.out.slice();
  trVit = track([KP.pelvis, [280, 240], BP.coils]);
  trPth = track([GP.out, [610, 136], [740, 120]]);
  trCm = track([[500, 58], GP.casr]);
}
function capText(d) {
  if (d === 1) return "Binder traps phosphate in the gut. Less reaches the blood, so PTH falls.";
  if (d === 2) return "Active vitamin D restores calcium uptake in the gut. Calcium rises, PTH falls.";
  if (d === 3) return "Calcimimetic sits on the gland sensor. The gland rests and PTH falls.";
  if (d === 4) return "Combined treatment traps phosphate, restores calcium and quiets the gland.";
  return "No treatment. Phosphate builds up, PTH stays high and bone is eaten away.";
}
/* ---- bone cells ---- */
const ocl = cell(layers.osteo, { cls: "mac", r: 16, nuc: 0.5, nucCls: "multi", seed: 3, wob: 0.14 });
const obls = [818, 852, 886].map((x, i) => ({ g: cell(layers.osteo, { cls: "ostb", r: 9, nuc: 0.4, seed: i + 8, wob: 0.08 }), x }));
const ocys = [[732, 168], [798, 178], [872, 162]].map(([x, y], i) => ({ g: cell(layers.osteo, { cls: "ocy", r: 7, nuc: 0.35, seed: i + 15, wob: 0.1 }), x, y }));
place(ocl, 726, 124, 0, 1); obls.forEach((o) => place(o.g, o.x, 120, 0, 1)); ocys.forEach((o) => place(o.g, o.x, o.y, 0, 1));
/* ---- calcimimetic docked on the receptor, and phosphate trapped in the gut ---- */
const docks = [];
for (let i = 0; i < 6; i++) docks.push(mk("circle", { class: "sc-p p-cmim", r: 3.4, opacity: "0" }, layers.parts));
const dockOff = [[-7, 0], [0, -7], [7, 0], [0, 7], [-4, 5], [5, -4]];
const traps = [];
[[430, 350], [470, 345], [505, 355], [440, 380], [485, 375], [455, 400], [500, 405], [430, 415]].forEach(([x, y]) => traps.push({ e: mk("rect", { class: "sc-p p-phos2", x: -3, y: -3, width: 6, height: 6, rx: 1, opacity: "0" }, layers.parts), x, y }));
/* ---- red cells in the vessel ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, 960), y: rnd(-12, 12), v: rnd(0.8, 1.2) }); } }
/* ---- particle pools (element is p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, t: 0, k: 0, u: 0, tr: null }; }); }
const po4 = pool(36, () => mk("rect", { class: "sc-p p-phos2", x: -3, y: -3, width: 6, height: 6, rx: 1 }, layers.parts));
const caP = pool(28, () => mk("circle", { class: "sc-p p-ca2", r: 3 }, layers.parts));
const pthP = pool(30, () => mk("path", { class: "sc-p p-pth2", d: "M0 -4L4 0L0 4L-4 0Z" }, layers.parts));
const vitP = pool(22, () => mk("circle", { class: "sc-p p-vitd2", r: 3 }, layers.parts));
const cmP = pool(12, () => mk("circle", { class: "sc-p p-cmim", r: 3.2 }, layers.parts));
const absP = pool(14, () => mk("rect", { class: "sc-p p-phos2", x: -3, y: -3, width: 6, height: 6, rx: 1 }, layers.parts));
const bindP = pool(12, () => mk("rect", { class: "sc-p p-bind2", x: -4, y: -2.5, width: 8, height: 5, rx: 2.5 }, layers.parts));
const excP = pool(10, () => mk("rect", { class: "sc-p p-exc", x: -2.6, y: -2.6, width: 5.2, height: 5.2, rx: 1 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, tx, ty, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.tx = tx || 0; p.ty = ty || 0; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function seek(pl, speed, arrive) { pl.forEach((p) => { if (!p.on) return; p.t += 0.016; const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * speed * 0.016 + p.vx * 0.016; p.y += (dy / d) * speed * 0.016 + p.vy * 0.016; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < arrive || p.t > 9) kill(p); }); }
function trackRide(pl, speed) { pl.forEach((p) => { if (!p.on) return; p.u += dtNow * speed / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.u >= 1) kill(p); }); }
/* ---- gauges and labels ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Blood and bone";
  [["gfr", "Filtration", "g-good", "How well the kidney filters. It falls as CKD stage advances."], ["phos", "Phosphate", "g-phos2", "Phosphate retained when filtration falls. A binder traps it in the gut."], ["vitd", "Vitamin D", "g-vitd2", "Active vitamin D made by the kidney. It drives gut calcium uptake and calms the gland."], ["ca", "Calcium", "g-ca2", "Blood calcium. It falls when active vitamin D is low and rises again when uptake recovers."], ["pth", "PTH", "g-pth2", "Parathyroid hormone. It rises in secondary hyperparathyroidism and drives bone loss."], ["bone", "Bone loss", "g-bone2", "Net bone loss when osteoclast resorption outruns formation and mineralization."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Kidney", 76, 140, 80, 62, "Kidney. Failing filtration retains phosphate and makes less active vitamin D.");
  pill(ox, "Parathyroid", 480, 103, 480, 62, "Parathyroid gland. Low calcium and low vitamin D switch it on. A calcimimetic acts on its calcium sensor.");
  pill(ox, "Bone", 800, 86, 800, 62, "Bone. When resorption outruns formation the matrix weakens.");
  pill(ox, "Phosphate", 300, 299, 300, 250, "Phosphate in the blood. Retained when the kidney fails. A binder traps it in the gut.");
  pill(ox, "Gut", 445, 338, 420, 250, "Gut. A binder traps dietary phosphate here, and vitamin D drives calcium uptake here.");
  pill(ox, "PTH", 610, 139, 590, 250, "Parathyroid hormone travelling to bone, where it drives resorption.");
  pill(ox, "Calcium", 655, 299, 655, 250, "Calcium in the blood, taken up from the gut. Low calcium stimulates the gland.");
  pill(ox, "Osteoclast", 726, 124, 770, 250, "Osteoclast. It sits on the bone surface and eats away mineral and matrix.");
  casrRing = mk("circle", { class: "mb-casr", r: 10, opacity: "0.5" }, layers.cells);
  capEl = mk("text", { class: "mb-cap", x: 30, y: 430 }, ox); capEl.textContent = capText(0);
}
const sm = { gfr: 0.4, phos: 0.6, vitD: 0.3, ca: 0.4, pth: 0.7, bone: 0.6, binder: 0, vitRx: 0, cmim: 0 };
const acc = { po4: 0, ca: 0, pth: 0, vit: 0, cm: 0, bind: 0, exc: 0, abs: 0 };
let dtNow = 0.016;
function init() { initOrgans(); initRbc(); initPanel(); }
function step(dt, m) {
  dtNow = dt;
  const k = Math.min(1, dt * 1.2);
  sm.gfr = lerp(sm.gfr, m.gfr, k); sm.phos = lerp(sm.phos, m.phos, k); sm.vitD = lerp(sm.vitD, m.vitD, k); sm.ca = lerp(sm.ca, m.ca, k); sm.pth = lerp(sm.pth, m.pth, k); sm.bone = lerp(sm.bone, m.bone, k); sm.binder = lerp(sm.binder, m.binder, k); sm.vitRx = lerp(sm.vitRx, m.vitRx, k); sm.cmim = lerp(sm.cmim, m.cmim, k);
  /* gland swells with PTH; receptor and PTH outlet follow the scale */
  const gs = 0.9 + 0.25 * sm.pth;
  place(glandO.g, GCX, GCY, 0, gs);
  const casr = [GCX + (casrBase[0] - GCX) * gs, GCY + (casrBase[1] - GCY) * gs];
  const gout = [GCX + (outBase[0] - GCX) * gs, GCY + (outBase[1] - GCY) * gs];
  place(casrRing, casr[0], casr[1], 0, gs);
  casrRing.setAttribute("opacity", (0.3 + 0.7 * Math.max(sm.ca, sm.cmim)).toFixed(2));
  casrRing.setAttribute("stroke-width", f1(3 + 2.5 * sm.cmim));
  docks.forEach((d, i) => { d.setAttribute("transform", "translate(" + f1(casr[0] + dockOff[i][0] + Math.sin(tm / 500 + i * 2) * 0.8) + " " + f1(casr[1] + dockOff[i][1] + Math.cos(tm / 500 + i * 2) * 0.8) + ")"); d.setAttribute("opacity", sm.cmim.toFixed(2)); });
  /* binder highlight and trapped phosphate in the gut */
  layers.trap.setAttribute("opacity", (0.3 * sm.binder).toFixed(2));
  traps.forEach((o, i) => { o.e.setAttribute("transform", "translate(" + f1(o.x + Math.sin(tm / 600 + i * 1.7) * 1.5) + " " + f1(o.y) + ")"); o.e.setAttribute("opacity", sm.binder.toFixed(2)); });
  /* bone cells and pit follow resorption and formation */
  place(ocl, 726, 124, Math.sin(tm / 500) * 6, 0.35 + 0.95 * m.resorp);
  obls.forEach((o, i) => place(o.g, o.x, 120 + Math.sin(tm / 600 + i) * 1.5, 0, 0.4 + 0.8 * m.form));
  ocys.forEach((o) => place(o.g, o.x, o.y, 0, 0.7 + 0.3 * m.form));
  layers.mat.setAttribute("opacity", (1 - 0.38 * sm.bone).toFixed(2)); layers.pit.setAttribute("opacity", (0.25 + 0.75 * sm.bone).toFixed(2));
  /* red cells */
  rbcs.forEach((r) => { r.x += r.v * 55 * dt; if (r.x > 950) { r.x = 35; r.y = rnd(-12, 12); } place(r.g, r.x, 299 + r.y, 0, 1); });
  /* phosphate retained in the vessel */
  acc.po4 += dt * (0.8 + 8 * sm.phos); while (acc.po4 >= 1) { acc.po4--; const p = free(po4); if (p) emit(p, rnd(40, 110), rnd(286, 312), rnd(30, 50), 0, 0, 0, 0); }
  po4.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += Math.sin(tm / 400 + p.x) * dt * 3; p.x = clamp(p.x, 36, 924); p.y = clamp(p.y, 284, 314); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 9) + ")"); if (p.x > 918) kill(p); });
  /* phosphate absorbed from the gut, trapped by binder */
  acc.abs += dt * (0.5 + 4 * sm.phos) * (1 - 0.9 * sm.binder); while (acc.abs >= 1) { acc.abs--; const p = free(absP); if (p) { const BP = gutO.ports.coils; emit(p, BP[0] + rnd(-14, 14), BP[1] + rnd(-10, 10), 0, 0, 478, 312, 0); } }
  seek(absP, 60, 10);
  /* calcium taken up from the gut into the vessel */
  acc.ca += dt * (0.5 + 7 * m.gutCa); while (acc.ca >= 1) { acc.ca--; const p = free(caP); if (p) emit(p, rnd(425, 505), 336, 0, -rnd(20, 30), 0, 0, 0); }
  caP.forEach((p) => { if (!p.on) return; p.x += Math.sin(tm / 500 + p.y) * dt * 4; p.y += p.vy * dt; p.x = clamp(p.x, 410, 520); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 312) kill(p); });
  /* PTH from the gland to the bone surface, fading when the sensor is drugged */
  acc.pth += dt * (0.6 + 9 * sm.pth); while (acc.pth >= 1) { acc.pth--; const p = free(pthP); if (p) { emit(p, gout[0], gout[1], 0, 0, 0, 0, 0); p.tr = trPth; p.u = 0; } }
  trackRide(pthP, 85);
  pthP.forEach((p) => { if (p.on) p.e.setAttribute("opacity", (1 - 0.55 * sm.cmim).toFixed(2)); });
  /* active vitamin D from the kidney to the gut */
  acc.vit += dt * (0.5 + 6 * sm.vitD); while (acc.vit >= 1) { acc.vit--; const p = free(vitP); if (p) { const KP = kidneyO.ports.pelvis; emit(p, KP[0], KP[1], 0, 0, 0, 0, 0); p.tr = trVit; p.u = 0; } }
  trackRide(vitP, 70);
  /* calcimimetic travelling to the calcium sensor */
  acc.cm += dt * sm.cmim * 5; while (acc.cm >= 1) { acc.cm--; const p = free(cmP); if (p) emit(p, 500 + rnd(-30, 30), 58, 0, 0, casr[0], casr[1], 0); }
  seek(cmP, 75, 12);
  /* binder capsules drifting through the gut */
  acc.bind += dt * sm.binder * 6; while (acc.bind >= 1) { acc.bind--; const p = free(bindP); if (p) emit(p, rnd(412, 460), rnd(345, 420), rnd(10, 20), 0, 0, 0, 0); }
  bindP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3) / 1.2).toFixed(2)); if (p.t > 4.2 || p.x > 518) kill(p); });
  /* failing kidney excretes less: trickle from the ureter follows filtration */
  acc.exc += dt * 6 * sm.gfr; while (acc.exc >= 1) { acc.exc--; const p = free(excP); if (p) { const OP = kidneyO.ports.out; emit(p, OP[0] + rnd(-3, 3), OP[1], rnd(-3, 3), rnd(35, 50), 0, 0, 0); } }
  excP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.y - 240) / 30).toFixed(2)); if (p.y > 272) kill(p); });
  /* gauges */
  gg.gfr.set(sm.gfr, wordOf(sm.gfr, 0.35, 0.7, ["very low", "reduced", "near normal"])); gg.phos.set(sm.phos, wordOf(sm.phos, 0.32, 0.62, ["normal", "raised", "high"])); gg.vitd.set(sm.vitD, wordOf(sm.vitD, 0.32, 0.62, ["low", "reduced", "normal"]));
  gg.ca.set(sm.ca, wordOf(sm.ca, 0.38, 0.62, ["low", "normal", "high"])); gg.pth.set(sm.pth, wordOf(sm.pth, 0.4, 0.65, ["normal", "raised", "high"])); gg.bone.set(sm.bone, wordOf(sm.bone, 0.3, 0.58, ["balanced", "increased", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
