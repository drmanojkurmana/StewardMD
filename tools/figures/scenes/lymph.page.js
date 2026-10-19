/* Lymphoma scene: node histology beside a body map with real spleen and liver art.
 * Chemotherapy floods the blood vessel and shrinks the clone everywhere, anti-CD20
 * sticks onto CD20 and clears B-cell sheets (drifting past in Hodgkin), and a beam
 * field burns the node locally. Caption and gauges follow the model. */
const LY = { stage: $("stage"), over: $("over"), panel: $("panel") };
const W = SC.W;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: -1, st: 0, u: 0, tr: null }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = -1; p.st = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function abY(parent, sc) { const g = mk("g", {}, parent); mk("path", { class: "ab2", d: "M0 8L0 0M0 0L-6 -7M0 0L6 -7" }, g); if (sc) place(g, 0, 0, 0, sc); return g; }
const NX = 275, NY = 252; // node centre
let spleenO = null, trBlood = null;

/* ---- real organ art on the spread map; the blood vessel ends at the spleen hilum ---- */
function initOrgans() {
  spleenO = organ($("spleenSlot"), "spleen", 740, 276, 34, {});
  organ($("liverSlot"), "liver", 786, 272, 46, {});
  const hp = spleenO.ports.hilum;
  $("bloodV").setAttribute("d", "M60 320 L300 315 L520 285 L" + f1(hp[0]) + " " + f1(hp[1]));
  trBlood = track([[60, 320], [300, 315], [520, 285], hp]);
}

/* ---- node contents, built once; visibility follows the model ---- */
const nodeG = mk("g", {}, LY.stage);
mk("ellipse", { class: "node-out", cx: NX, cy: NY, rx: 158, ry: 122 }, nodeG);
mk("ellipse", { class: "node-in", cx: NX, cy: NY, rx: 138, ry: 104 }, nodeG);
mk("path", { class: "arr", d: "M96 190L132 218" }, nodeG);
mk("path", { class: "arr", d: "M418 286L452 306" }, nodeG);
const follPos = [[205, 180], [300, 160], [360, 215], [225, 300], [330, 322]];
const folls = follPos.map(([x, y]) => { const g = mk("g", {}, nodeG); mk("circle", { class: "foll", cx: x, cy: y, r: 30 }, g); mk("circle", { class: "gc", cx: x, cy: y, r: 15 }, g); return g; });
/* reactive background: many small mixed cells, present in Hodgkin, crowded out in NHL */
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

/* ---- spread map markers over the torso and organ art ---- */
const mapG = mk("g", {}, LY.stage);
const feverEl = mk("ellipse", { class: "ly-fever", cx: 762, cy: 250, rx: 58, ry: 115, opacity: "0" }, mapG);
const invS = mk("circle", { class: "ly-inv", cx: 740, cy: 276, r: 22, opacity: "0" }, mapG);
const invL = mk("circle", { class: "ly-inv", cx: 786, cy: 272, r: 24, opacity: "0" }, mapG);
/* flags: [Hodgkin limited, Hodgkin advanced, NHL limited, NHL advanced] */
const sites = [
  { x: 744, y: 140, f: [1, 1, 0, 1] }, { x: 780, y: 140, f: [1, 1, 0, 1] },
  { x: 762, y: 196, f: [1, 1, 1, 1] },
  { x: 712, y: 178, f: [0, 1, 0, 1] }, { x: 812, y: 178, f: [0, 1, 0, 1] },
  { x: 740, y: 276, f: [0, 1, 0, 1], sp: 1 }, { x: 786, y: 272, f: [0, 1, 0, 1] },
  { x: 748, y: 302, f: [0, 1, 0, 1] }, { x: 776, y: 302, f: [0, 1, 1, 1] },
  { x: 730, y: 344, f: [0, 1, 0, 1] }, { x: 794, y: 344, f: [0, 1, 0, 1] },
  { x: 762, y: 330, f: [0, 0, 0, 1] },
].map((s) => { s.e = mk("circle", { class: "site" + (s.sp ? " sp" : ""), cx: s.x, cy: s.y, r: s.sp ? 6 : 7 }, mapG); return s; });

