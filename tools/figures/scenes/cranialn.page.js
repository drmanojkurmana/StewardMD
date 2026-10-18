/* Cranial nerves scene: nuclei and exits, signal flow, and eye, face, throat and tongue lesion signs. */
const layers = { nerves: $("nerves"), nuc: $("nuclei"), parts: $("parts"), facefx: $("facefx"), over: $("over"), panel: $("panel"), block: $("blockMk"), glow: $("lesGlow"), bolts: $("bolts"), flush: $("flush"), shield: $("shieldMk"), drop1: $("drop1"), drop2: $("drop2") };
const NERVES = [
  { n: "I", grp: 0, pts: [[335, 105], [470, 95], [640, 140], [742, 226]], nuc: [250, 105], tip: "First nerve: smell. Fibers from the nose reach the bulb under the front of the brain. A blocked path dulls smell." },
  { n: "II", grp: 0, pts: [[335, 135], [460, 130], [620, 160], [728, 188]], nuc: [272, 135], tip: "Second nerve: vision. Fibers from the retina carry light and form to the brain. A blocked path dims vision." },
  { n: "III", grp: 1, pts: [[290, 210], [450, 205], [620, 185], [730, 190]], nuc: [262, 210], tip: "Third nerve: moves most eye muscles, lifts the lid, and narrows the pupil. A block leaves the eye down and out with a wide pupil and a drooping lid." },
  { n: "IV", grp: 1, pts: [[290, 230], [450, 225], [620, 205], [734, 196]], nuc: [248, 230], tip: "Fourth nerve: one muscle that turns the eye down and in. A block gives double vision that is worse looking down." },
  { n: "V", grp: 2, pts: [[290, 258], [470, 255], [620, 255], [726, 258]], nuc: [248, 258], tip: "Fifth nerve: feeling in the face and chewing muscles. Its ganglion dot holds the sensory cell bodies. Pressure here fires brief severe pain." },
  { n: "VI", grp: 1, pts: [[290, 272], [460, 262], [625, 225], [738, 198]], nuc: [262, 272], tip: "Sixth nerve: one muscle that turns the eye out. A block keeps the eye from moving out, so it rests turned in." },
  { n: "VII", grp: 2, pts: [[290, 288], [470, 286], [640, 284], [748, 282]], nuc: [248, 288], tip: "Seventh nerve: face movement, taste from the front of the tongue, and tears. A lower block weakens the whole face and leaves the eye open." },
  { n: "VIII", grp: 0, pts: [[290, 302], [470, 292], [600, 262], [676, 238]], nuc: [262, 302], tip: "Eighth nerve: hearing and balance. A block brings hearing loss, ringing, or a spinning feeling." },
  { n: "IX", grp: 3, pts: [[292, 330], [470, 322], [640, 322], [752, 330]], nuc: [248, 330], tip: "Ninth nerve: taste from the back of the tongue and feeling in the throat. A block weakens swallowing and the gag reflex." },
  { n: "X", grp: 3, pts: [[292, 348], [480, 352], [650, 360], [758, 392]], nuc: [262, 348], tip: "Tenth nerve: voice, palate, and swallow. A block brings a hoarse voice and food going down the wrong way." },
  { n: "XI", grp: 3, pts: [[292, 364], [480, 368], [660, 352], [820, 330]], nuc: [248, 364], tip: "Eleventh nerve: neck and shoulder muscles. A block weakens head turning and the shoulder shrug." },
  { n: "XII", grp: 3, pts: [[292, 378], [480, 366], [650, 335], [762, 314]], nuc: [272, 376], tip: "Twelfth nerve: tongue muscles. A weak tongue points to the weak side when it comes out." },
];
const BLOCK_POS = [[520, 120], [520, 197], [430, 270], [520, 360]];
const GLOW_POS = [[735, 170], [735, 195], [712, 262], [766, 330]];
const GLOW_STR = [0.5, 1, 1, 0.8];
const tracks = NERVES.map((nv) => track(nv.pts));
const nerveEls = [], nucEls = [];
let gangEl, capEl = null, capKey = "";
const fx = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const sigs = pool(30, () => mk("circle", { class: "sc-p p-sig", r: 2.6 }, layers.parts));
const gg = {};
const sm = { sig: 0.3, fn: 0.3, pain: 0.2, risk: 0.8, grp: 1, treat: 0, shield: 0 };
function capText(g, d) {
  if (g === 0) {
    if (d === 2) return "Cause treated. Pressure eases and the senses recover.";
    if (d === 1) return "Eye care only guards the cornea. The senses stay weak.";
    return "No treatment. Smell, sight and balance signals stay weak.";
  }
  if (g === 1) {
    if (d === 2) return "Cause treated. The block lifts. The eye moves and the lid rises.";
    if (d === 1) return "Eye protected. Drops and a shield guard the cornea while the nerve is weak.";
    return "No treatment. The eye nerve is blocked. The eye turns and the lid droops.";
  }
  if (g === 2) {
    if (d === 2) return "Cause treated. Pressure eases. Droop lifts and pain fades.";
    if (d === 1) return "Eye protected. The cornea is guarded but pain and droop remain.";
    return "No treatment. The face nerve is blocked. The face droops and pain fires.";
  }
  if (d === 2) return "Cause treated. Voice and swallow recover and the tongue straightens.";
  if (d === 1) return "Eye care does not help swallowing. Signals stay weak.";
  return "No treatment. Throat and tongue signals stay weak. Swallowing is unsafe.";
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [140, 340, 540, 740];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "What the patient shows";
  [["sig", "Signal", "g-good", "Signal: how well impulses travel along the highlighted nerve group. The block slows them. Treating the cause restores flow."], ["fn", "Function", "g-fn", "Function: what the target can still do. Eye movement, face movement, voice, swallow, or tongue. It recovers as the block lifts."], ["pain", "Pain", "g-pain", "Pain: brief severe face shocks from trigeminal pressure. Treating the cause calms them. Eye care alone does not."], ["risk", "Risk", "g-bad", "Risk: harm from the lesion, such as a drying cornea or food going down the wrong way. Eye care guards the cornea."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Brainstem", 205, 290, 105, 150, "Brainstem: midbrain, pons and medulla. Most cranial nerve nuclei sit here in a column. One small stroke here can weaken several nerves at once.");
  pill(ox, "Special senses", 420, 115, 470, 66, "Special senses: smell (first nerve), vision (second) and hearing and balance (eighth). A block dulls the sense. Treating the cause can restore it.");
  pill(ox, "Eye movers", 520, 197, 628, 66, "Eye movers: third, fourth and sixth nerves. The third also lifts the lid and narrows the pupil. A blocked third nerve leaves the eye down and out with a wide pupil.");
  pill(ox, "Trigeminal V", 430, 256, 430, 190, "Trigeminal nerve (fifth): feeling in the face and chewing muscles. Its ganglion dot holds the sensory cell bodies. Pressure here fires brief severe pain.");
  pill(ox, "Facial VII", 540, 285, 566, 304, "Facial nerve (seventh): face movement, taste from the front of the tongue, and tears. A lower block weakens the whole face and leaves the eye open.");
  pill(ox, "Vagus X", 580, 357, 520, 398, "Vagus nerve (tenth): voice, palate and swallow. A block brings hoarseness and food going down the wrong way.");
  pill(ox, "Tongue XII", 700, 328, 648, 398, "Twelfth nerve: tongue muscles. A weak tongue points to the weak side when it comes out. Treating the cause straightens it.");
  pill(ox, "Cornea", 735, 195, 806, 92, "Cornea: when the lid cannot close, the window of the eye dries and scars. Drops and a shield guard it while the nerve heals.");
  capEl = mk("text", { class: "cn-cap", x: 30, y: 428 }, ox);
}
function init() {
  organ($("brainSlot"), "brain", 235, 132, 200, {});
  NERVES.forEach((nv) => {
    let d = "";
    nv.pts.forEach((pt, j) => { d += (j ? "L" : "M") + pt[0] + " " + pt[1]; });
    nerveEls.push(mk("path", { class: "cn-nerve", d }, layers.nerves));
    nucEls.push(mk("circle", { class: "cn-nuc hot", cx: nv.nuc[0], cy: nv.nuc[1], r: 6, tabindex: "0", "data-info": nv.tip }, layers.nuc));
  });
  gangEl = mk("circle", { class: "cn-gang hot", cx: 470, cy: 255, r: 9, tabindex: "0", "data-info": "Trigeminal ganglion: the sensory cell bodies of the fifth nerve sit in this knot beside the pons." }, layers.nuc);
  fx.droop = mk("path", { class: "cn-fx", d: "M738 282Q770 292 802 296", opacity: "0" }, layers.facefx);
  fx.brow = mk("path", { class: "cn-fx", d: "M718 172H752M788 172H822", opacity: "0" }, layers.facefx);
  sigs.forEach((p, i) => { p.k = i % NERVES.length; p.u = (i * 0.37) % 1; p.on = true; p.e.setAttribute("opacity", "1"); });
  initPanel();
}
function step(dt, m) {
  const k = Math.min(1, dt * 2.2), k2 = Math.min(1, dt * 3);
  sm.sig = lerp(sm.sig, m.sig, k); sm.fn = lerp(sm.fn, m.fn, k); sm.pain = lerp(sm.pain, m.pain, k); sm.risk = lerp(sm.risk, m.risk, k);
  sm.grp = m.grp;
  sm.treat = lerp(sm.treat, m.drug === 2 ? 1 : 0, k2);
  sm.shield = lerp(sm.shield, m.drug === 1 && (m.grp === 1 || m.grp === 2) ? 1 : 0, k2);
  NERVES.forEach((nv, i) => {
    const on = nv.grp === sm.grp;
    nerveEls[i].style.opacity = on ? "1" : "0.22";
    nerveEls[i].setAttribute("stroke-width", on ? f1(2.6 + 0.8 * sm.treat) : "1.4");
    nucEls[i].style.opacity = on ? "1" : "0.35";
  });
  gangEl.style.opacity = sm.grp === 2 ? "1" : "0.3";
  const bp = BLOCK_POS[sm.grp];
  place(layers.block, bp[0], bp[1], 0, Math.max(0.001, 1 - sm.treat));
  layers.block.setAttribute("opacity", (1 - 0.85 * sm.treat).toFixed(2));
  const gp = GLOW_POS[sm.grp];
  layers.glow.setAttribute("cx", gp[0]); layers.glow.setAttribute("cy", gp[1]);
  layers.glow.setAttribute("opacity", (0.45 * GLOW_STR[sm.grp] * (1 - sm.treat)).toFixed(2));
  const boltOp = sm.grp === 2 ? sm.pain : 0;
  layers.bolts.setAttribute("opacity", boltOp.toFixed(2));
  layers.flush.setAttribute("opacity", (0.3 * boltOp).toFixed(2));
  layers.shield.setAttribute("opacity", sm.shield.toFixed(2));
  place(layers.drop1, 735, 232 + 3 * Math.sin(tm / 300), 0, 1);
  place(layers.drop2, 748, 236 + 3 * Math.sin(tm / 300 + 2), 0, 1);
  sigs.forEach((p) => {
    const nv = NERVES[p.k], on = nv.grp === sm.grp;
    p.u += dt * (0.05 + 0.16 * sm.sig) * (on ? 1 : 0.25);
    if (p.u > 1) { p.u = 0; const cand = NERVES.map((q, j) => (q.grp === sm.grp ? j : -1)).filter((j) => j >= 0); p.k = cand[Math.floor(Math.random() * cand.length)]; }
    const pt = tracks[p.k].at(clamp(p.u));
    p.x = clamp(pt.x, 22, 938); p.y = clamp(pt.y, 52, 432);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", on ? (0.35 + 0.65 * sm.sig).toFixed(2) : "0.12");
  });
  const eyeLes = sm.grp === 1 ? clamp(1 - sm.sig) : 0;
  const faceLes = sm.grp === 2 ? clamp(1 - sm.fn) : 0;
  const lowLes = sm.grp === 3 ? clamp(1 - sm.fn) : 0;
  const pL = $("pupilL"), pR = $("pupilR"), lid = $("lidL"), ton = $("tongueEl"), uvu = $("uvulaEl"), mou = $("mouthEl");
  if (pL) { pL.setAttribute("transform", "translate(" + f1(7 * eyeLes) + " " + f1(5 * eyeLes) + ")"); const pc = pL.querySelector("circle"); if (pc) pc.setAttribute("r", f1(5 * (1 + 0.6 * eyeLes))); }
  if (pR) pR.setAttribute("transform", "translate(" + f1(-6 * eyeLes) + " 0)");
  if (lid) lid.setAttribute("opacity", eyeLes.toFixed(2));
  if (fx.droop) fx.droop.setAttribute("opacity", faceLes.toFixed(2));
  if (fx.brow) fx.brow.setAttribute("opacity", (faceLes * 0.9).toFixed(2));
  if (ton) ton.setAttribute("transform", "translate(" + f1(10 * lowLes) + " 0)");
  if (uvu) uvu.setAttribute("transform", "translate(" + f1(-8 * lowLes) + " 0)");
  if (mou) mou.style.opacity = (1 - 0.6 * faceLes).toFixed(2);
  gg.sig.set(sm.sig, wordOf(sm.sig, 0.35, 0.65, ["weak", "reduced", "strong"]));
  gg.fn.set(sm.fn, wordOf(sm.fn, 0.35, 0.65, ["lost", "reduced", "working"]));
  gg.pain.set(sm.pain, wordOf(sm.pain, 0.2, 0.55, ["none", "some", "severe"]));
  gg.risk.set(sm.risk, wordOf(sm.risk, 0.35, 0.65, ["low", "raised", "high"]));
  const key = sm.grp + ":" + m.drug;
  if (key !== capKey) { capKey = key; const t = capText(sm.grp, m.drug); if (capEl && capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
