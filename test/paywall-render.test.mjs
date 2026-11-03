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
  addons: { onco: { amount: 8900, label: "Physician Onco" }, clinic: { amount: 13900, label: "Extra clinic" }, prep: { label: "PrepNucleus", amount: 17900, regular: 49900, annual: 149900, annualRegular: 499900, launchUntil: 1806517740000, productId: "in.stewardmd.prep.annual", monthProductId: null } },
  tokens: { boost: { mt: 50000, amount: 4900 }, plus: { mt: 250000, amount: 19900, regular: 24500, popular: true }, power: { mt: 750000, amount: 49900, regular: 73500 } },
} });
const PLANS = plansWith(TIERS);

/* Sandbox with just enough DOM to render AND to click: querySelectorAll("[data-pp]") parses the
 * captured HTML back into stub elements, so wire() can bind onclick and a test can tap a card. */
function run(platform, plans, status) {
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
    json: async () => (String(url).indexOf("/plans") > -1 ? (plans || PLANS) : (status || { promo: false, pro: false })),
  });
  const win = {
    SMD_PRO: {}, SMD_API_BASE: "", ICONS: { get: () => "" }, fetch: fetchImpl,
    SMD_AUTH: { currentUser: { getIdToken: () => Promise.resolve("tok") } },
    Capacitor: platform === "ios" || platform === "android" ? { getPlatform: () => platform } : undefined,
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
async function open(platform, plans, status) { const r = run(platform, plans, status); r.win.SMD_PRO.openPaywall(); await settle(); return r; }
// the innerHTML of the card for one tier
const card = (h, id) => (h.match(new RegExp('<button data-pp="tier" data-tier="' + id + '"[\\s\\S]*?</button>')) || [""])[0];
// A tier's words live in ONE detail block shown for the selected tier, beside the two price cards.
const tierBlock = (h, id) => (h.match(new RegExp('<div id="ppTier" data-detail="' + id + '"[\\s\\S]*?(?=<div style="height:18px">)')) || [""])[0];
const cycles = (h) => (h.match(/<div role="group" aria-label="Billing period"[\s\S]*?(?=<div id="ppTier")/) || [""])[0];
// what the doctor sees for one tier once it is chosen
function see(r, id) { r.tap("tier", "data-tier", id); return tierBlock(r.html, id) + cycles(r.html); }

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
  const r = await open("web");
  assert.match(see(r, "pro"), /MOST POPULAR/);
  assert.match(see(r, "physician"), /BEST VALUE/);
  assert.match(see(r, "physicianpro"), /BEST FOR CLINICS/);
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
  assert.match(see(r, "physician"), /₹21 a day\. Less than a samosa, and it runs your clinic\./);
  assert.match(see(r, "pro"), /₹16 a day\. Less than a samosa\./);
  r.tap("cycle", "data-cycle", "monthly");
  // monthly: 74900/100/30 = ₹25 ; 59900/100/30 = ₹20
  assert.match(see(r, "physician"), /₹25 a day\. Less than a samosa, and it runs your clinic\./);
  assert.match(see(r, "pro"), /₹20 a day\. Less than a samosa\./);
  r.tap("showall");
  assert.match(see(r, "student"), /₹7 a day\. Less than a cup of chai\./);
  assert.match(see(r, "coresident"), /₹5 a day each\. Split with your co-resident\./, "2 seats: the figure is per doctor");
});

test("a KV price override moves the number and leaves the comparison word alone", async () => {
  const bumped = JSON.parse(JSON.stringify(TIERS));
  bumped.physician.amount = 119900;            // owner raises the monthly price in KV
  const r = await open("web", plansWith(bumped));
  r.tap("cycle", "data-cycle", "monthly");
  assert.match(see(r, "physician"), /₹40 a day\. Less than a samosa, and it runs your clinic\./);
});

