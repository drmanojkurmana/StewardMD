/* Haemolysis scene: marrow makes cells, fragile cells burst in the vessel or are eaten
 * in the spleen, bilirubin travels to the liver. Spleen and liver are organ() art;
 * tracks and particles are anchored to their ports. Each treatment acts on the stage:
 * trigger removal caps the oxidant source, steroid docks on splenic macrophages while
 * antibody coats fade, transfusion drips in fresh cells while the spleen becomes a ghost. */
const CY = SC.CY, WW = SC.W;
const layers = { rbcs: $("rbcs"), doomed: $("doomed"), parts: $("parts"), phag: $("phag"), over: $("over"), panel: $("panel"), treat: $("treatG") };
let spleenO = null, liverO = null, doomedTr = null;
let spleenHilum = [797, 179], liverPorta = [753, 415];
let capEl = null, capDrug = -1;
let trigG = null, trigLid = null, dripG = null, ghostEl = null;
/* organs first, like hepenc: vessels and particles then meet real anatomy */
function initOrgans() {
  spleenO = organ($("spleenSlot"), "spleen", 805, 148, 150, {});
  liverO = organ($("liverSlot"), "liver", 780, 348, 180, {});
  spleenHilum = spleenO.ports.hilum || [spleenO.x, spleenO.y + 30];
  liverPorta = liverO.ports.porta || [liverO.x - 27, liverO.y + 67];
  doomedTr = track([[430, CY], [590, CY - 8], [688, 232], [738, 206], spleenHilum]);
}
function capText(d) {
  if (d === 1) return "Trigger removed. New red cells stay healthy and far fewer burst or are eaten.";
  if (d === 2) return "Steroid calms the immune attack. Fewer coated cells are eaten in the spleen.";
  if (d === 3) return "Transfusion adds healthy red cells while the spleen no longer traps them.";
  return "No treatment. Red cells break down faster than the marrow can replace them.";
}
/* ---- flowing red cells ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 14; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(20, WW - 20), y: rnd(-24, 24), v: rnd(0.8, 1.2), rot: rnd(-16, 16) }); } }
/* ---- reticulocytes: young cells with purple remnants, entering from the left ---- */
const retics = [];
function initRetic() { for (let i = 0; i < 5; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9.5, ry: 5.8 }, g); mk("circle", { class: "hm-retic-dot", cx: -3, cy: -1.5, r: 1.3 }, g); mk("circle", { class: "hm-retic-dot", cx: 2.5, cy: 1.8, r: 1.1 }, g); mk("circle", { class: "hm-retic-dot", cx: 1, cy: -2.4, r: 0.9 }, g); retics.push({ g, x: 30 + i * 90, y: rnd(-18, 18), v: rnd(0.7, 1) }); } }
/* ---- doomed cells: coated or oxidant damaged, travelling to the spleen hilum ---- */
const doomed = [];
function initDoomed() {
  for (let i = 0; i < 6; i++) {
    const g = mk("g", { class: "cl cl-rbc" }, layers.doomed); mk("ellipse", { class: "cl-b", rx: 10, ry: 6 }, g); mk("ellipse", { class: "cl-s", rx: 3.6, ry: 1.8 }, g);
    const hz = mk("g", {}, g); [[-4, -2], [3, 2], [5, -3]].forEach((p) => mk("circle", { class: "hm-heinz", cx: p[0], cy: p[1], r: 1.7 }, hz));
    const ab = mk("g", {}, g); [[-7, -5, -40], [7, -4, 40], [0, 7, 180]].forEach((p) => { const y = mk("path", { class: "hm-abY", d: "M0 4L0 0M0 0L-3.4 -4M0 0L3.4 -4" }, ab); y.setAttribute("transform", "translate(" + p[0] + " " + p[1] + ") rotate(" + p[2] + ")"); });
    doomed.push({ g, hz, ab, u: i / 6 });
  }
}
/* ---- macrophages around the spleen pulp, with steroid calm rings ---- */
const macs = [], rings = [];
function initMacs() {
  const P = spleenO.ports.pulp || [spleenO.x, spleenO.y];
  [[-38, -12], [30, -18], [-4, 30]].forEach((o, i) => {
    const g = mk("g", { class: "hot", tabindex: "0", "data-info": "Splenic macrophage: it inspects passing red cells and eats cells that are stiff or coated with antibody." }, layers.phag);
    const c = cell(g, { cls: "mac", r: 16, nuc: 0.42, seed: i * 3 + 2, wob: 0.13 });
    place(c, P[0] + o[0], P[1] + o[1], 0, 1);
    macs.push({ g: c, x: P[0] + o[0], y: P[1] + o[1], px: P[0] + o[0], py: P[1] + o[1], ph: i * 2.1 });
    const r = mk("circle", { class: "hm-ring", r: 21 }, layers.treat);
    r.setAttribute("opacity", "0"); rings.push(r);
  });
}
/* ---- treatment props: oxidant trigger with a cap lid, transfusion drip, spleen ghost ---- */
function initTreat() {
  trigG = mk("g", { class: "hot", tabindex: "0", "data-info": "Oxidant trigger: the spark that injures red cells when G6PD is low. Removing it stops new damage." }, layers.treat);
  mk("path", { class: "hm-trig", d: "M0 -9L7 0L0 9L-7 0Z" }, trigG);
  trigG.setAttribute("transform", "translate(360 178)");
  trigLid = mk("g", {}, layers.treat);
  mk("circle", { class: "hm-lid-ring", cx: 0, cy: 0, r: 14 }, trigLid);
  mk("path", { class: "hm-lid", d: "M-9 -9L9 9M9 -9L-9 9" }, trigLid);
  trigLid.setAttribute("transform", "translate(360 178)"); trigLid.setAttribute("opacity", "0");
  dripG = mk("g", { class: "hot", tabindex: "0", "data-info": "Transfusion: healthy donor red cells drip into the circulation and raise the red cell mass at once." }, layers.treat);
  mk("rect", { class: "hm-bag", x: 222, y: 64, width: 60, height: 36, rx: 8 }, dripG);
  mk("path", { class: "hm-tube", d: "M252 100L252 218" }, dripG);
  dripG.setAttribute("opacity", "0");
  ghostEl = mk("ellipse", { class: "hm-ghost", cx: f1(spleenO.x), cy: f1(spleenO.y), rx: f1(spleenO.w / 2), ry: f1(spleenO.h / 2) }, layers.treat);
  ghostEl.setAttribute("opacity", "0");
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const oxp = pool(16, () => mk("path", { class: "sc-p p-ox", d: "M0 -3.2L3 0L0 3.2L-3 0Z" }, layers.parts));
const hbp = pool(22, () => mk("circle", { class: "sc-p p-hb", r: 2.5 }, layers.parts));
const bilp = pool(26, () => mk("circle", { class: "sc-p p-bili", r: 2.7 }, layers.parts));
const bursts = pool(8, () => mk("circle", { class: "hm-burst", r: 5 }, layers.parts));
const drops = pool(8, () => mk("circle", { class: "hm-drop", r: 2.6 }, layers.parts));
const sters = [];
function initSter() {
  for (let i = 0; i < 7; i++) {
    const g = mk("g", {}, layers.parts);
    mk("rect", { class: "p-ster", x: -5, y: -2.5, width: 10, height: 5, rx: 2.5 }, g);
    mk("rect", { class: "p-ster2", x: 0, y: -2.5, width: 5, height: 5, rx: 2.5 }, g);
    g.setAttribute("opacity", "0");
    sters.push({ e: g, on: false, x: 0, y: 0, t: 0, mac: i % 3, docked: false, ox: rnd(-17, 17), oy: rnd(-17, 17) });
  }
}
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels, caption and gauges: eight short pills, left to right ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 260, 420, 580, 740];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["haem", "Haemolysis", "g-haem", "How fast red cells are being destroyed, in the vessel and in the spleen together."], ["bili", "Bilirubin", "g-bili", "Unconjugated bilirubin from haem breakdown, carried in blood to the liver. It gives the yellow colour."], ["retic", "Reticulocytes", "g-retic", "Young red cells released early by the marrow. A rise shows the marrow is answering the loss."], ["spleen", "Spleen size", "g-spleen", "The spleen enlarges when it removes many red cells over time. After splenectomy this falls."], ["ana", "Anaemia", "g-ana", "How low the red cell mass has fallen after destruction and marrow reply are balanced."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Marrow", 125, 78, 125, 60, "Bone marrow: the factory for red cells. Loss speeds it up and young reticulocytes enter the blood early.");
  pill(ox, "Heinz bodies", 360, 108, 360, 60, "Heinz bodies: clumps of damaged haemoglobin after oxidant injury. They make the cell rigid.");
  pill(ox, "Antibody coat", 530, 108, 530, 60, "Warm antibody coat: antibody on the cell surface marks it for removal in the spleen.");
  pill(ox, "Trigger", 360, 178, 445, 190, "Oxidant trigger: the spark that injures red cells when G6PD is low. Removing it stops new damage.");
  pill(ox, "Bursting", 300, 260, 300, 340, "Bursting in the vessel: fragile cells rupture here and spill haemoglobin into the plasma.");
  const bilMid = [(spleenHilum[0] + liverPorta[0]) / 2, (spleenHilum[1] + liverPorta[1]) / 2];
  pill(ox, "Bilirubin", bilMid[0], bilMid[1], 640, 366, "Bilirubin from broken cells travels in blood to the liver.");
  pill(ox, "Spleen", spleenO.x, spleenO.y - spleenO.h / 2 + 10, spleenO.x, 58, "Spleen: the filter. Macrophages here eat rigid or coated red cells.");
  pill(ox, "Liver", liverO.x + 50, liverO.y + liverO.h / 2 - 16, 905, 428, "Liver: it takes up bilirubin from blood. Fast breakdown yellows skin and eyes.");
  capEl = mk("text", { class: "hm-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { EffH: 0.4, Intra: 0.2, Extra: 0.2, Bili: 0.3, Retic: 0.3, Spleen: 0.3, Ana: 0.3, Ox: 0.5, Ab: 0.2, tx: 0, ster: 0, trig: 0 };
const acc = { ox: 0, hb: 0, bil: 0, burst: 0, drop: 0, ster: 0 };
function init() { initOrgans(); initRbc(); initRetic(); initDoomed(); initTreat(); initMacs(); initSter(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.EffH = lerp(sm.EffH, m.EffH, k2); sm.Intra = lerp(sm.Intra, m.Intra, k2); sm.Extra = lerp(sm.Extra, m.Extra, k2); sm.Bili = lerp(sm.Bili, m.Bili, k2); sm.Retic = lerp(sm.Retic, m.Retic, k2); sm.Spleen = lerp(sm.Spleen, m.Spleen, k1); sm.Ana = lerp(sm.Ana, m.Ana, k2); sm.Ox = lerp(sm.Ox, m.Ox, k2); sm.Ab = lerp(sm.Ab, m.Ab, k2);
  sm.tx = lerp(sm.tx, drug === 3 ? 1 : 0, Math.min(1, dt * 2.2)); sm.ster = lerp(sm.ster, drug === 2 ? 1 : 0, Math.min(1, dt * 2.2)); sm.trig = lerp(sm.trig, drug === 1 ? 1 : 0, Math.min(1, dt * 2.2));
  /* marrow reply and inset emphasis */
  const mg = $("marrowG"); mg.setAttribute("transform", "translate(125 130) scale(" + (1 + 0.05 * sm.Retic * Math.sin(tm / 400)).toFixed(3) + ") translate(-125 -130)");
  $("heinzG").setAttribute("opacity", (0.2 + 0.8 * sm.Ox).toFixed(2)); $("abG").setAttribute("opacity", (0.2 + 0.8 * sm.Ab).toFixed(2));
  /* treatment props: trigger dims and is capped, drip runs, spleen becomes a ghost */
  trigG.setAttribute("opacity", (0.15 + 0.85 * clamp(sm.Ox * 1.4)).toFixed(2));
  trigLid.setAttribute("opacity", sm.trig.toFixed(2));
  dripG.setAttribute("opacity", sm.tx.toFixed(2));
  ghostEl.setAttribute("opacity", sm.tx.toFixed(2));
  spleenO.g.setAttribute("transform", "translate(" + f1(spleenO.x) + " " + f1(spleenO.y) + ") scale(" + (0.9 + 0.25 * sm.Spleen).toFixed(3) + ")");
  spleenO.g.setAttribute("opacity", (1 - 0.85 * sm.tx).toFixed(2));
  /* normal red cells flow; anaemia thins them out, transfusion restores them */
  const vis = Math.round(14 * clamp(1 - 0.55 * sm.Ana));
  rbcs.forEach((r, i) => { r.x += r.v * 58 * dt; if (r.x > WW - 8) { r.x = 16; r.y = rnd(-24, 24); } place(r.g, r.x, CY + r.y, r.rot + Math.sin(tm / 500 + r.x) * 8, 1); r.g.style.opacity = i < vis ? 1 : 0.12; });
  /* reticulocytes enter in proportion to the marrow reply */
  const wantR = Math.round(sm.Retic * retics.length);
  retics.forEach((r, i) => { r.x += r.v * 44 * dt; if (r.x > 330) { r.x = 24; r.y = rnd(-18, 18); } place(r.g, r.x, CY + r.y, Math.sin(tm / 600 + i) * 9, 1); r.g.style.opacity = i < wantR ? 1 : 0; });
  /* doomed cells ride to the spleen hilum and are eaten there */
  const spd = 0.018 + 0.075 * sm.Extra;
  doomed.forEach((d, i) => {
    d.u += dt * spd; if (d.u >= 1) d.u = 0;
    const pt = doomedTr.at(clamp(d.u)); const eat = clamp((d.u - 0.93) / 0.07); const sc = 1 - 0.85 * eat;
    place(d.g, pt.x, pt.y + Math.sin(tm / 500 + i * 2) * 2, pt.a, Math.max(0.12, sc)); d.g.style.opacity = sm.Extra > 0.04 ? 1 : 0;
    d.hz.setAttribute("opacity", sm.Ox.toFixed(2)); d.ab.setAttribute("opacity", sm.Ab.toFixed(2));
  });
  macs.forEach((mc, i) => {
    mc.px = mc.x + Math.sin(tm / 1300 + mc.ph) * 3; mc.py = mc.y + Math.cos(tm / 1500 + mc.ph) * 2.5;
    place(mc.g, mc.px, mc.py, Math.sin(tm / 2200 + mc.ph) * 8, 1 + 0.06 * sm.Extra * Math.sin(tm / 320 + i));
    mc.g.setAttribute("opacity", (1 - 0.85 * sm.tx).toFixed(2));
    place(rings[i], mc.px, mc.py, 0, 1); rings[i].setAttribute("opacity", (sm.ster * (1 - sm.tx)).toFixed(2));
  });
  /* steroid capsules fly in and sit on the macrophages while antibody coats fade */
  if (drug === 2) { acc.ster += dt * 2.4; while (acc.ster >= 1) { acc.ster--; const s = sters.find((q) => !q.on); if (s) { s.on = true; s.docked = false; s.t = 0; s.x = rnd(620, 720); s.y = rnd(56, 78); s.mac = Math.floor(rnd(0, 3)); s.ox = rnd(-17, 17); s.oy = rnd(-17, 17); s.e.setAttribute("opacity", "0"); } } }
  sters.forEach((s) => {
    if (!s.on) return;
    if (drug !== 2) { const o = +(s.e.getAttribute("opacity") || 0) - dt * 2.5; if (o <= 0) { s.on = false; s.e.setAttribute("opacity", "0"); } else s.e.setAttribute("opacity", o.toFixed(2)); return; }
    const mc = macs[s.mac], gx = mc.px + s.ox, gy = mc.py + s.oy, dx = gx - s.x, dy = gy - s.y, dd = Math.hypot(dx, dy) || 1;
    if (!s.docked) { s.x += (dx / dd) * 110 * dt; s.y += (dy / dd) * 110 * dt; s.t += dt; s.e.setAttribute("opacity", clamp(s.t * 2).toFixed(2)); if (dd < 14) s.docked = true; }
    else { s.x = gx; s.y = gy; if (s.t < 1) { s.t = Math.min(1, s.t + dt * 2); s.e.setAttribute("opacity", s.t.toFixed(2)); } }
    place(s.e, s.x, s.y, Math.sin(tm / 500 + s.x) * 20, 1);
  });
  /* oxidant trigger particles fall onto cells in the vessel */
  acc.ox += dt * sm.Ox * 6; while (acc.ox >= 1) { acc.ox--; const p = freeP(oxp); if (p) emit(p, rnd(330, 390), 186, rnd(-5, 5), rnd(18, 28), 0); }
  oxp.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 24, WW - 24); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.y > CY - 8 || p.t > 3.4) killP(p); });
  /* transfusion drops fall from the bag into the vessel */
  if (sm.tx > 0.03) { acc.drop += dt * 7 * sm.tx; while (acc.drop >= 1) { acc.drop--; const p = freeP(drops); if (p) emit(p, 252 + rnd(-2, 2), 104, rnd(-3, 3), rnd(55, 85), 0); } }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 216 || p.t > 3) killP(p); });
  /* intravascular rupture: expanding rings in the lumen */
  acc.burst += dt * sm.Intra * 3.2; while (acc.burst >= 1) { acc.burst--; const p = freeP(bursts); if (p) emit(p, rnd(120, 620), CY + rnd(-20, 20), 0, 0, 0); }
  bursts.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (0.6 + p.t * 2.2).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2)); if (p.t > 0.9) killP(p); });
  /* freed haemoglobin drifts from the vessel to the liver porta */
  acc.hb += dt * sm.Intra * 8; while (acc.hb >= 1) { acc.hb--; const p = freeP(hbp); if (p) emit(p, rnd(140, 640), CY + rnd(-16, 16), rnd(8, 20), rnd(6, 14), 0); }
  hbp.forEach((p) => { if (!p.on) return; p.t += dt; const dx = liverPorta[0] - p.x, dy = liverPorta[1] - p.y, dd = Math.hypot(dx, dy) || 1; p.x = clamp(p.x + (dx / dd) * 42 * dt + p.vx * dt * 0.3, 20, WW - 20); p.y = clamp(p.y + (dy / dd) * 42 * dt + p.vy * dt * 0.3, 50, 432); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (dd < 26 || p.t > 7) killP(p); });
  /* bilirubin from the spleen hilum and vessel breakdown converges on the liver porta */
  acc.bil += dt * sm.Bili * 9; while (acc.bil >= 1) { acc.bil--; const p = freeP(bilp); if (p) { const fromSpleen = Math.random() < 0.55; emit(p, fromSpleen ? spleenHilum[0] + rnd(-25, 25) : rnd(200, 600), fromSpleen ? spleenHilum[1] + rnd(-15, 15) : CY + rnd(-12, 12), 0, 0, 0); } }
  bilp.forEach((p) => { if (!p.on) return; p.t += dt; const dx = liverPorta[0] - p.x, dy = liverPorta[1] - p.y, dd = Math.hypot(dx, dy) || 1; p.x = clamp(p.x + (dx / dd) * 52 * dt, 20, WW - 20); p.y = clamp(p.y + (dy / dd) * 52 * dt, 50, 432); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (dd < 24 || p.t > 8) killP(p); });
  /* gauges */
  gg.haem.set(sm.EffH, wordOf(sm.EffH, 0.25, 0.6, ["low", "raised", "high"])); gg.bili.set(sm.Bili, wordOf(sm.Bili, 0.3, 0.65, ["normal", "raised", "high"]));
  gg.retic.set(sm.Retic, wordOf(sm.Retic, 0.3, 0.65, ["low", "raised", "high"])); gg.spleen.set(sm.Spleen, wordOf(sm.Spleen, 0.3, 0.65, ["small", "normal", "enlarged"]));
  gg.ana.set(sm.Ana, wordOf(sm.Ana, 0.2, 0.45, ["mild", "moderate", "severe"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
