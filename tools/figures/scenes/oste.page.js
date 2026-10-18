/* Osteomyelitis scene: blood seeding, metaphysis bacteria, pus, sequestrum, involucrum, sinus and gauges. */
const layers = { vessel: $("vessel"), bac: $("bac"), cells: $("cells"), parts: $("parts"), treat: $("treat"), over: $("over"), panel: $("panel"), pusEl: $("pusEl"), seqG: $("seqG"), sinusPath: $("sinusPath"), sinusMouth: $("sinusMouth"), periL: $("periL"), periR: $("periR"), invL: $("invL"), invR: $("invR") };
const gg = {};
let splintG, abxPillEl, surgPillEl, immPillEl, combPillEl;
const bac = [];
function initBacteria() {
  for (let i = 0; i < 24; i++) {
    const g = mk("g", { class: "cl cl-staph" }, layers.bac);
    mk("circle", { class: "cl-b", r: 4.2 }, g);
    mk("circle", { class: "cl-b", r: 3.2, cx: 5, cy: 3 }, g);
    mk("circle", { class: "cl-b", r: 2.8, cx: -5, cy: 4 }, g);
    mk("circle", { class: "cl-h", r: 1.2, cx: -1.2, cy: -1.4 }, g);
    bac.push({ g, x: rnd(428, 532), y: rnd(178, 332), ph: rnd(0, 6.28), s: 0 });
  }
}
const rbcs = [];
function initRbcs() {
  for (let i = 0; i < 10; i++) {
    const g = mk("g", { class: "cl cl-rbc" }, layers.vessel);
    mk("ellipse", { class: "cl-b", rx: 8, ry: 4.6 }, g);
    mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g);
    rbcs.push({ g, x: rnd(36, 326), y: rnd(84, 96), v: rnd(0.8, 1.25) });
  }
}
const neus = [];
function initCells() {
  for (let i = 0; i < 5; i++) neus.push({ g: cell(layers.cells, { cls: "neut", r: 10, nuc: 0.55, nucCls: "multi", seed: i + 11, wob: 0.14 }), x: rnd(420, 530), y: rnd(190, 320), ph: rnd(0, 6.28) });
  for (let i = 0; i < 8; i++) {
    const left = i % 2 === 0;
    const g = cell(layers.cells, { cls: "ost", r: 6.5, nuc: 0.4, seed: i + 31, wob: 0.12 });
    layers.cells.appendChild(g);
    blasts.push({ g, x: left ? 362 : 598, y: 248 + Math.floor(i / 2) * 48, ph: rnd(0, 6.28) });
  }
}
const blasts = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const pusP = pool(20, () => mk("circle", { class: "sc-p p-pus", r: 2.6 }, layers.parts));
const sinusP = pool(10, () => mk("circle", { class: "sc-p p-sinus", r: 3 }, layers.parts));
const caps = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
const sparks = pool(12, () => mk("circle", { class: "sc-p p-pus", r: 2.2 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The bone";
  [["bac", "Infection", "g-bac", "Bacteria living in the bone. Staphylococcus aureus is usual. Antibiotics and removing dead bone bring this down."], ["pus", "Pus pressure", "g-pus", "Pus trapped inside rigid bone raises pressure, causes pain and fever, and can cut off the bone blood supply."], ["seq", "Dead bone", "g-seq", "Bone killed by pressure and lost blood supply. A detached dead fragment is a sequestrum and shelters bacteria."], ["inv", "New bone", "g-inv", "New bone laid down under the lifted periosteum around the infection. This shell is the involucrum."], ["sinus", "Sinus", "g-sinus", "A chronic sinus is a track that drains pus from bone through to the skin surface."], ["heal", "Healing", "g-heal", "Overall healing of the bone once infection and dead bone are controlled and the bone is rested."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Bloodstream", 170, 90, 110, 60, "Bloodstream: bacteria from elsewhere in the body are carried in the blood and seed the bone. A heart valve infection (endocarditis) is one possible source.");
  pill(ox, "Metaphysis", 392, 168, 250, 115, "Metaphysis: the growing end of a child long bone. Its slow, looping blood vessels make it easy for carried bacteria to lodge here.");
  pill(ox, "Salmonella clue", 290, 92, 165, 150, "In sickle cell disease, Salmonella is a classic alternative organism in bone infection, alongside Staphylococcus aureus and streptococci.");
  pill(ox, "Staph aureus", 435, 205, 185, 195, "Staphylococcus aureus: the usual cause. It multiplies in the metaphysis and triggers pus formation. Other pyogenic bacteria can do the same.");
  pill(ox, "Periosteum", 392, 290, 250, 285, "Periosteum: the membrane wrapping bone. Pus lifts it away from the surface, and it reacts by laying down new bone (periosteal reaction).");
  pill(ox, "Pus under pressure", 535, 230, 715, 120, "Pus under pressure inside rigid bone. Pressure causes severe pain, fever and other acute signs, and squeezes shut the small vessels feeding bone.");
  pill(ox, "Sequestrum", 505, 270, 815, 205, "Sequestrum: a fragment of dead bone separated inside the pus cavity. It has no blood supply, so antibiotics reach it poorly and it keeps infection going.");
  pill(ox, "Involucrum", 592, 300, 815, 285, "Involucrum: a shell of new living bone formed by the lifted periosteum around dead and infected bone. It is the visible periosteal reaction.");
  pill(ox, "Sinus tract", 665, 266, 815, 365, "Sinus tract: in chronic disease pus tracks from the bone cavity through soft tissue to open on the skin and drain.");
  abxPillEl = pill(ox, "Antibiotics", 470, 320, 800, 412, "Prolonged antibiotics: a long course chosen for the likely or grown organism. Dead bone limits how well antibiotics work alone in chronic disease.");
  surgPillEl = pill(ox, "Debridement", 492, 282, 800, 412, "Surgical debridement: surgery to drain pus, wash out the cavity and remove dead bone (sequestrum) so antibiotics and healing can work.");
  immPillEl = pill(ox, "Immobilisation", 610, 320, 800, 412, "Immobilisation: resting the limb in a splint or cast protects weakened bone, eases pain and helps healing while infection is treated.");
  combPillEl = pill(ox, "Combined care", 480, 300, 800, 412, "Combined care: prolonged antibiotics with surgical debridement when dead bone or an undrained collection is present, plus immobilisation to rest the bone.");
}
function initTreat() {
  splintG = mk("g", { opacity: "0" }, layers.treat);
  mk("rect", { class: "ost-splint", x: 318, y: 208, width: 18, height: 212, rx: 8 }, splintG);
  mk("rect", { class: "ost-splint", x: 624, y: 208, width: 18, height: 212, rx: 8 }, splintG);
  mk("path", { class: "ost-strap", d: "M318 252L642 252M318 356L642 356" }, splintG);
}
function init() { initBacteria(); initRbcs(); initCells(); initTreat(); initPanel(); }
const sm = { B: 0.8, Pus: 0.7, Nec: 0.2, Inv: 0.1, Sin: 0, Infl: 0.8, Heal: 0.1, abx: 0, surg: 0, imm: 0 };
const acc = { pus: 0, sinus: 0, cap: 0, spark: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.B = lerp(sm.B, m.B, k2); sm.Pus = lerp(sm.Pus, m.Pus, k2); sm.Nec = lerp(sm.Nec, m.Nec, k2); sm.Inv = lerp(sm.Inv, m.Inv, k2);
  sm.Sin = lerp(sm.Sin, m.Sin, k2); sm.Infl = lerp(sm.Infl, m.Infl, k2); sm.Heal = lerp(sm.Heal, m.Heal, k2);
  sm.abx = lerp(sm.abx, m.abx, k); sm.surg = lerp(sm.surg, m.surg, k); sm.imm = lerp(sm.imm, m.imm, k);
  const pulse = 1 + 0.05 * sm.Pus * Math.sin(tm / 280);
  layers.pusEl.setAttribute("opacity", (0.18 + 0.72 * sm.Pus).toFixed(2));
  layers.pusEl.setAttribute("transform", "translate(480 252) scale(" + (pulse * (0.45 + 0.55 * sm.Pus)).toFixed(3) + ") translate(-480 -252)");
  const seqS = clamp(sm.Nec * (1 - 0.55 * sm.surg) + 0.04);
  layers.seqG.setAttribute("opacity", (0.12 + 0.88 * clamp(seqS * 1.4)).toFixed(2));
  layers.seqG.setAttribute("transform", "translate(480 274) scale(" + (0.35 + 0.65 * seqS).toFixed(3) + ") translate(-480 -274)");
  layers.sinusPath.setAttribute("opacity", (sm.Sin * 0.95).toFixed(2));
  layers.sinusMouth.setAttribute("opacity", (sm.Sin * 0.95).toFixed(2));
  const lift = sm.Inv * 7;
  layers.periL.setAttribute("transform", "translate(" + f1(-lift) + " 0)");
  layers.periR.setAttribute("transform", "translate(" + f1(lift) + " 0)");
  layers.periL.setAttribute("opacity", (0.35 + 0.65 * sm.Inv).toFixed(2));
  layers.periR.setAttribute("opacity", (0.35 + 0.65 * sm.Inv).toFixed(2));
  layers.invL.setAttribute("opacity", (sm.Inv * 0.95).toFixed(2));
  layers.invR.setAttribute("opacity", (sm.Inv * 0.95).toFixed(2));
  splintG.setAttribute("opacity", (sm.imm * 0.5).toFixed(2));
  const want = Math.round(sm.B * bac.length);
  bac.forEach((b, i) => {
    const on = i < want;
    b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * 1.6));
    place(b.g, b.x + Math.sin(tm / 700 + b.ph) * 4, b.y + Math.cos(tm / 820 + b.ph) * 3, Math.sin(tm / 600 + b.ph) * 20, Math.max(0.05, b.s));
    b.g.style.opacity = b.s > 0.04 ? 1 : 0;
  });
  rbcs.forEach((r) => { r.x += r.v * 52 * dt; if (r.x > 330) r.x = 34; place(r.g, r.x, r.y + Math.sin(tm / 500 + r.x) * 1.5, 0, 1); });
  neus.forEach((n, i) => {
    const on = sm.Infl > 0.18 && i < Math.round(sm.Infl * neus.length);
    place(n.g, n.x + Math.sin(tm / 620 + n.ph) * 10, n.y + Math.cos(tm / 740 + n.ph) * 8, Math.sin(tm / 500 + n.ph) * 14, on ? 1 : 0.08);
    n.g.style.opacity = on ? 1 : 0;
  });
  blasts.forEach((b) => { place(b.g, b.x + Math.sin(tm / 900 + b.ph) * 2, b.y, 0, 0.3 + 0.7 * sm.Inv); b.g.style.opacity = sm.Inv > 0.1 ? 1 : 0; });
  acc.pus += dt * sm.Pus * 7;
  while (acc.pus >= 1) { acc.pus--; const p = freeP(pusP); if (p) emit(p, rnd(440, 520), rnd(205, 305), rnd(-5, 5), rnd(-6, 6), 0); }
  pusP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + Math.sin(tm / 360 + p.y) * 0.25; p.y += p.vy * dt; p.x = clamp(p.x, 428, 532); p.y = clamp(p.y, 188, 322); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.2) kill(p); });
  acc.sinus += dt * sm.Sin * 5;
  while (acc.sinus >= 1) { acc.sinus--; const p = freeP(sinusP); if (p) emit(p, 536, 282, 0, 0, 0); }
  sinusP.forEach((p) => { if (!p.on) return; p.t += dt * 0.32; const u = p.t % 1, q = 1 - u; p.x = q * q * 536 + 2 * q * u * 620 + u * u * 700; p.y = q * q * 282 + 2 * q * u * 280 + u * u * 262; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3) kill(p); });
  acc.cap += dt * sm.abx * 2.6;
  while (acc.cap >= 1) { acc.cap--; const p = freeP(caps); if (p) emit(p, rnd(48, 110), 90, 0, 0, 0); }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (452 - p.x) * dt * 0.55 + 22 * dt; p.y += (212 - p.y) * dt * 0.6; p.x = clamp(p.x, 30, 540); p.y = clamp(p.y, 70, 330); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.6) / 1.2).toFixed(2)); if (p.t > 4.8) kill(p); });
  acc.spark += dt * sm.Inv * 4;
  while (acc.spark >= 1) { acc.spark--; const p = freeP(sparks); if (p) emit(p, Math.random() < 0.5 ? 360 : 600, rnd(245, 395), rnd(-3, 3), rnd(-5, 5), 0); }
  sparks.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 348, 612); p.y = clamp(p.y + p.vy * dt, 232, 408); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.4) kill(p); });
  abxPillEl.style.opacity = (drug === 1 ? sm.abx : 0).toFixed(2);
  surgPillEl.style.opacity = (drug === 2 ? sm.surg : 0).toFixed(2);
  immPillEl.style.opacity = (drug === 3 ? sm.imm : 0).toFixed(2);
  combPillEl.style.opacity = (drug === 4 ? Math.min(sm.abx, sm.surg, sm.imm) : 0).toFixed(2);
  gg.bac.set(sm.B, wordOf(sm.B, 0.25, 0.55, ["controlled", "present", "high"]));
  gg.pus.set(sm.Pus, wordOf(sm.Pus, 0.25, 0.55, ["low", "raised", "high"]));
  gg.seq.set(sm.Nec, wordOf(sm.Nec, 0.25, 0.6, ["little", "forming", "much"]));
  gg.inv.set(sm.Inv, wordOf(sm.Inv, 0.25, 0.6, ["thin", "forming", "thick"]));
  gg.sinus.set(sm.Sin, wordOf(sm.Sin, 0.2, 0.5, ["none", "ooze", "draining"]));
  gg.heal.set(sm.Heal, wordOf(sm.Heal, 0.3, 0.62, ["poor", "slow", "healing"]));
}
run({ init, step });
