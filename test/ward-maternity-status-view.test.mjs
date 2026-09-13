/* The pregnancy card: obstetric status shown, and a failed load never reads as "no pregnancy". */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const sandbox = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: {
      getElementById: () => null,
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [],
    },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout, clearTimeout, console, Promise, Date,
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(src, sandbox);
  return sandbox.window.WARD;
}

const SEL = { patientId: "p1", encounterId: "e1", name: "Sita Devi", class: "MATERNITY", admittedAt: "2026-09-12T08:00:00.000Z" };
const chart = (W, maternity) => W._render({ ...W._st, view: "chart", sel: SEL, maternity });

test("the obstetric status is shown, in the engine's own words", () => {
  const W = loadWard();
  const html = chart(W, { status: { state: "postpartum", postpartumDay: 2, reason: "day 2 postpartum; obstetric risk runs to 42 days and haemorrhage risk is highest now" } });
  assert.match(html, /haemorrhage risk is highest now/);
});

test("A FAILED PREGNANCY LOAD NEVER READS AS 'NO PREGNANCY RECORDED'", () => {
  const W = loadWard();
  const html = chart(W, { pregFailed: true });
  assert.match(html, /could not be loaded. Do not read this as no pregnancy/);
  assert.ok(!html.includes("No pregnancy episode recorded"), "on a maternity ward a failed load must not say there is no pregnancy");
});

test("a genuinely absent pregnancy still says so", () => {
  const W = loadWard();
  const html = chart(W, { pregFailed: false });
  assert.match(html, /No pregnancy episode recorded/);
});
