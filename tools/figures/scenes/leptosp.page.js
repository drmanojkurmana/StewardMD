/* Leptospirosis scene: dirty water, skin entry, blood spirals, antibodies, vessel injury and organs. */
const CY = SC.CY, WW = SC.W;
const layers = { water: $("waterfx"), rbc: $("rbcs"), endo: $("endo"), parts: $("parts"), fx: $("fx"), mach: $("mach"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, dying: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.dying = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.dying = 0; p.e.setAttribute("opacity", "0"); }
const spiralD = "M-9 0 Q-6 -7 -3 0 Q0 7 3 0 Q6 -7 9 0";
const drops = pool(10, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const incoming = pool(10, () => mk("path", { class: "lp-spiral", d: spiralD }, layers.parts));
const abs = pool(22, () => { const g = mk("g", {}, layers.parts); mk("path", { class: "lp-abY", d: "M0 4 L0 -1 M0 -1 L-4 -5 M0 -1 L4 -5" }, g); return g; });
const abxP = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "lp-dose", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "lp-dose2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const dialIn = pool(8, () => mk("circle", { class: "p-fl", r: 2.4 }, layers.parts));
const drainP = pool(8, () => mk("circle", { class: "p-fl", r: 2.4 }, layers.parts));
const wspir = [];
const bspir = [];
const rbcs = [];
let skinO = null, eyeO = null, liverO = null, kidO = null, lungO = null;
let fxLiver = null, fxKid = null, fxLung = null, fxEye = null, shield = null, machLight = null;
let capEl = null, capDrug = -1, capLevel = -1, trEntry = null;
function nearest(ports, hint) {
  let best = null, bd = 1e9;
  for (const k in ports) { const p = ports[k]; const d = Math.hypot(p[0] - hint[0], p[1] - hint[1]); if (d < bd) { bd = d; best = p; } }
  return best ? [best[0], best[1]] : hint.slice();
}
function hot(g, text) {
  g.setAttribute("class", (g.getAttribute("class") || "") + " hot");
  g.setAttribute("tabindex", "0"); g.setAttribute("data-info", text);
}
function initOrgans() {
  skinO = organ($("skinSlot"), "skin", 330, 130, 110, {});
  eyeO = organ($("eyeSlot"), "eye", 110, 376, 105, {});
  liverO = organ($("liverSlot"), "liver", 350, 376, 155, {});
  kidO = organ($("kidSlot"), "kidney", 560, 380, 100, {});
  lungO = organ($("lungSlot"), "lung", 815, 374, 100, {});
  hot(eyeO.g, "Red eyes without discharge (conjunctival suffusion), a classic clue in the early fever phase.");
  const lum = $("lumen");
  hot(lum, "Bloodstream: leptospires spread in blood to liver, kidney, lung and other tissues. Antibodies later clear the blood, but injured vessels keep causing harm.");
  const SP = skinO.ports.out || [330, 182];
  $("dropPath").setAttribute("d", "M" + f1(SP[0]) + " " + f1(SP[1]) + " L" + f1(SP[0]) + " " + f1(CY - 36));
  const qL = nearest(liverO.ports, [350, 310]), qN = nearest(lungO.ports, [815, 306]);
  $("connEye").setAttribute("d", "M110 " + f1(CY + 34) + " L110 " + f1(eyeO.y - eyeO.h / 2 + 12));
  $("connLiver").setAttribute("d", "M" + f1(qL[0]) + " " + f1(CY + 34) + " L" + f1(qL[0]) + " " + f1(qL[1] + 10));
  $("connKid").setAttribute("d", "M595 " + f1(CY + 34) + " L595 " + f1(kidO.y - kidO.h / 2 + 12));
  $("connLung").setAttribute("d", "M" + f1(qN[0]) + " " + f1(CY + 34) + " L" + f1(qN[0]) + " " + f1(qN[1] + 10));
  trEntry = track([[64, 130], [330, 130], [SP[0], CY - 12]]);
  const F = layers.fx;
  fxLiver = mk("ellipse", { class: "lp-jau", cx: f1(liverO.x), cy: f1(liverO.y), rx: f1(0.38 * liverO.w), ry: f1(0.34 * liverO.h), opacity: "0" }, F);
  fxKid = mk("ellipse", { class: "lp-kid", cx: f1(kidO.x), cy: f1(kidO.y), rx: f1(0.32 * kidO.w), ry: f1(0.38 * kidO.h), opacity: "0" }, F);
  fxLung = mk("g", { opacity: "0" }, F);
  [[-20, -30, 5.5], [5, -8, 6], [22, -35, 4.5], [-8, 18, 5], [12, 38, 5.5]].forEach(([dx, dy, r]) => mk("circle", { class: "lp-spot", cx: f1(lungO.x + dx), cy: f1(lungO.y + dy), r: r }, fxLung));
  fxEye = mk("g", { opacity: "0" }, F);
  const ex = eyeO.x, ey = eyeO.y;
  ["M" + f1(ex - 34) + " " + f1(ey - 10) + " L" + f1(ex - 14) + " " + f1(ey - 4), "M" + f1(ex - 34) + " " + f1(ey + 8) + " L" + f1(ex - 14) + " " + f1(ey + 4),
   "M" + f1(ex + 14) + " " + f1(ey - 6) + " L" + f1(ex + 32) + " " + f1(ey - 12), "M" + f1(ex + 14) + " " + f1(ey + 6) + " L" + f1(ex + 32) + " " + f1(ey + 10)]
    .forEach((d) => mk("path", { class: "lp-redv", d: d }, fxEye));
  shield = mk("rect", { class: "lp-shield", x: f1(skinO.x - 61), y: f1(skinO.y - 61), width: 122, height: 122, rx: 12, opacity: "0" }, F);
  const mg = layers.mach;
  hot(mg, "Dialysis supports failing kidneys. Blood loops through a filter that clears wastes and extra fluid, but it does not kill germs.");
  mk("path", { class: "lp-tube", d: "M676 296 L676 330" }, mg);
  mk("path", { class: "lp-tube", d: "M648 360 C632 361 620 363 612 366" }, mg);
  mk("path", { class: "lp-drain", d: "M676 396 L676 428" }, mg);
  mk("rect", { class: "lp-mach", x: 648, y: 332, width: 64, height: 64, rx: 8 }, mg);
  mk("rect", { class: "lp-cham", x: 656, y: 342, width: 48, height: 26, rx: 4 }, mg);
  machLight = mk("circle", { class: "lp-light", cx: 706, cy: 340, r: 3, opacity: "0" }, mg);
  mg.setAttribute("opacity", "0.12");
}
function capText(l, d) {
  if (d === 4) return "Antibiotic kills germs and dialysis supports the kidneys. Organs recover.";
  if (d === 2) return "Antibiotic kills the germs in blood. Vessel injury fades and organs recover.";
  if (d === 3) return "Dialysis supports the kidneys and clears wastes. Germs remain.";
  if (d === 1) return l === 0 ? "Prophylaxis blocks entry through the skin. Few germs reach blood." : "Prophylaxis works before exposure. The germs are already inside.";
  if (l === 0) return "No treatment. Germs from dirty water enter the skin and reach blood.";
  if (l === 1) return "No treatment. Antibodies rise but injured vessels keep fever going.";
  return "No treatment. Injured vessels shut down the liver, kidneys and lungs.";
}
function initActors() {
  for (let i = 0; i < 12; i++) { const e = mk("path", { class: "lp-spiral", d: spiralD }, layers.water); wspir.push({ e, x: rnd(56, 200), y: rnd(104, 172), a: rnd(0, 6.28), ph: rnd(0, 6) }); }
  for (let i = 0; i < 16; i++) { const e = mk("path", { class: "lp-spiral", d: spiralD }, layers.parts); bspir.push({ e, on: false, x: rnd(-14, WW), y: CY + rnd(-18, 18), v: rnd(0.7, 1.3), ph: rnd(0, 6), dying: 0 }); e.setAttribute("opacity", "0"); }
  for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, WW), y: rnd(-0.75, 0.75), v: rnd(0.8, 1.2), rot: rnd(-18, 18) }); }
  const wall = layers.endo;
  for (let i = 0; i < 22; i++) { const x = 24 + i * 42; mk("circle", { class: "lp-spot", id: "vt" + i, cx: x, cy: CY - 28, r: 2.2, opacity: "0" }, wall); mk("circle", { class: "lp-spot", id: "vb" + i, cx: x, cy: CY + 28, r: 2.2, opacity: "0" }, wall); }
}
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["spiro", "Germs", "g-spiro", "Leptospires in blood and tissues. High in the early phase, cleared as antibodies rise or with antibiotic."], ["immune", "Antibodies", "g-immune", "Antibodies appear in the immune phase and clear leptospires from blood, although germs may persist in kidney tubules."], ["vessel", "Vessel injury", "g-vessel", "Vasculitis: injured vessel walls cause bleeding, leak and organ damage across the body."], ["liver", "Jaundice", "g-liver", "Liver dysfunction in Weil disease turns skin and eyes yellow. Early illness has no jaundice."], ["kidney", "Kidney", "g-kidney", "Kidney injury from tubular damage and inflammation. Support with dialysis can carry failing kidneys."], ["lung", "Lung bleed", "g-lung", "Bleeding into the lungs in severe disease, a major cause of death."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Dirty water", 128, 86, 128, 70, "Water or soil with urine from animals carrying leptospires. Rain and floods spread it.");
  pill(ox, "Skin break", 330, 86, 330, 64, "Entry through cuts in skin or through the eyes, nose and mouth, often after wading or swimming.");
  pill(ox, "Vessel injury", 660, 232, 660, 208, "Vasculitis injures small vessel walls, causing bleeding, jaundice, kidney failure and lung bleeding in Weil disease.");
  const ab = pill(ox, "Antibiotic", 270, 244, 270, 208, "Antibiotic (doxycycline or penicillin) kills germs in blood. Each capsule can catch a germ and shrink it."); ab.setAttribute("id", "abx-pill");
  pill(ox, "Red eyes", 160, 376, 215, 376, "Conjunctival suffusion: red eyes without discharge, a classic clue in the early fever phase.");
  pill(ox, "Jaundice", 425, 368, 475, 360, "Jaundice in Weil disease reflects liver dysfunction, often with kidney failure and bleeding.");
  pill(ox, "Kidney", 560, 324, 560, 310, "Renal failure from tubular injury and inflammation. Dialysis can support failing kidneys.");
  pill(ox, "Lung bleed", 858, 372, 905, 376, "Pulmonary bleeding into lung tissue causes breathlessness and coughing blood in severe disease.");
  capEl = mk("text", { class: "lp-cap", x: 410, y: 100 }, ox); capEl.textContent = capText(0, 0);
}
const sm = { Spiro: 0.92, Immune: 0.14, Vessel: 0.3, Fever: 0.62, Liver: 0.1, Kidney: 0.12, Lung: 0.06, Eye: 0.35, abx: 0, sup: 0, proph: 0 };
const acc = { drop: 0, entry: 0, ab: 0, abx: 0, dial: 0 };
function init() { initOrgans(); initActors(); initPanel(); }
function revive(s) { s.on = true; s.dying = 0; s.x = -14; s.y = CY + rnd(-18, 18); s.e.setAttribute("opacity", "1"); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.7);
  ["Spiro", "Immune", "Vessel", "Fever", "Liver", "Kidney", "Lung", "Eye"].forEach((key) => { sm[key] = lerp(sm[key], m[key], k2); });
  sm.abx = lerp(sm.abx, m.abx, k); sm.sup = lerp(sm.sup, m.sup, k); sm.proph = lerp(sm.proph, m.proph, k);
  wspir.forEach((s) => { s.a += rnd(-1.2, 1.2) * dt; s.x += Math.cos(s.a) * 9 * dt; s.y += Math.sin(s.a) * 7 * dt; if (s.x < 52 || s.x > 204) s.a = Math.PI - s.a; if (s.y < 102 || s.y > 174) s.a = -s.a; s.x = clamp(s.x, 52, 204); s.y = clamp(s.y, 102, 174);
    s.e.setAttribute("transform", "translate(" + f1(s.x) + " " + f1(s.y) + ") rotate(" + f1(Math.sin(tm / 500 + s.ph) * 24) + ")"); s.e.setAttribute("opacity", (1 - 0.7 * sm.proph).toFixed(2)); });
  acc.drop += dt * 3.2; while (acc.drop >= 1) { acc.drop--; const p = freeP(drops); if (p) emit(p, rnd(60, 196), 62, 0, 34, 0); }
  drops.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x += Math.sin(tm / 300 + p.y) * 0.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 92) killP(p); });
  const entryRate = (drug === 1 ? (level === 0 ? 0.22 : 0.7) : 1) * (0.3 + 0.7 * clamp(sm.Spiro + 0.2));
  acc.entry += dt * 6 * entryRate; while (acc.entry >= 1) { acc.entry--; const p = freeP(incoming); if (p) { emit(p, 0, 0, 0, 0, 0); p.u = 0; } }
  incoming.forEach((p) => {
    if (!p.on) return;
    p.u += dt * 95 / trEntry.len; const blocked = sm.proph > 0.4 && p.u > 0.5;
    if (p.u >= 1 || (blocked && p.u > 0.58)) { killP(p); return; }
    const q = trEntry.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y;
    let op = 1; if (p.u > 0.9) op = (1 - p.u) / 0.1; if (blocked) op = Math.min(op, (0.58 - p.u) / 0.08);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(q.a) + ")");
    p.e.setAttribute("opacity", clamp(op).toFixed(2));
  });
  const wantB = Math.round(sm.Spiro * bspir.length);
  let active = 0; bspir.forEach((s) => { if (s.on && !s.dying) active++; });
  bspir.forEach((s, i) => {
    if (!s.on) { if (active < wantB) { revive(s); active++; } return; }
    if (!s.dying && i >= wantB) s.dying = 0.001;
    if (s.dying) {
      s.dying += dt / 0.7; s.y += 14 * dt;
      const sc = Math.max(0.15, 1 - 0.85 * s.dying);
      s.e.setAttribute("transform", "translate(" + f1(s.x) + " " + f1(s.y) + ") rotate(" + f1(Math.sin(tm / 360 + s.ph) * 28) + ") scale(" + sc.toFixed(3) + ")");
      s.e.setAttribute("opacity", clamp(1 - s.dying).toFixed(2));
      if (s.dying >= 1) killP(s);
      return;
    }
    s.x += s.v * (30 + 30 * sm.Spiro) * dt;
    if (s.x > WW + 14) { if (i >= wantB) { killP(s); return; } s.x = -14; s.y = CY + rnd(-18, 18); }
    s.e.setAttribute("transform", "translate(" + f1(s.x) + " " + f1(CY + (s.y - CY) + Math.sin(tm / 420 + s.ph) * 3) + ") rotate(" + f1(Math.sin(tm / 360 + s.ph) * 28) + ")");
    s.e.setAttribute("opacity", "1");
  });
  rbcs.forEach((r) => { r.x += r.v * 62 * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-0.75, 0.75); } place(r.g, r.x, CY + r.y * 22, r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  for (let i = 0; i < 22; i++) { const o = (sm.Vessel * (0.45 + 0.55 * Math.abs(Math.sin(tm / 700 + i)))).toFixed(2); const a = $("vt" + i), b = $("vb" + i); if (a) a.setAttribute("opacity", o); if (b) b.setAttribute("opacity", o); }
  acc.ab += dt * sm.Immune * 7; while (acc.ab >= 1) { acc.ab--; const p = freeP(abs); if (p) emit(p, rnd(30, WW - 30), CY + rnd(-20, 20), rnd(18, 42), rnd(-7, 7), 0); }
  abs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 40) + ")"); if (p.x > WW + 8 || p.t > 9) killP(p); });
  acc.abx += dt * sm.abx * 4; while (acc.abx >= 1) { acc.abx--; const p = freeP(abxP); if (p) emit(p, rnd(20, 90), CY + rnd(-14, 14), 70, 0, 0); }
  abxP.forEach((p) => {
    if (!p.on) return;
    p.t += dt; p.x += p.vx * dt;
    let caught = false;
    for (const s of bspir) {
      if (!s.on || s.dying) continue;
      if (Math.abs(s.x - p.x) < 24 && Math.abs(s.y - p.y) < 22) { s.dying = Math.max(s.dying, 0.001); caught = true; break; }
    }
    if (caught) { killP(p); return; }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")");
    p.e.setAttribute("opacity", clamp(1 - (p.t - 5) / 1.4).toFixed(2));
    if (p.t > 6.4 || p.x > WW + 8) killP(p);
  });
  acc.dial += dt * sm.sup * 9; while (acc.dial >= 1) { acc.dial -= 2; const a = freeP(dialIn), b = freeP(drainP); if (a) emit(a, 676, 300, 0, 42, 0); if (b) emit(b, 676, 398, 0, 26, 0); }
  dialIn.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 330) killP(p); });
  drainP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 426) killP(p); });
  layers.mach.setAttribute("opacity", (0.12 + 0.88 * sm.sup).toFixed(2));
  if (machLight) machLight.setAttribute("opacity", clamp(sm.sup * (0.55 + 0.45 * Math.sin(tm / 240))).toFixed(2));
  shield.setAttribute("opacity", (sm.proph * 0.9).toFixed(2));
  fxLiver.setAttribute("opacity", (sm.Liver * 0.55).toFixed(2));
  fxKid.setAttribute("opacity", (sm.Kidney * 0.55).toFixed(2));
  fxLung.setAttribute("opacity", clamp(sm.Lung * 1.3).toFixed(2));
  fxEye.setAttribute("opacity", clamp(sm.Eye * 1.2).toFixed(2));
  const abEl = $("abx-pill"); if (abEl) abEl.style.opacity = clamp(sm.abx * 1.4).toFixed(2);
  gg.spiro.set(sm.Spiro, wordOf(sm.Spiro, 0.22, 0.55, ["cleared", "present", "high"]));
  gg.immune.set(sm.Immune, wordOf(sm.Immune, 0.3, 0.65, ["low", "rising", "high"]));
  gg.vessel.set(sm.Vessel, wordOf(sm.Vessel, 0.3, 0.65, ["mild", "injured", "severe"]));
  gg.liver.set(sm.Liver, wordOf(sm.Liver, 0.25, 0.6, ["none", "mild", "marked"]));
  gg.kidney.set(sm.Kidney, wordOf(sm.Kidney, 0.25, 0.55, ["working", "impaired", "failing"]));
  gg.lung.set(sm.Lung, wordOf(sm.Lung, 0.22, 0.5, ["clear", "bleeding", "severe"]));
  if (drug !== capDrug || level !== capLevel) { capDrug = drug; capLevel = level; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
