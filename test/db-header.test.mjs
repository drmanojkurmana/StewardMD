// Drug page header revamp (owner 2026-11-11): compact bar, plain Back, title on scroll, calm "N brands" button.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const A = readFileSync(new URL("../api.js", import.meta.url), "utf8");
test("header is one compact bar: the drag handle takes no row, no glass, no pulsing glow", () => {
  assert.match(A, /#dbOverlay#dbOverlay \.db-top \.db-grab\{position:absolute!important/);
  assert.match(A, /#dbOverlay#dbOverlay \.db-top\{[^"]*backdrop-filter:none!important/);
  assert.match(A, /#dbOverlay#dbOverlay \.db-brandbtn\{[^"]*animation:none!important/);
});
test("Brands reads 'N brands' (one brand: 'brand'), no pill inside the button", () => {
  assert.match(A, /'<span class="db-bb-lbl"><b>' \+ cnt \+ '<\/b>' \+ \(nBrands === 1 \? " brand" : " brands"\)/);
  assert.ok(!/db-bb-ct">' \+ cnt/.test(A));
});
test("the bar title waits for the drug heading to scroll away; the list keeps its title", () => {
  assert.match(A, /root\.classList\.toggle\("db-is-detail", !!showBack \|\| !isWide\(\)\)/);
  assert.match(A, /\.db-is-detail:not\(\.db-scrolled\) \.db-title\{opacity:0\}/);
  assert.match(A, /root\.classList\.toggle\("db-scrolled", t\.scrollTop > lim\)/);
});
