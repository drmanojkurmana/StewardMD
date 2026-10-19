/* Malaria scene: a mosquito bite, the liver stage inside a real liver, the red-cell cycle with rupture bursts, a fever trace and gauges. */
const CY = SC.CY, HH = SC.HH, WW = SC.W;
const L = { mosq: $("mosq"), routes: $("routes"), liver: $("liver"), rbcs: $("rbcs"), parts: $("parts"), over: $("over"), panel: $("panel"), calm: $("calm") };
const TIP = [244, 178], GUT = [110, 150], GLAND = [165, 150];
let liverO = null;
let lobePt = [378, 185], hypPt = [419, 181], doorPt = [419, 228], exitPt = [398, 226];
let trSpz = null, trMer = null, trGam = null;
let capA = null, capB = null, capDrug = -1, capLevel = -1;
let bHyp = null, bBlood = null, bLivD = null;
/* ---- mosquito (abstract): body, wing, proboscis, gut with oocyst, salivary gland ---- */
{
  const g = L.mosq;
  mk("ellipse", { class: "mal-wing", cx: 105, cy: 86, rx: 44, ry: 14, transform: "rotate(-18 105 86)" }, g);
  mk("ellipse", { class: "mal-body", cx: 120, cy: 160, rx: 78, ry: 30 }, g);
  mk("circle", { class: "mal-body", cx: 198, cy: 160, r: 18 }, g);
  mk("path", { class: "mal-prob", d: "M212 166L" + TIP[0] + " " + TIP[1] }, g);
  for (let i = 0; i < 4; i++) mk("path", { class: "mal-leg", d: "M" + (66 + i * 30) + " 188L" + (58 + i * 30) + " 224" }, g);
  mk("ellipse", { class: "mal-gut", cx: GUT[0], cy: GUT[1], rx: 40, ry: 18 }, g);
  mk("ellipse", { class: "mal-gland", cx: GLAND[0], cy: GLAND[1], rx: 18, ry: 11 }, g);
}
const oocyst = mk("circle", { class: "p-spz", cx: GUT[0] + 4, cy: GUT[1], r: 4 }, L.mosq);
const gland = Array.from({ length: 6 }, () => mk("ellipse", { class: "p-spz", rx: 5, ry: 1.7 }, L.mosq));
/* ---- liver organ plus routes anchored on its real ports ---- */
function initOrgans() {
  liverO = organ($("liverSlot"), "liver", 451, 150, 210, {});
  const P = liverO.ports;
  lobePt = P.lobe;
  hypPt = [(P.lobe[0] + P.gall[0]) / 2, (P.lobe[1] + P.gall[1]) / 2];
  doorPt = P.porta;
  exitPt = [(P.lobe[0] + P.porta[0]) / 2, (P.lobe[1] + P.porta[1]) / 2 + 20];
  trSpz = track([TIP, [300, 250], [doorPt[0] - 40, doorPt[1] - 30], doorPt]);
  trMer = track([exitPt, [exitPt[0] + 6, 290], [exitPt[0] + 16, CY - 20]]);
  trGam = track([[180, CY - HH + 4], [160, 230], [GUT[0] + 20, GUT[1] + 20]]);
  mk("path", { class: "mal-route", d: "M" + TIP[0] + " " + TIP[1] + "L300 250L" + f1(doorPt[0] - 40) + " " + f1(doorPt[1] - 30) + "L" + f1(doorPt[0]) + " " + f1(doorPt[1]) }, L.routes);
  mk("path", { class: "mal-route", d: "M" + f1(exitPt[0]) + " " + f1(exitPt[1]) + "L" + f1(exitPt[0] + 6) + " 290L" + f1(exitPt[0] + 16) + " " + (CY - 20) }, L.routes);
  mk("path", { class: "mal-route", d: "M180 " + (CY - HH + 4) + "L160 230L" + (GUT[0] + 20) + " " + (GUT[1] + 20) }, L.routes);
}
/* ---- liver stage actors: growing schizont, dormant hypnozoite, entering sporozoite ---- */
const schizont = mk("g", {}, L.liver), sdots = Array.from({ length: 14 }, () => mk("circle", { class: "p-mer", r: 2.2 }, schizont));
sdots.forEach((d, i) => { const a = i * 2.4, r = 3 + (i % 4) * 5; d.setAttribute("cx", f1(Math.cos(a) * r)); d.setAttribute("cy", f1(Math.sin(a) * r)); });
const hyp = mk("g", {}, L.liver); mk("circle", { class: "p-hyp", r: 5.5 }, hyp); mk("circle", { class: "p-pig", r: 1.6 }, hyp);
const sporoIn = mk("ellipse", { class: "p-spz", rx: 6, ry: 2 }, L.liver);
/* ---- red cells: ring, trophozoite, schizont, gametocyte, rupture, drug melt ---- */
const NR = 22, rb = [];
for (let i = 0; i < NR; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.rbcs); mk("ellipse", { class: "cl-b", rx: 13, ry: 9 }, g); mk("ellipse", { class: "cl-s", rx: 5, ry: 2.6 }, g);
  const par = mk("g", {}, g), ring = mk("circle", { class: "p-par", r: 3.4, cx: -2 }, par), pig = mk("circle", { class: "p-pig", r: 1.6, cx: 3 }, par), dots = Array.from({ length: 7 }, (_, j) => { const d = mk("circle", { class: "p-dot", r: 1.6, cx: f1(Math.cos(j * 0.9) * 5), cy: f1(Math.sin(j * 0.9) * 3.6) }, par); return d; });
  const gam = mk("path", { class: "p-gam", d: "M-8 0Q0 -9 8 0Q0 -3 -8 0Z" }, g);
  rb.push({ g, par, ring, pig, dots, gam, x: (i / NR) * WW, yy: CY, y: rnd(-0.7, 0.7), v: rnd(0.9, 1.1), st: "h", ph: 0, vis: 1, die: 0, stuck: false, rot: rnd(-15, 15) }); }