/* ---- radiotherapy beam and field over the node ---- */
const beamEl = mk("path", { class: "beam", d: "M240 60L450 60L410 360L190 360Z", opacity: "0" }, LY.stage);
const bleachEl = mk("ellipse", { class: "ly-bleach", cx: NX, cy: NY, rx: 140, ry: 105, opacity: "0" }, LY.stage);
const fieldEl = mk("rect", { class: "field", x: 170, y: 140, width: 240, height: 200, rx: 18, opacity: "0" }, LY.stage);
const rays = [];
for (let i = 0; i < 8; i++) { const e = mk("path", { class: "ly-ray", d: "M0 0L16 22", opacity: "0" }, LY.stage);
  rays.push({ e, x: 200 + (i * 53) % 180, y: 160 + (i * 37) % 150, ph: i * 1.3 }); place(e, 200 + (i * 53) % 180, 160 + (i * 37) % 150, -12, 1); }

/* ---- treatment particles ---- */
const chemo = pool(14, () => { const g = mk("g", {}, LY.stage); mk("rect", { class: "p-chemo", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2 }, g); return g; });
const abs = pool(14, () => abY(LY.stage, 1));
const acc = { c: 0, a: 0 };

/* ---- labels: six visible at once, eight in all ---- */
const pillsHL = [], pillsNHL = [];
pill(LY.over, "Lymph node", 132, 200, 108, 100, "The node capsule. Follicles inside are overrun as the cancer clone grows.");
pillsHL.push(pill(LY.over, "Reed Sternberg cells", 330, 262, 398, 100, "The cancer cell of Hodgkin disease. Large with twin nuclei. It lacks CD20, so the antibody passes by."));
pillsHL.push(pill(LY.over, "Reactive cells", 238, 330, 150, 402, "Most swelling here is not cancer. Immune cells gather around a few cancer cells."));
pillsNHL.push(pill(LY.over, "B cell sheets", 275, 240, 300, 100, "One clone of B cells grows in sheets, fills the node and wipes out its follicles."));
pillsNHL.push(pill(LY.over, "CD20 target", 340, 200, 452, 144, "A marker dot on each B cell. The antibody sticks here and marks the cell for clearing."));
pill(LY.over, "Node groups", 744, 140, 636, 100, "Neck, chest, belly and groin groups. Red means involved. Crossing the diaphragm means advanced disease.");
pill(LY.over, "Spleen and liver", 786, 272, 884, 320, "Organ spread means advanced disease. It needs treatment through the blood, not a local field.");
pill(LY.over, "B symptoms", 762, 392, 648, 402, "Fever, drenching sweats and weight loss from signals released by the lymphoma.");

/* ---- caption inside the stage ---- */
const capEl = mk("text", { class: "ly-cap", x: 30, y: 428 }, LY.over);
capEl.textContent = "No treatment. Cancer cells fill the node and disease spreads.";
let capKey = "0|0|0";
function capText(d, type, adv) {
  if (d === 1) return "Chemotherapy kills cells everywhere. Nodes shrink and spread fades.";
  if (d === 2) return type === 1 ? "Antibody sticks to CD20 and clears B cells. Nodes shrink." : "Antibody finds no CD20 here, so nothing changes.";
  if (d === 3) return adv ? "Radiation treats a local field only. Disease elsewhere stays." : "Radiation clears the treated node field. Nearby nodes improve.";
  return "No treatment. Cancer cells fill the node and disease spreads.";
}

