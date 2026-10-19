/* Pain scene: injury signals run along the nerve to the cord and brain.
 * Skin, ganglion and brain are real organ art; each treatment acts where it works:
 * NSAID calms the injury cloud, opioid docks on receptors and strengthens the
 * descending brake, and the nerve block halts spikes inside the nerve. */
const L = { parts: $("parts"), dyn: $("dyn"), over: $("over"), panel: $("panel") };
let skinO = null, gangO = null, brainO = null;
let fullTrack = null, descTrack = null;
let dermis = [120, 352], surfaceP = [125, 290], hornC = [422, 308], cuffC = [348, 323];
let blockU = 0.3, hornU = 0.45, brainU = 0.8;
const gg = {};
const sm = { Sns: 0.5, P: 0.5, T: 0.5, Horn: 0.4, Asc: 0.4, Desc: 0.25, Pain: 0.4, nsaid: 0, opi: 0, la: 0 };
const acc = { ap: 0, pg: 0, desc: 0 };
let injGlow = null, boltEl = null, brainGlow = null, hornGlow = null, nsaidMark = null, blockMark = null, cuffEl = null;
let capEl = null, capDrug = -1;
const recs = [], docks = [];

function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const aps = pool(26, () => mk("circle", { class: "sc-p p-ap", r: 3 }, L.parts));
const pgs = pool(16, () => mk("rect", { class: "sc-p p-pg", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, L.parts));
const dps = pool(14, () => mk("circle", { class: "sc-p p-desc", r: 2.8 }, L.parts));

function xmark(parent, x, y, id) {
  const g = mk("g", { id: id, opacity: "0" }, parent);
  mk("circle", { class: "pn-xc", cx: x, cy: y, r: 9 }, g);
  mk("path", { class: "pn-xp", d: "M" + (x - 4) + " " + (y - 4) + "L" + (x + 4) + " " + (y + 4) + "M" + (x + 4) + " " + (y - 4) + "L" + (x - 4) + " " + (y + 4) }, g);
  return g;
}
function rec(parent, x, y) {
  const g = mk("g", {}, parent);
  mk("circle", { class: "pn-recglow", cx: x, cy: y, r: 6, opacity: "0.35" }, g);
  mk("path", { class: "pn-recp", d: "M" + (x - 4) + " " + (y - 4) + "L" + x + " " + y + "L" + (x + 4) + " " + (y - 4) + "M" + x + " " + y + "L" + x + " " + (y + 5) }, g);
  recs.push(g);
  return g;
}
function uOf(tr, pt) {
  let best = 0, bd = 1e18;
  for (let i = 0; i <= 200; i++) { const q = tr.at(i / 200), dx = q.x - pt[0], dy = q.y - pt[1], d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i / 200; } }
  return best;
}
const mid = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function polyD(pts) { return "M" + pts.map((p) => f1(p[0]) + " " + f1(p[1])).join("L"); }