const mers = Array.from({ length: 36 }, () => { const e = mk("ellipse", { class: "p-mer", rx: 3, ry: 1.7 }, L.parts); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0 }; });
const spz = Array.from({ length: 10 }, () => { const e = mk("ellipse", { class: "p-spz", rx: 6, ry: 1.9 }, L.parts); e.setAttribute("opacity", "0"); return { e, on: false, u: 0 }; });
const drugP = Array.from({ length: 16 }, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-pillm", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pillm2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); g.setAttribute("opacity", "0"); return { e: g, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, kind: 0, stick: 0, seed: rnd(0, 6.28), cell: null }; });
const gams = Array.from({ length: 4 }, () => { const e = mk("path", { class: "p-gam", d: "M-7 0Q0 -8 7 0Q0 -3 -7 0Z" }, L.parts); e.setAttribute("opacity", "0"); return { e, on: false, u: 0 }; });
/* ---- fever panel ---- */
const FP = { x: 668, y: 90, w: 262, h: 140 }, NS_ = 150, temps = new Array(NS_).fill(0);
mk("line", { class: "mal-norm", x1: FP.x, x2: FP.x + FP.w, y1: FP.y + FP.h * 0.72, y2: FP.y + FP.h * 0.72 }, L.over);
const tline = mk("path", { class: "mal-temp" }, L.over);
const fev = mk("text", { class: "dr-pt2", x: FP.x + FP.w, y: FP.y - 6, "text-anchor": "end" }, L.over); fev.textContent = "temperature";
/* ---- rings marking what each drug is doing ---- */
function ringMk(circleCls, withCross) { const g = mk("g", { opacity: "0" }, L.over); mk("circle", { class: circleCls, r: 10, cx: 0, cy: 0 }, g); if (withCross) mk("path", { class: "mal-markx", d: "M-4 -4l8 8M4 -4l-8 8" }, g); return g; }
const ringBlood = ringMk("mal-mark", true), ringHyp = ringMk("mal-mark", true), ringDoor = ringMk("mal-door", false);
/* ---- labels, gauges and the state caption ---- */
const gg = {};
function capText(d, vivax) {
  if (d === 1) return ["Blood drug at work. Parasites in red cells die,", vivax ? "so fever fades. Sleeping forms can return." : "so the bursts and the fever fade away."];
  if (d === 2) return vivax ? ["Liver drug at work. It clears sleeping forms", "and the spreader forms. Blood stage remains."] : ["Liver drug at work. It clears the spreader forms.", "Blood parasites remain."];
  if (d === 3) return ["Preventive drug at work. It blocks the liver stage,", "so few parasites ever reach the blood."];
  if (d === 4) return vivax ? ["Radical cure at work. Blood and sleeping forms", "are cleared together. Fever settles."] : ["Radical cure at work. Blood and spreader forms", "are cleared together. Fever settles."];
  return ["No treatment. Red cells burst in waves,", "and each wave brings a spike of fever."];
}
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [90, 270, 450, 630, 810];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The patient";
  [["pa", "Parasites", "g-bac", "Parasites in the blood. Blood drugs clear them quickly."], ["an", "Anaemia", "g-bad", "Red cells destroyed when infected cells burst, plus cells removed by the spleen."], ["fv", "Fever", "g-neu", "Each synchronised burst releases parasite material and cytokines, causing the periodic fever spike."], ["hy", "Relapse risk", "g-cyt", "Dormant liver forms in vivax can wake later. Blood drugs do not remove them; a liver drug does."], ["sv", "Severity", "g-clot", "Severe falciparum: infected cells stick in small vessels, including in the brain, causing organ damage."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Mosquito bite", TIP[0], TIP[1], 196, 112, "The female Anopheles mosquito injects slender sporozoites with her bite. They travel in the blood to the liver.");
  pill(o, "Liver", 451, 92, 451, 66, "The liver hosts the first stage of the parasite. This stage causes no symptoms.");
  pill(o, "Liver schizont", lobePt[0], lobePt[1], 330, 92, "Inside a liver cell one sporozoite multiplies into a schizont full of merozoites, then the cell bursts and releases them.");
  bHyp = pill(o, "Sleeping liver form", hypPt[0], hypPt[1], 566, 92, "In vivax some liver forms sleep as hypnozoites and can wake weeks later, causing relapse. Only a liver drug removes them.");
  pill(o, "Infected red cell", 640, 360, 640, 432, "Inside the red cell the parasite grows through ring and schizont stages in a repeating cycle. Then the cell bursts.");
  pill(o, "Fever spike", FP.x + 120, FP.y + 20, FP.x + 130, FP.y - 16, "When infected red cells burst together, a wave of parasite material causes a spike of fever, then sweating.");
  bBlood = pill(o, "Blood drug", 150, 378, 150, 300, "Blood drugs kill the parasites growing inside red cells, which stops the bursts and the fever.");
  bLivD = pill(o, "Liver drug", hypPt[0], hypPt[1], 419, 300, "Liver drugs kill sleeping liver forms and the spreader forms. Preventive cover blocks the liver stage.");
  const ct = capText(0, true);
  capA = mk("text", { class: "dr-pt2", x: 600, y: 294 }, o); capA.textContent = ct[0];
  capB = mk("text", { class: "dr-pt2", x: 600, y: 308 }, o); capB.textContent = ct[1];
}
/* ---- state ---- */
const sm = { Pa: 0.4, Hy: 0.8, Gm: 0.5, An: 0.2, F: 0.4, Sv: 0.1, blood: 0, pq: 0, prophy: 0, sev: 0 };
const cyc = { pulse: 0, ls: 0, lt: 0, ht: rnd(4, 8), tick: 0, accS: 0, accG: 0, accP: 0, reinf: 0, acc: 0, fev: 0, relapse: 0 };
function emitMer(x, y, n, sprd) { for (let i = 0; i < n; i++) { const p = mers.find((q) => !q.on); if (!p) return; p.on = true; p.x = x; p.y = y; const a = rnd(0, 6.28), s = rnd(10, sprd || 40); p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s; p.t = 0; p.e.setAttribute("rx", "3"); p.e.setAttribute("ry", "1.7"); p.e.setAttribute("opacity", "1"); } }
function parasitePose(r) { const ph = r.ph; r.ring.style.display = ph < 0.4 ? "" : "none"; r.pig.style.display = ph >= 0.25 ? "" : "none"; r.ring.setAttribute("r", (3 + ph * 7).toFixed(1));
  r.dots.forEach((d, j) => d.style.display = ph > 0.62 && j < Math.round((ph - 0.6) * 20) ? "" : "none"); r.pig.setAttribute("r", (1.4 + ph * 2.2).toFixed(1)); r.gam.style.display = "none"; }
function setState(r, st, ph) { r.st = st; r.ph = ph || 0; r.die = 0; r.par.style.display = st === "i" ? "" : "none"; r.gam.style.display = st === "g" ? "" : "none"; if (st === "i") parasitePose(r); if (st !== "i") r.stuck = false; }
function seedInfection() { let k = 0; rb.forEach((r) => { if (k < Math.round(sm.Pa * 11) && r.vis > 0.5 && r.st === "h") { setState(r, "i", rnd(0.35, 0.55)); k++; } }); }
function nearestCell(x, y, st) { let best = null, bd = 1e12; for (const r of rb) { if (r.st !== st || r.vis < 0.5) continue; const d = (r.x - x) * (r.x - x) + (r.yy - y) * (r.yy - y); if (d < bd) { bd = d; best = r; } } return best; }
function init() { initOrgans(); initPanel(); rb.forEach((r) => setState(r, "h", 0)); seedInfection(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9);
  ["Pa", "Hy", "Gm", "An", "F", "Sv"].forEach((k) => sm[k] = lerp(sm[k], m[k], Math.min(1, dt * (k === "Pa" ? 0.5 : 0.4))));
  sm.blood = lerp(sm.blood, m.blood, k1); sm.pq = lerp(sm.pq, m.pq, k1); sm.prophy = lerp(sm.prophy, m.prophy, k1); sm.sev = lerp(sm.sev, SC_isSevere() ? 1 : 0, k1);
  const vivax = level === 0;
  L.calm.setAttribute("opacity", (sm.blood * 0.5).toFixed(2));
  /* red cells */
  const visN = Math.round(NR * (1 - 0.55 * sm.An)), target = Math.round(sm.Pa * 11) + (cyc.relapse > 0 ? 2 : 0), gamTarget = Math.round(sm.Gm * 4);
  let inf = rb.filter((r) => r.st === "i").length, gamN = rb.filter((r) => r.st === "g").length;
  rb.forEach((r) => { r.vis = lerp(r.vis, r.st === "d" ? 1 : (r.st === "i" || rb.indexOf(r) < visN ? 1 : 0), Math.min(1, dt * 1.5)); });
  rb.forEach((r) => {
    if (r.st === "i") { r.ph += dt / 6.2;
      if (sm.sev > 0.5 && r.ph > 0.5 && r.ph < 0.96 && !r.stuck && Math.random() < dt * 0.9 && rb.filter((q) => q.stuck).length < 5) { r.stuck = true; }
      if (r.ph >= 1) { emitMer(r.x, r.yy, sm.blood > 0.5 ? 2 : 6, 46); cyc.pulse = 1; setState(r, "h", 0); r.die = 0.6; inf--; if (inf < target && sm.blood < 0.5) cyc.reinf += 2; }
      else parasitePose(r);
      if (r.stuck && sm.blood > 0.5 && Math.random() < dt * 2) { r.stuck = false; r.st = "d"; r.die = 1; inf--; }
      else if (inf > target && sm.Pa < 0.3 && Math.random() < dt * (0.35 + 1.6 * sm.blood)) { r.st = "d"; r.die = 1; inf--; } }
    else if (r.st === "d") { r.die -= dt * 0.8; r.par.style.opacity = clamp(r.die); if (r.die <= 0) { setState(r, "h", 0); r.par.style.opacity = 1; } }
    else if (r.st === "g" && ((gamN > gamTarget && Math.random() < dt * 0.6) || (sm.pq > 0.5 && Math.random() < dt * 1.2))) { setState(r, "h", 0); gamN--; }
    else if (r.st === "h" && gamN < gamTarget && r.vis > 0.9 && Math.random() < dt * 0.25) { setState(r, "g", 0); gamN++; }
  });
  while (cyc.reinf > 0 && inf < target) { cyc.reinf--; const c = rb.filter((r) => r.st === "h" && r.vis > 0.8); if (!c.length) break; setState(pick(c), "i", 0); inf++; }
  cyc.reinf = 0;
  cyc.tick += dt; if (cyc.tick > 1.8 && inf < target && sm.blood < 0.5) { cyc.tick = 0; const c = rb.filter((r) => r.st === "h" && r.vis > 0.8); if (c.length) { setState(pick(c), "i", rnd(0, 0.3)); inf++; } }
  rb.forEach((r) => { if (!r.stuck) r.x += r.v * 62 * dt; if (r.x > WW + 16) { r.x = -16; if (r.st !== "i") r.y = rnd(-0.7, 0.7); }
    r.yy = r.stuck ? CY - HH + 14 : CY + r.y * (HH - 14);
    const melt = r.st === "d" ? 0.3 + 0.7 * clamp(r.die) : 1;
    place(r.g, r.x, r.yy, r.stuck ? 0 : r.rot + Math.sin(tm / 600 + r.x) * 8, (0.35 + 0.65 * r.vis) * melt); r.g.style.opacity = r.vis > 0.04 ? 1 : 0; });
  /* merozoites wander, shrink and fade fast under a blood drug */
  const merLife = sm.blood > 0.5 ? 0.7 : 1.4;
  mers.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + 22 * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy *= 0.97;
    const sh = 1 - 0.65 * sm.blood * Math.min(1, p.t * 2); p.e.setAttribute("rx", (3 * sh).toFixed(2)); p.e.setAttribute("ry", (1.7 * sh).toFixed(2));
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 160) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / merLife).toFixed(2)); if (p.t > merLife) { p.on = false; p.e.setAttribute("opacity", "0"); } });
  /* mosquito: oocyst grows and bursts, gland sporozoites wiggle, sporozoites are injected */
  const og = (tm / 9000) % 1; oocyst.setAttribute("r", (3 + og * 9).toFixed(1)); oocyst.setAttribute("opacity", og > 0.96 ? "0" : "1");
  gland.forEach((e, i) => { const a = i * 0.9 + tm / 700; e.setAttribute("cx", f1(GLAND[0] + Math.cos(a) * 9)); e.setAttribute("cy", f1(GLAND[1] + Math.sin(a * 1.3) * 5)); e.setAttribute("transform", "rotate(" + f1(a * 60) + " " + f1(GLAND[0] + Math.cos(a) * 9) + " " + f1(GLAND[1] + Math.sin(a * 1.3) * 5) + ")"); });
  cyc.accS += dt * 0.3; while (cyc.accS >= 1) { cyc.accS--; const p = spz.find((q) => !q.on); if (p) { p.on = true; p.u = 0; p.e.setAttribute("opacity", "1"); } }
  spz.forEach((p) => { if (!p.on) return; p.u += dt * 0.16; const q = trSpz.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(q.a) + ")");
    if (sm.prophy > 0.5 && p.u > 0.55) p.e.setAttribute("opacity", clamp(1 - (p.u - 0.55) / 0.2).toFixed(2));
    if (p.u >= 1) { p.on = false; p.e.setAttribute("opacity", "0"); if (sm.prophy < 0.5) { cyc.ls = 1; cyc.lt = 0; } } });
  /* gametocytes are taken up by the mosquito */
  cyc.accG += dt * sm.Gm * 0.7; while (cyc.accG >= 1) { cyc.accG--; const p = gams.find((q) => !q.on); if (p) { p.on = true; p.u = 0; p.e.setAttribute("opacity", "1"); } }
  gams.forEach((p) => { if (!p.on) return; p.u += dt * 0.18; const q = trGam.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(q.a) + ")"); if (p.u >= 1) { p.on = false; p.e.setAttribute("opacity", "0"); } });
  /* liver stage: sporozoite enters, schizont grows, bursts unless prevention arrests it */
  if (cyc.ls === 0 && cyc.lt > 6 && sm.prophy < 0.5) { cyc.ls = 1; cyc.lt = 0; }
  cyc.lt += dt;
  let sc = 0;
  if (cyc.ls === 1) { sc = clamp(cyc.lt / 8);
    if (cyc.lt > 9) { cyc.ls = 2; cyc.lt = 0;
      if (sm.prophy < 0.5) { emitMer(lobePt[0], lobePt[1], 12, 50);
        for (let kk = 0; kk < 6; kk++) { const p = mers.find((q) => !q.on); if (p) { p.on = true; p.x = exitPt[0]; p.y = exitPt[1]; p.vx = rnd(-6, 12); p.vy = rnd(40, 70); p.t = 0; p.e.setAttribute("opacity", "1"); } } } } }
  else if (cyc.ls === 2 && cyc.lt > 3) { cyc.ls = 0; cyc.lt = 0; }
  schizont.style.display = cyc.ls === 1 ? "" : "none";
  place(schizont, lobePt[0], lobePt[1], 0, (0.3 + 0.7 * sc) * (1 - 0.8 * sm.prophy));
  sdots.forEach((d, i) => d.style.display = i < Math.round(sc * 14) ? "" : "none");
  sporoIn.setAttribute("opacity", cyc.ls === 1 && cyc.lt < 1.2 ? "1" : "0");
  sporoIn.setAttribute("transform", "translate(" + f1(doorPt[0] - 30 + cyc.lt * 30) + " " + f1(doorPt[1] - 20 + cyc.lt * 20) + ") rotate(40)");
  hyp.style.display = sm.Hy > 0.04 ? "" : "none"; place(hyp, hypPt[0], hypPt[1], 0, 0.4 + 0.9 * clamp(sm.Hy));
  cyc.ht -= dt * (sm.Hy > 0.3 ? 1 : 0); if (cyc.ht < 0 && sm.Hy > 0.3) { cyc.ht = rnd(14, 20); cyc.relapse = 5; emitMer(hypPt[0], hypPt[1], 8, 50); }
  if (cyc.relapse > 0) cyc.relapse -= dt;
  /* drug particles: blood drug hunts infected cells, liver drug parks on the sleeper, prevention guards the liver door */
  cyc.accP += dt * (sm.blood * 3 + sm.pq * 1.6 + sm.prophy * 2);
  while (cyc.accP >= 1) { cyc.accP--; const p = drugP.find((q) => !q.on); if (!p) break;
    const elig = [];
    if (sm.blood > 0.3) elig.push(0, 0, 0);
    if (sm.pq > 0.3) elig.push(1);
    if (sm.prophy > 0.3) elig.push(2, 2);
    if (!elig.length) break;
    p.kind = pick(elig); p.on = true; p.t = 0; p.stick = 0; p.cell = null; p.vx = 0; p.vy = 0;
    if (p.kind === 0) { p.x = rnd(30, 200); p.y = CY + rnd(-30, 30); p.cell = nearestCell(p.x, p.y, "i"); }
    else if (p.kind === 1) { p.x = rnd(340, 400); p.y = rnd(100, 130); if (sm.Hy < 0.04) p.cell = nearestCell(p.x, p.y, "g"); }
    else { p.x = doorPt[0] + rnd(-40, 40); p.y = doorPt[1] + rnd(-50, -20); }
    p.e.setAttribute("opacity", "1"); }
  drugP.forEach((p) => {
    if (!p.on) return;
    p.t += dt;
    if (p.stick > 0) { p.stick -= dt;
      if (p.kind === 0 && p.cell) { p.x = p.cell.x; p.y = p.cell.yy - 14; }
      else if (p.kind === 1 && !p.cell) { p.x = hypPt[0]; p.y = hypPt[1] - 16; }
      else if (p.kind === 1 && p.cell) { p.x = p.cell.x; p.y = p.cell.yy - 14; }
      else { const a = tm / 500 + p.seed; p.x = doorPt[0] + Math.cos(a) * 16; p.y = doorPt[1] + Math.sin(a) * 12; }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 40) + ")");
      if (p.stick <= 0) { p.on = false; p.e.setAttribute("opacity", "0"); }
      return; }
    let tx = p.x + 40, ty = p.y;
    if (p.kind === 0) { if (!p.cell || p.cell.st !== "i") p.cell = nearestCell(p.x, p.y, "i"); if (p.cell) { tx = p.cell.x; ty = p.cell.yy - 12; } }
    else if (p.kind === 1) { if (p.cell && p.cell.st !== "g") p.cell = null; if (p.cell) { tx = p.cell.x; ty = p.cell.yy - 12; } else if (sm.Hy > 0.04) { tx = hypPt[0]; ty = hypPt[1] - 14; } else { tx = p.x + 40; ty = CY + rnd(-30, 30); } }
    else { tx = doorPt[0]; ty = doorPt[1] - 10; }
    const dx = tx - p.x, dy = ty - p.y, dd = Math.hypot(dx, dy) || 1, sp = 110, kk = Math.min(1, dt * 4);
    p.vx = lerp(p.vx, dx / dd * sp, kk); p.vy = lerp(p.vy, dy / dd * sp, kk);
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")");
    if (dd < 9) { p.stick = 1.1;
      if (p.kind === 0 && p.cell && p.cell.st === "i") { p.cell.st = "d"; p.cell.die = 1; }
      if (p.kind === 1 && p.cell && p.cell.st === "g") { p.cell.st = "d"; p.cell.die = 1; } }
    if (p.t > 7) { p.on = false; p.e.setAttribute("opacity", "0"); } });
  /* rings follow what the drugs are doing */
  const fi = rb.find((r) => r.st === "i" && r.vis > 0.3);
  if (fi && sm.blood > 0.05) { ringBlood.setAttribute("transform", "translate(" + f1(fi.x) + " " + f1(fi.yy) + ")"); ringBlood.setAttribute("opacity", sm.blood.toFixed(2)); }
  else ringBlood.setAttribute("opacity", "0");
  ringHyp.setAttribute("transform", "translate(" + f1(hypPt[0]) + " " + f1(hypPt[1]) + ")");
  ringHyp.setAttribute("opacity", (sm.pq * (sm.Hy > 0.04 ? 1 : 0)).toFixed(2));
  ringDoor.setAttribute("transform", "translate(" + f1(doorPt[0]) + " " + f1(doorPt[1]) + ")");
  ringDoor.setAttribute("opacity", sm.prophy.toFixed(2));
  bBlood.style.opacity = sm.blood.toFixed(2);
  bLivD.style.opacity = Math.max(sm.pq, sm.prophy).toFixed(2);
  bHyp.style.display = vivax ? "" : "none";
  /* fever trace */
  cyc.pulse = Math.max(0, cyc.pulse - dt * 0.5);
  cyc.fev = (cyc.fev || 0) + (cyc.pulse * sm.F * 1.2 - (cyc.fev || 0)) * Math.min(1, dt * 3);
  cyc.acc = (cyc.acc || 0) + dt; if (cyc.acc > 0.06) { cyc.acc = 0; const nSh = sm.F < 0.35 ? 2 : 1; for (let s = 0; s < nSh; s++) { temps.push(0.08 + 0.92 * clamp(cyc.fev)); temps.shift(); } let d = ""; temps.forEach((v, i) => { d += (i ? "L" : "M") + f1(FP.x + (i / (NS_ - 1)) * FP.w) + " " + f1(FP.y + FP.h - v * FP.h * 0.9 - 6); }); tline.setAttribute("d", d); }
  gg.pa.set(sm.Pa, wordOf(sm.Pa, 0.15, 0.55, ["cleared", "moderate", "heavy"])); gg.an.set(sm.An, wordOf(sm.An, 0.25, 0.55, ["mild", "moderate", "marked"])); gg.fv.set(sm.F, wordOf(sm.F, 0.25, 0.7, ["none", "periodic", "high"]));
  gg.hy.set(sm.Hy, wordOf(sm.Hy, 0.05, 0.4, ["none", "low", "high"])); gg.sv.set(sm.Sv, wordOf(sm.Sv, 0.2, 0.55, ["low", "raised", "severe"]));
  if (drug !== capDrug || level !== capLevel) { capDrug = drug; capLevel = level; const t = capText(drug, vivax); if (capA.textContent !== t[0]) capA.textContent = t[0]; if (capB.textContent !== t[1]) capB.textContent = t[1]; }
}
function SC_isSevere() { return level === 2; }
run({ init, step });
