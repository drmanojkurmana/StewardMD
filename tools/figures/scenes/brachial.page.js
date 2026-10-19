/* Brachial scene: neck to hand signals, injury block, posture, and visible splint and repair effects. */
const L = { parts: $("parts"), over: $("over"), panel: $("panel") };
const inj = [$("inj0"), $("inj1"), $("inj2"), $("inj3")];
const rep = [$("rep0"), $("rep1"), $("rep2"), $("rep3")];
const sprout = [$("sprout0"), $("sprout1"), $("sprout2"), $("sprout3")];
const sproutPaths = [];
sprout.forEach((g) => g.querySelectorAll("path").forEach((p) => sproutPaths.push(p)));
const healGlow = $("healGlow");
const forearmG = $("forearmG"), handG = $("handG"), normF = $("normF"), clawF = $("clawF"), splintEl = $("splintEl"), waiterArrow = $("waiterArrow"), physioArrow = $("physioArrow");
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const sig = pool(26, () => mk("circle", { class: "sc-p p-sig", r: 2.7 }, L.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("class", "sc-p p-sig"); p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const tracks = [
  track([[90, 115], [235, 135], [360, 120], [470, 135], [540, 90]]),
  track([[90, 275], [235, 255], [360, 270], [470, 255], [540, 240]]),
  track([[90, 195], [235, 195], [360, 180], [470, 195], [540, 140]]),
  track([[90, 235], [235, 255], [360, 270], [470, 255], [540, 240]]),
];
const blockTrack = [0, 1, 2, 3];
const blockU = [0.40, 0.41, 0.95, 0.95];
const SITES = [[235, 135], [235, 255], [540, 140], [540, 240]];
const POST = [
  { n: "Waiter's tip", info: "Waiter's tip in Erb palsy: upper trunk injury weakens shoulder lifting and elbow bending, so the arm hangs turned in with the wrist bent." },
  { n: "Claw hand", info: "Claw hand in Klumpke palsy: lower trunk injury stills the small hand muscles, so the fingers curl into a claw." },
  { n: "Wrist drop", info: "Wrist drop in radial nerve injury: wrist and finger straighteners fail, so the hand flops down at the wrist." },
  { n: "Ulnar claw", info: "Ulnar claw: ulnar nerve injury curls mainly the ring and little fingers, with numbness in the little finger." },
];
function capText(d, l) {
  if (d === 2) return "Nerve repair. Stitches join the fibres and new sprouts carry signals through again.";
  if (d === 1) return "Splint and physiotherapy. The brace holds a safe posture and exercise keeps joints mobile.";
  if (l === 1) return "Lower trunk injury with no treatment. Signals stop at the injury, so the fingers curl into claw hand.";
  if (l === 2) return "Radial nerve injury with no treatment. Signals stop at the injury, so the wrist flops in wrist drop.";
  if (l === 3) return "Ulnar nerve injury with no treatment. Signals stop at the injury, so two fingers curl in ulnar claw.";
  return "Upper trunk injury with no treatment. Signals stop at the injury, so the arm hangs in waiter's tip.";
}
const gg = {};
let postG = null, postT = null, postLvl = -1, splintPill = null, repairPill = null, capEl = null, capDrug = -1, capLvl = -1;
function initPanel() {
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["weak", "Weakness", "g-bad", "Loss of voluntary movement in the muscles supplied below the injury site."], ["sens", "Sensory loss", "g-sens", "Loss of feeling in the skin supplied by the injured trunk or nerve."], ["post", "Posture", "g-post", "How far the resting limb posture is deformed: waiter's tip, claw hand or wrist drop."], ["func", "Function", "g-good", "Overall use of the arm and hand for daily tasks."], ["rec", "Recovery", "g-rec", "Expected recovery of the injured fibres with the chosen treatment, shown qualitatively."], ["signal", "Nerve signal", "g-good", "How much signal still gets past the injury site toward the hand."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0, 60, 18, cls, name, tip); });
}
function init() {
  initPanel();
  const o = L.over;
  pill(o, "Neck roots", 90, 115, 90, 88, "Neck roots C5 to T1: the nerves leaving the neck. Which roots fail places the injury.");
  pill(o, "Trunks", 235, 135, 235, 98, "Upper, middle and lower trunks. Each splits into front and back divisions behind the collarbone, then joins into cords.");
  pill(o, "Cords", 470, 195, 470, 98, "Lateral, posterior and medial cords around the armpit artery. They give the five arm nerves.");
  pill(o, "Arm nerves", 540, 90, 620, 98, "Five arm nerves. The musculocutaneous bends the elbow, the radial straightens the wrist, the median opposes the thumb, the ulnar spreads the fingers and the axillary lifts the shoulder. Median injury gives ape hand with wasting at the thumb base.");
  pill(o, "Hand", 741, 332, 640, 296, "The hand shows the posture of the chosen injury. Watch it straighten when treatment starts working.");
  postG = pill(o, "Waiter's tip", 768, 386, 768, 412, POST[0].info);
  postT = postG.querySelector("text");
  splintPill = pill(o, "Splint", 784, 310, 872, 240, "Splint and physiotherapy: the brace holds a safe posture, as for wrist drop, while exercise keeps joints mobile and builds recovering muscle.");
  splintPill.style.opacity = "0";
  repairPill = pill(o, "Nerve repair", 540, 190, 872, 150, "Nerve repair: stitches join a cut nerve so fibres can regrow toward muscle. New sprouts carry signals through again.");
  repairPill.style.opacity = "0";
  capEl = mk("text", { class: "bp-cap", x: 30, y: 428 }, o); capEl.textContent = capText(0, 0);
}
const sm = { Weak: 0.8, Sens: 0.5, Deform: 0.8, Func: 0.3, Recov: 0.2, Signal: 0.35, splint: 0, repair: 0, lvl: [1, 0, 0, 0] };
const acc = { s: 0 };
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.Weak = lerp(sm.Weak, m.Weak, k2); sm.Sens = lerp(sm.Sens, m.Sens, k2); sm.Deform = lerp(sm.Deform, m.Deform, k2);
  sm.Func = lerp(sm.Func, m.Func, k2); sm.Recov = lerp(sm.Recov, m.Recov, k2); sm.Signal = lerp(sm.Signal, m.Signal, k2);
  sm.splint = lerp(sm.splint, m.splint, k1); sm.repair = lerp(sm.repair, m.repair, k1);
  for (let i = 0; i < 4; i++) sm.lvl[i] = lerp(sm.lvl[i], m.lvl === i ? 1 : 0, k1);
  const ease = 1 - 0.55 * sm.splint - 0.45 * sm.repair;
  inj.forEach((e, i) => { e.style.opacity = (sm.lvl[i] * (1 - 0.55 * sm.repair)).toFixed(2); e.classList.toggle("healed", sm.repair > 0.5 && sm.lvl[i] > 0.5); });
  rep.forEach((e, i) => { e.style.opacity = (sm.lvl[i] * sm.repair).toFixed(2); });
  sprout.forEach((e, i) => { e.style.opacity = (sm.lvl[i] * sm.repair).toFixed(2); });
  sproutPaths.forEach((p) => p.setAttribute("stroke-dashoffset", (100 * (1 - clamp(sm.repair * 1.2))).toFixed(1)));
  healGlow.setAttribute("cx", f1(SITES[0][0] * sm.lvl[0] + SITES[1][0] * sm.lvl[1] + SITES[2][0] * sm.lvl[2] + SITES[3][0] * sm.lvl[3]));
  healGlow.setAttribute("cy", f1(SITES[0][1] * sm.lvl[0] + SITES[1][1] * sm.lvl[1] + SITES[2][1] * sm.lvl[2] + SITES[3][1] * sm.lvl[3]));
  healGlow.setAttribute("opacity", (sm.repair * 0.55).toFixed(2));
  const claw = Math.max(sm.lvl[1], sm.lvl[3]) * ease;
  forearmG.setAttribute("transform", "rotate(" + f1(-26 * sm.lvl[0] * ease) + " 768 215)");
  handG.setAttribute("transform", "rotate(" + f1(56 * sm.lvl[2] * ease) + " 768 302)");
  normF.style.opacity = (1 - claw).toFixed(2);
  clawF.style.opacity = claw.toFixed(2);
  splintEl.style.opacity = (sm.splint * 0.95).toFixed(2);
  waiterArrow.style.opacity = (sm.lvl[0] * (1 - 0.4 * sm.splint)).toFixed(2);
  physioArrow.setAttribute("opacity", (sm.splint * (0.55 + 0.25 * Math.sin(tm / 300))).toFixed(2));
  physioArrow.setAttribute("stroke-dashoffset", f1(-tm / 40));
  if (level !== postLvl) { postLvl = level; postT.textContent = POST[level].n; postG.setAttribute("data-info", POST[level].info); }
  splintPill.style.opacity = sm.splint.toFixed(2);
  repairPill.style.opacity = sm.repair.toFixed(2);
  if (drug !== capDrug || level !== capLvl) { capDrug = drug; capLvl = level; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
  acc.s += dt * (8 + 6 * sm.Signal); while (acc.s >= 1) { acc.s--; const p = free(sig); if (p) emit(p, 0, 0, 0, 0, Math.floor(Math.random() * 4)); }
  sig.forEach((p) => {
    if (!p.on) return; p.t += dt; p.u += dt * 0.16 * (0.5 + 0.5 * sm.Signal + 0.3); const tr = tracks[p.k], pos = tr.at(p.u);
    p.x = clamp(pos.x, 30, 560); p.y = clamp(pos.y, 60, 430); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    const injured = blockTrack[m.lvl] === p.k, beyond = injured && p.u > blockU[m.lvl];
    if (beyond && sm.repair > 0.5) { p.e.setAttribute("class", "sc-p p-sig2"); p.e.setAttribute("opacity", "1"); }
    else { p.e.setAttribute("class", "sc-p p-sig"); p.e.setAttribute("opacity", beyond ? clamp(0.1 + sm.Recov * 0.7).toFixed(2) : "1"); }
    if (p.u > 1 || p.t > 9) kill(p);
  });
  gg.weak.set(sm.Weak, wordOf(sm.Weak, 0.35, 0.65, ["mild", "moderate", "severe"]));
  gg.sens.set(sm.Sens, wordOf(sm.Sens, 0.35, 0.65, ["preserved", "reduced", "lost"]));
  gg.post.set(sm.Deform, wordOf(sm.Deform, 0.35, 0.65, ["straight", "altered", "deformed"]));
  gg.func.set(sm.Func, wordOf(sm.Func, 0.35, 0.65, ["poor", "reduced", "good"]));
  gg.rec.set(sm.Recov, wordOf(sm.Recov, 0.3, 0.6, ["slow", "fair", "good"]));
  gg.signal.set(sm.Signal, wordOf(sm.Signal, 0.35, 0.65, ["blocked", "reduced", "passing"]));
}
run({ init, step });
