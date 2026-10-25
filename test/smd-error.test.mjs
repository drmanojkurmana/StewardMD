import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("../smd-error.js");

test("panel shows title, why and real action buttons wired to data-act", () => {
  const h = E.html({ title: "Couldn't open this X-ray", why: "It may have been deleted.", actions: [{ label: "Try again", act: "tx-retry", primary: true }, { label: "Back to list", act: "tx-back" }] });
  assert.match(h, /role="alert"/);
  assert.match(h, /Couldn&#39;t open this X-ray/);
  assert.match(h, /data-act="tx-retry"/);
  assert.match(h, /smd-err-btn is-primary/);
  assert.match(h, /data-act="tx-back"/);
});

test("all text is escaped, nothing can inject markup", () => {
  const h = E.html({ title: "<img src=x onerror=1>", why: '"><script>1</script>', actions: [{ label: "<b>x</b>", act: 'a"b' }], code: "<x>" });
  assert.ok(!/<img|<script|<b>|<x>/.test(h), h);
  assert.match(h, /data-act="a&#34;b"/);
});

test("the panel draws no icon and no inline svg", () => {
  const h = E.html({ title: "T", why: "W", actions: [{ label: "Go", act: "go" }], code: "C" });
  assert.ok(!/<svg|<img|material-symbols|aria-hidden/.test(h));
});

test("technical code sits behind Details, never the headline", () => {
  const h = E.html({ title: "Couldn't load", code: "LOCAL_STORE_TIMEOUT" });
  assert.match(h, /<details class="smd-err-more"><summary>Details<\/summary>/);
  assert.ok(h.indexOf("LOCAL_STORE_TIMEOUT") > h.indexOf("Couldn&#39;t load"));
});

test("block variant is the amber one", () => {
  assert.match(E.html({ title: "Add the patient's weight", kind: "block" }), /smd-err smd-err--block/);
});
