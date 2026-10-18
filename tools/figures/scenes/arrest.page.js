/* Cardiac arrest scene: heart rhythm, CPR, defibrillation, brain and organ ischaemia, reversible causes and gauges. */
const E = SC.ECG, EB = E.y + 68;
const L = { ves: $("vessels"), flow: $("flow"), heart: $("heart"), brain: $("brainG"), organ: $("organG"), chain: $("chain"), causes: $("causes"), pads: $("pads"), hands: $("hands"), syr: $("syr"), ecg: $("ecg"), over: $("over"), panel: $("panel") };
const HX = 260, HY = 195, BX = 765, BY = 145, OX = 765, OY = 262;
const sm = { out: 0.2, rec: 0.05, brain: 0.18, organ: 0.16, isch: 0.8, surv: 0.05, defib: 0, drugs: 0, shockGiven: 0, spont: 0 };
let heartG, heartDark, brainDark, organDark, handsG, syrG, ecgPath, ecgTxt, padBolt;
const chainNodes = [], causeTokens = [], gg = {};
const trBrain = track([[322, 178], [450, 118], [580, 102], [682, 128]]);
const trOrgan = track([[322, 232], [470, 268], [600, 268], [706, 262]]);
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const flowB = pool(8, () => mk("circle", { class: "sc-p", r: 3, style: "--cc:var(--c-rbc)" }, L.flow));
const flowO = pool(8, () => mk("circle", { class: "sc-p", r: 3, style: "--cc:var(--c-rbc)" }, L.flow));
const sparks = pool(12, () => mk("circle", { class: "sc-p p-spark", r: 2.2 }, L.flow));
flowB.forEach((p, i) => { p.k = i / 8; p.on = true; p.e.setAttribute("opacity", "1"); });
flowO.forEach((p, i) => { p.k = i / 8; p.on = true; p.e.setAttribute("opacity", "1"); });
function qrs(t) {
  const p = ((t / 0.9) % 1 + 1) % 1;
  let v = 0;
  if (p > 0.08 && p < 0.2) v += 0.1 * Math.sin(Math.PI * (p - 0.08) / 0.12);
  if (p > 0.26 && p < 0.29) v -= 0.14 * Math.sin(Math.PI * (p - 0.26) / 0.03);
  if (p > 0.29 && p < 0.34) v += 1 * Math.sin(Math.PI * (p - 0.29) / 0.05);
  if (p > 0.34 && p < 0.37) v -= 0.2 * Math.sin(Math.PI * (p - 0.34) / 0.03);
  if (p > 0.5 && p < 0.74) v += 0.28 * Math.sin(Math.PI * (p - 0.5) / 0.24);
  return v;
}
function init() {
  mk("path", { class: "ar-art", d: "M322 178C450 118 580 102 682 128" }, L.ves);
  mk("path", { class: "ar-art", d: "M322 232C470 268 600 268 706 262" }, L.ves);
  mk("path", { class: "ar-vein", d: "M682 168C560 215 430 245 322 218" }, L.ves);
  heartG = mk("g", {}, L.heart);
  mk("path", { class: "ar-heart", d: "M0 73C-55 30 -72 -17 -48 -47C-30 -69 -4 -61 0 -41C4 -61 30 -69 48 -47C72 -17 55 30 0 73Z" }, heartG);
  mk("ellipse", { class: "ar-heartHi", cx: -22, cy: -28, rx: 16, ry: 10, transform: "rotate(-24)" }, heartG);
  heartDark = mk("path", { class: "ar-dark", d: "M0 73C-55 30 -72 -17 -48 -47C-30 -69 -4 -61 0 -41C4 -61 30 -69 48 -47C72 -17 55 30 0 73Z", opacity: "0.5" }, heartG);
  const bg = mk("g", {}, L.brain);
  mk("ellipse", { class: "ar-brain", cx: BX, cy: BY, rx: 82, ry: 46 }, bg);
  mk("path", { class: "ar-gyrus", d: "M712 128C730 112 752 122 758 136M742 158C758 144 782 150 788 164M778 118C796 122 806 134 804 148" }, bg);
  brainDark = mk("ellipse", { class: "ar-dark", cx: BX, cy: BY, rx: 82, ry: 46, opacity: "0.5" }, bg);
  const og = mk("g", {}, L.organ);
  mk("path", { class: "ar-organ", d: "M765 226C796 226 816 247 813 268C810 291 788 306 762 304C732 302 712 284 714 262C716 241 736 226 765 226Z" }, og);
  mk("path", { class: "ar-gyrus", d: "M742 248C730 258 730 274 742 286" }, og);
  organDark = mk("path", { class: "ar-dark", d: "M765 226C796 226 816 247 813 268C810 291 788 306 762 304C732 302 712 284 714 262C716 241 736 226 765 226Z", opacity: "0.5" }, og);
  mk("path", { class: "ar-chainLine", d: "M380 108H530" }, L.chain);
  [["Call", "Early recognition and calling for help starts the chain of survival."], ["CPR", "High quality chest compressions keep some blood moving to the brain and heart."], ["Shock", "Early defibrillation for a shockable rhythm gives the best chance of restarting the heart."], ["Care", "Post-arrest care after return of circulation protects the brain and treats the cause."]].forEach(([cap, tip], i) => {
    const x = 380 + i * 50, g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, L.chain);
    const c = mk("circle", { class: "ar-chain", cx: x, cy: 108, r: 13 }, g);
    const t = mk("text", { class: "ar-cap", x: x, y: 136, "text-anchor": "middle" }, g); t.textContent = cap;
    chainNodes.push(c);
  });
  const causeInfo = ["Hypoxia: low oxygen, a reversible cause in the Hs group.", "Hypovolaemia: low circulating volume, a reversible cause in the Hs group.", "Electrolyte disturbance: potassium and metabolic problems, a reversible cause in the Hs group.", "Hypothermia: low body temperature, a reversible cause in the Hs group.", "Tamponade: fluid around the heart stopping it filling, a reversible cause in the Ts group.", "Toxins: poisoning or drug effects, a reversible cause in the Ts group.", "Tension pneumothorax: trapped air crushing the lung and vessels, a reversible cause in the Ts group.", "Thrombosis: a clot in the heart or lung circulation, a reversible cause in the Ts group."];
  causeInfo.forEach((tip, i) => {
    const x = 650 + (i % 4) * 60, y = i < 4 ? 350 : 392, g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, L.causes);
    const c = mk("circle", { class: "ar-token", cx: x, cy: y, r: 15 }, g);
    const t = mk("text", { class: "ar-tokT", x: x, y: y + 4, "text-anchor": "middle" }, g); t.textContent = i < 4 ? "H" : "T";
    causeTokens.push(c);
  });
  mk("path", { class: "ar-wire", d: "M202 141L226 112" }, L.pads);
  const pa = mk("g", { transform: "translate(202 152) rotate(-18)" }, L.pads);
  mk("rect", { class: "ar-pad", x: -17, y: -11, width: 34, height: 22, rx: 6 }, pa);
  padBolt = mk("path", { class: "ar-bolt", d: "M2 -7L-4 1L0 1L-2 7L5 -1L1 -1Z", opacity: "0" }, pa);
  const pb = mk("g", { transform: "translate(318 238) rotate(24)" }, L.pads);
  mk("rect", { class: "ar-pad", x: -17, y: -11, width: 34, height: 22, rx: 6 }, pb);
  handsG = mk("g", {}, L.hands);
  mk("rect", { class: "ar-hand", x: -26, y: -22, width: 52, height: 17, rx: 8 }, handsG);
  mk("rect", { class: "ar-hand", x: -22, y: -8, width: 46, height: 15, rx: 7 }, handsG);
  mk("rect", { class: "ar-hand", x: -7, y: -52, width: 14, height: 32, rx: 6 }, handsG);
  syrG = mk("g", {}, L.syr);
  mk("rect", { class: "ar-syrB", x: -28, y: -7, width: 42, height: 14, rx: 3 }, syrG);
  mk("rect", { class: "ar-syrF", x: -28, y: -7, width: 26, height: 14, rx: 3 }, syrG);
  mk("path", { class: "ar-needle", d: "M14 0H38" }, syrG);
  mk("rect", { class: "ar-syrB", x: -38, y: -3, width: 10, height: 6, rx: 2 }, syrG);
  place(syrG, 120, 285, 0, 1);
  ecgPath = mk("path", { class: "ar-trace" }, L.ecg);
  ecgTxt = mk("text", { class: "sc-zone", x: E.x + E.w - 10, y: E.y + 18, "text-anchor": "end" }, L.ecg);
  const eh = mk("g", { class: "hot", tabindex: "0", "data-info": "One ECG lead. VF is chaotic with no pulse, asystole is flat, PEA shows complexes with no pulse, and return of circulation shows complexes with a pulse." }, L.ecg);
  mk("rect", { x: E.x, y: E.y, width: E.w, height: E.h, fill: "transparent" }, eh);
  const o = L.over;
  pill(o, "Heart", 235, 180, 140, 105, "The heart. In arrest it quivers in VF, is still in asystole, or twitches without a pulse in PEA. When circulation returns it beats and pumps.");
  pill(o, "CPR", 260, 118, 170, 80, "Chest compressions by hand. High quality CPR keeps a small flow going to the brain and heart until the heart can restart.");
  pill(o, "Defib pads", 202, 152, 105, 155, "Defibrillator pads. A shock helps only a shockable rhythm (VF or pulseless VT). It does not help asystole or PEA.");
  pill(o, "Chain", 430, 95, 455, 72, "Chain of survival: recognition and call, CPR, early defibrillation, then post-arrest care. Each link strengthens the next.");
  pill(o, "ECG", 60, 360, 55, 298, "The ECG lead below. The rhythm decides whether a shock is advised. PEA has ECG complexes but no pulse.");
  const adr = pill(o, "Adrenaline", 120, 285, 120, 250, "Adrenaline in a syringe. It tightens vessels and raises the pressure driving blood to the heart during CPR."); adr.setAttribute("id", "p-adr");
  pill(o, "Brain", 725, 118, 645, 88, "The brain. It is injured fastest when circulation stops. CPR and early return of circulation protect it.");
  pill(o, "Organs", 795, 255, 885, 255, "Organs such as the kidney. Without cardiac output they become ischaemic. Flow returning with CPR and ROSC reperfuses them.");
  pill(o, "4 Hs and 4 Ts", 710, 350, 765, 318, "Reversible causes to find and treat: the Hs (hypoxia, hypovolaemia, electrolyte disturbance, hypothermia) and the Ts (tamponade, toxins, tension pneumothorax, thrombosis).");
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["out", "Output", "g-good", "Cardiac output: blood pumped by the heart. Absent in arrest, partly replaced by CPR, restored at ROSC."], ["brain", "Brain flow", "g-good", "Blood flow to the brain. It falls to zero without CPR and recovers when circulation returns."], ["organ", "Organ flow", "g-good", "Blood flow to organs such as the kidney."], ["isch", "Ischaemia", "g-bad", "Lack of oxygen to tissues. It climbs within a short time of arrest and falls when flow returns."], ["rec", "ROSC chance", "g-good", "Chance of return of spontaneous circulation with the chosen rhythm and treatment."], ["surv", "Recovery", "g-good", "Overall recovery outlook: return of circulation with the brain protected."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0, 60, 18, cls, name, tip); });
}
function ecgStep() {
  const pulse = sm.spont > 0.5 || sm.rec > 0.55 ? 1 : 0;
  let d = "";
  for (let x = E.x; x <= E.x + E.w; x += 3) {
    const age = (E.x + E.w - x) / 110, tt = tm / 1000 - age;
    let v = 0;
    if (pulse || level === 2) v = qrs(tt);
    else if (level === 0) v = 0.36 * Math.sin(tt * 11) + 0.24 * Math.sin(tt * 19 + 1.3) + 0.12 * Math.sin(tt * 31);
    else v = 0.015 * Math.sin(tt * 5) + (sm.spont < 0.5 ? 0.07 * Math.pow(0.5 + 0.5 * Math.sin(tt * 6.8), 6) : 0);
    const y = clamp(EB - 42 * v, E.y + 4, E.y + E.h - 4);
    d += (x === E.x ? "M" : "L") + x + " " + f1(y);
  }
  ecgPath.setAttribute("d", d);
  const w = level === 3 ? "ROSC" : pulse ? "organised with pulse" : ["VF", "asystole", "PEA, no pulse", "ROSC"][level];
  if (ecgTxt.textContent !== w) ecgTxt.textContent = w;
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["out", "brain", "organ", "isch", "surv"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k2); });
  ["rec", "defib", "drugs", "shockGiven", "spont"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  const pulse = clamp((sm.out - 0.38) / 0.4) * (sm.spont > 0.4 || sm.rec > 0.5 ? 1 : 0.35);
  const beat = Math.pow(Math.max(0, Math.sin(tm / 300)), 2);
  const comp = Math.pow(0.5 + 0.5 * Math.sin(tm / 280), 2);
  const cprOn = sm.spont > 0.5 || pulse > 0.7 ? 0 : 1;
  let rot = 0, sc = 1;
  if (level === 0 && pulse < 0.5) { rot = Math.sin(tm / 37) * 3; sc = 1 + 0.02 * Math.sin(tm / 53); }
  else if (level === 1) { sc = 1 - 0.03 * comp * cprOn; }
  else if (level === 2 && pulse < 0.5) { sc = 1 + 0.012 * Math.sin(tm / 300); }
  else { sc = 1 + 0.09 * beat * pulse; }
  place(heartG, HX, HY, rot, sc);
  heartDark.setAttribute("opacity", (sm.isch * 0.55).toFixed(2));
  brainDark.setAttribute("opacity", (sm.isch * 0.65).toFixed(2));
  organDark.setAttribute("opacity", (sm.isch * 0.6).toFixed(2));
  place(handsG, HX, 108 + comp * 12 * cprOn, 0, 1);
  handsG.style.opacity = (1 - pulse * 0.9).toFixed(2);
  padBolt.setAttribute("opacity", (sm.defib * (0.5 + 0.5 * Math.sin(tm / 160))).toFixed(2));
  syrG.style.opacity = sm.drugs.toFixed(2);
  $("p-adr").style.opacity = sm.drugs.toFixed(2);
  const chainOn = [1, cprOn || pulse, sm.shockGiven, pulse];
  chainNodes.forEach((c, i) => { c.setAttribute("class", chainOn[i] > 0.4 ? "ar-chainOn" : "ar-chain"); });
  causeTokens.forEach((c) => { c.setAttribute("class", sm.drugs > 0.4 ? "ar-tokenOn" : "ar-token"); });
  const spd = 0.02 + 0.14 * sm.out;
  flowB.forEach((p) => { p.k = (p.k + dt * spd) % 1; const a = trBrain.at(p.k); p.e.setAttribute("transform", "translate(" + f1(a.x) + " " + f1(a.y) + ")"); p.e.setAttribute("opacity", clamp(0.25 + sm.out).toFixed(2)); });
  flowO.forEach((p) => { p.k = (p.k + dt * spd * 0.85) % 1; const a = trOrgan.at(p.k); p.e.setAttribute("transform", "translate(" + f1(a.x) + " " + f1(a.y) + ")"); p.e.setAttribute("opacity", clamp(0.25 + sm.out).toFixed(2)); });
  if (Math.random() < dt * sm.brain * 7) { const p = freeP(sparks); if (p) emit(p, BX + rnd(-58, 58), BY + rnd(-28, 28), rnd(-7, 7), rnd(-7, 7), 0); }
  sparks.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8 || Math.abs(p.x - BX) > 76 || Math.abs(p.y - BY) > 42) kill(p); });
  ecgStep();
  gg.out.set(sm.out, wordOf(sm.out, 0.35, 0.7, ["absent", "by CPR", "restored"]));
  gg.brain.set(sm.brain, wordOf(sm.brain, 0.3, 0.65, ["none", "low", "good"]));
  gg.organ.set(sm.organ, wordOf(sm.organ, 0.3, 0.65, ["none", "low", "good"]));
  gg.isch.set(sm.isch, wordOf(sm.isch, 0.3, 0.65, ["low", "rising", "high"]));
  gg.rec.set(sm.rec, wordOf(sm.rec, 0.25, 0.6, ["low", "possible", "likely"]));
  gg.surv.set(sm.surv, wordOf(sm.surv, 0.25, 0.6, ["poor", "guarded", "better"]));
}
run({ init, step });
