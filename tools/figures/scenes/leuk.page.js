/* Leukaemia scene, left to right: stem cells make progenitors that mature and leave
 * through the vessel; the leukaemic crowd blocks maturation. Chemotherapy capsules
 * kill dividing blasts, a kinase blocker docks on BCR-ABL and its growth signal
 * fades, and donor stem cells rebuild the marrow after transplant. */
const layers = { stage: $("stage"), over: $("over"), panel: $("panel"), health: $("healthLay"), crowd: $("crowdLay") };
let vesselO = null, capEl = null, capDrug = -1, capType = -1, treatDrug = -1, treatType = -1;
const FUS = [753, 106], CROWD = [420, 240];
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0, ty: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

/* ---- fixed cells ---- */
const stems = [[80, 190], [80, 250], [80, 310]].map(([x, y], i) => { const g = mk("g", {}, layers.stage); cell(g, { cls: "stem", r: 18, nuc: 0.42, seed: i * 3 + 1, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y }; });
const progs = [[200, 190], [200, 244], [200, 298], [200, 352]].map(([x, y], i) => { const g = mk("g", {}, layers.stage); cell(g, { cls: "prog", r: 12, nuc: 0.4, seed: i * 2 + 5, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y }; });
function grid(n, x0, y0, dx, dy, cols) { return Array.from({ length: n }, (_, i) => ({ x: x0 + (i % cols) * dx + ((i * 37) % 13) - 6, y: y0 + Math.floor(i / cols) * dy + ((i * 53) % 11) - 5, s: 0 })); }
const blasts = grid(28, 300, 120, 36, 52, 6).map((p, i) => { const g = mk("g", {}, layers.stage); cell(g, { cls: "blast", r: 14, nuc: 0.58, seed: i + 2, wob: 0.09 }); return { g, x: p.x, y: p.y, s: 0, i }; });
const lymphs = grid(28, 300, 120, 36, 52, 6).map((p, i) => { const g = mk("g", {}, layers.stage); cell(g, { cls: "cll", r: 9, nuc: 0.68, seed: i + 30, wob: 0.06 }); return { g, x: p.x + 8, y: p.y + 6, s: 0, i }; });
const myels = grid(18, 320, 140, 44, 48, 5).map((p, i) => { const g = mk("g", {}, layers.stage); cell(g, { cls: "neut", r: 11, nuc: 0.55, nucCls: "multi", seed: i + 50, wob: 0.12 }); return { g, x: p.x, y: p.y, s: 0, i }; });
const mats = [[566, 170], [592, 224], [566, 278], [592, 332]].map(([x, y], i) => { const g = mk("g", {}, layers.stage); cell(g, { cls: "neut", r: 11, nuc: 0.55, nucCls: "multi", seed: i + 70, wob: 0.12 }); return { g, x, y, s: 0 }; });
/* differentiation block cross */
const blockG = mk("g", { opacity: "0" }, layers.stage);
mk("path", { class: "lk-block", d: "M524 242L540 258M540 242L524 258" }, blockG);
/* Philadelphia chromosome inset with kinase receptors for the blocker */
const phG = mk("g", { opacity: "0" }, layers.stage);
mk("rect", { class: "lk-chr9", x: 668, y: 78, width: 14, height: 56, rx: 6 }, phG);
mk("rect", { class: "lk-chr22", x: 694, y: 78, width: 14, height: 34, rx: 6 }, phG);
mk("rect", { class: "lk-chr9", x: 694, y: 100, width: 14, height: 12, rx: 6 }, phG);
mk("path", { d: "M712 107H740", stroke: "var(--anatomy-mid)", "stroke-width": 1.6 }, phG);
mk("rect", { class: "lk-fus", x: 746, y: 78, width: 14, height: 56, rx: 6 }, phG);
const receptors = [[778, 84], [778, 106], [778, 128], [753, 66]].map(([x, y]) => {
  const e = mk("circle", { class: "lk-rec", cx: x, cy: y, r: 5 }, phG);
  const dot = mk("circle", { class: "sc-p p-tki", cx: x, cy: y, r: 3, opacity: "0" }, phG);
  return { e, dot, x, y };
});
/* blood cells flowing inside the vessel organ */
const vesselRbcs = Array.from({ length: 10 }, (_, i) => { const g = mk("g", { class: "cl cl-rbc" }, layers.stage); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); return { g, x: 786 + (i % 3) * 16, y: 205 + i * 19, v: 0.8 + (i % 4) * 0.15 }; });
const vesselPlts = Array.from({ length: 6 }, (_, i) => { const g = mk("g", {}, layers.stage); cell(g, { cls: "plt", r: 5, seed: i + 90, wob: 0.15, n: 7 }); return { g, x: 790 + (i % 2) * 30, y: 210 + i * 30, v: 0.6 }; });
const vesselNeus = Array.from({ length: 4 }, (_, i) => { const g = mk("g", {}, layers.stage); cell(g, { cls: "neut", r: 9, nuc: 0.55, nucCls: "multi", seed: i + 110, wob: 0.12 }); return { g, x: 796 + (i % 2) * 24, y: 220 + i * 44, v: 0.5 }; });
/* particles */
const divs = mkPool(18, () => mk("circle", { class: "sc-p p-div", r: 2.2 }, layers.stage));
const tkis = mkPool(12, () => mk("circle", { class: "sc-p p-tki", r: 2.6 }, layers.stage));
const sigs = mkPool(14, () => mk("circle", { class: "sc-p p-sig", r: 2.4 }, layers.stage));
const donors = mkPool(8, () => { const g = mk("g", {}, layers.stage); cell(g, { cls: "donor", r: 8, nuc: 0.42, seed: 5, wob: 0.1 }); return g; });
const chemos = mkPool(8, () => { const g = mk("g", {}, layers.stage); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
function initOrgans() {
  vesselO = organ($("vesselSlot"), "vessel", 810, 300, 104, { h: 210 });
}
function capText(d, t) {
  if (t === 0) {
    if (d === 1) return "Healthy marrow. Chemotherapy still harms dividing cells.";
    if (d === 2) return "Healthy marrow. No BCR-ABL target, so the blocker changes little.";
    if (d === 3) return "Healthy marrow. A transplant rebuilds what is already healthy.";
    return "Healthy marrow. Stem cells mature into red cells, neutrophils and platelets.";
  }
  if (d === 1) return "Chemotherapy kills dividing blasts. The crowd shrinks and healthy cells grow back.";
  if (d === 2) return (t === 3 || t === 4) ? "Kinase blocker sits on BCR-ABL. The growth signal fades and counts recover." : "Kinase blocker has no BCR-ABL target here, so little changes.";
  if (d === 3) return "Donor stem cells rebuild the marrow. Healthy blood cells return.";
  if (t === 1 || t === 2) return "No treatment. Blasts crowd the marrow and healthy blood cells run low.";
  if (t === 3) return "No treatment. BCR-ABL drives too many myeloid cells.";
  if (t === 4) return "No treatment. Blast crisis crowds out healthy blood cells.";
  return "No treatment. Long lived lymphocytes pile up and crowd the marrow.";
}
/* one treatment pill whose words and anchor follow the chosen treatment */
let treatG = null, treatDot = null, treatLeader = null, treatTextEl = null, phPill = null;
function treatWords(d, t) {
  if (d === 1) return ["Chemo kills dividing blasts", "Chemotherapy kills dividing cells, including blasts. The crowd shrinks and healthy cells grow back.", CROWD[0], CROWD[1]];
  if (d === 2 && (t === 3 || t === 4)) return ["Blocker sits on BCR-ABL", "The kinase blocker docks on the BCR-ABL kinase. The growth signal fades, so the excess pile up ends.", FUS[0], FUS[1]];
  if (d === 2) return ["No BCR-ABL target here", "This leukaemia is not driven by BCR-ABL, so the kinase blocker has little to dock on and little changes.", CROWD[0], CROWD[1]];
  if (d === 3) return ["New donor marrow grows", "Stem cell transplant: donor stem cells settle in the cleared marrow and grow a new healthy blood system.", 80, 250];
  return ["", "", 0, 0];
}
function pillText(g, s) { const t = g.querySelector("text"); if (t && t.textContent !== s) t.textContent = s; }
function initLabels() {
  const o = layers.over;
  pill(o, "Stem cell", 80, 190, 150, 40, "Haematopoietic stem cell: the marrow stem cell that normally makes all blood cell lines. Leukaemia starts with a change in a stem or early progenitor cell.");
  pill(o, "Leukaemic blasts", 390, 172, 400, 40, "The leukaemic crowd: blasts in the acute leukaemias, excess myeloid cells in CML, and mature looking lymphocytes in CLL. They build up and crowd the marrow.");
  phPill = pill(o, "Philadelphia change", FUS[0], FUS[1], 700, 40, "Philadelphia change: a swap between two chromosomes joins BCR to ABL, making a kinase that is always on. It drives CML and the kinase blocker docks on it.");
  pill(o, "Blocked maturation", 532, 250, 450, 392, "Blocked maturation: the leukaemic crowd fails to mature and crowds out healthy makers, so few normal blood cells are made despite a full marrow.");
  pill(o, "Healthy blood cells", 580, 224, 620, 392, "Healthy mature cells ready to leave the marrow. When they fall, red cells, neutrophils and platelets all run low.");
  pill(o, "Blood vessel", 810, 250, 880, 188, "Blood leaving the marrow. Low red cells cause anaemia, low neutrophils allow infection, and low platelets cause bruising and bleeding.");
  treatG = pill(o, "Chemo kills dividing blasts", CROWD[0], CROWD[1], 250, 392, "Treatment action.");
  treatDot = treatG.querySelector("circle"); treatLeader = treatG.querySelector("path"); treatTextEl = treatG.querySelector("text");
  treatG.style.display = "none";
  capEl = mk("text", { class: "lk-cap", x: 30, y: 432 }, o); capEl.textContent = capText(0, 1);
}
/* gauges */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "Marrow and blood";
  [["clone", "Leukaemic cells", "g-bad", "How much of the marrow is taken over by the leukaemic crowd. High means the marrow is crowded out."], ["red", "Red cells", "g-rbc", "Red cells carry oxygen. When they fall the patient is anaemic: pale, tired and breathless."], ["neut", "Neutrophils", "g-neu", "Neutrophils fight bacterial infection. When they fall, infection becomes likely and can be severe."], ["plt", "Platelets", "g-clot", "Platelets help blood clot. When they fall, bruising, gum bleeding and heavier bleeding follow."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 170 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
}
const sm = { blast: 0.8, clone: 0.8, lymph: 0, myel: 0.1, red: 0.3, neut: 0.2, plt: 0.2, mature: 0.2, ph: 0, block: 0.8, blocked: 0, pulse: 0 };
const acc = { div: 0, tki: 0, sig: 0, chemo: 0, donor: 0 };
let donorSlot = 0;
function setPool(pool, n, dt, bob) { pool.forEach((c, i) => { const want = i < n ? 1 : 0; c.s = lerp(c.s, want, Math.min(1, dt * 2.2)); place(c.g, c.x + Math.sin(tm / 700 + i * 1.7) * bob, c.y + Math.cos(tm / 900 + i) * bob, Math.sin(tm / 800 + i) * 6, Math.max(0.05, c.s)); c.g.style.opacity = c.s > 0.04 ? 1 : 0; }); }
function init() { initOrgans(); initLabels(); initPanel(); }
let curT = -1;
function step(dt, m) {
  if (m.t !== curT) { curT = m.t; blasts.forEach((b) => b.g.setAttribute("class", m.t === 2 ? "cl cl-lyblast" : "cl cl-blast")); }
  const k = Math.min(1, dt * 1.6);
  sm.blast = lerp(sm.blast, m.blast, k); sm.clone = lerp(sm.clone, m.clone, k); sm.lymph = lerp(sm.lymph, m.lymph, k); sm.myel = lerp(sm.myel, m.myel, k);
  sm.red = lerp(sm.red, m.red, k); sm.neut = lerp(sm.neut, m.neut, k); sm.plt = lerp(sm.plt, m.plt, k); sm.mature = lerp(sm.mature, m.mature, k);
  sm.ph = lerp(sm.ph, (m.t === 3 || m.t === 4) ? 1 : 0, k); sm.block = lerp(sm.block, clamp(m.blast + m.lymph * 0.5), k);
  sm.blocked = lerp(sm.blocked, (m.drug === 2 && (m.t === 3 || m.t === 4)) ? 1 : 0, Math.min(1, dt * 2));
  sm.pulse = lerp(sm.pulse, m.drug === 3 ? 1 : 0, Math.min(1, dt * 2));
  /* marrow health washes: crowded red when the clone rules, healing green as healthy cells return */
  layers.health.setAttribute("opacity", (sm.mature * 0.35).toFixed(2));
  layers.crowd.setAttribute("opacity", (sm.clone * 0.38).toFixed(2));
  stems.forEach((s, i) => place(s.g, s.x, s.y + Math.sin(tm / 800 + i * 2) * 2, 0, 1 + 0.12 * sm.pulse + 0.03 * Math.sin(tm / 300 + i)));
  progs.forEach((s, i) => place(s.g, s.x, s.y + Math.sin(tm / 700 + i) * 2, Math.sin(tm / 900 + i) * 8, 1 - 0.35 * sm.block));
  setPool(blasts, Math.round(sm.blast * 28), dt, 2);
  setPool(lymphs, Math.round(sm.lymph * 28), dt, 1.4);
  setPool(myels, Math.round(clamp((sm.myel - 0.15) / 0.7) * 18), dt, 1.6);
  setPool(mats, Math.round(sm.mature * 4), dt, 1.4);
  blockG.setAttribute("opacity", sm.block.toFixed(2));
  phG.setAttribute("opacity", sm.ph.toFixed(2));
  const phb = $("phbox"); if (phb) phb.setAttribute("opacity", (sm.ph * 0.9).toFixed(2));
  if (phPill) { phPill.style.opacity = sm.ph.toFixed(2); phPill.style.display = sm.ph > 0.05 ? "" : "none"; }
  /* docked blockers sit on the kinase receptors while the blocker is chosen */
  receptors.forEach((r) => { r.dot.setAttribute("opacity", sm.blocked.toFixed(2)); });
  /* blood in the vessel organ: cells flow down inside the real vessel walls */
  vesselRbcs.forEach((r, i) => { r.y += r.v * 26 * (0.3 + sm.red) * dt; if (r.y > 398) { r.y = 202; r.x = 786 + Math.floor(rnd(0, 3)) * 16; } place(r.g, r.x, r.y, Math.sin(tm / 500 + i) * 14, 1); r.g.style.opacity = i < Math.round(sm.red * 10) ? 1 : 0; });
  vesselPlts.forEach((r, i) => { r.y += r.v * 20 * dt; if (r.y > 398) r.y = 204; place(r.g, r.x, r.y, 0, 1); r.g.style.opacity = i < Math.round(sm.plt * 6) ? 1 : 0; });
  vesselNeus.forEach((r, i) => { r.y += r.v * 18 * dt; if (r.y > 398) r.y = 206; place(r.g, r.x, r.y, 0, 1); r.g.style.opacity = i < Math.round(sm.neut * 4) ? 1 : 0; });
  /* dividing leukaemic cells shed small daughter dots */
  acc.div += dt * sm.clone * 5; while (acc.div >= 1) { acc.div--; const p = freeP(divs); if (p) emit(p, rnd(310, 500), rnd(130, 340), rnd(-14, 14), rnd(-14, 14), 0); }
  divs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  /* chemotherapy capsules drift to the blast crowd and are spent there */
  acc.chemo += dt * (m.drug === 1 ? 2.2 : 0); while (acc.chemo >= 1) { acc.chemo--; const p = freeP(chemos); if (p) emit(p, rnd(200, 300), rnd(140, 260), 0, 0, 0); }
  chemos.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (CROWD[0] - p.x) * dt * 0.6 + 14 * dt; p.y += (CROWD[1] - p.y) * dt * 0.6; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.5) / 1.2).toFixed(2)); if (p.t > 4.7) kill(p); });
  /* kinase blocker dots home to the fusion gene and dock on its receptors */
  acc.tki += dt * (m.drug === 2 ? 4 : 0); while (acc.tki >= 1) { acc.tki--; const p = freeP(tkis); if (p) emit(p, rnd(480, 580), rnd(200, 300), rnd(-10, 10), rnd(-10, 10), 0); }
  tkis.forEach((p) => { if (!p.on) return; p.t += dt;
    if (sm.ph > 0.4) { p.x += (FUS[0] + 14 - p.x) * dt * 1.4; p.y += (FUS[1] - p.y) * dt * 1.4; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(FUS[0] + 14 - p.x, FUS[1] - p.y) < 12 || p.t > 3) kill(p); }
    else { p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2).toFixed(2)); if (p.t > 2) kill(p); } });
  /* kinase growth signal streams from the fusion gene to the crowd until blocked */
  acc.sig += dt * sm.ph * (1 - sm.blocked) * 8; while (acc.sig >= 1) { acc.sig--; const p = freeP(sigs); if (p) emit(p, FUS[0] + 8, FUS[1] + rnd(-20, 20), 0, 0, 0); }
  sigs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (CROWD[0] + 60 - p.x) * dt * 1.1; p.y += (CROWD[1] - p.y) * dt * 1.1; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 1.8) / 0.8).toFixed(2)); if (p.t > 2.6) kill(p); });
  /* donor stem cells stream in from the left and settle on the stem slots */
  acc.donor += dt * (m.drug === 3 ? 3 : 0); while (acc.donor >= 1) { acc.donor--; const p = freeP(donors); if (p) { const s = stems[donorSlot % stems.length]; donorSlot++; emit(p, 22, rnd(150, 350), 0, 0, 0); p.tx = s.x; p.ty = s.y; } }
  donors.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (p.tx - p.x) * dt * 1.2; p.y += (p.ty - p.y) * dt * 1.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(p.tx - p.x, p.ty - p.y) < 10 || p.t > 4) kill(p); });
  /* treatment pill follows the chosen treatment */
  if (drug !== treatDrug || m.t !== treatType) {
    treatDrug = drug; treatType = m.t;
    const tw = treatWords(drug, m.t);
    treatG.style.display = drug === 0 ? "none" : "";
    if (drug !== 0) {
      pillText(treatG, tw[0]); treatG.setAttribute("data-info", tw[1]);
      treatDot.setAttribute("cx", f1(tw[2])); treatDot.setAttribute("cy", f1(tw[3]));
      treatLeader.setAttribute("d", "M" + f1(tw[2]) + " " + f1(tw[3]) + "L250 400");
    }
  }
  gg.clone.set(sm.clone, wordOf(sm.clone, 0.25, 0.6, ["low", "moderate", "high"])); gg.red.set(sm.red, wordOf(sm.red, 0.35, 0.65, ["low", "reduced", "normal"]));
  gg.neut.set(sm.neut, wordOf(sm.neut, 0.35, 0.65, ["low", "reduced", "normal"])); gg.plt.set(sm.plt, wordOf(sm.plt, 0.35, 0.65, ["low", "reduced", "normal"]));
  if (drug !== capDrug || m.t !== capType) { capDrug = drug; capType = m.t; const t = capText(drug, m.t); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
