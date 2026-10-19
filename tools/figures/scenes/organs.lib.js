/* Shared organ art for the animated mechanism scenes. Plain globals, ES2015, no imports.
 * Inlined after bio.lib.js when buildScene gets organs:true, so mk/f1/clamp below are the shared ones.
 * organ(parent, kind, x, y, w, opts) draws real anatomy art (NIH BioArt Source public domain,
 * Servier Medical Art CC BY 3.0, one DBCLS CC BY 4.0 knee; injected as _ORG_ART by buildScene
 * for the kinds the page uses) centred on x,y and w px wide, and falls back to the existing
 * procedural layered silhouette for kinds without art (adrenal, uterus, thyroid, ganglion) or when art
 * was not injected (liver, bladder and eye keep their procedural drawings as fallback).
 * Art ports are fractions of the art viewBox (see _ORG_FRAC). The liver-4 art is the bare mass,
 * so the lib adds a procedural gallbladder under the gall port plus short portal and hepatic
 * vein stubs ending at the porta and hepvein ports.
 * opts: { h (px height, else proportional), flip (mirror left/right), cls (extra class), id,
 *   tint (a CSS colour with opacity, overlaid as an organ-shaped mask for disease states),
 *   dim (dull the art) }.
 * Returns { g, kind, x, y, w, h, ports, art } with absolute SVG coords; ports.in/out always exist.
 * Art keeps its own colours (a faint contrast halo keeps it readable in dark and light themes);
 * procedural fill is a vertical gradient whose stops derive from --cc (a theme aware palette var,
 * so dark and light both work); edge stroke and landmark lines use color-mix detail classes.
 * Emits no text, so label font and dash rules are inherited from the calling scene. */
if (!document.getElementById("orgCss")) { var _orgSt = document.createElement("style"); _orgSt.id = "orgCss";
  _orgSt.textContent = ".org-halo{filter:drop-shadow(0 0 1px rgba(0,0,0,.65)) drop-shadow(0 0 1px rgba(255,255,255,.45))}"
  + ".org-b{stroke:color-mix(in srgb,var(--cc) 55%,#000);stroke-width:1.2;stroke-linejoin:round;stroke-linecap:round}"
  + ".org-d{fill:none;stroke:color-mix(in srgb,var(--cc) 40%,var(--anatomy-hi));stroke-width:1;stroke-linecap:round;opacity:.8}"
  + ".org-dk{fill:none;stroke:color-mix(in srgb,var(--cc) 62%,#000);stroke-width:1.1;stroke-linecap:round;opacity:.8}"
  + ".org-f{stroke:color-mix(in srgb,var(--cc) 55%,#000);stroke-width:1;stroke-linejoin:round}"
  + ".org-v{fill:none;stroke-linecap:round}"
  + ".org-liver{--cc:var(--c-rbc)}.org-heart{--cc:var(--c-rbc)}.org-kidney{--cc:var(--c-eos)}.org-lung{--cc:var(--c-endo)}"
  + ".org-stomach{--cc:var(--c-graft)}.org-brain{--cc:var(--c-mac)}.org-pancreas{--cc:var(--c-plt)}.org-spleen{--cc:var(--c-sm)}"
  + ".org-bladder{--cc:var(--c-th2)}.org-uterus{--cc:var(--c-endo)}.org-ovary{--cc:var(--c-plt)}.org-testis{--cc:var(--c-plt)}.org-thyroid{--cc:var(--c-neut)}.org-eye{--cc:#e6e1d4}.org-ganglion{--cc:var(--c-mac)}"
  + ".org-adrenal{--cc:#e9a13b}"
  + ".org-pituitary{--cc:var(--c-mac)}"
  + ".org-bowel{--cc:var(--c-graft)}.org-parathyroid{--cc:#e0a44a}.org-colon{--cc:var(--c-eos)}.org-ear{--cc:var(--c-plt)}.org-skin{--cc:#d9a58c}"
  + ".org-muscle{--cc:var(--c-rbc)}.org-joint{--cc:#cfc8bd}.org-vessel{--cc:var(--c-rbc)}"
  + ".org-lymphnode{--cc:var(--c-lymph)}";
  document.head.appendChild(_orgSt); }
