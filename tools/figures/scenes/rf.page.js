/* Rheumatic fever scene: strep throat, mimicry, cross-reactive attack on heart, joint, brain and skin, and valve scarring. */
const L = { stage: $("stage"), parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0, ty: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const sm = { St: 0.8, Im: 0.6, Ca: 0.6, Ar: 0.7, Ot: 0.5, Sc: 0.1, Hf: 0.2 };
const acc = { ag: 0, ab: 0, tc: 0 };
let chains = [], plasma, tcell, heartG, valveL, valveR, glow, swell, ring, ring2, nod, armL, armR, arcs, gg = {}, marks = [], jdots = [], jtexts = [];
const TARGETS = [[170, 345], [170, 345], [481, 342], [663, 330], [845, 332]];
const ags = pool(14, () => mk("path", { class: "sc-p p-ag", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, L.parts));
const abs = pool(34, () => { const g = mk("g", {}, L.parts); mk("path", { class: "ab-p", d: "M0 6L0 0M0 0L-5 -6M0 0L5 -6" }, g); return g; });
const tcs = pool(12, () => mk("circle", { class: "sc-p p-tc", r: 4.2 }, L.parts));
function init() {
  const g = L.stage;
  /* throat: tonsil and strep chains */
  mk("path", { class: "rf-muc", d: "M36 196Q95 226 154 196" }, g);
  mk("ellipse", { class: "rf-tonsil", cx: 95, cy: 162, rx: 56, ry: 46 }, g);
  for (let c = 0; c < 10; c++) { const ch = mk("g", {}, g), a = -2.4 + c * 0.5, bx = 95 + Math.cos(a) * 48, by = 162 + Math.sin(a) * 38;
    for (let j = 0; j < 4; j++) mk("circle", { class: "rf-strep", cx: f1(bx + j * 5 - 7), cy: f1(by + Math.sin(j * 1.4 + c) * 2.4), r: 3.1 }, ch); chains.push(ch); }
  /* mimicry pair: same orange mark on strep protein and on valve protein */
  const m1 = mk("g", {}, g); mk("circle", { class: "rf-strep", cx: 322, cy: 122, r: 13 }, m1); mk("path", { class: "rf-agshape", d: "M322 100L327 108L322 116L317 108Z" }, m1);
  const m2 = mk("g", {}, g); mk("circle", { class: "rf-tonsil", cx: 452, cy: 122, r: 13 }, m2); mk("path", { class: "rf-agshape", d: "M452 100L457 108L452 116L447 108Z" }, m2);
  mk("path", { class: "rf-link", d: "M338 112H434" }, g);
  /* immune cells */
  plasma = mk("g", {}, g); cell(plasma, { cls: "bcell", r: 24, nuc: 0.42, seed: 7, wob: 0.1 }); place(plasma, 360, 178, 0, 1);
  tcell = mk("g", {}, g); cell(tcell, { cls: "lymph", r: 20, nuc: 0.5, seed: 9, wob: 0.1 }); place(tcell, 545, 178, 0, 1);
  /* heart and mitral valve */
  heartG = mk("g", {}, g); glow = mk("circle", { class: "rf-glow", cx: 0, cy: 0, r: 54, opacity: "0" }, heartG);
  mk("path", { class: "rf-heart", d: "M0 42C-58 12 -44 -40 -14 -40C-4 -40 0 -30 0 -22C0 -30 4 -40 14 -40C44 -40 58 12 0 42Z" }, heartG);
  valveL = mk("path", { class: "rf-valve", d: "M-26 4Q-12 -6 0 4" }, heartG); valveR = mk("path", { class: "rf-valve", d: "M26 4Q12 -6 0 4" }, heartG);
  place(heartG, 170, 348, 0, 1);
  /* joint */
  mk("rect", { class: "rf-bone", x: 469, y: 298, width: 24, height: 34, rx: 10 }, g); mk("rect", { class: "rf-bone", x: 469, y: 354, width: 24, height: 34, rx: 10 }, g);
  swell = mk("ellipse", { class: "rf-swell", cx: 481, cy: 343, rx: 36, ry: 17, opacity: "0" }, g);
  mk("ellipse", { class: "rf-bone", cx: 481, cy: 343, rx: 15, ry: 8 }, g);
  /* brain and chorea figure */
  mk("ellipse", { class: "rf-brain", cx: 663, cy: 326, rx: 47, ry: 30 }, g);
  mk("path", { class: "rf-wave", d: "M628 318Q645 306 663 318Q681 330 698 318M632 336Q648 326 663 336Q680 346 694 336" }, g);
  mk("circle", { class: "rf-brain", cx: 663, cy: 378, r: 7 }, g); mk("path", { class: "rf-fig", d: "M663 385V398" }, g);
  armL = mk("path", { class: "rf-fig", d: "M663 388L648 382" }, g); armR = mk("path", { class: "rf-fig", d: "M663 388L678 382" }, g);
  mk("path", { class: "rf-fig", d: "M663 398L654 410M663 398L672 410" }, g);
  arcs = mk("g", { opacity: "0" }, g); mk("path", { class: "rf-arc", d: "M640 368Q663 356 686 368" }, arcs); mk("path", { class: "rf-arc", d: "M634 374Q663 360 692 374" }, arcs);
  /* skin: ring rash and a nodule */
  mk("rect", { class: "rf-skin", x: 788, y: 300, width: 130, height: 64, rx: 12 }, g);
  ring = mk("ellipse", { class: "rf-ring", cx: 845, cy: 330, rx: 38, ry: 21, opacity: "0" }, g); ring2 = mk("ellipse", { class: "rf-ring2", cx: 845, cy: 330, rx: 27, ry: 14, opacity: "0" }, g);
  nod = mk("g", { opacity: "0" }, g); mk("circle", { class: "rf-nod", cx: 832, cy: 394, r: 11 }, nod); mk("path", { class: "rf-wave", d: "M806 394H858" }, nod);
  for (let i = 0; i < 5; i++) { jdots.push(svg.querySelector("#j" + i + " circle")); jtexts.push(svg.querySelector("#j" + i + " text")); }
  initPanel(); initLabels();
}
function initLabels() {
  const o = L.over;
  pill(o, "Strep throat", 95, 124, 95, 98, "Group A streptococci infect the throat. Their antigens start the immune response that later cross-reacts with body tissues.");
  pill(o, "Mimicry", 387, 108, 390, 96, "Molecular mimicry: a strep shape (for example on the M protein) resembles a heart valve protein, so the response aimed at the strep also fits body tissue.");
  pill(o, "Antibodies", 338, 182, 295, 210, "Antibodies made against the strep. Some cross-react with valve, joint, brain and skin proteins.");
  pill(o, "T cells", 528, 160, 580, 210, "T cells that recognise strep peptides can also react with body tissue and drive inflammation in the heart and other organs.");
  pill(o, "Heart valve", 150, 344, 100, 282, "Carditis: inflammation of the heart, most importantly the mitral valve. The leaflets swell and leak while the attack is active.");
  pill(o, "Valve scar", 190, 352, 275, 282, "With repeated attacks the leaflets thicken, scar and narrow. This chronic valve damage stays after the inflammation has settled.");
  pill(o, "Arthritis", 481, 330, 481, 282, "Arthritis: painful, swollen joints that move from joint to joint. It settles without lasting joint damage.");
  pill(o, "Chorea", 663, 308, 663, 282, "Sydenham chorea: jerky, involuntary movements and emotional change from cross-reaction in the brain. It appears later and settles slowly.");
  pill(o, "Skin signs", 845, 310, 853, 282, "Erythema marginatum (a pink ring rash that spreads outward) and firm painless nodules under the skin over bony points.");
  function mark(drug, text, x, y, tx, ty, tip, good) { const g = mk("g", {}, o);
    if (good) mk("path", { class: "mk-g", d: "M" + f1(x - 6) + " " + f1(y) + "l4 5l8 -10" }, g);
    else { mk("circle", { class: "mk-c", cx: f1(x), cy: f1(y), r: 8 }, g); mk("path", { class: "mk-x", d: "M" + f1(x - 4) + " " + f1(y - 4) + "l8 8M" + f1(x + 4) + " " + f1(y - 4) + "l-8 8" }, g); }
    pill(g, text, x, y, tx, ty, tip); marks.push({ g, drug }); }
  mark(1, "Penicillin", 182, 140, 180, 208, "Penicillin kills the strep in the throat and removes the antigen driving the cross-reaction.", false);
  mark(2, "Anti-inflammatory", 522, 356, 481, 410, "An anti-inflammatory calms joint, heart and skin inflammation. It does not kill the strep.", true);
  mark(3, "Prevents return", 196, 356, 270, 410, "Secondary prophylaxis: long term penicillin cover prevents a new strep throat, so no new attack scars the valve further. Existing scar stays.", true);
}
function initPanel() {
  const P = L.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The patient";
  [["st", "Strep", "g-bac", "Group A strep in the throat: the trigger infection."], ["im", "Immunity", "g-cyt", "Cross-reactive antibodies and T cells aimed at strep shapes that also fit body tissue."], ["ca", "Carditis", "g-bad", "Inflammation of the heart and its valves during an attack."], ["ar", "Arthritis", "g-neu", "Joint inflammation: the commonest Jones feature, painful but not permanently damaging."], ["ot", "Other signs", "g-eos", "Chorea, nodules and erythema marginatum together."], ["sc", "Valve scar", "g-clot", "Permanent leaflet thickening and narrowing left behind, worst after repeated attacks."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0 + 2, 52, 18, cls, name, tip); });
}
function step(dt, m) {
  const k = Math.min(1, dt * 1.6);
  sm.St = lerp(sm.St, m.St, k); sm.Im = lerp(sm.Im, m.Im, k); sm.Ca = lerp(sm.Ca, m.Ca, k); sm.Ar = lerp(sm.Ar, m.Ar, k); sm.Ot = lerp(sm.Ot, m.Ot, k); sm.Sc = lerp(sm.Sc, m.Sc, k); sm.Hf = lerp(sm.Hf, m.Hf, k);
  chains.forEach((ch, i) => { const on = i / chains.length < sm.St; ch.style.opacity = on ? (0.35 + 0.65 * sm.St).toFixed(2) : "0.06"; });
  place(plasma, 360 + Math.sin(tm / 1400) * 2, 178 + Math.cos(tm / 1600) * 2, 0, 1 + 0.08 * sm.Im * Math.sin(tm / 280));
  place(tcell, 545 + Math.cos(tm / 1500) * 2, 178 + Math.sin(tm / 1700) * 2, 0, 1 + 0.08 * sm.Im * Math.cos(tm / 300));
  /* antigen drift from throat to the immune cells */
  acc.ag += dt * sm.St * 5; while (acc.ag >= 1) { acc.ag--; const p = freeP(ags); if (p) { emit(p, rnd(120, 170), rnd(140, 180), 0, 0, Math.random() < 0.6 ? 0 : 1); p.tx = p.k ? 545 : 360; p.ty = 178; } }
  ags.forEach((p) => { if (!p.on) return; const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 52 * dt; p.y += (dy / d) * 52 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (d < 26) kill(p); });
  /* antibodies stream to the target organs */
  acc.ab += dt * sm.Im * 13; while (acc.ab >= 1) { acc.ab--; const p = freeP(abs), ti = Math.floor(Math.random() * TARGETS.length); if (p) { emit(p, 360 + rnd(-10, 10), 190, 0, 0, ti); p.tx = TARGETS[ti][0] + rnd(-14, 14); p.ty = TARGETS[ti][1] + rnd(-10, 10); } }
  abs.forEach((p) => { if (!p.on) return; p.t += dt; const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 62 * dt; p.y += (dy / d) * 62 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.atan2(dy, dx) * 57.3 + 90) + ")"); if (d < 12 || p.t > 7) kill(p); });
  /* T cells drift mainly to the heart and joint */
  acc.tc += dt * sm.Im * 4; while (acc.tc >= 1) { acc.tc--; const p = freeP(tcs), ti = Math.random() < 0.6 ? 0 : 2; if (p) { emit(p, 545, 190, 0, 0, ti); p.tx = TARGETS[ti][0] + rnd(-16, 16); p.ty = TARGETS[ti][1] + rnd(-10, 10); } }
  tcs.forEach((p) => { if (!p.on) return; p.t += dt; const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 44 * dt; p.y += (dy / d) * 44 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 12 || p.t > 8) kill(p); });
  /* heart: beat, glow, valve thickness and opening */
  const beat = 1 + 0.05 * (0.3 + sm.Ca) * Math.sin(tm / 260) + sm.Sc * 0.12;
  place(heartG, 170, 348, 0, beat); glow.setAttribute("opacity", (sm.Ca * 0.4).toFixed(2));
  [valveL, valveR].forEach((v) => { v.style.strokeWidth = (3 + sm.Sc * 5).toFixed(1); v.style.stroke = sm.Sc > 0.45 ? "#a89ca8" : ""; });
  const open = 1 - sm.Sc * 0.55, lift = 6 * open + sm.Ca * 2;
  valveL.setAttribute("d", "M-26 4Q-12 " + f1(4 - lift) + " 0 4"); valveR.setAttribute("d", "M26 4Q12 " + f1(4 - lift) + " 0 4");
  /* joint, brain, skin signs */
  swell.setAttribute("opacity", (sm.Ar * 0.45).toFixed(2));
  const wob = sm.Ot * Math.sin(tm / 170);
  armL.setAttribute("d", "M663 388L" + f1(648 + wob * 6) + " " + f1(382 + wob * 4)); armR.setAttribute("d", "M663 388L" + f1(678 - wob * 6) + " " + f1(382 - wob * 4));
  arcs.setAttribute("opacity", (sm.Ot * 0.9).toFixed(2));
  ring.setAttribute("opacity", (sm.Ot * 0.95).toFixed(2)); ring2.setAttribute("opacity", (sm.Ot * 0.8).toFixed(2)); nod.setAttribute("opacity", (sm.Ot * 0.95).toFixed(2));
  const jv = [sm.Ca, sm.Ar, sm.Ot, sm.Ot, sm.Ot];
  jdots.forEach((d, i) => { if (d) { d.style.fill = jv[i] > 0.3 ? "var(--c-bad)" : ""; } });
  jtexts.forEach((t, i) => { if (t) t.style.opacity = (0.35 + 0.65 * clamp(jv[i] * 1.6)).toFixed(2); });
  marks.forEach((mk2) => { mk2.g.style.display = mk2.drug === m.drug ? "" : "none"; });
  gg.st.set(sm.St, wordOf(sm.St, 0.25, 0.6, ["cleared", "present", "high"])); gg.im.set(sm.Im, wordOf(sm.Im, 0.25, 0.6, ["low", "raised", "high"]));
  gg.ca.set(sm.Ca, wordOf(sm.Ca, 0.25, 0.6, ["quiet", "active", "severe"])); gg.ar.set(sm.Ar, wordOf(sm.Ar, 0.25, 0.6, ["quiet", "active", "severe"]));
  gg.ot.set(sm.Ot, wordOf(sm.Ot, 0.25, 0.6, ["absent", "present", "marked"])); gg.sc.set(sm.Sc, wordOf(sm.Sc, 0.3, 0.65, ["supple", "thickening", "scarred"]));
}
run({ init, step });
