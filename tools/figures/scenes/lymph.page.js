/* Lymphoma scene: node architecture, Reed-Sternberg cells or CD20 B-cell sheets, spread map and gauges. */
const LY = { stage: $("stage"), over: $("over"), panel: $("panel") };
const W = SC.W;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function abY(parent, sc) { const g = mk("g", {}, parent); mk("path", { class: "ab2", d: "M0 8L0 0M0 0L-6 -7M0 0L6 -7" }, g); if (sc) place(g, 0, 0, 0, sc); return g; }
const NX = 275, NY = 252; // node centre

/* ---- node contents, built once; visibility follows the model ---- */
const nodeG = mk("g", {}, LY.stage);
mk("ellipse", { class: "node-out", cx: NX, cy: NY, rx: 158, ry: 122 }, nodeG);
mk("ellipse", { class: "node-in", cx: NX, cy: NY, rx: 138, ry: 104 }, nodeG);
mk("path", { class: "arr", d: "M96 190L132 218" }, nodeG);
mk("path", { class: "arr", d: "M418 286L452 306" }, nodeG);
const follPos = [[205, 180], [300, 160], [360, 215], [225, 300], [330, 322]];
const folls = follPos.map(([x, y], i) => { const g = mk("g", {}, nodeG); mk("circle", { class: "foll", cx: x, cy: y, r: 30 }, g); mk("circle", { class: "gc", cx: x, cy: y, r: 15 }, g); return g; });
/* reactive background: many small mixed cells, always present in Hodgkin, crowded out in NHL */
const react = [];
for (let i = 0; i < 34; i++) { const a = i * 2.399, r = 24 + (i * 37 % 100), cls = i % 5 === 0 ? "eos" : i % 7 === 0 ? "plasma" : i % 4 === 0 ? "mac" : "react";
  const g = cell(nodeG, { cls, r: cls === "mac" ? 11 : 7.5, nuc: 0.45, seed: i + 3, wob: 0.14 }); react.push({ g, x: NX + Math.cos(a) * r * 1.25, y: NY + Math.sin(a) * r * 0.92 }); }
/* Reed-Sternberg cells: few, large, two owl-eye nuclei */
const rsPos = [[330, 262], [238, 214], [292, 330], [368, 190], [196, 282]];
const rsCells = rsPos.map(([x, y], i) => { const g = mk("g", {}, nodeG); cell(g, { cls: "rs", r: 21, nuc: 0, seed: i + 11, wob: 0.08 });
  mk("circle", { class: "rs-nuc", cx: -7, cy: -3, r: 5.4 }, g); mk("circle", { class: "rs-nuc", cx: 7, cy: -3, r: 5.4 }, g);
  mk("circle", { class: "rs-dot", cx: -7, cy: -3, r: 1.6 }, g); mk("circle", { class: "rs-dot", cx: 7, cy: -3, r: 1.6 }, g); place(g, x, y, 0, 1); return { g, x, y, i }; });
/* B-cell sheet: monotonous cells filling the node, CD20 dots on the rim */
const sheet = [];
for (let i = 0; i < 44; i++) { const gx = 165 + (i % 8) * 32 + ((i * 13) % 9), gy = 168 + Math.floor(i / 8) * 30 + ((i * 7) % 8);
  if (Math.hypot((gx - NX) / 140, (gy - NY) / 105) > 0.96) continue;
  const g = mk("g", {}, nodeG); cell(g, { cls: "sheet", r: 12, nuc: 0.5, seed: i + 30, wob: 0.07 });
  for (let j = 0; j < 3; j++) { const a = j * 2.1 + i; mk("circle", { class: "cd20", cx: f1(Math.cos(a) * 11), cy: f1(Math.sin(a) * 11), r: 1.7 }, g); }
  place(g, gx, gy, 0, 1); sheet.push({ g, x: gx, y: gy, i }); }

