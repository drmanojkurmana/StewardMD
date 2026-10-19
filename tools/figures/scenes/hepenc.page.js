/* Hepatic encephalopathy scene: gut ammonia, liver urea cycle, shunt, brain astrocyte swelling. */
const layers = { flow: $("flow"), parts: $("parts"), cells: $("cells"), over: $("over"), panel: $("panel"), shuntEl: $("shunt"), scars: $("scars"), glow: $("brainGlow") };
let liverO = null, brainO = null, gutO = null, capEl = null, capDrug = -1, neuronPos = [837, 228], brainBox = [718, 872, 130, 250];
let trToLiver = null, trToJunction = null, trShunt = null, trEscape = null;
let cycX = 430, cycY = 190;
function initOrgans() {
  gutO = organ($("gutSlot"), "bowel", 150, 242, 150, {});
  liverO = organ($("liverSlot"), "liver", 465, 200, 230, {});
  brainO = organ($("brainSlot"), "brain", 800, 195, 190, {});
  const LP = liverO.ports, BP = brainO.ports, GP = gutO.ports;
  const bp = BP.parenchyma;
  neuronPos = [Math.round(bp[0] + 52), Math.round(bp[1] + 44)];
  brainBox = [Math.round(brainO.x - 82), Math.round(brainO.x + 72), Math.round(brainO.y - 65), Math.round(brainO.y + 55)];
  cycX = liverO.x - 0.15 * liverO.w; cycY = liverO.y - 0.05 * liverO.h;
  $("cycle").setAttribute("cx", f1(cycX)); $("cycle").setAttribute("cy", f1(cycY));
  const bo = GP.out, pp = LP.porta, hv = LP.hepvein;
  $("vesselIn").setAttribute("d", "M" + f1(bo[0]) + " " + f1(bo[1]) + " L" + f1(pp[0]) + " " + f1(pp[1]));
  $("ureaOut").setAttribute("d", "M" + f1(pp[0]) + " " + f1(pp[1] + 22) + " L" + f1(pp[0]) + " " + f1(pp[1] + 76));
  $("vesselOut").setAttribute("d", "M" + f1(hv[0]) + " " + f1(hv[1])
    + " C" + f1(hv[0] + 80) + " " + f1(hv[1] - 26) + " " + f1(hv[0] + 130) + " " + f1(hv[1] - 26) + " " + f1(hv[0] + 170) + " " + f1(hv[1] - 12)
    + " C" + f1(hv[0] + 208) + " " + f1(hv[1] + 1) + " " + f1(hv[0] + 238) + " " + f1(hv[1] + 73) + " " + f1(hv[0] + 258) + " " + f1(hv[1] + 129));
  const T = [bo[0] + (pp[0] - bo[0]) * 0.3, bo[1] + (pp[1] - bo[1]) * 0.3];
  layers.shuntEl.setAttribute("d", "M" + f1(T[0]) + " " + f1(T[1]) + " C" + f1(T[0] - 10) + " 200 265 130 330 100"
    + " C360 88 430 90 500 100 C575 88 605 92 630 125 C655 165 680 210 700 236"
    + " C712 238 724 236 " + f1(BP.carotid[0]) + " " + f1(BP.carotid[1]));
  const L2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  trToLiver = track([bo, L2(bo, pp, 0.33), L2(bo, pp, 0.66), pp]);
  trToJunction = track([bo, T]);
  trShunt = track([T, [T[0] - 3, T[1] - 94], [T[0] + 16, T[1] - 162], [T[0] + 38, T[1] - 190],
    [330, 100], [400, 92], [500, 100], [549, 94], [584, 96], [610, 106], [630, 125], [649, 156], [667, 186], [700, 236], BP.carotid]);
  trEscape = track([hv, [hv[0] + 64, hv[1] - 17], [hv[0] + 100, hv[1] - 21], [hv[0] + 151, hv[1] - 18], [hv[0] + 170, hv[1] - 12],
    [hv[0] + 202, hv[1] + 17], [hv[0] + 234, hv[1] + 69], [hv[0] + 258, hv[1] + 129], BP.carotid]);
}
function capText(d) {
  if (d === 1) return "Lactulose traps gut ammonia as ammonium. Less reaches the brain.";
  if (d === 2) return "Rifaximin lowers ammonia making by gut bacteria.";
  if (d === 3) return "Treating the precipitant removes triggers that worsen confusion.";
  return "No treatment. Gut ammonia reaches the brain and astrocytes swell.";
}
/* tracks are built in initOrgans from the bowel, liver and brain ports (see above) */
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, u: 0, tr: null, fate: 0 }; }); }
const nh3 = pool(38, () => mk("path", { class: "sc-p p-nh3", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, layers.parts));
const urea = pool(18, () => mk("circle", { class: "sc-p p-urea", r: 3 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- gut bacteria and protein bits ---- */
const bacs = [];
function initGut() {
  for (let i = 0; i < 12; i++) { const g = cell(layers.cells, { cls: "bac", r: 5.5, seed: i + 3, wob: 0.16 }); bacs.push({ g, x: rnd(95, 205), y: rnd(205, 275), a: rnd(0, 6.28) }); }
  for (let i = 0; i < 10; i++) { const g = mk("g", { class: "cl cl-prot" }, layers.cells); mk("rect", { class: "cl-b", x: -5, y: -2.6, width: 10, height: 5.2, rx: 2 }, g); bacs.push({ g, x: rnd(90, 210), y: rnd(195, 280), a: rnd(0, 6.28), prot: true, rot: rnd(0, 180) }); }
}
/* ---- astrocyte and a neuron in the brain ---- */
let astro = null, neuron = null;
const cycleDots = [];
function initBrain() {
  const g = mk("g", {}, layers.cells);
  for (let j = 0; j < 7; j++) { const t = (j / 7) * 6.28; mk("path", { class: "he-proc", d: "M0 0L" + f1(Math.cos(t) * 34) + " " + f1(Math.sin(t) * 30) }, g); }
  astro = { g, body: cell(g, { cls: "astro", r: 20, nuc: 0.4, seed: 7, wob: 0.1 }) };
  neuron = cell(layers.cells, { cls: "neut", r: 11, nuc: 0.5, seed: 21, wob: 0.12 });
  for (let i = 0; i < 3; i++) cycleDots.push(mk("circle", { class: "sc-p p-urea", r: 3.2 }, layers.parts));
}
/* ---- gauges and labels ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [95, 255, 415, 575, 735];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["made", "Gut ammonia", "g-nh3", "Ammonia made when gut bacteria break down protein from food."], ["urea", "Urea cleared", "g-urea", "Ammonia the liver urea cycle converts to urea, which leaves the body in urine."], ["blood", "Blood ammonia", "g-blood", "Ammonia reaching the general circulation, either through a shunt or past a failing liver."], ["swell", "Swelling", "g-swell", "Astrocytes in the brain take up ammonia and swell. Swollen astrocytes disturb brain signalling."], ["alert", "Alertness", "g-good", "How awake and clear the person is. It falls from confusion toward coma as brain ammonia rises."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Gut", 130, 200, 100, 105, "Gut: protein from food is broken down here by bacteria, releasing ammonia.");
  pill(ox, "Bacteria", 185, 268, 92, 332, "Gut bacteria break down protein and make ammonia. Rifaximin lowers their ammonia making.");
  pill(ox, "Ammonia", 300, 302, 320, 175, "Ammonia: a waste product from protein breakdown. It travels in portal blood to the liver.");
  pill(ox, "Liver", 420, 165, 455, 88, "Liver: normally clears ammonia in the urea cycle. In cirrhosis it is scarred and clears much less.");
  pill(ox, "Urea cycle", 430, 214, 545, 322, "Urea cycle: the liver pathway that turns ammonia into urea, which the kidneys can excrete.");
  pill(ox, "Shunt", 470, 100, 470, 66, "Portosystemic shunt: a bypass channel. Portal blood skips the liver, so ammonia reaches the general circulation uncleared.");
  pill(ox, "Brain", 845, 145, 838, 78, "Brain: ammonia that reaches the brain is taken up by astrocytes and disturbs thinking, from confusion to coma.");
  pill(ox, "Astrocyte", 785, 184, 800, 332, "Astrocyte: a brain support cell. It soaks up ammonia, converts it and swells, which disrupts nearby neurons.");
  capEl = mk("text", { class: "he-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { prod: 0.4, urea: 0.4, blood: 0.2, swell: 0.15, alert: 0.8, shunt: 0.3, lac: 0, rif: 0 };
const acc = { nh3: 0, urea: 0 };
function init() { initOrgans(); initGut(); initBrain(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.prod = lerp(sm.prod, m.prod, k2); sm.urea = lerp(sm.urea, m.urea, k2); sm.blood = lerp(sm.blood, m.blood, k1); sm.swell = lerp(sm.swell, m.swell, k1); sm.alert = lerp(sm.alert, m.alert, k2); sm.shunt = lerp(sm.shunt, m.shunt, k2); sm.lac = lerp(sm.lac, m.lac, k1); sm.rif = lerp(sm.rif, m.rif, k1);
  const shFlow = sm.shunt * (1 - 0.5 * sm.lac);
  layers.shuntEl.setAttribute("opacity", (0.12 + 0.88 * shFlow).toFixed(2));
  layers.shuntEl.setAttribute("stroke-width", f1(4 + 7 * shFlow));
  layers.scars.setAttribute("opacity", (0.15 + 0.85 * (1 - sm.alert) * 0.7 + sm.shunt * 0.2).toFixed(2));
  layers.glow.setAttribute("opacity", (sm.swell * 0.45).toFixed(2));
  /* gut bacteria and protein bits wander inside the gut */
  bacs.forEach((b, i) => { b.a += rnd(-1.2, 1.2) * dt; b.x += Math.cos(b.a) * 9 * dt; b.y += Math.sin(b.a) * 9 * dt; if (b.x < 88 || b.x > 212) b.a = Math.PI - b.a; if (b.y < 192 || b.y > 284) b.a = -b.a; b.x = clamp(b.x, 88, 212); b.y = clamp(b.y, 192, 284);
    const vis = b.prot ? 0.35 + 0.65 * sm.prod : (i / 12 < 1 - 0.55 * sm.rif - 0.35 * sm.lac ? 1 : 0.12);
    place(b.g, b.x, b.y, b.prot ? (b.rot || 0) + tm / 900 : Math.sin(tm / 700 + i) * 20, b.prot ? 0.7 + 0.5 * sm.prod : 1); b.g.style.opacity = vis.toFixed(2); });
  /* urea cycle dots circle inside the liver */
  cycleDots.forEach((d, i) => { const t = tm / 650 + i * 2.1; d.setAttribute("transform", "translate(" + f1(cycX + Math.cos(t) * 24) + " " + f1(cycY + Math.sin(t) * 22) + ")"); d.setAttribute("opacity", (0.25 + 0.75 * clamp(sm.urea + 0.2)).toFixed(2)); });
  /* astrocyte swells, neuron fades */
  const ap = brainO.ports.parenchyma;
  place(astro.g, ap[0] + Math.sin(tm / 1600) * 2, ap[1], Math.sin(tm / 2400) * 4, 1 + 0.6 * sm.swell);
  place(neuron, neuronPos[0], neuronPos[1], Math.sin(tm / 900) * 8, 1); neuron.style.opacity = (0.25 + 0.75 * sm.alert).toFixed(2);
  /* spawn ammonia in the gut */
  acc.nh3 += dt * (1.5 + 9 * sm.prod); while (acc.nh3 >= 1) { acc.nh3--; const p = free(nh3); if (p) { emit(p, rnd(105, 200), rnd(215, 275), rnd(-8, 8), rnd(-8, 8)); p.st = 0; p.e.setAttribute("class", "sc-p p-nh3");
    if (Math.random() < 0.65 * sm.lac) p.fate = 3;
    else { const r = Math.random(), sh = sm.shunt * (1 - 0.5 * sm.lac);
      if (r < sh) p.fate = 1; else if (r < sh + (1 - sh) * clamp(sm.urea / Math.max(0.05, sm.prod))) p.fate = 2; else p.fate = 0; } } }
  nh3.forEach((p) => { if (!p.on) return;
    if (p.st === 0) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 92, 218); p.y = clamp(p.y, 198, 288); place(p.e, p.x, p.y, tm / 6, 1);
      if (p.t > 0.8) { if (p.fate === 3) { p.st = 5; p.e.setAttribute("class", "sc-p p-nh4"); } else if (p.fate === 1) { p.tr = trToJunction; p.u = 0; p.st = 1; } else { p.tr = trToLiver; p.u = 0; p.st = 1; } } }
    else if (p.st === 1 || p.st === 2 || p.st === 3) { p.u += dt * 88 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; place(p.e, p.x, p.y, tm / 6, 1);
      if (p.u >= 1) { if (p.st === 1 && p.fate === 1) { p.tr = trShunt; p.u = 0; p.st = 2; }
        else if (p.st === 1 && p.fate === 2) { kill(p); const u = free(urea); if (u) { emit(u, liverO.ports.porta[0], liverO.ports.porta[1], rnd(-4, 4), 30); } }
        else if (p.st === 1) { p.tr = trEscape; p.u = 0; p.st = 3; }
        else { p.st = 4; p.t = 0; p.vx = rnd(-16, 16); p.vy = rnd(-12, 12); } } }
    else if (p.st === 4) { p.t += dt; p.x += p.vx * dt + Math.sin(tm / 380 + p.y) * 0.25; p.y += p.vy * dt; p.x = clamp(p.x, brainBox[0], brainBox[1]); p.y = clamp(p.y, brainBox[2], brainBox[3]); place(p.e, p.x, p.y, tm / 6, 1); p.e.setAttribute("opacity", clamp(1 - (p.t - 1.8) / 1.2).toFixed(2)); if (p.t > 3) kill(p); }
    else { p.x += p.vx * dt * 0.4; p.y += 34 * dt; place(p.e, p.x, p.y, tm / 6, 1); p.e.setAttribute("opacity", clamp(1 - (p.y - 300) / 55).toFixed(2)); if (p.y > 352) kill(p); } });
  /* urea leaves the liver downward and fades, kept inside the stage */
  urea.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + Math.sin(tm / 420 + p.t * 3) * 6 * dt; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", clamp(1 - (p.y - 315) / 55).toFixed(2)); if (p.y > 368) kill(p); });
  gg.made.set(sm.prod, wordOf(sm.prod, 0.35, 0.68, ["low", "raised", "high"])); gg.urea.set(sm.urea, wordOf(sm.urea, 0.22, 0.5, ["low", "some", "good"])); gg.blood.set(sm.blood, wordOf(sm.blood, 0.28, 0.6, ["low", "raised", "high"]));
  gg.swell.set(sm.swell, wordOf(sm.swell, 0.28, 0.6, ["none", "mild", "marked"])); gg.alert.set(sm.alert, wordOf(sm.alert, 0.35, 0.68, ["coma", "drowsy", "alert"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
