// Retinoscopy on an optical bench: a practice model eye whose refraction is set on a scaled collar, a trial lens in a
// holder in front of it, and a streak retinoscope on a post at the working distance. The streak sweeps across the eye;
// the reflex in the pupil moves with it, against it, or fills the pupil at neutral. Distances are not to scale.
// The driver (retinoscope.driver.js) uses the Ophthalmos retinoscopy model.
import { k, G, painter, tools } from "../lib.mjs";

export default function build() {
  const W = 640, H = 380;
  const PLATE = { x: -150, y: -46, w: 300, d: 92, r: 10 };
  const RAIL = { x: -140, y: -8, w: 280, d: 16, r: 3 };
  const EZ = 62, ER = 17, EX0 = -128, EX1 = -92;
  const LX = -70, RX = 100;
  const P = k.fitProjection([...k.boxCorners(PLATE, -14, 0), [RX, 0, 96], [EX0, 0, EZ + 24]], W, H, { pad: 22, azimuth: 52 });
  const { S, L, D, at } = tools(P);
  const Q = painter(P);

  Q.add([0, 0, -30], `<path class="iso-halo" d="${k.haloOf(PLATE, -14, 14, P)}"/>`, -1e4);
  Q.add([0, 0, -20], k.corners(PLATE, 22).map(([x, y]) => S(k.cylinder(x, y, 7, -14, 5, P, 28), { tone: "mid" })).join(""), -9e3);
  Q.add([0, 0, -10], S(k.slabOf(PLATE, -9, 9, P, 8, 1.2), { tone: "mid" }) + L(k.planOutline(k.insetPlan(PLATE, 6), 0, P), { tone: "faint" }) +
    D(k.corners(PLATE, 11).map(([x, y]) => at([x, y, 0])), { size: 0.55 }), -8e3);
  // rail with a scale
  const ticks = k.topTicks(RAIL.x + 6, RAIL.x + RAIL.w - 6, 5, 4, RAIL.y + 1, 6, [2.2, 4.6], P);
  Q.add([0, 0, 0], S(k.slabOf(RAIL, 0, 6, P, 3, 0.6), { tone: "mid" }) + L(ticks.minor, { tone: "lo" }) + L(ticks.major, { tone: "mid" }) +
    k.faceTextSvg(k.topMatrix([-20, RAIL.y + 13], 6, P, "x"), "", { size: 3.2, tone: "mid" }).replace("<text ", '<text data-iso-part="wd" '), -7e3);

  // carriages and posts
  const carriage = (x) => S(k.slabOf({ x: x - 9, y: -11, w: 18, d: 22, r: 2 }, 6, 6, P, 3, 0.5), { tone: "mid" }) + S(k.cylinder(x + 6, 12, 2.4, 6, 5, P, 16), { tone: "mid" });
  Q.add([-110, 0, 6], carriage(-110) + S(k.cylinder(-110, 0, 3.4, 12, EZ - ER - 12, P, 20), { tone: "mid" }), -100);
  Q.add([LX, 0, 6], carriage(LX) + S(k.cylinder(LX, 0, 2.6, 12, EZ - 14 - 12, P, 20), { tone: "mid" }), -90);
  Q.add([RX, 0, 6], carriage(RX) + S(k.cylinder(RX, 0, 3, 12, 24, P, 20), { tone: "mid" }), -80);

  // model eye: barrel along +x, refraction collar with ticks, front cell, iris face with the pupil
  const Fe = G.frameAlong([EX0, 0, EZ], [1, 0, 0]);
  const eye = [S(G.disc(0, EX1 - EX0, ER, Fe, P), { tone: "hi" }), S(G.disc(-3, 0, ER - 3, Fe, P), { tone: "mid" })];
  eye.push(S(G.disc(8, 20, ER + 2.4, Fe, P), { tone: "mid" }), L(G.ribsOf(Fe, 8, 20, ER + 2.4, 60, P), { tone: "lo" }));
  const up = G.angleToward(Fe, [0, 0.5, 0.86]);
  const sc = [];
  for (let i = -6; i <= 6; i++) sc.push(k.segment(G.pointOf(Fe, 26, ER, up + i * 0.09), G.pointOf(Fe, i % 3 ? 28 : 30, ER, up + i * 0.09), P));
  eye.push(L(sc.join(""), { tone: "mid" }));
  eye.push(`<path data-iso-part="rxmark" class="iso-line" data-tone="red" d="" style="stroke-width:1.2"/>`);
  eye.push(S(G.disc(EX1 - EX0, EX1 - EX0 + 3, ER + 1.2, Fe, P), { tone: "mid" }));
  const M = k.sideMatrix([EX1 + 3.1, 0], EZ, P, "right");
  eye.push(`<g transform="${M}"><clipPath id="isoPupil"><circle cx="0" cy="0" r="5.6"/></clipPath>` +
    `<circle class="iso-line" data-tone="mid" cx="0" cy="0" r="12"/><circle cx="0" cy="0" r="5.6" style="fill:var(--anatomy-shade-0)"/>` +
    `<g clip-path="url(#isoPupil)"><rect data-iso-part="reflex" x="-2" y="-8" width="4" height="16" style="fill:var(--anatomy-red)" opacity=".8"/></g>` +
    `<circle class="iso-line" data-tone="hi" cx="0" cy="0" r="5.6"/>` +
    `<rect data-iso-part="streak" x="-1" y="-15" width="2" height="30" rx="1" style="fill:var(--anatomy-lit)" opacity=".18"/></g>`);
  Q.add([EX0 + 20, 0, EZ], eye.join(""), 0);

  // trial lens holder: ring on a post with the lens (glass) and a label tab
  const Fl = G.frameAlong([LX - 1.2, 0, EZ], [1, 0, 0]);
  Q.add([LX, 0, EZ], S(G.ringBand(0, 2.4, 11, 14, Fl, P), { tone: "mid" }) + S(G.disc(0.6, 1.8, 11, Fl, P), { tone: "hi", className: "iso-glass" }) +
    S(k.slabOf({ x: LX - 1, y: -3, w: 2.4, d: 6, r: 0.6 }, EZ - 20, 6, P, 2), { tone: "mid" }) +
    k.faceTextSvg(k.sideMatrix([LX + 1.4, -2], EZ + 17, P, "right"), "", { size: 4, tone: "hi" }).replace("<text ", '<text data-iso-part="lens" '), 2);

  // streak retinoscope on its post: handle, sleeve, head with the peephole and the window facing the eye
  const Fh = G.frameAlong([RX, 0, 36], [0, 0, 1]);
  const scope = [S(G.disc(0, 34, 5.4, Fh, P), { tone: "hi" }), L(G.ribsOf(Fh, 4, 20, 5.4, 40, P), { tone: "lo" }), S(G.disc(22, 30, 6.4, Fh, P), { tone: "mid" })];
  const Fk = G.frameAlong([RX + 8, 0, 76], [-1, 0, 0]);
  scope.push(S(G.disc(0, 20, 8, Fk, P), { tone: "hi", lit: true }), S(G.disc(20, 22, 6, Fk, P), { tone: "mid" }), L(G.circleOf(Fk, 22, 3.4, P), { tone: "hi" }));
  scope.push(S(k.cylinder(RX + 6, 0, 2.6, 84, 4, P, 16), { tone: "mid" }));
  Q.add([RX, 0, 40], scope.join(""), 10);
  // the beam
  const beam = [[RX - 14, -2.6, 76], [EX1 + 3, -10, EZ], [EX1 + 3, 10, EZ], [RX - 14, 2.6, 76]];
  Q.add([0, 0, EZ], `<path class="iso-tint" data-tone="hi" style="opacity:.06" d="${k.pathOf(beam.map(at), true)}"/>`, 5);

  return {
    P, width: W, height: H, body: Q.svg(),
    data: { collar: [32, ER + 0.2, up], frame: { o: Fe.o, a: Fe.a, u: Fe.u, v: Fe.v } },
    fig: "Fig 7", title: "Retinoscopy", hint: "Sweep, then neutralise",
    label: "An optical bench with a practice model eye on the left, its refraction set on a scaled collar, a trial lens in a holder in front of it, and a streak retinoscope on a post at the working distance. The lit streak sweeps across the eye and the red reflex in the pupil moves with it, against it, or fills the pupil at neutral.",
    caption: "With motion means the far point is behind you: add plus. Against means it is between you and the eye: add minus. At neutral the pupil fills; the gross lens minus your working distance in dioptres is the refraction.",
    keys: [{ mark: "red", label: "Red reflex in the pupil" }, { mark: "lit", label: "The streak" }],
    sources: [
      "Elkington AR, Frank HJ, Greaney MJ. Clinical Optics, 3rd edition, chapter 7 (retinoscopy: with and against movement, neutral point, working distance).",
      "The Ophthalmos retinoscopy model (ophthalmos-retino-model.js): effective error = refraction minus trial lens plus working distance in dioptres; neutral below 0.2 D.",
    ],
    model: "Sphere only here. Effective error F = refraction - trial lens + working distance in dioptres (67 cm 1.50 D, 50 cm 2.00 D, 1 m 1.00 D). F > 0 gives with motion, F < 0 against, |F| < 0.2 D neutral; the reflex moves faster and brighter as F nears zero. Distances on the bench are not to scale.",
  };
}
