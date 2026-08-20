// Guards reasoning.js replay() word-paced reveal: tokens must reconstruct the answer exactly
// and every emitted frame must be a valid, word-aligned, growing prefix. Run: node --test test/maik-word-reveal.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

// Mirror of replay()'s pure logic (reasoning.js ~3838): tokenize on words, reveal `per` words/frame.
function frames(full) {
  const words = full.match(/\S+\s*/g) || [full];
  const per = Math.max(1, Math.ceil(words.length / 260));
  const out = [];
  let n = 0, acc = "";
  while (n < words.length) {
    const end = Math.min(words.length, n + per);
    for (; n < end; n++) acc += words[n];
    out.push(acc);
  }
  return { frames: out, per, wordCount: words.length };
}

test("tokens reconstruct the answer exactly", () => {
  for (const s of ["First-line: amoxicillin 500mg TDS.", "One two three", "single", "a\nb\tc  d"]) {
    const words = s.match(/\S+\s*/g) || [s];
    assert.equal(words.join(""), s);
  }
});

test("every frame is a growing prefix, final frame equals the whole answer", () => {
  const full = "Sepsis: give broad-spectrum antibiotics within one hour, take cultures first, and start fluids.";
  const { frames: fr } = frames(full);
  assert.ok(fr.length > 1, "should animate over multiple frames");
  fr.forEach((f, i) => {
    assert.ok(full.startsWith(f), "frame is a prefix");
    if (i > 0) assert.ok(f.length > fr[i - 1].length, "frame grows");
  });
  assert.equal(fr[fr.length - 1], full);
});

test("short answers reveal word-by-word; long answers stay bounded (~260 frames)", () => {
  assert.equal(frames("start empiric antibiotics now").per, 1);            // short → one word/frame
  const long = Array.from({ length: 3000 }, (_, i) => "w" + i).join(" ");
  const r = frames(long);
  assert.ok(r.per > 1 && r.frames.length <= 260, "long answer capped, per=" + r.per + " frames=" + r.frames.length);
});