function initOrgans() {
  skinO = organ($("skinSlot"), "skin", 125, 345, 150, {});
  gangO = organ($("gangSlot"), "ganglion", 255, 332, 92, {});
  brainO = organ($("brainSlot"), "brain", 775, 170, 250, {});
  const SP = skinO.ports, GP = gangO.ports, BP = brainO.ports;
  dermis = SP.dermis; surfaceP = SP.surface;
  const cordIn = [385, 315], hornOut = [472, 300];
  const car = BP.carotid, par = BP.parenchyma, stem = BP.stem;
  cuffC = mid(GP.out, cordIn, 0.55);
  const fullPts = [dermis, mid(dermis, GP.in, 0.5), GP.in, GP.out, cuffC, cordIn, hornC, hornOut,
    [472, 250], [472, 210], [520, 180], [580, 168], [640, 182], car, par];
  const descPts = [stem, [740, 282], [660, 297], [600, 303], [520, 307], [452, 307]];
  $("nervePath").setAttribute("d", polyD(fullPts));
  $("tractPath").setAttribute("d", polyD(fullPts.slice(7)));
  $("descPath").setAttribute("d", polyD(descPts));
  fullTrack = track(fullPts); descTrack = track(descPts);
  blockU = uOf(fullTrack, cuffC); hornU = uOf(fullTrack, hornC); brainU = uOf(fullTrack, car);
  const st = $("skinTerm");
  if (st) {
    mk("path", { class: "pn-term", d: "M" + f1(dermis[0]) + " " + f1(dermis[1]) + "L" + f1(dermis[0] - 16) + " " + f1(dermis[1] - 16)
      + "M" + f1(dermis[0]) + " " + f1(dermis[1]) + "L" + f1(dermis[0]) + " " + f1(dermis[1] - 24)
      + "M" + f1(dermis[0]) + " " + f1(dermis[1]) + "L" + f1(dermis[0] + 16) + " " + f1(dermis[1] - 16)
      + "M" + f1(dermis[0]) + " " + f1(dermis[1]) + "L" + f1(dermis[0] - 9) + " " + f1(dermis[1] - 8)
      + "M" + f1(dermis[0]) + " " + f1(dermis[1]) + "L" + f1(dermis[0] + 9) + " " + f1(dermis[1] - 8) }, st);
  }
  boltEl = mk("path", { class: "pn-bolt", d: "M" + f1(surfaceP[0] + 5) + " " + f1(surfaceP[1] - 30)
    + "L" + f1(surfaceP[0] - 7) + " " + f1(surfaceP[1] - 10) + "L" + f1(surfaceP[0] + 3) + " " + f1(surfaceP[1] - 10)
    + "L" + f1(surfaceP[0] - 9) + " " + f1(surfaceP[1] + 12) }, L.dyn);
  injGlow = mk("ellipse", { class: "pn-iglow", cx: f1(dermis[0]), cy: f1(dermis[1]), rx: 50, ry: 36, opacity: "0.3" }, L.dyn);
  hornGlow = mk("ellipse", { class: "pn-hornglow", cx: hornC[0], cy: hornC[1], rx: 30, ry: 42, opacity: "0" }, L.dyn);
  brainGlow = mk("ellipse", { class: "pn-glow", cx: f1(brainO.x), cy: f1(brainO.y), rx: f1(brainO.w * 0.42), ry: f1(brainO.h * 0.42), opacity: "0" }, L.dyn);
  nsaidMark = xmark(L.dyn, surfaceP[0] - 30, surfaceP[1] + 16, "x-nsaid");
  cuffEl = mk("rect", { class: "pn-cuff", x: f1(cuffC[0] - 13), y: f1(cuffC[1] - 20), width: 26, height: 40, rx: 9, opacity: "0" }, L.dyn);
  blockMark = xmark(L.dyn, cuffC[0], cuffC[1], "x-block");
  const rp = [[406, 284], [438, 288], [416, 330], [par[0] - 18, par[1] - 6], [par[0] + 14, par[1] + 8], [stem[0] - 6, stem[1] - 8]];
  rp.forEach(([x, y]) => {
    rec(L.dyn, x, y);
    docks.push({ e: mk("circle", { class: "pn-op", cx: f1(x), cy: f1(y), r: 4, opacity: "0" }, L.dyn), x, y });
  });
}

function capText(d) {
  if (d === 1) return "NSAID calms the injury. Fewer pain signals leave the injury.";
  if (d === 2) return "Opioid docks on receptors. The cord relays less and the brake grows stronger.";
  if (d === 3) return "Nerve block halts spikes inside the nerve. Almost nothing reaches the brain.";
  return "No treatment. Pain signals run from injury to brain at full strength.";
}

