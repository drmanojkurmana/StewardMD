/* Malaria scene: mosquito, sporozoites, liver stage (and hypnozoites), the red-cell cycle with synchronised rupture, fever trace and gauges. */
const CY = SC.CY, HH = SC.HH, WW = SC.W;
const L = { mosq: $("mosq"), routes: $("routes"), liver: $("liver"), rbcs: $("rbcs"), parts: $("parts"), over: $("over"), panel: $("panel") };
/* ---- mosquito (abstract): body, wing, proboscis, gut with oocyst, salivary gland ---- */
const GLAND = [212, 150], GUT = [120, 150], TIP = [292, 168];
{
  const g = L.mosq;
  mk("ellipse", { class: "mal-wing", cx: 112, cy: 100, rx: 56, ry: 18, transform: "rotate(-18 112 100)" }, g);
  mk("ellipse", { class: "mal-body", cx: 130, cy: 160, rx: 108, ry: 38 }, g);
  mk("circle", { class: "mal-body", cx: 236, cy: 160, r: 24 }, g);
  mk("path", { class: "mal-route", d: "M254 164L" + TIP[0] + " " + TIP[1], style: "stroke-dasharray:none;opacity:1;stroke-width:2.4;stroke:var(--anatomy-strong)" }, g);
  for (let i = 0; i < 4; i++) mk("path", { class: "mal-leg", d: "M" + (70 + i * 34) + " 196L" + (60 + i * 34) + " 232", style: "fill:none;stroke:var(--anatomy-mid);stroke-width:1.6" }, g);
  mk("ellipse", { class: "mal-gut", cx: GUT[0], cy: GUT[1], rx: 52, ry: 24 }, g);
  mk("ellipse", { class: "mal-gland", cx: GLAND[0], cy: GLAND[1], rx: 24, ry: 15 }, g);
}
const oocyst = mk("circle", { class: "p-spz", cx: GUT[0] + 4, cy: GUT[1], r: 4 }, L.mosq);
const gland = Array.from({ length: 7 }, (_, i) => mk("ellipse", { class: "p-spz", rx: 5, ry: 1.7 }, L.mosq));
/* ---- routes: mosquito to liver, liver to blood, blood to mosquito ---- */
const ROUTE_SPZ = track([[TIP[0], TIP[1]], [298, 250], [330, CY - HH - 6], [400, CY - HH - 10], [400, 196]]);
const ROUTE_MER = track([[420, 196], [420, CY - HH - 4], [430, CY - 16]]);
const ROUTE_GAM = track([[180, CY - HH + 4], [160, 230], [GUT[0] + 20, GUT[1] + 20]]);
mk("path", { class: "mal-route", d: "M" + TIP[0] + " " + TIP[1] + "L298 250L330 " + (CY - HH - 6) + "L400 " + (CY - HH - 10) + "L400 196" }, L.routes);
mk("path", { class: "mal-route", d: "M180 " + (CY - HH + 4) + "L160 230L" + (GUT[0] + 20) + " " + (GUT[1] + 20) }, L.routes);
/* ---- liver: four liver cells; one hosts the schizont, one holds a hypnozoite ---- */
const HEP = [[392, 156], [486, 200], [560, 142], [604, 214]].map(([x, y], i) => { const g = mk("g", {}, L.liver); cell(g, { cls: "hep", r: 33, nuc: 0.3, seed: i * 3 + 1, wob: 0.07 }); place(g, x, y); return { x, y, g }; });
const schizont = mk("g", {}, L.liver), sdots = Array.from({ length: 14 }, () => mk("circle", { class: "p-mer", r: 2.2 }, schizont));
sdots.forEach((d, i) => { const a = i * 2.4, r = 3 + (i % 4) * 5; d.setAttribute("cx", f1(Math.cos(a) * r)); d.setAttribute("cy", f1(Math.sin(a) * r)); });
const hyp = mk("g", {}, L.liver); mk("circle", { class: "p-hyp", r: 5.5 }, hyp); mk("circle", { class: "p-pig", r: 1.6 }, hyp); place(hyp, HEP[2].x + 8, HEP[2].y + 4);
const sporoIn = mk("ellipse", { class: "p-spz", rx: 6, ry: 2 }, L.liver);
/* ---- red cells: ring, trophozoite, schizont, gametocyte, rupture ---- */
const NR = 22, rb = [];
for (let i = 0; i < NR; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.rbcs); mk("ellipse", { class: "cl-b", rx: 13, ry: 9 }, g); mk("ellipse", { class: "cl-s", rx: 5, ry: 2.6 }, g);
  const par = mk("g", {}, g), ring = mk("circle", { class: "p-par", r: 3.4, cx: -2 }, par), pig = mk("circle", { class: "p-pig", r: 1.6, cx: 3 }, par), dots = Array.from({ length: 7 }, (_, j) => { const d = mk("circle", { class: "p-dot", r: 1.6, cx: f1(Math.cos(j * 0.9) * 5), cy: f1(Math.sin(j * 0.9) * 3.6) }, par); return d; });
  const gam = mk("path", { class: "p-gam", d: "M-8 0Q0 -9 8 0Q0 -3 -8 0Z" }, g);
  rb.push({ g, par, ring, pig, dots, gam, x: (i / NR) * WW, y: rnd(-0.7, 0.7), v: rnd(0.9, 1.1), st: "h", ph: 0, vis: 1, die: 0, stuck: false, rot: rnd(-15, 15) }); }
