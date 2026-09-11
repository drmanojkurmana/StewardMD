---
tags: [module, clinical, prescription]
status: live
flag: smd_rxchoice (default-on, dev/testing posture)
---
# RxChoice™ — Same Prescription. Smarter Price.

An **opt-in cost layer on top of a FINISHED prescription**. The doctor writes the prescription as
always; RxChoice then shows products from the StewardMD Drug Database carrying **the same therapy** at
four price points, and writes back **only the BRAND field**, only on an explicit tap.

«AI interprets. Database provides products. Rules validate. Doctor decides.»

## Key files
- `rxchoice-flags.js` (`window.SMD_RXCHOICE_FLAGS`) — 5 flags, `queue-flags.js` pattern
- `rxchoice-core.js` (`window.SMD_RXCHOICE`) — **PURE**: normalize → match → price → rank. Dual
  export (plain `.js`, so `build-www.sh`'s `*.js` loop bundles it, and node tests `require()` it)
- `rxchoice-ui.js` (`window.SMD_RXCHOICE_UI`) — the panel; the ONLY file that touches MEDAPI or DOM
- `prescription.js` — `rxcOn()`, `openRxChoice()`, `rxcPrintSection()`, the `#rxcOpen` button
- `opd-emr.js` — `rxcAvailable()`, `rxcButton()`, `rxcLines()`, `openRxChoice(st)`, act `rx-rxchoice`
- `test/rxchoice-core.test.mjs` (15 tests) · `test/run-rxchoice-ui.mjs` (CDP harness, 30 checks)

## One product truth
RxChoice consumes **`window.MEDAPI` only** — the same Drug Database that powers the Drug Index, with
`offline-db.js` routing the same calls to the on-device SQLite copy when the API is unreachable
(identical record shape, so online and offline results are the same). There is **no RxChoice brand
list, no second dataset, and no AI brand generation.** Every product on a card is a database row:
`{ id, brand, composition, class, manufacturer, mrp, form, pack, discontinued }`.

## THE CONSTRAINT THAT SHAPES THE WHOLE FEATURE
`composition` carries per-ingredient strengths **only sometimes**. The live database holds BOTH:

| composition | brands | strength lives in |
|---|---|---|
| `Amoxycillin (500mg) + Clavulanic Acid (125mg)` | 845 | the composition |
| `Amoxycillin + Clavulanic Acid` | 5795 | the **brand name** ("Augmentin 625 Tablet") |

So strength can never be assumed. Eligibility is gated on strength **certainty**, as a
provenance-tagged `strengthKey`:
- `comp:amoxycillin=500mg|clavulanic acid=125mg` — from the composition's parentheses
- `brand:625mg` — from the brand name, and only when the composition carries no strengths at all

Two products match only when the keys are **identical**, and a `comp:` key **never** matches a
`brand:` key. A product whose strength cannot be established either way **is not shown**. That is the
spec's "when uncertain, no substitution", enforced in code rather than promised in a comment.

## Eligibility (all must hold; checked in this order)
1. same active-ingredient **set** (order-independent, so a combination never matches one ingredient)
2. same **dosage-form family** (`normalizeForm`: tablet ≠ liquid ≠ injection ≠ inhaler)
3. same **release** characteristics (`releaseKey`: IR ≠ SR/XR/CR/ER/MR; "Extended Release" == "XR")
4. same **strengthKey**, non-empty, same provenance
5. **on the market** (`discontinued` excluded)
6. a readable **price and pack** (else it cannot be offered as a cost option)

Form/release are checked before strength deliberately: both are cheaper to establish and give the
reason a doctor can act on (a tablet-vs-syrup mismatch should not report "unknown strength").

## Never substituted on price (`restricted()`)
Warfarin/acenocoumarol · digoxin · lithium · antiepileptics · ciclosporin/tacrolimus/sirolimus/
mycophenolate · levothyroxine · theophylline · clozapine · **insulins** · **biologics** (`*mab`,
`*cept`, epoetin, filgrastim, heparins…) — plus any **inhaler** or **transdermal** form, where the
device and release kinetics are part of the prescription. These return `blocked:true` with a reason;
no cheaper card is shown.

## Price = course cost, never pack MRP
`requiredQuantity(line)` = unitsPerDose × dosesPerDay(freq) × days(duration); **null** (so nothing is
priced) when any of the three is missing or the line is SOS/PRN. Then `courseCost()`:
- **countable oral solids** (tablet/capsule) → **unit dispensing**: an Indian pharmacy cuts a strip, so
  a 20-tablet pack at ₹150 costs **₹75** for a 10-tablet course. A bigger pack can be the cheaper course.
- **indivisible packs** (vial, bottle, tube, inhaler) → **whole packs**, and the leftover is real waste.

Both figures are always returned (`courseCost` under the model that applies, `wholePackCost` always)
plus `dispensing:"unit"|"pack"`, so the UI never has to assume which it is looking at. Missing MRP or
an unreadable pack → **"Price unavailable"**, never a guess.

> The spec's §10 is self-contradictory here — it gives both ₹150 (`ceil(qty/pack) × packPrice`) and
> ₹75 for the same example. The unit-dispensing reading is the one that matches both its headline
> number and an Indian pharmacy counter. See [[Decisions]].

## The four cards
| Card | Rule |
|---|---|
| **GENERIC** · Lowest Cost | lowest eligible `courseCost`, tie-break brand name |
| **BALANCED ⭐** · Recommended Value | highest `valueScore`; weights `price .55 / manufacturer .30 / packFit .15`, configurable via `choose(rx, cands, {weights})` |
| **PREMIUM** · Top Branded Option | highest manufacturer tier; price is a tie-break **inside** the tier, never a claim |
| **DOCTOR PRESCRIBED** · Original Choice | the doctor's own product. Always returned, never filtered, never replaced — it survives a blocked line, an empty result and an unpriceable line |

Not in the value score, on purpose: **clinical match** (every candidate is already an exact match, so
it is constant and would only dilute the weights) and **availability** (a hard filter, not a penalty).
Manufacturer tiers **mirror `worker/src/index.js` TIERS and `offline-db.js` TIERS exactly** — keep the
three in step; RxChoice must not hold a second opinion on "established manufacturer".

**Balanced may coincide with Generic or Premium.** That is reported (`balanced.sameAs`) and the card
says "also the lowest cost", rather than forcing in a product the score ranked lower.

## What it never does
Never changes drug, dose, frequency, duration or route. Never writes anything without a tap. Never
hides the doctor's product. Never invents a brand, manufacturer, pack, price or availability. AI is
**not in the decision path at all** — `smd_rxchoice_ai_normalization` is **def:false**, and even on it
may only normalize free text *before* the deterministic lookup; eligibility, matching, pricing and
ranking stay deterministic whatever it says.

## Entry points
- **Prescription pad** (`prescription.js`): `RxChoice™` button beside Sign & Export. SELECT writes that
  line's brand input; the choice is kept on `sheet._rxChoice` and printed as a separate
  **RxChoice™ section** under the unchanged conventional prescription (`smd_rxchoice_pdf`).
- **OPD consult** (`opd-emr.js`): a button on the medications tab (GHIS + clinic) and in the
  post-consult panel. Lines come from the plan's `Rx:` lines → `st.medications` → the clinic store →
  `st.medDraft`. It writes **nothing** back: OPD medication write-back is server-gated
  (`QUEUE_EMR_WRITE`, PRESCRIBE server-blocked), so the choice is recorded and shown, and the doctor
  changes the order themselves.

In OPD a medication is one text string, which is also the product name, so it is passed as **both**
drug and brand — the brand-name endpoint is what resolves it to a database row.

## Audit trail
`SMD_RXCHOICE_UI.audit()` → localStorage `smd_rxchoice_audit` (cap 200), entries from
`CORE.auditEntry()`: original product, alternative, category, reasonShown, priceAtTime,
courseCostAtTime, doctorApproved, patientSelected, timestamp. **Products and prices only, no PHI.**
The original product is a field of its own, so recording a selection can never lose it.

## Gotchas
- **The pad seeds an ADVICE row** ("Lifestyle & general measures") ABOVE the drug rows, and an advice
  row carries a `[data-f="drug"]` input of its own. A bare `querySelector('[data-f="drug"]')`
  addresses the ADVICE row, not the first drug. Scope to `.rx-line:not(.adv)` — this cost a full
  harness debug cycle. `openRxChoice()` skips `.adv` rows correctly.
- **A line with no brand cannot be compared.** Without a brand there is no prescribed product and no
  strength provenance, so the card says "Pick a brand on this line first" rather than guessing.
- `build-www.sh` never copied root `*.mjs`, so the app's `import("/rx-build.mjs")` was unresolvable
  inside the native bundle. Fixed alongside this work (RxChoice itself is plain `.js`, deliberately).

## Not in the MVP (Phase 2/3)
Pharmacy availability and live prices, location-based search, patient selection
(`smd_rxchoice_patient_selection` def:false — a patient must never introduce a product the doctor did
not approve), refill savings, prescription economics and analytics.
