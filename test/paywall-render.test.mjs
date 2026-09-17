/* test/paywall-render.test.mjs — the conversion paywall sheet.
 *
 * Three cards by default (Pro / Physician / Physician Pro), Physician preselected, ANNUAL
 * preselected, Trainee + Co-Resident behind the "I'm a student or resident" link, per-day hero
 * line, SAVE% and strike-through computed ONLY from the server's `regular`, sticky CTA that names
 * the selected tier + cycle, and the Onco add-on offered on every tier.
 *
 * node --test test/paywall-render.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../pro-paywall.js", import.meta.url), "utf8");

// The ladder as the server serves it (paise). Annual = 10x monthly; `regular` is the price charged
// once the launch window closes and is the only legitimate strike-through anchor.
const TIERS = {
  student: { amount: 19900, annual: 199000, regular: 39900, label: "Trainee", requiresVerify: true },
  coresident: { amount: 29900, annual: 299000, regular: 99900, seats: 2, label: "Co-Resident" },
  pro: { amount: 59900, annual: 599000, regular: 99900, label: "Pro", popular: true },
  physician: { amount: 74900, annual: 749000, regular: 149900, label: "Physician" },
  physicianpro: { amount: 89900, annual: 899000, regular: 249900, label: "Physician Pro", premium: true },
};
const plansWith = (tiers) => ({ plans: {
  monthly: { months: 1, amount: 59900 }, annual: { months: 12, amount: 599000 },
  tiers,
  addons: { onco: { amount: 8900, label: "Physician Onco" }, clinic: { amount: 13900, label: "Extra clinic" } },
  tokens: { boost: { mt: 50000, amount: 4900 }, plus: { mt: 250000, amount: 19900, regular: 24500, popular: true }, power: { mt: 750000, amount: 49900, regular: 73500 } },
} });
const PLANS = plansWith(TIERS);

/* Sandbox with just enough DOM to render AND to click: querySelectorAll("[data-pp]") parses the
 * captured HTML back into stub elements, so wire() can bind onclick and a test can tap a card. */
function run(platform, plans) {
  let captured = "";
  // Memoised per render: wire() binds onclick on the objects it is handed, so tap() must get the
  // SAME objects back, not a fresh parse with onclick still null.
  let elsFor = "", els = [];
  function stubEls() {
    if (elsFor === captured) return els;
    const out = []; const re = /<(?:button|div|input)[^>]*data-pp="[^"]*"[^>]*>/g; let m;
    while ((m = re.exec(captured))) {
      const tag = m[0];
      out.push({ onclick: null, disabled: false, style: {}, textContent: "",
        getAttribute(k) { const mm = new RegExp(k + '="([^"]*)"').exec(tag); return mm ? mm[1] : null; } });
    }
    elsFor = captured; els = out;
    return out;
  }
  const capNode = { onclick: null, style: {}, set innerHTML(v) { captured = v; }, get innerHTML() { return captured; } };
  function node() {
    return { style: {}, firstChild: null, set innerHTML(v) { this._h = v; this.firstChild = this; }, get innerHTML() { return this._h; },
      querySelector: () => capNode, querySelectorAll: (sel) => (sel === "[data-pp]" ? stubEls() : []),
      appendChild() {}, remove() {}, addEventListener() {}, getAttribute: () => "" };
  }
  const fetchImpl = async (url) => ({
    status: 200, url, clone() { return this; },
    json: async () => (String(url).indexOf("/plans") > -1 ? (plans || PLANS) : { promo: false, pro: false }),
  });
  const win = {
    SMD_PRO: {}, SMD_API_BASE: "", ICONS: { get: () => "" }, fetch: fetchImpl,
    SMD_AUTH: { currentUser: { getIdToken: () => Promise.resolve("tok") } },
    Capacitor: platform === "ios" ? { getPlatform: () => "ios" } : undefined,
  };
  const doc = { createElement: () => node(), body: { style: {}, appendChild() {} }, addEventListener() {} };
  // SMD_AUTH is read as a bare global in the browser (the window.SMD_AUTH alias). Without it in the
  // sandbox fbUser() throws, quietly returns null, and every CTA assertion would be reading the
  // signed-out button instead of the real one.
  const fn = new Function("window", "document", "location", "setTimeout", "clearInterval", "setInterval", "history", "navigator", "ICONS", "fetch", "SMD_AUTH", SRC);
  fn(win, doc, { search: "", hash: "", pathname: "/" }, (f) => (typeof f === "function" ? f() : 0), () => {}, () => 0, { replaceState() {} }, {}, win.ICONS, fetchImpl, win.SMD_AUTH);
  const root = { win, get html() { return captured; },
    tap(pp, attr, val) {
      const el = stubEls().find((e) => e.getAttribute("data-pp") === pp && (!attr || e.getAttribute(attr) === val));
      assert.ok(el, "no [data-pp=" + pp + (attr ? " " + attr + "=" + val : "") + "] in the sheet");
      el.onclick();
    } };
  return root;
}
const settle = () => new Promise((r) => setTimeout(r, 40));
async function open(platform, plans) { const r = run(platform, plans); r.win.SMD_PRO.openPaywall(); await settle(); return r; }
// the innerHTML of the card for one tier
const card = (h, id) => (h.match(new RegExp('<button data-pp="tier" data-tier="' + id + '"[\\s\\S]*?</button>')) || [""])[0];

