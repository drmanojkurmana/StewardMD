/* Hearing scene: sound through the canal, eardrum and ossicles, cochlea wave and hair cells, auditory nerve and fork tests.
 * Each treatment acts on the drawing: a hearing aid sits in the canal and boosts incoming sound, surgery clears the fixed
 * stapes and bridges the gap with a prosthesis, and a cochlear implant sparks the nerve past damaged hair cells.
 * A caption line states what is happening. */
const L = { ear: $("ear"), coch: $("coch"), fork: $("fork"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { air: 1, bone: 1, coch: 0.95, waveEff: 0.9, airHeard: 0.95, boneHeard: 0.95, nerve: 0.95, hearing: 0.95, aid: 0, surg: 0, impl: 0, cond: 0, sens: 0 };
const gg = {};
const acc = { snd: 0, bonep: 0, cochp: 0, nervep: 0, stim: 0 };
let tmG = null, malG = null, incG = null, stapG = null, aidDev = null, aidBoost = null, plaque = null, prosthEl = null, healGlow = null, implantG = null, stimHalo = null, nerveHot = null, wavePath = null;
let rinneAirBar = null, rinneBoneBar = null, rinneTxt = null, weberTxt = null, weberAff = null, weberGood = null;
let capEl = null, capKey = "";
const hairs = [];

function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

const trackSnd = track([[18, 230], [90, 230], [170, 230], [242, 230]]);
const trackBone = track([[252, 288], [320, 292], [392, 270], [438, 244]]);
const trackNerve = track([[488, 214], [524, 202], [562, 196]]);
const trackStim = track([[452, 230], [480, 220], [488, 214], [524, 202], [562, 196]]);
const trackCoch = track([[634, 162], [730, 162], [826, 162], [906, 162]]);

const snd = pool(24, () => mk("circle", { class: "sc-p p-snd", r: 2.6 }, L.parts));
const bonep = pool(14, () => mk("circle", { class: "sc-p p-bonep", r: 2.4 }, L.parts));
const cochp = pool(20, () => mk("circle", { class: "sc-p p-cochp", r: 2.4 }, L.parts));
const nervep = pool(16, () => mk("circle", { class: "sc-p p-nervep", r: 2.6 }, L.parts));
const stim = pool(10, () => mk("circle", { class: "sc-p p-nervep", r: 2.6 }, L.parts));

function capText(l, d) {
  if (d === 3) {
    if (l === 2) return "Cochlear implant sparks the nerve directly. Hearing returns although hair cells stay damaged.";
    if (l === 1) return "Cochlear implant sparks the nerve directly. Hearing returns although the air path stays blocked.";
    return "Cochlear implant sparks the nerve directly. Hearing stays normal.";
  }
  if (d === 2) {
    if (l === 1) return "Surgery frees the stapes and bridges the gap. Sound reaches the cochlea again.";
    if (l === 2) return "Surgery repairs the ossicles, but the fault is deeper. Hearing stays low.";
    return "Surgery repairs the ossicles. Hearing stays normal.";
  }
  if (d === 1) {
    if (l === 2) return "Hearing aid makes canal sound bigger. Hearing improves a little.";
    if (l === 1) return "Hearing aid makes canal sound bigger. More sound gets through.";
    return "Hearing aid makes canal sound bigger. Hearing stays normal.";
  }
  if (l === 1) return "No treatment. The fixed stapes blocks sound. The cochlea hears little.";
  if (l === 2) return "No treatment. Damaged hair cells stay still. Little signal reaches the nerve.";
  return "No treatment. Sound shakes the ossicles and bends hair cells.";
}

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
  healGlow = mk("ellipse", { class: "hr-heal", cx: 402, cy: 232, rx: 26, ry: 22, opacity: 0 }, E);
  prosthEl = mk("g", { opacity: 0 }, E);
  mk("path", { class: "hr-prosth", d: "M350 221 L400 229" }, prosthEl);
  mk("circle", { class: "hr-cuff", cx: 400, cy: 229, r: 5.5 }, prosthEl);
  mk("circle", { class: "hr-glint", cx: 375, cy: 225, r: 2 }, prosthEl);
  /* small cochlea with a spiral, then the auditory nerve to the right */
  mk("circle", { class: "hr-cochlea", cx: 458, cy: 230, r: 38 }, E);
  mk("path", { class: "hr-spiral", d: "M430 230 a28 28 0 1 1 28 28 a20 20 0 1 1 -20 -20 a12 12 0 1 1 12 12" }, E);
  stimHalo = mk("ellipse", { class: "hr-halo", cx: 482, cy: 222, rx: 72, ry: 54, opacity: 0 }, E);
  implantG = mk("g", { opacity: 0 }, E);
  mk("path", { d: "M486 176 C472 186 464 198 460 212", fill: "none", stroke: "var(--c-bad)", "stroke-width": 1.6 }, implantG);
  mk("circle", { class: "hr-device", cx: 490, cy: 172, r: 9 }, implantG);
  [[446, 218], [466, 226], [458, 242], [442, 236], [454, 230]].forEach(([x, y]) => { mk("circle", { class: "hr-electrode", cx: x, cy: y, r: 3.2 }, implantG); });
  mk("path", { class: "hr-nerve", d: "M488 214 C515 202 540 198 562 196" }, E);
  nerveHot = mk("path", { class: "hr-nervehot", d: "M488 214 C515 202 540 198 562 196", opacity: 0 }, E);
  mk("path", { d: "M562 196 l-12 -5 l1 10 Z", fill: "var(--c-plt)", stroke: "var(--c-plt)", "stroke-width": 1 }, E);
  aidDev = mk("g", { opacity: 0 }, E);
  mk("rect", { class: "hr-device", x: 100, y: 158, width: 16, height: 24, rx: 6 }, aidDev);
  mk("path", { d: "M108 158 C96 172 94 190 100 204", fill: "none", stroke: "var(--c-cyt2)", "stroke-width": 2.4 }, aidDev);
  aidBoost = mk("g", { opacity: 0 }, E);
  ["M150 214 Q141 230 150 246", "M175 214 Q166 230 175 246", "M200 214 Q191 230 200 246"].forEach((d) => { mk("path", { class: "hr-boost", d }, aidBoost); });

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

  /* ---- label pills: eight short labels telling the story left to right ---- */
  const o = L.over;
  pill(o, "Sound", 115, 230, 132, 96, "Sound: the outer ear gathers sound and the canal guides it to the eardrum.");
  pill(o, "Eardrum", 250, 230, 250, 96, "Eardrum: sound vibrates this thin membrane. A hole in it causes conductive loss.");
  pill(o, "Ossicles", 330, 210, 340, 96, "Ossicles: malleus, incus and stapes pass vibration inward. A stapes fixed by extra bone blocks the air path.");
  pill(o, "Cochlea", 458, 230, 458, 96, "Cochlea: the spiral hearing organ. Movement at the oval window starts a wave inside.");
  pill(o, "Nerve", 525, 202, 530, 96, "Auditory nerve: carries signals from hair cells toward the brain. An implant can spark it directly.");
  pill(o, "Hair cells", 807, 148, 830, 96, "Hair cells sit on the membrane and bend with the wave. Loud sound and ageing injure them.");
  pill(o, "Rinne", 655, 322, 700, 282, "Rinne test: fork on the bone, then by the ear. Healthy ears hear air louder than bone.");
  pill(o, "Weber", 835, 336, 880, 300, "Weber test: fork on the forehead. Sound favours the poorly hearing ear in conductive loss.");
  capEl = mk("text", { class: "hr-cap", x: 30, y: 428 }, o); capEl.textContent = capText(0, 0);

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

  /* eardrum and ossicles vibrate with the air path, harder with an aid */
  const vib = Math.sin(tm / 80) * (0.6 + 2.6 * sm.air * (sm.aid ? 1.6 : 1));
  tmG.setAttribute("transform", "translate(" + f1(vib) + " 0)");
  malG.setAttribute("transform", "translate(" + f1(vib * 0.9) + " 0)");
  incG.setAttribute("transform", "translate(" + f1(vib * 0.8) + " 0)");
  stapG.setAttribute("transform", "translate(" + f1(vib * 0.9) + " 0)");
  /* surgery dissolves the bony plaque and a bright prosthesis bridges the gap */
  const ps = 1 - sm.surg;
  plaque.setAttribute("transform", "translate(" + f1(402 * (1 - ps)) + " " + f1(252 * (1 - ps)) + ") scale(" + ps.toFixed(3) + ")");
  plaque.setAttribute("opacity", (sm.cond * ps * 0.95).toFixed(2));
  prosthEl.setAttribute("opacity", sm.surg.toFixed(2));
  healGlow.setAttribute("opacity", (sm.surg * (0.3 + 0.14 * Math.sin(tm / 400))).toFixed(2));
  /* hearing aid sits in the canal and boosts incoming sound */
  aidDev.setAttribute("opacity", sm.aid.toFixed(2));
  aidBoost.setAttribute("opacity", sm.aid.toFixed(2));
  /* implant electrodes glow inside the cochlea and the nerve lights up */
  implantG.setAttribute("opacity", sm.impl.toFixed(2));
  stimHalo.setAttribute("opacity", (sm.impl * (0.375 + 0.075 * Math.sin(tm / 360))).toFixed(2));
  nerveHot.setAttribute("opacity", sm.impl.toFixed(2));

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

  /* sound particles along the canal to the eardrum, bigger and faster with an aid */
  acc.snd += dt * (8 + 6 * sm.aid);
  while (acc.snd >= 1) { acc.snd--; const p = free(snd); if (p) emit(p, 0, 0, 0, 0, 0); }
  snd.forEach((p) => { if (!p.on) return; p.u += dt * (0.32 + 0.2 * sm.aid); const pos = trackSnd.at(Math.min(1, p.u)); place(p.e, pos.x, pos.y, 0, 1 + 0.9 * sm.aid); p.e.setAttribute("opacity", p.u > 0.9 ? clamp((1 - p.u) / 0.1).toFixed(2) : "1"); if (p.u >= 1) kill(p); });
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
  /* implant stimulus sparks run from the electrodes to the nerve */
  acc.stim += dt * sm.impl * 10;
  while (acc.stim >= 1) { acc.stim--; const p = free(stim); if (p) emit(p, 0, 0, 0, 0, 0); }
  stim.forEach((p) => { if (!p.on) return; p.u += dt * 0.5; const pos = trackStim.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(pos.x) + " " + f1(pos.y) + ")"); if (p.u >= 1) kill(p); });

  /* fork tests: bars, lateralisation arrows and result words */
  rinneAirBar.setAttribute("width", f1(Math.max(2, sm.airHeard * 90)));
  rinneBoneBar.setAttribute("width", f1(Math.max(2, sm.boneHeard * 90)));
  const rt = m.airHeard > m.boneHeard + 0.05 ? "Rinne: air louder than bone" : m.boneHeard > m.airHeard + 0.05 ? "Rinne: bone louder than air" : "Rinne: air and bone similar";
  if (rinneTxt.textContent !== rt) rinneTxt.textContent = rt;
  const wt = m.cond ? "Weber: hears it in the affected ear" : m.sens ? "Weber: hears it in the better ear" : "Weber: hears it in the middle";
  if (weberTxt.textContent !== wt) weberTxt.textContent = wt;
  weberAff.setAttribute("opacity", sm.cond.toFixed(2));
  weberGood.setAttribute("opacity", sm.sens.toFixed(2));

  gg.air.set(sm.airHeard, wordOf(sm.airHeard, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.bone.set(sm.boneHeard, wordOf(sm.boneHeard, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.wave.set(sm.waveEff, wordOf(sm.waveEff, 0.3, 0.65, ["small", "reduced", "full"]));
  gg.hair.set(sm.coch, wordOf(sm.coch, 0.35, 0.7, ["damaged", "reduced", "healthy"]));
  gg.nerve.set(sm.nerve, wordOf(sm.nerve, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.hear.set(sm.hearing, wordOf(sm.hearing, 0.35, 0.7, ["low", "reduced", "normal"]));
  const key = level + "-" + drug;
  if (key !== capKey) { capKey = key; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
