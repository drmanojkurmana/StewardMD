/* Haemolysis scene: red cells burst in the vessel or are eaten in the spleen, bilirubin to the liver, marrow reply. */
const CY = SC.CY, WW = SC.W;
const layers = { rbcs: $("rbcs"), doomed: $("doomed"), parts: $("parts"), phag: $("phag"), over: $("over"), panel: $("panel") };
const extraTr = track([[60, CY], [620, CY], [700, 210], [752, 158]]);
/* ---- flowing red cells ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 14; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(20, WW - 20), y: rnd(-24, 24), v: rnd(0.8, 1.2), rot: rnd(-16, 16) }); } }
/* ---- reticulocytes: young cells with purple remnants, entering from the left ---- */
const retics = [];
function initRetic() { for (let i = 0; i < 5; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9.5, ry: 5.8 }, g); mk("circle", { class: "hm-retic-dot", cx: -3, cy: -1.5, r: 1.3 }, g); mk("circle", { class: "hm-retic-dot", cx: 2.5, cy: 1.8, r: 1.1 }, g); mk("circle", { class: "hm-retic-dot", cx: 1, cy: -2.4, r: 0.9 }, g); retics.push({ g, x: 30 + i * 90, y: rnd(-18, 18), v: rnd(0.7, 1) }); } }
/* ---- doomed cells: coated or oxidant damaged, travelling to the spleen ---- */
const doomed = [];
function initDoomed() {
  for (let i = 0; i < 6; i++) {
    const g = mk("g", { class: "cl cl-rbc" }, layers.doomed); mk("ellipse", { class: "cl-b", rx: 10, ry: 6 }, g); mk("ellipse", { class: "cl-s", rx: 3.6, ry: 1.8 }, g);
    const hz = mk("g", {}, g); [[-4, -2], [3, 2], [5, -3]].forEach((p) => mk("circle", { class: "hm-heinz", cx: p[0], cy: p[1], r: 1.7 }, hz));
    const ab = mk("g", {}, g); [[-7, -5, -40], [7, -4, 40], [0, 7, 180]].forEach((p) => { const y = mk("path", { class: "hm-abY", d: "M0 4L0 0M0 0L-3.4 -4M0 0L3.4 -4" }, ab); y.setAttribute("transform", "translate(" + p[0] + " " + p[1] + ") rotate(" + p[2] + ")"); });
    doomed.push({ g, hz, ab, u: i / 6, eaten: 0 });
  }
}
/* ---- macrophages inside the spleen ---- */
const macs = [[722, 122], [792, 142], [748, 162]].map(function (p, i) { const g = mk("g", { class: "hot", tabindex: "0", "data-info": "Splenic macrophage: it inspects passing red cells, pits out rigid inclusions and eats cells that are stiff or antibody coated." }, layers.phag); const c = cell(g, { cls: "mac", r: 17, nuc: 0.42, seed: i * 3 + 2, wob: 0.13 }); place(c, p[0], p[1], 0, 1); return { g: c, x: p[0], y: p[1], ph: i * 2.1 }; });
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const oxp = pool(16, () => mk("path", { class: "sc-p p-ox", d: "M0 -3.2L3 0L0 3.2L-3 0Z" }, layers.parts));
const hbp = pool(22, () => mk("circle", { class: "sc-p p-hb", r: 2.5 }, layers.parts));
const bilp = pool(26, () => mk("circle", { class: "sc-p p-bili", r: 2.7 }, layers.parts));
const bursts = pool(8, () => mk("circle", { class: "hm-burst", r: 5 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels, treatment marks and gauges ---- */
const gg = {};
let trigPill = null, sterPill = null, txPill = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 260, 420, 580, 740];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["haem", "Haemolysis", "g-haem", "How fast red cells are being destroyed, in the vessel and in the spleen together."], ["bili", "Bilirubin", "g-bili", "Unconjugated bilirubin from haem breakdown, carried in blood to the liver. It gives the yellow colour."], ["retic", "Reticulocytes", "g-retic", "Young red cells released early by the marrow. A rise shows the marrow is answering the loss."], ["spleen", "Spleen size", "g-spleen", "The spleen enlarges when it removes many red cells over time. After splenectomy this falls."], ["ana", "Anaemia", "g-ana", "How low the red cell mass has fallen after destruction and marrow reply are balanced."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Marrow", 125, 72, 125, 60, "Bone marrow: the factory for red cells. When red cells are lost early it speeds up and releases young reticulocytes.");
  pill(ox, "Heinz bodies", 360, 110, 360, 60, "Heinz bodies: clumps of damaged haemoglobin stuck inside the red cell after oxidant injury in G6PD deficiency. They make the cell rigid.");
  pill(ox, "Antibody coat", 530, 110, 530, 60, "Warm antibody coat: antibody bound to the red cell surface in warm autoimmune haemolysis. The coat marks the cell for removal in the spleen.");
  pill(ox, "Spleen", 770, 74, 770, 60, "Spleen: the filter. Macrophages here pit out inclusions and eat rigid or antibody coated red cells. This is extravascular haemolysis.");
  pill(ox, "Reticulocyte", 70, 248, 110, 204, "Reticulocyte: a young red cell just released from the marrow, still carrying purple remnants. More of them means the marrow is compensating.");
  trigPill = pill(ox, "Trigger out", 360, 154, 320, 204, "Removing the oxidant trigger stops new oxidant injury in G6PD deficiency, so fewer Heinz bodies form.");
  sterPill = pill(ox, "Steroid", 530, 154, 480, 204, "A steroid calms antibody production and splenic removal in warm autoimmune haemolysis.");
  txPill = pill(ox, "Transfusion", 640, 250, 640, 204, "Transfusion adds normal red cells at once. Splenectomy removes the main site where coated cells are eaten, in selected cases.");
  pill(ox, "Rupture", 300, 262, 300, 330, "Intravascular haemolysis: the red cell bursts inside the vessel and haemoglobin spills into the plasma.");
  pill(ox, "Bilirubin", 640, 296, 620, 330, "Unconjugated bilirubin from broken down haem travels in blood to the liver for handling.");
  pill(ox, "Liver", 770, 336, 770, 318, "Liver: it takes up unconjugated bilirubin from blood. When breakdown is fast, bilirubin builds up and the skin and eyes yellow.");
}
const sm = { EffH: 0.4, Intra: 0.2, Extra: 0.2, Bili: 0.3, Retic: 0.3, Spleen: 0.3, Ana: 0.3, Ox: 0.5, Ab: 0.2 };
const acc = { ox: 0, hb: 0, bil: 0, burst: 0 };
function init() { initRbc(); initRetic(); initDoomed(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.EffH = lerp(sm.EffH, m.EffH, k2); sm.Intra = lerp(sm.Intra, m.Intra, k2); sm.Extra = lerp(sm.Extra, m.Extra, k2); sm.Bili = lerp(sm.Bili, m.Bili, k2); sm.Retic = lerp(sm.Retic, m.Retic, k2); sm.Spleen = lerp(sm.Spleen, m.Spleen, k1); sm.Ana = lerp(sm.Ana, m.Ana, k2); sm.Ox = lerp(sm.Ox, m.Ox, k2); sm.Ab = lerp(sm.Ab, m.Ab, k2);
  /* marrow reply and inset emphasis */
  const mg = $("marrowG"); mg.setAttribute("transform", "translate(125 130) scale(" + (1 + 0.05 * sm.Retic * Math.sin(tm / 400)).toFixed(3) + ") translate(-125 -130)");
  $("heinzG").setAttribute("opacity", (0.2 + 0.8 * sm.Ox).toFixed(2)); $("abG").setAttribute("opacity", (0.2 + 0.8 * sm.Ab).toFixed(2));
  const se = $("spleenG").querySelector("ellipse"); se.setAttribute("transform", "translate(770 130) scale(" + (0.86 + 0.3 * sm.Spleen).toFixed(3) + ") translate(-770 -130)");
  const le = $("liverG").querySelector("ellipse"); le.setAttribute("transform", "translate(770 378) scale(" + (1 + 0.03 * sm.Bili * Math.sin(tm / 500)).toFixed(3) + ") translate(-770 -378)");
  /* treatment marks fade with the chosen treatment */
  trigPill.style.opacity = m.drug === 1 ? "1" : "0"; sterPill.style.opacity = m.drug === 2 ? "1" : "0"; txPill.style.opacity = m.drug === 3 ? "1" : "0";
  /* normal red cells flow; anaemia thins them out */
  const vis = Math.round(14 * clamp(1 - 0.55 * sm.Ana));
  rbcs.forEach((r, i) => { r.x += r.v * 58 * dt; if (r.x > WW - 8) { r.x = 16; r.y = rnd(-24, 24); } place(r.g, r.x, CY + r.y, r.rot + Math.sin(tm / 500 + r.x) * 8, 1); r.g.style.opacity = i < vis ? 1 : 0.12; });
  /* reticulocytes enter in proportion to the marrow reply */
  const wantR = Math.round(sm.Retic * retics.length);
  retics.forEach((r, i) => { r.x += r.v * 44 * dt; if (r.x > 330) { r.x = 24; r.y = rnd(-18, 18); } place(r.g, r.x, CY + r.y, Math.sin(tm / 600 + i) * 9, 1); r.g.style.opacity = i < wantR ? 1 : 0; });
  /* doomed cells ride to the spleen and are eaten there */
  const spd = 0.018 + 0.075 * sm.Extra;
  doomed.forEach((d, i) => {
    d.u += dt * spd; if (d.u >= 1) { d.u = 0; d.eaten = 0; }
    const pt = extraTr.at(clamp(d.u)); const eat = clamp((d.u - 0.93) / 0.07); const sc = 1 - 0.85 * eat;
    place(d.g, pt.x, pt.y + Math.sin(tm / 500 + i * 2) * 2, pt.a, Math.max(0.12, sc)); d.g.style.opacity = sm.Extra > 0.04 ? 1 : 0;
    d.hz.setAttribute("opacity", sm.Ox.toFixed(2)); d.ab.setAttribute("opacity", sm.Ab.toFixed(2));
  });
  macs.forEach((mc, i) => place(mc.g, mc.x + Math.sin(tm / 1300 + mc.ph) * 3, mc.y + Math.cos(tm / 1500 + mc.ph) * 2.5, Math.sin(tm / 2200 + mc.ph) * 8, 1 + 0.1 * sm.Extra * Math.sin(tm / 320 + i)));
  /* oxidant trigger particles fall onto cells in the vessel */
  acc.ox += dt * sm.Ox * 6; while (acc.ox >= 1) { acc.ox--; const p = freeP(oxp); if (p) emit(p, rnd(320, 400), 158, rnd(-5, 5), rnd(18, 28), 0); }
  oxp.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 24, WW - 24); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.y > CY - 8 || p.t > 3.4) killP(p); });
  /* intravascular rupture: expanding rings in the lumen */
  acc.burst += dt * sm.Intra * 3.2; while (acc.burst >= 1) { acc.burst--; const p = freeP(bursts); if (p) emit(p, rnd(120, 620), CY + rnd(-20, 20), 0, 0, 0); }
  bursts.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (0.6 + p.t * 2.2).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2)); if (p.t > 0.9) killP(p); });
  /* freed haemoglobin drifts down toward the liver */
  acc.hb += dt * sm.Intra * 8; while (acc.hb >= 1) { acc.hb--; const p = freeP(hbp); if (p) emit(p, rnd(140, 640), CY + rnd(-16, 16), rnd(8, 20), rnd(6, 14), 0); }
  hbp.forEach((p) => { if (!p.on) return; p.t += dt; const dx = 760 - p.x, dy = 366 - p.y, dd = Math.hypot(dx, dy) || 1; p.x = clamp(p.x + (dx / dd) * 42 * dt + p.vx * dt * 0.3, 20, WW - 20); p.y = clamp(p.y + (dy / dd) * 42 * dt + p.vy * dt * 0.3, 50, 432); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (dd < 26 || p.t > 7) killP(p); });
  /* bilirubin from spleen and vessel breakdown converges on the liver */
  acc.bil += dt * sm.Bili * 9; while (acc.bil >= 1) { acc.bil--; const p = freeP(bilp); if (p) { const fromSpleen = Math.random() < 0.55; emit(p, fromSpleen ? rnd(700, 830) : rnd(200, 600), fromSpleen ? rnd(150, 185) : CY + rnd(-12, 12), 0, 0, 0); } }
  bilp.forEach((p) => { if (!p.on) return; p.t += dt; const dx = 770 - p.x, dy = 372 - p.y, dd = Math.hypot(dx, dy) || 1; p.x = clamp(p.x + (dx / dd) * 52 * dt, 20, WW - 20); p.y = clamp(p.y + (dy / dd) * 52 * dt, 50, 432); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (dd < 24 || p.t > 8) killP(p); });
  /* gauges */
  gg.haem.set(sm.EffH, wordOf(sm.EffH, 0.25, 0.6, ["low", "raised", "high"])); gg.bili.set(sm.Bili, wordOf(sm.Bili, 0.3, 0.65, ["normal", "raised", "high"]));
  gg.retic.set(sm.Retic, wordOf(sm.Retic, 0.3, 0.65, ["low", "raised", "high"])); gg.spleen.set(sm.Spleen, wordOf(sm.Spleen, 0.3, 0.65, ["small", "normal", "enlarged"]));
  gg.ana.set(sm.Ana, wordOf(sm.Ana, 0.2, 0.45, ["mild", "moderate", "severe"]));
}
run({ init, step });