test("SAVE% and the strike-through come from the server's `regular` only", async () => {
  const r = await open("web");
  // annual: regular 149900 x 12 = ₹17,988 struck; 1 - 7490/17988 = 58%
  assert.match(see(r, "physician"), /SAVE 58%/);
  assert.match(see(r, "physician"), /line-through">₹17,988/);
  r.tap("cycle", "data-cycle", "monthly");
  assert.match(see(r, "physician"), /SAVE 50%/);       // 749 vs regular 1499
  assert.match(see(r, "physician"), /line-through">₹1,499/);
});

test("no `regular` -> no strike-through and no SAVE pill (never invent a was-price)", async () => {
  const bare = JSON.parse(JSON.stringify(TIERS));
  for (const k of Object.keys(bare)) delete bare[k].regular;
  const r = await open("web", plansWith(bare));
  const cards = () => ["pro", "physician", "physicianpro"].map((id) => see(r, id)).join("");
  assert.ok(!/line-through/.test(cards()), "no struck price on any card");
  assert.ok(!/SAVE /.test(cards()), "no savings pill on any card");
  assert.match(see(r, "physician"), /₹21 a day/, "the honest per-day line still renders");
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
    assert.ok(text(see(r, id)).includes(BENEFIT[id]), "benefit line missing on " + id);
  }
  assert.ok(text(see(r, "physician")).includes("MaiK Voice Scribe writes the note, then offers the differentials worth considering."));
  // no clinical outcome claim and no invented statistic anywhere in the sheet
  assert.ok(!/readmission|mortality|complication rate|recovery rate|\d+% (more|fewer|better)/i.test(text(r.html)),
    "an outcome claim or a made-up statistic reached the sheet");
  // Assistive framing only. The AI suggests; the clinician decides. Anything stronger is untrue,
  // contradicts the App Store listing ("not a diagnostic device"), and is a patient-safety failure.
  assert.ok(!/(won’t|will not|never) miss|catches what you miss|more reliable than|diagnoses|confirms the diagnosis/i.test(text(r.html)),
    "a diagnostic or infallibility claim reached the sheet");
});

const SPEND = {
  monthly: { student: "Less than a pizza.", coresident: "Less than one movie ticket, split two ways.",
    pro: "Less than a movie night with the family.", physician: "Less than one dinner out.",
    physicianpro: "Less than a tank of petrol." },
  annual: { student: "Less than a pair of good shoes.", coresident: "Less than one weekend away, for the two of you.",
    pro: "Less than one family holiday weekend.", physician: "Less than one family dinner a month.",
    physicianpro: "Less than a new phone, and it runs your clinic for a year." },
};

test("the everyday-spend line comes from the map and differs between yearly and monthly", async () => {
  const r = await open("web");
  r.tap("showall");
  for (const cycle of ["annual", "monthly"]) {
    r.tap("cycle", "data-cycle", cycle);
    for (const id of Object.keys(SPEND[cycle])) {
      const c = text(see(r, id));
      assert.ok(c.includes(SPEND[cycle][id]), cycle + "/" + id + " spend line missing: " + JSON.stringify(c.slice(0, 160)));
    }
  }
  for (const id of Object.keys(SPEND.annual)) {
    assert.notEqual(SPEND.annual[id], SPEND.monthly[id], id + ": the yearly and monthly lines must differ");
    // and the card really did change when the cycle did
    assert.ok(!text(see(r, id)).includes(SPEND.annual[id]), id + ": the monthly card still shows the yearly line");
  }
  // one sentence, no figure of its own: the only rupee amounts on a card are the server's
  for (const id of Object.keys(SPEND.annual)) {
    assert.ok(!/[\u20b90-9]/.test(SPEND.annual[id] + SPEND.monthly[id]), id + ": a spend line quotes a number");
  }
  assert.match(r.html, /Less than a coffee\./, "the add-on carries its own line");
});

test("a tier with no spend line renders nothing rather than borrowing one", async () => {
  // `founding` is in no TIER_SPEND cycle: it must render with no comparison sentence at all.
  const extra = JSON.parse(JSON.stringify(TIERS));
  extra.founding = { amount: 39900, annual: 399000, label: "Founding Doctor" };
  const r = await open("web", plansWith(extra));
  const c = text(tierBlock(r.html, "founding"));
  for (const line of [...Object.values(SPEND.annual), ...Object.values(SPEND.monthly)]) {
    assert.ok(!c.includes(line), "an unmapped tier borrowed: " + line);
  }
  assert.ok(text(see(r, "physician")).includes(SPEND.annual.physician), "mapped tiers unaffected");
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
      const allowed = new Set([inr(price), "\u20b9" + day.toLocaleString("en-IN"), inr(t.amount)]);
      if (t.annual) { allowed.add(inr(t.annual)); allowed.add(inr(Math.round(t.annual / 12))); }
      if (strike) allowed.add(inr(strike));
      const found = text(see(r, id)).match(/\u20b9[\d,]+/g) || [];
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

test("FIX 1: the headline says what the doctor gets, not a generic upgrade line", async () => {
  const h = (await open("web")).html;
  assert.ok(h.includes("MaiK writes your notes while you see patients."), "concrete headline");
  assert.ok(!/Choose your plan|Go Pro|Unlock everything|Upgrade to Pro/.test(text(h)), "no generic upgrade headline left");
});

test("hero shows the habit (a streak grid of the plan's work) and icon benefits, no sparkle", async () => {
  const h = (await open("web")).html;
  assert.ok(h.includes('id="ppHero"'), "outcome hero renders");
  for (const line of ["NOTES MAIK DRAFTED", "4 months ago", "Today"]) assert.ok(text(h).includes(line), "hero line missing: " + line);
  assert.equal((h.match(/aspect-ratio:1\/1/g) || []).length, 120, "20 x 6 streak squares");
  assert.ok(h.includes('id="ppBenefits"'), "benefit row renders");
  for (const b of ["Voice scribe", "Smart OPD queue", "FollowCare recalls"]) assert.ok(text(h).includes(b), "benefit missing: " + b);
  assert.ok(!/ppIco\("(spark|crown|star)"\)/.test(SRC), "no sparkle / crown / star icon is rendered by the sheet");
  assert.ok(!/gradient|glow|blur\(/.test(h), "no gradient, glow or backdrop blur in the sheet");
});

test("the student button is a real button and takes the doctor straight to the Trainee price", async () => {
  const r = await open("web");
  assert.match(r.html, /<button data-pp="showall"[^>]*>[\s\S]*I\u2019m a student or resident[\s\S]*See your price/, "a full button, not a footnote link");
  r.tap("showall");
  assert.match(card(r.html, "student"), /aria-pressed="true"/, "Trainee is selected");
  assert.ok(r.html.includes("Subscribe to Trainee \u00b7 \u20b91,990/year"), "CTA moved to the trainee price");
  assert.match(r.html, /data-roll="annual" data-to="199000"/, "price carries its roll target");
});

test("the hero follows the plan: residents see antibiotic decisions, drugs and the antibiogram", async () => {
  const r = await open("web");
  r.tap("showall"); r.tap("tier", "data-tier", "student");
  const t = text(r.html);
  assert.ok(t.includes("Make residency the easy part."), "resident headline");
  assert.ok(t.includes("YOUR LEARNING STREAK"), "a resident sees a learning habit");
  for (const b of ["Antibiotic decisions", "Learn drugs", "Local antibiogram"]) assert.ok(t.includes(b), "benefit missing: " + b);
  r.tap("tier", "data-tier", "physicianpro");
  assert.ok(text(r.html).includes("Your whole clinic, hosted for you."));
  assert.ok(r.html.includes('src="/logo.png"'), "StewardMD logo in the hero");
});

test("one clear plan: tier chips carry only the name; the two price cards carry the price", async () => {
  const r = await open("web");
  assert.ok(!/\u20b9/.test(card(r.html, "pro")), "a tier chip shows no price");
  const c = cycles(r.html);
  assert.match(c, /data-cycle="annual"[^>]*aria-pressed="true"/);
  const flat = text(c).replace(/\s+/g, "");
  assert.ok(flat.includes("\u20b97,490/yr") && flat.includes("\u20b9624/mo") && flat.includes("\u20b9749/mo"), flat);
  // yearly vs twelve months, both current server prices: 1 - 7490/8988 = 17%
  assert.match(c, /Save 17%/);
});

test("during the launch promo the CTA line states the real price afterwards and when", async () => {
  const until = Date.UTC(2026, 5, 30, 12, 0, 0);
  const dateTxt = new Date(until).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const r = await open("web", undefined, { promo: true, pro: false, promoUntil: until });
  assert.ok(text(r.html).includes("then \u20b917,988/year from " + dateTxt + ". Cancel anytime."), text(r.html).slice(-400));
  r.tap("cycle", "data-cycle", "monthly");
  assert.match(r.html, /then \u20b91,499\/month from /);
  const bare = JSON.parse(JSON.stringify(TIERS));
  for (const k of Object.keys(bare)) delete bare[k].regular;
  const r2 = await open("web", plansWith(bare), { promo: true, pro: false, promoUntil: until });
  assert.match(r2.html, /then \u20b97,490\/year from /);
  const r3 = await open("web");
  assert.ok(!/then \u20b9/.test(r3.html), "afterwards line must not render outside the promo");
});

test("one accent: app tokens only, no borrowed lime/forest colours, no gold/green badges", async () => {
  const h = (await open("web")).html;
  assert.ok(!h.includes("--gold") && !h.includes("--green"), "no gold badge and no green pill/banner left");
  assert.ok(!/d6ee8f|1f3a32/i.test(h), "no colour copied from the reference paywall");
});

test("the payment line names only the store of the build: Google Play on Android, none on web", async () => {
  const a = (await open("android")).html;
  assert.ok(text(a).includes("Secure payment via Google Play"), "android names Google Play");
  const w = (await open("web")).html;
  assert.ok(!/Secure payment via/.test(w), "web shows no payment-provider line");
  assert.ok(!/PhonePe|netbanking/.test(a + w), "no PhonePe line anywhere");
});

test("PrepNucleus add-on: for students and residents, anyone can buy, server prices with the server's struck regular", async () => {
  const r = await open("web");
  const card = (r.html.match(/<div id="ppPrep"[\s\S]*?<\/button><\/div><\/div>/) || [""])[0];
  const t = text(card).replace(/\s+/g, " ");
  assert.ok(t.includes("PrepNucleus add-on") && t.includes("For students and residents. Anyone can add it."), t);
  assert.match(card, /data-pp="prep" data-plan="month"/);
  assert.match(card, /data-pp="prep" data-plan="year"/);
  assert.ok(/\u20b9179/.test(t) && /line-through">\u20b9499</.test(card), "Rs 179 a month, Rs 499 struck");
  assert.ok(/\u20b91,499/.test(t) && /line-through">\u20b94,999</.test(card), "Rs 1,499 a year, Rs 4,999 struck");
  r.tap("showall"); r.tap("tier", "data-tier", "pro");
  assert.match(r.html, /id="ppPrep"/, "offered on every plan, not only to trainees");
  // no regular from the server -> nothing struck
  const bare = plansWith(TIERS); delete bare.plans.addons.prep.regular; delete bare.plans.addons.prep.annualRegular;
  const r2 = await open("web", bare);
  assert.ok(!/line-through">\u20b9(499|4,999)</.test(r2.html), "never an invented was-price");
});

test("PrepNucleus monthly is hidden on iOS until its store product exists", async () => {
  const h = (await open("ios")).html;
  assert.ok(!/data-plan="month"/.test(h), "no monthly button on iOS without a monthly product id");
});
