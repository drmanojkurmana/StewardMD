// smd-hy.js: lesson key terms are black bold (owner 2026-11-11). Narrow, escaped, display-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const H = createRequire(import.meta.url)("../smd-hy.js");
const bolds = (t) => [...H.html(t).matchAll(/<b class="smd-hy">(.*?)<\/b>/g)].map((m) => m[1]);

test("numbers with units, comparators and author **markup** are bold", () => {
  assert.deepEqual(bolds("Normal is 10 to 15 mL a day; over 100 mL is abnormal; SpO2 <92 is low; **clubbing** matters"),
    ["10 to 15 mL", "100 mL", "&lt;92", "clubbing"]);
});
test("signals, absolutes, eponyms, findings and concepts are bold", () => {
  assert.deepEqual(bolds("Do not percuss hard. Murphy's sign is the classic sign; shifting dullness means ascites in cirrhosis; think lung abscess or bronchiectasis."),
    ["Do not", "Murphy&#39;s sign", "classic sign", "shifting dullness", "ascites", "cirrhosis", "lung abscess", "bronchiectasis"]);
});
test("text is escaped and ordinary prose is left alone", () => {
  assert.equal(H.html("<img src=x onerror=1> ask how much comes up"), "&lt;img src=x onerror=1&gt; ask how much comes up");
  assert.deepEqual(bolds("Ask whether anything comes up when they cough."), []);
});
test("no colour: the injected rule inherits the paragraph's ink", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../smd-hy.js", import.meta.url), "utf8");
  assert.match(src, /b\.smd-hy\{font-weight:700;color:inherit;background:none\}/);
});
