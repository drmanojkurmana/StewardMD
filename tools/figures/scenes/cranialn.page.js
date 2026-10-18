/* Cranial nerves scene: nuclei and exits, signal flow, and eye, face, throat and tongue lesion signs. */
const layers = { nerves: $("nerves"), nuc: $("nuclei"), parts: $("parts"), facefx: $("facefx"), over: $("over"), panel: $("panel") };
const NERVES = [
  { n: "I", grp: 0, pts: [[300, 72], [470, 72], [640, 130], [742, 226]], nuc: [232, 72], tip: "Olfactory nerve (I): smell. Fibers from the nose cross the skull base to the olfactory bulb. Loss gives loss of smell." },
  { n: "II", grp: 0, pts: [[292, 88], [460, 105], [620, 150], [728, 188]], nuc: [272, 84], tip: "Optic nerve (II): vision. Myelinated fibers from the retina carry sensation of light and form. Lesions give visual loss or field defects." },
  { n: "III", grp: 1, pts: [[292, 125], [450, 140], [620, 170], [730, 190]], nuc: [248, 125], tip: "Third nerve (III): moves most eye muscles, lifts the lid, and parasympathetic fibers narrow the pupil. Compression gives a down and out eye with a dilated pupil and drooping lid." },
  { n: "IV", grp: 1, pts: [[292, 145], [450, 155], [620, 180], [734, 196]], nuc: [262, 145], tip: "Fourth nerve (IV): superior oblique muscle. It turns the eye down and in. A lesion gives vertical double vision, worse on looking down." },
  { n: "V", grp: 2, pts: [[292, 215], [470, 215], [620, 240], [726, 258]], nuc: [248, 215], tip: "Trigeminal nerve (fifth, V): facial sensation in three divisions and motor fibers to chewing muscles. Its ganglion holds sensory cell bodies. Neuralgia gives brief severe pain; carbamazepine often gives relief." },
  { n: "VI", grp: 1, pts: [[292, 240], [460, 225], [625, 205], [738, 198]], nuc: [262, 240], tip: "Sixth nerve (VI): lateral rectus only. It turns the eye out. A lesion stops abduction, so the eye sits turned in and double vision is worse at distance." },
  { n: "VII", grp: 2, pts: [[292, 260], [470, 262], [640, 272], [748, 282]], nuc: [248, 260], tip: "Facial nerve (seventh, VII): face muscles, taste from the front of the tongue, and parasympathetic fibers to tear and saliva gland. A lower motor neuron lesion weakens the whole face; an upper motor neuron lesion spares the forehead." },
  { n: "VIII", grp: 0, pts: [[292, 280], [470, 268], [600, 248], [676, 238]], nuc: [262, 280], tip: "Vestibulocochlear nerve (VIII): hearing and balance sensation. Lesions give hearing loss, ringing or vertigo." },
  { n: "IX", grp: 3, pts: [[292, 325], [470, 315], [640, 322], [752, 330]], nuc: [248, 325], tip: "Glossopharyngeal nerve (IX): taste from the back of the tongue, sensation from the throat, and fibers to a saliva gland. Lesions affect swallowing and the gag reflex." },
  { n: "X", grp: 3, pts: [[292, 345], [480, 350], [650, 365], [758, 398]], nuc: [262, 345], tip: "Vagus nerve (X): palate, voice box and swallowing muscles, plus parasympathetic fibers to chest and gut. A lesion gives a hoarse voice, palate droop with the uvula pointing away, and swallowing difficulty." },
  { n: "XI", grp: 3, pts: [[292, 362], [480, 368], [660, 352], [838, 338]], nuc: [248, 362], tip: "Accessory nerve (XI): sternocleidomastoid and trapezius muscles. A lesion gives weak head turning and shoulder shrug." },
  { n: "XII", grp: 3, pts: [[292, 378], [480, 360], [650, 330], [762, 314]], nuc: [272, 372], tip: "Hypoglossal nerve (XII): tongue muscles. A lower motor neuron lesion wastes the tongue and it points toward the lesion on protrusion." },
];
const tracks = NERVES.map((nv) => track(nv.pts));
const nerveEls = [], nucEls = [];
let gangEl, fx = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const sigs = pool(30, () => mk("circle", { class: "sc-p p-sig", r: 2.6 }, layers.parts));
const gg = {};
const sm = { sig: 0.3, fn: 0.3, pain: 0.2, risk: 0.8, grp: 1, drug: 0 };
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [140, 340, 540, 740];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "What the patient shows";
  [["sig", "Signal", "g-good", "How well impulses travel along the highlighted cranial nerve fibers from nucleus to target."], ["fn", "Function", "g-fn", "What the target muscles or gland can still do: eye movement, facial movement, voice, swallowing or tongue movement."], ["pain", "Pain", "g-pain", "Facial pain. Trigeminal neuralgia gives brief severe shocks of pain, usually without numbness, and often eases with carbamazepine."], ["risk", "Risk", "g-bad", "Risk from the lesion itself, such as corneal damage when the lid cannot close, or swallowing difficulty with the vagus. Protecting the eye lowers this risk."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Brainstem", 255, 205, 110, 110, "Brainstem: midbrain, pons and medulla. Most cranial nerve nuclei sit here in columns. A small lesion here can affect several nerves and long tracts together.");
  pill(ox, "Olfactory I", 470, 72, 480, 58, "Olfactory nerve (I): smell. Fibers from the nose reach the bulb above the skull base.");
  pill(ox, "Optic II", 450, 100, 600, 62, "Optic nerve (II): vision. It carries sensation from the retina to the brain.");
  pill(ox, "Eye movers", 500, 165, 520, 145, "Eye movers III, IV and VI: third, fourth and sixth nerves move the eye. Third also lifts the lid and narrows the pupil.");
  pill(ox, "Trigeminal V", 470, 215, 430, 185, "Trigeminal nerve (fifth, V): facial sensation and chewing muscles. Its ganglion sits beside the pons. Neuralgia here causes severe brief facial pain.");
  pill(ox, "Facial VII", 520, 262, 500, 300, "Facial nerve (seventh, VII): face muscles, taste, and tear and saliva gland fibers. Upper motor neuron weakness spares the forehead; lower motor neuron weakness takes the whole face.");
  pill(ox, "Vagus X", 560, 352, 520, 385, "Vagus nerve (X): voice, palate and swallowing. A lesion gives hoarseness and the uvula points away from the lesion.");
  pill(ox, "Tongue XII", 610, 332, 630, 385, "Hypoglossal nerve (XII): tongue muscles. The protruded tongue points toward a lower motor neuron lesion.");
  pill(ox, "Cornea risk", 735, 195, 770, 92, "When the third nerve drops the lid or the seventh nerve stops lid closure, the cornea is exposed. Protecting the eye prevents damage while the cause is treated.");
  pill(ox, "Taste", 770, 292, 905, 290, "Taste: the facial nerve carries taste from the front of the tongue and the glossopharyngeal from the back. Both also supply saliva gland fibers.");
}
function init() {
  NERVES.forEach((nv, i) => {
    let d = "";
    nv.pts.forEach((pt, j) => { d += (j ? "L" : "M") + pt[0] + " " + pt[1]; });
    nerveEls.push(mk("path", { class: "cn-nerve", d }, layers.nerves));
    const c = mk("circle", { class: "cn-nuc", cx: nv.nuc[0], cy: nv.nuc[1], r: 6 }, layers.nuc);
    nucEls.push(c);
    const lab = mk("text", { class: "cn-lab", x: nv.nuc[0] - 14, y: nv.nuc[1] + 3, "text-anchor": "middle" }, layers.nuc);
    lab.textContent = nv.n;
  });
  gangEl = mk("circle", { class: "cn-gang", cx: 470, cy: 215, r: 10 }, layers.nuc);
  const gl = mk("text", { class: "cn-lab", x: 470, y: 238, "text-anchor": "middle" }, layers.nuc); gl.textContent = "ganglion";
  fx.droop = mk("path", { class: "cn-fx", d: "M738 282Q770 292 802 296", opacity: "0" }, layers.facefx);
  fx.brow = mk("path", { class: "cn-fx", d: "M718 172H752M788 172H822", opacity: "0" }, layers.facefx);
  sigs.forEach((p, i) => { p.k = i % NERVES.length; p.u = (i * 0.37) % 1; p.on = true; p.e.setAttribute("opacity", "1"); });
  initPanel();
}
function step(dt, m) {
  const k = Math.min(1, dt * 2.2);
  sm.sig = lerp(sm.sig, m.sig, k); sm.fn = lerp(sm.fn, m.fn, k); sm.pain = lerp(sm.pain, m.pain, k); sm.risk = lerp(sm.risk, m.risk, k); sm.grp = m.grp; sm.drug = m.drug;
  NERVES.forEach((nv, i) => {
    const on = nv.grp === sm.grp;
    nerveEls[i].style.opacity = on ? "1" : "0.22";
    nerveEls[i].setAttribute("stroke-width", on ? "2.6" : "1.4");
    nucEls[i].style.opacity = on ? "1" : "0.35";
  });
  gangEl.style.opacity = sm.grp === 2 ? "1" : "0.3";
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
}
run({ init, step });