var _orgN = 0;
/* per instance gradients: base (light -> base -> dark of --cc) plus a white top / dark bottom shade overlay */
function _orgDefs(g) {
  _orgN++; var id = "og" + _orgN, hid = "oh" + _orgN;
  var defs = mk("defs", {}, g);
  var lg = mk("linearGradient", { id: id, x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
  var s0 = mk("stop", { offset: "0", "stop-color": "#999" }, lg); s0.setAttribute("style", "stop-color:color-mix(in srgb,var(--cc) 55%,#fff)");
  var s1 = mk("stop", { offset: ".55", "stop-color": "#888" }, lg); s1.setAttribute("style", "stop-color:color-mix(in srgb,var(--cc) 78%,var(--anatomy-paper))");
  var s2 = mk("stop", { offset: "1", "stop-color": "#666" }, lg); s2.setAttribute("style", "stop-color:color-mix(in srgb,var(--cc) 66%,#000)");
  var hg = mk("linearGradient", { id: hid, x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
  mk("stop", { offset: "0", "stop-color": "#fff", "stop-opacity": ".2" }, hg);
  mk("stop", { offset: ".55", "stop-color": "#fff", "stop-opacity": "0" }, hg);
  mk("stop", { offset: "1", "stop-color": "#000", "stop-opacity": ".14" }, hg);
  return { b: "url(#" + id + ")", h: "url(#" + hid + ")" };
}
/* one filled silhouette plus its shade overlay, same path data so the light stays inside */
function _ob(g, d, G) {
  mk("path", { class: "org-b", d: d, fill: G.b, stroke: "#666" }, g);
  mk("path", { d: d, fill: G.h, stroke: "none", "pointer-events": "none" }, g);
}
function _ol(g, d, cls) { return mk("path", { class: cls || "org-d", d: d, fill: "none" }, g); }
function _of(g, d, fillCss, cc) { var e = mk("path", { class: "org-f", d: d, stroke: "#666" }, g); e.setAttribute("style", "fill:" + fillCss + ";--cc:" + cc); return e; }
function _ov(g, d, color, wdt) { var e = mk("path", { class: "org-v", d: d, fill: "none", stroke: "#777", "stroke-width": wdt, "stroke-linecap": "round" }, g); e.setAttribute("style", "stroke:" + color); return e; }
function _odot(g, x, y, r, fillCss) { var e = mk("circle", { cx: x, cy: y, r: r, stroke: "none" }, g); e.setAttribute("style", "fill:" + fillCss); return e; }

/* liver: big right lobe, smaller left lobe, falciform notch, gallbladder, porta hepatis stubs */
function _orgLiver(g, G) {
  _ov(g, "M-2 46L-2 18", "var(--d-ven)", 5); _ov(g, "M7 46L5 20", "var(--d-art)", 3); _ov(g, "M-11 46L-9 20", "var(--c-bac)", 2.5);
  _ob(g, "M-6-30C22-33 44-25 50-7C54 9 40 25 18 30C2 33-5 22-7 6C-8-8-8-22-6-30Z", G);
  _ob(g, "M-8-27C-24-27-40-19-48-6C-51 1-45 9-35 12C-24 15-11 9-8-1C-6-10-6-20-8-27Z", G);
  _ol(g, "M-8-29C-7-18-6-6-4 6", "org-dk");
  _ol(g, "M-2-28C14-29 30-24 40-14");
  _of(g, "M10 18C16 16 22 18 23 24C24 31 19 37 14 36C9 35 7 28 8 23C8 21 9 19 10 18Z", "color-mix(in srgb,var(--c-bac) 62%,var(--anatomy-paper))", "var(--c-bac)");
  return { h0: 78, ports: { in: [-2, 46], out: [12, -30], porta: [-2, 18], gall: [16, 33], lobe: [20, 0] } };
}
/* heart: mass with apex down left, septum, coronary groove, aorta with arch, pulmonary split, caval stubs */
function _orgHeart(g, G) {
  _ov(g, "M-2-18L-2-44C-2-52-10-56-20-54C-28-52-32-46-32-38", "var(--d-art)", 8);
  _ov(g, "M-8-52L-8-59M-15-54L-16-60M-22-53L-24-59", "var(--d-art)", 2.5);
  _ov(g, "M12-16C8-28 2-34-4-38", "var(--d-ven)", 7);
  _ov(g, "M-4-38C-12-40-20-38-28-34", "var(--d-ven)", 4.5); _ov(g, "M-4-38C4-40 12-38 20-34", "var(--d-ven)", 4.5);
  _ov(g, "M20-20L20-52", "var(--d-ven)", 7); _ov(g, "M18 34L18 58", "var(--d-ven)", 7);
  _ov(g, "M-36-2L-50-6M-34 14L-48 16", "var(--d-art)", 4);
  _ob(g, "M-4-32C24-34 42-16 40 10C38 32 12 48-20 50C-34 44-40 24-36 2C-33-18-22-31-4-32Z", G);
  _ol(g, "M0-30C4-10 0 14-14 44", "org-dk");
  _ol(g, "M-34 6C-18 12 6 12 38 4");
  _ol(g, "M-6-28C-14-18-18-6-20 8");
  return { h0: 120, ports: { in: [20, -52], out: [-32, -38], ivc: [18, 58], apex: [-20, 50], pulm: [-28, -34] } };
}
/* kidney: bean with hilum, cortex rim, medulla rays, pelvis funnel, ureter, artery and vein stubs */
function _orgKidney(g, G) {
  _ov(g, "M-12 6C-22 12-28 18-28 30C-28 50-26 70-24 90", "var(--cc)", 4.5);
  _ov(g, "M-50-8C-40-8-30-8-22-6", "var(--d-art)", 4); _ov(g, "M-50 10C-40 10-30 8-22 6", "var(--d-ven)", 5);
  _ob(g, "M8-58C38-58 54-32 50 2C56 32 42 60 8 60C-8 60-16 48-19 34C-26 24-26-24-19-34C-16-48-8-58 8-58Z", G);
  _ol(g, "M8-49C32-49 45-28 42 0C46 28 34 51 8 51C-1 51-8 43-10 32C-15 24-15-24-10-32C-8-43-1-49 8-49Z");
  _ol(g, "M-6-30L14-38M-8-10L16-12M-8 12L16 14M-6 32L14 40");
  _ol(g, "M16-44C30-36 38-20 38 0");
  _of(g, "M-19-14C-8-12-2-8 2-2C-2 4-8 10-18 14C-22 8-22-8-19-14Z", "color-mix(in srgb,var(--cc) 35%,#fff)", "var(--cc)");
  return { h0: 150, ports: { in: [-50, -8], out: [-24, 90], vein: [-50, 10], pelvis: [-12, 4], cortex: [30, 0] } };
}
/* lung: one lung with oblique fissure, hilum bronchus splitting into lobar and segmental branches */
function _orgLung(g, G) {
  _ov(g, "M-58 4L-30 4", "var(--anatomy-hi)", 6);
  _ov(g, "M-30 4C-22-6-16-16-10-26", "var(--anatomy-hi)", 4.5); _ov(g, "M-30 4C-22 14-14 24-6 34", "var(--anatomy-hi)", 4.5);
  _ov(g, "M-18-14L-28-22M-16-16L-8-24M-14-20L-14-32M-20 16L-30 24M-16 20L-6 28M-12 26L-10 38", "var(--anatomy-hi)", 2);
  _ov(g, "M-58-8L-34-6", "var(--d-ven)", 4); _ov(g, "M-58 14L-34 12", "var(--d-art)", 4);
  _ob(g, "M2-60C24-56 40-32 43 8C45 38 32 60 2 62C-24 62-40 42-42 10C-44-24-20-58 2-60Z", G);
  _ol(g, "M-40-2C-20 8 0 22 24 40", "org-dk");
  _ol(g, "M-8-48C8-50 22-40 30-26");
  return { h0: 130, ports: { in: [-58, 4], out: [-58, 14], art: [-58, -8], apex: [2, -60], base: [2, 62] } };
}
/* stomach: J shape with fundus dome, rugae, antrum sweep, pylorus ring, oesophagus and duodenum stubs */
function _orgStomach(g, G) {
  _of(g, "M-38-58L-22-58L-22-36L-38-36Z", "color-mix(in srgb,var(--cc) 70%,var(--anatomy-paper))", "var(--cc)");
  _ob(g, "M-38-36C-46-24-50-8-46 10C-42 30-30 46-12 50C6 54 28 46 40 32C44 27 46 23 46 18L34 14C30 22 20 30 6 32C-8 34-22 26-28 12C-33-1-31-16-26-28C-24-32-22-34-22-36Z", G);
  _ol(g, "M-36-10C-30 6-22 20-8 28M-28-22C-22-6-12 10 4 22M-16-30C-10-14 0 2 14 12");
  _ol(g, "M40 15C43 19 43 25 40 29M34 14C37 18 37 26 34 30", "org-dk");
  _ol(g, "M46 16L60 22M44 28L58 32", "org-dk");
  return { h0: 116, ports: { in: [-30, -58], out: [60, 27], fundus: [-40, -12], antrum: [24, 38], pylorus: [40, 22] } };
}
/* brain lateral: cerebrum with Sylvian fissure and gyri, cerebellum with folia, tapered brainstem */
function _orgBrain(g, G) {
  _ov(g, "M10 50L10 64", "var(--d-art)", 5);
  _ob(g, "M-50-6C-50-32-24-42 4-40C30-38 44-28 44-8C44 10 32 24 8 28C-18 31-50 24-50-6Z", G);
  _ol(g, "M-12 10C2 6 18 2 34-4", "org-dk");
  _ol(g, "M-38-20C-32-10-32 2-38 12M-26-30C-20-20-20-6-26 6M-4-32C2-22 2-8-4 2M10-30C16-20 16-6 10 4M28-22C34-14 34-2 28 8");
  _ol(g, "M-16 6L-24-4M-10 4L-12-8", "org-dk");
  _ob(g, "M2 24L16 24L12 56L6 56Z", G);
  _ol(g, "M2 36C6 38 12 38 16 36");
  _ob(g, "M22 24C34 22 46 26 48 34C50 42 42 48 32 47C24 46 20 38 20 32C20 28 20 26 22 24Z", G);
  _ol(g, "M24 32L44 32M25 37L43 37M27 42L41 42");
  return { h0: 110, ports: { in: [10, 64], out: [4, -40], parenchyma: [-8, -6], cereb: [34, 35], frontal: [-40, -8] } };
}
/* pancreas: bulky head right, tapering tail left, main duct with side branches, islet dots */
function _orgPancreas(g, G) {
  _ob(g, "M-50-4C-32-14-8-14 14-10C32-7 46-2 49 10C51 21 40 28 26 25C8 21-20 12-50 6Z", G);
  _ol(g, "M-46 1C-20-2 10 0 38 10", "org-dk");
  _ol(g, "M-30-1L-34-8M-10-1L-14-9M8 0L4-8M-28 1L-32 8M-6 1L-10 8M12 2L8 10");
  _ol(g, "M52-6C58 4 58 16 50 24");
  _odot(g, -20, -2, 1.6, "var(--d-art)"); _odot(g, 0, 0, 1.6, "var(--d-art)"); _odot(g, 22, 6, 1.6, "var(--d-art)");
  return { h0: 60, ports: { in: [-10, -12], out: [49, 12], head: [36, 8], tail: [-48, 1] } };
}
/* spleen: crescent with top notch, trabeculae, hilar artery and vein stubs below */
function _orgSpleen(g, G) {
  _ov(g, "M-30 52C-28 44-26 40-22 36", "var(--d-art)", 3.5); _ov(g, "M-20 54C-19 46-17 42-13 38", "var(--d-ven)", 4.5);
  _ob(g, "M-38-30C-8-40 28-34 44-12C52 4 44 26 20 34C-4 41-34 32-44 10C-48-4-46-22-38-30Z", G);
  _ol(g, "M-8-36C-4-33 0-33 4-36", "org-dk");
  _ol(g, "M-30-10C-10-2 12-2 32-10M-28 8C-8 16 12 16 30 8");
  return { h0: 96, ports: { in: [-30, 52], out: [-20, 54], hilum: [-18, 37], pulp: [0, 0] } };
}
/* adrenal: small cap that sits on the kidney pole, cortex rim, medulla fold, vessel stubs */
function _orgAdrenal(g, G) {
  _ov(g, "M-52 8L-38 8", "var(--d-art)", 3.5); _ov(g, "M38 8L52 8", "var(--d-ven)", 4);
  _ob(g, "M-45 18C-40-6-22-26 0-26C22-26 40-6 45 18C30 10 15 6 0 6C-15 6-30 10-45 18Z", G);
  _ol(g, "M-36 10C-28-2-14-10 0-10C14-10 28-2 36 10");
  _ol(g, "M-20 4C-10 1 10 1 20 4", "org-dk");
  _odot(g, -12, -8, 1.8, "var(--d-art)"); _odot(g, 8, -12, 1.8, "var(--d-art)");
  return { h0: 60, ports: { in: [-52, 8], out: [52, 8], cortex: [0, -22], medulla: [0, 2] } };
}
/* parathyroid: small oval endocrine gland with capsule rim, chief cell dots, calcium sensor arc, vessel stubs */
function _orgParathyroid(g, G) {
  _ov(g, "M-52 4L-40 2", "var(--d-art)", 3); _ov(g, "M40 6L52 4", "var(--d-ven)", 3.5);
  _ob(g, "M-40-20C-22-32 22-32 40-20C48-6 44 14 24 22C6 30-20 28-32 16C-42 6-43-8-40-20Z", G);
  _ol(g, "M-33-13C-20-22 16-22 32-11");
  _ol(g, "M28-26C34-24 38-20 40-14", "org-dk");
  _odot(g, -16, -4, 3, "color-mix(in srgb,var(--cc) 70%,var(--anatomy-paper))");
  _odot(g, 0, 3, 3, "color-mix(in srgb,var(--cc) 70%,var(--anatomy-paper))");
  _odot(g, 16, -4, 3, "color-mix(in srgb,var(--cc) 70%,var(--anatomy-paper))");
  _odot(g, -2, -12, 2.4, "color-mix(in srgb,var(--cc) 70%,var(--anatomy-paper))");
  _odot(g, 8, 10, 2.4, "color-mix(in srgb,var(--cc) 70%,var(--anatomy-paper))");
  return { h0: 70, ports: { in: [-52, 4], out: [52, 4], casr: [28, -28], chief: [0, 0] } };
}
/* pituitary: pea-sized gland with a stalk stub rising toward the hypothalamus, posterior lobe wedge */
function _orgPituitary(g, G) {
  _ov(g, "M0-18L0-52", "var(--cc)", 7);
  _ob(g, "M-30-20C-30-36-16-46 0-46C16-46 30-36 30-20C30-4 16 4 0 4C-16 4-30-4-30-20Z", G);
  _ol(g, "M-3-42C-6-28-6-14-3-2", "org-dk");
  _ol(g, "M-18-30C-10-36 10-36 18-30");
  _of(g, "M3-34C13-32 19-24 17-14C15-6 9-2 3-2C0-12 0-26 3-34Z", "color-mix(in srgb,var(--cc) 45%,#fff)", "var(--cc)");
  return { h0: 100, ports: { in: [0, -52], out: [34, -4], stalk: [0, -46], post: [10, -18] } };
}
/* ganglion: sensory ganglion with capsule, fibre stubs, satellite glia dots, one big soma with nucleus */
function _orgGanglion(g, G) {
  _ov(g, "M-52 0L-30 0", "var(--anatomy-hi)", 7);
  _ov(g, "M30 0L52 0", "var(--anatomy-hi)", 7);
  _ob(g, "M-32-27C-12-37 13-37 30-25C43-12 43 12 30 25C13 37-12 37-32 27C-42 13-42-13-32-27Z", G);
  _ol(g, "M-27-21C-10-29 12-29 26-19");
  _of(g, "M-16 0C-16-9-9-16 0-16C9-16 16-9 16 0C16 9 9 16 0 16C-9 16-16 9-16 0Z", "color-mix(in srgb,var(--cc) 62%,var(--anatomy-paper))", "var(--cc)");
  _of(g, "M-7 0C-7-4-4-7 0-7C4-7 7-4 7 0C7 4 4 7 0 7C-4 7-7 4-7 0Z", "color-mix(in srgb,var(--cc) 45%,#1a1030)", "var(--cc)");
  _odot(g, 2, 1, 1.8, "color-mix(in srgb,var(--cc) 70%,#fff)");
  _odot(g, -25, -13, 2.6, "color-mix(in srgb,var(--cc) 70%,var(--anatomy-paper))");
  _odot(g, 25, -12, 2.6, "color-mix(in srgb,var(--cc) 70%,var(--anatomy-paper))");
  _odot(g, 0, 28, 2.6, "color-mix(in srgb,var(--cc) 70%,var(--anatomy-paper))");
  _ol(g, "M-13-8L-22-16M13-8L22-16");
  return { h0: 96, ports: { in: [-52, 0], out: [52, 0], soma: [0, 0], nucleus: [0, 0] } };
}
/* lymph node: bean capsule with subcapsular sinus, two follicles with a germinal centre dot, afferent and efferent lymphatic stubs */
function _orgLymphnode(g, G) {
  _ov(g, "M-38-50L-26-32", "var(--c-lymph)", 4); _ov(g, "M-47-43L-31-29", "var(--c-lymph)", 3);
  _ov(g, "M18 44L26 60", "var(--c-lymph)", 5);
  _ob(g, "M-52-18C-52-44-24-52 2-48C30-44 50-26 48 2C46 30 28 48-2 48C-32 48-54 28-52 0Z", G);
  _ol(g, "M-46-16C-44-36-20-44 2-41C26-38 42-24 41 0");
  _ol(g, "M-40 20C-20 34 12 36 34 22");
  _of(g, "M-32-8a15 15 0 1 0 30 0a15 15 0 1 0-30 0", "color-mix(in srgb,var(--cc) 45%,#fff)", "var(--cc)");
  _of(g, "M8-2a14 14 0 1 0 28 0a14 14 0 1 0-28 0", "color-mix(in srgb,var(--cc) 45%,#fff)", "var(--cc)");
  _odot(g, 22, 5, 6, "color-mix(in srgb,var(--cc) 70%,#000)");
  _odot(g, -17, -8, 2.2, "var(--c-plt)"); _odot(g, 22, 5, 2, "var(--c-plt)");
  return { h0: 110, ports: { in: [-38, -50], sinus: [-30, -34], follicle: [-17, -8], germ: [22, 5], paracortex: [-6, 32], hilum: [18, 44], out: [26, 60] } };
}
/* bladder: dome with detrusor arcs, trigone, ureters in from above, urethra out below */
function _orgBladder(g, G) {
  _ov(g, "M-52-44C-44-34-36-26-30-18", "var(--cc)", 4); _ov(g, "M52-44C44-34 36-26 30-18", "var(--cc)", 4);
  _ob(g, "M0-50C26-48 40-30 40-6C40 16 26 32 8 40L-8 40C-26 32-40 16-40-6C-40-30-26-48 0-50Z", G);
  _ob(g, "M-8 40L8 40L8 64L-8 64Z", G);
  _ol(g, "M-8 52L8 52", "org-dk");
  _ol(g, "M-24-8L24-8L0 24Z");
  _ol(g, "M-28-28C-12-36 12-36 28-28M-34-12C-16-22 16-22 34-12");
  return { h0: 120, ports: { in: [-52, -44], out: [0, 64], inR: [52, -44], trigone: [0, 8], dome: [0, -48] } };
}
/* uterus: fundus, cavity, cervix, tubes with fimbriae, ovaries with follicles */
function _orgUterus(g, G) {
  _ov(g, "M-16-16C-26-17-32-19-38-23", "var(--cc)", 3.5); _ov(g, "M16-16C26-17 32-19 38-23", "var(--cc)", 3.5);
  _ov(g, "M-38-23L-44-27M-38-23L-45-23M-38-23L-44-19M-38-23L-42-29", "var(--cc)", 1.2);
  _ov(g, "M38-23L44-27M38-23L45-23M38-23L44-19M38-23L42-29", "var(--cc)", 1.2);
  var eo = mk("ellipse", { class: "org-f", cx: -45, cy: -10, rx: 7, ry: 11, stroke: "#666" }, g);
  eo.setAttribute("style", "fill:color-mix(in srgb,var(--c-plt) 62%,var(--anatomy-paper));--cc:var(--c-plt)");
  var eo2 = mk("ellipse", { class: "org-f", cx: 45, cy: -10, rx: 7, ry: 11, stroke: "#666" }, g);
  eo2.setAttribute("style", "fill:color-mix(in srgb,var(--c-plt) 62%,var(--anatomy-paper));--cc:var(--c-plt)");
  var _fol = "color-mix(in srgb,var(--c-plt) 45%,#000)";
  _odot(g, -47, -14, 1.6, _fol); _odot(g, -43, -8, 1.6, _fol); _odot(g, -46, -4, 1.4, _fol);
  _odot(g, 47, -14, 1.6, _fol); _odot(g, 43, -8, 1.6, _fol); _odot(g, 46, -4, 1.4, _fol);
  _ob(g, "M-16-20C-8-26 8-26 16-20C20-2 15 20 8 32L-8 32C-15 20-20-2-16-20Z", G);
  _of(g, "M-10-14L10-14L0 22Z", "color-mix(in srgb,var(--cc) 45%,#fff)", "var(--cc)");
  _ol(g, "M-11 18L11 18", "org-dk"); _ol(g, "M0 18L0 32");
  return { h0: 100, ports: { in: [-45, -22], out: [0, 33], ovL: [-45, -10], ovR: [45, -10], fundus: [0, -24] } };
}
/* ovary: almond body with surface arcs, hilar artery and vein stubs at the hilum */
function _orgOvary(g, G) {
  _ov(g, "M-52 0L-40 0", "var(--d-art)", 3); _ov(g, "M40 0L52 0", "var(--d-ven)", 3.5);
  _ob(g, "M-40-6C-30-24-5-30 15-26C33-22 42-10 40 6C38 22 20 30 0 29C-20 28-38 14-40-6Z", G);
  _ol(g, "M-28-12C-16-20 0-23 14-21");
  _ol(g, "M-32 4C-20 12-2 17 14 14", "org-dk");
  return { h0: 70, ports: { in: [-52, 0], out: [52, 0], dom: [0, 0], surf: [0, -27] } };
}
/* testis: oval body with tubule arcs, rete lines, vessel stubs above */
function _orgTestis(g, G) {
  _ov(g, "M-52-8L-40-4", "var(--d-art)", 3); _ov(g, "M40-8L52-8", "var(--d-ven)", 3.5);
  _ob(g, "M-40-20C-22-32 22-32 40-20C48-6 44 14 24 22C6 30-20 28-32 16C-42 6-43-8-40-20Z", G);
  _ol(g, "M-28-10C-14-16 8-18 24-12");
  _ol(g, "M-30 6C-14 14 8 16 26 8", "org-dk");
  _ol(g, "M-4-20C-2-8-2 8-4 20", "org-dk");
  return { h0: 70, ports: { in: [-52, -8], out: [52, -8], parenchyma: [0, 0], barrier: [0, -24] } };
}
/* thyroid butterfly: two lobes, isthmus bridge, trachea rings behind, parathyroid dots */
function _orgThyroid(g, G) {
  _ov(g, "M-7-40L-7 40M7-40L7 40", "var(--anatomy-hi)", 2);
  _ov(g, "M-7-28L7-28M-7-12L7-12M-7 24L7 24M-7 36L7 36", "var(--anatomy-hi)", 1.2);
  _ob(g, "M16-32C28-30 35-16 33 4C31 22 25 32 16 32C8 32 6 20 8 2C10-14 11-28 16-32Z", G);
  _ob(g, "M-16-32C-28-30-35-16-33 4C-31 22-25 32-16 32C-8 32-6 20-8 2C-10-14-11-28-16-32Z", G);
  _ob(g, "M-10 6L10 6L10 16L-10 16Z", G);
  _ol(g, "M14-20C18-10 18 6 14 20M-14-20C-18-10-18 6-14 20");
  _odot(g, -30, 8, 2, "var(--c-plt)"); _odot(g, 30, -4, 2, "var(--c-plt)");
  return { h0: 90, ports: { in: [16, -34], out: [0, 36], isthmus: [0, 11], lobeR: [22, 0], lobeL: [-22, 0] } };
}
/* eye: sclera ball with cornea bulge, iris and pupil facing left, retina arc, optic nerve stub right */
function _orgEye(g, G) {
  _ov(g, "M26 0L54 0", "var(--c-plt)", 8);
  _ob(g, "M-36-4C-34-22-16-32 4-30C24-28 34-12 32 4C30 20 14 30-4 29C-22 28-36 14-36-4Z", G);
  _of(g, "M-39 0C-39-6-35-11-30-11C-25-11-21-6-21 0C-21 6-25 11-30 11C-35 11-39 6-39 0Z", "color-mix(in srgb,var(--c-endo) 70%,var(--anatomy-paper))", "var(--c-endo)");
  _odot(g, -30, 0, 5, "#241a12");
  _odot(g, -32, -3.5, 1.5, "#ffffff");
  _ol(g, "M16-15C23-5 23 7 15 17");
  return { h0: 70, ports: { in: [-41, 0], out: [54, 0], retina: [16, 0], lens: [-20, 0] } };
}
/* Real-art store, filled by buildScene after this lib: _ORG_ART[kind] = { vb:[x,y,w,h],
 * pfx:"oaxxx", body:"<inner svg markup>" }. Ports are fractions of the viewBox, measured
 * off the slimmed art (see tools/figures/dev/svgslim.py); content fills the frame. */
var _ORG_ART = {};
var _ORG_FRAC = {
  liver: { in: [.35, .95], out: [.40, .01], porta: [.35, .95], hepvein: [.40, .01], gall: [.55, .66], lobe: [.15, .70] },
  heart: { in: [.30, .01], out: [.48, .01], aorta: [.48, .01], ivc: [.28, .90], apex: [.70, .97], pulm: [.60, .08] },
  kidney: { in: [.04, .36], out: [.38, .97], vein: [.04, .46], pelvis: [.36, .41], cortex: [.62, .45], hilum: [.28, .41] },
  lung: { in: [.46, .53], out: [.44, .60], art: [.44, .48], apex: [.24, .30], base: [.24, .87], trachea: [.49, .01], carina: [.49, .50], hilumL: [.42, .58], hilumR: [.56, .58], apexR: [.75, .34], baseR: [.75, .86] },
  stomach: { in: [.42, .00], out: [.50, .95], fundus: [.38, .10], antrum: [.52, .30], pylorus: [.60, .35] },
  intestine: { in: [.58, .38], out: [.50, .95], duodenum: [.60, .40], jejunum: [.42, .60], ileum: [.50, .72], cecum: [.60, .82], colon: [.28, .60], rectum: [.50, .92] },
  brain: { in: [.60, .97], out: [.42, .04], parenchyma: [.42, .42], cereb: [.76, .78], frontal: [.08, .40], stem: [.60, .93], carotid: [.16, .75] },
  pancreas: { in: [.50, .08], out: [.95, .50], head: [.85, .45], tail: [.06, .45], body: [.50, .45] },
  spleen: { in: [.38, .78], out: [.52, .78], hilum: [.45, .72], pulp: [.50, .38] },
  bowel: { in: [.21, .03], out: [.80, .99], coils: [.52, .52] },
  colon: { in: [.75, .72], out: [.50, .98], caecum: [.75, .72], rectum: [.50, .98], ascending: [.88, .58], transverse: [.50, .62], descending: [.23, .44], sigmoid: [.42, .82] },
  bladder: { in: [.25, .01], out: [.50, .99], inR: [.73, .01], trigone: [.50, .70], dome: [.50, .28] },
  eye: { in: [.02, .50], out: [.99, .55], retina: [.75, .50], lens: [.19, .51], cornea: [.08, .50], nerve: [.99, .55] },
  ear: { in: [.35, .45], out: [.02, .55], canals: [.57, .18], vestibule: [.50, .45], cochlea: [.55, .75], nerve: [.02, .55] },
  skin: { in: [.50, .13], out: [.50, .97], surface: [.50, .13], epidermis: [.50, .17], dermis: [.47, .55], hypodermis: [.50, .92] },
  muscle: { in: [.02, .50], out: [.99, .71], belly: [.32, .48], fibre: [.72, .58] },
  joint: { in: [.50, .04], out: [.52, .96], femur: [.50, .20], joint: [.54, .58], patella: [.51, .52], tibia: [.52, .80], fibula: [.40, .78] },
  vessel: { in: [.50, .01], out: [.50, .99], lumen: [.50, .05], wall: [.90, .50] }
};
/* liver-4 is the bare mass, so add the missing bits procedurally in art units
 * (fractions of the liver-4 viewBox): a gallbladder blob under the art at the
 * gall port (its fundus peeks below the inferior edge), a portal stub rising
 * to the porta tip and a hepatic stub leaving at the hepvein tip. Drawn before
 * the art group so the mass covers the joins; the inner flip mirrors them. */
function _orgLiverExtra(inner, A, opts) {
  var vw = A.vb[2], vh = A.vb[3];
  var X = function (f) { return f1(f * vw); }, Y = function (f) { return f1(f * vh); };
  var g = mk("g", {}, inner);
  if (opts.dim) g.setAttribute("opacity", ".5");
  _ov(g, "M" + X(.35) + " " + Y(.95) + "L" + X(.35) + " " + Y(.78), "var(--d-ven)", 11);
  _ov(g, "M" + X(.40) + " " + Y(.01) + "L" + X(.40) + " " + Y(.14), "var(--d-ven)", 11);
  var gb = _of(g, "M" + X(.55 - 17 / vw) + " " + Y(.63) + "a17 23 0 1 0 34 0a17 23 0 1 0 -34 0",
    "color-mix(in srgb,var(--c-bac) 62%,var(--anatomy-paper))", "var(--c-bac)");
  gb.setAttribute("stroke-width", "2.2");
  return g;
}
/* draw the injected art centred on x,y at w px wide. The art is clipped to its
 * frame; tint overlays an organ-shaped translucent mask (the art itself, reused
 * as a mask); dim dulls the art. Art ids are suffixed per instance so two of
 * the same organ on one page never share gradient, clip or mask ids. */
function _orgArt(parent, kind, x, y, w, opts, A) {
  var vb = A.vb, vw = vb[2], vh = vb[3], cx = vb[0] + vw / 2, cy = vb[1] + vh / 2;
  _orgN++;
  var uid = "u" + _orgN;
  var outer = mk("g", { class: "org org-art org-" + kind + (opts.cls ? " " + opts.cls : ""), transform: "translate(" + f1(x) + " " + f1(y) + ")" }, parent);
  if (opts.id) outer.setAttribute("id", opts.id);
  var sx = w / vw, sy = opts.h ? opts.h / vh : sx, fx = opts.flip ? -1 : 1;
  var inner = mk("g", { transform: "translate(" + f1(-fx * cx * sx) + " " + f1(-cy * sy) + ") scale(" + (fx * sx).toFixed(4) + " " + sy.toFixed(4) + ")" }, outer);
  var defs = mk("defs", {}, inner);
  var cid = A.pfx + uid + "-frame";
  var cp = mk("clipPath", { id: cid }, defs);
  mk("rect", { x: f1(vb[0]), y: f1(vb[1]), width: f1(vw), height: f1(vh) }, cp);
  if (kind === "liver") _orgLiverExtra(inner, A, opts);
  var art = mk("g", { class: "org-halo", "clip-path": "url(#" + cid + ")" }, inner);
  var aid = A.pfx + uid + "-art";
  art.setAttribute("id", aid);
  art.innerHTML = A.body.split('id="' + A.pfx + '-').join('id="' + A.pfx + uid + '-')
    .split('url(#' + A.pfx + '-').join('url(#' + A.pfx + uid + '-')
    .split('href="#' + A.pfx + '-').join('href="#' + A.pfx + uid + '-');
  if (opts.dim) art.setAttribute("opacity", ".5");
  if (opts.tint) {
    var mid = A.pfx + uid + "-tintm";
    var m = mk("mask", { id: mid, maskUnits: "userSpaceOnUse", x: f1(vb[0]), y: f1(vb[1]), width: f1(vw), height: f1(vh) }, defs);
    mk("use", { href: "#" + aid }, m);
    var tg = mk("g", { "clip-path": "url(#" + cid + ")" }, inner);
    mk("rect", { x: f1(vb[0]), y: f1(vb[1]), width: f1(vw), height: f1(vh), fill: opts.tint, mask: "url(#" + mid + ")" }, tg);
  }
  var ports = {}, F = _ORG_FRAC[kind], k;
  for (k in F) ports[k] = [Math.round((x + fx * (vb[0] + F[k][0] * vw - cx) * sx) * 10) / 10, Math.round((y + (vb[1] + F[k][1] * vh - cy) * sy) * 10) / 10];
  return { g: outer, kind: kind, x: x, y: y, w: w, h: Math.round(vh * sy * 10) / 10, ports: ports, art: true };
}
/* dispatcher: outer g carries the theme class and gradients, inner g the local drawing scaled to w */
function organ(parent, kind, x, y, w, opts) {
  opts = opts || {};
  if (_ORG_FRAC[kind] && _ORG_ART[kind]) return _orgArt(parent, kind, x, y, w, opts, _ORG_ART[kind]);
  var outer = mk("g", { class: "org org-" + kind + (opts.cls ? " " + opts.cls : ""), transform: "translate(" + f1(x) + " " + f1(y) + ")" }, parent);
  if (opts.id) outer.setAttribute("id", opts.id);
  var G = _orgDefs(outer);
  var inner = mk("g", {}, outer);
  var r;
  if (kind === "liver") r = _orgLiver(inner, G);
  else if (kind === "heart") r = _orgHeart(inner, G);
  else if (kind === "kidney") r = _orgKidney(inner, G);
  else if (kind === "lung") r = _orgLung(inner, G);
  else if (kind === "stomach") r = _orgStomach(inner, G);
  else if (kind === "brain") r = _orgBrain(inner, G);
  else if (kind === "pancreas") r = _orgPancreas(inner, G);
  else if (kind === "spleen") r = _orgSpleen(inner, G);
  else if (kind === "parathyroid") r = _orgParathyroid(inner, G);
  else if (kind === "ganglion") r = _orgGanglion(inner, G);
  else if (kind === "lymphnode") r = _orgLymphnode(inner, G);
  else if (kind === "eye") r = _orgEye(inner, G);
  else if (kind === "bladder") r = _orgBladder(inner, G);
  else if (kind === "uterus") r = _orgUterus(inner, G);
  else if (kind === "ovary") r = _orgOvary(inner, G);
  else if (kind === "testis") r = _orgTestis(inner, G);
  else if (kind === "thyroid") r = _orgThyroid(inner, G);
  else if (kind === "adrenal") r = _orgAdrenal(inner, G);
  else if (kind === "pituitary") r = _orgPituitary(inner, G);
  else throw new Error("organ: unknown kind " + kind);
  var sx = w / 100, sy = opts.h ? opts.h / r.h0 : sx, fx = opts.flip ? -1 : 1;
  inner.setAttribute("transform", "scale(" + (fx * sx).toFixed(3) + " " + sy.toFixed(3) + ")");
  var ports = {}, k;
  for (k in r.ports) ports[k] = [Math.round((x + fx * r.ports[k][0] * sx) * 10) / 10, Math.round((y + r.ports[k][1] * sy) * 10) / 10];
  return { g: outer, kind: kind, x: x, y: y, w: w, h: Math.round(r.h0 * sy * 10) / 10, ports: ports, art: false };
}
organ.kinds = ["liver", "heart", "kidney", "lung", "stomach", "intestine", "brain", "pancreas", "spleen", "bladder", "uterus", "ovary", "testis", "thyroid", "eye", "ganglion", "bowel", "colon", "ear", "skin", "muscle", "joint", "vessel", "adrenal", "lymphnode", "parathyroid", "pituitary"];
