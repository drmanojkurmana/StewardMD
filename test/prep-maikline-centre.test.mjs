import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// prep.css centres every direct child of .pn-body with margin-left/right:auto. The MaiK line card sat at the left
// on an iPad because its own `margin: 2px 0 4px` (same specificity, loaded later) reset the side margins.
test("the MaiK line card keeps auto side margins so it stays centred on iPad", () => {
  const css = readFileSync(new URL("../prep-ask.css", import.meta.url), "utf8");
  const rule = css.split("\n").find((l) => /^\.pn-root \.pn-maikline \{/.test(l));
  assert.ok(rule, "rule present");
  assert.match(rule, /margin:\s*2px auto 4px/);
});
