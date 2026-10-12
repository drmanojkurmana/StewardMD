// Syringe driver on a bench, in millimetres: housing with a rate display and keypad, a syringe in the cradle under
// its clamp, the plunger, the pusher block on its lead screw, and the extension line. Three syringe sizes are drawn;
// the driver shows one. The driver (syringe-pump.driver.js) moves the plunger by rate / barrel area.
import { k, G, painter, part, morph, range, tools, hose } from "../lib.mjs";

// Typical barrel inner diameters (mm). Brands differ, which is why a pump is set to the brand in it.
export const SIZES = { 50: 26.6, 20: 19.1, 10: 14.5 };

export default function build() {
  const W = 640, H = 380;
  const PLATE = { x: -128, y: -46, w: 300, d: 106, r: 10 };
  const BODY = { x: -82, y: -30, w: 240, d: 48, r: 7 }, BZ0 = 6, BZ1 = 44;
  const X0 = -62, AX = [1, 0, 0];
  const P = k.fitProjection([...k.boxCorners(PLATE, -14, 0), [160, -30, 100], [-120, 40, 80], [X0 - 30, 0, 70]], W, H, { pad: 22, azimuth: 32 });
  const { S, L, D, at } = tools(P);
  const Q = painter(P);
  const morphs = {}, data = { sizes: {} };

  Q.add([0, 0, -30], `<path class="iso-halo" d="${k.haloOf(PLATE, -14, 14, P)}"/>`, -1e4);
  Q.add([0, 0, -20], k.corners(PLATE, 22).map(([x, y]) => S(k.cylinder(x, y, 7, -14, 5, P, 28), { tone: "mid" })).join(""), -9e3);
  Q.add([0, 0, -10], S(k.slabOf(PLATE, -9, 9, P, 8, 1.2), { tone: "mid" }) + L(k.planOutline(k.insetPlan(PLATE, 6), 0, P), { tone: "faint" }) +
    D(k.corners(PLATE, 11).map(([x, y]) => at([x, y, 0])), { size: 0.55 }), -8e3);

  // housing on four feet, seam, front display and keypad, pole clamp boss at the back
  const body = [];
  for (const [x, y] of k.corners(BODY, 14)) body.push(S(k.cylinder(x, y, 5, 0, BZ0, P, 24), { tone: "mid" }));
  body.push(S(k.slabOf(BODY, BZ0, BZ1 - BZ0, P, 8, 1.2), { tone: "mid" }));
  body.push(L(k.sideSeam(BODY, BZ0 + 9, P, 8), { tone: "faint" }));
  const fy = BODY.y + BODY.d;
  const rect = (x0, x1, z0, z1, y) => k.pathOf([at([x0, y, z0]), at([x1, y, z0]), at([x1, y, z1]), at([x0, y, z1])], true);
  body.push(L(rect(-74, -18, 20, 40, fy + 0.05), { tone: "mid" }) + L(rect(-72, -20, 22, 38, fy + 0.05), { tone: "faint" }));
  let keys = "";
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) keys += rect(-10 + i * 11, -3 + i * 11, 22 + j * 9, 28 + j * 9, fy + 0.05);
  body.push(L(keys, { tone: "lo" }));
  body.push(D([at([40, fy + 0.05, 36])], { size: 1.1, tone: "hi" }));
  const txt = k.faceTextSvg(k.sideMatrix([-70, fy + 0.05], 33, P, "left"), "0.5 mL/h", { size: 7, tone: "hi" }).replace("<text ", '<text data-iso-part="rate" ');
  const sub = k.faceTextSvg(k.sideMatrix([-70, fy + 0.05], 26, P, "left"), "50 mL", { size: 4, tone: "lo" }).replace("<text ", '<text data-iso-part="size" ');
  body.push(txt, sub);
  Q.add([BODY.x + BODY.w / 2, 0, BZ0], body.join(""), -50);

  // cradle rails and the lead screw with its guide rod
  const ZC = BZ1 + 16;
  Q.add([40, -6, BZ1], S(k.slabOf({ x: X0 - 8, y: -14, w: 130, d: 4, r: 1 }, BZ1, 4, P, 2, 0.4), { tone: "mid" }) +
    S(k.slabOf({ x: X0 - 8, y: 10, w: 130, d: 4, r: 1 }, BZ1, 4, P, 2, 0.4), { tone: "mid" }), -40);
  const FS = G.frameAlong([60, -22, BZ1 + 8], AX);
  const screw = [S(G.disc(0, 96, 3.2, FS, P), { tone: "hi" })];
  const threads = [];
  for (let s = 2; s < 95; s += 2.2) threads.push(G.arcOf(FS, s, 3.2, P));
  screw.push(L(threads.join(""), { tone: "lo" }));
  screw.push(S(G.disc(-4, 0, 5.4, FS, P), { tone: "mid" }) + S(G.disc(96, 100, 5.4, FS, P), { tone: "mid" }));
  const FR = G.frameAlong([60, -12, BZ1 + 5], AX);
  screw.push(S(G.disc(0, 96, 1.8, FR, P), { tone: "hi" }));
  Q.add([110, -22, BZ1 + 8], screw.join(""), -30);

  // one syringe per size: barrel, scale, flange, liquid (a morph), plunger (moves), clamp
  for (const [ml, id] of Object.entries(SIZES)) {
    const R = id / 2, area = Math.PI * R * R, mmPerMl = 1000 / area, scale = +ml * mmPerMl;
    const s0 = 4, s1 = s0 + scale, Lb = s1 + 7, rodLen = Lb + 4.5 - s0 - 6;
    const zc = BZ1 + 4 + R + 1.4;
    const F = G.frameAlong([X0, 0, zc], AX);
    const up = G.angleToward(F, [0, 0.45, 0.9]);
    const show = ml === "50" ? "" : ' visibility="hidden"';
    data.sizes[ml] = { mmPerMl: Math.round(mmPerMl * 1e4) / 1e4, s0, s1, ml: +ml };

    // plunger: rubber stopper with two ribs, cross rod, thumb press; drawn first, seen through the glass
    const plunger = [S(G.disc(s0, s0 + 6, R - 0.2, F, P), { tone: "lo" }), L([1.5, 4.5].map((s) => G.arcOf(F, s0 + s, R - 0.2, P)).join(""), { tone: "mid" })];
    const Fr = G.frameAlong(G.pointOf(F, s0 + 6, 0, 0), AX);
    plunger.push(S(k.extrude([[0, -R * 0.62], [rodLen, -R * 0.62], [rodLen, R * 0.62], [0, R * 0.62]].map(([a, b]) => [X0 + s0 + 6 + a, b]), zc - 1, 2, P), { tone: "hi" }));
    plunger.push(S(G.disc(0, rodLen, 1.2, Fr, P), { tone: "hi" }));
    plunger.push(S(G.disc(rodLen, rodLen + 2.6, R + 3, Fr, P), { tone: "hi" }));
    Q.add([X0 + s1, 0, zc], part("pl" + ml, plunger.join(""), show), 0);

    const liquid = (f) => `<path class="iso-tint" data-tone="blue" d="${G.disc(1.2, s0 + Math.max(0.4, f) * scale, R - 0.4, F, P, { steps: 64 }).fill}"/>`;
    const m = morph(liquid, range(4), 1);
    morphs["liq" + ml] = m.data;
    Q.add([X0 + s1 / 2, 0, zc], part("liq" + ml, m.markup, show), 1);

    const barrel = [S(G.disc(0, Lb, R + 1.3, F, P), { tone: "hi", className: "iso-glass" })];
    const ticks = [], major = [];
    for (let v = 0; v <= +ml; v += +ml >= 50 ? 1 : +ml >= 20 ? 1 : 0.5) {
      const s = s0 + v * mmPerMl, big = Math.abs(v % 5) < 1e-6;
      const w = big ? 0.32 : 0.16;
      (big ? major : ticks).push(k.segment(G.pointOf(F, s, R + 1.35, up - w), G.pointOf(F, s, R + 1.35, up + w), P));
    }
    barrel.push(L(ticks.join(""), { tone: "lo" }), L(major.join(""), { tone: "mid" }));
    barrel.push(S(G.disc(-7, 0, 2.6, F, P), { tone: "hi" }) + S(G.disc(-12, -7, 4.2, F, P), { tone: "mid" }));
    barrel.push(S(G.disc(Lb, Lb + 2.2, R + 7, F, P), { tone: "hi" }));
    const lab = k.faceTextSvg(k.topMatrix([X0 + s0 + 6, -R * 0.4], zc + R + 1.5, P, "x"), ml + " mL", { size: 3.4, tone: "lo" });
    barrel.push(lab);
    Q.add([X0 + s1 / 2, 6, zc], part("bar" + ml, barrel.join(""), show), 2);

    const clamp = [S(k.cylinder(X0 + 30, -24, 4, BZ1, zc + R + 6 - BZ1, P, 24), { tone: "mid" }),
      S(k.slabOf({ x: X0 + 25, y: -24, w: 10, d: 24, r: 2 }, zc + R + 3, 4, P, 3, 0.4), { tone: "mid" }),
      S(k.cylinder(X0 + 30, -24, 5.2, zc + R + 7, 4, P, 24), { tone: "mid" }), L(k.knurl(X0 + 30, -24, 5.2, zc + R + 7, zc + R + 11, 24, P), { tone: "lo" })];
    Q.add([X0 + 30, -10, zc + R], part("cl" + ml, clamp.join(""), show), 3);
    data.sizes[ml].thumb = Math.round((X0 + Lb + 7.1) * 100) / 100;
  }

  // pusher block: slides on the screw, grips the thumb press
  const PX = X0 + 140, PB = { x: PX, y: -30, w: 16, d: 42, r: 3 };
  data.pushX = PX;
  const pusher = [S(k.slabOf(PB, BZ1 + 2, 34, P, 4, 0.6), { tone: "mid" }),
    L(k.sideSeam(PB, BZ1 + 12, P, 4), { tone: "faint" }),
    S(k.cylinder(PX + 8, 6, 3.4, BZ1 + 36, 4, P, 20), { tone: "mid" }),
    D([at([PX + 4, -26, BZ1 + 36]), at([PX + 12, -26, BZ1 + 36])], { size: 0.5 })];
  Q.add([PX + 8, -10, BZ1], part("push", pusher.join("")), 40);

  // extension line from the luer lock down to the bench and forward
  const tip = X0 - 12;
  for (const c of hose([[tip, 0, BZ1 + 19], [tip - 8, 0, BZ1 + 19], [tip - 14, 18, 36], [tip - 12, 40, 2], [20, 50, 2], [60, 54, 2]], 1.3, P, { tone: "mid", maxLength: 40, bend: 6 })) Q.add(c.mid, c.svg, -5);
  // one drop at the end of the line
  Q.add([60, 54, 2], part("drop", S(k.cylinder(62, 54, 1.4, 2, 1.4, P, 16), { tone: "hi", lit: true }), ' visibility="hidden"'), 0);

  return {
    P, width: W, height: H, morphs, body: Q.svg(), data,
    fig: "Fig 4", title: "Syringe driver", hint: "1 second here is 1 hour",
    label: "A syringe driver on a bench: the housing with its rate display and keypad, a syringe clamped in the cradle, the plunger pushed by a block on a lead screw, and the extension line running to the bench. The plunger moves the distance the rate asks for in each hour.",
    caption: "The pump pushes a distance, not a volume: plunger travel per hour is the rate divided by the barrel's area. At newborn rates a big syringe moves under a millimetre an hour, so any slack in the drive is taken up slowly and the first dose is late.",
    keys: [{ mark: "blue", label: "Drug in the syringe" }, { mark: "lit", label: "Plunger and pusher" }],
    sources: [
      "ISMP. Guidelines for optimizing safety with IV push and continuous infusion of high-alert medications in neonates and children: use the smallest syringe practical at low rates (start-up delay and compliance).",
      "Neff T, Fischer J, Fehr S, et al. Start-up delays of infusion syringe pumps. Paediatr Anaesth 2001;11(5):561-565.",
      "Barrel inner diameters are typical values (50 mL 26.6 mm, 20 mL 19.1 mm, 10 mL 14.5 mm); each brand differs, which is why a pump is set to the brand loaded.",
    ],
    model: "Plunger speed (mm/h) = rate (mL/h) x 1000 / barrel area (mm2). Time to empty = volume / rate. Slack in the drive delays the first flow by slack (mm) / plunger speed. Shown as a time lapse: one second is one hour.",
  };
}
