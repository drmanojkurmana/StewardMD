// Sidestream capnography: a Y-piece with a sampling port on a test lung, the thin sampling line laid across the
// bench, and the gas monitor with its water trap and a screen showing the capnogram. The driver
// (capno-line.driver.js) sends each breath's CO2 down the line and draws the trace late by the transit time.
import { k, G, painter, part, morph, range, tools, hose, balloon } from "../lib.mjs";

export default function build() {
  const W = 640, H = 400;
  const PLATE = { x: -158, y: -62, w: 312, d: 124, r: 10 };
  const MON = { x: 58, y: -44, w: 80, d: 54, r: 7 }, MZ = [6, 66];
  const Y = [-112, -8, 84];
  const P = k.fitProjection([...k.boxCorners(PLATE, -14, 0), [Y[0], Y[1], 100], [MON.x + MON.w, MON.y, 80]], W, H, { pad: 22, azimuth: 36 });
  const { S, L, D, at } = tools(P);
  const Q = painter(P);
  const morphs = {};

  Q.add([0, 0, -30], `<path class="iso-halo" d="${k.haloOf(PLATE, -14, 14, P)}"/>`, -1e4);
  Q.add([0, 0, -20], k.corners(PLATE, 22).map(([x, y]) => S(k.cylinder(x, y, 7, -14, 5, P, 28), { tone: "mid" })).join(""), -9e3);
  Q.add([0, 0, -10], S(k.slabOf(PLATE, -9, 9, P, 8, 1.2), { tone: "mid" }) + L(k.planOutline(k.insetPlan(PLATE, 6), 0, P), { tone: "faint" }) +
    D(k.corners(PLATE, 11).map(([x, y]) => at([x, y, 0])), { size: 0.55 }), -8e3);

  // stand with an arm holding the Y-piece; the two limb stubs; HME filter with the sampling port
  Q.add([-140, -40, 0], S(k.cylinder(-140, -40, 12, 0, 4, P, 36, 0.5), { tone: "mid" }) + S(k.cylinder(-140, -40, 3, 4, Y[2] + 10, P, 20), { tone: "mid" }), -200);
  for (const c of hose([[-140, -40, Y[2] + 8], [Y[0], Y[1] - 14, Y[2] + 8], [Y[0], Y[1] - 6, Y[2] + 4]], 2, P, { tone: "mid", maxLength: 60 })) Q.add(c.mid, c.svg, -150);
  const Fl = G.frameAlong([Y[0], Y[1], Y[2]], [-1, -1, 0.4].map((v) => v / Math.hypot(1, 1, 0.4)));
  const Fr = G.frameAlong([Y[0], Y[1], Y[2]], [1, -1, 0.4].map((v) => v / Math.hypot(1, 1, 0.4)));
  for (const F of [Fl, Fr]) Q.add(G.pointOf(F, 12, 0, 0), S(G.disc(4, 24, 5, F, P), { tone: "hi" }) + L([8, 12, 16, 20].map((s) => G.arcOf(F, s, 5, P)).join(""), { tone: "faint" }) + S(G.disc(24, 26, 5.6, F, P), { tone: "mid" }), -100);
  Q.add([Y[0], Y[1], Y[2]], S(k.cylinder(Y[0], Y[1], 6.4, Y[2] - 6, 8, P, 32, 0.5), { tone: "mid" }) + S(k.cylinder(Y[0], Y[1], 9.6, Y[2] - 20, 14, P, 40, 0.6), { tone: "hi" }) +
    L(k.sideArc(Y[0], Y[1], 9.6, Y[2] - 13, P, 30), { tone: "faint" }) + S(k.cylinder(Y[0], Y[1], 3.6, Y[2] - 26, 6, P, 24), { tone: "mid" }), 0);
  const port = [Y[0] + 7, Y[1] + 5, Y[2] - 8];
  Q.add(port, S(k.cylinder(port[0], port[1], 2, port[2] - 2, 6, P, 16), { tone: "hi" }), 2);
  const lung = (f) => { const r = 8 + 9 * f; return S(balloon(Y[0], Y[1], Y[2] - 26, [[0, 3.6], [3, 4.4], [8, r * 0.85], [14, r * 0.98], [20, r], [27, r * 0.94], [33, r * 0.78], [37, r * 0.5], [40, r * 0.2]], P), { tone: "hi", crease: "none", lit: true }); };
  const m = morph(lung, range(4), 0.3);
  morphs.lung = m.data;
  Q.add([Y[0], Y[1], 30], part("lung", m.markup), 1);

  // the sampling line: from the port, over the bench in a loose S, up into the water trap
  const trap = [MON.x + 70, MON.y + MON.d + 7];
  const route = [[port[0], port[1], port[2] + 4], [port[0] + 6, port[1] + 6, port[2] + 10], [port[0] + 24, port[1] + 30, 30], [-70, 46, 2], [-20, 54, 2], [20, 30, 2], [50, 48, 2], [trap[0] - 16, trap[1] + 4, 30], [trap[0], trap[1], 60], [trap[0], trap[1], 56]];
  const line = G.fillet(route, 8);
  for (const c of hose(line, 1.2, P, { tone: "mid", maxLength: 30, bend: 1 })) Q.add(c.mid, c.svg, 3);

  // monitor: case on feet, front screen with a frame, keys, water trap on its side, exhaust port
  const fy = MON.y + MON.d;
  const mon = [];
  for (const [x, y] of k.corners(MON, 10)) mon.push(S(k.cylinder(x, y, 4, 0, MZ[0], P, 20), { tone: "mid" }));
  mon.push(S(k.slabOf(MON, MZ[0], MZ[1] - MZ[0], P, 8, 1), { tone: "mid" }));
  const rect = (x0, x1, z0, z1, y) => k.pathOf([at([x0, y, z0]), at([x1, y, z0]), at([x1, y, z1]), at([x0, y, z1])], true);
  mon.push(L(rect(MON.x + 6, MON.x + 64, 22, 60, fy + 0.05), { tone: "mid" }) + L(rect(MON.x + 8, MON.x + 62, 24, 58, fy + 0.05), { tone: "faint" }));
  mon.push(L([0, 1, 2, 3].map((i) => rect(MON.x + 8 + i * 14, MON.x + 18 + i * 14, 11, 16, fy + 0.05)).join(""), { tone: "lo" }));
  mon.push(D([at([MON.x + 72, fy + 0.05, 56])], { size: 1, tone: "hi" }));
  mon.push(L([0, 1, 2, 3, 4, 5].map((i) => k.segment([MON.x + MON.w, MON.y + 10, 20 + i * 6], [MON.x + MON.w, MON.y + MON.d - 10, 20 + i * 6], P)).join(""), { tone: "faint" }));
  mon.push(S(k.slabOf({ x: MON.x + 20, y: MON.y + 20, w: 40, d: 6, r: 3 }, MZ[1], 4, P, 4, 0.4), { tone: "mid" }));
  const M = k.sideMatrix([MON.x + 8, fy + 0.06], 58, P, "left");
  mon.push(`<g transform="${M}"><path class="iso-line" data-tone="faint" d="M0 28H54M0 4H54" /><path data-iso-part="trace" class="iso-line" data-tone="hi" d="" style="stroke-width:1.1"/></g>`);
  mon.push(k.faceTextSvg(k.sideMatrix([MON.x + 9, fy + 0.06], 54.5, P, "left"), "CO2", { size: 2.6, tone: "lo" }));
  mon.push(k.faceTextSvg(k.sideMatrix([MON.x + 40, fy + 0.06], 54.5, P, "left"), "", { size: 3, tone: "hi" }).replace("<text ", '<text data-iso-part="et" '));
  Q.add([MON.x + MON.w / 2, MON.y + MON.d / 2, MZ[0]], mon.join(""), 0);
  Q.add([trap[0], trap[1] + 30, 20], S(k.slabOf({ x: trap[0] - 6, y: trap[1] - 8, w: 12, d: 8, r: 2 }, 40, 14, P, 3, 0.4), { tone: "mid" }) +
    S(k.cylinder(trap[0], trap[1], 6, 18, 22, P, 32), { tone: "hi", className: "iso-glass" }) + S(k.cylinder(trap[0], trap[1], 6.6, 52, 3, P, 32, 0.5), { tone: "mid" }), 5);

  const bolus = [];
  for (let i = 0; i < 8; i++) bolus.push(`<circle data-iso-part="b${i}" class="iso-gas" data-tone="red" r="1.6" cx="0" cy="0" visibility="hidden"/>`);
  const round = (p) => p.map((v) => Math.round(v * 10) / 10);
  return {
    P, width: W, height: H, morphs, body: Q.svg() + `<g aria-hidden="true">${bolus.join("")}</g>`,
    data: { line: line.map(round) },
    fig: "Fig 3", title: "Sidestream capnography", hint: "The trace runs late",
    label: "Sidestream capnography on a bench: a Y-piece with a heat and moisture filter and a sampling port above a test lung, a thin sampling line laid across the bench, and the gas monitor with its water trap and screen. Each exhaled breath's CO2 travels down the line, so the screen draws it after the lung has already emptied.",
    caption: "A sidestream monitor sees the gas only after it has travelled the whole line. A longer line or a lower sampling flow makes the trace later. The sampled gas also leaves the circuit unless the monitor sends it back, which matters at low fresh gas flow.",
    keys: [{ mark: "red", label: "Exhaled CO2 in the sampling line" }, { mark: "hi", label: "Capnogram on the monitor" }],
    sources: [
      "Butterworth JF, Mackey DC, Wasnick JD. Morgan and Mikhail's Clinical Anesthesiology, 7th edition, chapter 6 (sidestream capnography: sampling rate, transit delay, water trap).",
      "Jaffe MB. Mainstream or sidestream capnography? Respironics technical white paper, 2002 (sampling flow 50 to 200 mL/min; delay depends on line length and flow).",
    ],
    model: "Transit time = line volume / sampling flow, with a 1.2 mm bore line (volume = pi x 0.06 cm squared x length). Rise time and mixing in the line are not modelled. Breathing at 12 breaths a minute, end-tidal CO2 38 mmHg.",
  };
}
