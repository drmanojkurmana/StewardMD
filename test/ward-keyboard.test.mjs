/* P2.16 keyboard layer and accessible names in ward.js, driven for real in a small fake DOM.
 *
 * The real browser check (touch targets, sticky header, no horizontal scroll) is
 * test/run-ward-tablet-ui.mjs; this file is the part that runs in CI without Chrome. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* Just enough DOM for ward.js's controller: elements that hold innerHTML, children and attributes. */
function fakeDom() {
  const byId = new Map();
  const mk = (tag) => {
    const el = {
      tagName: tag.toUpperCase(), id: "", className: "", style: {}, attrs: {}, children: [], parentNode: null, innerHTML: "", textContent: "",
      classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
      appendChild(c) { c.parentNode = el; el.children.push(c); if (c.id) byId.set(c.id, c); return c; },
      insertBefore(c, ref) { c.parentNode = el; el.children.splice(Math.max(0, el.children.indexOf(ref)), 0, c); if (c.id) byId.set(c.id, c); return c; },
      removeChild(c) { el.children = el.children.filter((x) => x !== c); byId.delete(c.id); c.parentNode = null; return c; },
      contains(n) { for (let x = n; x; x = x.parentNode) if (x === el) return true; return false; },
      querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, focus() {}, blur() {},
    };
    return el;
  };
  const body = mk("body");
  const document = {
    body, documentElement: mk("html"), activeElement: body,
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => mk(tag), // an element is findable by id once it is attached, as in a real page
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  };
  return { document, body };
}

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const calls = [];
  const { document, body } = fakeDom();
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" }, document,
    localStorage: { getItem: (k) => (k === "smd_opd_staff_tok" ? "tok" : ""), setItem() {}, removeItem() {} },
    fetch: (url, opts) => { calls.push({ url: String(url), method: (opts && opts.method) || "GET" }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); },
    setTimeout, clearTimeout, console, Promise, Date, addEventListener() {}, scrollY: 0, scrollTo() {},
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  return { W: sb.window.WARD, calls, document, body };
}
const settle = () => new Promise((r) => setTimeout(r, 60));
const PATIENT = { encounterId: "enc-1", patientId: "pat-1", name: "Asha", mrn: "MRN1", ward: "Ward A", bed: "4", class: "IPD", admittedAt: "2026-09-10T04:00:00Z" };
const key = (k, target, extra) => { const e = { key: k, target, prevented: false, preventDefault() { this.prevented = true; }, ...extra }; return e; };

function opened() {
  const w = loadWard();
  w.W.open({ orgId: "org-k" });
  return w;
}

test("typing in an input, textarea, select or contenteditable never triggers a shortcut", async () => {
  const w = opened(); const { W, document } = w;
  const root = document.getElementById("smdWard");
  await settle();
  W._st.view = "chart"; W._st.sel = PATIENT;
  for (const target of [{ tagName: "INPUT" }, { tagName: "TEXTAREA" }, { tagName: "SELECT" }, { tagName: "DIV", isContentEditable: true }]) {
    target.parentNode = root;
    const before = w.calls.length;
    for (const k of ["g", "c", "g", "l", "g", "w", "n", "o", "r", "v", "/", "?"]) {
      const e = key(k, target);
      W._onKey(e);
      assert.equal(e.prevented, false, `${k} in ${target.tagName} must type, not navigate`);
    }
    await settle();
    assert.equal(W._st.view, "chart", `no navigation from ${target.tagName}`);
    assert.equal(document.getElementById("wKeys"), null, "no sheet while typing");
    assert.equal(w.calls.length, before, "no request while typing");
    // The pure resolver agrees, and Escape inside a field only leaves the field.
    assert.equal(W._keyIntent(key("n", target), "chart", false), null);
    assert.equal(W._keyIntent(key("c", target), "list", true), null);
    assert.deepEqual({ ...W._keyIntent(key("Escape", target), "chart", false) }, { blur: true });
  }
  // Modifier chords belong to the browser, not the ward.
  assert.equal(W._keyIntent(key("n", document.body, { metaKey: true }), "chart", false), null);
  assert.equal(W._keyIntent(key("n", document.body, { ctrlKey: true }), "chart", false), null);
});

