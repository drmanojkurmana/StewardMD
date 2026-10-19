/* Cardiac arrest scene: real heart, brain and kidney art joined by vessels, CPR hands, shock pads, adrenaline syringe, clot cause, ECG and gauges. */
const E = SC.ECG, EB = E.y + 68;
const L = { artB: $("artBrain"), artK: $("artKid"), vein: $("veinBack"), heart: $("heartSlot"), brain: $("brainSlot"), kidney: $("kidneySlot"), clot: $("clotG"), flash: $("flashG"), dims: $("dims"), flow: $("flow"), rx: $("rx"), pads: $("pads"), hands: $("hands"), syr: $("syr"), ecg: $("ecg"), over: $("over"), panel: $("panel") };
const HX = 255, HY = 205, BX = 765, BY = 140, KX = 765, KY = 285;
const SYRX = 120, SYRY = 285;
let heartO = null, brainO = null, kidneyO = null, trBrain = null, trKidney = null;
let clotAt = [520, 195], wallAt = [330, 145], syrTip = [SYRX + 38, SYRY];
let clotG = null, flashEl = null, boltEl = null, heartDim = null, brainDim = null, kidneyDim = null;
let handsG = null, syrG = null, syrFluid = null, ecgPath = null, ecgTxt = null, capEl = null, capKey = "";
const sm = { out: 0.2, rec: 0.05, brain: 0.18, organ: 0.16, isch: 0.8, surv: 0.05, defib: 0, drugs: 0, shockGiven: 0, spont: 0 };
const acc = { rx: 0 };
const gg = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, tx: 0, ty: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
const flowB = pool(9, () => mk("circle", { class: "sc-p", r: 3, style: "--cc:var(--c-rbc)" }, L.flow));
const flowK = pool(9, () => mk("circle", { class: "sc-p", r: 3, style: "--cc:var(--c-rbc)" }, L.flow));
const rxP = pool(10, () => mk("circle", { class: "sc-p p-rx", r: 2.6 }, L.rx));
const sparks = pool(10, () => mk("circle", { class: "sc-p p-spark", r: 2.2 }, L.flow));
flowB.forEach((p, i) => { p.k = i / 9; p.on = true; p.e.setAttribute("opacity", "1"); });
flowK.forEach((p, i) => { p.k = i / 9; p.on = true; p.e.setAttribute("opacity", "1"); });
function bezPts(a, c1, c2, b, n) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, v = 1 - u;
    p.push([v * v * v * a[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * b[0],
      v * v * v * a[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * b[1]]);
  }
  return p;
}
function curveD(a, c1, c2, b) {
  return "M" + f1(a[0]) + " " + f1(a[1]) + " C" + f1(c1[0]) + " " + f1(c1[1]) + " " + f1(c2[0]) + " " + f1(c2[1]) + " " + f1(b[0]) + " " + f1(b[1]);
}
function capText(lv, d, sh) {
  if (lv === 3) return "Heart beats alone. Flow is back.";
  if (d === 2) return "Adrenaline works. Clot gone. Flow returns.";
  if (d === 1) return sh ? "Shock restarts the heart. Flow returns." : "Shock fails here. Flow stays low.";
  return "Compressions only. Blood barely moves.";
}
/* vessels are redrawn from the heart, brain and kidney ports so blood meets real anatomy */
function initOrgans() {
  heartO = organ(L.heart, "heart", HX, HY, 170, {});
  brainO = organ(L.brain, "brain", BX, BY, 190, {});
  kidneyO = organ(L.kidney, "kidney", KX, KY, 110, {});
  const AO = heartO.ports.aorta || heartO.ports.out;
  const BC = brainO.ports.carotid || brainO.ports.in;
  const KI = kidneyO.ports.in;
  const KV = kidneyO.ports.vein || kidneyO.ports.out;
  const IV = heartO.ports.ivc || heartO.ports.in;
  const b1 = [AO[0] + 90, AO[1] - 40], b2 = [BC[0] - 110, BC[1] - 50];
  L.artB.setAttribute("d", curveD(AO, b1, b2, BC));
  trBrain = track(bezPts(AO, b1, b2, BC, 12));
  const k1 = [AO[0] + 120, AO[1] + 10], k2 = [KI[0] - 120, KI[1] - 30];
  L.artK.setAttribute("d", curveD(AO, k1, k2, KI));
  trKidney = track(bezPts(AO, k1, k2, KI, 12));
  const v1 = [KV[0] - 120, KV[1] + 40], v2 = [IV[0] + 120, IV[1] + 40];
  L.vein.setAttribute("d", curveD(KV, v1, v2, IV));
  const cp = trKidney.at(0.55), wp = trKidney.at(0.16);
  clotAt = [cp.x, cp.y]; wallAt = [wp.x, wp.y];
  syrTip = [SYRX + 38, SYRY];
  clotG = mk("g", {}, L.clot);
  cell(clotG, { cls: "rbc", r: 11, nuc: 0.55, seed: 5, wob: 0.14 });
  place(clotG, clotAt[0], clotAt[1], 0, 1);
  flashEl = mk("ellipse", { class: "ar-flash", cx: HX, cy: HY, rx: 95, ry: 90, opacity: "0" }, L.flash);
  heartDim = mk("ellipse", { class: "ar-dim", cx: HX, cy: HY, rx: 72, ry: 68, opacity: "0.5" }, L.dims);
  brainDim = mk("ellipse", { class: "ar-dim", cx: BX, cy: BY, rx: 85, ry: 50, opacity: "0.5" }, L.dims);
  kidneyDim = mk("ellipse", { class: "ar-dim", cx: KX, cy: KY, rx: 52, ry: 70, opacity: "0.5" }, L.dims);
}
function initActors() {
  const pl = mk("g", { transform: "translate(172 178) rotate(-18)" }, L.pads);
  mk("rect", { class: "ar-pad", x: -17, y: -11, width: 34, height: 22, rx: 6 }, pl);
  boltEl = mk("path", { class: "ar-bolt", d: "M2 -7L-4 1L0 1L-2 7L5 -1L1 -1Z", opacity: "0" }, pl);
  const pr = mk("g", { transform: "translate(338 252) rotate(24)" }, L.pads);
  mk("rect", { class: "ar-pad", x: -17, y: -11, width: 34, height: 22, rx: 6 }, pr);
  mk("path", { class: "ar-wire", d: "M165 168C150 140 145 120 145 105" }, L.pads);
  handsG = mk("g", {}, L.hands);
  mk("rect", { class: "ar-hand", x: -26, y: -22, width: 52, height: 17, rx: 8 }, handsG);
  mk("rect", { class: "ar-hand", x: -22, y: -8, width: 46, height: 15, rx: 7 }, handsG);
  mk("rect", { class: "ar-hand", x: -7, y: -52, width: 14, height: 32, rx: 6 }, handsG);
  syrG = mk("g", {}, L.syr);
  mk("rect", { class: "ar-syrB", x: -28, y: -7, width: 42, height: 14, rx: 3 }, syrG);
  syrFluid = mk("rect", { class: "ar-syrF", x: -28, y: -7, width: 26, height: 14, rx: 3 }, syrG);
  mk("path", { class: "ar-needle", d: "M14 0H38" }, syrG);
  mk("rect", { class: "ar-syrB", x: -38, y: -3, width: 10, height: 6, rx: 2 }, syrG);
  place(syrG, SYRX, SYRY, 0, 1);
  ecgPath = mk("path", { class: "ar-trace" }, L.ecg);
  ecgTxt = mk("text", { class: "sc-zone", x: E.x + E.w - 10, y: E.y + 18, "text-anchor": "end" }, L.ecg);
  const eh = mk("g", { class: "hot", tabindex: "0", "data-info": "One ECG lead. VF is chaotic with no pulse, asystole is flat, PEA shows complexes with no pulse, and return of circulation shows complexes with a pulse." }, L.ecg);
  mk("rect", { x: E.x, y: E.y, width: E.w, height: E.h, fill: "transparent" }, eh);
}
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
function initPanel() {
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["out", "Output", "g-good", "Cardiac output: blood pumped by the heart. Absent in arrest, partly replaced by CPR, restored with treatment."], ["brain", "Brain flow", "g-good", "Blood flow to the brain. It falls to zero without CPR and recovers when circulation returns."], ["organ", "Organ flow", "g-good", "Blood flow to organs such as the kidney."], ["isch", "Ischaemia", "g-bad", "Lack of oxygen to tissues. It climbs within a short time of arrest and falls when flow returns."], ["rec", "ROSC chance", "g-good", "Chance of return of spontaneous circulation with the chosen rhythm and treatment."], ["surv", "Recovery", "g-good", "Overall recovery outlook: return of circulation with the brain protected."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0, 60, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Heart", HX - 5, HY, 150, 95, "The heart. In arrest it quivers in VF, is still in asystole, or moves with no pulse in PEA. Treatment makes it beat and pump.");
  pill(o, "CPR", HX, 100, 300, 62, "Chest compressions. Hands push the chest so a little blood still reaches the brain until the heart restarts.");
  pill(o, "Pads", 172, 178, 95, 150, "Shock pads. A shock can restart a shockable rhythm such as VF. It does not help asystole or PEA.");
  pill(o, "Adrenaline", SYRX, SYRY, SYRX, 250, "Adrenaline from the syringe. It tightens vessels so compressions push more blood to the heart and brain.");
  pill(o, "Brain", BX - 40, BY, 645, 88, "The brain. It is harmed first when blood stops. Flow from CPR and a restarted heart protects it.");
  pill(o, "Kidney", KX + 10, KY, 885, 255, "The kidney stands for the body organs. Without flow they turn ischaemic. Returning flow feeds them again.");
  pill(o, "Cause", clotAt[0], clotAt[1], 480, 250, "A reversible cause, such as a clot blocking flow. Treatment clears it so blood can reach the organs.");
  pill(o, "ECG", 60, 370, 55, 298, "One ECG lead. The rhythm decides if a shock is advised. PEA has ECG complexes but no pulse.");
  capEl = mk("text", { class: "ar-cap", x: 596, y: 422 }, o); capEl.textContent = capText(0, 0, 1);
}
function init() { initOrgans(); initActors(); initPanel(); }
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
  place(heartO.g, HX, HY, rot, sc);
  heartDim.setAttribute("opacity", (sm.isch * 0.55).toFixed(2));
  brainDim.setAttribute("opacity", (sm.isch * 0.6).toFixed(2));
  kidneyDim.setAttribute("opacity", (sm.isch * 0.6).toFixed(2));
  place(handsG, HX, 100 + comp * 12 * cprOn, 0, 1);
  handsG.style.opacity = (1 - pulse * 0.9).toFixed(2);
  const flash = sm.defib * (0.35 + 0.3 * Math.sin(tm / 150));
  boltEl.setAttribute("opacity", flash.toFixed(2));
  flashEl.setAttribute("opacity", (sm.defib * (0.12 + 0.1 * Math.sin(tm / 150))).toFixed(2));
  syrFluid.setAttribute("width", f1(26 * (1 - 0.8 * sm.drugs)));
  L.artB.setAttribute("stroke-width", f1(5.5 - 2.3 * sm.drugs));
  L.artK.setAttribute("stroke-width", f1(5.5 - 2.3 * sm.drugs));
  const cs = 1 - 0.85 * sm.drugs;
  place(clotG, clotAt[0], clotAt[1], 0, cs);
  clotG.style.opacity = (1 - 0.9 * sm.drugs).toFixed(2);
  const spd = (0.02 + 0.14 * sm.out) * (1 + 0.5 * sm.drugs);
  flowB.forEach((p) => { p.k = (p.k + dt * spd) % 1; const a = trBrain.at(p.k); p.e.setAttribute("transform", "translate(" + f1(a.x) + " " + f1(a.y) + ")"); p.e.setAttribute("opacity", clamp(0.25 + sm.out).toFixed(2)); });
  flowK.forEach((p) => { p.k = (p.k + dt * spd * 0.85) % 1; const a = trKidney.at(p.k); p.e.setAttribute("transform", "translate(" + f1(a.x) + " " + f1(a.y) + ")"); p.e.setAttribute("opacity", clamp(0.25 + sm.out).toFixed(2)); });
  /* adrenaline dots leave the syringe, fly to the vessel and sit on its wall */
  acc.rx += dt * 6 * sm.drugs;
  while (acc.rx >= 1) { acc.rx--; const p = freeP(rxP); if (p) { p.on = true; p.st = 1; p.x = syrTip[0]; p.y = syrTip[1]; p.tx = wallAt[0] + rnd(-14, 14); p.ty = wallAt[1] + rnd(-10, 10); p.t = 0; p.e.setAttribute("opacity", "1"); } }
  rxP.forEach((p) => {
    if (!p.on) return;
    if (p.st === 1) {
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1, v = 170 * dt;
      if (d <= v) { p.x = p.tx; p.y = p.ty; p.st = 2; p.t = 0; }
      else { p.x += dx / d * v; p.y += dy / d * v; }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    } else { p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 2.5).toFixed(2)); if (p.t > 2.5) { p.on = false; p.e.setAttribute("opacity", "0"); } }
  });
  if (Math.random() < dt * sm.brain * 7) { const p = freeP(sparks); if (p) { p.on = true; p.x = BX + rnd(-58, 58); p.y = BY + rnd(-28, 28); p.vx = rnd(-7, 7); p.vy = rnd(-7, 7); p.t = 0; p.e.setAttribute("opacity", "1"); } }
  sparks.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8 || Math.abs(p.x - BX) > 76 || Math.abs(p.y - BY) > 42) { p.on = false; p.e.setAttribute("opacity", "0"); } });
  ecgStep();
  gg.out.set(sm.out, wordOf(sm.out, 0.35, 0.7, ["absent", "by CPR", "restored"]));
  gg.brain.set(sm.brain, wordOf(sm.brain, 0.3, 0.65, ["none", "low", "good"]));
  gg.organ.set(sm.organ, wordOf(sm.organ, 0.3, 0.65, ["none", "low", "good"]));
  gg.isch.set(sm.isch, wordOf(sm.isch, 0.3, 0.65, ["low", "rising", "high"]));
  gg.rec.set(sm.rec, wordOf(sm.rec, 0.25, 0.6, ["low", "possible", "likely"]));
  gg.surv.set(sm.surv, wordOf(sm.surv, 0.25, 0.6, ["poor", "guarded", "better"]));
  const key = level + "|" + drug;
  if (key !== capKey) { capKey = key; const t = capText(level, drug, m.shock > 0.5); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
