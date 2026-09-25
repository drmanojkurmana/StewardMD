/* Owner, 2026-09-25: "fix stop for research and web search too". The browser test
 * (test/run-maik-stop-research-ui.mjs) drives the chip and Research mode; this pins the pieces it
 * cannot reach cheaply: the clinical turn's hand-over to web research, and the busy guard. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const H = readFileSync(new URL("../home.js", import.meta.url), "utf8");

test("handing a clinical turn to web research stops its stage timers and watchdog", () => {
  assert.match(H, /_maikDone = true; _clearStages\(\); clearTimeout\(_maikTO\);[\s\S]{0,400}?try \{ maikRunWeb\(think, question\); \}/);
});
test("web research and Research mode own the Stop button and drop a late result", () => {
  const web = H.slice(H.indexOf("function maikRunWeb("), H.indexOf("function maikWebChipEl("));
  assert.match(web, /_maikStop = function \(\) \{/); assert.match(web, /maikSetSendMode\(true\)/);
  assert.match(web, /\.then\(function \(r\) \{\n\s*if \(_stopped\) return;/);
  const res = H.slice(H.indexOf("function maikRunResearch("), H.indexOf("function maikRunResearch(") + 2500);
  assert.match(res, /_maikStop = function \(\) \{/); assert.match(res, /\.then\(function \(r\) \{\n\s*if \(_stopped\) return;/);
});
test("the Research chip does not take over a turn already in flight", () => {
  assert.match(H, /if \(wq\) \{ if \(_maikBusy\) return; el\.disabled = true;/);
});