test("three cards by default: Pro, Physician, Physician Pro — trainee tiers are not shown", async () => {
  const h = (await open("web")).html;
  ["Pro", "Physician", "Physician Pro"].forEach((t) => assert.ok(h.includes(">" + t), "missing tier " + t));
  assert.ok(!card(h, "student"), "Trainee must not be in the default view");
  assert.ok(!card(h, "coresident"), "Co-Resident must not be in the default view");
  assert.equal((h.match(/data-pp="tier"/g) || []).length, 3, "exactly three cards");
});

test("Physician is preselected and Annual is preselected", async () => {
  const h = (await open("web")).html;
  assert.match(card(h, "physician"), /aria-pressed="true"/, "Physician card is selected");
  assert.match(card(h, "pro"), /aria-pressed="false"/);
  assert.match(h, /data-cycle="annual"[^>]*aria-pressed="true"/, "Annual segment is selected");
  assert.match(h, /data-cycle="monthly"[^>]*aria-pressed="false"/);
});

test("badges: MOST POPULAR / BEST VALUE / BEST FOR CLINICS", async () => {
  const h = (await open("web")).html;
  assert.match(card(h, "pro"), /MOST POPULAR/);
  assert.match(card(h, "physician"), /BEST VALUE/);
  assert.match(card(h, "physicianpro"), /BEST FOR CLINICS/);
});

test("the quiet link reveals Trainee and Co-Resident, and every tier stays buyable", async () => {
  const r = await open("web");
  assert.match(r.html, /I’m a student or resident/, "the self-selection link is offered");
  r.tap("showall");
  const h = r.html;
  assert.ok(card(h, "student") && card(h, "coresident"), "both revealed");
  assert.equal((h.match(/data-pp="tier"/g) || []).length, 5, "all five cards now");
  r.tap("tier", "data-tier", "student");
  assert.match(card(r.html, "student"), /aria-pressed="true"/, "a revealed tier can be selected");
  assert.ok(card(r.html, "student"), "and the revealed cards do not re-hide on repaint");
});

test("per-day hero line, both cycles, computed from the server price", async () => {
  const r = await open("web");
  // annual (the default): 749000 paise / 365 = ₹21 ; 599000 / 365 = ₹16
  assert.match(card(r.html, "physician"), /₹21 a day\. Less than a samosa, and it runs your clinic\./);
  assert.match(card(r.html, "pro"), /₹16 a day\. Less than a samosa\./);
  r.tap("cycle", "data-cycle", "monthly");
  // monthly: 74900/100/30 = ₹25 ; 59900/100/30 = ₹20
  assert.match(card(r.html, "physician"), /₹25 a day\. Less than a samosa, and it runs your clinic\./);
  assert.match(card(r.html, "pro"), /₹20 a day\. Less than a samosa\./);
  r.tap("showall");
  assert.match(card(r.html, "student"), /₹7 a day\. Less than a cup of chai\./);
  assert.match(card(r.html, "coresident"), /₹5 a day each\. Split with your co-resident\./, "2 seats: the figure is per doctor");
});