test("the map binds only navigation: every shortcut, run on the list and on a chart, sends no write", async () => {
  const { W, calls } = opened();
  await settle();
  const names = W._keys.map((s) => s.keys);
  for (const want of ["/", "g w", "g c", "g l", "n", "o", "r", "v", "?", "Escape"]) assert.ok(names.includes(want), `bound: ${want}`);
  for (const view of ["list", "chart"]) {
    for (const s of W._keys) {
      W._st.view = view; W._st.sel = view === "chart" ? PATIENT : null;
      W._st.patients = [PATIENT];
      W._runShortcut(s);
      await settle();
    }
  }
  const writes = calls.filter((c) => c.method !== "GET");
  assert.deepEqual(writes, [], "a shortcut reached a write: " + JSON.stringify(writes));
  // And statically: no entry names a verb whose click is a write in the dispatcher.
  const WRITE_VERBS = /^(mar|vitals|note|medorder|investigation|ack|ackboard|admitconfirm|problem|resolve|cosign|submitnote|fluid|move|triage|retriage|consultationsave|timelinenote|ntaskadd|ntaskact|nurseassign|obsfreqsave|formsubmit|labverify|labreturn|labresultsave)$/;
  for (const s of W._keys) for (const v of [s.act, s.card].filter(Boolean)) assert.ok(!WRITE_VERBS.test(v), `${s.keys} is bound to write verb ${v}`);
});

test("g then c and g then l go to the boards; a lone key on the list does nothing", async () => {
  const { W, document } = opened();
  await settle();
  const b = document.body;
  W._onKey(key("n", b)); assert.equal(W._st.view, "list", "n is chart-only");
  W._onKey(key("c", b)); assert.equal(W._st.view, "list", "c alone is not a chord");
  W._onKey(key("g", b)); W._onKey(key("c", b));
  assert.equal(W._st.view, "critsboard");
  W._onKey(key("g", b)); W._onKey(key("l", b));
  assert.equal(W._st.view, "labboard");
  W._onKey(key("g", b)); W._onKey(key("w", b));
  assert.equal(W._st.view, "list");
});

test('"?" renders the shortcut sheet listing every entry, and Escape closes it', async () => {
  const { W, document } = opened();
  await settle();
  const e = key("?", document.body);
  W._onKey(e);
  assert.equal(e.prevented, true);
  const sheet = document.getElementById("wKeys");
  assert.ok(sheet, "the sheet exists");
  assert.equal(sheet.parentNode, document.getElementById("smdWard"), "inside the ward, so its close button is delegated");
  assert.match(sheet.innerHTML, /Keyboard shortcuts/);
  for (const s of W._keys) assert.ok(sheet.innerHTML.includes(s.label), `lists: ${s.label}`);
  assert.match(sheet.innerHTML, /Nothing is saved, given or signed from the keyboard/);
  assert.match(sheet.innerHTML, /data-w-act="keysclose" aria-label="Close shortcuts"/);
  await settle();
  assert.match(document.getElementById("wKeysLive").textContent, /Keyboard shortcuts shown/, "announced for screen readers");
  assert.equal(document.getElementById("wKeysLive").attrs["aria-live"], "polite");
  W._onKey(key("Escape", document.body));
  assert.equal(document.getElementById("wKeys"), null, "Escape closed the sheet");
});

test("nothing fires under the forced acknowledgement screen or when focus is in another sheet", async () => {
  const { W, document } = opened();
  await settle();
  const alert = document.createElement("div"); alert.id = "wsq-alert"; document.body.appendChild(alert);
  W._onKey(key("?", document.body));
  assert.equal(document.getElementById("wKeys"), null);
  document.body.removeChild(alert);
  const other = document.createElement("div"); document.body.appendChild(other);
  W._onKey(key("?", { tagName: "BUTTON", parentNode: other }));
  assert.equal(document.getElementById("wKeys"), null);
});

