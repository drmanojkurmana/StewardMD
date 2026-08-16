# StewardMD — Go-To-Market & Growth Strategy (v1)

*Owner's brief: finalise pricing + marketing as a CRO / PMM / CA / MBA / SEO lead, fix any gaps, and lay out the plan to start product growth. Companion to `PRICING_PACKAGING.md` (the money) — this is the engine that fills it.*

Date: 2026-08-17 · Horizon: next 12 months · 🔧 = tunable

---

## 0. Verdict on the pricing (CRO review)

The pricing is **structurally correct and launch-ready.** The margin discipline (every tier's price > 30× its daily AI cap) is exactly right, the Free→₹199→₹599→₹1,499 ladder is clean, and metering AI by rupee-cost (not count) is the design most competitors get wrong. **Do not re-open the numbers.** Six revenue-leak fixes below (§1) are additive, not rewrites.

The one thing that will make or break growth is **not the price — it's distribution.** A clinical-decision product for Indian doctors wins on community trust + organic search, not ad spend. The whole plan is built around that.

---

## 1. Six pricing fixes before launch (all additive)

1. **Trial takes no card.** Card-required trials cut activation 60–80%. Start Free-with-Pro-trial on sign-up; auto-drop to Free at day 14/7 (never lock out). → more trials, more habit, more conversion.
2. **Founding-Doctor offer (land grab + urgency).** First **500** verified doctors: **Pro for ₹399 for the whole year** (~₹33/mo). AI is a **fixed annual budget — ₹120 + one ₹120 refill = ₹240/yr ceiling** (no daily reset; then pay-go credits), so we profit even at full burn (₹399 − ₹8 fees − ₹240 AI = ₹151, ~38% margin) — a controlled acquisition loss-leader, not an open-ended one. Public countdown ("312 of 500 founding seats left"). Uses the built coupon + credits engine.
3. **Referral loop (viral coefficient).** Refer a doctor → **both get ₹150 AI credits** (or 1 free Pro month) when the referee activates. Runs on the credits engine already shipped. Doctor networks are dense (units, batches, colleges) → this is the cheapest CAC we have.
4. **Annual framing, not just a number.** Show "**₹4,999/yr — that's ₹416/mo, 2 months free**" with monthly struck through. Annual plans cut churn ~2× and pull cash forward.
5. **GST + invoicing.** B2C prices shown **inclusive of GST** (India expects the sticker to be final). B2B **ex-GST + GST invoice** (hospitals reclaim it). Add GSTIN capture at hospital checkout. CA note: register for GST before first paid rupee; SaaS to Indian customers = 18% GST.
6. **In-app upgrade nudges at the cap.** When a doctor hits the daily AI cap or an imaging limit, the `429 ai-cost-cap` sheet (built) is the highest-converting upsell surface — show "you're clearly getting value; Pro removes this" with one-tap upgrade. This is where freemium actually monetises.

---

## 2. Positioning (PMM)

**Category we own:** *the clinical operating layer for doctors and hospitals* — not "an AI scribe," not "a drug app." Everything from thinking through a case → deciding → documenting → the patient record → follow-up → hospital workflow, with AI woven through.

**One-liner:** "StewardMD is where a doctor thinks, decides, and runs care."

**Message ladder (from pricing v2):** Think (Free) → Learn (Student) → Practice (Pro) → Practice without limits (Ultimate) → Run care (Hospital).

**Why we win vs. the field:** competitors sell a single feature (scribe, or calculators, or an EMR). We are the only product where the *reasoning engine* is free and native, on-device voice is free to serve, and the same account scales from a lone resident to a 500-bed hospital. That breadth is the moat — lead with it.

---

## 3. Ideal customers (ICP) & the land-and-expand motion

| Segment | Who | Wedge | Monetisation |
|---|---|---|---|
| **A. Residents / PG trainees** | MD/MS/DNB, interns | Free clinical engine + Student ₹199 + Co-Resident ₹299 | Volume + virality; they carry us into hospitals |
| **B. Practising physicians / intensivists** | Attendings, clinic owners | Pro ₹599 (workflow, scribe, imaging) | Core B2C revenue |
| **C. Hospitals 50–500 beds** | Med colleges, district/corporate | Doctors already using it inside → institution coupon → seats | The revenue tier (high ACV) |

**The motion is PLG → sales-assist:** win individual doctors free/cheap, watch which hospitals light up (admin analytics shows active doctors per org), then land the hospital deal where adoption already exists. Institution coupons are the bridge.

---

## 4. Acquisition channels, ranked by fit & CAC

1. **Community / word-of-mouth (₹0–50 CAC) — primary.** Resident WhatsApp/Telegram groups, batch groups, PG-prep communities, ward units. Seed the *free reasoning engine + calculators* (not the AI). Arm the Founding-Doctor + referral offers here first.
2. **ASO — App/Play Store (₹0 CAC, high intent).** Doctors search "MELD calculator," "antibiotic dose," "drug interaction checker," "ECG interpretation." Optimise title/subtitle/keywords/screenshots around these. Each free tool is an install magnet.
3. **SEO / programmatic content (compounding, near-zero marginal CAC) — the long-term moat.** See §5.
4. **Medical colleges & KOLs.** Free institutional access for a department in exchange for feedback + a testimonial; CME talks; a professor's endorsement converts a whole batch.
5. **Referral loop (§1.3).** Turns every happy doctor into a channel.
6. **Conferences / associations** (API, ISCCM, IMA state chapters) — booth + workshop; direct hospital pipeline.
7. **Paid (Google/Meta) — last, and small.** Doctors are an expensive, hard-to-target audience (CAC ₹500–1,500+). Only spend once organic proves the funnel and on retargeting warm traffic. Never lead here.

---

## 5. SEO engine (the compounding moat — SEO + CA lens)

We have a KB, a drug database, calculators, guideline summaries, and disease briefs. That is a **programmatic-SEO goldmine** — thousands of pages doctors already Google.

**Prerequisite (blocker to fix first):** the app is behind the coming-soon gate (`_middleware.js` 503s `/api/*`; app at `/realapp`). SEO needs **public, indexable marketing/content pages** that live *outside* the gate, each with an "Open in app / Download" CTA. Ship a public content subtree (e.g. `stewardmd.in/learn/*`, `/drugs/*`, `/calculators/*`, `/guidelines/*`) that is crawlable.

**Page clusters (programmatic):**
- Drug pages: `/drugs/<drug>` — dosing, renal adjustment, interactions (from the drug DB).
- Interaction pages: `/interactions/<a>-<b>`.
- Calculator pages: `/calculators/<name>` — with the live calculator + explainer.
- Disease/guideline briefs: `/learn/<condition>` — from KB + Medical Updates.
- Antibiotic/syndrome pages: `/antibiotics/<syndrome>`.

**Why it compounds:** each page ranks for a high-intent clinical query → a doctor lands mid-decision → installs the app to finish. Marginal cost ≈ ₹0; the library only grows. Target **🔧 500 pages in 90 days, 5,000 in 12 months.**

**Technical SEO checklist:** SSR/static HTML (not JS-gated), schema.org `MedicalWebPage`/`Drug`, fast LCP, canonical URLs, internal linking between related pages, sitemap, E-E-A-T signals (author = verified clinicians, references, last-reviewed date). *Never* auto-generate clinical claims without a reviewed source (accuracy = the brand).

---

## 6. Unit economics (CA / MBA)

Rough, 🔧 refine with real data:

| Metric | Pro ₹599 (typical use) |
|---|---|
| Revenue/mo | ₹599 |
| AI COGS (typical) | ₹40–120 |
| Payment fees (~2%) | ₹12 |
| Gross margin | **~80%** |
| Assumed avg retention | 🔧 18 months |
| **LTV** (₹599 × 80% × 18) | **~₹8,600** |
| Target blended CAC | < ₹2,000 → **LTV:CAC > 4** |

- **AI COGS as % of revenue:** the daily rupee caps hold this **< 25%** even at worst case — the reason the model can't go bankrupt.
- **Hospital ACV (illustrative):** Community/Pro ≈ ₹1.3L/yr; Secondary/Ultimate ≈ ₹5.8L/yr. One mid hospital = ~1,000 Pro-doctor-months. **B2B is where the money compounds.**
- **Rule:** organic/referral CAC must stay < 1 month of revenue; paid CAC < 4 months (LTV:CAC ≥ 3). Cut any channel that breaches it.

---

## 7. Funnel & the metrics that matter

**North-star:** **Weekly Active Clinicians who complete a clinical action** (a differential, a dose check, a case, a MaiK answer) — usage that predicts retention + conversion, not vanity installs.

| Stage | Metric | 🔧 Launch target |
|---|---|---|
| Acquire | Installs / signups / week | — |
| Activate | % who complete a clinical action in 24h | > 40% |
| Engage | D7 / D30 retention | 35% / 20% |
| Convert | Free → paid | 4–6% |
| Expand | Trial → paid | > 25% |
| Refer | Viral coefficient (k) | > 0.3 |
| B2B | Hospitals in pipeline / closed | — |
| Health | Gross margin, AI COGS % | > 75%, < 25% |

Instrument all of it — the AI Control Center + analytics are already built; add a simple funnel dashboard.

---

## 8. The 90-day launch plan (then scale)

**Phase 0 — Pre-launch (Weeks 0–2): make it chargeable & findable**
- Wire final prices + role caps + Physician-Onco SKU into env; do a real payment test-purchase (PhonePe/Razorpay). Then and only then flip enforcement.
- Stand up the public content subtree outside the coming-soon gate (SEO prerequisite) + 50 seed pages.
- ASO pass (titles/keywords/screenshots). Set up analytics funnel + referral + Founding-Doctor coupon.

**Phase 1 — Soft launch (Weeks 2–6): prove activation & the loop**
- Release to 🔧 3–5 resident communities + 1–2 friendly med-college departments (free institutional access).
- Turn on referral + Founding-Doctor offer. Watch activation, D7, trial→paid weekly; fix the biggest drop-off.
- Collect 10–20 testimonials/case stories (fuel for everything later).

**Phase 2 — Organic scale (Weeks 6–12): content + PLG→B2B**
- SEO engine to 🔧 500 pages; publish weekly clinical content; start ranking.
- KOL talks / CME. First **hospital pilots** where doctor adoption is already high (use org analytics to pick them) — land via institution coupons, convert to seat deals.
- Launch annual plans + win-back/dunning for early churn.

**Phase 3 — Growth (Months 4–12)**
- Scale hospital sales (dedicated motion; case studies from pilots). Programmatic SEO to thousands of pages.
- Introduce measured paid acquisition only on channels with proven LTV:CAC ≥ 3.
- Expand modules as they clear clinical sign-off (FundX/KardioX/ThoreX/SknX) → each is a new upgrade trigger + PR moment.

---

## 9. Top risks & mitigations

| Risk | Mitigation |
|---|---|
| App gated → SEO can't index | Public content subtree outside the gate (§5) — do this first |
| Student tier cannibalises Pro | Hard NMC-trainee/college verification for ₹199 |
| Clinical accuracy / trust damage | Every SEO/AI claim cited from a reviewed source; safety never paywalled; "last reviewed by" bylines |
| Doctor CAC via paid is high | Lead organic/referral; paid only after LTV:CAC proven |
| AI cost spike / abuse | Rupee caps + credits + abuse watchlist (all built) |
| Regulatory (CDSCO/telemedicine/DPDP) | Position as decision *support*, never diagnosis; consent + 7-day retention already built; GST/DPDP compliance |
| Long B2B sales cycles | PLG wedge first (coupons) so revenue isn't hostage to enterprise deals |

---

## 10. Immediate next actions (this week)

1. **Approve the six pricing fixes (§1)** — say yes/no to each; I wire the coupon/referral/Founding-Doctor SKUs (all on the built engine).
2. **Green-light the public content subtree** (SEO prerequisite) — I scope it.
3. **Confirm trial cutover date** (Sep 15 vs 25) and Founding-Doctor cap (5,000?).
4. **Do the payment test-purchase**, then flip enforcement.
5. Pick the **first 3–5 launch communities + 1 college department**.

Everything commercial (roles, caps, credits, coupons, pooling, IAP, admin) is already built and inert. Growth is now a distribution problem, and this is the plan to solve it.