test("a KV price override moves the number and leaves the comparison word alone", async () => {
  const bumped = JSON.parse(JSON.stringify(TIERS));
  bumped.physician.amount = 119900;            // owner raises the monthly price in KV
  const r = await open("web", plansWith(bumped));
  r.tap("cycle", "data-cycle", "monthly");
  assert.match(card(r.html, "physician"), /₹40 a day\. Less than a samosa, and it runs your clinic\./);
});

test("SAVE% and the strike-through come from the server's `regular` only", async () => {
  const r = await open("web");
  // annual: regular 149900 x 12 = ₹17,988 struck; 1 - 7490/17988 = 58%
  assert.match(card(r.html, "physician"), /SAVE 58%/);
  assert.match(card(r.html, "physician"), /line-through">₹17,988/);
  r.tap("cycle", "data-cycle", "monthly");
  assert.match(card(r.html, "physician"), /SAVE 50%/);       // 749 vs regular 1499
  assert.match(card(r.html, "physician"), /line-through">₹1,499/);
});

test("no `regular` -> no strike-through and no SAVE pill (never invent a was-price)", async () => {
  const bare = JSON.parse(JSON.stringify(TIERS));
  for (const k of Object.keys(bare)) delete bare[k].regular;
  const r = await open("web", plansWith(bare));
  const cards = () => ["pro", "physician", "physicianpro"].map((id) => card(r.html, id)).join("");
  assert.ok(!/line-through/.test(cards()), "no struck price on any card");
  assert.ok(!/SAVE /.test(cards()), "no savings pill on any card");
  assert.match(card(r.html, "physician"), /₹21 a day/, "the honest per-day line still renders");
  r.tap("cycle", "data-cycle", "monthly");
  assert.ok(!/line-through/.test(cards()) && !/SAVE /.test(cards()), "monthly too");
});

test("the sticky CTA states the selected tier, price and period", async () => {
  const r = await open("web");
  assert.ok(r.html.includes("Subscribe to Physician · ₹7,490/year"), "annual CTA: " + (r.html.match(/Subscribe to [^<]*/) || []));
  assert.match(r.html, /Cancel anytime/);
  r.tap("cycle", "data-cycle", "monthly");
  assert.ok(r.html.includes("Subscribe to Physician · ₹749/month"));
  r.tap("tier", "data-tier", "physicianpro");
  assert.ok(r.html.includes("Subscribe to Physician Pro · ₹899/month"));
  r.tap("showall"); r.tap("tier", "data-tier", "student");
  assert.ok(r.html.includes("Subscribe to Trainee · ₹199/month"));
  // sticky, and last in the sheet so it pins to the bottom
  assert.match(r.html, /position:sticky;bottom:0[\s\S]*data-pp="buy"/);
});

const BENEFIT = {
  student: "Learn the examination, not just the textbook.",
  coresident: "Split it with your co-resident. Two logins, one bill.",
  pro: "The whole clinical engine, on call at the bedside.",
  physician: "Runs your clinic: queue, billing, recovery calls, and notes that think with you.",
  physicianpro: "We host it. Your records, every device, nothing to set up.",
};
const inr = (paise) => "\u20b9" + Math.round(paise / 100).toLocaleString("en-IN");
const text = (html) => html.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ");

test("every card carries its benefit line, and Physician carries the second line", async () => {
  const r = await open("web");
  r.tap("showall");
  for (const id of Object.keys(BENEFIT)) {
    assert.ok(text(card(r.html, id)).includes(BENEFIT[id]), "benefit line missing on " + id);
  }
  assert.ok(text(card(r.html, "physician")).includes("MaiK Voice Scribe writes the note, then offers the differentials worth considering."));
  // no clinical outcome claim and no invented statistic anywhere in the sheet
  assert.ok(!/readmission|mortality|complication rate|recovery rate|\d+% (more|fewer|better)/i.test(text(r.html)),
    "an outcome claim or a made-up statistic reached the sheet");
  // Assistive framing only. The AI suggests; the clinician decides. Anything stronger is untrue,
  // contradicts the App Store listing ("not a diagnostic device"), and is a patient-safety failure.
  assert.ok(!/(won’t|will not|never) miss|catches what you miss|more reliable than|diagnoses|confirms the diagnosis/i.test(text(r.html)),
    "a diagnostic or infallibility claim reached the sheet");
});

test("no card shows a rupee figure that is not derived from the plans payload", async () => {
  const r = await open("web");
  for (const cycle of ["annual", "monthly"]) {
    r.tap("cycle", "data-cycle", cycle);
    if (/data-pp="showall"/.test(r.html)) r.tap("showall");   // the link is gone once revealed
    for (const id of Object.keys(TIERS)) {
      const t = TIERS[id], annual = cycle === "annual" && !!t.annual;
      const price = annual ? t.annual : t.amount;
      const strike = t.regular > t.amount ? (annual ? t.regular * 12 : t.regular) : 0;
      const seats = t.seats || 1;
      const day = Math.round((price / 100) / seats / (annual ? 365 : 30));
      const allowed = new Set([inr(price), "\u20b9" + day.toLocaleString("en-IN")]);
      if (strike) allowed.add(inr(strike));
      const found = text(card(r.html, id)).match(/\u20b9[\d,]+/g) || [];
      assert.ok(found.length, id + " shows no price at all");
      for (const f of found) assert.ok(allowed.has(f), id + "/" + cycle + ": " + f + " is not a server figure (allowed " + [...allowed] + ")");
    }
  }
});

test("no purchase path claims a free trial the server does not give", async () => {
  const h = (await open("web")).html;
  assert.ok(!/days free/i.test(h) && !/free trial/i.test(h), "no invented trial in the CTA");
  assert.ok(!/limited time|only \d+ left|hurry/i.test(h), "no fake scarcity");
});

test("the Onco add-on is offered on EVERY tier, priced from the server, with its own per-day line", async () => {
  const r = await open("web");
  assert.match(r.html, /Oncology AI add-on/);
  assert.match(r.html, /\+₹89<[^>]*>\/month/);
  assert.match(r.html, /₹3 a day\./);
  assert.match(r.html, /Protocols, staging and toxicity are free on every plan\./);
  assert.match(r.html, /This adds the AI that reads the evidence with you/);
  r.tap("showall"); r.tap("tier", "data-tier", "student");
  assert.match(r.html, /Oncology AI add-on/, "still offered on the trainee tier");
  assert.match(r.html, /data-pp="buy-addon" data-addon="onco"/, "and still buyable");
  r.tap("tier", "data-tier", "physicianpro");
  assert.match(r.html, /Oncology AI add-on/, "and on Physician Pro");
});

test("the add-on never promises a trial unless the server sends one", async () => {
  const r = await open("web");
  assert.ok(!/-day trial/.test(r.html), "no trial claim with a plain payload");
  const withTrial = plansWith(TIERS); withTrial.plans.addons.onco.trialDays = 3;
  const r2 = await open("web", withTrial);
  assert.match(r2.html, /Everyone gets a 3-day trial first\./);
});

test("token store and the coupon field survive the redesign", async () => {
  const h = (await open("web")).html;
  assert.ok(h.includes("MaiK Token top-ups"), "token store");
  assert.ok(h.includes("pp-code"), "coupon redeem on web");
});

test("iOS hides the coupon field and offers the coming-soon CTA when StoreKit is absent", async () => {
  const h = (await open("ios")).html;
  assert.ok(h.includes("Physician Pro"), "tiers still render on iOS");
  assert.ok(!h.includes("pp-code"), "coupon field must be hidden on iOS");
  assert.ok(h.includes("Subscriptions coming soon on iOS"));
});

test("no em-dash in any app-facing string", () => {
  const ui = SRC.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.ok(!ui.includes("—"), "em-dash found in app-facing text");
});
