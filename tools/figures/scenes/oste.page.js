/* Osteomyelitis scene: heart pumped blood seeding, metaphysis germs, pus, sequestrum, involucrum, sinus to skin, and gauges. */
const layers = { vesselPath: $("vesselPath"), bone: $("bone"), bac: $("bac"), cells: $("cells"), parts: $("parts"), treat: $("treat"), over: $("over"), panel: $("panel"), pusEl: $("pusEl"), seqG: $("seqG"), sinusPath: $("sinusPath"), sinusMouth: $("sinusMouth"), periL: $("periL"), periR: $("periR"), invL: $("invL"), invR: $("invR") };
let heartO = null, skinO = null, capEl = null, capDrug = -1;
let trBlood = null, trSinus = null;
function initOrgans() {
  heartO = organ($("heartSlot"), "heart", 118, 245, 130, {});
  skinO = organ($("skinSlot"), "skin", 832, 288, 120, {});
  const hp = heartO.ports.out || heartO.ports.aorta || [115, 156];
  const be = [380, 215];
  layers.vesselPath.setAttribute("d", "M" + f1(hp[0]) + " " + f1(hp[1]) + " C240 150 300 175 " + be[0] + " " + be[1]);
  const sp = skinO.ports.dermis || skinO.ports.surface || skinO.ports.in || [800, 294];
  layers.sinusPath.setAttribute("d", "M566 282 Q660 280 " + f1(sp[0]) + " " + f1(sp[1]));
  layers.sinusMouth.setAttribute("cx", f1(sp[0]));
  layers.sinusMouth.setAttribute("cy", f1(sp[1]));
  trBlood = track([hp, [240, 158], [310, 188], be]);
  trSinus = track([[566, 282], [660, 280], [sp[0], sp[1]]]);
}
function capText(d) {
  if (d === 1) return "Antibiotics kill germs in the bone. Dead bone still shelters germs.";
  if (d === 2) return "Debridement washes out pus and removes dead bone so healing can begin.";
  if (d === 3) return "A splint rests the bone. Rest eases pain and protects healing.";
  if (d === 4) return "Combined care kills germs, removes dead bone and rests the bone. Best healing.";
  return "No treatment. Germs multiply, pus builds up and bone dies.";
}
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
    bac.push({ g, x: rnd(428, 532), y: rnd(178, 332), ph: rnd(0, 6.28), s: 0, prev: i < 19 });
  }
}
const rbcs = [];
function initRbcs() {
  for (let i = 0; i < 8; i++) {
    const g = mk("g", { class: "cl cl-rbc" }, layers.parts);
    mk("ellipse", { class: "cl-b", rx: 8, ry: 4.6 }, g);
    mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g);
    rbcs.push({ g, u: i / 8, v: rnd(0.10, 0.16) });
  }
}
const seeders = [];
function initSeeders() {
  for (let i = 0; i < 5; i++) {
    const g = mk("g", { class: "cl cl-staph" }, layers.parts);
    mk("circle", { class: "cl-b", r: 3.4 }, g);
    mk("circle", { class: "cl-b", r: 2.6, cx: 4, cy: 2.4 }, g);
    mk("circle", { class: "cl-h", r: 1, cx: -1, cy: -1 }, g);
    seeders.push({ g, u: i / 5, v: rnd(0.08, 0.12) });
  }
}
const neus = [];
const blasts = [];
function initCells() {
  for (let i = 0; i < 5; i++) neus.push({ g: cell(layers.cells, { cls: "neut", r: 10, nuc: 0.55, nucCls: "multi", seed: i + 11, wob: 0.14 }), x: rnd(420, 530), y: rnd(190, 320), ph: rnd(0, 6.28) });
  for (let i = 0; i < 8; i++) {
    const left = i % 2 === 0;
    const g = cell(layers.cells, { cls: "ost", r: 6.5, nuc: 0.4, seed: i + 31, wob: 0.12 });
    layers.cells.appendChild(g);
    blasts.push({ g, x: left ? 362 : 598, y: 248 + Math.floor(i / 2) * 48, ph: rnd(0, 6.28) });
  }
}
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0 }; }); }
const pusP = pool(20, () => mk("circle", { class: "sc-p p-pus", r: 2.6 }, layers.parts));
const drainP = pool(16, () => mk("circle", { class: "sc-p p-sinus", r: 3 }, layers.parts));
const caps = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
const sparks = pool(16, () => mk("circle", { class: "sc-p p-pus", r: 2.2 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The bone";
  [["bac", "Infection", "g-bac", "Germs living in the bone. Staphylococcus aureus is usual. Antibiotics and removing dead bone bring this down."], ["pus", "Pus pressure", "g-pus", "Pus trapped inside rigid bone raises pressure, causes pain and fever, and can cut off the bone blood supply."], ["seq", "Dead bone", "g-seq", "Bone killed by pressure and lost blood supply. A detached dead fragment is a sequestrum and shelters germs."], ["inv", "New bone", "g-inv", "New bone laid down under the lifted periosteum around the infection. This shell is the involucrum."], ["sinus", "Sinus", "g-sinus", "A chronic sinus is a track that drains pus from bone through to the skin surface."], ["heal", "Healing", "g-heal", "Overall healing of the bone once infection and dead bone are controlled and the bone is rested."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Heart", 115, 160, 118, 128, "Heart: pumps blood around the body. Germs in the blood are carried to the bone.");
  pill(ox, "Germs", 330, 208, 300, 128, "Germs in the blood: carried from elsewhere and lodge in the metaphysis. Staphylococcus aureus is usual.");
  pill(ox, "Metaphysis", 480, 145, 480, 100, "Metaphysis: the growing end of a child long bone. Its slow curving vessels trap carried germs.");
  pill(ox, "Skin", 832, 232, 832, 128, "Skin: in chronic disease a sinus track opens here and pus drains out.");
  pill(ox, "Pus", 440, 252, 250, 345, "Pus under pressure inside rigid bone. Pressure causes pain and fever and can cut off the bone blood supply.");
  pill(ox, "Dead bone", 480, 268, 700, 175, "Dead bone: a separated fragment is a sequestrum. It has no blood supply so antibiotics reach it poorly.");
  pill(ox, "New bone", 592, 330, 700, 255, "New bone laid down under the lifted periosteum around the infection. This shell is the involucrum.");
  abxPillEl = pill(ox, "Antibiotics", 633, 330, 800, 412, "Prolonged antibiotics: travel in the blood to the bone and kill germs. Dead bone shelters germs from them.");
  surgPillEl = pill(ox, "Debridement", 633, 330, 800, 412, "Surgical debridement: surgery to drain pus, wash out the cavity and remove dead bone.");
  immPillEl = pill(ox, "Splint", 633, 330, 800, 412, "Splint: rests the limb, eases pain and protects weak bone while infection is treated.");
  combPillEl = pill(ox, "Combined care", 633, 330, 800, 412, "Combined care: antibiotics with debridement for dead bone or trapped pus, plus a splint to rest the bone.");
  capEl = mk("text", { class: "ost-cap", x: 30, y: 430 }, ox); capEl.textContent = capText(0);
}
function initTreat() {
  splintG = mk("g", { opacity: "0" }, layers.treat);
  mk("rect", { class: "ost-splint", x: 318, y: 208, width: 18, height: 212, rx: 8 }, splintG);
  mk("rect", { class: "ost-splint", x: 624, y: 208, width: 18, height: 212, rx: 8 }, splintG);
  mk("path", { class: "ost-strap", d: "M318 252L642 252M318 356L642 356" }, splintG);
}
function init() { initOrgans(); initBacteria(); initRbcs(); initSeeders(); initCells(); initTreat(); initPanel(); }
const sm = { B: 0.8, Pus: 0.7, Nec: 0.2, Inv: 0.1, Sin: 0, Infl: 0.8, Heal: 0.1, abx: 0, surg: 0, imm: 0 };
const acc = { pus: 0, drain: 0, cap: 0, spark: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.B = lerp(sm.B, m.B, k2); sm.Pus = lerp(sm.Pus, m.Pus, k2); sm.Nec = lerp(sm.Nec, m.Nec, k2); sm.Inv = lerp(sm.Inv, m.Inv, k2);
  sm.Sin = lerp(sm.Sin, m.Sin, k2); sm.Infl = lerp(sm.Infl, m.Infl, k2); sm.Heal = lerp(sm.Heal, m.Heal, k2);
  sm.abx = lerp(sm.abx, m.abx, k); sm.surg = lerp(sm.surg, m.surg, k); sm.imm = lerp(sm.imm, m.imm, k);
  const wob = (1 - sm.imm) * 1.5 * Math.sin(tm / 320);
  layers.bone.setAttribute("transform", "translate(" + f1(wob) + " 0)");
  layers.vesselPath.setAttribute("opacity", (0.65 + 0.30 * sm.Infl).toFixed(2));
  const pulse = 1 + 0.05 * sm.Pus * Math.sin(tm / 280);
  layers.pusEl.setAttribute("opacity", (0.10 + 0.80 * sm.Pus).toFixed(2));
  layers.pusEl.setAttribute("transform", "translate(" + f1(wob) + " 0) translate(480 252) scale(" + ((0.15 + 0.85 * sm.Pus) * pulse).toFixed(3) + ") translate(-480 -252)");
  const seqS = clamp(sm.Nec * (1 - sm.surg) + 0.02);
  layers.seqG.setAttribute("opacity", (0.10 + 0.90 * clamp(seqS * 1.6)).toFixed(2));
  layers.seqG.setAttribute("transform", "translate(" + f1(wob) + " 0) translate(480 274) scale(" + (0.30 + 0.70 * seqS).toFixed(3) + ") translate(-480 -274)");
  layers.sinusPath.setAttribute("opacity", (sm.Sin * 0.95).toFixed(2));
  layers.sinusMouth.setAttribute("opacity", (sm.Sin * 0.95).toFixed(2));
  const lift = sm.Inv * 7;
  layers.periL.setAttribute("transform", "translate(" + f1(-lift) + " 0)");
  layers.periR.setAttribute("transform", "translate(" + f1(lift) + " 0)");
  layers.periL.setAttribute("opacity", (0.35 + 0.65 * sm.Inv).toFixed(2));
  layers.periR.setAttribute("opacity", (0.35 + 0.65 * sm.Inv).toFixed(2));
  layers.invL.setAttribute("opacity", (sm.Inv * 0.95).toFixed(2));
  layers.invR.setAttribute("opacity", (sm.Inv * 0.95).toFixed(2));
  splintG.setAttribute("opacity", (sm.imm * 0.92).toFixed(2));
  const want = Math.round(sm.B * bac.length);
  const shrink = 1 - 0.30 * sm.abx;
  bac.forEach((b, i) => {
    const on = i < want;
    b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * 1.6));
    if (b.prev && !on) { const p = freeP(sparks); if (p) emit(p, b.x, b.y, rnd(-6, 6), rnd(-8, 2), 0); }
    b.prev = on;
    place(b.g, b.x + Math.sin(tm / 700 + b.ph) * 4, b.y + Math.cos(tm / 820 + b.ph) * 3, Math.sin(tm / 600 + b.ph) * 20, Math.max(0.04, b.s * shrink));
    b.g.style.opacity = b.s > 0.04 ? 1 : 0;
  });
  rbcs.forEach((r) => { r.u = (r.u + r.v * dt) % 1; const q = trBlood.at(r.u); place(r.g, q.x, q.y, q.a, 1); });
  seeders.forEach((s, i) => { s.u = (s.u + s.v * dt) % 1; const q = trBlood.at(s.u); place(s.g, q.x + Math.sin(tm / 500 + i * 2) * 3, q.y + Math.cos(tm / 600 + i) * 3, Math.sin(tm / 700 + i) * 25, 1); });
  neus.forEach((n, i) => {
    const on = sm.Infl > 0.18 && i < Math.round(sm.Infl * neus.length);
    place(n.g, n.x + Math.sin(tm / 620 + n.ph) * 10, n.y + Math.cos(tm / 740 + n.ph) * 8, Math.sin(tm / 500 + n.ph) * 14, on ? 1 : 0.08);
    n.g.style.opacity = on ? 1 : 0;
  });
  blasts.forEach((b) => { place(b.g, b.x + Math.sin(tm / 900 + b.ph) * 2, b.y, 0, 0.3 + 0.7 * sm.Inv); b.g.style.opacity = sm.Inv > 0.1 ? 1 : 0; });
  acc.pus += dt * sm.Pus * 7;
  while (acc.pus >= 1) { acc.pus--; const p = freeP(pusP); if (p) emit(p, rnd(440, 520), rnd(205, 305), rnd(-5, 5), rnd(-6, 6), 0); }
  pusP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + Math.sin(tm / 360 + p.y) * 0.25; p.y += p.vy * dt; p.x = clamp(p.x, 428, 532); p.y = clamp(p.y, 188, 322); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.2) kill(p); });
  acc.drain += dt * (sm.Sin * 5 + sm.surg * (0.3 + 0.7 * sm.Pus) * 8);
  while (acc.drain >= 1) { acc.drain--; const p = freeP(drainP); if (p) emit(p, 566, 282, 0, 0, 0); }
  drainP.forEach((p) => { if (!p.on) return; p.u += dt * 0.30; const q = trSinus.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.u - 0.8) / 0.2).toFixed(2)); if (p.u > 1.05) kill(p); });
  acc.cap += dt * sm.abx * 2.2;
  while (acc.cap >= 1) { acc.cap--; const p = freeP(caps); if (p) emit(p, 0, 0, 0, 0, 0); }
  caps.forEach((p) => { if (!p.on) return; p.u += dt * 0.35; const q = trBlood.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(p.u * 160) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.u - 0.85) / 0.15).toFixed(2)); if (p.u >= 1) kill(p); });
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
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
