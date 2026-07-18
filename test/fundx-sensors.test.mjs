/* test/fundx-sensors.test.mjs — FundX sensor-fusion layer (Phase 1: IMU + fusion math).
 * Pure capability detection + the IMU adapter (fed synthetic devicemotion events) + fusion +
 * the manager's fallback-identical behaviour. The live browser DeviceMotion path is verified
 * on-device; here we drive it with mock events. Runs under `npm test`. */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log("  ✗ FAIL:", name); } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const src = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

// mock window that captures event listeners so we can dispatch synthetic events
function makeWin(over = {}) {
  const listeners = {};
  return {
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
    _emit: (t, e) => (listeners[t] || []).forEach((fn) => fn(e)),
    _listeners: listeners,
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } },
    location: { search: "" },
    ...over,
  };
}
const load = (win) => { new Function("window", src("fundx-sensors.js"))(win); return win.SMD_FUNDX_SENSORS; };

// ---- capabilities ----
{
  const S = load(makeWin());
  ok("caps: no DeviceMotion -> false/unavailable", (() => { const c = S.capabilities(makeWin()); return c.deviceMotion === false && c.motionPermission === "unavailable"; })());
  const w2 = makeWin({ DeviceMotionEvent: function () {} });
  ok("caps: DeviceMotion present -> granted", S.capabilities(w2).deviceMotion === true && S.capabilities(w2).motionPermission === "granted");
  const DME = function () {}; DME.requestPermission = () => Promise.resolve("granted");
  ok("caps: iOS gated -> prompt", S.capabilities(makeWin({ DeviceMotionEvent: DME })).motionPermission === "prompt");
  ok("caps: native depth detected", S.capabilities(makeWin({ Capacitor: { Plugins: { FundxDepth: {} } } })).nativeDepth === true);
}

// ---- fuse math ----
{
  const S = load(makeWin());
  ok("fuse: empty -> null", S.fuse([]) === null && S.fuse(null) === null);
  const one = S.fuse([{ value: 0.4, confidence: 0.5, source: "a" }]);
  ok("fuse: single passthrough", near(one.value, 0.4) && near(one.confidence, 0.5));
  const agree = S.fuse([{ value: 0.3, confidence: 0.5 }, { value: 0.3, confidence: 0.5 }]);
  ok("fuse: agreeing -> higher conf", agree.confidence > 0.5 && near(agree.value, 0.3));
  const disagree = S.fuse([{ value: 0.0, confidence: 0.5 }, { value: 1.0, confidence: 0.5 }]);
  ok("fuse: disagreeing -> lower conf than agreeing", disagree.confidence < agree.confidence);
  ok("fuse: skips invalid entries", near(S.fuse([{ value: 0.6, confidence: 0.5 }, { value: null, confidence: 0.9 }]).value, 0.6));
}

// ---- IMU adapter ----
{
  const S = load(makeWin());
  const win = makeWin({ DeviceMotionEvent: function () {} });
  const imu = S.makeImuAdapter(win);
  ok("imu: null before start", imu.read() === null);
  imu.start();
  ok("imu: null before data", imu.read() === null);
  for (let i = 0; i < 10; i++) win._emit("devicemotion", { acceleration: { x: 0.05, y: 0.02, z: 0.03 }, rotationRate: { alpha: 0.5, beta: 0.3, gamma: 0.2 } });
  const still = imu.read();
  ok("imu: still -> low motion", still && still.motion.value < 0.1);
  ok("imu: confidence ramps to 1", still.motion.confidence === 1);
  imu.reset();
  for (let i = 0; i < 10; i++) win._emit("devicemotion", { acceleration: { x: 5, y: 4, z: 3 }, rotationRate: { alpha: 80, beta: 60, gamma: 40 } });
  ok("imu: shaking -> high motion", imu.read().motion.value > 0.8);
  imu.stop();
  ok("imu: stop detaches", (win._listeners.devicemotion || []).length === 0);
}

