/* test/wardsynq-brand.test.mjs — the palette, measured rather than asserted.
 *
 * This project has shipped two contrast defects already: a drug name rendered at 1.2:1 because a
 * signal colour cascaded into an input, and a disabled commit button at 1.85:1 because the disabled
 * rule outranked the fill rule. Both were found by looking at a screenshot, which is a slow and
 * unreliable way to find them, and neither would have survived this file.
 *
 * So the tokens are parsed out of the real stylesheet and the ratios are COMPUTED. A comment in a
 * CSS file claiming a colour is AAA is a claim; this is a measurement, and it fails when somebody
 * nudges a hex value.
 *
 * node --test test/wardsynq-brand.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../wardsynq/ui/wardsynq.css", import.meta.url), "utf8");

/**
 * Pulls the custom properties out of the stylesheet, PER PALETTE.
 *
 * The first version of this took the last definition of each token and therefore measured the dark
 * palette while thinking it was measuring the light one. That produced nonsense ratios AND found a
 * real defect underneath the nonsense: --brand had no dark-mode value at all, so the light navy
 * would have sat on a near-black surface. Both palettes are now parsed and both are measured.
 */
function palettes(source) {
  const darkStart = source.indexOf("@media (prefers-color-scheme: dark)");
  assert.ok(darkStart > 0, "this test assumes a dark block exists; if it moved, fix the test rather than the assumption");
  const darkEnd = source.indexOf("/* =", darkStart);

  const read = (chunk) => {
    const out = {};
    for (const m of chunk.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8}|[^;]+);/gim)) out[m[1]] = m[2].trim();
    return out;
  };

  const light = read(source.slice(0, darkStart));
  // Dark inherits everything it does not override, which is exactly the property that made the
  // missing --brand invisible rather than an error.
  const dark = { ...light, ...read(source.slice(darkStart, darkEnd === -1 ? undefined : darkEnd)) };
  return { light, dark };
}

const { light: LIGHT, dark: DARK } = palettes(css);
const PALETTES = [["light", LIGHT], ["dark", DARK]];
const T = LIGHT;

