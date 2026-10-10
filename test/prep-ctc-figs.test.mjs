/* PrepNucleus CTC figure crops (tools/prep-ctc-figs.py): the margin step. A label the crop edge cuts is taken in whole,
 * strokes over the edge are followed, body text and neighbouring figures stay out, clear page pads the box. Synthetic
 * pages drawn with Pillow (no book content in the repo); skipped when python3 has no Pillow.
 * node --test test/prep-ctc-figs.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOL = fileURLToPath(new URL("../tools/prep-ctc-figs.py", import.meta.url));
let havePIL = false;
try { execFileSync("python3", ["-c", "import PIL"], { stdio: "ignore" }); havePIL = true; } catch {}

// Runs the cases in one python process: each case draws a white page, returns { box, info, cut0, cut1 }.
const PY = `
import importlib.util, json, sys
from PIL import Image, ImageDraw
spec = importlib.util.spec_from_file_location("figs", sys.argv[1]); F = importlib.util.module_from_spec(spec); spec.loader.exec_module(F)
def page(): im = Image.new("L", (800, 800), 255); return im, ImageDraw.Draw(im)
def blk(*ws): return {"box": [min(w[0] for w in ws), min(w[1] for w in ws), max(w[2] for w in ws), max(w[3] for w in ws)], "words": [list(w) for w in ws]}
out = {}
# 1. a label beside a picture, cut by the left edge: taken in whole, then padded over clear page
im, d = page(); d.rectangle([300, 200, 599, 499], fill=120); d.rectangle([240, 330, 330, 350], fill=0)
b = [blk((240, 330, 330, 350))]; nb, info = F.margin_box(im, b, [300, 200, 600, 500])
out["label"] = {"box": nb, "cut0": F.cut_count(b, [300, 200, 600, 500]), "cut1": F.cut_count(b, nb), "grow": info["grow"]}
# 2. the same label, but a paragraph of body text sits right beside it: the paragraph stays out
im, d = page(); d.rectangle([300, 200, 599, 499], fill=120); d.rectangle([240, 330, 330, 350], fill=0); d.rectangle([60, 300, 236, 420], fill=0)
body = blk((60, 300, 100, 320), (110, 300, 150, 320), (160, 300, 200, 320), (60, 330, 100, 350), (110, 330, 236, 350))
b = [blk((240, 330, 330, 350)), body]; nb, info = F.margin_box(im, b, [300, 200, 600, 500])
out["body"] = {"box": nb, "cut1": F.cut_count(b, nb)}
# 3. a drawing whose stroke runs 10 px past the bottom edge: followed, then padded
im, d = page(); d.rectangle([300, 200, 599, 499], fill=150); d.line([450, 480, 450, 510], fill=0, width=3)
nb, info = F.margin_box(im, [], [300, 200, 600, 500])
out["stroke"] = {"box": nb, "grow": info["grow"], "resid": info["resid"]}
# 4. a neighbouring figure 4 px to the right: the box does not grow into it
im, d = page(); d.rectangle([300, 200, 599, 499], fill=120); d.rectangle([604, 200, 760, 500], fill=90)
nb, info = F.margin_box(im, [], [300, 200, 600, 500], [[604, 200, 760, 500]])
out["neighbour"] = {"box": nb}
# 5. a clean photo on white: only padding
im, d = page(); d.rectangle([300, 200, 599, 499], fill=120)
nb, info = F.margin_box(im, [], [300, 202, 600, 498])
out["clean"] = {"box": nb, "grow": info["grow"]}
print(json.dumps(out))
`;
const run = () => JSON.parse(execFileSync("python3", ["-P", "-c", PY, TOOL], { encoding: "utf8" }));

test("margin: a cut label is taken in whole and padded", { skip: !havePIL && "python3 without Pillow" }, () => {
  const r = run();
  assert.equal(r.label.cut0, 1);
  assert.equal(r.label.cut1, 0);
  assert.ok(r.label.box[0] < 240 && r.label.box[0] >= 230, "left edge clears the label by a few px: " + r.label.box);
  assert.deepEqual([r.label.box[1], r.label.box[3]], [192, 508], "top and bottom get the 8 px pad");
  // body text right beside the label: the label still comes in, the paragraph never does
  assert.equal(r.body.cut1, 0);
  assert.ok(r.body.box[0] > 236, "stays clear of the paragraph: " + r.body.box);
  // a stroke over the bottom edge is followed to its end
  assert.ok(r.stroke.box[3] >= 510 && r.stroke.box[3] <= 520, "bottom reaches past the stroke: " + r.stroke.box);
  assert.deepEqual(r.stroke.resid, []);
  // a neighbouring figure stops the growth
  assert.ok(r.neighbour.box[2] <= 604, "never into the neighbour: " + r.neighbour.box);
  // nothing cut: the box only gets padding
  assert.deepEqual(r.clean.grow, { l: 0, t: 2, r: 0, b: 2 });
});
