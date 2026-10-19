/* Toxic shock and necrotising fasciitis scene: germs in a real skin wound spread along
 * the fascia, toxin bridges immune cells, and the signal flood shocks a real vessel.
 * Each treatment visibly acts: antibiotics shrink germs and halt toxin, surgery cuts out
 * dead tissue, IVIG blockers sit on the toxin bridge and the downstream signal fades. */
const layers = { skin: $("skinSlot"), muscle: $("muscleSlot"), bac: $("bacteria"), bridge: $("bridge"), slot: $("vesselSlot"), rash: $("rash"), parts: $("parts"), over: $("over"), panel: $("panel"), nec: $("necrosis"), exc: $("excision"), detail: $("tissue-detail") };
/* ---- recognisable organs; vessels and particles anchor to their ports ---- */
let skinO = null, muscleO = null, vesselO = null;
let woundPt = [230, 178], lumenPt = [825, 190];
let apc = null, tcell = null, supAg = null, shockGlow = null;
const sparks = [], blotches = [], bubbles0 = [], vrbc = [], blockers = [];
function initOrgans() {
  skinO = organ(layers.skin, "skin", 230, 150, 340, { h: 190 });
  muscleO = organ(layers.muscle, "muscle", 230, 305, 340, { h: 80 });
  vesselO = organ(layers.slot, "vessel", 825, 190, 96, { h: 200 });
  const SP = skinO.ports, VP = vesselO.ports;
  woundPt = SP.dermis || [skinO.x, skinO.y + 28];
  lumenPt = VP.lumen || [vesselO.x, vesselO.y];
  shockGlow = mk("ellipse", { class: "tss-shock", cx: f1(vesselO.x), cy: f1(vesselO.y), rx: 72, ry: 108, opacity: "0" }, layers.slot);
  layers.slot.insertBefore(shockGlow, vesselO.g);
}
function initStatic() {
  for (let i = 0; i < 9; i++) bubbles0.push(mk("circle", { class: "tss-bubble", cx: 92 + i * 38, cy: 182, r: 12 }, layers.detail));
  for (let i = 0; i < 7; i++) mk("path", { class: "fibrin", d: "M70 " + (252 + i * 8) + "L390 " + (248 + i * 8) }, layers.detail);
  [[165, 242], [225, 250], [285, 242]].forEach(([x, y]) => { const p = mk("path", { class: "tss-spark", d: "M" + x + " " + y + "l7 -10l-3 9l8 -6" }, layers.detail); sparks.push(p); });
  apc = cell(layers.bridge, { cls: "mac", r: 36, nuc: 0.42, seed: 3, wob: 0.12 });
  tcell = cell(layers.bridge, { cls: "lymph", r: 32, nuc: 0.48, seed: 7, wob: 0.1 });
  mk("rect", { class: "tss-mhc", x: 560, y: 146, width: 22, height: 9, rx: 3, transform: "rotate(38 571 150)" }, layers.bridge);
  mk("rect", { class: "tss-tcr", x: 602, y: 146, width: 22, height: 9, rx: 3, transform: "rotate(-38 613 150)" }, layers.bridge);
  supAg = mk("path", { class: "tss-sup", d: "M592 146L596 156L606 156L598 162L601 172L592 166L583 172L586 162L578 156L588 156Z" }, layers.bridge);
  /* IVIG blockers parked on the bridge: appear only when IVIG is on */
  [[572, 150], [592, 142], [611, 152]].forEach(([x, y]) => {
    const b = mk("path", { class: "tss-block", d: "M" + x + " " + (y + 8) + "L" + x + " " + y + "L" + (x - 6) + " " + (y - 7) + "M" + x + " " + y + "L" + (x + 6) + " " + (y - 7), opacity: "0" }, layers.bridge);
    blockers.push(b);
  });
  for (let i = 0; i < 6; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.slot); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); vrbc.push({ g, ph: i * 1.1, span: 14 + (i % 3) * 6 }); }
  for (let i = 0; i < 9; i++) { const c = mk("circle", { class: "tss-blotch", cx: 748 + (i % 5) * 38 + (i > 4 ? 18 : 0), cy: 252 + (i % 2) * 22, r: 6 + (i % 3) * 2 }, layers.rash); blotches.push(c); }
}
/* ---- bacteria ---- */
const BAC_N = 36, bac = [];
function initBacteria() { for (let i = 0; i < BAC_N; i++) { const rod = i % 3 === 0, g = mk("g", { class: "cl cl-bac" }, layers.bac);
  mk(rod ? "ellipse" : "circle", rod ? { class: "cl-b", rx: 6.5, ry: 3.4 } : { class: "cl-b", r: 4 }, g); mk("circle", { class: "cl-h", r: 1.4, cx: -1.4, cy: -1.2 }, g);
  bac.push({ g, x: rnd(90, 370), y: rnd(140, 212), a: rnd(0, 6.28), s: 0, rot: rnd(0, 180) }); } }
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
/* ---- labels, caption and gauges ---- */
const gg = {};
let capEl = null, capDrug = -1, capLevel = -1;
function capText(d, l) {
  const sev = ["Early wound infection. ", "Toxic shock. ", "Fascia dying fast. "][l];
  if (d === 1) return sev + "Antibiotics stop toxin making. Germs fade and signals calm.";
  if (d === 2) return sev + "Surgery removes dead tissue. The source is gone.";
  if (d === 3) return sev + "IVIG traps toxin. The bridge stays blocked.";
  if (d === 4) return sev + "All three together. Toxin blocked, source gone, shock lifts.";
  return sev + "No treatment. Toxin fires T cells and shock builds.";
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["bac", "Infection", "g-bac", "Germs in the wound and along the fascia. Antibiotics and removing dead tissue bring this down."], ["tox", "Toxin", "g-clot", "Toxin released by some wound germs. It links immune cells from the outside so very many switch on."], ["cyt", "Signals", "g-cyt", "Signal flood from mass T cell switching. It drives fever, rash and shock."], ["fasc", "Fascia", "g-fl", "How far infection and tissue death have spread along the sheet between surface and muscle."], ["pain", "Pain", "g-eos", "Pain far worse than the wound looks warns that deeper spread is racing on."], ["shock", "Shock", "g-bad", "Falling pressure and poor flow from the signal flood and loosened vessels."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Germs", 230, 178, 110, 352, "Germs growing in the wound and along the fascia. Some release toxin.");
  pill(ox, "Skin wound", 140, 95, 150, 100, "Skin wound where germs entered. The surface can look mild while deeper spread races on.");
  pill(ox, "Fascia", 300, 224, 250, 352, "Fascia, the sheet between surface and muscle. Infection races along it ahead of skin change.");
  pill(ox, "Toxin bridge", 592, 158, 592, 100, "Toxin links two immune cells from the outside, so very many T cells switch on at once.");
  pill(ox, "T cells", 648, 190, 640, 352, "T cells switched on all at once. Their signal flood drives rash and shock.");
  pill(ox, "Vessel", 825, 190, 830, 100, "Vessel walls loosen and pressure falls, so organs get too little blood. That is shock.");
  pill(ox, "Rash", 820, 264, 800, 352, "Widespread rash from toxin and signal flood in toxic shock.");
  capEl = mk("text", { class: "tss-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0, 0);
}
const sm = { B: 0.4, T: 0.1, C: 0.1, F: 0.1, Pain: 0.3, Shock: 0.1, Rash: 0.1, abx: 0, surg: 0, ivig: 0 };
const acc = { tox: 0, cyt: 0, cap: 0, ivig: 0, bub: 0 };
function init() { initOrgans(); initStatic(); initBacteria(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.B = lerp(sm.B, m.B, k2); sm.T = lerp(sm.T, m.T, k2); sm.C = lerp(sm.C, m.C, k2); sm.F = lerp(sm.F, m.F, k2); sm.Pain = lerp(sm.Pain, m.Pain, k2); sm.Shock = lerp(sm.Shock, m.Shock, k1); sm.Rash = lerp(sm.Rash, m.Rash, k2); sm.abx = lerp(sm.abx, m.abx, k1); sm.surg = lerp(sm.surg, m.surg, k1); sm.ivig = lerp(sm.ivig, m.ivig, k1);
  /* tissue state: dead zone shrinks away as surgery and antibiotics act */
  layers.nec.setAttribute("transform", "translate(60 0) scale(" + ((20 + sm.F * 320) / 340).toFixed(3) + " 1) translate(-60 0)"); layers.nec.setAttribute("opacity", (0.15 + 0.55 * sm.F).toFixed(2));
  layers.exc.setAttribute("opacity", sm.surg.toFixed(2));
  sparks.forEach((s) => s.setAttribute("opacity", sm.Pain.toFixed(2)));
  bubbles0.forEach((b) => b.setAttribute("opacity", (0.12 + 0.63 * sm.F).toFixed(2)));
  blotches.forEach((b, i) => b.setAttribute("opacity", clamp(sm.Rash * (0.5 + 0.5 * Math.sin(tm / 500 + i))).toFixed(2)));
  shockGlow.setAttribute("opacity", (sm.Shock * 0.4).toFixed(2));
  /* bridge cells and toxin: T cell swells with the signal flood, blockers park on the toxin */
  place(apc, 540 + Math.sin(tm / 1500) * 3, 188 + Math.cos(tm / 1700) * 2, Math.sin(tm / 2400) * 5, 1);
  place(tcell, 648 + Math.cos(tm / 1400) * 3, 188 + Math.sin(tm / 1600) * 2, Math.cos(tm / 2300) * 5, 1 + 0.3 * sm.C);
  supAg.setAttribute("transform", "translate(" + f1(592 + Math.sin(tm / 900) * 2) + " " + f1(158 + Math.cos(tm / 800) * 2) + ") scale(" + (0.3 + 1.1 * sm.T * (1 - 0.45 * sm.ivig)).toFixed(2) + ") translate(-592 -158)");
  supAg.setAttribute("opacity", ((0.15 + 0.85 * sm.T) * (1 - 0.5 * sm.ivig)).toFixed(2));
  blockers.forEach((b, i) => { b.setAttribute("opacity", sm.ivig.toFixed(2)); b.setAttribute("transform", "translate(0 " + f1(Math.sin(tm / 700 + i * 2) * 1.5) + ")"); });
  /* germs wander in the wound, then shrink away under antibiotics */
  const want = Math.round(sm.B * BAC_N);
  bac.forEach((b, i) => { const on = i < want; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.4 : 2.6 + sm.abx * 3)));
    b.a += rnd(-1.3, 1.3) * dt; b.x += Math.cos(b.a) * 7 * dt; b.y += Math.sin(b.a) * 5 * dt; if (b.x < 90 || b.x > 370) b.a = Math.PI - b.a; if (b.y < 140 || b.y > 212) b.a = -b.a; b.x = clamp(b.x, 90, 370); b.y = clamp(b.y, 140, 212);
    const shrunken = b.s * (1 - 0.65 * sm.abx);
    place(b.g, b.x, b.y, b.rot + Math.sin(tm / 600 + i) * 16, Math.max(0.05, shrunken)); b.g.style.opacity = b.s > 0.04 ? 1 : 0; });
  /* toxin stars travel from the wound to the bridge */
  acc.tox += dt * sm.T * 7 + dt * sm.B * 1.2; while (acc.tox >= 1) { acc.tox--; const p = free(tox); if (p) emit(p, rnd(100, 360), rnd(145, 210), 0, 0, 0); }
  tox.forEach((p) => { if (!p.on) return; p.t += dt; const dx = 592 - p.x, dy = 160 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 55 * dt; p.y += (dy / d) * 55 * dt; p.x = clamp(p.x, 30, 930); p.y = clamp(p.y, 60, 430); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (d < 16 || p.t > 9) kill(p); });
  /* signal flood from the T cell toward the vessel lumen */
  acc.cyt += dt * sm.C * 16; while (acc.cyt >= 1) { acc.cyt--; const p = free(cyt); if (p) emit(p, 668, rnd(168, 208), rnd(38, 62), rnd(-8, 8), 0); }
  cyt.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(tm / 350 + p.x) * 0.25; p.x = clamp(p.x, 30, 930); p.y = clamp(p.y, 60, 430); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > lumenPt[0] - 30 || p.t > 5) kill(p); });
  /* red cells stream down the real vessel, slowing and thinning as shock deepens */
  vrbc.forEach((r, i) => { const flow = 1.15 - 0.85 * sm.Shock; r.ph += dt * flow * 1.6; const y = 108 + ((r.span * 47 + r.ph * 60) % 168); place(r.g, vesselO.x + Math.sin(r.ph * 2.2) * 13, y, Math.sin(tm / 500 + i) * 14, 1); r.g.style.opacity = (i / 6 < 1 - 0.55 * sm.Shock) ? 1 : 0; });
  /* gas bubbles rise in the wound when fascia is involved */
  acc.bub += dt * sm.F * 8; while (acc.bub >= 1) { acc.bub--; const p = free(bub); if (p) emit(p, rnd(100, 360), 212, rnd(-3, 3), -rnd(12, 20), 0); }
  bub.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 130 || p.t > 4) kill(p); });
  /* antibiotic capsules drift into the wound */
  acc.cap += dt * sm.abx * 3.2; while (acc.cap >= 1) { acc.cap--; const p = free(caps); if (p) emit(p, rnd(60, 140), 100, 0, 0, 0); }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (woundPt[0] - p.x) * dt * 0.45 + 12 * dt; p.y += (woundPt[1] - p.y) * dt * 0.6; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  /* IVIG shapes travel to the bridge and bind toxin */
  acc.ivig += dt * sm.ivig * 5; while (acc.ivig >= 1) { acc.ivig--; const p = free(ivigP); if (p) emit(p, rnd(720, 820), 96, 0, 0, 0); }
  ivigP.forEach((p) => { if (!p.on) return; p.t += dt; const dx = 592 - p.x, dy = 160 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 62 * dt; p.y += (dy / d) * 62 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.sin(tm / 300) * 18) + ")"); if (d < 16 || p.t > 7) kill(p); });
  /* gauges */
  gg.bac.set(sm.B, wordOf(sm.B, 0.2, 0.55, ["low", "present", "high"])); gg.tox.set(sm.T, wordOf(sm.T, 0.25, 0.55, ["low", "present", "high"])); gg.cyt.set(sm.C, wordOf(sm.C, 0.3, 0.62, ["low", "raised", "very high"]));
  gg.fasc.set(sm.F, wordOf(sm.F, 0.15, 0.5, ["intact", "threatened", "spreading"])); gg.pain.set(sm.Pain, wordOf(sm.Pain, 0.3, 0.62, ["mild", "severe", "very severe"])); gg.shock.set(sm.Shock, wordOf(sm.Shock, 0.3, 0.62, ["none", "early", "severe"]));
  if (drug !== capDrug || level !== capLevel) { capDrug = drug; capLevel = level; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
