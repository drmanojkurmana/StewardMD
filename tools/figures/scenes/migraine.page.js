/* Migraine scene: prodrome signals, the cortical aura wave, trigeminal firing, CGRP, the meningeal vessel and the gauges. */
const L = { cortex: $("cortexG"), nodes: $("nodes"), vessel: $("vesselG"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { hypo: 0.3, csd: 0.3, trig: 0.5, cgrpSig: 0.4, vaso: 0.3, infl: 0.3, pain: 0.4, photo: 0.3, nausea: 0.3, trip: 0, nsaid: 0, cgrpRx: 0, prev: 0 };
const acc = { prod: 0, trig: 0, cgrp: 0, pain: 0, infl: 0 };
let csdRect, csdClipW, lumen, wallT, wallB, inflHalo, pupil, rays, stomG, hypoG, thalG, gangG, gg = {}, marks = {}, tpills = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const prod = pool(12, () => mk("circle", { class: "sc-p p-prod", r: 2.4 }, L.parts));
const trigP = pool(26, () => mk("circle", { class: "sc-p p-trig", r: 2.6 }, L.parts));
const cgrpP = pool(24, () => mk("circle", { class: "sc-p p-cgrp", r: 2.8 }, L.parts));
const painP = pool(18, () => mk("circle", { class: "sc-p p-pain", r: 2.4 }, L.parts));
const inflP = pool(16, () => mk("circle", { class: "sc-p p-pain", r: 2.2 }, L.parts));
const xmark = (parent, x, y, id) => { const g = mk("g", { id, opacity: "0" }, parent); mk("circle", { class: "mg-xc", cx: x, cy: y, r: 8 }, g); mk("path", { class: "mg-xp", d: "M" + (x - 4) + " " + (y - 4) + "L" + (x + 4) + " " + (y + 4) + "M" + (x + 4) + " " + (y - 4) + "L" + (x - 4) + " " + (y + 4) }, g); return g; };
function init() {
  /* cortex slab with the spreading aura wave */
  const cg = L.cortex;
  mk("rect", { class: "mg-cortex", x: 44, y: 82, width: 484, height: 62, rx: 14 }, cg);
  const clip = mk("clipPath", { id: "mgclip" }, cg); mk("rect", { x: 44, y: 82, width: 484, height: 62, rx: 14 }, clip);
  const waveG = mk("g", { "clip-path": "url(#mgclip)" }, cg);
  csdRect = mk("rect", { class: "mg-csd", x: 40, y: 82, width: 90, height: 62, opacity: "0" }, waveG);
  for (let i = 0; i < 11; i++) { const nx = 74 + i * 42, ny = 100 + (i % 3) * 13; mk("circle", { class: "mg-neuron", cx: nx, cy: ny, r: 5 }, cg); mk("path", { class: "dr-beam", d: "M" + nx + " " + ny + "l10 -6M" + nx + " " + ny + "l12 5" }, cg); }
  const cap = mk("text", { class: "sc-lab", x: 64, y: 98 }, cg); cap.textContent = "cortex";
  /* brain nodes */
  const ng = L.nodes;
  hypoG = cell(ng, { cls: "hypo", r: 34, nuc: 0.4, seed: 3, wob: 0.1 }); place(hypoG, 118, 282, 0, 1);
  mk("rect", { class: "mg-brain", x: 258, y: 200, width: 72, height: 168, rx: 18 }, ng);
  mk("circle", { class: "mg-nuc", cx: 294, cy: 238, r: 12 }, ng); mk("circle", { class: "mg-nuc2", cx: 294, cy: 282, r: 11 }, ng); mk("ellipse", { class: "mg-nuc", cx: 294, cy: 330, rx: 13, ry: 15 }, ng);
  [["raphe", 242], ["locus", 286], ["TNC", 334]].forEach(([t, y]) => { const e = mk("text", { class: "sc-lab", x: 294, y, "text-anchor": "middle" }, ng); e.textContent = t; });
  const bsCap = mk("text", { class: "sc-lab", x: 294, y: 218, "text-anchor": "middle" }, ng); bsCap.textContent = "brainstem";
  thalG = cell(ng, { cls: "thal", r: 34, nuc: 0.38, seed: 7, wob: 0.1 }); place(thalG, 452, 282, 0, 1);
  gangG = cell(ng, { cls: "gang", r: 27, nuc: 0.36, seed: 11, wob: 0.12 }); place(gangG, 606, 282, 0, 1);
  stomG = cell(ng, { cls: "stom", r: 24, nuc: 0.3, seed: 5, wob: 0.14 }); place(stomG, 808, 382, 0, 1);
  /* eye for photophobia */
  const eg = mk("g", {}, ng);
  mk("ellipse", { class: "mg-eye", cx: 808, cy: 148, rx: 28, ry: 16 }, eg);
  pupil = mk("circle", { class: "mg-pupil", cx: 808, cy: 148, r: 7 }, eg);
  rays = mk("g", { opacity: "0" }, eg);
  [[762, 122], [762, 174], [854, 122], [854, 174], [808, 112], [808, 184]].forEach(([x, y]) => mk("path", { class: "mg-ray", d: "M" + (808 + (x - 808) * 0.72) + " " + (148 + (y - 148) * 0.72) + "L" + x + " " + y }, rays));
  /* meningeal vessel */
  const vg = L.vessel;
  inflHalo = mk("rect", { class: "mg-infl", x: 700, y: 226, width: 216, height: 76, rx: 16, opacity: "0" }, vg);
  lumen = mk("rect", { class: "sc-lumen", x: 706, y: 248, width: 204, height: 28 }, vg);
  wallT = mk("rect", { class: "mg-wall", x: 706, y: 240, width: 204, height: 8, rx: 4 }, vg);
  wallB = mk("rect", { class: "mg-wall", x: 706, y: 276, width: 204, height: 8, rx: 4 }, vg);
  [[740, 312], [808, 316], [876, 312]].forEach(([x, y]) => { mk("path", { class: "dr-beam", d: "M" + x + " 284V" + (y - 4) }, vg); mk("circle", { class: "mg-end", cx: x, cy: y, r: 6 }, vg); });
  marks.trip = xmark(vg, 808, 262, "x-trip"); marks.nsaid = xmark(vg, 886, 296, "x-nsaid"); marks.cgrp = xmark(vg, 744, 262, "x-cgrp"); marks.prev = xmark(L.cortex, 200, 112, "x-prev");
  /* labels */
  const o = L.over;
  pill(o, "Hypothalamus", 118, 248, 118, 178, "Hypothalamus: a deep brain control centre. In the prodrome or premonitory phase it helps drive yawning, craving, mood and neck symptoms, with dopamine involved.");
  pill(o, "Aura wave", 380, 82, 380, 60, "Cortical spreading depression: a slow wave of neuronal activity then suppression crossing the cortex. It is the likely basis of a typical aura, visual, sensory or speech, spreading gradually.");
  pill(o, "Brainstem", 294, 368, 294, 402, "Brainstem nuclei, including the dorsal raphe nucleus and locus ceruleus, and the trigeminal nucleus caudalis (TNC). They modulate pain and drive nausea, vomiting and vertigo in some attacks.");
  pill(o, "Thalamus", 452, 248, 452, 182, "Thalamus: the relay. Pain signals from the trigeminal system pass here to cortex, where they are felt as headache and where light and sound become unpleasant.");
  pill(o, "Trig. ganglion", 606, 255, 606, 180, "Trigeminal ganglion and nucleus: the trigeminovascular relay. When it fires, meningeal nerve endings are activated and pain signalling rises.");
  pill(o, "Meningeal vessel", 808, 240, 808, 200, "A vessel in the meninges, the coverings of the brain. It widens during headache and its nerve endings become sensitised, so normal pulsation feels throbbing.");
  pill(o, "CGRP", 740, 312, 720, 352, "Calcitonin gene-related peptide, released from trigeminal endings. It acts at the CGRP receptor to widen the vessel and pass on pain. CGRP-based treatments block this step.");
  pill(o, "Photophobia", 836, 148, 890, 105, "Photophobia: light feels painful or glaring in headache, as thalamus and cortex become sensitised. Phonophobia, dislike of sound, often comes with it.");
  pill(o, "Nausea", 832, 382, 890, 382, "Nausea and sometimes vomiting, driven by brainstem circuits in the headache phase. It is part of the attack, not just a reaction to pain.");
  tpills.trip = pill(o, "Triptan", 606, 300, 480, 390, "A triptan acts at serotonin receptors: it tightens the meningeal vessel and reduces CGRP release from trigeminal endings."); tpills.trip.setAttribute("id", "tp-trip"); tpills.trip.style.opacity = 0;
  tpills.nsaid = pill(o, "NSAID", 876, 306, 480, 390, "An NSAID reduces prostaglandin production, so neurogenic inflammation and sensitisation of the endings fall."); tpills.nsaid.setAttribute("id", "tp-nsaid"); tpills.nsaid.style.opacity = 0;
  tpills.cgrp = pill(o, "CGRP block", 744, 262, 480, 390, "A CGRP-based treatment blocks CGRP or its receptor, so vessel widening and pain signalling fall."); tpills.cgrp.setAttribute("id", "tp-cgrp"); tpills.cgrp.style.opacity = 0;
  tpills.prev = pill(o, "Preventive", 200, 112, 480, 390, "Preventive treatment, taken regularly, lowers neuronal excitability and how often attacks begin. It does not stop one attack at once."); tpills.prev.setAttribute("id", "tp-prev"); tpills.prev.style.opacity = 0;
  /* gauges */
  const P = L.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W2() - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["csd", "Aura wave", "g-csd", "Cortical spreading depression crossing the cortex in aura. Quiet in most of prodrome, fading as headache takes over."], ["trig", "Trigeminal", "g-clot", "Firing of the trigeminovascular system: trigeminal nucleus, ganglion and meningeal endings."], ["cgrp", "CGRP signal", "g-cgrp", "CGRP released from trigeminal endings acting at its receptor on vessel and nerve."], ["vaso", "Vessel width", "g-vaso", "Widening of the meningeal vessel. A triptan tightens it; CGRP widens it."], ["infl", "Inflammation", "g-bad", "Neurogenic inflammation: leak and sensitisation around the meningeal vessel. An NSAID reduces it."], ["pain", "Headache", "g-pain", "Headache pain relayed through the thalamus to cortex: throbbing pain with photophobia, nausea and vomiting."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}
function W2() { return 960; }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["csd", "trig", "cgrpSig", "vaso", "infl", "pain", "photo", "nausea", "trip", "nsaid", "cgrpRx", "prev"].forEach((q) => { sm[q] = lerp(sm[q], m[q], q === "csd" || q === "trig" ? k2 : k1); });
  sm.hypo = lerp(sm.hypo, m.hypo, k2);
  /* aura wave sweeps the cortex */
  const sweep = ((tm / 5200) % 1.25);
  const wx = 34 + sweep * 520;
  csdRect.setAttribute("x", f1(wx)); csdRect.setAttribute("width", f1(70 + 50 * sm.csd));
  csdRect.setAttribute("opacity", (sm.csd * 0.55).toFixed(2));
  place(hypoG, 118 + Math.sin(tm / 1500) * 2, 282 + Math.cos(tm / 1700) * 2, 0, 1 + 0.05 * sm.hypo * Math.sin(tm / 320));
  place(thalG, 452, 282, 0, 1 + 0.05 * sm.pain * Math.sin(tm / 300));
  place(gangG, 606, 282, 0, 1 + 0.07 * sm.trig * Math.sin(tm / 260));
  place(stomG, 808, 382, Math.sin(tm / 500) * 5 * sm.nausea, 1 + 0.06 * sm.nausea * Math.sin(tm / 380));
  /* vessel width follows vasodilation */
  const hh = 13 + 11 * sm.vaso + 1.5 * Math.sin(tm / 700), cyv = 262;
  lumen.setAttribute("y", f1(cyv - hh)); lumen.setAttribute("height", f1(hh * 2));
  wallT.setAttribute("y", f1(cyv - hh - 8)); wallB.setAttribute("y", f1(cyv + hh));
  inflHalo.setAttribute("opacity", (sm.infl * 0.3).toFixed(2)); inflHalo.setAttribute("y", f1(cyv - hh - 22)); inflHalo.setAttribute("height", f1(hh * 2 + 44));
  rays.setAttribute("opacity", sm.photo.toFixed(2));
  pupil.setAttribute("r", f1(7 - 2.2 * sm.photo));
  /* prodrome sparks: hypothalamus toward brainstem */
  acc.prod += dt * sm.hypo * 5; while (acc.prod >= 1) { acc.prod--; const p = free(prod); if (p) emit(p, 152, 282 + rnd(-14, 14), rnd(28, 42), rnd(-6, 6), 0); }
  prod.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 256 || p.t > 3) kill(p); });
  /* trigeminal firing: ganglion to the meningeal endings */
  acc.trig += dt * sm.trig * 13; while (acc.trig >= 1) { acc.trig--; const p = free(trigP); if (p) emit(p, 632, 278 + rnd(-8, 8), rnd(42, 60), rnd(-8, 2), Math.floor(rnd(0, 3))); }
  trigP.forEach((p) => { if (!p.on) return; p.t += dt; const ty = [312, 316, 312][p.k]; p.x += p.vx * dt; p.y += (ty - p.y) * dt * 1.4 + p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 620, 890)) + " " + f1(clamp(p.y, 240, 330)) + ")"); if (p.x > [740, 808, 876][p.k] - 4 || p.t > 4) kill(p); });
  /* CGRP: endings up to the vessel wall */
  acc.cgrp += dt * sm.cgrpSig * 12; while (acc.cgrp >= 1) { acc.cgrp--; const p = free(cgrpP), ex = pick([740, 808, 876]); if (p) emit(p, ex + rnd(-5, 5), 306, rnd(-5, 5), -rnd(22, 34), 0); }
  cgrpP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 700, 916)) + " " + f1(clamp(p.y, 232, 320)) + ")"); if (p.y < cyv - hh - 2 || p.t > 3) kill(p); });
  /* neurogenic inflammation: leak dots drifting out from the vessel */
  acc.infl += dt * sm.infl * 7; while (acc.infl >= 1) { acc.infl--; const p = free(inflP); if (p) emit(p, rnd(720, 896), cyv + hh + 6, rnd(-7, 7), rnd(12, 22), 0); }
  inflP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 690, 926)) + " " + f1(clamp(p.y, 220, 360)) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2) kill(p); });
  /* pain relay: vessel back through ganglion and thalamus */
  acc.pain += dt * sm.pain * 9; while (acc.pain >= 1) { acc.pain--; const p = free(painP); if (p) emit(p, 730, 272 + rnd(-8, 8), -rnd(38, 54), rnd(-4, 10), 0); }
  painP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += (282 - p.y) * dt * 0.8 + p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 430, 900)) + " " + f1(clamp(p.y, 230, 330)) + ")"); if (p.x < 488 || p.t > 5) kill(p); });
  /* treatment marks and pills */
  marks.trip.setAttribute("opacity", sm.trip.toFixed(2)); marks.nsaid.setAttribute("opacity", sm.nsaid.toFixed(2)); marks.cgrp.setAttribute("opacity", sm.cgrpRx.toFixed(2)); marks.prev.setAttribute("opacity", sm.prev.toFixed(2));
  $("tp-trip").style.opacity = sm.trip.toFixed(2); $("tp-nsaid").style.opacity = sm.nsaid.toFixed(2); $("tp-cgrp").style.opacity = sm.cgrpRx.toFixed(2); $("tp-prev").style.opacity = sm.prev.toFixed(2);
  gg.csd.set(sm.csd, wordOf(sm.csd, 0.25, 0.6, ["quiet", "spreading", "active"]));
  gg.trig.set(sm.trig, wordOf(sm.trig, 0.3, 0.75, ["quiet", "active", "firing"]));
  gg.cgrp.set(sm.cgrpSig, wordOf(sm.cgrpSig, 0.3, 0.6, ["low", "raised", "high"]));
  gg.vaso.set(sm.vaso, wordOf(sm.vaso, 0.3, 0.6, ["normal", "wide", "very wide"]));
  gg.infl.set(sm.infl, wordOf(sm.infl, 0.3, 0.6, ["none", "some", "marked"]));
  gg.pain.set(sm.pain, wordOf(sm.pain, 0.28, 0.6, ["none", "mild", "severe"]));
}
run({ init, step });