// ---- manager: fusion over monocular partial + fallback-identical ----
{
  const S = load(makeWin());
  const win = makeWin({ DeviceMotionEvent: function () {} });
  const mgr = S.makeManager({ window: win });
  const r0 = mgr.read({ motion: 0.42, eyePresent: true });
  ok("mgr: no sensor data -> motion unchanged (fallback-identical)", near(r0.motion, 0.42));
  ok("mgr: acqConfidence present", r0.acqConfidence != null);
  mgr.start();
  for (let i = 0; i < 10; i++) win._emit("devicemotion", { acceleration: { x: 0.02, y: 0.02, z: 0.02 }, rotationRate: { alpha: 0.2, beta: 0.1, gamma: 0.1 } });
  const r1 = mgr.read({ motion: 0.42, eyePresent: true });
  ok("mgr: IMU 'still' lowers fused motion", r1.motion < 0.42);
  ok("mgr: fused confidence higher with 2 sources", r1.motionConfidence > (r0.motionConfidence || 0));
  ok("mgr: contributors include imu", (r1.motionSources || []).indexOf("imu") >= 0);
  ok("mgr: IMU-only motion present when no monocular", mgr.read({}).motion != null);
  mgr.stop();
}

// ---- flag ----
{
  const S = load(makeWin());
  ok("flag: default off", S.flagOn(makeWin()) === false);
  ok("flag: query on", S.flagOn(makeWin({ location: { search: "?fundxsensors=1" } })) === true);
  const w = makeWin(); w.localStorage.setItem("smd_fundx_sensors", "1");
  ok("flag: localStorage on", S.flagOn(w) === true);
}

// ---- Phase 2: depth adapter + distance/pose fusion ----
{
  const S = load(makeWin());
  let handler = null;
  const plugin = {
    capabilities: () => Promise.resolve({ depth: true, lidar: true, arkit: true, sceneDepth: true }),
    addListener: (name, fn) => { handler = fn; return { remove() { handler = null; } }; },
    start: () => {}, stop: () => {},
  };
  const dep = S.makeDepthAdapter({ plugin, window: makeWin() });
  ok("depth: read null before data", dep.read() === null);
  dep.start();
  handler({ distanceMeters: 0.35, distanceConfidence: 0.9, roll: 4, poseConfidence: 0.85 });
  const dr = dep.read();
  ok("depth: metric distance emitted", dr && dr.distance && Math.abs(dr.distance.value - 0.35) < 1e-6 && dr.distance.metric === true);
  ok("depth: pose emitted", dr.pose && dr.pose.roll === 4);

  const mgr = S.makeManager({ window: makeWin(), depth: dep });
  const r = mgr.read({ motion: 0.1, eyePresent: true, distanceState: "unknown" });
  ok("mgr: metric distanceMm from depth (350)", r.distanceMm === 350);
  ok("mgr: distanceState 'ok' within band", r.distanceState === "ok");
  ok("mgr: distance confidence present", r.distanceConfidence > 0.8);
  ok("mgr: roll refined by depth pose", r.roll === 4 && r.rollState === "level");
  ok("mgr: acqConfidence aggregates signals", r.acqConfidence != null && r.acqConfidence > 0);
  ok("mgr: contributions report depth", mgr.contributions().distance.indexOf("depth") >= 0);
  handler({ distanceMeters: 0.1, distanceConfidence: 0.9 });
  ok("mgr: 'near' below workingNearM", mgr.read({}).distanceState === "near");
  handler({ distanceMeters: 0.8, distanceConfidence: 0.9 });
  ok("mgr: 'far' above workingFarM", mgr.read({}).distanceState === "far");
  dep.stop();
}
{
  const S = load(makeWin());
  ok("depthFlag: default off", S.depthFlagOn(makeWin()) === false);
  ok("depthFlag: query on", S.depthFlagOn(makeWin({ location: { search: "?fundxdepth=1" } })) === true);
  const w = makeWin(); w.localStorage.setItem("smd_fundx_depth", "1");
  ok("depthFlag: localStorage on", S.depthFlagOn(w) === true);
}

console.log(fail === 0 ? `ALL ${pass} PASS` : `${pass} pass / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
