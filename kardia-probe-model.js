/* kardia-probe-model.js - Kardia K3 phased-array probe for three.js.
 * Slim rectangular phased-array head with a flat lens face wider than
 * deep, a tapering neck into a cylindrical handle, a moulded marker
 * notch on one side, rubber strain relief and cable, to the look of
 * work/ref/rec1.jpg. PBR materials only; no glow.
 * API: buildProbe(THREE) returns a THREE.Group whose lens face sits at
 * the origin, beam pointing along local -Y, marker toward local +X.
 * Units are metres (a probe is about 0.11 m long without its cable).
 */
(function (G) {
  "use strict";
  function buildProbe(THREE) {
    var group = new THREE.Group(); group.name = "KardiaPhasedArrayProbe";
    var matBody = new THREE.MeshStandardMaterial({ color: 0xe9e7e2, roughness: 0.38, metalness: 0.05 });
    var matGrip = new THREE.MeshStandardMaterial({ color: 0x2b2e30, roughness: 0.92, metalness: 0.0 });
    var matLens = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.35, metalness: 0.0 });
    var matMarker = new THREE.MeshStandardMaterial({ color: 0x1f6fb4, roughness: 0.5, metalness: 0.0 });
    var matCable = new THREE.MeshStandardMaterial({ color: 0x222426, roughness: 0.85, metalness: 0.0 });
    function mesh(geo, mat, name, x, y, z) {
      var m = new THREE.Mesh(geo, mat); m.name = name; m.position.set(x, y, z); group.add(m); return m;
    }
    /* Head: slim rectangular block, wider (x) than deep (z). The flat
     * lens face is its underside; edges stay crisp, not egg-like. */
    mesh(new THREE.BoxGeometry(0.036, 0.015, 0.024), matBody, "probe-head", 0, 0.0095, 0);
    /* Lens face: flat acoustic window, wider than deep, at y 0. */
    var lens = mesh(new THREE.BoxGeometry(0.032, 0.0035, 0.020), matLens, "probe-lens", 0, -0.0005, 0);
    lens.name = "probe-lens";
    mesh(new THREE.BoxGeometry(0.027, 0.0012, 0.016), matLens, "probe-lens-window", 0, -0.0026, 0);
    /* Tapering neck: a four-sided frustum from head up to the handle. */
    var neck = mesh(new THREE.CylinderGeometry(0.0115, 0.0175, 0.020, 4), matBody, "probe-neck", 0, 0.027, 0);
    neck.rotation.y = Math.PI / 4; neck.scale.set(1, 1, 0.72);
    /* Handle: a straight cylinder the hand wraps around. */
    mesh(new THREE.CylinderGeometry(0.0115, 0.0125, 0.052, 28), matBody, "probe-body", 0, 0.062, 0);
    /* Rubber grip sleeve and finger ridges around the handle. */
    mesh(new THREE.CylinderGeometry(0.0128, 0.0134, 0.034, 28), matGrip, "probe-grip", 0, 0.056, 0);
    for (var i = 0; i < 4; i++) {
      var ridge = mesh(new THREE.TorusGeometry(0.0131, 0.0010, 8, 32), matGrip, "grip-ridge", 0, 0.044 + i * 0.008, 0);
      ridge.rotation.x = Math.PI / 2;
    }
    /* Moulded marker notch on the +X side of the head and neck, with
     * the blue orientation dot above it. */
    mesh(new THREE.BoxGeometry(0.0025, 0.016, 0.005), matGrip, "probe-marker-notch", 0.0182, 0.016, 0);
    mesh(new THREE.BoxGeometry(0.0028, 0.020, 0.006), matMarker, "probe-marker-ridge", 0.0185, 0.020, 0);
    var dot = mesh(new THREE.CylinderGeometry(0.0030, 0.0030, 0.002, 20), matMarker, "probe-marker-dot", 0.0132, 0.048, 0);
    dot.rotation.z = Math.PI / 2;
    /* Brand plate (unlettered, a satin inset) on the front face. */
    mesh(new THREE.BoxGeometry(0.018, 0.012, 0.0012),
      new THREE.MeshStandardMaterial({ color: 0xd8d5cf, roughness: 0.5, metalness: 0.1 }), "probe-plate", 0, 0.066, 0.0128);
    /* Rubber strain relief: tapered, ringed, at the crown. */
    mesh(new THREE.CylinderGeometry(0.0048, 0.0078, 0.018, 20), matGrip, "probe-strain-relief", 0, 0.096, 0);
    for (var j = 0; j < 3; j++) {
      var ring = mesh(new THREE.TorusGeometry(0.0068 - j * 0.0007, 0.0009, 8, 24), matGrip, "relief-ring", 0, 0.090 + j * 0.005, 0);
      ring.rotation.x = Math.PI / 2;
    }
    /* Cable: a drooping curve away from the crown. */
    var curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.104, 0), new THREE.Vector3(0.01, 0.150, 0.01),
      new THREE.Vector3(0.05, 0.185, 0.05), new THREE.Vector3(0.13, 0.175, 0.10),
      new THREE.Vector3(0.20, 0.120, 0.13), new THREE.Vector3(0.24, 0.05, 0.14)]);
    mesh(new THREE.TubeGeometry(curve, 48, 0.0038, 10, false), matCable, "probe-cable", 0, 0, 0);
    group.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return group;
  }
  var API = { buildProbe: buildProbe };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.KARDIA_PROBE_MODEL = API;
})(typeof window !== "undefined" ? window : globalThis);