/* ---- spread map: body, diaphragm, node groups, organs ---- */
const mapG = mk("g", {}, LY.stage);
mk("circle", { class: "body-o", cx: 762, cy: 104, r: 20 }, mapG);
mk("path", { class: "body-o", d: "M728 132C716 190 720 250 736 306L742 392L762 392L768 318L774 392L794 392L800 306C816 250 820 190 796 132C786 124 738 124 728 132Z" }, mapG);
mk("path", { class: "diaph", d: "M716 252L808 252" }, mapG);
mk("ellipse", { class: "organ", cx: 736, cy: 272, rx: 15, ry: 10 }, mapG);   // spleen
mk("ellipse", { class: "organ", cx: 788, cy: 270, rx: 17, ry: 11 }, mapG);   // liver
/* flags: [Hodgkin limited, Hodgkin advanced, NHL limited, NHL advanced] */
const sites = [
  { x: 744, y: 140, f: [1, 1, 0, 1] }, { x: 780, y: 140, f: [1, 1, 0, 1] },
  { x: 762, y: 196, f: [1, 1, 1, 1] },
  { x: 712, y: 178, f: [0, 1, 0, 1] }, { x: 812, y: 178, f: [0, 1, 0, 1] },
  { x: 736, y: 272, f: [0, 1, 0, 1], sp: 1 }, { x: 788, y: 270, f: [0, 1, 0, 1] },
  { x: 748, y: 302, f: [0, 1, 0, 1] }, { x: 776, y: 302, f: [0, 1, 1, 1] },
  { x: 730, y: 344, f: [0, 1, 0, 1] }, { x: 794, y: 344, f: [0, 1, 0, 1] },
  { x: 762, y: 330, f: [0, 0, 0, 1] },
].map((s) => { s.e = mk("circle", { class: "site" + (s.sp ? " sp" : ""), cx: s.x, cy: s.y, r: s.sp ? 6 : 7 }, mapG); return s; });
const beam = mk("path", { class: "beam", d: "M470 84L560 84L452 330L392 330Z", opacity: "0" }, LY.stage);
const field = mk("rect", { class: "field", x: 130, y: 138, width: 290, height: 228, rx: 20, opacity: "0" }, LY.stage);

/* ---- treatment particles ---- */
const chemo = pool(10, () => { const g = mk("g", {}, LY.stage); mk("rect", { class: "p-chemo", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2 }, g); return g; });
const abs = pool(12, () => abY(LY.stage, 1));
const acc = { c: 0, a: 0 };