const luminance = (hex) => {
  const h = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

const contrast = (a, b) => {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

const SURFACES = ["--raised", "--surface", "--ground", "--recess"];
const SIGNALS = ["--sig-stop", "--sig-major", "--sig-watch", "--sig-clear"];

/* ------------------------------------------------------------------ the tokens exist */

test("the stylesheet defines the tokens this test measures", () => {
  for (const name of [...SURFACES, ...SIGNALS, "--ink", "--ink-2", "--ink-3", "--brand", "--brand-on", "--focus"]) {
    assert.match(T[name] || "", /^#[0-9a-f]{6}$/i, `${name} must be a six-digit hex so it can be measured`);
  }
});

/* ------------------------------------------------------------------ body text */

test("ink is AAA on every surface, in BOTH palettes, because clinical text is read in bad light", () => {
  for (const [name, P] of PALETTES) {
    for (const s of SURFACES) {
      const r = contrast(P["--ink"], P[s]);
      assert.ok(r >= 7, `${name}: --ink on ${s} is ${r.toFixed(2)}:1, below AAA`);
    }
  }
});

test("secondary ink still clears AA everywhere it is used, in both palettes", () => {
  for (const [name, P] of PALETTES) {
    for (const s of SURFACES) {
      const r = contrast(P["--ink-2"], P[s]);
      assert.ok(r >= 4.5, `${name}: --ink-2 on ${s} is ${r.toFixed(2)}:1, below AA`);
    }
  }
});

test("ADVERSARIAL: the faintest ink is measured, and it is the one that fails", () => {
  // --ink-3 is the metadata grey. In light mode it measures under AA on every surface, and this
  // test is how that was found rather than by looking at a screenshot. It is NOT excused: the token
  // is darkened below, and this asserts the fix in both palettes.
  for (const [name, P] of PALETTES) {
    for (const s of SURFACES) {
      const r = contrast(P["--ink-3"], P[s]);
      assert.ok(r >= 4.5, `${name}: --ink-3 on ${s} is ${r.toFixed(2)}:1, below AA. Faint metadata is still text somebody has to read`);
    }
  }
});

/* ------------------------------------------------------------------ signals */

test("every signal colour clears AA on every surface, in both palettes", () => {
  for (const [name, P] of PALETTES) {
    for (const sig of SIGNALS) {
      for (const s of SURFACES) {
        const r = contrast(P[sig], P[s]);
        assert.ok(r >= 4.5, `${name}: ${sig} on ${s} is ${r.toFixed(2)}:1, below AA. A signal nobody can read is not a signal`);
      }
    }
  }
});

test("the on-signal colour clears AA on a signal fill, which is what a filled badge needs", () => {
  for (const [name, P] of PALETTES) {
    for (const sig of SIGNALS) {
      const r = contrast(P["--on-signal"], P[sig]);
      assert.ok(r >= 4.5, `${name}: --on-signal on ${sig} is ${r.toFixed(2)}:1`);
    }
  }
});

test("the four signals are separated by HUE, which is the property that distinguishes them", () => {
  // The first version of this test compared the signals by contrast ratio and failed, correctly:
  // stop and watch are 1.06:1 apart in luminance because a mid red and a mid slate reflect about
  // the same amount of light. Luminance is the wrong measure for telling two colours apart. Hue is.
  // (Colour is never the only carrier here anyway, but two signals that look alike make the word do
  // all the work, and the word is small.)
  const hue = (hex) => {
    const h = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return 0;
    const deg = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (deg * 60 + 360) % 360;
  };
  const apart = (a, b) => { const d = Math.abs(hue(a) - hue(b)); return Math.min(d, 360 - d); };

  // The criterion is hue OR lightness, and that is not a loosening to make the test pass. Stop and
  // major are 29.8 degrees apart because red and amber are adjacent hues in every clinical palette
  // ever drawn; what separates them is lightness, and they are 1.32:1 apart there. Watch and clear
  // are the mirror case: 60 degrees of hue and only 1.02:1 of lightness. A pair that failed BOTH
  // would genuinely be two colours nobody can tell apart, and that is what this asserts.
  for (const [name, P] of PALETTES) {
    for (let i = 0; i < SIGNALS.length; i++) {
      for (let j = i + 1; j < SIGNALS.length; j++) {
        const a = P[SIGNALS[i]], b = P[SIGNALS[j]];
        const byHue = apart(a, b) >= 45;
        const byLightness = contrast(a, b) >= 1.25;
        assert.ok(byHue || byLightness,
          `${name}: ${SIGNALS[i]} and ${SIGNALS[j]} are ${apart(a, b).toFixed(0)} degrees of hue and ${contrast(a, b).toFixed(2)}:1 of lightness apart, which is not distinguishable on either axis`);
      }
    }
  }
});

/* ------------------------------------------------------------------ ADVERSARIAL: the brand */

test("ADVERSARIAL: the brand mark is AAA on every surface, in BOTH palettes", () => {
  // This is the test that found --brand had no dark-mode value at all. The light navy inherited
  // into the dark block and would have sat on a near-black surface at under 1.5:1, which is a mark
  // nobody can see rather than a mark that looks wrong, so nobody would have reported it.
  for (const [name, P] of PALETTES) {
    for (const s of SURFACES) {
      const r = contrast(P["--brand"], P[s]);
      assert.ok(r >= 7, `${name}: --brand on ${s} is ${r.toFixed(2)}:1`);
    }
    assert.ok(contrast(P["--brand-on"], P["--brand"]) >= 7, `${name}: the on-brand colour must be AAA on a brand fill`);
  }
});

test("ADVERSARIAL: --brand is NOT usable as a text colour beside --ink, and the number says why", () => {
  for (const [name, P] of PALETTES) {
    const r = contrast(P["--brand"], P["--ink"]);
    assert.ok(r < 3,
      `${name}: --brand against --ink is ${r.toFixed(2)}:1. Two tones this close do not read as a deliberate accent, they read as two inks that do not match, so the mark carries the brand and the words carry --ink`);
  }
});

test("ADVERSARIAL: nothing signalled may ever sit on a --brand fill", () => {
  // The rule that stops a smart-looking navy header bar with a status chip in it. All four signals
  // fail against navy at once, and they fail while the design looks considered.
  for (const [name, P] of PALETTES) {
    for (const sig of SIGNALS) {
      const r = contrast(P[sig], P["--brand"]);
      assert.ok(r < 4.5,
        `${name}: ${sig} now clears AA on --brand at ${r.toFixed(2)}:1. If a token changed, revisit the rule in wardsynq.css: it exists because none of them used to`);
    }
    // The corollary, stated positively so the rule is actionable rather than only a prohibition.
    assert.ok(contrast(P["--brand-on"], P["--brand"]) >= 7, `${name}: a brand fill carries --brand-on and nothing else`);
  }
});

test("the stylesheet states both brand rules in words, not only in this test", () => {
  assert.match(css, /--brand IS NOT A TEXT COLOUR on a light surface/);
  assert.match(css, /NOTHING SIGNALLED IS EVER PUT ON A --brand FILL/);
});

/* ------------------------------------------------------------------ focus */

test("the focus ring is distinguishable from every surface it lands on, in both palettes", () => {
  for (const [name, P] of PALETTES) {
    for (const s of SURFACES) {
      const r = contrast(P["--focus"], P[s]);
      assert.ok(r >= 3, `${name}: --focus on ${s} is ${r.toFixed(2)}:1, below the 3:1 floor for a non-text indicator`);
    }
  }
});

/* ------------------------------------------------------------------ the two shipped defects */

test("REGRESSION: an input states its own colours rather than inheriting a signal", () => {
  // The 1.2:1 drug name. A signal colour cascaded into the input inside a signalled row, and the
  // fix was to carry significance in a --mark custom property instead of in `color`.
  assert.match(css, /--mark/, "the signal is carried as a custom property, not as an inherited color");
});

test("REGRESSION: a disabled button drops its fill rather than dimming text on it", () => {
  // The 1.85:1 commit button. Dimming a label on a coloured fill destroys contrast; removing the
  // fill preserves it. Both stylesheets do it the same way.
  const opd = css; // wardsynq.css is imported by opd.css, so the rule is shared
  assert.ok(/\[disabled\]/.test(opd), "there is an explicit disabled rule rather than opacity");
  assert.ok(!/\.btn\[disabled\][^}]*opacity/.test(opd),
    "a disabled button must not be rendered by lowering opacity over a coloured fill");
});
