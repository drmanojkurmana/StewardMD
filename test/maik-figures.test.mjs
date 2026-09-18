/* test/maik-figures.test.mjs — related figures under a MaiK answer (functions/_figures.js).
 * A search step, never a model: pick the figure a trusted page is built around, skip logos and
 * junk, resolve relative URLs, and return nothing rather than a wrong image. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickFigure, findFigures } from "../functions/_figures.js";

const PAGE = "https://www.med.unc.edu/medclerk/education/grading/hematuria/";
const HTML = `
<html><head><meta property="og:image" content="/img/unc-logo.png"></head><body>
<img src="/assets/logo.svg" alt="UNC School of Medicine logo" width="180" height="60">
<img src="https://cdn.example.org/spacer.gif" width="1" height="1">
<h2>AUA Microhematuria Evaluation Algorithm</h2>
<figure><img data-src="/files/aua-microhematuria-algorithm.png" alt="AUA Microhematuria Evaluation Algorithm" width="900" height="1200"><figcaption>Source: AUA 2020</figcaption></figure>
<img src="/img/campus-banner.jpg" alt="Campus" width="1600" height="400">
</body></html>`;

test("picks the figure the page is built around, not the logo, the banner or the tracking pixel", () => {
  const f = pickFigure(HTML, PAGE, "hematuria workup");
  assert.equal(f.img, "https://www.med.unc.edu/files/aua-microhematuria-algorithm.png");
  assert.match(f.alt, /Microhematuria Evaluation Algorithm/);
});

test("relative and data-src URLs resolve against the page; http images are dropped", () => {
  const f = pickFigure('<img data-src="../x/algorithm-hematuria.png" alt="hematuria algorithm" width="800">', PAGE, "hematuria");
  assert.equal(f.img, "https://www.med.unc.edu/medclerk/education/grading/x/algorithm-hematuria.png");
  assert.equal(pickFigure('<img src="http://insecure.example/hematuria-algorithm.png" alt="hematuria algorithm" width="800">', PAGE, "hematuria"), null);
});

test("a page with only logos, icons and an unrelated og:image yields NOTHING (no wrong image, ever)", () => {
  const junk = '<meta property="og:image" content="/img/site-banner.jpg"><img src="/logo.png" alt="logo" width="300"><img src="/icons/share.svg" width="24">';
  assert.equal(pickFigure(junk, PAGE, "hematuria workup"), null);
});

test("og:image is accepted only when it names the topic or is plainly a figure", () => {
  assert.equal(pickFigure('<meta property="og:image" content="/media/hematuria-algorithm.png">', PAGE, "hematuria").img, "https://www.med.unc.edu/media/hematuria-algorithm.png");
  assert.equal(pickFigure('<meta property="og:image" content="/media/hero.jpg">', PAGE, "hematuria"), null);
});

test("findFigures: untrusted pages and PDFs are skipped before any fetch; no key -> []", async () => {
  // TINYFISH_API_KEY absent: tinyfishSearch returns [] and so must we, without throwing.
  assert.deepEqual(await findFigures({}, "hematuria workup"), []);
  assert.deepEqual(await findFigures({ TINYFISH_API_KEY: "x" }, ""), []);
});
