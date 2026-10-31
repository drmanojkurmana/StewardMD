/* smd-motion.js, the shared motion language (owner 2026-10-31): real springs as CSS linear() easings, and the
 * container transform's start (a page clipped to the tile it grows out of).
 * node --test test/smd-motion.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const M = require("../smd-motion.js");

test("springs settle at 1, the open spring overshoots a little, the push spring barely", () => {
  const open = M.springCurve(...M.PRESET.open), push = M.springCurve(...M.PRESET.push);
  assert.equal(open.pts[0], 0); assert.equal(open.pts[open.pts.length - 1], 1);
  const peak = (c) => Math.max(...c.pts);
  assert.ok(peak(open) > 1.005 && peak(open) < 1.08, "open overshoots under 8%: " + peak(open));
  assert.ok(peak(push) < 1.03, "push nearly critical: " + peak(push));
  assert.ok(open.ms > 250 && open.ms < 1200 && push.ms > 250 && push.ms < 1200, open.ms + " " + push.ms);
});

test("linear() easing: starts at 0, ends at 1, at most 48 stops plus the end", () => {
  const e = M.linearEasing(M.springCurve(300, 30).pts);
  assert.match(e, /^linear\(0, [-\d., ]+, 1\)$/);
  assert.ok(e.split(",").length <= 50);
});

test("container transform: the clip is the tile inside the page, the origin its centre", () => {
  const m = M.morphFrom({ left: 20, top: 300, width: 100, height: 80 }, { left: 0, top: 0, width: 390, height: 844 }, 16);
  assert.equal(m.clip, "inset(300px 270px 464px 20px round 16px)");
  assert.equal(m.ox, "70px"); assert.equal(m.oy, "340px");
  assert.ok(m.scale < 1);
  const out = M.morphFrom({ left: -10, top: -10, width: 50, height: 50 }, { left: 0, top: 0, width: 390, height: 844 });
  assert.match(out.clip, /^inset\(0px 350px 804px 0px round 18px\)$/, "a tile partly off the page clips at the edge");
});

test("loaded before page-motion.js, deferred, with a token", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const a = html.indexOf('<script src="/smd-motion.js?v='), b = html.indexOf('<script src="/page-motion.js?v=');
  assert.ok(a > 0 && b > a, "smd-motion.js before page-motion.js");
  assert.match(html, /<script src="\/smd-motion\.js\?v=[^"]+" defer><\/script>/);
});
