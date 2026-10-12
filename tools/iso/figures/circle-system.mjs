// Circle breathing system on an anaesthesia workstation bench: absorber, both unidirectional valves, corrugated limbs,
// Y-piece and test lung, reservoir bag, APL valve and a fresh gas flowmeter. Drawn with the Anatomy kit.
// The driver (circle-system.driver.js) runs the Narke circuit model (narke-models/explorer-circuit.js) and moves the
// valve discs, bag, lung, flowmeter bobbin, absorber indicator and the gas parcels from it.
import { k, G, painter, part, morph, range, tools, hose, balloon } from "../lib.mjs";

export default function build() {
  const W = 640, H = 430;
  const PLATE = { x: -148, y: -76, w: 276, d: 136, r: 10 };
  const A = [-95, 5], AR = 24;
  const HEAD = { x: -132, y: -42, w: 74, d: 94, r: 6 }, HZ = 92, HT = 104;
  const IV = [-80, -24], EV = [-80, 30], APL = [-118, 36];
  const Y = [104, 8, 80];
  const BAG = [-112, 68], FM = [-16, -58];
  const FM_Z0 = 22, FM_Z1 = 112;
  const insp = [[-58, -24, 98], [-30, -24, 98], [30, -16, 66], [80, -2, 74], [Y[0] - 2, Y[1] - 4, Y[2]]];
  const exp = [[Y[0] - 2, Y[1] + 4, Y[2]], [70, 32, 72], [10, 38, 66], [-30, 30, 98], [-58, 30, 98]];
  const fresh = [[FM[0], FM[1], FM_Z1 + 10], [FM[0], FM[1], 126], [-70, FM[1], 126], [-70, -38, 126], [-70, -38, HT]];

  const P = k.fitProjection([...k.boxCorners(PLATE, -16, 0), [FM[0], FM[1], 134], [Y[0] + 20, Y[1], 10], [BAG[0], BAG[1] + 20, 30], [-120, -40, 130]], W, H, { pad: 26, azimuth: 40 });
  const { S, L, D, at } = tools(P);
  const Q = painter(P);
  const morphs = {};

  // bench plate, feet, screws, label strip
  Q.add([0, 0, -30], `<path class="iso-halo" d="${k.haloOf(PLATE, -16, 16, P)}"/>`, -1e4);
  const feet = [];
  for (const [x, y] of k.corners(PLATE, 24)) feet.push(S(k.cylinder(x, y, 8, -16, 6, P, 28), { tone: "mid" }));
  Q.add([0, 0, -20], feet.join(""), -9e3);
  Q.add([0, 0, -10], S(k.slabOf(PLATE, -10, 10, P, 8, 1.4), { tone: "mid" }) + L(k.planOutline(k.insetPlan(PLATE, 6), 0, P), { tone: "faint" }) +
    D(k.corners(PLATE, 11).map(([x, y]) => at([x, y, 0])), { size: 0.55 }), -8e3);
  const strip = { x: 0, y: PLATE.y + PLATE.d - 16, w: 110, d: 8, r: 1 };
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2, 3.8], P);
  Q.add([0, 0, -5], S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }) + L(ticks.minor, { tone: "lo" }) + L(ticks.major, { tone: "mid" }), -7e3);

  // absorber: base ring, two clear canisters with soda lime, the indicator tint (a morph), head ring
  const absorber = [];
  absorber.push(S(k.cylinder(A[0], A[1], AR + 3, 0, 4, P, 64, 0.6), { tone: "mid" }));
  for (const [z0, z1] of [[4, 45], [47, 88]]) {
    absorber.push(S(k.cylinder(A[0], A[1], AR, z0, z1 - z0, P, 64), { tone: "hi", className: "iso-glass" }));
    absorber.push(L([z0 + 6, z1 - 6].map((z) => k.sideArc(A[0], A[1], AR, z, P, 40)).join(""), { tone: "faint" }));
    const grains = [];
    for (let z = z0 + 9; z < z1 - 6; z += 4.2) for (let a = -1.25; a <= 1.25; a += 0.24) {
      const ang = Math.atan2(1, 1) * 0 + (40 * Math.PI) / 180 + a + (z % 8 ? 0.12 : 0);
      grains.push(at([A[0] + Math.cos(ang) * (AR - 0.6), A[1] + Math.sin(ang) * (AR - 0.6), z]));
    }
    absorber.push(D(grains, { size: 0.55, tone: "lo" }));
  }
  Q.add([A[0], A[1], 0], absorber.join(""), 0);
  const tint = morph((f) => `<path class="iso-tint" data-tone="blue" d="${k.cylinder(A[0], A[1], AR - 0.4, 4.4, Math.max(0.6, f * 83), P, 64).fill}"/>`, range(4));
  morphs.used = tint.data;
  Q.add([A[0], A[1], 1], part("used", tint.markup), 0.5);
  Q.add([A[0], A[1], 88], S(k.cylinder(A[0], A[1], AR + 3, 88, 4, P, 64, 0.6), { tone: "mid" }) +
    D(G.dotsOf(G.frameAlong([A[0], A[1], 90], [0, 0, 1]), 0, AR + 3, 18, P, { least: 0.15 }), { size: 0.45 }), 1);

  // head block with its ports and labels
  const head = [];
  head.push(S(k.slabOf(HEAD, HZ, HT - HZ, P, 6, 1), { tone: "mid" }));
  head.push(L(k.sideSeam(HEAD, HZ + 4, P, 6), { tone: "faint" }));
  head.push(D(k.corners(HEAD, 5).map(([x, y]) => at([x, y, HT])), { size: 0.5 }));
  head.push(k.faceTextSvg(k.topMatrix([HEAD.x + 8, HEAD.y + HEAD.d - 8], HT, P, "x"), "CIRCLE", { size: 3, tone: "lo" }));
  Q.add([HEAD.x + HEAD.w / 2, HEAD.y + HEAD.d / 2, HZ], head.join(""), 5);
  for (const [y, name] of [[IV[1], "insp"], [EV[1], "exp"]]) {
    const F = G.frameAlong([HEAD.x + HEAD.w, y, 98], [1, 0, 0]);
    Q.add([HEAD.x + HEAD.w + 4, y, 98], S(G.disc(0, 5, 6.4, F, P), { tone: "mid" }) + S(G.disc(5, 9, 5.2, F, P), { tone: "mid" }) +
      L(G.arcOf(F, 7, 5.2, P), { tone: "faint" }), name === "insp" ? 2 : 2);
  }

  // valve domes: base, clear dome, the disc inside (a part that lifts), cap and arrow
  function valve(c, name, label) {
    const base = S(k.cylinder(c[0], c[1], 11, HT, 3, P, 48, 0.5), { tone: "mid" });
    const domeBack = S(k.cylinder(c[0], c[1], 9.4, HT + 3, 12, P, 48), { tone: "hi", className: "iso-glass" });
    const seat = L(k.ring(c[0], c[1], 7.6, HT + 3.2, P, 40), { tone: "lo" });
    const disc = part(name, S(k.cylinder(c[0], c[1], 7, HT + 3.4, 1, P, 40), { tone: "hi", lit: true }));
    const cap = S(k.cylinder(c[0], c[1], 10, HT + 15, 2.4, P, 48, 0.5), { tone: "mid" }) + L(k.knurl(c[0], c[1], 10, HT + 15, HT + 17.4, 40, P), { tone: "faint" });
    const txt = k.faceTextSvg(k.topMatrix([c[0], c[1]], HT + 17.4, P, "x"), label, { size: 2.6, tone: "lo", anchor: "middle" });
    Q.add([c[0], c[1], HT], base + domeBack + seat + disc + cap + txt, 6);
  }
  valve(IV, "ivalve", "INSP");
  valve(EV, "evalve", "EXP");

  // APL valve: block, knob with knurl and spring cap, scavenging port
  {
    const blk = { x: APL[0] - 7, y: APL[1] - 7, w: 14, d: 14, r: 2 };
    const out = [S(k.slabOf(blk, HT, 5, P, 3, 0.4), { tone: "mid" }), S(k.cylinder(APL[0], APL[1], 6.4, HT + 5, 7, P, 40), { tone: "mid" }),
      L(k.knurl(APL[0], APL[1], 6.4, HT + 5, HT + 12, 36, P), { tone: "lo" }), S(k.cylinder(APL[0], APL[1], 2.6, HT + 12, 2, P, 20), { tone: "hi" }),
      L(k.radialTicks(APL[0], APL[1], 5.2, 12, 3, HT + 12, [0.8, 1.6], P).major, { tone: "lo" })];
    Q.add([APL[0], APL[1], HT], out.join(""), 7);
    const F = G.frameAlong([APL[0] - 7, APL[1], HT + 2.5], [-1, 0, 0]);
    Q.add([APL[0] - 10, APL[1], HT], S(G.disc(0, 7, 2.4, F, P), { tone: "mid" }) + S(G.disc(7, 9, 3.2, F, P), { tone: "mid" }), 6.5);
  }

  // reservoir bag on an elbow at the front of the head; the bag body is a morph (empty to full)
  {
    const F0 = G.frameAlong([BAG[0], HEAD.y + HEAD.d, 98], [0, 1, 0]);
    Q.add([BAG[0], HEAD.y + HEAD.d + 6, 98], S(G.disc(0, 8, 4.6, F0, P), { tone: "mid" }) + S(G.disc(8, 12, 6, F0, P), { tone: "mid" }), 8);
    const top = [BAG[0], BAG[1], 95];
    Q.add(top, S(k.cylinder(BAG[0], BAG[1], 6, 91, 7, P, 32), { tone: "mid" }) + S(k.cylinder(BAG[0], BAG[1], 4.4, 86, 5, P, 32), { tone: "mid" }), 8.2);
    const bag = (f) => {
      const r = 8 + 9 * f, len = 46 - 4 * f;
      return S(balloon(BAG[0], BAG[1], 86, [[0, 4.4], [3, 5.2], [9, r * 0.82], [len * 0.28, r * 0.97], [len * 0.45, r], [len * 0.62, r * 0.98], [len * 0.8, r * 0.88], [len * 0.92, r * 0.62], [len, r * 0.25]], P), { tone: "hi", crease: "none" });
    };
    const m = morph(bag, range(8), 1);
    morphs.bag = m.data;
    Q.add([BAG[0], BAG[1], 60], part("bag", m.markup), 8.1);
  }

  // flowmeter: stand, backboard with scale, glass tube, bobbin (moves up the tube), needle valve knob
  {
    const base = { x: FM[0] - 14, y: FM[1] - 10, w: 28, d: 20, r: 3 };
    const board = { x: FM[0] - 9, y: FM[1] - 8, w: 18, d: 3, r: 1 };
    const out = [S(k.slabOf(base, 0, 12, P, 4, 0.6), { tone: "mid" }), S(k.slabOf(board, 12, FM_Z1 - 2, P, 3, 0.4), { tone: "mid" })];
    const sc = [];
    for (const v of [0.25, 0.5, 1, 2, 4, 6, 10]) {
      const z = FM_Z0 + ((Math.log10(v) - Math.log10(0.25)) / (Math.log10(10) - Math.log10(0.25))) * (FM_Z1 - FM_Z0 - 6);
      sc.push(k.segment([FM[0] + 2, FM[1] - 5, z], [FM[0] + 7, FM[1] - 5, z], P));
    }
    out.push(L(sc.join(""), { tone: "mid" }));
    out.push(S(k.cylinder(FM[0], FM[1], 5, 12, 2, P, 32), { tone: "mid" }));
    Q.add([FM[0], FM[1] - 8, 0], out.join(""), -2);
    Q.add([FM[0], FM[1], 14], S(k.cylinder(FM[0], FM[1], 4.4, 14, FM_Z1 - 14, P, 32), { tone: "hi", className: "iso-glass" }) +
      L(k.rise([FM[0] - 1.8, FM[1] + 2.4], 16, FM_Z1 - 2, P), { tone: "faint" }), -1);
    Q.add([FM[0], FM[1], 15], part("bobbin", S(k.cylinder(FM[0], FM[1], 3.4, FM_Z0 - 4, 4, P, 24), { tone: "hi", lit: true }) +
      S(k.cylinder(FM[0], FM[1], 1.6, FM_Z0, 1.6, P, 16), { tone: "hi", lit: true })), -0.5);
    Q.add([FM[0], FM[1], FM_Z1], S(k.cylinder(FM[0], FM[1], 6, FM_Z1, 8, P, 32, 0.5), { tone: "mid" }), 0);
    const knob = [FM[0] + 12, FM[1] + 6];
    Q.add([knob[0], knob[1], 0], S(k.cylinder(knob[0], knob[1], 3.4, 12, 2, P, 20), { tone: "mid" }) + S(k.cylinder(knob[0], knob[1], 5, 14, 6, P, 32), { tone: "mid" }) +
      L(k.knurl(knob[0], knob[1], 5, 14, 20, 30, P), { tone: "lo" }), 1);
  }

  // hoses: fresh gas line, then the two corrugated limbs, chunked by depth
  for (const c of hose(fresh, 1.6, P, { tone: "mid", maxLength: 30, bend: 3 })) Q.add(c.mid, c.svg, 0.2);
  const rings = { pitch: 4.2, steps: 6, fade: [0.15, 0.5], tone: "lo" };
  for (const c of hose(insp, 5, P, { rings, maxLength: 40 })) Q.add(c.mid, c.svg, 0);
  for (const c of hose(exp, 5, P, { rings, maxLength: 40 })) Q.add(c.mid, c.svg, 0);

  // Y-piece, filter, elbow and the test lung (a morph)
  {
    const F = G.frameAlong([Y[0], Y[1], Y[2] + 6], [0, 0, -1]);
    Q.add([Y[0], Y[1], Y[2]], S(k.cylinder(Y[0], Y[1], 7, Y[2] - 2, 6, P, 32, 0.5), { tone: "mid" }) + S(G.disc(8, 14, 4, F, P), { tone: "mid" }), 1);
    Q.add([Y[0], Y[1], 66], S(k.cylinder(Y[0], Y[1], 8.4, 60, 10, P, 40, 0.5), { tone: "hi" }) + L(k.sideArc(Y[0], Y[1], 8.4, 65, P, 30), { tone: "faint" }) +
      S(k.cylinder(Y[0], Y[1], 3.6, 56, 4, P, 24), { tone: "mid" }), 1.2);
    const lung = (f) => {
      const r = 7 + 9 * f;
      return S(balloon(Y[0], Y[1], 56, [[0, 3.6], [2.5, 4.2], [8, r * 0.85], [14, r * 0.98], [20, r], [27, r * 0.94], [33, r * 0.78], [37, r * 0.5], [40, r * 0.2]], P), { tone: "hi", crease: "none", lit: true });
    };
    const m = morph(lung, range(8), 0.3);
    morphs.lung = m.data;
    Q.add([Y[0], Y[1], 30], part("lung", m.markup), 1.1);
  }

  // gas parcels: circles the driver places along the limbs each frame
  const gas = [];
  for (let i = 0; i < 7; i++) gas.push(`<circle data-iso-part="gi${i}" class="iso-gas" data-tone="green" r="1.7" cx="0" cy="0" visibility="hidden"/>`);
  for (let i = 0; i < 7; i++) gas.push(`<circle data-iso-part="ge${i}" class="iso-gas" data-tone="red" r="1.7" cx="0" cy="0" visibility="hidden"/>`);
  for (let i = 0; i < 3; i++) gas.push(`<circle data-iso-part="gs${i}" class="iso-gas" data-tone="hi" r="1.3" cx="0" cy="0" visibility="hidden"/>`);

  const body = Q.svg() + `<g aria-hidden="true">${gas.join("")}</g>`;
  return {
    P, width: W, height: H, morphs, body,
    data: { insp, exp, apl: [[APL[0] - 12, APL[1], HT + 2.5], [APL[0] - 34, APL[1], HT + 2.5]], fm: [FM_Z0 - 4, FM_Z1 - 6] },
    fig: "Fig 1", title: "Circle system", hint: "Watch one breath go round",
    label: "A circle breathing system on a bench: a two-canister CO2 absorber under a head block carrying the inspiratory and expiratory valve domes, the APL valve and the reservoir bag; corrugated limbs run to a Y-piece and a test lung, and a flowmeter feeds fresh gas in. Valve discs lift in turn, the bag and lung trade volume, and the absorber's indicator colour shows how much is used.",
    caption: "Gas only goes one way round: out through the inspiratory valve, back through the expiratory valve and the absorber. When fresh gas flow is below the minute ventilation the rest is rebreathed, so an exhausted absorber lets CO2 into the inspiratory limb.",
    keys: [{ mark: "green", label: "Gas going to the patient" }, { mark: "red", label: "Exhaled gas (CO2)" }, { mark: "blue", label: "Used soda lime" }],
    sources: [
      "Butterworth JF, Mackey DC, Wasnick JD. Morgan and Mikhail's Clinical Anesthesiology, 7th edition, chapter 3 (circle system, valves, APL valve, absorber).",
      "Baker AB. Low flow and closed circles. Anaesth Intensive Care 1994;22(4):341-342.",
      "West JB, Luks AM. West's Respiratory Physiology, 11th edition, chapter 2 (alveolar ventilation equation).",
    ],
    model: "Numbers come from the Narke circuit model (steady state): rebreathed fraction max(0, VE - FGF) / VE, inspired CO2 from the absorber's efficiency, end-tidal CO2 by the alveolar ventilation equation. Breathing is shown at 12 breaths a minute, I:E 1:2.",
  };
}
