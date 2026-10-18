/* Toxic shock and necrotising fasciitis scene: bacteria along fascia, superantigen bridge, cytokine flood, rash, shock and gauges. */
const layers = { bac: $("bacteria"), bridge: $("bridge"), vessel: $("vessel"), rash: $("rash"), parts: $("parts"), over: $("over"), panel: $("panel"), nec: $("necrosis"), exc: $("excision"), detail: $("tissue-detail") };
/* ---- tissue detail, bridge parts, vessel and rash (static shapes, animated in step) ---- */
let apc = null, tcell = null, supAg = null;
const sparks = [], blotches = [], vrbc = [];
function initStatic() {
  for (let i = 0; i < 9; i++) mk("circle", { class: "tss-bubble", cx: 62 + i * 44, cy: 182, r: 13 }, layers.detail);
  for (let i = 0; i < 7; i++) mk("path", { class: "fibrin", d: "M40 " + (244 + i * 7) + "L420 " + (240 + i * 7) }, layers.detail);
  [[165, 242], [225, 250], [285, 242]].forEach(([x, y]) => { const p = mk("path", { class: "tss-spark", d: "M" + x + " " + y + "l7 -10l-3 9l8 -6" }, layers.detail); sparks.push(p); });
  apc = cell(layers.bridge, { cls: "mac", r: 36, nuc: 0.42, seed: 3, wob: 0.12 });
  tcell = cell(layers.bridge, { cls: "lymph", r: 32, nuc: 0.48, seed: 7, wob: 0.1 });
  mk("rect", { class: "tss-mhc", x: 560, y: 146, width: 22, height: 9, rx: 3, transform: "rotate(38 571 150)" }, layers.bridge);
  mk("rect", { class: "tss-tcr", x: 602, y: 146, width: 22, height: 9, rx: 3, transform: "rotate(-38 613 150)" }, layers.bridge);
  supAg = mk("path", { class: "tss-sup", d: "M592 146L596 156L606 156L598 162L601 172L592 166L583 172L586 162L578 156L588 156Z" }, layers.bridge);
  mk("circle", { class: "tss-vesselring", cx: 825, cy: 175, r: 48 }, layers.vessel);
  for (let i = 0; i < 6; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.vessel); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); vrbc.push({ g, ph: i * 1.1, y: 158 + (i % 3) * 17 }); }
  for (let i = 0; i < 9; i++) { const c = mk("circle", { class: "tss-blotch", cx: 748 + (i % 5) * 38 + (i > 4 ? 18 : 0), cy: 252 + (i % 2) * 22, r: 6 + (i % 3) * 2 }, layers.rash); blotches.push(c); }
}
/* ---- bacteria ---- */
const BAC_N = 36, bac = [];
function initBacteria() { for (let i = 0; i < BAC_N; i++) { const rod = i % 3 === 0, g = mk("g", { class: "cl cl-bac" }, layers.bac);
  mk(rod ? "ellipse" : "circle", rod ? { class: "cl-b", rx: 6.5, ry: 3.4 } : { class: "cl-b", r: 4 }, g); mk("circle", { class: "cl-h", r: 1.4, cx: -1.4, cy: -1.2 }, g);
  bac.push({ g, x: rnd(50, 410), y: rnd(158, 214), a: rnd(0, 6.28), s: 0, rot: rnd(0, 180) }); } }
