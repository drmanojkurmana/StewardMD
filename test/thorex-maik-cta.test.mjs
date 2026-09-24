/* The CXR result's AI correlation button was a plain teal "Get best-fit diagnoses" button. It is now
 * the Ask MaiK call-to-action with the same aurora glow as the OPD one - reusing OPD's keyframes
 * rather than duplicating them. The click handler must keep working, so data-act is unchanged. */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JS = readFileSync(join(ROOT, "thorex-screens.js"), "utf8");
const CSS = readFileSync(join(ROOT, "thorex-screens.css"), "utf8");
const OPD = readFileSync(join(ROOT, "opd-emr.css"), "utf8");

test("the CXR button is now an Ask MaiK call-to-action", () => {
  assert.match(JS, /<b>Ask MaiK<\/b>/, "button reads Ask MaiK");
  assert.ok(!/Get best-fit diagnoses/.test(JS), "old label gone");
});

test("the existing handler still finds the button", () => {
  assert.match(JS, /class="tx-aidx-go tx-maik-cta" data-act="tx-aidx-go"/, "data-act and tx-aidx-go kept");
  assert.match(JS, /host\.querySelector\('\[data-act="tx-aidx-go"\]'\)/, "runAiDx still binds by data-act");
  assert.match(JS, /<button type="button"/, "still a real button, so goBtn.disabled works");
});

test("it glows with the OPD aurora animation", () => {
  assert.match(CSS, /#thorexRoot \.tx-maik-cta\{[^}]*animation:oeMaikBloom/, "outer bloom");
  assert.match(CSS, /#thorexRoot \.tx-maik-glow\{[^}]*animation:oeMaikAurora/, "drifting aurora sheen");
  assert.match(JS, /class="tx-maik-glow"/, "the glow layer is rendered");
});

test("the animation is reused from OPD, not redefined", () => {
  assert.match(OPD, /@keyframes oeMaikAurora/, "keyframes still defined in opd-emr.css");
  assert.match(OPD, /@keyframes oeMaikBloom/);
  assert.ok(!/@keyframes oeMaik/.test(CSS), "thorex does not duplicate the keyframes");
});

test("reduced-motion users do not get a pulsing button", () => {
  assert.match(CSS, /prefers-reduced-motion: reduce\)\{#thorexRoot \.tx-maik-cta,#thorexRoot \.tx-maik-glow\{animation:none\}/);
});
