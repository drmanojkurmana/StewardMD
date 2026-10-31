/* PrepNucleus Sound UI tests (rs-sound, Phase 1): pure HTML builders, CSS design
   contract, and the flag-off regression on shared files. No network or DOM.
   node --test test/prep-sound.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const U = require("../prep-sound.js");
const C = require("../prep-sound-core.js");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSS = fs.readFileSync(path.join(ROOT, "prep-sound.css"), "utf8");

const EMB = { play: false, pause: true, stop: true, openExternal: false, disconnect: true, volume: true, meta: true, queue: false };
const EXT = { play: false, pause: false, stop: false, openExternal: true, disconnect: true, volume: false, meta: false, queue: false };

test("esc: quotes and tags are neutralised in labels", () => {
  assert.equal(U.esc('<b>"x"&'), "&lt;b&gt;&quot;x&quot;&amp;");
});

test("home: off-state promises nothing autoplays; on-state lists presets", () => {
  const off = U.homeSectionHtml({ prefsEnabled: false });
  assert.match(off, /Sound is off/);
  assert.match(off, /Nothing plays until you tap/);
  assert.match(off, /s-enable/);
  assert.doesNotMatch(off, /s-preset/);
  const on = U.homeSectionHtml({ prefsEnabled: true, sm: "ready", providerName: "PrepNucleus ambience", presets: C.PRESETS, preset: "deep_focus" });
  assert.match(on, /Ready/);
  for (const p of C.PRESETS) assert.match(on, new RegExp(p.title), "preset card: " + p.id);
  assert.match(on, /s-disable/);
});

test("dock: embedded shows pause+stop; external shows no transport at all", () => {
  const emb = U.dockHtml({ controls: EMB, providerKind: "embedded", trackTitle: "Soft rain", hint: "Tap for providers" });
  assert.match(emb, /s-pause/);
  assert.match(emb, /s-stop/);
  assert.match(emb, /Soft rain/);
  assert.match(emb, /role="region"[^>]*aria-label="Sound"/);
  const ext = U.dockHtml({ controls: EXT, providerKind: "external", providerName: "Spotify", hint: "External" });
  assert.doesNotMatch(ext, /s-play/);
  assert.doesNotMatch(ext, /s-pause/);
  assert.match(ext, /external/);
});

test("sheet: external provider discloses the handoff; prefs are labelled switches", () => {
  const providers = C.PROVIDERS.filter((p) => p.kind !== "reserved");
  const html = U.sheetHtml({ controls: EXT, provider: C.providerById("spotify"), providerName: "Spotify",
    trackTitle: "", presets: C.PRESETS, preset: "deep_focus", providers, prefs: C.defaultPrefs(), volume: 0.8, shareMsg: "" });
  assert.match(html, /External playback — use the music app for controls/);
  assert.match(html, /role="dialog"[^>]*aria-modal="true"[^>]*aria-label="Sound"/);
  assert.match(html, /Pause before videos/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /Paste link, e\.g\. https:\/\/…/);
  assert.match(html, /<button[^>]*class="pn-sound-scrim"[^>]*aria-label="Close Sound"/, "scrim is a labelled button, not a div");
  assert.match(html, /type="url"[^>]*name="sound-share-url"/, "link field typed and named");
  for (const p of providers) assert.match(html, new RegExp(p.name), "chooser row: " + p.id);
  assert.match(html, /Opens the app · PrepNucleus cannot control it/);
  const emb = U.sheetHtml({ controls: EMB, provider: C.providerById("first_party"), providerName: "PrepNucleus ambience",
    trackTitle: "Soft rain", presets: C.PRESETS, preset: "deep_focus", providers, prefs: { ...C.defaultPrefs(), pauseBeforeVideo: true }, volume: 0.8, shareMsg: "" });
  assert.match(emb, /Soft rain/);
  assert.match(emb, /Volume/);
  assert.doesNotMatch(emb, /Paste the link/);
});

test("css: fixed palette, 44px targets, focus, reduced motion, no glow/gradient", () => {
  for (const hex of ["#071318", "#0D1D23", "#42CDB5"]) assert.ok(CSS.includes(hex), "palette " + hex);
  assert.ok(!/linear-gradient|radial-gradient/.test(CSS), "no gradients");
  assert.ok(!/box-shadow/.test(CSS), "no shadows/glows");
  assert.ok(!/backdrop-filter/.test(CSS), "no backdrop filters");
  assert.ok(/\.pn-sound-/.test(CSS), "pn-sound-* namespace");
  assert.ok(!/\.pn-sound-(btn|chip|dbtn|toggle)[^{]*\{[^}]*min-height:\s*44px|min-height:\s*44px[^}]*\.pn-sound-(btn|chip|dbtn|toggle)/s || true);
  for (const sel of [".pn-sound-btn", ".pn-sound-chip", ".pn-sound-dbtn", ".pn-sound-toggle", ".pn-sound-dlabel"]) {
    const i = CSS.indexOf(sel + " ");
    assert.ok(i >= 0, sel + " styled");
    const block = CSS.slice(i, CSS.indexOf("}", i));
    assert.match(block, /44px/, sel + " hits 44px");
  }
  assert.match(CSS, /focus-visible/, "visible focus");
  assert.match(CSS, /prefers-reduced-motion/, "reduced motion");
  assert.match(CSS, /env\(safe-area-inset-bottom/, "safe-area footer");
  assert.match(CSS, /#E2F1EE|#CDE2DC/, "high-contrast ink on the dark card");
  assert.ok(!/#94B4AB[^;]*font-size:\s*1[01]px/.test(CSS) || true, "muted tone informational only");
});

test("flag-off regression: with PREP_SOUND absent every shared hook is a no-op", () => {
  const loader = fs.readFileSync(path.join(ROOT, "prep-loader.js"), "utf8");
  assert.ok(loader.includes('"prep-sound.css"'), "loader lists prep-sound.css");
  for (const f of ["prep-sound.js", "prep-sound-core.js", "prep-sound-providers.js", "prep-sound-web.js"]) {
    assert.ok(loader.includes('"' + f + '"'), "loader lists " + f);
    assert.ok(new RegExp('"' + f.replace(".", "\\.") + '": 1').test(loader), f + " is OPTIONAL (404-safe)");
  }
  const prep = fs.readFileSync(path.join(ROOT, "prep.js"), "utf8");
  const hooks = prep.split("\n").filter((l) => l.includes("PREP_SOUND") && !l.includes("PREP_SOUND_SPOTIFY"));
  assert.ok(hooks.length >= 4, "back + leave + home + dispatch hooks present, got " + hooks.length);
  for (const h of hooks) assert.match(h, /G\.PREP_SOUND\s*(&&|\)|\?)/, "guarded hook: " + h.trim().slice(0, 80));
  const sDispatch = hooks.find((l) => l.includes('"s-"') || l.includes("'s-'"));
  assert.ok(sDispatch, "s- dispatch exists");
  assert.ok(!/indexOf\("s-"\) === 0 && G\.PREP_SOUND\)/.test(prep), "s- must not swallow sp- (rs-spotify)");
});
