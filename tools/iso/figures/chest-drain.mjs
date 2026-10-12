// Three-bottle chest drain on a tray, next to a chest phantom: collection bottle, water seal (tube 2 cm under water)
// and suction control (vent tube 20 cm under water). Units: 2.5 per cmH2O of water height. The driver
// (chest-drain.driver.js) swings the water seal column with breathing and bubbles where air passes.
import { k, G, painter, part, morph, range, tools, hose } from "../lib.mjs";

export default function build() {
  const W = 640, H = 420, U = 2.5;
  const PLATE = { x: -186, y: -50, w: 300, d: 104, r: 10 };
  const TRAY = { x: -96, y: -28, w: 196, d: 56, r: 6 }, TZ = 6;
  const BX = [-60, 2, 64], BR = 18, BH = 72, B0 = TZ + 2, BT = B0 + BH;
  const SEAL = { water: B0 + 22, tip: B0 + 22 - 2 * U };
  const SUCT = { water: B0 + 58, tip: B0 + 58 - 20 * U };
  const COLL = { fluid: B0 + 16 };
  const P = k.fitProjection([...k.boxCorners(PLATE, -14, 0), [BX[2], 0, BT + 40], [BX[2] + 30, 0, BT + 30], [-150, 0, 80]], W, H, { pad: 22, azimuth: 30 });
  const { S, L, D, at } = tools(P);
  const Q = painter(P);
  const morphs = {};

  Q.add([0, 0, -30], `<path class="iso-halo" d="${k.haloOf(PLATE, -14, 14, P)}"/>`, -1e4);
  Q.add([0, 0, -20], k.corners(PLATE, 22).map(([x, y]) => S(k.cylinder(x, y, 7, -14, 5, P, 28), { tone: "mid" })).join(""), -9e3);
  Q.add([0, 0, -10], S(k.slabOf(PLATE, -9, 9, P, 8, 1.2), { tone: "mid" }) + L(k.planOutline(k.insetPlan(PLATE, 6), 0, P), { tone: "faint" }) +
    D(k.corners(PLATE, 11).map(([x, y]) => at([x, y, 0])), { size: 0.55 }), -8e3);
  Q.add([0, 0, 0], S(k.slabOf(TRAY, 0, TZ, P, 6, 0.8), { tone: "mid" }) + L(k.planOutline(k.insetPlan(TRAY, 4), TZ, P, 6), { tone: "faint" }), -7e3);

  // chest phantom: block with rib lines on its two visible faces, a dressing and the drain entry
  const CH = { x: -178, y: -38, w: 52, d: 76, r: 8 };
  const ribs = [];
  for (let z = 18; z <= 58; z += 8) ribs.push(k.segment([CH.x + 8, CH.y + CH.d, z], [CH.x + CH.w - 8, CH.y + CH.d, z - 3], P));
  for (let z = 18; z <= 58; z += 8) ribs.push(k.segment([CH.x + CH.w, CH.y + 10, z - 3], [CH.x + CH.w, CH.y + CH.d - 10, z - 3], P));
  Q.add([CH.x + CH.w / 2, 0, 0], S(k.slabOf(CH, 0, 66, P, 8, 1), { tone: "mid" }) + L(ribs.join(""), { tone: "faint" }) +
    S(k.slabOf({ x: CH.x + CH.w - 0.4, y: -10, w: 1.4, d: 20, r: 2 }, 32, 18, P, 3), { tone: "hi", crease: "none" }), -100);

  // bottles: glass, liquid (collection: drainage, seal and suction: water), stopper
  const liquids = [[COLL.fluid, "red"], [SEAL.water, "blue"], [SUCT.water, "blue"]];
  BX.forEach((x, i) => {
    const out = [S(k.cylinder(x, 0, BR, B0, BH, P, 64), { tone: "hi", className: "iso-glass" })];
    out.push(`<path class="iso-tint" data-tone="${liquids[i][1]}" d="${k.cylinder(x, 0, BR - 0.6, B0 + 0.4, liquids[i][0] - B0 - 0.4, P, 64).fill}"/>`);
    out.push(L(k.ring(x, 0, BR - 0.6, liquids[i][0], P, 64), { tone: "mid" }));
    const sc = [];
    for (let z = B0 + 4; z < BT - 6; z += U * 2) sc.push(k.segment(...[[-0.18, 0.18]].flatMap(([a, b]) => [[x + Math.cos(0.5 + a) * BR, Math.sin(0.5 + a) * BR, z], [x + Math.cos(0.5 + b) * BR, Math.sin(0.5 + b) * BR, z]]), P));
    out.push(L(sc.join(""), { tone: "faint" }));
    Q.add([x, 0, B0], out.join(""), 0);
    Q.add([x, 0, BT], S(k.cylinder(x, 0, BR + 1.5, BT - 4, 4, P, 64, 0.5), { tone: "mid" }) + S(k.cylinder(x, 0, BR - 2, BT, 8, P, 56, 0.6), { tone: "lo" }), 20);
  });
  // glass tubes through the stoppers: [x offset, bottom z, top z]
  const tubes = [[BX[0] - 7, BT - 14, BT + 14], [BX[0] + 7, BT - 10, BT + 12], [BX[1] - 7, SEAL.tip, BT + 12], [BX[1] + 7, BT - 10, BT + 12], [BX[2] - 8, BT - 10, BT + 12], [BX[2], SUCT.tip, BT + 22], [BX[2] + 8, BT - 10, BT + 12]];
  tubes.forEach(([x, z0, z1], i) => Q.add([x, 0, z0], S(k.cylinder(x, 0, 2.2, z0, z1 - z0, P, 20), { tone: "hi", className: "iso-glass" }), z1 > BT ? 21 + i * 0.01 : 1));
  // seal tube water column (a morph from the tip up to 12 cmH2O above the surface)
  const ZMAX = SEAL.water + 12 * U;
  const column = (f) => `<path class="iso-tint" data-tone="blue" d="${k.cylinder(BX[1] - 7, 0, 1.6, SEAL.tip, Math.max(0.3, SEAL.tip + f * (ZMAX - SEAL.tip) - SEAL.tip), P, 20).fill}"/>`;
  const mc = morph(column, range(2), (SEAL.water - SEAL.tip) / (ZMAX - SEAL.tip));
  morphs.col = mc.data;
  Q.add([BX[1] - 7, 0, SEAL.tip], part("col", mc.markup), 1.5);
  // the 2 cm and 20 cm marks
  Q.add([BX[1], 0, 0], L(k.segment([BX[1] - 12, 0, SEAL.tip], [BX[1] - 2, 0, SEAL.tip], P), { tone: "mid", dashed: true }), 2);
  Q.add([BX[2], 0, 0], L(k.segment([BX[2] - 5, 0, SUCT.tip], [BX[2] + 5, 0, SUCT.tip], P), { tone: "mid", dashed: true }), 2);
  for (const [x, z, t] of [[BX[1] + 20, SEAL.water + 1, "2 cm"], [BX[2] + 20, SUCT.water - 22 * U, "20 cm"]]) {
    Q.add([x, 0, z], k.faceTextSvg(k.sideMatrix([x, BR + 1], z, P, "left"), t, { size: 5, tone: "mid" }), 30);
  }

  // tubing: patient to collection, collection to seal, seal to suction, suction to wall
  const lines = [
    [[CH.x + CH.w, 0, 40], [CH.x + CH.w + 20, 0, 40], [-110, 6, 110], [BX[0] - 7, 0, BT + 30], [BX[0] - 7, 0, BT + 14]],
    [[BX[0] + 7, 0, BT + 12], [BX[0] + 7, 0, BT + 24], [BX[1] - 7, 0, BT + 24], [BX[1] - 7, 0, BT + 12]],
    [[BX[1] + 7, 0, BT + 12], [BX[1] + 7, 0, BT + 22], [BX[2] - 8, 0, BT + 22], [BX[2] - 8, 0, BT + 12]],
    [[BX[2] + 8, 0, BT + 12], [BX[2] + 8, 0, BT + 22], [BX[2] + 34, 0, BT + 22], [BX[2] + 40, 10, BT + 6]],
  ];
  lines.forEach((r, i) => { for (const c of hose(r, i ? 2.4 : 3, P, { tone: "mid", maxLength: 50, bend: 3 })) Q.add(c.mid, c.svg, 40 + i); });

  // bubbles: seal (rising from the tube tip) and suction control (rising from the vent tube tip)
  const bub = [];
  for (let i = 0; i < 5; i++) bub.push(`<circle data-iso-part="bs${i}" class="iso-line" data-tone="hi" r="1.8" cx="0" cy="0" visibility="hidden"/>`);
  for (let i = 0; i < 5; i++) bub.push(`<circle data-iso-part="bv${i}" class="iso-line" data-tone="hi" r="1.6" cx="0" cy="0" visibility="hidden"/>`);
  // fluid drops in the patient line
  for (let i = 0; i < 3; i++) bub.push(`<circle data-iso-part="fl${i}" class="iso-gas" data-tone="red" r="1.3" cx="0" cy="0" visibility="hidden"/>`);

  return {
    P, width: W, height: H, morphs, body: Q.svg() + `<g aria-hidden="true">${bub.join("")}</g>`,
    data: { U, seal: [BX[1] - 7, 0, SEAL.tip, SEAL.water], suct: [BX[2], 0, SUCT.tip, SUCT.water], zmax: ZMAX, line: lines[0] },
    fig: "Fig 6", title: "Chest drain", hint: "Watch the water seal",
    label: "A three-bottle chest drain on a tray beside a chest phantom: the collection bottle, the water seal bottle whose tube dips 2 cm under water, and the suction control bottle whose open vent tube dips 20 cm under water. The water in the seal tube rises and falls with breathing, and bubbles show where air is passing.",
    caption: "The water seal is a one-way valve: air leaves the chest by bubbling out under 2 cm of water and cannot come back. The column in its tube swings with breathing while the drain is open into the pleura. On suction, the depth of the vent tube, not the wall dial, sets the pressure: past 20 cmH2O the bottle just bubbles in room air.",
    keys: [{ mark: "red", label: "Drainage" }, { mark: "blue", label: "Water" }],
    sources: [
      "Laws D, Neville E, Duffy J; British Thoracic Society Pleural Diseases Group. BTS guidelines for the insertion of a chest drain. Thorax 2003;58(Suppl II):ii53-ii59 (underwater seal, swinging, bubbling, suction).",
      "Advanced Trauma Life Support Student Course Manual, 10th edition, American College of Surgeons 2018 (chest tube drainage).",
    ],
    model: "Breathing quietly, pleural pressure is taken as about -4 cmH2O at the end of expiration and -10 at the end of inspiration. The seal column stands at the drain pressure below the bottle's own pressure. Air bubbles through the seal when the drain pressure is above the 2 cm the tube is submerged; on suction the system sits at -20 cmH2O, set by the vent tube.",
  };
}
