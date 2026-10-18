/* Neonatal RDS scene: immature type II cell, surfactant lining, tension, collapse, hyaline membranes, chest haze and the gauges. */
const WW = SC.W;
const layers = { surf: $("surfG"), cells: $("cellsG"), rbc: $("rbcsG"), parts: $("parts"), over: $("over"), panel: $("panel"), alvAir: $("alvAir"), hyal: $("hyal"), fluid: $("fluidEl"), haze: $("hazeEl"), tension: $("tensionArrows"), mini: $("miniLung") };
/* ---- type II pneumocyte on the alveolar wall ---- */
const type2 = cell(layers.cells, { cls: "type2", r: 21, nuc: 0.4, seed: 4, wob: 0.12 });
[[-7, -5, 3.4], [6, -8, 2.8], [-2, 7, 3], [9, 5, 2.4]].forEach(([x, y, r]) => mk("circle", { class: "nrds-lam", cx: x, cy: y, r }, type2));
const T2X = 565, T2Y = 288;
/* ---- surfactant dots lining the air space ---- */
const surfDots = [];
function initSurf() { for (let i = 0; i < 26; i++) { const e = mk("circle", { class: "nrds-surf", r: 3 }, layers.surf); surfDots.push({ e, a: (i / 26) * 6.283 }); } }
/* ---- red cells in the capillary ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 14; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 8.5, ry: 5 }, g); mk("ellipse", { class: "cl-s", rx: 3.2, ry: 1.6 }, g); rbcs.push({ g, x: rnd(310, 610), y: rnd(-8, 8), v: rnd(0.8, 1.2), rot: rnd(-18, 18) }); } }
/* ---- particle pools (items expose their element as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const oxy = pool(18, () => mk("circle", { class: "sc-p p-oxy", r: 2.6 }, layers.parts));
const surfTxP = pool(10, () => mk("path", { class: "sc-p p-surfTx", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const sterP = pool(10, () => mk("rect", { class: "sc-p p-ster", x: -2.4, y: -2.4, width: 4.8, height: 4.8, rx: 1.2 }, layers.parts));
const cpapP = pool(12, () => mk("circle", { class: "sc-p p-cpap", r: 2.4 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The baby";
  [["surf", "Surfactant", "g-surf", "Surfactant made by type II alveolar cells, plus any surfactant given after birth. It lowers surface tension."], ["tens", "Tension", "g-tens", "Surface tension at the air surface of the alveolus. High tension pulls the alveolus closed."], ["coll", "Collapse", "g-coll", "How much the alveoli collapse at the end of each breath (atelectasis), so less air stays in the lung."], ["hyal", "Hyaline", "g-hyal", "Hyaline membranes: protein rich fluid and dead epithelial cells lining the injured alveolar wall."], ["haze", "Haze", "g-haze", "Ground glass haze on the chest film, from many partly collapsed and fluid lined alveoli."], ["oxy", "Oxygen", "g-oxy", "Oxygen reaching the blood. Blood passing collapsed alveoli stays low in oxygen, so hypoxia follows."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Preterm lung", 98, 150, 98, 100, "Born early, before the lungs have matured. The earlier the birth, the less surfactant the type II cells can make.");
  pill(ox, "Surfactant", 370, 148, 250, 100, "Surfactant: the soapy lining layer made by type II cells. It lowers surface tension so alveoli stay open.");
  pill(ox, "Air space", 460, 222, 460, 100, "The air space of one alveolus. It shrinks when surface tension is high and the wall collapses inward.");
  pill(ox, "High tension", 382, 176, 210, 205, "High surface tension pulls the alveolar wall inward at the end of each breath, collapsing the air space.");
  pill(ox, "Hyaline membrane", 352, 255, 210, 340, "Hyaline membrane: a lining of protein rich fluid and dead epithelial cells on the injured alveolar wall. It blocks gas exchange.");
  pill(ox, "Type II cell", T2X, T2Y, 678, 335, "Type II pneumocyte: the alveolar cell that makes and releases surfactant. In a preterm baby it is immature and makes too little.");
  pill(ox, "Capillary", 460, 348, 460, 392, "Capillary next to the alveolus. Blood flowing past a collapsed alveolus picks up little oxygen.");
  pill(ox, "Ground glass", 811, 168, 811, 278, "Ground glass pattern: a hazy, pale chest film with small lung volumes, from widespread collapse and fluid lined alveoli on both sides.");
  const cp = pill(ox, "CPAP support", 565, 80, 650, 100, "CPAP: continuous positive airway pressure. Steady pressure through the nose holds alveoli open while the baby breathes."); cp.setAttribute("id", "cpap-pill");
}
const sm = { Prod: 0.1, Surf: 0.1, Tension: 0.9, Collapse: 0.8, Hyal: 0.7, Haze: 0.7, Ox: 0.2, ster: 0, surfTx: 0, cpap: 0 };
const acc = { oxy: 0, surfTx: 0, ster: 0, cpap: 0 };
function init() { initSurf(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.Prod = lerp(sm.Prod, m.Prod, k2); sm.Surf = lerp(sm.Surf, m.Surf, k2); sm.Tension = lerp(sm.Tension, m.Tension, k2); sm.Collapse = lerp(sm.Collapse, m.Collapse, k1); sm.Hyal = lerp(sm.Hyal, m.Hyal, k2); sm.Haze = lerp(sm.Haze, m.Haze, k2); sm.Ox = lerp(sm.Ox, m.Ox, k1); sm.ster = lerp(sm.ster, m.ster, k1); sm.surfTx = lerp(sm.surfTx, m.surfTx, k1); sm.cpap = lerp(sm.cpap, m.cpap, k1);
  /* alveolar air space shrinks as collapse rises */
  const airRx = 132 * (1 - 0.5 * sm.Collapse), airRy = 88 * (1 - 0.55 * sm.Collapse);
  layers.alvAir.setAttribute("rx", f1(airRx)); layers.alvAir.setAttribute("ry", f1(airRy));
  layers.hyal.setAttribute("rx", f1(airRx + 7)); layers.hyal.setAttribute("ry", f1(airRy + 6)); layers.hyal.setAttribute("opacity", (sm.Hyal * 0.9).toFixed(2));
  layers.fluid.setAttribute("opacity", (m.Edema * 0.65).toFixed(2));
  layers.haze.setAttribute("opacity", (sm.Haze * 0.62).toFixed(2));
  layers.tension.setAttribute("opacity", (0.15 + 0.85 * sm.Tension).toFixed(2));
  layers.mini.setAttribute("transform", "translate(" + f1(811 - 811 * (1 - 0.14 * sm.Collapse)) + " " + f1(168 - 168 * (1 - 0.14 * sm.Collapse)) + ") scale(" + (1 - 0.14 * sm.Collapse).toFixed(3) + ")");
  /* type II cell: size and pulse follow its own surfactant production */
  place(type2, T2X, T2Y, Math.sin(tm / 2400) * 5, (0.78 + 0.38 * sm.Prod) * (1 + 0.04 * Math.sin(tm / 320)));
  /* surfactant dots appear along the lining as surfactant rises */
  surfDots.forEach((d, i) => { const x = 460 + Math.cos(d.a) * (airRx - 7), y = 222 + Math.sin(d.a) * (airRy - 7); d.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ")"); d.e.setAttribute("opacity", (i / surfDots.length < sm.Surf ? 0.95 : 0.07).toFixed(2)); });
  /* oxygen crosses from open air spaces to the capillary */
  acc.oxy += dt * (2 + 9 * sm.Ox); while (acc.oxy >= 1) { acc.oxy--; const p = free(oxy); if (p) emit(p, rnd(370, 550), rnd(175, 255), rnd(-4, 4), rnd(24, 38), 0); }
  oxy.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 320, 600); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 330) kill(p); });
  /* red cells: flow slows when oxygen and openness are low */
  const flow = clamp(0.3 + 0.8 * sm.Ox);
  rbcs.forEach((r) => { r.x += r.v * 62 * flow * dt; if (r.x > 614) { r.x = 308; r.y = rnd(-8, 8); } place(r.g, r.x, 348 + r.y, r.rot, 1); r.g.style.opacity = (0.45 + 0.55 * sm.Ox).toFixed(2); });
  /* surfactant given after birth: droplets down the airway into the alveolus */
  acc.surfTx += dt * sm.surfTx * 5; while (acc.surfTx >= 1) { acc.surfTx--; const p = free(surfTxP); if (p) emit(p, rnd(558, 572), 74, rnd(-3, 3), rnd(42, 58), 0); }
  surfTxP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + (460 - p.x) * dt * 0.25; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 330, 590)) + " " + f1(clamp(p.y, 60, 300)) + ")"); if (p.y > 265 || p.t > 4) kill(p); });
  /* antenatal steroid: signals reach the type II cell and mature it */
  acc.ster += dt * sm.ster * 5; while (acc.ster >= 1) { acc.ster--; const p = free(sterP); if (p) emit(p, 140, rnd(140, 165), 0, 0, 0); }
  sterP.forEach((p) => { if (!p.on) return; p.t += dt; const dx = T2X - p.x, dy = T2Y - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 56 * dt; p.y += (dy / d) * 56 * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 930)) + " " + f1(clamp(p.y, 55, 395)) + ") rotate(" + f1(tm / 6) + ")"); if (d < 26 || p.t > 9) kill(p); });
  /* CPAP: steady pressure particles down the airway, holding the alveolus open */
  acc.cpap += dt * sm.cpap * 8; while (acc.cpap >= 1) { acc.cpap--; const p = free(cpapP); if (p) emit(p, rnd(558, 572), 70, rnd(-2, 2), rnd(52, 66), 0); }
  cpapP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + (500 - p.x) * dt * 0.2; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 360, 580)) + " " + f1(clamp(p.y, 60, 300)) + ")"); if (p.y > 250 || p.t > 4) kill(p); });
  const cpEl = $("cpap-pill"); if (cpEl) cpEl.style.opacity = sm.cpap.toFixed(2);
  /* gauges */
  gg.surf.set(sm.Surf, wordOf(sm.Surf, 0.3, 0.68, ["low", "some", "good"])); gg.tens.set(sm.Tension, wordOf(sm.Tension, 0.3, 0.62, ["low", "raised", "high"])); gg.coll.set(sm.Collapse, wordOf(sm.Collapse, 0.3, 0.62, ["little", "some", "marked"]));
  gg.hyal.set(sm.Hyal, wordOf(sm.Hyal, 0.28, 0.58, ["few", "some", "many"])); gg.haze.set(sm.Haze, wordOf(sm.Haze, 0.3, 0.62, ["clear", "hazy", "whiteout"])); gg.oxy.set(sm.Ox, wordOf(sm.Ox, 0.3, 0.62, ["very low", "low", "near normal"]));
}
run({ init, step });
