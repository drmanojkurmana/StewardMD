/* Rheumatic fever scene: strep throat, mimicry, cross-reactive attack on heart, joint, brain and skin, and valve scarring. */
const L = { stage: $("stage"), parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tx: 0, ty: 0, st: 0, tr: null, spot: null }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.st = 0; p.tr = null; p.spot = null; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.tr = null; if (p.spot) { p.spot.used = null; p.spot = null; } p.e.setAttribute("opacity", "0"); }
const sm = { St: 0.8, Im: 0.6, Ca: 0.6, Ar: 0.7, Ot: 0.5, Sc: 0.1, pen: 0, blk: 0, sh: 0 };
const acc = { ag: 0, ab: 0, tc: 0, pen: 0, blk: 0, inv: 0 };
let heartO = null, brainO = null, HV = [166, 350], BP = [600, 296];
let chains = [], plasma, tcell, valveG, valveL, valveR, heartGlow, brainGlow, heartCool, jointCool, throatWash, shield, shieldFill;
let swell, ring, ring2, nod, armL, armR, arcs;
let spots = [], trAg = [], trAb = [], trTc = [];
const gg = {};
let capEl = null, capDrug = -1;
const ags = pool(12, () => mk("path", { class: "sc-p p-ag", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, L.parts));
const abs = pool(30, () => { const g = mk("g", {}, L.parts); mk("path", { class: "ab-p", d: "M0 6L0 0M0 0L-5 -6M0 0L5 -6" }, g); return g; });
const tcs = pool(10, () => mk("circle", { class: "sc-p p-tc", r: 4.2 }, L.parts));
const pens = pool(14, () => mk("circle", { class: "sc-p p-pen", r: 3 }, L.parts));
const blocks = pool(8, () => { const g = mk("g", {}, L.parts); mk("circle", { class: "rf-block", r: 5.5 }, g); return g; });
const invs = pool(6, () => mk("circle", { class: "sc-p p-ag", r: 3 }, L.parts));
function capText(d) {
  if (d === 1) return "Penicillin kills throat strep. With the trigger gone, the attack on the organs eases.";
  if (d === 2) return "Anti-inflammatory calms the heart, joint and skin flare. Throat strep stays.";
  if (d === 3) return "Secondary prophylaxis keeps strep out, so the valve scars no further. Old scar stays.";
  return "No treatment. Throat strep drives an immune attack on the heart, joints, brain and skin.";
}
function initOrgans() {
  const hs = $("heartSlot"), bs = $("brainSlot");
  heartGlow = mk("ellipse", { class: "rf-glow", cx: 174, cy: 336, rx: 82, ry: 68, opacity: "0" }, hs);
  heartO = organ(hs, "heart", 174, 334, 116, {});
  brainGlow = mk("ellipse", { class: "rf-glow", cx: 612, cy: 306, rx: 95, ry: 70, opacity: "0" }, bs);
  brainO = organ(bs, "brain", 612, 306, 150, {});
  HV = [Math.round(heartO.x - 8), Math.round(heartO.y + 16)];
  BP = [Math.round(brainO.ports.parenchyma[0]), Math.round(brainO.ports.parenchyma[1])];
  heartGlow.setAttribute("cx", heartO.x); heartGlow.setAttribute("cy", heartO.y + 2);
  brainGlow.setAttribute("cx", brainO.x); brainGlow.setAttribute("cy", brainO.y);
}
function initTracks() {
  trAg = [track([[150, 165], [230, 175], [300, 182]]), track([[150, 165], [300, 170], [420, 178], [500, 182]])];
  trAb = [
    track([[310, 194], [240, 206], [180, 242], [150, 290], HV]),
    track([[310, 194], [360, 222], [410, 262], [416, 300]]),
    track([[310, 194], [450, 205], [560, 232], BP]),
    track([[310, 194], [500, 206], [680, 216], [770, 252], [837, 322]]),
  ];
  trTc = [
    track([[500, 194], [380, 222], [260, 252], HV]),
    track([[500, 194], [460, 242], [430, 285], [416, 302]]),
  ];
}
function ride(p, dt, speed) { p.u += (dt * speed) / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; if (p.u >= 1) kill(p); }
function init() {
  initOrgans();
  initTracks();
  const g = L.stage;
  /* throat wash and shield sit behind the tonsil; cool tints sit over the organ art */
  throatWash = mk("ellipse", { class: "rf-wash", cx: 122, cy: 158, rx: 92, ry: 72, opacity: "0" }, g);
  heartCool = mk("ellipse", { class: "rf-cool", cx: 174, cy: 336, rx: 90, ry: 75, opacity: "0" }, g);
  jointCool = mk("ellipse", { class: "rf-cool", cx: 416, cy: 339, rx: 46, ry: 28, opacity: "0" }, g);
  /* throat: tonsil and strep chains that shrink as penicillin clears them */
  mk("ellipse", { class: "rf-tonsil", cx: 122, cy: 158, rx: 54, ry: 44 }, g);
  mk("path", { class: "rf-muc", d: "M36 202Q122 230 208 202" }, g);
  for (let c = 0; c < 10; c++) {
    const a = -2.4 + c * 0.5, bx = 122 + Math.cos(a) * 48, by = 158 + Math.sin(a) * 38;
    const ch = mk("g", {}, g);
    for (let j = 0; j < 4; j++) mk("circle", { class: "rf-strep", cx: f1(j * 5 - 7), cy: f1(Math.sin(j * 1.4 + c) * 2.4), r: 3.1 }, ch);
    place(ch, bx, by, 0, 1); chains.push({ g: ch, x: bx, y: by });
  }
  shieldFill = mk("rect", { class: "rf-shieldfill", x: 204, y: 88, width: 12, height: 128, rx: 6, opacity: "0" }, g);
  shield = mk("path", { class: "rf-shield", d: "M212 92Q226 152 212 212", opacity: "0" }, g);
  /* mimicry pair: same orange mark on strep protein and on valve protein */
  const m1 = mk("g", {}, g); mk("circle", { class: "rf-strep", cx: 300, cy: 116, r: 12 }, m1); mk("path", { class: "rf-agshape", d: "M300 94L305 102L300 110L295 102Z" }, m1);
  const m2 = mk("g", {}, g); mk("circle", { class: "rf-tonsil", cx: 400, cy: 116, r: 12 }, m2); mk("path", { class: "rf-agshape", d: "M400 94L405 102L400 110L395 102Z" }, m2);
  mk("path", { class: "rf-link", d: "M314 112H386" }, g);
  /* immune cells */
  plasma = mk("g", {}, g); cell(plasma, { cls: "bcell", r: 22, nuc: 0.42, seed: 7, wob: 0.1 }); place(plasma, 310, 182, 0, 1);
  tcell = mk("g", {}, g); cell(tcell, { cls: "lymph", r: 19, nuc: 0.5, seed: 9, wob: 0.1 }); place(tcell, 500, 182, 0, 1);
  /* mitral valve leaflets over the heart art */
  valveG = mk("g", {}, g); place(valveG, HV[0], HV[1], 0, 1);
  valveL = mk("path", { class: "rf-valve", d: "M-26 4Q-12 -6 0 4" }, valveG);
  valveR = mk("path", { class: "rf-valve", d: "M26 4Q12 -6 0 4" }, valveG);
  /* receptor ticks where anti-inflammatory blockers dock */
  [[HV[0] - 18, HV[1]], [HV[0] + 18, HV[1]], [388, 314], [444, 314], [837, 304], [795, 384]].forEach(([x, y]) => {
    const e = mk("circle", { class: "rf-rec", cx: x, cy: y, r: 6, opacity: "0.3" }, g);
    spots.push({ e, x, y, used: null });
  });
  /* joint */
  mk("rect", { class: "rf-bone", x: 404, y: 290, width: 24, height: 36, rx: 10 }, g);
  mk("rect", { class: "rf-bone", x: 404, y: 352, width: 24, height: 36, rx: 10 }, g);
  swell = mk("ellipse", { class: "rf-swell", cx: 416, cy: 339, rx: 34, ry: 16, opacity: "0" }, g);
  mk("ellipse", { class: "rf-bone", cx: 416, cy: 339, rx: 14, ry: 8 }, g);
  /* chorea figure under the brain art */
  mk("circle", { class: "rf-nod", cx: 566, cy: 386, r: 6.5 }, g);
  mk("path", { class: "rf-fig", d: "M566 393V405" }, g);
  armL = mk("path", { class: "rf-fig", d: "M566 396L551 390" }, g);
  armR = mk("path", { class: "rf-fig", d: "M566 396L581 390" }, g);
  mk("path", { class: "rf-fig", d: "M566 405L557 417M566 405L575 417" }, g);
  arcs = mk("g", { opacity: "0" }, g);
  mk("path", { class: "rf-arc", d: "M543 376Q566 364 589 376" }, arcs);
  mk("path", { class: "rf-arc", d: "M537 382Q566 368 595 382" }, arcs);
  /* skin: ring rash and a nodule */
  mk("rect", { class: "rf-skin", x: 762, y: 300, width: 150, height: 64, rx: 12 }, g);
  ring = mk("ellipse", { class: "rf-ring", cx: 837, cy: 330, rx: 36, ry: 21, opacity: "0" }, g);
  ring2 = mk("ellipse", { class: "rf-ring2", cx: 837, cy: 330, rx: 26, ry: 14, opacity: "0" }, g);
  nod = mk("g", { opacity: "0" }, g);
  mk("circle", { class: "rf-nod", cx: 795, cy: 398, r: 10 }, nod);
  mk("path", { class: "rf-wave", d: "M771 398H819" }, nod);
  initLabels(); initPanel();
}
function initLabels() {
  const o = L.over;
  pill(o, "Strep throat", 95, 140, 110, 62, "Group A strep in the throat. The trigger infection that starts the whole attack.");
  pill(o, "Mimicry", 350, 112, 400, 62, "A strep shape looks like a heart valve protein, so the immune reply also fits body tissue.");
  pill(o, "Heart valve", 140, 338, 70, 272, "Carditis: the immune attack inflames the heart, worst at the mitral valve. Repeat attacks leave scar.");
  pill(o, "Swollen joint", 416, 332, 416, 272, "Arthritis: hot swollen joints that flit from joint to joint, then settle without lasting damage.");
  pill(o, "Chorea", 566, 386, 650, 408, "Chorea: jerky fidgety movements from the brain attack. It starts late and fades slowly.");
  pill(o, "Skin rash", 837, 322, 838, 272, "Skin signs: a pink ring rash that spreads outward, plus firm painless lumps over bony points.");
  capEl = mk("text", { class: "rf-cap", x: 30, y: 434 }, o); capEl.textContent = capText(0);
}
function initPanel() {
  const P = L.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The patient";
  [["st", "Strep", "g-bac", "Group A strep in the throat: the trigger infection."], ["im", "Immunity", "g-cyt", "Cross-reactive antibodies and T cells aimed at strep shapes that also fit body tissue."], ["ca", "Carditis", "g-bad", "Inflammation of the heart and its valves during an attack."], ["ar", "Arthritis", "g-neu", "Joint inflammation: the commonest Jones feature, painful but not permanently damaging."], ["ot", "Other signs", "g-eos", "Chorea, nodules and erythema marginatum together."], ["sc", "Valve scar", "g-clot", "Permanent leaflet thickening and narrowing left behind, worst after repeated attacks."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0 + 2, 52, 18, cls, name, tip); });
}
function step(dt, m) {
  const k = Math.min(1, dt * 1.6), kf = Math.min(1, dt * 3);
  sm.St = lerp(sm.St, m.St, k); sm.Im = lerp(sm.Im, m.Im, k); sm.Ca = lerp(sm.Ca, m.Ca, k);
  sm.Ar = lerp(sm.Ar, m.Ar, k); sm.Ot = lerp(sm.Ot, m.Ot, k); sm.Sc = lerp(sm.Sc, m.Sc, k);
  sm.pen = lerp(sm.pen, (m.drug === 1 || m.drug === 3) ? 1 : 0, kf);
  sm.blk = lerp(sm.blk, m.drug === 2 ? 1 : 0, kf);
  sm.sh = lerp(sm.sh, m.drug === 3 ? 1 : 0, kf);
  /* strep chains shrink and fade as penicillin clears them */
  chains.forEach((ch, i) => {
    const on = i / chains.length < sm.St, s = 0.25 + 0.75 * clamp(sm.St * 1.3);
    place(ch.g, ch.x, ch.y, 0, on ? s : s * 0.7);
    ch.g.style.opacity = on ? (0.35 + 0.65 * sm.St).toFixed(2) : "0.06";
  });
  place(plasma, 310 + Math.sin(tm / 1400) * 2, 182 + Math.cos(tm / 1600) * 2, 0, 1 + 0.08 * sm.Im * Math.sin(tm / 280));
  place(tcell, 500 + Math.cos(tm / 1500) * 2, 182 + Math.sin(tm / 1700) * 2, 0, 1 + 0.08 * sm.Im * Math.cos(tm / 300));
  /* antigen drift from throat to the immune cells */
  acc.ag += dt * sm.St * 5;
  while (acc.ag >= 1) { acc.ag--; const p = freeP(ags); if (p) { emit(p, 0, 0, 0, 0); p.tr = pick(trAg); p.u = 0; } }
  ags.forEach((p) => { if (!p.on || !p.tr) return; ride(p, dt, 60); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); });
  /* antibodies stream to the target organs */
  acc.ab += dt * sm.Im * 13;
  while (acc.ab >= 1) { acc.ab--; const p = freeP(abs); if (p) { emit(p, 0, 0, 0, 0); p.tr = pick(trAb); p.u = 0; } }
  abs.forEach((p) => { if (!p.on || !p.tr) return; p.t += dt; ride(p, dt, 75); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(0)"); if (p.t > 9) kill(p); });
  /* T cells drift mainly to the heart and joint */
  acc.tc += dt * sm.Im * 4;
  while (acc.tc >= 1) { acc.tc--; const p = freeP(tcs); if (p) { emit(p, 0, 0, 0, 0); p.tr = pick(trTc); p.u = 0; } }
  tcs.forEach((p) => { if (!p.on || !p.tr) return; p.t += dt; ride(p, dt, 55); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 10) kill(p); });
  /* penicillin dots swarm the throat and kill strep */
  if (sm.pen > 0.25) {
    acc.pen += dt * 8 * sm.pen;
    while (acc.pen >= 1) { acc.pen--; const p = freeP(pens); if (p && chains.length) { const ch = chains[Math.floor(Math.random() * chains.length)]; emit(p, rnd(60, 190), rnd(110, 205), 0, 0); p.tx = ch.x; p.ty = ch.y; } }
  }
  pens.forEach((p) => {
    if (!p.on) return;
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 110 * dt; p.y += (dy / d) * 110 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (d < 9 || sm.pen < 0.25) kill(p);
  });
  /* anti-inflammatory blockers fly out and sit on their receptors */
  if (m.drug === 2) {
    acc.blk += dt * 5;
    while (acc.blk >= 1) { acc.blk--; const p = freeP(blocks), s = spots.find((q) => !q.used); if (p && s) { s.used = p; emit(p, 620, 150, 0, 0); p.st = 1; p.spot = s; } }
  }
  blocks.forEach((p) => {
    if (!p.on) return;
    if (p.st === 2) {
      p.e.setAttribute("transform", "translate(" + f1(p.spot.x) + " " + f1(p.spot.y) + ")");
      p.e.setAttribute("opacity", sm.blk.toFixed(2));
      if (sm.blk < 0.05) kill(p);
      return;
    }
    const dx = p.spot.x - p.x, dy = p.spot.y - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 80 * dt; p.y += (dy / d) * 80 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (d < 9 && p.spot) { p.st = 2; p.e.setAttribute("transform", "translate(" + f1(p.spot.x) + " " + f1(p.spot.y) + ")"); }
    if (m.drug !== 2) kill(p);
  });
  /* new strep drifts in; the prophylaxis shield blocks it at the throat edge */
  acc.inv += dt * (m.drug === 3 ? 2.2 : 3.2);
  while (acc.inv >= 1) { acc.inv--; const p = freeP(invs); if (p) emit(p, 28, rnd(120, 200), 26 + rnd(0, 14), 0); }
  invs.forEach((p) => {
    if (!p.on) return;
    p.x += p.vx * dt; p.y += Math.sin(tm / 500 + p.x / 20) * 8 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.x > (sm.sh > 0.5 ? 200 : 140)) kill(p);
  });
  /* treatment washes, shield, glows and receptor ticks */
  throatWash.setAttribute("opacity", (sm.pen * 0.3).toFixed(2));
  heartCool.setAttribute("opacity", (sm.blk * 0.25).toFixed(2));
  jointCool.setAttribute("opacity", (sm.blk * 0.3).toFixed(2));
  shield.setAttribute("opacity", sm.sh.toFixed(2));
  shieldFill.setAttribute("opacity", (sm.sh * 0.35).toFixed(2));
  heartGlow.setAttribute("opacity", (sm.Ca * 0.35).toFixed(2));
  brainGlow.setAttribute("opacity", (sm.Ot * 0.3).toFixed(2));
  spots.forEach((s) => s.e.setAttribute("opacity", (0.3 + 0.7 * sm.blk).toFixed(2)));
  /* valve leaflets thicken and stiffen with scar */
  const open = 1 - sm.Sc * 0.55, lift = 6 * open + sm.Ca * 2;
  [valveL, valveR].forEach((v) => { v.style.strokeWidth = (2.5 + sm.Sc * 5).toFixed(1); v.style.stroke = sm.Sc > 0.45 ? "#a89ca8" : ""; });
  valveL.setAttribute("d", "M-26 4Q-12 " + f1(4 - lift) + " 0 4");
  valveR.setAttribute("d", "M26 4Q12 " + f1(4 - lift) + " 0 4");
  /* joint, brain, skin signs */
  swell.setAttribute("opacity", (sm.Ar * 0.5).toFixed(2));
  const wob = sm.Ot * Math.sin(tm / 170);
  armL.setAttribute("d", "M566 396L" + f1(551 + wob * 6) + " " + f1(390 + wob * 4));
  armR.setAttribute("d", "M566 396L" + f1(581 - wob * 6) + " " + f1(390 - wob * 4));
  arcs.setAttribute("opacity", (sm.Ot * 0.9).toFixed(2));
  ring.setAttribute("opacity", (sm.Ot * 0.95).toFixed(2));
  ring2.setAttribute("opacity", (sm.Ot * 0.8).toFixed(2));
  nod.setAttribute("opacity", (sm.Ot * 0.95).toFixed(2));
  gg.st.set(sm.St, wordOf(sm.St, 0.25, 0.6, ["cleared", "present", "high"]));
  gg.im.set(sm.Im, wordOf(sm.Im, 0.25, 0.6, ["low", "raised", "high"]));
  gg.ca.set(sm.Ca, wordOf(sm.Ca, 0.25, 0.6, ["quiet", "active", "severe"]));
  gg.ar.set(sm.Ar, wordOf(sm.Ar, 0.25, 0.6, ["quiet", "active", "severe"]));
  gg.ot.set(sm.Ot, wordOf(sm.Ot, 0.25, 0.6, ["absent", "present", "marked"]));
  gg.sc.set(sm.Sc, wordOf(sm.Sc, 0.3, 0.65, ["supple", "thickening", "scarred"]));
  if (m.drug !== capDrug) { capDrug = m.drug; const t = capText(m.drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
