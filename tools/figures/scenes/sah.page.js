/* SAH scene: berry aneurysm rupture, blood in the subarachnoid space, vasospasm, delayed ischaemia, hydrocephalus and the gauges. */
const L = { isch: $("isch"), vent: $("vent"), artL: $("artL"), bloodL: $("bloodL"), aneurL: $("aneurL"), drainG: $("drainG"), burst: $("burst"), willis: $("willis"), aneurR: $("aneurR"), bloodR: $("bloodR"), secureG: $("secureG"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { B: 0.9, V: 0.1, Hy: 0.1, R: 0.9, Is: 0, ICP: 0.6, Hd: 0.8, secure: 0, nimo: 0, drain: 0 };
let ventG, ischEl, burstG, drainEl, secureEl, blockEl, ringL, ringR, sacR, sacL;
const artEls = [];
let gg = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const blood = pool(38, () => mk("circle", { class: "sc-p p-blood", r: 2.6 }, L.parts));
const csf = pool(10, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.parts));
const acc = { b: 0, c: 0 };
function init() {
  /* left: ischaemic territory, ventricles, cerebral arteries, aneurysm at the base */
  ischEl = mk("ellipse", { class: "sah-isch", cx: 450, cy: 250, rx: 62, ry: 78, opacity: "0" }, L.isch);
  ventG = mk("g", {}, L.vent);
  mk("path", { class: "sah-vent", d: "M0 -28C-18 -36 -30 -20 -26 -2C-23 12 -8 18 0 8C8 18 23 12 26 -2C30 -20 18 -36 0 -28Z" }, ventG);
  [["M130 300C220 240 300 190 500 160", 7], ["M150 180C260 220 380 260 505 300", 6], ["M200 330C280 280 360 250 480 230", 5]].forEach(([d, w]) => { const e = mk("path", { class: "sah-art", d: d }, L.artL); e.setAttribute("stroke-width", w); artEls.push({ e, w }); });
  ringL = mk("ellipse", { class: "sah-ringstroke", cx: 315, cy: 245, rx: 234, ry: 123 }, L.bloodL); ringL.setAttribute("stroke-width", "26");
  sacL = mk("g", {}, L.aneurL); mk("circle", { class: "sah-aneur", r: 13 }, sacL); mk("rect", { class: "sah-aneur", x: -4, y: 8, width: 8, height: 12 }, sacL); place(sacL, 315, 358, 0, 1);
  /* headache burst */
  burstG = mk("g", {}, L.burst);
  mk("path", { class: "sah-burst", d: "M0 -16L5 -5L-3 -3L7 8M-14 -10L-8 -4M14 -12L9 -5M-16 4L-9 3" }, burstG);
  /* CSF drain: catheter from the ventricle out to a small bag */
  drainEl = mk("g", { opacity: "0" }, L.drainG);
  mk("path", { class: "sah-drain", d: "M330 232C340 185 355 150 366 118C372 98 395 78 424 68" }, drainEl);
  mk("rect", { class: "sah-bag", x: 424, y: 54, width: 28, height: 26, rx: 4 }, drainEl);
  /* blocked CSF outlet marker */
  blockEl = mk("g", { opacity: "0" }, L.vent);
  mk("circle", { class: "sah-block", cx: 315, cy: 292, r: 8 }, blockEl);
  mk("path", { class: "sah-coil", d: "M311 288L319 296M319 288L311 296" }, blockEl);
  /* right: circle of Willis, basilar trunk, berry aneurysm */
  ringR = mk("ellipse", { class: "sah-ringstroke", cx: 785, cy: 260, rx: 92, ry: 86 }, L.bloodR); ringR.setAttribute("stroke-width", "20");
  const ring = mk("circle", { class: "sah-art", cx: 785, cy: 260, r: 70 }, L.willis); ring.setAttribute("stroke-width", "10"); artEls.push({ e: ring, w: 10 });
  [["M730 205C710 190 695 180 682 262", 6], ["M840 205C855 190 868 180 882 262", 6], ["M715 260H680", 6], ["M855 260H890", 6], ["M785 330V382", 9]].forEach(([d, w]) => { const e = mk("path", { class: "sah-art", d: d }, L.willis); e.setAttribute("stroke-width", w); artEls.push({ e, w }); });
  sacR = mk("g", {}, L.aneurR);
  mk("circle", { class: "sah-aneur", r: 27 }, sacR); mk("rect", { class: "sah-aneur", x: -7, y: 20, width: 14, height: 24 }, sacR); place(sacR, 785, 168, 0, 1);
  secureEl = mk("g", { opacity: "0" }, L.secureG);
  const sg = mk("g", {}, secureEl);
  mk("circle", { class: "sah-coil", r: 15 }, sg); mk("circle", { class: "sah-coil", r: 9, cx: 4, cy: 3 }, sg); mk("circle", { class: "sah-coil", r: 4.5, cx: -3, cy: -2 }, sg);
  mk("rect", { class: "sah-clip", x: -24, y: 24, width: 48, height: 7, rx: 3 }, sg);
  mk("rect", { class: "sah-seal", x: -10, y: 18, width: 20, height: 8, rx: 3 }, sg);
  place(sg, 785, 168, 0, 1);
  /* labels */
  const o = L.over;
  pill(o, "Brain", 180, 155, 150, 92, "Brain tissue. The territory fed by a narrowed artery can become ischaemic and then infarct, leaving focal neurologic deficits such as motor weakness.");
  pill(o, "Subarachnoid blood", 250, 120, 285, 92, "Blood from the ruptured aneurysm spreads through the subarachnoid space, the cerebrospinal fluid space around the brain. Its breakdown products later provoke vasospasm.");
  pill(o, "Vasospasm", 150, 285, 80, 410, "Vasospasm: cerebral arteries narrowed by blood around them. It develops over the days following the bleed and can cause delayed cerebral ischaemia.");
  pill(o, "Ventricles", 315, 252, 215, 410, "Ventricles: the fluid spaces inside the brain. When blood blocks cerebrospinal fluid flow and absorption they enlarge, which is hydrocephalus, and pressure rises.");
  pill(o, "Delayed ischaemia", 450, 250, 430, 410, "Delayed cerebral ischaemia: days after the bleed, narrowed arteries starve part of the brain. New focal deficits, including weakness, are the warning sign, and infarction can follow over the following weeks of recovery.");
  pill(o, "Berry aneurysm", 785, 160, 785, 100, "A berry aneurysm: a thin walled sac at a branching point of the circle of Willis. Rupture floods the subarachnoid space, and rerupture is often fatal, so it is secured early once found on angiography.");
  pill(o, "Circle of Willis", 725, 305, 675, 340, "The circle of Willis: the ring of arteries at the base of the brain, seen here magnified. Most berry aneurysms form at its branching points.");
  pill(o, "Basilar artery", 785, 362, 785, 408, "The basilar artery, formed by the vertebral arteries, supplies the brainstem and joins the circle of Willis. Aneurysms here are less common but can also rupture.");
  const ps = pill(o, "Clip or coil", 796, 198, 880, 150, "Securing the aneurysm: a surgical clip across its neck, or endovascular coiling techniques that fill the sac from inside the artery. Either seals it against rerupture."); ps.setAttribute("id", "p-secure"); ps.style.opacity = 0;
  const pn = pill(o, "Nimodipine", 845, 282, 890, 295, "Nimodipine: a calcium channel blocker given after aneurysmal bleeding. It lessens delayed ischaemia and improves outcome, but it does not seal the aneurysm."); pn.setAttribute("id", "p-nimo"); pn.style.opacity = 0;
  const pd = pill(o, "CSF drain", 366, 118, 445, 92, "Cerebrospinal fluid drainage: an external drain lowers pressure and relieves hydrocephalus by letting fluid out of the ventricles."); pd.setAttribute("id", "p-drain"); pd.style.opacity = 0;
  /* gauges */
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["blood", "CSF blood", "g-bad", "How much blood is sitting in the subarachnoid space. More blood means a higher grade of bleed and a greater risk of vasospasm."], ["head", "Headache", "g-pain", "Headache from the bleed: typically a thunderclap headache, worst at onset, with vomiting and sometimes collapse."], ["icp", "Pressure", "g-cyt", "Pressure inside the skull. It rises with the bleed itself and again when hydrocephalus develops, and it threatens brain perfusion."], ["vaso", "Vasospasm", "g-clot", "Narrowing of cerebral arteries by blood around them, developing in the first days following rupture and peaking around day 4 to day 10."], ["isch", "Ischaemia", "g-isch", "Brain starved of blood by vasospasm: delayed cerebral ischaemia, with focal neurologic deficits that can progress to infarction."], ["vent", "Ventricles", "g-fl", "Size of the ventricles. Enlargement is hydrocephalus, caused by blood blocking cerebrospinal fluid flow and absorption, relieved by drainage."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0, 60, 18, cls, name, tip); });
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["secure", "nimo", "drain"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  ["B", "V", "Hy", "R", "Is", "ICP", "Hd"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k2); });
  /* ventricles, ischaemia, blocked outlet, headache */
  place(ventG, 315, 245, 0, 0.65 + 0.85 * sm.Hy);
  ischEl.setAttribute("opacity", (sm.Is * 0.55).toFixed(2));
  blockEl.setAttribute("opacity", clamp(sm.Hy - 0.55 * sm.drain).toFixed(2));
  place(burstG, 108, 142, 0, 0.8 + 0.3 * sm.Hd + 0.08 * Math.sin(tm / 220));
  burstG.setAttribute("opacity", clamp(sm.Hd * 1.1).toFixed(2));
  /* arteries narrow with vasospasm; aneurysm sacs pulse while open */
  artEls.forEach((a) => a.e.setAttribute("stroke-width", f1(Math.max(2, a.w * (1 - 0.52 * sm.V)))));
  const pulse = 1 + 0.05 * Math.sin(tm / 300) * (1 - sm.secure);
  place(sacR, 785, 168, 0, pulse); place(sacL, 315, 358, 0, pulse);
  ringL.setAttribute("opacity", (sm.B * 0.4).toFixed(2)); ringR.setAttribute("opacity", (sm.B * 0.4).toFixed(2));
  secureEl.setAttribute("opacity", sm.secure.toFixed(2));
  drainEl.setAttribute("opacity", sm.drain.toFixed(2));
  /* blood particles circulating in the subarachnoid space */
  acc.b += dt * (3 + 7 * sm.B + 6 * sm.R * (1 - sm.secure));
  while (acc.b >= 1) { acc.b--; const p = free(blood); if (p) { emit(p, 0, 0, 0, 0, Math.random() < 0.62 ? 0 : 1); p.x = rnd(0, 6.28); p.y = rnd(-7, 7); } }
  blood.forEach((p) => { if (!p.on) return; p.t += dt; p.x += dt * 0.22;
    const px = p.k === 0 ? 315 + Math.cos(p.x) * (234 + p.y) : 785 + Math.cos(p.x) * (92 + p.y);
    const py = p.k === 0 ? 245 + Math.sin(p.x) * (123 + p.y * 0.6) : 260 + Math.sin(p.x) * (86 + p.y * 0.6);
    p.e.setAttribute("transform", "translate(" + f1(clamp(px, 30, 930)) + " " + f1(clamp(py, 58, 428)) + ")");
    p.e.setAttribute("opacity", clamp(Math.min(p.t * 2, 1 - (p.t - 4) / 1.5) * (0.35 + 0.65 * sm.B)).toFixed(2));
    if (p.t > 5.5) kill(p); });
  /* CSF droplets travelling up the drain */
  acc.c += dt * sm.drain * 5;
  while (acc.c >= 1) { acc.c--; const p = free(csf); if (p) emit(p, 332, 228, 0, 0, 0); }
  csf.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (368 - p.x) * dt * 0.8 + 6 * dt; p.y -= 42 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 84 || p.t > 3.4) kill(p); });
  /* treatment pills */
  $("p-secure").style.opacity = sm.secure.toFixed(2); $("p-nimo").style.opacity = sm.nimo.toFixed(2); $("p-drain").style.opacity = sm.drain.toFixed(2);
  /* gauges */
  gg.blood.set(sm.B, wordOf(sm.B, 0.3, 0.65, ["clearing", "present", "heavy"]));
  gg.head.set(sm.Hd, wordOf(sm.Hd, 0.3, 0.65, ["settling", "present", "thunderclap"]));
  gg.icp.set(sm.ICP, wordOf(sm.ICP, 0.3, 0.65, ["normal", "raised", "high"]));
  gg.vaso.set(sm.V, wordOf(sm.V, 0.25, 0.6, ["absent", "developing", "severe"]));
  gg.isch.set(sm.Is, wordOf(sm.Is, 0.25, 0.55, ["none", "developing", "established"]));
  gg.vent.set(sm.Hy, wordOf(sm.Hy, 0.3, 0.65, ["normal", "enlarging", "dilated"]));
}
run({ init, step });
