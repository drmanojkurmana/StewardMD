// Blood pressure on a training arm: an arm phantom on its rest, the cuff, an aneroid gauge on a stand, the bulb with
// its release valve, and a stethoscope diaphragm over the brachial artery below the cuff. The driver
// (bp-cuff.driver.js) inflates, deflates at the chosen rate and plays Korotkoff sounds on the beats that fall
// between systolic and diastolic, then reads the pressure the way a person does: at the first and last sound.
import { k, G, painter, part, morph, range, tools, hose, balloon } from "../lib.mjs";

export default function build() {
  const W = 640, H = 400;
  const PLATE = { x: -150, y: -58, w: 300, d: 140, r: 10 };
  const ZA = 40, RA = 15, RF = 11.5;
  const P = k.fitProjection([...k.boxCorners(PLATE, -14, 0), [-140, 0, 70], [150, 0, 60], [60, 70, 60], [-60, -40, 110]], W, H, { pad: 22, azimuth: 38 });
  const { S, L, D, at } = tools(P);
  const Q = painter(P);
  const morphs = {};

  Q.add([0, 0, -30], `<path class="iso-halo" d="${k.haloOf(PLATE, -14, 14, P)}"/>`, -1e4);
  Q.add([0, 0, -20], k.corners(PLATE, 22).map(([x, y]) => S(k.cylinder(x, y, 7, -14, 5, P, 28), { tone: "mid" })).join(""), -9e3);
  Q.add([0, 0, -10], S(k.slabOf(PLATE, -9, 9, P, 8, 1.2), { tone: "mid" }) + L(k.planOutline(k.insetPlan(PLATE, 6), 0, P), { tone: "faint" }) +
    D(k.corners(PLATE, 11).map(([x, y]) => at([x, y, 0])), { size: 0.55 }), -8e3);

  // arm rest: base, pad with stitching, two saddles
  const REST = { x: -132, y: -22, w: 250, d: 40, r: 6 };
  Q.add([-10, 0, 0], S(k.slabOf(REST, 0, 12, P, 6, 0.8), { tone: "mid" }) + S(k.slabOf(k.insetPlan(REST, 3), 12, 6, P, 8, 0.4), { tone: "hi" }) +
    L(k.planOutline(k.insetPlan(REST, 7), 18, P, 8), { tone: "faint", dashed: true }), -200);
  for (const x of [-100, 70]) Q.add([x, 0, 18], S(k.slabOf({ x: x - 9, y: -14, w: 18, d: 28, r: 3 }, 18, ZA - RA - 18 + 3, P, 3, 0.4), { tone: "mid" }), -150);

  // the arm: upper arm, elbow, forearm and wrist cap, with the brachial artery drawn on its near side
  const Fa = G.frameAlong([-130, 0, ZA], [1, 0, 0]);
  const near = G.angleToward(Fa, [0, 0.75, 0.66]);
  const arm = [S(G.solidOf([[0, RA - 2], [3, RA, 1], [130, RA, 1], [140, RA - 1.5, 1], [150, RF + 1, 1], [215, RF, 1], [240, RF - 1.4, 1], [244, RF - 4]], Fa, P, { steps: 64 }), { tone: "hi", crease: "none" })];
  arm.push(L(G.arcOf(Fa, 140, RA - 1.5, P), { tone: "faint" }));
  const artery = [];
  for (let s = 2; s <= 236; s += 6) artery.push(G.pointOf(Fa, s, (s < 140 ? RA : RF) + 0.1, near - 0.15));
  arm.push(`<path class="iso-line" data-tone="red" d="${k.pathOf(artery.map((p) => k.iso(p, P)))}" style="stroke-width:1.1"/>`);
  Q.add([-10, 0, ZA], arm.join(""), 0);

  // cuff (a morph: it swells a little with pressure), index line, edges, and its two tube ports
  const C0 = 30, C1 = 100;
  const cuff = (f) => {
    const r = RA + 3.4 + 1.6 * f;
    return S(G.disc(C0, C1, r, Fa, P, { steps: 72 }), { tone: "hi", inner: k.lineSvg([C0 + 6, C1 - 6].map((s) => G.arcOf(Fa, s, r, P)).join(""), { tone: "faint" }) });
  };
  const m = morph(cuff, range(2), 0);
  morphs.cuff = m.data;
  Q.add([-65, 0, ZA], part("cuff", m.markup), 300);
  const idx = G.pointOf(Fa, C0 + 34, RA + 3.6, near + 0.4), idx2 = G.pointOf(Fa, C0 + 34, RA + 3.6, near + 0.75);
  Q.add([-65, 0, ZA + 20], L(k.segment(idx, idx2, P), { tone: "mid" }) + D([k.iso(idx, P)], { size: 0.8, tone: "hi" }), 301);
  const portA = G.pointOf(Fa, C0 + 22, RA + 4, near - 0.55), portB = G.pointOf(Fa, C0 + 48, RA + 4, near - 0.55);
  for (const p of [portA, portB]) Q.add(p, S(k.cylinder(p[0], p[1], 2.4, p[2] - 4, 4, P, 16), { tone: "mid" }), 302);

  // aneroid gauge on a stand: base, post, case, dial face with ticks and numbers, needle (the driver draws it)
  const GA = [44, 52], GZ = 44, GR = 24;
  const gauge = [S(k.cylinder(GA[0], GA[1], 12, 0, 4, P, 40, 0.5), { tone: "mid" }), S(k.cylinder(GA[0], GA[1], 3, 4, GZ - 4, P, 20), { tone: "mid" }),
    S(k.cylinder(GA[0], GA[1], GR, GZ, 7, P, 72, 0.8), { tone: "hi", crease: "lo" }), L(k.ring(GA[0], GA[1], GR - 2.4, GZ + 7, P, 72), { tone: "lo" })];
  const tk = k.radialTicks(GA[0], GA[1], GR - 3.4, 60, 5, GZ + 7, [1.4, 3], P, (-150 * Math.PI) / 180, (300 * Math.PI) / 180);
  gauge.push(L(tk.minor, { tone: "lo" }), L(tk.major, { tone: "mid" }));
  for (const v of [0, 100, 200, 300]) {
    const a = ((-150 + v) * Math.PI) / 180, rr = GR - 9;
    gauge.push(k.faceTextSvg(k.topMatrix([GA[0] + Math.sin(a) * rr, GA[1] - Math.cos(a) * rr + 1.2], GZ + 7, P, "x"), String(v), { size: 3, tone: "mid", anchor: "middle" }));
  }
  gauge.push(k.faceTextSvg(k.topMatrix([GA[0], GA[1] + 9], GZ + 7, P, "x"), "mmHg", { size: 2.6, tone: "lo", anchor: "middle" }));
  gauge.push(`<path data-iso-part="needle" class="iso-line" data-tone="red" d="" style="stroke-width:1.2"/>`);
  gauge.push(L(k.ring(GA[0], GA[1], 1.6, GZ + 7.2, P, 16), { tone: "hi" }));
  Q.add([GA[0], GA[1], 0], gauge.join(""), 60);

  // bulb with valve screw: the bulb squeezes while inflating (a morph)
  const BU = [-96, 54], BZ = 46;
  const bulb = (f) => { const r = 11 - 3.2 * f; return S(balloon(BU[0], BU[1], BZ, [[0, 3], [3, 5], [8, r * 0.85], [14, r], [21, r * 0.96], [27, r * 0.75], [31, r * 0.42], [33, 2.6]], P), { tone: "hi", crease: "none" }); };
  const mb = morph(bulb, range(2), 0);
  morphs.bulb = mb.data;
  Q.add([BU[0], BU[1], BZ - 15], part("bulb", mb.markup), 30);
  Q.add([BU[0], BU[1], BZ], S(k.cylinder(BU[0], BU[1], 4.6, BZ, 8, P, 24, 0.4), { tone: "mid" }) + S(k.cylinder(BU[0] + 5, BU[1], 2.6, BZ + 3, 3, P, 16), { tone: "mid" }) +
    S(k.cylinder(BU[0], BU[1], 3, BZ + 8, 4, P, 20), { tone: "mid" }) + L(k.knurl(BU[0], BU[1], 3, BZ + 8, BZ + 12, 16, P), { tone: "lo" }), 31);

  // tubing: cuff to gauge, cuff to bulb
  for (const c of hose([portB, [portB[0], portB[1] + 4, portB[2] - 10], [GA[0] - 30, GA[1] - 6, 6], [GA[0] - 10, GA[1], 2], [GA[0], GA[1] - 8, 4]], 1.6, P, { tone: "mid", maxLength: 40, bend: 6 })) Q.add(c.mid, c.svg, 303);
  for (const c of hose([portA, [portA[0], portA[1] + 4, portA[2] - 10], [BU[0] + 20, BU[1] - 10, 30], [BU[0], BU[1], BZ + 16], [BU[0], BU[1], BZ + 12]], 1.6, P, { tone: "mid", maxLength: 40, bend: 6 })) Q.add(c.mid, c.svg, 303);

  // stethoscope diaphragm in the antecubital fossa, its chest piece stem and tubing off the bench
  const SF = G.pointOf(Fa, 118, RA - 1, near);
  const Fs = G.frameAlong(SF, G.radialOf(Fa, near));
  Q.add(SF, S(G.disc(0, 3, 9, Fs, P), { tone: "hi", lit: true }) + L(G.circleOf(Fs, 3, 6.8, P), { tone: "lo" }) + S(G.disc(3, 7, 3.6, Fs, P), { tone: "mid" }), 310);
  const stem = G.pointOf(Fs, 7, 0, 0);
  for (const c of hose([stem, [stem[0] + 10, stem[1] + 6, stem[2] + 14], [stem[0] + 40, stem[1] + 20, stem[2] + 40], [stem[0] + 90, stem[1] + 10, stem[2] + 50]], 1.8, P, { tone: "mid", maxLength: 40, bend: 6 })) Q.add(c.mid, c.svg, 311);
  const snd = [0, 1, 2].map((i) => `<circle data-iso-part="snd${i}" class="iso-line" data-tone="lit" cx="${k.iso(SF, P)[0].toFixed(1)}" cy="${k.iso(SF, P)[1].toFixed(1)}" r="6" visibility="hidden"/>`).join("");
  const pulses = [0, 1, 2].map((i) => `<circle data-iso-part="pu${i}" class="iso-gas" data-tone="red" r="2" cx="0" cy="0" visibility="hidden"/>`).join("");

  return {
    P, width: W, height: H, morphs, body: Q.svg() + `<g aria-hidden="true">${snd}${pulses}</g>`,
    data: { gauge: [GA[0], GA[1], GZ + 7.3, GR - 5], prox: artery.filter((p) => p[0] < -100).map((p) => p.map((v) => Math.round(v * 10) / 10)), dist: artery.filter((p) => p[0] > -28).map((p) => p.map((v) => Math.round(v * 10) / 10)) },
    fig: "Fig 5", title: "Blood pressure", hint: "Watch the gauge as it falls",
    label: "A training arm on its rest with a blood pressure cuff on the upper arm, an aneroid gauge on a stand, the hand bulb with its release valve and a stethoscope diaphragm over the brachial artery at the elbow. The cuff is pumped above systolic and deflated; sounds are heard on the beats that fall between systolic and diastolic.",
    caption: "You only hear a beat, so you only learn the cuff pressure once per beat. Let the cuff down faster than 2 to 3 mmHg a second and the first and last sounds fall between beats: systolic reads low and diastolic reads off by up to one beat's fall.",
    keys: [{ mark: "red", label: "Brachial artery and the pulse getting through" }, { mark: "lit", label: "Korotkoff sound at the diaphragm" }],
    sources: [
      "Muntner P, Shimbo D, Carey RM, et al. Measurement of blood pressure in humans: a scientific statement from the American Heart Association. Hypertension 2019;73(5):e35-e66 (inflate 20 to 30 mmHg above the level where the radial pulse disappears; deflate at 2 mmHg per second; systolic at the first of two consecutive sounds, diastolic when the sounds disappear).",
      "Bickley LS. Bates' Guide to Physical Examination and History Taking, 13th edition, chapter 4 (Korotkoff sounds, auscultatory gap).",
    ],
    model: "A cuff pressure falling at a steady rate and beats at the set heart rate: a beat makes a sound when the cuff pressure at that moment is at or below systolic and above diastolic. The reading is the cuff pressure at the first and last sounding beats, so its error comes only from where the beats fall.",
  };
}