/* Every icon-only button in the main ward, chart and board views has a name a screen reader can say. */
test("every icon-only w-ic button in the rendered main views has aria-label or title", () => {
  const { W } = loadWard();
  const base = { ...W._st, orgId: "o", loaded: true, patients: [PATIENT], err: "x", note: "", refusal: null };
  const views = [
    { ...base, view: "list" },
    { ...base, view: "list", err: "", note: "saved" },
    { ...base, view: "list", err: "", refusal: { action: "administer", reasons: ["ALLERGY"] } },
    { ...base, view: "chart", sel: PATIENT, due: [{ drug: "Ceftriaxone", dose: { value: 1, unit: "g" }, dueAt: "2026-09-14T08:00:00Z", status: "verified" }] },
    { ...base, view: "chart", sel: { ...PATIENT, class: "ICU" } },
    { ...base, view: "chart", sel: { ...PATIENT, class: "MATERNITY" } },
    { ...base, view: "chart", sel: { ...PATIENT, class: "NICU" } },
    { ...base, view: "chart", sel: { encounterId: "e2", patientId: "p2", class: "ED", mrn: "M2", arrivedAt: "2026-09-14T01:00:00Z" } },
    { ...base, view: "critsboard", critsBoard: [] },
    { ...base, view: "labboard", labBoard: null },
    { ...base, view: "board", board: { wards: [{ ward: "A", occupied: [], free: ["1"], bedsKnown: true }] }, admitTarget: { ward: "A", bed: "1" } },
    { ...base, view: "nurseworklist", nurseWorklist: { ok: true, me: "m", rows: [] } },
    { ...base, view: "nursingpatient", nursingPanel: { patientId: "p", encounterId: "e", data: { tasks: [] } } },
    { ...base, view: "timeline", sel: PATIENT, timeline: [] },
  ];
  let seen = 0;
  for (const s of views) {
    const html = W._render(s);
    const buttons = html.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<\/button>/g) || [];
    for (const b of buttons) {
      const open = b.match(/^<button\b[^>]*>/)[0];
      const inner = b.slice(open.length, -"</button>".length);
      const iconOnly = !inner.replace(/<span class="material-symbols-outlined[^"]*"[^>]*>[^<]*<\/span>/g, "").trim();
      if (!/class="w-(ic|x)\b/.test(open) && !iconOnly) continue;
      seen++;
      assert.match(open, /\b(aria-label|title)="[^"]+"/, `${s.view}: unnamed icon button ${open}`);
    }
    // The icon ligature is not read out as a word ("arrow_back", "refresh").
    assert.ok(!/<span class="material-symbols-outlined[^"]*">/.test(html), `${s.view}: an icon is not aria-hidden`);
  }
  assert.ok(seen > 20, `checked ${seen} icon buttons`);
});

test("the round's next-due line never names a dose when one could not be read, and claims nothing when empty", () => {
  const { W } = loadWard();
  const chart = (due) => W._render({ ...W._st, view: "chart", sel: PATIENT, due });
  assert.ok(!/Next due/.test(chart([])), "an empty (or still loading) round says nothing");
  const two = chart([
    { drug: "Later", dueAt: "2026-09-14T12:00:00Z", status: "ordered" },
    { drug: "Earlier", dueAt: "2026-09-14T08:00:00Z", status: "verified", overdue: true },
    { drug: "Given", dueAt: "2026-09-14T06:00:00Z", status: "administered" },
  ]);
  assert.match(two, /Next due: <b>Earlier<\/b>[^<]*overdue/);
  const unread = chart([{ drug: "A", dueAt: "2026-09-14T08:00:00Z", status: "ordered" }, { drug: "B", dueAt: "2026-09-14T09:00:00Z", readFailed: true }]);
  assert.match(unread, /Next due not known/);
  assert.ok(!/Next due: <b>/.test(unread));
  const wl = W._render({ ...W._st, view: "nurseworklist", nwScope: "ward", nurseWorklist: { ok: true, me: "m", rows: [
    { patientId: "p1", patient: { name: "A" }, overdue: 2, dueSoon: 1, problems: [] },
    { patientId: "p2", patient: { name: "B" }, overdue: null, dueSoon: null, problems: ["schedule could not be read"] },
  ] } });
  assert.match(wl, /Next due: 2 overdue &middot; 1 in the next 4 hours &middot; 1 patient could not be read/);
});
