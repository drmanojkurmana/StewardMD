/* Patients page: a temporary MR number can be linked to the hospital's real one, and a clash is said plainly. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
function mount(reply) {
  const els = {}; const el = (id) => (els[id] = els[id] || { id, value: "", innerHTML: "", addEventListener() {} });
  let page; const calls = []; const toasts = [];
  const sb = { window: { WSQ: { page: (_n, def) => { page = def; } } }, document: { getElementById: el } };
  sb.WSQ = sb.window.WSQ; sb.window.document = sb.document;
  vm.createContext(sb); vm.runInContext(readFileSync(new URL("../wardsynq/site/pages/patients.js", import.meta.url), "utf8"), sb);
  const c = { el: el("root"), esc, ms: () => "", can: () => true, isWardsynq: () => true, toast: (t) => toasts.push(t),
    state: { orgId: "o1", org: { id: "o1", name: "H", code: "GH" }, who: { role: "reception" } },
    api: (path, body) => { calls.push({ path, body }); return Promise.resolve(reply(path, body)); } };
  page.render(c);
  return { els, el, calls, toasts };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("a temporary number offers Link; a clash is refused with the reason", async () => {
  const m = mount((path) => path.startsWith("/patient/get") ? { ok: true, patient: { mrn: "TMP-000002", name: "Ravi", pending: true } } : { ok: false, error: "mrn_in_use" });
  m.el("pMrn").value = "TMP-000002"; m.el("pFind").onclick(); await tick();
  assert.match(m.el("pOut").innerHTML, /Hospital MR number issued for this patient/);
  m.el("pLinkMrn").value = "MRN-9"; m.el("pLink").onclick(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(m.calls[1])), { path: "/patient/link-mrn", body: { orgId: "o1", provisionalMrn: "TMP-000002", mrn: "MRN-9" } });
  assert.match(m.toasts.join(" "), /already belongs to another patient/);
});

test("an already replaced number points to the real one and offers no Link", async () => {
  const m = mount(() => ({ ok: true, patient: { mrn: "TMP-000001", name: "Asha", supersededBy: "MRN-9" } }));
  m.el("pMrn").value = "TMP-000001"; m.el("pFind").onclick(); await tick();
  assert.match(m.el("pOut").innerHTML, /replaced by hospital MR number <b class="mono">MRN-9/);
  assert.ok(!m.el("pOut").innerHTML.includes("pLink"));
});
