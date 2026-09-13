/* The outpatient console's "Keep open 30 days" on the checked-out box. opd.html is an inline page,
 * so this reads the source: the button is doctor-only, and the shown date changes only on success. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HTML = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
const ROUTER = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");

test("every inline script on the outpatient console still parses", () => {
  let n = 0;
  for (const m of HTML.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)) { new Function(m[1]); n++; }
  assert.ok(n > 0);
});

test("the extend button is offered only to someone who can treat", () => {
  assert.match(HTML, /can\("emr\.treat"\)\?'<button class="cancel" id="ext"/);
});

test("the extension calls timeline/extend and updates the date only when the server confirms", () => {
  const fn = HTML.slice(HTML.indexOf("function extendLink("), HTML.indexOf("function extendLink(") + 900);
  assert.match(fn, /api\("timeline\/extend"/);
  const fail = fn.indexOf("if(!r||!r.ok)");
  const update = fn.indexOf("lx.textContent=linkUntil(r.linkExpiresAt)");
  assert.ok(fail > -1 && update > fail, "the failure branch must return before the date is changed");
  assert.match(fn, /The old date still applies/);
});

test("the server route is doctor-only, reports failures as failures, and audits the extension", () => {
  const route = ROUTER.slice(ROUTER.indexOf('sub === "extend"'), ROUTER.indexOf('sub === "extend"') + 700);
  assert.match(route, /requireSessionCap\(env, actor, s, CAPS\.EMR_TREAT\)/);
  assert.match(route, /if \(ext\.error\) return json\(\{ ok: false/);
  assert.match(route, /action: "link_extend"/);
});
