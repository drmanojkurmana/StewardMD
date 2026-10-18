/* Pain scene: nociceptor firing, dorsal horn relay, spinothalamic ascent, descending inhibition and the gauges. */
const L = { parts: $("parts"), dyn: $("dyn"), over: $("over"), panel: $("panel") };
const fullTrack = track([[110, 350], [180, 342], [255, 332], [320, 323], [385, 315], [425, 308], [462, 295], [462, 185], [545, 148], [633, 135], [685, 135], [760, 126], [825, 120]]);
const descTrack = track([[605, 212], [578, 242], [548, 272], [508, 294], [455, 306], [428, 308]]);
const gg = {};
const sm = { Sns: 0.5, P: 0.5, T: 0.5, Horn: 0.4, Asc: 0.4, Desc: 0.25, Pain: 0.4, nsaid: 0, opi: 0, la: 0 };
const acc = { ap: 0, pg: 0, desc: 0 };
let thalGlow, cortGlow, hornGlow, recs = [], nsaidMark, blockMark;

function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const aps = pool(26, () => mk("circle", { class: "sc-p p-ap", r: 3 }, L.parts));
const pgs = pool(14, () => mk("rect", { class: "sc-p p-pg", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, L.parts));
const dps = pool(12, () => mk("circle", { class: "sc-p p-desc", r: 2.8 }, L.parts));

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

function init() {
  const st = $("skinTerm");
  if (st) {
    mk("path", { class: "pn-term", d: "M110 350L92 336M110 350L110 334M110 350L128 336M110 350L98 342M110 350L122 342" }, st);
  }
  thalGlow = mk("ellipse", { class: "pn-thalglow", cx: 685, cy: 135, rx: 52, ry: 34, opacity: "0" }, L.dyn);
  cortGlow = mk("ellipse", { class: "pn-glow", cx: 840, cy: 118, rx: 82, ry: 52, opacity: "0" }, L.dyn);
  hornGlow = mk("ellipse", { class: "pn-thalglow", cx: 422, cy: 305, rx: 30, ry: 42, opacity: "0" }, L.dyn);
  rec(L.dyn, 406, 284); rec(L.dyn, 438, 288); rec(L.dyn, 416, 330);
  rec(L.dyn, 668, 118); rec(L.dyn, 700, 148); rec(L.dyn, 605, 202);
  nsaidMark = xmark(L.dyn, 88, 326, "x-nsaid");
  blockMark = xmark(L.dyn, 345, 321, "x-block");

  const o = L.over;
  pill(o, "Injury", 58, 338, 60, 295, "Injured tissue. It releases prostaglandins and other mediators that sensitise the nociceptor, so it fires more easily.");
  pill(o, "Nociceptor", 110, 348, 170, 292, "Nociceptor: a free nerve ending that detects harmful stimuli such as heat, pressure and chemicals. Sensitised nociceptors fire at lower thresholds.");
  pill(o, "Peripheral nerve", 300, 324, 310, 278, "The nociceptor fibre carries action potentials toward the spinal cord. Its cell body sits in the dorsal root ganglion, the swelling on the nerve.");
  pill(o, "Dorsal horn", 425, 308, 440, 428, "Dorsal horn of the spinal cord, including the substantia gelatinosa. The incoming fibre synapses here on a second order neuron. Opioids and descending inhibition damp this relay.");
  pill(o, "Ascending tract", 462, 215, 545, 165, "Spinothalamic tract: second order neurons cross to the opposite side of the cord and ascend to the thalamus, carrying pain and temperature.");
  pill(o, "Thalamus", 685, 118, 685, 85, "Thalamus: the relay station for sensory signals on their way to the cortex. Opioid receptors here also modify the signal.");
  pill(o, "Cortex", 840, 132, 838, 192, "Somatosensory cortex. When the signal arrives here, pain is localised and consciously felt. Its activity follows the pain felt gauge.");
  pill(o, "Descending path", 562, 258, 600, 305, "Descending inhibition: fibres from the periaqueductal grey and rostral ventromedial medulla in the brainstem run back down to the dorsal horn and can damp the relay. Opioids strengthen this control.");
  pill(o, "Opioid receptors", 418, 286, 185, 175, "Opioid receptors, mainly mu receptors, at spinal and brain sites: on the incoming fibre terminal and second order neuron in the dorsal horn, and in the thalamus and brainstem. Small yellow markers show them.");
  const pn = pill(o, "NSAID", 132, 338, 95, 250, "An NSAID acts at the injury: it blocks cyclo-oxygenase, so fewer prostaglandins sensitise the nociceptor."); pn.setAttribute("id", "p-nsaid"); pn.style.opacity = 0;
  const po = pill(o, "Opioid", 438, 300, 530, 360, "An opioid acts at spinal and brain opioid receptors: it damps the dorsal horn relay, strengthens descending inhibition and reduces pain felt in the cortex."); po.setAttribute("id", "p-opi"); po.style.opacity = 0;
  const pb = pill(o, "Nerve block", 345, 321, 335, 388, "A local anaesthetic block: the drug blocks sodium channels in the peripheral nerve, so action potentials cannot cross this segment."); pb.setAttribute("id", "p-block"); pb.style.opacity = 0;

  const P = L.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["sns", "Sensitising", "g-pg", "Prostaglandins and other mediators at the injury that sensitise the nociceptor. An NSAID brings this down."],
   ["per", "Nociceptor", "g-ap", "How strongly the nociceptor fires from the injury."],
   ["horn", "Horn relay", "g-horn", "How much signal passes the dorsal horn relay. Opioids and descending inhibition damp it, and a nerve block starves it of input."],
   ["asc", "Ascending", "g-asc", "Signal rising in the spinothalamic tract toward the thalamus and cortex."],
   ["desc", "Descending", "g-desc", "Descending inhibition from the brainstem back to the dorsal horn. Opioids strengthen it."],
   ["pain", "Pain felt", "g-pain", "Pain consciously felt in the cortex. It follows the ascending signal, reduced further by opioids in the brain."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}

function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.Sns = lerp(sm.Sns, m.Sns, k2); sm.P = lerp(sm.P, m.P, k2); sm.T = lerp(sm.T, m.T, k2);
  sm.Horn = lerp(sm.Horn, m.Horn, k2); sm.Asc = lerp(sm.Asc, m.Asc, k2); sm.Desc = lerp(sm.Desc, m.Desc, k2); sm.Pain = lerp(sm.Pain, m.Pain, k1);
  sm.nsaid = lerp(sm.nsaid, m.nsaid, k1); sm.opi = lerp(sm.opi, m.opi, k1); sm.la = lerp(sm.la, m.la, k1);

  thalGlow.setAttribute("opacity", (sm.Asc * 0.5).toFixed(2));
  cortGlow.setAttribute("opacity", (sm.Pain * 0.55).toFixed(2));
  hornGlow.setAttribute("opacity", (sm.Horn * 0.5 * (0.7 + 0.3 * Math.sin(tm / 280))).toFixed(2));
  recs.forEach((g, i) => { g.style.opacity = (0.3 + 0.7 * sm.opi).toFixed(2); const s = 1 + 0.18 * sm.opi * Math.sin(tm / 320 + i); g.setAttribute("transform", "scale(1)"); g.style.transformOrigin = "center"; if (g.firstChild) g.firstChild.setAttribute("opacity", (0.2 + 0.5 * sm.opi).toFixed(2)); });
  nsaidMark.setAttribute("opacity", sm.nsaid.toFixed(2));
  blockMark.setAttribute("opacity", sm.la.toFixed(2));
  $("p-nsaid").style.opacity = sm.nsaid.toFixed(2);
  $("p-opi").style.opacity = sm.opi.toFixed(2);
  $("p-block").style.opacity = sm.la.toFixed(2);

  acc.pg += dt * sm.Sns * 5;
  while (acc.pg >= 1) { acc.pg--; const p = free(pgs); if (p) emit(p, rnd(52, 150), rnd(330, 352), rnd(-5, 5), rnd(-14, -6), 0); }
  pgs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });

  acc.ap += dt * (0.4 + sm.P * 7) * (sm.T > 0.04 || sm.P > 0.04 ? 1 : 0.2);
  while (acc.ap >= 1) { acc.ap--; const p = free(aps); if (p) { emit(p, 110, 350, 0, 0, 0); p.u = 0; } }
  aps.forEach((p) => {
    if (!p.on) return;
    p.u += dt * 0.16 * (0.5 + sm.P);
    if (sm.la > 0.5 && p.u > 0.28) { kill(p); return; }
    if (p.u >= 1) { kill(p); return; }
    const pt = fullTrack.at(p.u);
    p.x = pt.x; p.y = pt.y;
    const fade = p.u < 0.34 ? 1 : clamp(sm.Horn * 2.2 + 0.15);
    p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ")");
    p.e.setAttribute("opacity", fade.toFixed(2));
  });

  acc.desc += dt * sm.Desc * 6;
  while (acc.desc >= 1) { acc.desc--; const p = free(dps); if (p) { emit(p, 605, 212, 0, 0, 0); p.u = 0; } }
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
}
run({ init, step });