/* ---- particle pools (items expose their element as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const tox = pool(26, () => mk("path", { class: "p-tox", d: "M0 -5L1.5 -1.5L5 0L1.5 1.5L0 5L-1.5 1.5L-5 0L-1.5 -1.5Z" }, layers.parts));
const cyt = pool(38, () => mk("circle", { class: "sc-p p-cyt", r: 2.5 }, layers.parts));
const ivigP = pool(14, () => mk("path", { class: "p-ivig", d: "M0 4L0 -1M0 -1L-4 -5M0 -1L4 -5" }, layers.parts));
const caps = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const bub = pool(16, () => mk("circle", { class: "tss-bubble", r: 3.2 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["bac", "Infection", "g-bac", "Bacteria in skin, fat and fascia. Antibiotics and removing dead tissue bring this down."], ["tox", "Superantigen", "g-clot", "Toxin released by some staphylococci and streptococci. It bridges presenting cells and T cells."], ["cyt", "Cytokines", "g-cyt", "Signals released when many T cells switch on at once. A large burst drives fever, rash and shock."], ["fasc", "Fascia", "g-fl", "How far infection and tissue death have spread along the fascial plane."], ["pain", "Pain", "g-eos", "Pain out of proportion to what is visible is a taught warning clue for necrotising infection."], ["shock", "Shock", "g-bad", "Falling blood pressure and poor tissue perfusion from the cytokine flood and leaking vessels."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Bacteria", 120, 178, 90, 330, "Bacteria multiplying in skin, fat and along the fascia. Some strains release superantigen toxin.");
  pill(ox, "Fascia", 300, 224, 210, 330, "Fascia: the sheet between fat and muscle. Infection can travel fast along this plane, ahead of what the skin shows.");
  pill(ox, "Severe pain", 200, 238, 330, 330, "Severe pain out of proportion to the visible change is a taught warning clue. Sparks mark where pain signals arise.");
  pill(ox, "Superantigen", 592, 158, 592, 102, "Superantigen toxin. It binds MHC and the T cell receptor from the outside, without antigen processing, so many T cells switch on at once.");
  pill(ox, "Presenting cell", 532, 214, 520, 330, "Antigen presenting cell with MHC class II on its surface. Normally it shows a processed peptide to one matching T cell.");
  pill(ox, "T cell", 648, 214, 640, 330, "T cell with its receptor. Superantigen cross-links it to MHC regardless of its normal antigen, so huge numbers activate together.");
  pill(ox, "Cytokines", 716, 182, 810, 102, "Cytokine flood from mass T cell activation. It drives fever, widespread rash, leaky vessels and falling blood pressure.");
  pill(ox, "Rash", 790, 262, 760, 330, "Widespread rash from the toxin and cytokine effects on skin and small vessels in toxic shock.");
  pill(ox, "Vessel", 825, 220, 840, 330, "Blood vessel. Cytokines relax and leak vessel walls, blood pressure falls, and tissues are poorly perfused: shock.");
  const c1 = pill(ox, "Clindamycin", 120, 300, 110, 380, "Antibiotics kill bacteria. Clindamycin is taught as also switching off new toxin production."); c1.setAttribute("id", "clin-pill");
  const c2 = pill(ox, "Surgery", 300, 300, 250, 380, "Source control: urgent surgery to remove infected and dead tissue that antibiotics cannot reach well."); c2.setAttribute("id", "surg-pill");
  const c3 = pill(ox, "IVIG", 592, 250, 360, 380, "IVIG concept: pooled antibodies that may bind and neutralise circulating toxin. It does not kill bacteria or remove dead tissue."); c3.setAttribute("id", "ivig-pill");
}
const sm = { B: 0.4, T: 0.1, C: 0.1, F: 0.1, Pain: 0.3, Shock: 0.1, Rash: 0.1, abx: 0, surg: 0, ivig: 0 };
const acc = { tox: 0, cyt: 0, cap: 0, ivig: 0, bub: 0 };
function init() { initStatic(); initBacteria(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.B = lerp(sm.B, m.B, k2); sm.T = lerp(sm.T, m.T, k2); sm.C = lerp(sm.C, m.C, k2); sm.F = lerp(sm.F, m.F, k2); sm.Pain = lerp(sm.Pain, m.Pain, k2); sm.Shock = lerp(sm.Shock, m.Shock, k1); sm.Rash = lerp(sm.Rash, m.Rash, k2); sm.abx = lerp(sm.abx, m.abx, k1); sm.surg = lerp(sm.surg, m.surg, k1); sm.ivig = lerp(sm.ivig, m.ivig, k1);
  /* tissue state */
  layers.nec.setAttribute("transform", "translate(30 0) scale(" + ((20 + sm.F * 360) / 380).toFixed(3) + " 1) translate(-30 0)"); layers.nec.setAttribute("opacity", (0.18 + 0.5 * sm.F).toFixed(2));
  layers.exc.setAttribute("opacity", sm.surg.toFixed(2));
  sparks.forEach((s) => s.setAttribute("opacity", sm.Pain.toFixed(2)));
  blotches.forEach((b, i) => b.setAttribute("opacity", clamp(sm.Rash * (0.5 + 0.5 * Math.sin(tm / 500 + i))).toFixed(2)));
  /* bridge cells and superantigen */
  place(apc, 540 + Math.sin(tm / 1500) * 3, 188 + Math.cos(tm / 1700) * 2, Math.sin(tm / 2400) * 5, 1);
  place(tcell, 648 + Math.cos(tm / 1400) * 3, 188 + Math.sin(tm / 1600) * 2, Math.cos(tm / 2300) * 5, 1 + 0.08 * sm.C * Math.sin(tm / 280));
  supAg.setAttribute("transform", "translate(" + f1(592 + Math.sin(tm / 900) * 2) + " " + f1(158 + Math.cos(tm / 800) * 2) + ") scale(" + (0.7 + 0.9 * sm.T).toFixed(2) + ") translate(-592 -158)");
  supAg.setAttribute("opacity", (0.25 + 0.75 * sm.T).toFixed(2));
  /* bacteria wander in fat and fascia */
  const want = Math.round(sm.B * BAC_N);
  bac.forEach((b, i) => { const on = i < want; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.4 : 2.6 + sm.abx * 3)));
    b.a += rnd(-1.3, 1.3) * dt; b.x += Math.cos(b.a) * 7 * dt; b.y += Math.sin(b.a) * 5 * dt; if (b.x < 50 || b.x > 410) b.a = Math.PI - b.a; if (b.y < 158 || b.y > 214) b.a = -b.a; b.x = clamp(b.x, 50, 410); b.y = clamp(b.y, 158, 214);
    place(b.g, b.x, b.y, b.rot + Math.sin(tm / 600 + i) * 16, b.s); b.g.style.opacity = b.s > 0.04 ? 1 : 0; });
  /* superantigen stars travel from tissue to the bridge */
  acc.tox += dt * sm.T * 7 + dt * sm.B * 1.2; while (acc.tox >= 1) { acc.tox--; const p = free(tox); if (p) emit(p, rnd(70, 380), rnd(165, 210), 0, 0, 0); }
  tox.forEach((p) => { if (!p.on) return; p.t += dt; const dx = 592 - p.x, dy = 160 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 55 * dt; p.y += (dy / d) * 55 * dt; p.x = clamp(p.x, 30, 930); p.y = clamp(p.y, 60, 430); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (d < 14 || p.t > 9) kill(p); });
  /* cytokines flood from the T cell toward the vessel */
  acc.cyt += dt * sm.C * 16; while (acc.cyt >= 1) { acc.cyt--; const p = free(cyt); if (p) emit(p, 668, rnd(168, 208), rnd(38, 62), rnd(-8, 8), 0); }
  cyt.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(tm / 350 + p.x) * 0.25; p.x = clamp(p.x, 30, 930); p.y = clamp(p.y, 60, 430); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 792 || p.t > 5) kill(p); });
  /* red cells in the vessel slow as shock deepens */
  vrbc.forEach((r, i) => { const x = 825 + Math.sin(tm / (900 - 350 * sm.Shock) + r.ph) * (26 - 8 * sm.Shock); place(r.g, x, r.y + Math.cos(tm / 700 + i) * 2, Math.sin(tm / 500 + i) * 14, 1); });
  /* gas bubbles (crepitus) rise in the fat when fascia is involved */
  acc.bub += dt * sm.F * 8; while (acc.bub >= 1) { acc.bub--; const p = free(bub); if (p) emit(p, rnd(60, 400), 212, rnd(-3, 3), -rnd(12, 20), 0); }
  bub.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 156 || p.t > 4) kill(p); });
  /* antibiotic capsules drift into the tissue */
  acc.cap += dt * sm.abx * 3; while (acc.cap >= 1) { acc.cap--; const p = free(caps); if (p) emit(p, rnd(50, 140), 100, 0, 0, 0); }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (210 - p.x) * dt * 0.45 + 12 * dt; p.y += (182 - p.y) * dt * 0.6; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  /* IVIG Y shapes travel to the bridge and bind toxin */
  acc.ivig += dt * sm.ivig * 5; while (acc.ivig >= 1) { acc.ivig--; const p = free(ivigP); if (p) emit(p, rnd(720, 820), 96, 0, 0, 0); }
  ivigP.forEach((p) => { if (!p.on) return; p.t += dt; const dx = 592 - p.x, dy = 160 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 62 * dt; p.y += (dy / d) * 62 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.sin(tm / 300) * 18) + ")"); if (d < 14 || p.t > 7) kill(p); });
  /* treatment pills fade with their treatment */
  $("clin-pill").style.opacity = sm.abx.toFixed(2); $("surg-pill").style.opacity = sm.surg.toFixed(2); $("ivig-pill").style.opacity = sm.ivig.toFixed(2);
  /* gauges */
  gg.bac.set(sm.B, wordOf(sm.B, 0.2, 0.55, ["low", "present", "high"])); gg.tox.set(sm.T, wordOf(sm.T, 0.25, 0.55, ["low", "present", "high"])); gg.cyt.set(sm.C, wordOf(sm.C, 0.3, 0.62, ["low", "raised", "very high"]));
  gg.fasc.set(sm.F, wordOf(sm.F, 0.15, 0.5, ["intact", "threatened", "spreading"])); gg.pain.set(sm.Pain, wordOf(sm.Pain, 0.3, 0.62, ["mild", "severe", "very severe"])); gg.shock.set(sm.Shock, wordOf(sm.Shock, 0.3, 0.62, ["none", "early", "severe"]));
}
run({ init, step });