const mers = Array.from({ length: 40 }, () => { const e = mk("ellipse", { class: "p-mer", rx: 3, ry: 1.7 }, L.parts); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0 }; });
const spz = Array.from({ length: 10 }, () => { const e = mk("ellipse", { class: "p-spz", rx: 6, ry: 1.9 }, L.parts); e.setAttribute("opacity", "0"); return { e, on: false, u: 0, kind: 0 }; });
const pillsB = Array.from({ length: 12 }, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-pillm", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pillm2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); g.setAttribute("opacity", "0"); return { e: g, on: false, x: 0, y: 0, t: 0, k: 0 }; });
const gams = Array.from({ length: 4 }, () => { const e = mk("path", { class: "p-gam", d: "M-7 0Q0 -8 7 0Q0 -3 -7 0Z" }, L.parts); e.setAttribute("opacity", "0"); return { e, on: false, u: 0 }; });
/* ---- fever panel ---- */
const FP = { x: 668, y: 90, w: 262, h: 140 }, NS_ = 150, temps = new Array(NS_).fill(0);
mk("line", { class: "mal-norm", x1: FP.x, x2: FP.x + FP.w, y1: FP.y + FP.h * 0.72, y2: FP.y + FP.h * 0.72 }, L.over);
const tline = mk("path", { class: "mal-temp" }, L.over);
const fev = mk("text", { class: "dr-pt2", x: FP.x + FP.w, y: FP.y - 6, "text-anchor": "end" }, L.over); fev.textContent = "temperature";
/* ---- marks for drug targets ---- */
function mark(x, y) { const g = mk("g", { opacity: "0" }, L.over); mk("circle", { class: "mal-mark", r: 8, cx: x, cy: y }, g); mk("path", { class: "mal-markx", d: "M" + (x - 3.5) + " " + (y - 3.5) + "l7 7M" + (x + 3.5) + " " + (y - 3.5) + "l-7 7" }, g); return g; }
const mkBlood = mark(300, CY + HH - 14), mkHyp = mark(HEP[2].x + 8, HEP[2].y - 20), mkGam = mark(180, CY - HH - 14);
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [90, 270, 450, 630, 810];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The patient";
  [["pa", "Parasites", "g-bac", "Parasites in the blood. Blood schizonticides clear them quickly."], ["an", "Anaemia", "g-bad", "Red cells destroyed when infected cells burst, plus cells removed by the spleen."], ["fv", "Fever", "g-neu", "Each synchronised burst releases parasite material and cytokines, causing the periodic fever paroxysm."], ["hy", "Relapse risk", "g-cyt", "Dormant liver hypnozoites in vivax and ovale can reactivate later. Blood schizonticides do not remove them; a primaquine-type drug does."], ["sv", "Severity", "g-clot", "Severe falciparum: infected cells stick in small vessels (sequestration), including in the brain, causing cerebral malaria, anaemia and organ damage."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Anopheles mosquito", 130, 146, 128, 100, "The female Anopheles mosquito passes the parasite between people when she takes a blood meal.");
  pill(o, "Sporozoites", 292, 168, 258, 214, "Slender sporozoites in the saliva are injected into the skin. They travel in the blood to the liver within minutes.");
  pill(o, "Salivary gland", GLAND[0], GLAND[1], 218, 118, "Sporozoites collect in the salivary glands, ready for the next bite.");
  pill(o, "Liver cell", HEP[1].x, HEP[1].y + 28, 480, 244, "A liver cell (hepatocyte) hosts the first stage of the parasite. This stage causes no symptoms.");
  pill(o, "Liver schizont", HEP[0].x, HEP[0].y - 26, 392, 96, "Inside the liver cell one sporozoite multiplies into thousands of merozoites, then the cell bursts and releases them into the blood.");
  pill(o, "Hypnozoite", HEP[2].x + 8, HEP[2].y + 4, 590, 96, "In P. vivax and P. ovale some liver forms stay dormant as hypnozoites and can wake weeks or months later, causing relapse. Only a primaquine-type drug removes them.");
  pill(o, "Merozoites", 428, CY - HH - 4, 500, 300, "Merozoites leave the liver and invade red cells.");
  pill(o, "Infected red cell", 700, CY - 4, 700, CY + HH + 14, "Inside the red cell the parasite goes through ring, trophozoite and schizont stages, about every two days. Then the cell bursts.");
  pill(o, "Gametocyte", 140, CY - HH + 6, 110, 300, "Some parasites become gametocytes. A mosquito that takes them up starts the sexual cycle. Primaquine-type drugs reduce them.");
  pill(o, "Fever paroxysm", FP.x + 120, FP.y + 20, FP.x + 130, FP.y - 16, "When infected red cells burst together, a wave of parasite material and cytokines causes a spike of fever, then sweating.");
  const sq = pill(o, "Sequestration", 860, CY - HH + 6, 868, CY - HH - 22, "In severe falciparum malaria, infected red cells stick to the lining of small vessels and block them, including in the brain."); sq.setAttribute("id", "sq-pill");
  const b1 = pill(o, "Blood schizonticide", 300, CY + HH - 14, 340, CY + HH + 14, "Blood schizonticides kill the parasites growing inside red cells, which stops the fever."); b1.setAttribute("id", "bl-pill");
  const b2 = pill(o, "Primaquine-type", HEP[2].x + 8, HEP[2].y - 20, 570, 232, "A primaquine-type drug kills dormant liver hypnozoites and the gametocytes."); b2.setAttribute("id", "pq-pill");
}
/* ---- state ---- */
const sm = { Pa: 0.4, Hy: 0.8, Gm: 0.5, An: 0.2, F: 0.4, Sv: 0.1, blood: 0, pq: 0, prophy: 0, sev: 0, fresh: 0 };
const cyc = { pulse: 0, relapse: 0, ls: 0, lt: 0, hs: 0, ht: rnd(4, 8), tick: 0, accS: 0, accG: 0, accP: 0, reinf: 0 };
function emitMer(x, y, n, sprd) { for (let i = 0; i < n; i++) { const p = mers.find((q) => !q.on); if (!p) return; p.on = true; p.x = x; p.y = y; const a = rnd(0, 6.28), s = rnd(10, sprd || 40); p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s; p.t = 0; p.e.setAttribute("opacity", "1"); } }
function parasitePose(r) { const ph = r.ph; r.ring.style.display = ph < 0.4 ? "" : "none"; r.pig.style.display = ph >= 0.25 ? "" : "none"; r.ring.setAttribute("r", (3 + ph * 7).toFixed(1));
  r.dots.forEach((d, j) => d.style.display = ph > 0.62 && j < Math.round((ph - 0.6) * 20) ? "" : "none"); r.pig.setAttribute("r", (1.4 + ph * 2.2).toFixed(1)); r.gam.style.display = "none"; }
function setState(r, st, ph) { r.st = st; r.ph = ph || 0; r.die = 0; r.par.style.display = st === "i" ? "" : "none"; r.gam.style.display = st === "g" ? "" : "none"; if (st === "i") parasitePose(r); if (st !== "i") r.stuck = false; }
function seedInfection() { let k = 0; rb.forEach((r) => { if (k < Math.round(sm.Pa * 11) && r.vis > 0.5 && r.st === "h") { setState(r, "i", rnd(0.35, 0.55)); k++; } }); }
function init() { initPanel(); rb.forEach((r) => setState(r, "h", 0)); seedInfection(); gland.forEach((e, i) => { e.dataset.i = i; }); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9);
  ["Pa", "Hy", "Gm", "An", "F", "Sv"].forEach((k) => sm[k] = lerp(sm[k], m[k], Math.min(1, dt * (k === "Pa" ? 0.5 : 0.4))));
  sm.blood = lerp(sm.blood, m.blood, k1); sm.pq = lerp(sm.pq, m.pq, k1); sm.prophy = lerp(sm.prophy, m.prophy, k1); sm.sev = lerp(sm.sev, SC_isSevere() ? 1 : 0, k1);
  const flow = 1;
  /* red cells */
  const visN = Math.round(NR * (1 - 0.55 * sm.An)), target = Math.round(sm.Pa * 11) + (cyc.relapse > 0 ? 2 : 0), gamTarget = Math.round(sm.Gm * 4);
  let inf = rb.filter((r) => r.st === "i").length, gamN = rb.filter((r) => r.st === "g").length;
  rb.forEach((r, i) => { r.vis = lerp(r.vis, i < visN || r.st === "i" ? 1 : 0, Math.min(1, dt * 1.5)); });
  rb.forEach((r) => {
    if (r.st === "i") { r.ph += dt / 6.2 * (r.stuck ? 1 : 1);
      if (sm.sev > 0.5 && r.ph > 0.5 && r.ph < 0.96 && !r.stuck && Math.random() < dt * 0.9 && rb.filter((q) => q.stuck).length < 5) { r.stuck = true; r.y = -0.9; }
      if (r.ph >= 1) { /* rupture: merozoites, fever pulse */ emitMer(r.x, CY + r.y * (HH - 14), 6, 46); cyc.pulse = 1; setState(r, "h", 0); r.die = 0.6; inf--; if (inf < target) cyc.reinf += 2; }
      else parasitePose(r);
      if (inf > target + 0 && sm.Pa < 0.3 && Math.random() < dt * (0.35 + 1.6 * sm.blood)) { r.st = "d"; r.die = 1; inf--; } }
    else if (r.st === "d") { r.die -= dt * 0.8; r.par.style.opacity = clamp(r.die); if (r.die <= 0) { setState(r, "h", 0); r.par.style.opacity = 1; } }
    else if (r.st === "g" && gamN > gamTarget && Math.random() < dt * 0.6) { setState(r, "h", 0); gamN--; }
    else if (r.st === "h" && gamN < gamTarget && r.vis > 0.9 && Math.random() < dt * 0.25) { setState(r, "g", 0); gamN++; }
  });
  /* reinvade: after bursts, merozoites take new cells while the infection is below target */
  while (cyc.reinf > 0 && inf < target) { cyc.reinf--; const c = rb.filter((r) => r.st === "h" && r.vis > 0.8); if (!c.length) break; setState(pick(c), "i", 0); inf++; }
  cyc.reinf = 0;
  cyc.tick += dt; if (cyc.tick > 1.8 && inf < target) { cyc.tick = 0; const c = rb.filter((r) => r.st === "h" && r.vis > 0.8); if (c.length) { setState(pick(c), "i", rnd(0, 0.3)); inf++; } }
  rb.forEach((r) => { if (!r.stuck) r.x += r.v * 62 * flow * dt; if (r.x > WW + 16) { r.x = -16; if (r.st !== "i") r.y = rnd(-0.7, 0.7); }
    const yy = r.stuck ? CY - HH + 14 : CY + r.y * (HH - 14); place(r.g, r.x, yy, r.stuck ? 0 : r.rot + Math.sin(tm / 600 + r.x) * 8, 0.35 + 0.65 * r.vis); r.g.style.opacity = r.vis > 0.04 ? 1 : 0; });
  /* merozoites wander and fade */
  mers.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + 22 * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy *= 0.97; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 160) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 0.7) / 0.7).toFixed(2)); if (p.t > 1.4) { p.on = false; p.e.setAttribute("opacity", "0"); } });
  /* mosquito: oocyst grows and bursts, gland sporozoites wiggle, sporozoites are injected */
  const og = (tm / 9000) % 1; oocyst.setAttribute("r", (3 + og * 9).toFixed(1)); oocyst.setAttribute("opacity", og > 0.96 ? "0" : "1");
  gland.forEach((e, i) => { const a = i * 0.9 + tm / 700; e.setAttribute("cx", f1(GLAND[0] + Math.cos(a) * 11)); e.setAttribute("cy", f1(GLAND[1] + Math.sin(a * 1.3) * 6)); e.setAttribute("transform", "rotate(" + f1(a * 60) + " " + f1(GLAND[0] + Math.cos(a) * 11) + " " + f1(GLAND[1] + Math.sin(a * 1.3) * 6) + ")"); });
  cyc.accS += dt * 0.3; while (cyc.accS >= 1) { cyc.accS--; const p = spz.find((q) => !q.on); if (p) { p.on = true; p.u = 0; p.e.setAttribute("opacity", "1"); } }
  spz.forEach((p) => { if (!p.on) return; p.u += dt * 0.16; const q = ROUTE_SPZ.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(q.a) + ")"); if (p.u >= 1) { p.on = false; p.e.setAttribute("opacity", "0"); cyc.ls = 1; cyc.lt = 0; } });
  /* gametocytes are taken up by the mosquito */
  cyc.accG += dt * sm.Gm * 0.7; while (cyc.accG >= 1) { cyc.accG--; const p = gams.find((q) => !q.on); if (p) { p.on = true; p.u = 0; p.e.setAttribute("opacity", "1"); } }
  gams.forEach((p) => { if (!p.on) return; p.u += dt * 0.18; const q = ROUTE_GAM.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(q.a) + ")"); if (p.u >= 1) { p.on = false; p.e.setAttribute("opacity", "0"); } });
  /* liver stage: sporozoite enters, schizont grows, bursts; hypnozoite wakes now and then */
  const H0 = HEP[0], H2 = HEP[2];
  if (cyc.ls === 0 && cyc.lt > 6) { cyc.ls = 1; cyc.lt = 0; }
  cyc.lt += dt;
  let sc = 0; if (cyc.ls === 1) { sc = clamp(cyc.lt / 8); if (cyc.lt > 9) { cyc.ls = 2; cyc.lt = 0; emitMer(H0.x, H0.y, 12, 50); /* merozoites leave toward the blood */ for (let k = 0; k < 6; k++) { const p = mers.find((q) => !q.on); if (p) { p.on = true; p.x = H0.x + 20; p.y = H0.y + 10; p.vx = rnd(-6, 12); p.vy = rnd(40, 70); p.t = 0; p.e.setAttribute("opacity", "1"); } } } }
  else if (cyc.ls === 2 && cyc.lt > 3) { cyc.ls = 0; cyc.lt = 0; }
  const killLiver = sm.prophy > 0.5 ? 1 : 0; schizont.style.display = cyc.ls === 1 ? "" : "none"; place(schizont, H0.x, H0.y, 0, (0.3 + 0.7 * sc) * (1 - 0.7 * killLiver * sc)); sdots.forEach((d, i) => d.style.display = i < Math.round(sc * 14) ? "" : "none");
  sporoIn.setAttribute("opacity", cyc.ls === 1 && cyc.lt < 1.2 ? "1" : "0"); sporoIn.setAttribute("transform", "translate(" + f1(H0.x - 36 + cyc.lt * 36) + " " + f1(H0.y - 24 + cyc.lt * 24) + ") rotate(40)");
  hyp.style.display = sm.Hy > 0.04 ? "" : "none"; place(hyp, H2.x + 8, H2.y + 4, 0, 0.4 + 0.9 * clamp(sm.Hy));
  cyc.ht -= dt * (sm.Hy > 0.3 ? 1 : 0); if (cyc.ht < 0 && sm.Hy > 0.3) { cyc.ht = rnd(14, 20); cyc.relapse = 5; emitMer(H2.x, H2.y, 8, 50); }
  if (cyc.relapse > 0) cyc.relapse -= dt;
  /* drug visuals */
  pillsB.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (p.k ? 16 : 54) * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 5) / 1.5).toFixed(2)); if (p.t > 6.5 || p.x > WW) { p.on = false; p.e.setAttribute("opacity", "0"); } });
  cyc.accP += dt * (sm.blood * 1.6 + sm.pq * 0.8); while (cyc.accP >= 1) { cyc.accP--; const pq = Math.random() < sm.pq / (sm.pq + sm.blood + 0.001), p = pillsB.find((q) => !q.on); if (p) { p.on = true; p.t = 0; p.k = pq ? 1 : 0; p.x = pq ? rnd(340, 380) : rnd(20, 120); p.y = pq ? rnd(104, 126) : CY + rnd(-30, 30); } }
  mkBlood.setAttribute("opacity", sm.blood.toFixed(2)); mkHyp.setAttribute("opacity", (sm.pq * (sm.Hy > 0.001 || m.Hy === 0 ? 1 : 1)).toFixed(2)); mkGam.setAttribute("opacity", sm.pq.toFixed(2));
  $("bl-pill").style.opacity = sm.blood.toFixed(2); $("pq-pill").style.opacity = sm.pq.toFixed(2); $("sq-pill").style.opacity = sm.sev.toFixed(2);
  /* fever trace */
  cyc.pulse = Math.max(0, cyc.pulse - dt * 0.5);
  cyc.fev = (cyc.fev || 0) + (cyc.pulse * sm.F * 1.2 - (cyc.fev || 0)) * Math.min(1, dt * 3);
  cyc.acc = (cyc.acc || 0) + dt; if (cyc.acc > 0.1) { cyc.acc = 0; temps.push(0.08 + 0.92 * clamp(cyc.fev)); temps.shift(); let d = ""; temps.forEach((v, i) => { d += (i ? "L" : "M") + f1(FP.x + (i / (NS_ - 1)) * FP.w) + " " + f1(FP.y + FP.h - v * FP.h * 0.9 - 6); }); tline.setAttribute("d", d); }
  gg.pa.set(sm.Pa, wordOf(sm.Pa, 0.15, 0.55, ["cleared", "moderate", "heavy"])); gg.an.set(sm.An, wordOf(sm.An, 0.25, 0.55, ["mild", "moderate", "marked"])); gg.fv.set(sm.F, wordOf(sm.F, 0.25, 0.7, ["none", "periodic", "high"]));
  gg.hy.set(sm.Hy, wordOf(sm.Hy, 0.05, 0.4, ["none", "low", "high"])); gg.sv.set(sm.Sv, wordOf(sm.Sv, 0.2, 0.55, ["low", "raised", "severe"]));
}
function SC_isSevere() { return level === 2; }
run({ init, step });
