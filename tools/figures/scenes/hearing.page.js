/* Hearing scene: sound in the canal, eardrum and ossicles, oval window, cochlea wave and hair cells, auditory nerve, fork tests and gauges. */
const L = { ear: $("ear"), coch: $("coch"), fork: $("fork"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { air: 1, bone: 1, coch: 0.95, waveEff: 0.9, airHeard: 0.95, boneHeard: 0.95, nerve: 0.95, hearing: 0.95, aid: 0, surg: 0, impl: 0, cond: 0, sens: 0 };
const gg = {};
const acc = { snd: 0, bonep: 0, cochp: 0, nervep: 0 };
let tmG = null, malG = null, incG = null, stapG = null, aidDev = null, plaque = null, implantG = null, wavePath = null;
let rinneAirBar = null, rinneBoneBar = null, rinneTxt = null, weberTxt = null, weberAff = null, weberGood = null;
const hairs = [];

function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

const trackSnd = track([[18, 230], [90, 230], [170, 230], [242, 230]]);
const trackBone = track([[252, 288], [320, 292], [392, 270], [438, 244]]);
const trackNerve = track([[488, 214], [524, 202], [562, 196]]);
const trackCoch = track([[634, 162], [730, 162], [826, 162], [906, 162]]);

const snd = pool(24, () => mk("circle", { class: "sc-p p-snd", r: 2.6 }, L.parts));
const bonep = pool(14, () => mk("circle", { class: "sc-p p-bonep", r: 2.4 }, L.parts));
const cochp = pool(20, () => mk("circle", { class: "sc-p p-cochp", r: 2.4 }, L.parts));
const nervep = pool(16, () => mk("circle", { class: "sc-p p-nervep", r: 2.6 }, L.parts));

function init() {
  /* ---- main ear, sound travelling left to right ---- */
  const E = L.ear;
  [26, 40].forEach((x, i) => { mk("path", { d: "M" + x + " 205 Q" + (x - 8) + " 230 " + x + " 255", fill: "none", stroke: "var(--c-fl)", "stroke-width": 2, opacity: 0.55 - i * 0.18 }, E); });
  mk("path", { class: "hr-pinna", d: "M78 148 C48 168 44 230 58 282 C66 312 88 326 102 318 C88 300 82 270 84 238 C86 205 92 178 104 162 C94 146 86 144 78 148 Z" }, E);
  mk("path", { d: "M76 178 C62 200 62 258 76 288", fill: "none", stroke: "var(--anatomy-mid)", "stroke-width": 1.4 }, E);
  mk("rect", { class: "hr-canal", x: 106, y: 208, width: 142, height: 44, rx: 10 }, E);
  mk("rect", { class: "hr-middle", x: 262, y: 168, width: 148, height: 124, rx: 12 }, E);
  tmG = mk("g", {}, E); mk("ellipse", { class: "hr-tm", cx: 250, cy: 230, rx: 7, ry: 48 }, tmG);
  malG = mk("g", {}, E); mk("ellipse", { class: "hr-bone", cx: 286, cy: 214, rx: 13, ry: 16 }, malG); mk("path", { class: "hr-bone", d: "M282 226 L258 236 L262 244 L286 234 Z" }, malG);
  incG = mk("g", {}, E); mk("ellipse", { class: "hr-bone", cx: 326, cy: 200, rx: 12, ry: 13 }, incG); mk("path", { class: "hr-bone", d: "M330 210 L352 224 L346 232 L324 220 Z" }, incG);
  stapG = mk("g", {}, E); mk("ellipse", { class: "hr-bone", cx: 368, cy: 220, rx: 10, ry: 11 }, stapG); mk("rect", { class: "hr-bone", x: 376, y: 214, width: 22, height: 12, rx: 4 }, stapG);
  mk("ellipse", { class: "hr-oval", cx: 410, cy: 230, rx: 8, ry: 19 }, E);
  plaque = mk("circle", { class: "hr-plaque", cx: 402, cy: 252, r: 10, opacity: 0 }, E);
  /* small cochlea with a spiral, then the auditory nerve to the right */
  mk("circle", { class: "hr-cochlea", cx: 458, cy: 230, r: 38 }, E);
  mk("path", { class: "hr-spiral", d: "M430 230 a28 28 0 1 1 28 28 a20 20 0 1 1 -20 -20 a12 12 0 1 1 12 12" }, E);
  implantG = mk("g", { opacity: 0 }, E);
  mk("path", { d: "M486 176 C472 186 464 198 460 212", fill: "none", stroke: "var(--c-bad)", "stroke-width": 1.6 }, implantG);
  mk("circle", { class: "hr-device", cx: 490, cy: 172, r: 9 }, implantG);
  [[446, 218], [466, 226], [458, 242], [442, 236], [454, 230]].forEach(([x, y]) => { mk("circle", { class: "hr-electrode", cx: x, cy: y, r: 3.2 }, implantG); });
  mk("path", { class: "hr-nerve", d: "M488 214 C515 202 540 198 562 196" }, E);
  mk("path", { d: "M562 196 l-12 -5 l1 10 Z", fill: "var(--c-plt)", stroke: "var(--c-plt)", "stroke-width": 1 }, E);
  aidDev = mk("g", { opacity: 0 }, E);
  mk("rect", { class: "hr-device", x: 100, y: 158, width: 16, height: 24, rx: 6 }, aidDev);
  mk("path", { d: "M108 158 C96 172 94 190 100 204", fill: "none", stroke: "var(--c-cyt2)", "stroke-width": 2.4 }, aidDev);

  /* ---- cochlea unrolled: basilar membrane and hair cells ---- */
  const C = L.coch;
  mk("path", { class: "hr-membrane", d: "M632 158 L912 166 L912 174 L632 178 Z" }, C);
  wavePath = mk("path", { class: "hr-wave", d: "M632 152 L912 152" }, C);
  for (let i = 0; i < 12; i++) {
    const g = mk("g", {}, C), x = 646 + i * 23;
    mk("path", { class: "hr-hair", d: "M-4 0 L0 -14 L4 0 Z" }, g);
    mk("circle", { class: "hr-hair", cx: 0, cy: -16, r: 2.6 }, g);
    hairs.push({ g, x, y: 158, i });
  }
  const t1 = mk("text", { class: "sc-lab", x: 632, y: 196 }, C); t1.textContent = "base: high pitch";
  const t2 = mk("text", { class: "sc-lab", x: 912, y: 196, "text-anchor": "end" }, C); t2.textContent = "apex: low pitch";

  /* ---- fork tests ---- */
  const F = L.fork;
  mk("path", { class: "hr-fork", d: "M646 300 L646 322 Q655 332 664 322 L664 300 M655 330 L655 344" }, F);
  const at = mk("text", { class: "sc-lab", x: 622, y: 358 }, F); at.textContent = "air";
  const bt = mk("text", { class: "sc-lab", x: 618, y: 382 }, F); bt.textContent = "bone";
  mk("rect", { class: "hr-bar-tr", x: 650, y: 348, width: 90, height: 10, rx: 5 }, F);
  rinneAirBar = mk("rect", { class: "hr-bar-air", x: 650, y: 348, width: 80, height: 10, rx: 5 }, F);
  mk("rect", { class: "hr-bar-tr", x: 650, y: 372, width: 90, height: 10, rx: 5 }, F);
  rinneBoneBar = mk("rect", { class: "hr-bar-bone", x: 650, y: 372, width: 80, height: 10, rx: 5 }, F);
  rinneTxt = mk("text", { class: "sc-lab", x: 608, y: 408 }, F); rinneTxt.textContent = "Rinne: air louder than bone";
  weberTxt = mk("text", { class: "sc-lab", x: 608, y: 428 }, F); weberTxt.textContent = "Weber: hears it in the middle";
  mk("circle", { class: "hr-head", cx: 835, cy: 368, r: 40 }, F);
  mk("ellipse", { class: "hr-earside", cx: 795, cy: 368, rx: 7, ry: 14 }, F);
  mk("ellipse", { class: "hr-earside", cx: 875, cy: 368, rx: 7, ry: 14 }, F);
  mk("circle", { cx: 875, cy: 368, r: 17, fill: "none", stroke: "var(--c-bad)", "stroke-width": 1.6 }, F);
  mk("path", { class: "hr-fork", d: "M826 296 L826 318 Q835 328 844 318 L844 296 M835 326 L835 330" }, F);
  weberAff = mk("path", { class: "hr-arrow", d: "M842 338 Q862 348 868 358 M868 358 l-9 -1 l4 8", opacity: 0 }, F);
  weberGood = mk("path", { class: "hr-arrow", d: "M828 338 Q808 348 802 358 M802 358 l9 -1 l-4 8", opacity: 0 }, F);

  /* ---- label pills: centres checked on a grid so pills do not overlap ---- */
  const o = L.over;
  pill(o, "Pinna", 78, 170, 78, 96, "Pinna: the visible external ear. It gathers sound and guides it into the ear canal.");
  pill(o, "Ear canal", 180, 208, 180, 130, "External ear canal: the tube from the pinna to the eardrum. Wax or blockage here causes conductive loss.");
  pill(o, "Eardrum", 250, 190, 260, 96, "Eardrum (tympanic membrane): the thin membrane at the end of the canal. Sound vibrates it. A perforation causes conductive loss.");
  pill(o, "Incus", 326, 188, 340, 130, "Incus: the middle ossicle. It passes vibration from the malleus to the stapes.");
  pill(o, "Oval window", 410, 212, 430, 130, "Oval window: the opening into the cochlea. The stapes footplate pushes here. In otosclerosis the stapes fixes at this window.");
  pill(o, "Auditory nerve", 520, 202, 505, 96, "Auditory nerve: carries signals from hair cells to the brain. Damage here is sensorineural loss.");
  pill(o, "Otosclerosis", 402, 252, 140, 350, "Otosclerosis: new bone fixes the stapes at the oval window, so air conduction falls while bone conduction stays. Shown when conductive loss is selected.");
  pill(o, "Malleus", 286, 230, 270, 350, "Malleus: the first ossicle, attached to the eardrum. It moves with the eardrum.");
  pill(o, "Stapes", 380, 226, 380, 350, "Stapes: the smallest ossicle. Its footplate pushes at the oval window. It is the ossicle fixed in otosclerosis.");
  pill(o, "Cochlea", 458, 262, 455, 350, "Cochlea: the spiral hearing organ. Fluid waves travel on the basilar membrane and hair cells turn them into nerve signals.");
  pill(o, "Basilar membrane", 700, 158, 710, 96, "Basilar membrane, unrolled: stiff at the base for high pitch, floppy at the apex for low pitch. This place code is tonotopy.");
  pill(o, "Hair cells", 850, 148, 850, 96, "Hair cells sit on the basilar membrane. Their hairs bend with the wave and start nerve signals. Noise and ageing injure them.");
  pill(o, "Noise damage", 800, 145, 700, 215, "Noise damage: loud sound injures hair cells, often for high pitch first. Air and bone conduction both fall. Shown in sensorineural loss.");
  pill(o, "Presbycusis", 650, 148, 860, 215, "Presbycusis: age related hair cell loss. High pitch at the base is affected first, so speech clarity falls. Shown in sensorineural loss.");
  pill(o, "Rinne test", 655, 330, 665, 295, "Rinne test: a tuning fork on the mastoid bone, then beside the ear. Normal and sensorineural: air louder than bone. Conductive: bone louder than air.");
  pill(o, "Weber test", 835, 318, 855, 295, "Weber test: a tuning fork in the middle of the forehead. Conductive loss: heard in the affected ear. Sensorineural loss: heard in the better ear.");
  const p1 = pill(o, "Hearing aid", 108, 170, 110, 400, "Hearing aid: amplifies sound in the ear canal. It helps when some hair cell function remains, in conductive and in sensorineural loss.");
  p1.setAttribute("id", "tx-aid");
  const p2 = pill(o, "Ossicle surgery", 380, 245, 280, 400, "Surgery for ossicular disease: repairs or replaces a fixed or damaged ossicle, for example the stapes in otosclerosis. It restores air conduction in conductive loss.");
  p2.setAttribute("id", "tx-surg");
  const p3 = pill(o, "Implant", 458, 250, 440, 400, "Cochlear implant: an electrode in the cochlea stimulates the auditory nerve directly, bypassing damaged hair cells in sensorineural loss.");
  p3.setAttribute("id", "tx-impl");

  /* ---- gauges ---- */
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const pt = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); pt.textContent = "The ear";
  [["air", "Air", "g-air", "Air conduction: sound through the canal, eardrum and ossicles to the cochlea. It falls in conductive and in sensorineural loss."], ["bone", "Bone", "g-bone", "Bone conduction: sound through the skull straight to the cochlea, bypassing canal and ossicles. It is preserved in conductive loss."], ["wave", "Basilar wave", "g-wave", "The travelling wave on the basilar membrane, set up by the stapes at the oval window and by bone conduction."], ["hair", "Hair cells", "g-hair", "Hair cell function in the cochlea. Noise damage and presbycusis reduce it, causing sensorineural loss."], ["nerve", "Nerve signal", "g-good", "Signal along the auditory nerve. A cochlear implant can restore it by direct stimulation when hair cells are damaged."], ["hear", "Hearing", "g-good", "Overall hearing in this schematic ear, from the sound that reaches the nerve by the air path or an implant."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 130 + i * 142, 486, 52, 18, cls, name, tip); });
}

