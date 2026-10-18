/* Brachial scene: signals along the plexus, injury rings, limb posture and gauges. */
const L = { parts: $("parts"), over: $("over"), panel: $("panel") };
const inj = [$("inj0"), $("inj1"), $("inj2"), $("inj3")];
const rep = [$("rep0"), $("rep1"), $("rep2"), $("rep3")];
const forearmG = $("forearmG"), handG = $("handG"), normF = $("normF"), clawF = $("clawF"), splintEl = $("splintEl"), waiterArrow = $("waiterArrow");
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const sig = pool(26, () => mk("circle", { class: "sc-p p-sig", r: 2.7 }, L.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const tracks = [
  track([[90, 115], [235, 135], [360, 120], [470, 135], [540, 90]]),
  track([[90, 275], [235, 255], [360, 270], [470, 255], [540, 240]]),
  track([[90, 195], [235, 195], [360, 180], [470, 195], [540, 140]]),
  track([[90, 235], [235, 255], [360, 270], [470, 255], [540, 240]]),
];
const blockTrack = [0, 1, 2, 3];
const blockU = [0.34, 0.34, 0.86, 0.86];
const gg = {};
let posturePills = [], treatPills = [];
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
  pill(o, "Roots", 90, 115, 90, 88, "Roots C5 to T1: ventral rami leaving the neck. Their pattern of loss places the level of a plexus injury.");
  pill(o, "Upper trunk", 235, 135, 235, 98, "Upper trunk, C5 and C6. Injury here gives Erb palsy: weak shoulder abduction and elbow flexion with a waiter's tip posture.");
  pill(o, "Divisions", 360, 180, 365, 98, "Divisions: each trunk splits into anterior and posterior divisions behind the clavicle, then recombines into cords.");
  pill(o, "Cords", 470, 195, 470, 98, "Lateral, posterior and medial cords, named around the axillary artery. Cords give off the main branches to the arm.");
  pill(o, "Branches", 540, 190, 530, 98, "Terminal branches to the arm: musculocutaneous, radial, median, ulnar and axillary nerves.");
  pill(o, "Radial nerve", 540, 140, 120, 392, "Radial nerve, from the posterior cord. Injury weakens wrist and finger extension and gives wrist drop, with sensory loss on the back of the hand.");
  pill(o, "Median nerve", 540, 190, 260, 392, "Median nerve, from lateral and medial cords. Injury wastes the thenar muscles, loses thumb opposition (ape hand) and loses feeling in the lateral palm and fingers.");
  pill(o, "Ulnar nerve", 540, 240, 400, 392, "Ulnar nerve, from the medial cord. Injury weakens intrinsic hand muscles, gives an ulnar claw of ring and little fingers, and loses feeling in the little finger.");
  pill(o, "Musculocut.", 540, 90, 510, 392, "Musculocutaneous nerve, from the lateral cord. It flexes the elbow and supplies feeling to the lateral forearm.");
  posturePills = [
    pill(o, "Waiter's tip", 768, 330, 768, 395, "Waiter's tip posture in Erb palsy: the arm hangs adducted and turned in, forearm pronated, as if asking for a tip."),
    pill(o, "Claw hand", 768, 330, 768, 395, "Claw hand in Klumpke palsy: lower trunk injury paralyses intrinsic hand muscles, so long flexors and extensors unbalance the fingers into clawing."),
    pill(o, "Wrist drop", 768, 330, 768, 395, "Wrist drop in radial nerve injury: wrist and finger extensors fail, so the hand flops into flexion at the wrist."),
    pill(o, "Ulnar claw", 768, 330, 768, 395, "Ulnar claw: ulnar injury claws mainly the ring and little fingers, with sensory loss in the little finger."),
  ];
  posturePills.forEach((p, i) => p.setAttribute("id", "post" + i));
  treatPills = [
    pill(o, "Splint", 768, 300, 855, 110, "Splint and physiotherapy: a splint holds a safe posture (for example wrist supported in extension) while therapy keeps joints mobile and strengthens recovering muscle."),
    pill(o, "Nerve repair", 540, 140, 855, 110, "Nerve repair: a divided or severely injured nerve is repaired or grafted so fibres can regrow toward the muscle. Shown as green suture marks at the injury site."),
  ];
  treatPills.forEach((p, i) => p.setAttribute("id", "treat" + i));
}
const sm = { Weak: 0.8, Sens: 0.5, Deform: 0.8, Func: 0.3, Recov: 0.2, Signal: 0.35, splint: 0, repair: 0, lvl: [1, 0, 0, 0] };
const acc = { s: 0 };
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.Weak = lerp(sm.Weak, m.Weak, k2); sm.Sens = lerp(sm.Sens, m.Sens, k2); sm.Deform = lerp(sm.Deform, m.Deform, k2);
  sm.Func = lerp(sm.Func, m.Func, k2); sm.Recov = lerp(sm.Recov, m.Recov, k2); sm.Signal = lerp(sm.Signal, m.Signal, k2);
  sm.splint = lerp(sm.splint, m.splint, k1); sm.repair = lerp(sm.repair, m.repair, k1);
  for (let i = 0; i < 4; i++) sm.lvl[i] = lerp(sm.lvl[i], m.lvl === i ? 1 : 0, k1);
  inj.forEach((e, i) => { e.style.opacity = (sm.lvl[i] * 0.95).toFixed(2); });
  rep.forEach((e, i) => { e.style.opacity = (sm.lvl[i] * sm.repair).toFixed(2); });
  const claw = Math.max(sm.lvl[1], sm.lvl[3]);
  forearmG.setAttribute("transform", "rotate(" + f1(-26 * sm.lvl[0]) + " 768 215)");
  handG.setAttribute("transform", "rotate(" + f1(56 * sm.lvl[2]) + " 768 302)");
  normF.style.opacity = (1 - claw).toFixed(2);
  clawF.style.opacity = claw.toFixed(2);
  splintEl.style.opacity = (sm.splint * 0.9).toFixed(2);
  waiterArrow.style.opacity = (sm.lvl[0] * 0.95).toFixed(2);
  posturePills.forEach((p, i) => { p.style.opacity = sm.lvl[i].toFixed(2); });
  treatPills[0].style.opacity = sm.splint.toFixed(2);
  treatPills[1].style.opacity = sm.repair.toFixed(2);
  acc.s += dt * 9; while (acc.s >= 1) { acc.s--; const p = free(sig); if (p) emit(p, 0, 0, 0, 0, Math.floor(Math.random() * 4)); }
  sig.forEach((p) => { if (!p.on) return; p.t += dt; p.u += dt * 0.16 * (0.5 + 0.5 * sm.Signal + 0.3); const tr = tracks[p.k], pos = tr.at(p.u); p.x = clamp(pos.x, 30, 560); p.y = clamp(pos.y, 60, 430); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); const injured = blockTrack[m.lvl] === p.k, beyond = injured && p.u > blockU[m.lvl]; p.e.setAttribute("opacity", beyond ? clamp(0.12 + sm.Recov * 0.7).toFixed(2) : "1"); if (p.u > 1 || p.t > 9) kill(p); });
  gg.weak.set(sm.Weak, wordOf(sm.Weak, 0.35, 0.65, ["mild", "moderate", "severe"]));
  gg.sens.set(sm.Sens, wordOf(sm.Sens, 0.35, 0.65, ["preserved", "reduced", "lost"]));
  gg.post.set(sm.Deform, wordOf(sm.Deform, 0.35, 0.65, ["straight", "altered", "deformed"]));
  gg.func.set(sm.Func, wordOf(sm.Func, 0.35, 0.65, ["poor", "reduced", "good"]));
  gg.rec.set(sm.Recov, wordOf(sm.Recov, 0.3, 0.6, ["slow", "fair", "good"]));
  gg.signal.set(sm.Signal, wordOf(sm.Signal, 0.35, 0.65, ["blocked", "reduced", "passing"]));
}
run({ init, step });
