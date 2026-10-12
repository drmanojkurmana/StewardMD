// Variable-bypass vaporizer on a back-bar mount, its case drawn as clear so the inside shows: the concentration dial,
// the splitting valve, the bypass channel, the vaporizing chamber with its wicks and liquid agent, the filler and
// sight glass. The driver (vaporizer.driver.js) splits the gas between bypass and chamber by the agent's vapour
// pressure and moves the parcels in that ratio.
import { k, G, painter, part, tools, hose } from "../lib.mjs";

export default function build() {
  const W = 640, H = 420;
  const PLATE = { x: -130, y: -64, w: 260, d: 124, r: 10 };
  const BAR = { x: -120, y: -54, w: 240, d: 18, r: 4 }, BARZ = [40, 58];
  const CASE = { x: -38, y: -32, w: 76, d: 64, r: 8 }, CZ0 = 6, CZ1 = 128;
  const DIAL = [0, 0], DZ = CZ1;
  const P = k.fitProjection([...k.boxCorners(PLATE, -14, 0), [0, 0, 160], [-120, -54, 70], [120, -54, 70]], W, H, { pad: 22, azimuth: 40 });
  const { S, L, D, at } = tools(P);
  const Q = painter(P);

  Q.add([0, 0, -30], `<path class="iso-halo" d="${k.haloOf(PLATE, -14, 14, P)}"/>`, -1e4);
  Q.add([0, 0, -20], k.corners(PLATE, 22).map(([x, y]) => S(k.cylinder(x, y, 7, -14, 5, P, 28), { tone: "mid" })).join(""), -9e3);
  Q.add([0, 0, -10], S(k.slabOf(PLATE, -9, 9, P, 8, 1.2), { tone: "mid" }) + L(k.planOutline(k.insetPlan(PLATE, 6), 0, P), { tone: "faint" }) +
    D(k.corners(PLATE, 11).map(([x, y]) => at([x, y, 0])), { size: 0.55 }), -8e3);

  // back bar on two posts, with the mount block the vaporizer locks onto
  Q.add([0, -60, 0], [-104, 104].map((x) => S(k.cylinder(x, BAR.y + 9, 6, 0, BARZ[0], P, 28), { tone: "mid" })).join("") +
    S(k.slabOf(BAR, BARZ[0], BARZ[1] - BARZ[0], P, 4, 0.8), { tone: "mid" }) + L(k.sideSeam(BAR, BARZ[0] + 9, P, 4), { tone: "faint" }) +
    D([-112, -60, 60, 112].map((x) => at([x, BAR.y + 9, BARZ[1]])), { size: 0.5 }), -400);
  Q.add([0, -40, BARZ[0]], S(k.slabOf({ x: -24, y: BAR.y + BAR.d - 1, w: 48, d: 8, r: 2 }, BARZ[0] - 2, 22, P, 3, 0.5), { tone: "mid" }) +
    [-14, 14].map((x) => S(k.cylinder(x, BAR.y + BAR.d + 3, 3.4, BARZ[1] + 2, 3, P, 20), { tone: "hi" })).join(""), -300);
  // flow in and out along the bar
  Q.add([0, -60, BARZ[1]], k.faceTextSvg(k.topMatrix([-112, BAR.y + 12], BARZ[1], P, "x"), "FROM FLOWMETERS", { size: 3, tone: "lo" }) +
    k.faceTextSvg(k.topMatrix([52, BAR.y + 12], BARZ[1], P, "x"), "TO OUTLET", { size: 3, tone: "lo" }), -290);

  // inside: the chamber floor and wicks, liquid agent, the two channels (drawn as the parcels' paths)
  const liq = 34;
  Q.add([0, 0, CZ0], `<path class="iso-tint" data-tone="blue" d="${k.slabOf(k.insetPlan(CASE, 5), CZ0 + 3, liq - CZ0 - 3, P, 6).fill}"/>` +
    L(k.planOutline(k.insetPlan(CASE, 5), liq, P, 6), { tone: "mid" }), -50);
  const wicks = [];
  for (let x = CASE.x + 10; x < CASE.x + CASE.w - 6; x += 9) wicks.push(k.segment([x, -18, CZ0 + 6], [x, -18, 86], P));
  Q.add([0, -18, CZ0], L(wicks.join(""), { tone: "lo", dashed: true }) + S(k.slabOf({ x: CASE.x + 6, y: -21, w: CASE.w - 12, d: 2, r: 0.5 }, 86, 2, P, 2), { tone: "mid" }), -40);
  const inlet = [[-120, BAR.y + 9, 50], [-14, BAR.y + 9, 50], [-14, -20, 112], [-4, -10, 112]];
  const bypass = [[-4, -10, 112], [10, -6, 116], [22, 0, 112], [14, -22, 112], [14, BAR.y + 9, 50], [120, BAR.y + 9, 50]];
  const chamber = [[-4, -10, 112], [-18, 4, 96], [-24, 12, 44], [-6, 14, 40], [16, 12, 44], [20, 2, 96], [14, -22, 112], [14, BAR.y + 9, 50], [120, BAR.y + 9, 50]];
  Q.add([0, 0, 90], L(k.pathOf(bypass.slice(0, 4).map(at)), { tone: "faint", dotted: true }) + L(k.pathOf(chamber.slice(0, 7).map(at)), { tone: "faint", dotted: true }), -30);
  // splitting valve: a cone on a stem under the dial
  const Fv = G.frameAlong([0, 0, 104], [0, 0, 1]);
  Q.add([0, 0, 104], S(G.solidOf([[0, 0.1], [6, 5], [10, 2.2], [24, 2.2]], Fv, P, { steps: 36 }), { tone: "hi", lit: true }), -20);

  // the case (clear), seams, filler, sight glass, lock lever, label
  const box = [S(k.slabOf(CASE, CZ0, CZ1 - CZ0, P, 8, 1), { tone: "hi", className: "iso-glass" })];
  box.push(L([CZ0 + 8, 92].map((z) => k.sideSeam(CASE, z, P, 8)).join(""), { tone: "faint" }));
  const fy = CASE.y + CASE.d;
  box.push(L(k.pathOf([[18, fy, 14], [30, fy, 14], [30, fy, 70], [18, fy, 70]].map(at), true), { tone: "mid" }));
  box.push(`<path class="iso-tint" data-tone="blue" d="${k.pathOf([[18.6, fy, 14.6], [29.4, fy, 14.6], [29.4, fy, liq], [18.6, fy, liq]].map(at), true)}"/>`);
  box.push(L(k.segment([18, fy, 62], [30, fy, 62], P) + k.segment([18, fy, 22], [30, fy, 22], P), { tone: "lo" }));
  const Ff = G.frameAlong([-18, fy, 28], [0, 1, 0]);
  box.push(S(G.disc(0, 6, 7, Ff, P), { tone: "mid" }) + S(G.disc(6, 9, 8.6, Ff, P), { tone: "mid" }) + L(G.arcOf(Ff, 7.5, 8.6, P), { tone: "lo" }));
  box.push(k.faceTextSvg(k.sideMatrix([CASE.x + 8, fy], 112, P, "left"), "", { size: 5, tone: "hi" }).replace("<text ", '<text data-iso-part="agent" '));
  Q.add([0, 0, CZ0], box.join(""), 10);

  // dial: collar, knurled knob with the % scale and the pointer, release button
  const dial = [S(k.cylinder(DIAL[0], DIAL[1], 26, DZ, 4, P, 72, 0.6), { tone: "mid" }), S(k.cylinder(DIAL[0], DIAL[1], 22, DZ + 4, 12, P, 72, 0.8), { tone: "hi", crease: "lo" }),
    L(k.knurl(DIAL[0], DIAL[1], 22, DZ + 4, DZ + 16, 90, P, 0.3), { tone: "lo" })];
  const tk = k.radialTicks(DIAL[0], DIAL[1], 25.6, 32, 4, DZ + 4, [1.2, 2.6], P, (-120 * Math.PI) / 180, (240 * Math.PI) / 180);
  dial.push(L(tk.minor, { tone: "lo" }), L(tk.major, { tone: "mid" }));
  dial.push(`<path data-iso-part="pointer" class="iso-line" data-tone="lit" d="" style="stroke-width:1.4"/>`);
  dial.push(S(k.cylinder(-16, 16, 3, DZ + 16, 2, P, 20), { tone: "mid" }));
  dial.push(`<g data-iso-part="scale">${[0, 2, 4, 6, 8].map((v) => {
    const a = ((-120 + v * 30) * Math.PI) / 180;
    return k.faceTextSvg(k.topMatrix([DIAL[0] + Math.sin(a) * 29.5, DIAL[1] - Math.cos(a) * 29.5 + 1], DZ + 4, P, "x"), String(v), { size: 3.2, tone: "mid", anchor: "middle" });
  }).join("")}</g>`);
  Q.add([0, 0, DZ], dial.join(""), 20);

  const gas = [];
  for (let i = 0; i < 10; i++) gas.push(`<circle data-iso-part="gb${i}" class="iso-gas" data-tone="green" r="1.6" cx="0" cy="0" visibility="hidden"/>`);
  for (let i = 0; i < 6; i++) gas.push(`<circle data-iso-part="gc${i}" class="iso-gas" data-tone="green" r="1.6" cx="0" cy="0" visibility="hidden"/>`);
  for (let i = 0; i < 6; i++) gas.push(`<circle data-iso-part="gi${i}" class="iso-gas" data-tone="green" r="1.6" cx="0" cy="0" visibility="hidden"/>`);

  return {
    P, width: W, height: H, body: Q.svg() + `<g aria-hidden="true">${gas.join("")}</g>`,
    data: { inlet, bypass, chamber, dial: [DIAL[0], DIAL[1], DZ + 16.3, 19] },
    fig: "Fig 2", title: "Vaporizer", hint: "Turn the dial, watch the split",
    label: "A variable-bypass vaporizer locked onto a back bar, its case drawn clear: fresh gas enters from the flowmeters, the splitting valve under the concentration dial sends most of it straight through the bypass and a small share down through the vaporizing chamber over wicks soaked in liquid agent, and the two streams rejoin on the way to the outlet.",
    caption: "The dial does not add vapour; it sets a split. Gas through the chamber leaves saturated at the agent's vapour pressure, so a small share carries a lot of agent. Sevoflurane's lower vapour pressure needs a bigger share than isoflurane for the same dial setting.",
    keys: [{ mark: "green", label: "Fresh gas" }, { mark: "blue", label: "Liquid agent and saturated gas" }],
    sources: [
      "Butterworth JF, Mackey DC, Wasnick JD. Morgan and Mikhail's Clinical Anesthesiology, 7th edition, chapter 4 (variable-bypass vaporizers, splitting ratio; vapour pressure at 20 C: isoflurane 238 mmHg, sevoflurane 157 mmHg).",
      "Liquid agent use: about 182 mL of sevoflurane vapour and 195 mL of isoflurane vapour per mL of liquid at 20 C.",
    ],
    model: "At sea level (760 mmHg) and 20 C. Output vapour V = C x F / (1 - C). Chamber carrier flow = V x (760 - SVP) / SVP, the rest goes through the bypass. Liquid used per hour = V x 60 / vapour per mL of liquid. Temperature compensation and pumping effects are not modelled.",
  };
}