/* ---- gauges ---- */
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The patient";
  [["C", "Clone burden", "g-bad", "How much malignant clone is present: a few Reed-Sternberg cells in Hodgkin lymphoma, a whole sheet of B cells in non-Hodgkin lymphoma."], ["N", "Node swelling", "g-fl", "Enlargement of involved lymph nodes, from the clone plus the reactive cells it attracts."], ["Bs", "B symptoms", "g-eos", "Fever, drenching night sweats and weight loss. More likely with advanced disease."], ["Sp", "Spread", "g-cyt", "From one node region, to neighbouring groups, to both sides of the diaphragm and organs or marrow."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 170 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
}
function txEffOf(m) {
  if (m.drug === 1) return 0.68;
  if (m.drug === 2) return m.type === 1 ? 0.66 : 0;
  if (m.drug === 3) return m.adv ? 0.18 : 0.62;
  return 0;
}
const sm = { C: 0.4, N: 0.4, Bs: 0.2, Sp: 0.2, hl: 1, tx: 0 };
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.6);
  sm.C = lerp(sm.C, m.C, k); sm.N = lerp(sm.N, m.N, k); sm.Bs = lerp(sm.Bs, m.Bs, k); sm.Sp = lerp(sm.Sp, m.Sp, k);
  sm.hl = lerp(sm.hl, m.type === 0 ? 1 : 0, k); sm.tx = lerp(sm.tx, txEffOf(m), k);
  const nhl = 1 - sm.hl;
  const grow = 0.95 + 0.1 * sm.N;
  nodeG.setAttribute("transform", "translate(" + f1(NX * (1 - grow)) + " " + f1(NY * (1 - grow)) + ") scale(" + grow.toFixed(3) + ")");
  /* follicles fade as either clone effaces them, and return with treatment */
  const efface = clamp(sm.C * (m.type === 1 ? 1.15 : 0.55));
  folls.forEach((f, i) => { const s = clamp(1 - efface + 0.12 * Math.sin(tm / 700 + i)); f.setAttribute("opacity", clamp(1.15 - efface).toFixed(2)); f.setAttribute("transform", "translate(" + f1(follPos[i][0] * (1 - s)) + " " + f1(follPos[i][1] * (1 - s)) + ") scale(" + s.toFixed(3) + ")"); });
  react.forEach((r, i) => { const vis = sm.hl * clamp(1.1 - sm.C * 0.35) + (1 - sm.C) * 0.25; place(r.g, r.x + Math.sin(tm / 900 + i) * 2, r.y + Math.cos(tm / 1100 + i * 2) * 2, 0, 1); r.g.style.opacity = clamp(vis).toFixed(2); });
  /* malignant cells shrink and thin out under effective treatment */
  const shrink = 1 - 0.35 * sm.tx;
  const rsWant = Math.round(sm.C * 1.4 * rsCells.length);
  rsCells.forEach((r, i) => { const on = i < rsWant; place(r.g, r.x, r.y + Math.sin(tm / 800 + i * 2) * 2.5, Math.sin(tm / 2000 + i) * 8, on ? (0.55 + 0.45 * sm.hl) * shrink : 0.1); r.g.style.opacity = (on ? sm.hl : 0).toFixed(2); });
  const shWant = Math.round(clamp(sm.C * 1.5) * sheet.length);
  sheet.forEach((s, i) => { const on = i < shWant; place(s.g, s.x + Math.sin(tm / 1000 + i) * 1.4, s.y, 0, on ? shrink : 0.3); s.g.style.opacity = (on ? nhl * clamp(0.35 + sm.C) : nhl * 0.1).toFixed(2); });
  /* spread map: lit sites follow the pattern for this type and stage, dimmed by systemic treatment */
  const lvl = m.type * 2 + (m.adv ? 1 : 0);
  sites.forEach((s, i) => { const lit = s.f[lvl] && sm.Sp > 0.12 + i * 0.045; s.e.classList.toggle("on", !!lit); s.e.setAttribute("opacity", lit ? "1" : "0.45"); s.e.setAttribute("r", lit ? (s.sp ? 6.5 : 7.5) : (s.sp ? 6 : 7)); });
  feverEl.setAttribute("opacity", (sm.Bs * 0.5).toFixed(2));
  const inv = (clamp((sm.Sp - 0.1) * 1.6) * 0.55).toFixed(2);
  invS.setAttribute("opacity", inv); invL.setAttribute("opacity", inv);
  /* radiotherapy: beam, field, rays and a pale burn over the node */
  const rad = m.drug === 3 ? 1 : 0;
  beamEl.setAttribute("opacity", rad ? (0.26 + 0.06 * Math.sin(tm / 240)).toFixed(2) : "0");
  fieldEl.setAttribute("opacity", rad ? "0.9" : "0");
  bleachEl.setAttribute("opacity", rad ? "0.16" : "0");
  rays.forEach((r) => { r.e.setAttribute("opacity", rad ? (0.35 + 0.6 * Math.abs(Math.sin(tm / 150 + r.ph))).toFixed(2) : "0"); });
  /* chemotherapy rides the blood vessel, slowing where it soaks the node */
  acc.c += dt * (m.drug === 1 ? 4 : 0);
  while (acc.c >= 1) { acc.c--; const p = freeP(chemo); if (p && trBlood) { emit(p, 0, 0, 0, 0); p.tr = trBlood; p.u = 0; } }
  chemo.forEach((p) => { if (!p.on || !p.tr) return; p.t += dt;
    const q0 = p.tr.at(p.u), inNode = Math.hypot((q0.x - NX) / 150, (q0.y - NY) / 115) < 1;
    p.u += dt * (inNode ? 0.45 : 1) * 75 / p.tr.len;
    const q = p.tr.at(Math.min(1, p.u));
    p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(p.t * 70) + ")");
    if (p.u >= 1 || p.t > 12) kill(p); });
  /* anti-CD20: sticks onto CD20 in NHL, drifts past in Hodgkin */
  acc.a += dt * (m.drug === 2 ? 3.4 : 0);
  while (acc.a >= 1) { acc.a--;
    const p = freeP(abs); if (!p) break;
    if (m.type === 1) { const want = Math.round(clamp(sm.C * 1.5) * sheet.length); const live = [];
      for (let i = 0; i < want && i < sheet.length; i++) live.push(i);
      emit(p, 70, rnd(180, 330), 0, 0); p.k = live.length ? live[Math.floor(Math.random() * live.length)] : -1;
    } else { emit(p, 70, rnd(180, 330), rnd(45, 65), rnd(-6, 6)); }
  }
  abs.forEach((p) => { if (!p.on) return; p.t += dt;
    if (m.type === 1 && p.k >= 0 && sheet[p.k]) { const tgt = sheet[p.k];
      if (p.st === 1) { p.e.setAttribute("transform", "translate(" + f1(tgt.x + 11) + " " + f1(tgt.y - 4) + ") rotate(-18)"); if (p.t > 3.2) kill(p); }
      else { const dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.hypot(dx, dy) || 1;
        p.x += (dx / d) * 70 * dt; p.y += (dy / d) * 70 * dt;
        p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.sin(tm / 400 + p.k) * 24) + ")");
        if (d < 13) { p.st = 1; p.t = 0; } }
    } else { p.x += (p.vx || 52) * dt; p.y += p.vy * dt + Math.sin(tm / 350 + p.x * 0.05) * 0.25;
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.sin(tm / 400 + p.t) * 24) + ")");
      if (p.x > 470 || p.t > 7) kill(p); } });
  pillsHL.forEach((g) => { g.style.display = m.type === 0 ? "" : "none"; });
  pillsNHL.forEach((g) => { g.style.display = m.type === 1 ? "" : "none"; });
  const key = m.drug + "|" + m.type + "|" + (m.adv ? 1 : 0);
  if (key !== capKey) { capKey = key; const t = capText(m.drug, m.type, m.adv); if (capEl.textContent !== t) capEl.textContent = t; }
  gg.C.set(sm.C, wordOf(sm.C, 0.25, 0.55, ["low", "moderate", "high"])); gg.N.set(sm.N, wordOf(sm.N, 0.3, 0.6, ["normal", "enlarged", "bulky"]));
  gg.Bs.set(sm.Bs, wordOf(sm.Bs, 0.25, 0.55, ["absent", "mild", "marked"])); gg.Sp.set(sm.Sp, wordOf(sm.Sp, 0.25, 0.55, ["confined", "regional", "widespread"]));
}
run({ init, step });