function init() {
  initOrgans();
  const o = L.over;
  pill(o, "Injury", 130, 289, 70, 240, "Injured skin releases sensitising chemicals. They make the nerve ending fire more easily. An NSAID calms this step.");
  pill(o, "Nerve", 330, 326, 330, 272, "The fibre carries spikes toward the cord. Its cell body sits in the swelling on the nerve. A local block halts spikes here.");
  pill(o, "Spinal cord", 440, 180, 430, 120, "The coming fibre hands its signal to a second cell in the dorsal horn. Opioids and the brake path damp this handover.");
  pill(o, "Brain", 755, 154, 800, 60, "The signal rises to the brain, where pain is felt. Opioids also act here, so less pain reaches feeling.");
  pill(o, "Brake path", 620, 303, 620, 360, "A path from the brainstem back to the cord that damps the handover. Opioids make this brake stronger.");
  pill(o, "Opioid dock", 406, 284, 300, 220, "Opioid receptors sit on the nerve ending, the second cell and in the brain. Docked drug quiets each site.");
  capEl = mk("text", { class: "pn-cap", x: 240, y: 428 }, o); capEl.textContent = capText(0);

  const P = L.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["sns", "Sensitising", "g-pg", "Sensitising chemicals at the injury that make the nerve ending fire more easily. An NSAID brings this down."],
   ["per", "Nociceptor", "g-ap", "How strongly the nerve ending fires from the injury."],
   ["horn", "Horn relay", "g-horn", "How much signal passes the dorsal horn handover. Opioids and the brake damp it, and a nerve block starves it of input."],
   ["asc", "Ascending", "g-asc", "Signal rising toward the brain."],
   ["desc", "Brake", "g-desc", "The descending brake from the brainstem back to the cord. Opioids strengthen it."],
   ["pain", "Pain felt", "g-pain", "Pain felt in the brain. It follows the rising signal, reduced further by opioids."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}

function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.Sns = lerp(sm.Sns, m.Sns, k2); sm.P = lerp(sm.P, m.P, k2); sm.T = lerp(sm.T, m.T, k2);
  sm.Horn = lerp(sm.Horn, m.Horn, k2); sm.Asc = lerp(sm.Asc, m.Asc, k2); sm.Desc = lerp(sm.Desc, m.Desc, k2); sm.Pain = lerp(sm.Pain, m.Pain, k1);
  sm.nsaid = lerp(sm.nsaid, m.nsaid, k1); sm.opi = lerp(sm.opi, m.opi, k1); sm.la = lerp(sm.la, m.la, k1);

  injGlow.setAttribute("rx", f1(34 + 34 * sm.Sns)); injGlow.setAttribute("ry", f1(26 + 24 * sm.Sns));
  injGlow.setAttribute("opacity", (0.08 + 0.5 * sm.Sns).toFixed(2));
  boltEl.setAttribute("opacity", (0.2 + 0.8 * clamp(sm.P * 1.5)).toFixed(2));
  nsaidMark.setAttribute("opacity", sm.nsaid.toFixed(2));
  cuffEl.setAttribute("opacity", sm.la.toFixed(2));
  blockMark.setAttribute("opacity", sm.la.toFixed(2));
  brainGlow.setAttribute("opacity", (sm.Pain * 0.5).toFixed(2));
  hornGlow.setAttribute("opacity", (sm.Horn * 0.5 * (0.75 + 0.25 * Math.sin(tm / 280))).toFixed(2));
  $("tractPath").setAttribute("stroke-width", f1(1.5 + 3 * sm.Asc));
  $("tractPath").setAttribute("opacity", (0.3 + 0.65 * sm.Asc).toFixed(2));
  $("descPath").setAttribute("stroke-width", f1(1.5 + 3.5 * sm.Desc));
  $("descPath").setAttribute("opacity", (0.3 + 0.6 * sm.Desc).toFixed(2));
  recs.forEach((g, i) => { g.style.opacity = (0.3 + 0.7 * sm.opi).toFixed(2); if (g.firstChild) g.firstChild.setAttribute("opacity", (0.2 + 0.5 * sm.opi).toFixed(2)); });
  docks.forEach((d, i) => { d.e.setAttribute("opacity", sm.opi.toFixed(2)); d.e.setAttribute("cy", f1(d.y + 2 * Math.sin(tm / 400 + i * 1.3))); });

  acc.pg += dt * sm.Sns * 6;
  while (acc.pg >= 1) { acc.pg--; const p = free(pgs); if (p) emit(p, rnd(surfaceP[0] - 40, surfaceP[0] + 40), rnd(surfaceP[1], dermis[1]), rnd(-5, 5), rnd(-14, -6), 0); }
  pgs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });

  acc.ap += dt * (0.4 + sm.P * 7);
  while (acc.ap >= 1) { acc.ap--; const p = free(aps); if (p) { emit(p, dermis[0], dermis[1], 0, 0, 0); p.u = 0; } }
  aps.forEach((p) => {
    if (!p.on) return;
    p.u += dt * 0.16 * (0.5 + sm.P);
    if (sm.la > 0.5 && p.u > blockU) { kill(p); return; }
    if (p.u >= 1) { kill(p); return; }
    const pt = fullTrack.at(p.u);
    let fade = p.u < hornU ? 1 : clamp(sm.Horn * 2.2 + 0.15);
    if (p.u > brainU) fade *= (1 - 0.75 * sm.opi);
    p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ")");
    p.e.setAttribute("opacity", fade.toFixed(2));
  });

  acc.desc += dt * sm.Desc * 6;
  while (acc.desc >= 1) { acc.desc--; const p = free(dps); if (p) { emit(p, 0, 0, 0, 0, 0); p.u = 0; } }
  dps.forEach((p) => {
    if (!p.on) return;
    p.u += dt * 0.22;
    if (p.u >= 1) { kill(p); return; }
    const pt = descTrack.at(p.u);
    p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ")");
    p.e.setAttribute("opacity", "1");
  });

  gg.sns.set(sm.Sns, wordOf(sm.Sns, 0.3, 0.6, ["low", "moderate", "high"]));
  gg.per.set(sm.P, wordOf(sm.P, 0.3, 0.6, ["quiet", "firing", "firing hard"]));
  gg.horn.set(sm.Horn, wordOf(sm.Horn, 0.3, 0.6, ["damped", "passing", "strong"]));
  gg.asc.set(sm.Asc, wordOf(sm.Asc, 0.3, 0.6, ["low", "moderate", "high"]));
  gg.desc.set(sm.Desc, wordOf(sm.Desc, 0.35, 0.65, ["weak", "present", "strong"]));
  gg.pain.set(sm.Pain, wordOf(sm.Pain, 0.25, 0.55, ["mild", "moderate", "severe"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
