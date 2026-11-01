/* Kardia labs skin (owner 2026-11-01): Echo Lab and AngioLAB wear a native iOS look. Look only: the compiled
 * bundles are never edited; the injectors load kardia-skin.css into each frame. "Probe Lab" is never shown. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const SKINS = ["kardia/probelab/kardia-skin.css", "kardia/angiolab/kardia-skin.css"];

test("skin files exist and are injected by the lab injectors", () => {
  for (const p of SKINS) assert.ok(existsSync(new URL("../" + p, import.meta.url)), p);
  assert.match(read("kardia/probelab/kardia-unbrand.js"), /kardia-skin\.css/);
  assert.match(read("kardia/angiolab/kardia-embed.js"), /kardia-skin\.css/);
});

test("one face, no IBM Plex, no gradients, no dashes", () => {
  for (const p of SKINS) {
    const css = read(p);
    if (p.includes("angiolab")) assert.match(css, /Inter Variable/, p);
    assert.doesNotMatch(css, /IBM Plex/i, p);
    assert.doesNotMatch(css, /linear-gradient|radial-gradient/, p);
    assert.doesNotMatch(css, /[—–]/, p);
  }
});

test("the skins never recolour the clinical images", () => {
  const css = SKINS.map(read).join("\n");
  assert.doesNotMatch(css, /(#sim-image|#slice|#cine|canvas)[^{]*\{[^}]*filter/);
  assert.doesNotMatch(css, /filter:\s*(hue|sepia|saturate)/);
});

test("touch targets, press feedback and reduced motion", () => {
  for (const p of SKINS) {
    const css = read(p);
    assert.match(css, /:active[^{]*\{[^}]*scale\(\.96\)/, p);
    assert.match(css, /prefers-reduced-motion/, p);
  }
  assert.match(read(SKINS[0]), /min-height: 44px/);
});

test("SyncProbe hooks survive and the skin never hides practice controls", () => {
  const sync = read("kardia-syncprobe.js");
  for (const id of ["practice", "leave-practice", "rotation", "fan", "rock", "depth"]) {
    assert.ok(sync.includes('"' + id + '"') || sync.includes("'" + id + "'"), "syncprobe drives #" + id);
  }
  assert.match(sync, /__kardiaProbeSlide/);
  assert.doesNotMatch(read(SKINS[0]), /#(practice|leave-practice|rotation|fan|rock|depth)\b[^{]*\{[^}]*display:\s*none/);
});

test("Probe Lab is never shown: host copy, frame title and runtime rename", () => {
  const k = read("kardia.js");
  const visible = [...k.matchAll(/T\("([^"]*)"/g)].map((m) => m[1]);
  assert.ok(!visible.some((s) => /probe lab/i.test(s)), "a T() string still says Probe Lab");
  assert.match(read("kardia/probelab/index.html"), /<title>Kardia Echo Lab<\/title>/);
  assert.match(read("kardia/probelab/kardia-unbrand.js"), /replace\(\/Probe Lab\/g, "Echo Lab"\)/);
});

test("loading shows a spinner, not copy", () => {
  const css = read("kardia.css");
  assert.match(css, /\.krd-probe-status, \.krd-root \.krd-angio-status \{\s*position: absolute !important; width: 1px/);
  assert.match(css, /@keyframes krdSpin/);
  assert.match(read(SKINS[0]), /#loading-title, #loading-detail/);
});

test("loader token bumped and skins ship with the lab folders", () => {
  assert.match(read("kardia-loader.js"), /var V = "krd18"/);
  assert.match(read("index.html"), /kardia-loader\.js\?v=krd18/);
  const build = read("scripts/build-www.sh");
  assert.match(build, /kardia\/probelab/);
  assert.match(build, /kardia\/angiolab/);
});

test("injectors stay ES5", () => {
  for (const p of ["kardia/probelab/kardia-unbrand.js", "kardia/angiolab/kardia-embed.js"]) {
    assert.doesNotMatch(read(p), /=>|`|\bconst\b|\blet\b/, p);
  }
});
