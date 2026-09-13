/* MaiK card: earlier answers for the patient, with loading, failed and none kept apart. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  return sb.window.WARD;
}
const v = (W, history) => W._render({ ...W._st, view: "chart", sel: { patientId: "p1", encounterId: "e1", name: "Asha" }, maik: { history } });

test("earlier MaiK answers: offered, loading, failed, none, and a list that says what still needs review", () => {
  const W = loadWard();
  assert.ok(v(W, undefined).includes('data-w-act="maikhistory"'));
  assert.match(v(W, { busy: true }), /Loading earlier answers/);
  assert.match(v(W, { ok: false }), /Do not read this as none/);
  assert.match(v(W, { ok: true, interactions: [], counts: {} }), /has not been asked about this patient before/);
  const html = v(W, { ok: true, counts: { pending: 1, accepted: 1, edited: 0, rejected: 0 }, interactions: [
    { id: "i1", task: "summarise", requestedAt: "2026-09-13T10:00:00Z", review: { state: "pending" } },
    { id: "i2", task: "draft-note", requestedAt: "2026-09-12T10:00:00Z", review: { state: "accepted" } },
  ] });
  assert.match(html, /1 waiting for review, 1 kept, 0 rejected/);
  assert.ok(html.includes('data-w-act="maikopen:0"'));
  assert.match(readFileSync(new URL("../ward.js", import.meta.url), "utf8"), /\/ward\/maik-interactions\?orgId=/);
});
