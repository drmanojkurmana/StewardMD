/* BUG-MU2PM1D9: the chart header's screens, grouped into categories, rendered for real.
 * The real-browser half (keyboard, session memory, 390 px layout) is test/run-ward-chart-tabs-ui.mjs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard(saved) {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const store = new Map(saved ? [["wsqChartNav", JSON.stringify(saved)]] : []);
  const sandbox = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: {
      getElementById: () => null,
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [],
    },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout, clearTimeout, console, Promise, Date,
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(src, sandbox);
  return sandbox.window.WARD;
}

/* Every button the header carried before the grouping (ward.js before this change), in its old order. */
const PRIMARY = ["consultation", "workspace"];
const OLD_TABS = ["medrec", "ordersets", "pathways", "specialty", "infusions", "careplan", "tags", "patientsurgery", "wounds", "risks",
  "immunizations", "people", "documents", "forms", "referrals", "move", "timeline", "summary", "wardcloseopen", "followup", "oncologyopen",
  "cardiologyopen", "radiologyopen", "pharmacyopen", "txopen", "consentopen", "ipsopen", "completionopen", "roiopen", "tpaopen", "billingopen", "pcopy"];
const ED_TABS = ["careplan", "pcopy"];

const SEL = { patientId: "p1", encounterId: "e1", ward: "W1", bed: "3", admittedAt: "2026-09-15T08:00:00Z" };
const header = (html) => html.slice(html.indexOf('<div class="w-chart-h">'), html.indexOf("</nav></div>") + 12);
const count = (html, act) => html.split('data-w-act="' + act + '"').length - 1;

test("every old chart tab is still in the header exactly once, inside a category panel", () => {
  const W = loadWard();
  const h = header(W._render({ ...W._st, view: "chart", sel: SEL }));
  for (const act of PRIMARY) assert.equal(count(h, act), 1, act + " stays beside the name");
  const cats = W._chartCats;
  assert.equal(cats.length, 6);
  for (const act of OLD_TABS) {
    assert.equal(count(h, act), 1, act + " appears once");
    const cat = cats.find((c) => c.tabs.some((t) => t.act === act));
    assert.ok(cat, act + " belongs to a category");
    const panel = h.slice(h.indexOf('id="wCnavP-' + cat.id + '"'));
    assert.ok(panel.slice(0, panel.indexOf("</div></div>")).includes('data-w-act="' + act + '"'), act + " sits in the " + cat.id + " panel");
    assert.ok(h.includes('data-w-act="chartcat:' + cat.id + '"'), "its category tab is rendered");
  }
  const grouped = cats.flatMap((c) => c.tabs.map((t) => t.act));
  assert.deepEqual([...grouped].sort(), [...OLD_TABS].sort(), "no tab invented, none dropped");
});

test("ARIA tabs: one selected category, the others hidden, one tab stop per row", () => {
  const W = loadWard();
  const h = header(W._render({ ...W._st, view: "chart", sel: SEL }));
  assert.equal(h.split('role="tab"').length - 1, 6);
  assert.equal(h.split('aria-selected="true"').length - 1, 1);
  assert.match(h, /id="wCnav-overview"[^>]*aria-selected="true" tabindex="0"/);
  assert.equal(h.split('role="tabpanel"').length - 1, 6);
  assert.equal(h.split('role="tabpanel" id="wCnavP-').length - 1, 6);
  assert.equal((h.match(/role="tabpanel"[^>]*hidden>/g) || []).length, 5, "five panels folded away");
  assert.match(h, /data-w-act="timeline" title="[^"]*" tabindex="0"/, "the first button of the open panel is its tab stop");
});

test("the last category and screen chosen this session come back", () => {
  const W = loadWard({ cat: "admin", tab: "tpaopen" });
  const h = header(W._render({ ...W._st, view: "chart", sel: SEL }));
  assert.match(h, /id="wCnav-admin"[^>]*aria-selected="true"/);
  assert.match(h, /id="wCnavP-admin" aria-labelledby="wCnav-admin">/, "admin panel shown");
  assert.match(h, /id="wCnavP-overview" aria-labelledby="wCnav-overview" hidden>/);
  assert.match(h, /data-w-act="tpaopen" title="[^"]*" tabindex="0"/);
  assert.match(h, /data-w-act="billingopen" title="[^"]*" tabindex="-1"/);
  // An unknown saved category falls back to the first one rather than showing nothing.
  const W2 = loadWard({ cat: "gone" });
  assert.match(header(W2._render({ ...W2._st, view: "chart", sel: SEL })), /id="wCnav-overview"[^>]*aria-selected="true"/);
});

test("a screen hidden on this chart stays hidden: the ED chart carries only its own two", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "chart", sel: { ...SEL, class: "ED", arrivedAt: "2026-09-15T08:00:00Z" } });
  const h = html.slice(html.indexOf('<div class="w-chart-h">'), html.indexOf("</div>", html.indexOf("Patient copy</button>")));
  for (const act of ED_TABS) assert.equal(count(h, act), 1, act + " on the ED chart");
  for (const act of OLD_TABS.concat(PRIMARY).filter((a) => !ED_TABS.includes(a))) assert.equal(count(html, act), 0, act + " not on the ED chart");
  assert.ok(!html.includes('role="tablist"'));
});

test("a badge on a screen shows on its category too, urgent stays urgent", () => {
  const W = loadWard();
  const cats = JSON.parse(JSON.stringify(W._chartCats));
  const nursing = cats.find((c) => c.id === "nursing");
  nursing.tabs.find((t) => t.act === "infusions").badge = () => ({ n: 2, urgent: true });
  nursing.tabs.find((t) => t.act === "wounds").badge = () => ({ n: 1 });
  cats.find((c) => c.id === "admin").tabs[0].badge = () => null;
  const h = W._chartNavHtml({}, cats);
  const catTab = h.slice(h.indexOf('id="wCnav-nursing"'), h.indexOf("</button>", h.indexOf('id="wCnav-nursing"')));
  assert.match(catTab, /class="w-cnav-b urgent" aria-label="3 urgent">3</, "the closed category shows the total and is urgent");
  assert.match(h, /data-w-act="infusions"[^>]*>.*?Drips<span class="w-cnav-b urgent" aria-label="2 urgent">2<\/span>/);
  const adminTab = h.slice(h.indexOf('id="wCnav-admin"'), h.indexOf("</button>", h.indexOf('id="wCnav-admin"')));
  assert.ok(!adminTab.includes("w-cnav-b"), "no badge where there is nothing to count");
});