/* ---- labels ---- */
const labels = [], marks = [];
function addLabel(ty, text, x, y, tx, ty2, tip) { const g = pill(LY.over, text, x, y, tx, ty2, tip); labels.push({ g, ty }); return g; }
function addMark(drugs, tys, text, x, y, tx, ty2, tip) { const g = pill(LY.over, text, x, y, tx, ty2, tip); marks.push({ g, drugs, tys }); return g; }
addLabel(-1, "Node capsule", 140, 168, 104, 92, "The capsule of the lymph node. Inside are follicles in the cortex, a T-cell paracortex and sinuses. Lymphoma grows from lymphocytes inside this architecture.");
addLabel(-1, "Germinal centre", 205, 180, 196, 116, "A follicle with a germinal centre, where B cells normally mature. In non-Hodgkin lymphoma the follicles are overrun and the architecture is effaced; in Hodgkin lymphoma much of it remains.");
addLabel(0, "Reed-Sternberg cell", 330, 262, 398, 128, "The malignant cell of classic Hodgkin lymphoma: large, often with two mirror-image nuclei like owl eyes. It is CD30 positive and usually lacks CD20, so anti-CD20 antibody does not bind it.");
addLabel(0, "Reactive background", 238, 330, 150, 402, "Most of the Hodgkin node is not cancer: reactive lymphocytes, eosinophils, plasma cells and histiocytes gather around the few Reed-Sternberg cells and cause the swelling and symptoms.");
addLabel(1, "Sheets of B cells", 275, 240, 285, 92, "In B-cell non-Hodgkin lymphoma one clone of B cells grows as monotonous sheets, filling the node and wiping out its normal zones.");
addLabel(1, "CD20 on B cells", 330, 190, 430, 128, "CD20 is a marker on the surface of B cells, shown as green dots. An anti-CD20 antibody binds here and marks the cell for destruction.");
addLabel(-1, "Node groups", 744, 140, 636, 96, "Chains of lymph nodes in the neck, armpits, chest, abdomen and groin (pale dots). Red dots are involved groups. Hodgkin lymphoma tends to march to the next group; non-Hodgkin spread is less orderly.");
addLabel(-1, "Diaphragm", 808, 252, 884, 224, "The diaphragm divides limited from advanced disease. Disease on both sides of it, or in organs, is advanced stage.");
addLabel(-1, "Spleen and organs", 788, 270, 884, 316, "The spleen counts as lymphoid tissue. Spread to liver or bone marrow (extranodal disease) is advanced and needs treatment throughout the body, not a local field.");
addLabel(-1, "B symptoms", 762, 392, 648, 402, "B symptoms: fever, drenching night sweats and weight loss without trying. They come from inflammatory signals released by the lymphoma and its reactive background.");
addMark([1], [-1], "Chemotherapy acts everywhere", 452, 306, 500, 402, "Chemotherapy travels in the blood to every node group and organ, so it is the backbone for advanced disease in both kinds of lymphoma.");
addMark([2], [1], "Anti-CD20 binds the sheet", 360, 300, 452, 402, "The antibody coats CD20 on the B-cell sheet and immune cells clear the coated cells. It is added to chemotherapy in B-cell non-Hodgkin lymphoma.");
addMark([2], [0], "No CD20 target here", 360, 300, 452, 402, "Reed-Sternberg cells usually lack CD20, so an anti-CD20 antibody drifts past without binding. It has no useful role in classic Hodgkin lymphoma.");
addMark([3], [-1], "Radiotherapy field", 420, 138, 500, 92, "Radiotherapy treats one local field (dashed outline). It can control limited disease in that field but cannot reach involved groups elsewhere.");