function step(dt, m) {
  const k = Math.min(1, dt * 1.4);
  sm.air = lerp(sm.air, m.air, k); sm.bone = lerp(sm.bone, m.bone, k); sm.coch = lerp(sm.coch, m.coch, k);
  sm.waveEff = lerp(sm.waveEff, m.waveEff, k); sm.airHeard = lerp(sm.airHeard, m.airHeard, k); sm.boneHeard = lerp(sm.boneHeard, m.boneHeard, k);
  sm.nerve = lerp(sm.nerve, m.nerve, k); sm.hearing = lerp(sm.hearing, m.hearing, k);
  sm.aid = lerp(sm.aid, m.aid, k); sm.surg = lerp(sm.surg, m.surg, k); sm.impl = lerp(sm.impl, m.impl, k);
  sm.cond = lerp(sm.cond, m.cond, k); sm.sens = lerp(sm.sens, m.sens, k);

  /* eardrum and ossicles vibrate with the air path */
  const vib = Math.sin(tm / 80) * (0.6 + 2.6 * sm.air * (sm.aid ? 1.3 : 1));
  tmG.setAttribute("transform", "translate(" + f1(vib) + " 0)");
  malG.setAttribute("transform", "translate(" + f1(vib * 0.9) + " 0)");
  incG.setAttribute("transform", "translate(" + f1(vib * 0.8) + " 0)");
  stapG.setAttribute("transform", "translate(" + f1(vib * 0.9) + " 0)");
  plaque.setAttribute("opacity", (sm.cond * (sm.surg ? 0.3 : 0.95)).toFixed(2));
  aidDev.setAttribute("opacity", sm.aid.toFixed(2));
  implantG.setAttribute("opacity", sm.impl.toFixed(2));

  /* basilar wave and hair cells in the unrolled cochlea */
  let d = "";
  for (let i = 0; i <= 14; i++) {
    const u = i / 14, x = 632 + u * 280, env = Math.sin(u * 3.14);
    const y = 152 - env * (3 + 15 * sm.waveEff) * (0.65 + 0.35 * Math.sin(tm / 240 - u * 7));
    d += (i ? "L" : "M") + f1(x) + " " + f1(y) + " ";
  }
  wavePath.setAttribute("d", d);
  hairs.forEach((hc) => {
    const health = 1 - sm.sens * (hc.i < 5 ? 0.7 : 0.35);
    const rot = Math.sin(tm / 210 + hc.i * 0.8) * 11 * sm.waveEff * health;
    place(hc.g, hc.x, hc.y, rot, Math.max(0.35, health));
    hc.g.style.opacity = (0.35 + 0.65 * health).toFixed(2);
  });

  /* sound particles along the canal to the eardrum */
  acc.snd += dt * 8;
  while (acc.snd >= 1) { acc.snd--; const p = free(snd); if (p) emit(p, 0, 0, 0, 0, 0); }
  snd.forEach((p) => { if (!p.on) return; p.u += dt * 0.32; const pos = trackSnd.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(pos.x) + " " + f1(pos.y) + ")"); p.e.setAttribute("opacity", p.u > 0.9 ? clamp((1 - p.u) / 0.1).toFixed(2) : "1"); if (p.u >= 1) kill(p); });
  /* bone conduction particles through the skull side to the cochlea */
  acc.bonep += dt * sm.boneHeard * 5;
  while (acc.bonep >= 1) { acc.bonep--; const p = free(bonep); if (p) emit(p, 0, 0, 0, 0, 0); }
  bonep.forEach((p) => { if (!p.on) return; p.u += dt * 0.3; const pos = trackBone.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(pos.x) + " " + f1(pos.y) + ")"); if (p.u >= 1) kill(p); });
  /* wave particles along the basilar membrane */
  acc.cochp += dt * (1.5 + sm.waveEff * 8);
  while (acc.cochp >= 1) { acc.cochp--; const p = free(cochp); if (p) emit(p, 0, 0, 0, 0, 0); }
  cochp.forEach((p) => { if (!p.on) return; p.u += dt * 0.26; const pos = trackCoch.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(pos.x) + " " + f1(pos.y - Math.sin(p.u * 3.14) * 8 * sm.waveEff) + ")"); if (p.u >= 1) kill(p); });
  /* nerve pulses from the cochlea */
  acc.nervep += dt * sm.nerve * 9;
  while (acc.nervep >= 1) { acc.nervep--; const p = free(nervep); if (p) emit(p, 0, 0, 0, 0, 0); }
  nervep.forEach((p) => { if (!p.on) return; p.u += dt * 0.45; const pos = trackNerve.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(pos.x) + " " + f1(pos.y) + ")"); if (p.u >= 1) kill(p); });

  /* fork tests: bars, lateralisation arrows and result words */
  rinneAirBar.setAttribute("width", f1(Math.max(2, sm.airHeard * 90)));
  rinneBoneBar.setAttribute("width", f1(Math.max(2, sm.boneHeard * 90)));
  const rt = m.airHeard > m.boneHeard + 0.05 ? "Rinne: air louder than bone" : m.boneHeard > m.airHeard + 0.05 ? "Rinne: bone louder than air" : "Rinne: air and bone similar";
  if (rinneTxt.textContent !== rt) rinneTxt.textContent = rt;
  const wt = m.cond ? "Weber: hears it in the affected ear" : m.sens ? "Weber: hears it in the better ear" : "Weber: hears it in the middle";
  if (weberTxt.textContent !== wt) weberTxt.textContent = wt;
  weberAff.setAttribute("opacity", sm.cond.toFixed(2));
  weberGood.setAttribute("opacity", sm.sens.toFixed(2));

  /* treatment pills, only the active one shows */
  $("tx-aid").style.opacity = sm.aid.toFixed(2);
  $("tx-surg").style.opacity = sm.surg.toFixed(2);
  $("tx-impl").style.opacity = sm.impl.toFixed(2);

  gg.air.set(sm.airHeard, wordOf(sm.airHeard, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.bone.set(sm.boneHeard, wordOf(sm.boneHeard, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.wave.set(sm.waveEff, wordOf(sm.waveEff, 0.3, 0.65, ["small", "reduced", "full"]));
  gg.hair.set(sm.coch, wordOf(sm.coch, 0.35, 0.7, ["damaged", "reduced", "healthy"]));
  gg.nerve.set(sm.nerve, wordOf(sm.nerve, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.hear.set(sm.hearing, wordOf(sm.hearing, 0.35, 0.7, ["low", "reduced", "normal"]));
}
run({ init, step });