/* ---- gauges ---- */
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The patient";
  [["C", "Clone burden", "g-bad", "How much malignant clone is present: a few Reed-Sternberg cells in Hodgkin lymphoma, a whole sheet of B cells in non-Hodgkin lymphoma."], ["N", "Node swelling", "g-fl", "Enlargement of involved lymph nodes, from the clone plus the reactive cells it attracts."], ["Bs", "B symptoms", "g-eos", "Fever, drenching night sweats and weight loss. More likely with advanced disease."], ["Sp", "Spread", "g-cyt", "From one node region, to neighbouring groups, to both sides of the diaphragm and organs or marrow."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 170 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
}
const sm = { C: 0.4, N: 0.4, Bs: 0.2, Sp: 0.2, hl: 1, nhl: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.6);
  sm.C = lerp(sm.C, m.C, k); sm.N = lerp(sm.N, m.N, k); sm.Bs = lerp(sm.Bs, m.Bs, k); sm.Sp = lerp(sm.Sp, m.Sp, k);
  sm.hl = lerp(sm.hl, m.type === 0 ? 1 : 0, k); sm.nhl = 1 - sm.hl;
  const grow = 0.95 + 0.1 * sm.N;
  nodeG.setAttribute("transform", "translate(" + f1(NX * (1 - grow)) + " " + f1(NY * (1 - grow)) + ") scale(" + grow.toFixed(3) + ")");
  /* follicles fade as either clone effaces them */
  const efface = clamp(sm.C * (m.type === 1 ? 1.15 : 0.55));
  folls.forEach((f, i) => { const s = clamp(1 - efface + 0.12 * Math.sin(tm / 700 + i)); f.setAttribute("opacity", clamp(1.15 - efface).toFixed(2)); f.setAttribute("transform", "translate(" + f1(follPos[i][0] * (1 - s)) + " " + f1(follPos[i][1] * (1 - s)) + ") scale(" + s.toFixed(3) + ")"); });
  react.forEach((r, i) => { const vis = sm.hl * clamp(1.1 - sm.C * 0.35) + (1 - sm.C) * 0.25; place(r.g, r.x + Math.sin(tm / 900 + i) * 2, r.y + Math.cos(tm / 1100 + i * 2) * 2, 0, 1); r.g.style.opacity = clamp(vis).toFixed(2); });
  const rsWant = Math.round(sm.C * 1.4 * rsPos.length);
  rsCells.forEach((r, i) => { const on = i < rsWant; place(r.g, r.x, r.y + Math.sin(tm / 800 + i * 2) * 2.5, Math.sin(tm / 2000 + i) * 8, on ? 0.4 + 0.6 * sm.hl : 0.1); r.g.style.opacity = (on ? sm.hl : 0).toFixed(2); });
  const shWant = Math.round(clamp(sm.C * 1.5) * sheet.length);
  sheet.forEach((s, i) => { const on = i < shWant; place(s.g, s.x + Math.sin(tm / 1000 + i) * 1.4, s.y, 0, on ? 1 : 0.3); s.g.style.opacity = (on ? sm.nhl * clamp(0.35 + sm.C) : sm.nhl * 0.1).toFixed(2); });
  /* spread map: lit sites follow the pattern for this type and stage, dimmed by systemic treatment */
  const lvl = m.type * 2 + (m.adv ? 1 : 0);
  sites.forEach((s, i) => { const lit = s.f[lvl] && sm.Sp > 0.12 + i * 0.045; s.e.classList.toggle("on", !!lit); s.e.setAttribute("opacity", lit ? "1" : "0.45"); s.e.setAttribute("r", lit ? (s.sp ? 6.5 : 7.5) : (s.sp ? 6 : 7)); });
  /* treatments */
  beam.setAttribute("opacity", m.drug === 3 ? (0.12 + 0.05 * Math.sin(tm / 240)).toFixed(2) : "0");
  field.setAttribute("opacity", m.drug === 3 ? "0.9" : "0");
  acc.c += dt * (m.drug === 1 ? 3.2 : 0); while (acc.c >= 1) { acc.c--; const p = freeP(chemo); if (p) emit(p, 60, rnd(170, 330), rnd(55, 80), rnd(-8, 8), 0); }
  chemo.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(tm / 300 + p.x) * 0.12; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 70) + ")"); if (p.x > 430 || p.t > 6) kill(p); });
  acc.a += dt * (m.drug === 2 ? 3.4 : 0); while (acc.a >= 1) { acc.a--; const p = freeP(abs); if (p) { const tgt = sheet[Math.floor(Math.random() * Math.max(1, sheet.length))]; emit(p, 90, rnd(160, 340), 0, 0, tgt ? sheet.indexOf(tgt) : 0); } }
  abs.forEach((p) => { if (!p.on) return; p.t += dt;
    if (m.type === 1) { const tgt = sheet[p.k] || sheet[0]; const dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 62 * dt; p.y += (dy / d) * 62 * dt; if (d < 13) kill(p); }
    else { p.x += 52 * dt; p.y += Math.sin(tm / 350 + p.k) * 0.25; if (p.x > 450 || p.t > 7) kill(p); }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.sin(tm / 400 + p.k) * 24) + ")"); });
  labels.forEach((l) => { l.g.style.display = l.ty === -1 || l.ty === m.type ? "" : "none"; });
  marks.forEach((mk2) => { mk2.g.style.display = mk2.drugs.indexOf(m.drug) > -1 && (mk2.tys[0] === -1 || mk2.tys[0] === m.type) ? "" : "none"; });
  gg.C.set(sm.C, wordOf(sm.C, 0.25, 0.55, ["low", "moderate", "high"])); gg.N.set(sm.N, wordOf(sm.N, 0.3, 0.6, ["normal", "enlarged", "bulky"]));
  gg.Bs.set(sm.Bs, wordOf(sm.Bs, 0.25, 0.55, ["absent", "mild", "marked"])); gg.Sp.set(sm.Sp, wordOf(sm.Sp, 0.25, 0.55, ["confined", "regional", "widespread"]));
}
run({ init, step });
