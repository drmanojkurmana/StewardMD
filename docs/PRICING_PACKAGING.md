# StewardMD — Pricing & Packaging (v2 FINAL)

*Signed-off commercial model. v1 was the first draft; v2 folds in the pricing review (raise Pro/Ultimate, cut the AI caps so revenue always exceeds max AI exposure, platform+seats for hospitals, don't compete on cheapness) plus the founder's two calls: (a) monetize Oncology as a **Physician Onco** add-on at **+₹89/mo**, keeping only disease reference + staging free; (b) hold the ladder Free → ₹199 → ₹599 → ₹1,499.*

Date: 2026-08-17 · Applies to: mobile app (iOS/Android) + web · 🔧 = still tunable

---

## 1. Principles

1. **Free = cheap-to-serve + habit-forming + safety.** Deterministic/on-device tools cost ≈₹0 and are the daily-habit + word-of-mouth engine. They stay free — acquisition, not lost revenue.
2. **Paid = expensive-to-serve OR team-scale.** Charge where we spend money (AI text, imaging, server polling) or where value is multi-user (ICU, OPD, Connect, FollowCare).
3. **Meter AI by RUPEE COST, not count** (built). A text answer ≈₹0.03; an imaging read ≈₹0.40 (13×). The rupee cap is the bankruptcy-proof design.
4. **Every tier's price must exceed its maximum AI exposure.** Non-negotiable: `price − (daily cap × 30)` is positive gross contribution *before* the doctor ever touches credits.
5. **B2C is the funnel; hospitals are the revenue.** Individual tiers capture doctors; hospitals monetize the team stack.
6. **Never hard-block a safety warning.** Interactions, renal/hepatic/QT, critical-value alerts are never paywalled mid-use.
7. **Don't compete on cheapness.** Positioning = "the clinical operating layer for doctors and hospitals," not "cheap AI scribe."

---

## 2. Cost reality (the math the caps are built on)

`functions/_ai_usage.js`, ₹ per 1,000 tokens:

| Action | Approx cost to us |
|---|---|
| MaiK quick answer | ₹0.03 |
| MaiK deep review | ₹0.08 |
| Research / evidence | ₹0.10–0.15 |
| Patient summary | ₹0.09 |
| **Imaging read** (FundX/KardioX/ThoreX/SknX/OCR) | **₹0.35–0.50 each** |
| Voice / Scribe (on-device Whisper) | **₹0.00** |
| KB search, calculators, drug DB, reasoning | ₹0.00 |

Every individual tier below now clears the margin test in Principle 4.

---

## 3. FREE forever (the hook)

- Clinical **reasoning engine** — differential dx, confidence, explainability, workspace.
- **Antibiotic engine** + AWaRe + antibiogram (view) + treatment-failure wizard.
- **Full drug database + all safety checks** (interactions, QT, renal, bleeding). *Safety = never blocked.*
- **All calculators** + electrolytes + renal dosing + basic insulin dosing.
- **Knowledge Base** + guidelines + offline clinical + Medical Updates.
- **Specialty workspaces** (ENT, Ophtho, Peds, Surgery, Uro, Ob-Gyn, Dental).
- **Oncology reference & safety tools** — disease/KB reference, AJCC/TNM staging, CTCAE toxicity grading, IO toxicity (irAE), RECIST 1.1, onco drug info + interactions (the treatment-planning workflow is the Physician Onco add-on, §5).
- **My Cases** (save, 🔧 cap 10) + de-identified case share.
- **Personal Clinic EMR** — on-device, encrypted, 🔧 1 device (sync is Pro).
- Steward ID / NMC verification / onboarding / support.
- **Daily taste of MaiK** — 🔧 ₹0.50/day (~15 text answers) + 🔧 3 OCR scans/day.

**Not free:** imaging AI, Scribe, Patient Summary, Research beyond taste, cross-device sync, Lab Watch, most oncology, and all team/hospital.

---

## 4. INDIVIDUAL plans (B2C — web + app) — FINAL

Ladder: **Free → Student ₹199 → Pro ₹599 → Ultimate ₹1,499.**

| | **Free** | **Student** | **Co-Resident** | **Pro** ⭐ | **Ultimate** |
|---|---|---|---|---|---|
| **Monthly** | ₹0 | **₹199** | **₹299** (2 accts) | **₹599** | **₹1,499** |
| **Annual** 🔧 | — | ₹1,999 | ₹2,999 | ₹4,999 | ₹14,999 |
| **AI cost cap/day** | ₹0.50 | ₹5 | ₹6 pooled | **₹10** | **₹25** |
| **Max AI exposure/mo** | ₹15 | ₹150 | ₹180 | ₹300 | ₹750 |
| **Gross contribution** | — | ~₹45 | ~₹119 | **~₹299** | **~₹749** |
| MaiK (all text modes) | taste | ✅ | ✅ pooled | ✅ | ✅ |
| Scribe (voice→EMR) | ❌ | ✅ | ✅ | ✅ | ✅ |
| Patient Summary | ❌ | ❌ | ❌ | ✅ | ✅ |
| Research / evidence | taste | educational | 10/day | 10/day | unlimited* |
| **Imaging AI reads/day** | ❌ | ❌ (Learn atlas only) | **4/day each** | **5/day** | **20/day / fair-use** |
| Priority reasoning model (2.5-pro) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Cross-device sync + Lab Watch + wearable | ❌ | ❌ | ❌ | ✅ | ✅ |
| Earliest access (FundX/KardioX/ThoreX/SknX) | ❌ | ❌ | ❌ | ❌ | ✅ |

\*subject to the daily rupee cap. Over any cap → **buy credits** (₹50→₹25, built), upgrade, or wait for midnight reset. No hard lockout, ever.

**Who:** Student = verified trainee (NMC-trainee/college proof required, so attendings can't take the cheap tier). Co-Resident = two trainees, one shared AI pool (built) — "split StewardMD with your co-resident." Each account gets **4 imaging reads/day**; total cost is still governed by the shared ₹6/day pool (heavy imaging days consume the pool and can be topped up with credits), so cost stays capped.

**Trial:** 🔧 14 days (started ≤ cutover) / 7 days after. Built; `TRIAL14_UNTIL` default 15 Sep 2026 — *confirm the Sep 15 vs Sep 25 gap.*

---

## 5. Oncology — Physician Onco add-on (NEW)

Oncology is monetized: **only disease reference + AJCC/TNM staging are free** (the hook). Everything clinical-decision in onco is the **Physician Onco** pack.

- **Physician Onco — +₹89/month** (add-on to Pro or Ultimate). Ultimate + Onco = **₹1,588/mo**. 🔧 annual +₹899/yr.
- **Unlocks (the treatment-planning workflow):** Treatment-Plan Protocols, Protocol Library + Reference, OncoTree navigator, recommend engine, evidence overlay, favorites, TallMan.
- **Stays free:** Onco disease/KB reference, AJCC/TNM staging, **CTCAE toxicity grading, IO toxicity (irAE), RECIST 1.1, onco drug info + interactions** (reference & safety tools — cheap, deterministic, safety-relevant).
- **Hospital:** onco **treatment-plan execution** (role-split doctor/nurse: protocol assign, cycles, administration) is part of the Hospital team platform (§6), not the individual add-on.

Maps cleanly to the built system: a `featureFlags` gate keyed to an `onco` entitlement + a ₹89 add-on SKU alongside the credits product.

---

## 6. HOSPITAL plans (B2B) — the two-step model — FINAL

Sold **consultative, not off-a-price-list.** Public site shows only "Starting at ₹X · Talk to us."

### Step 1 — SIZE (beds → minimum doctor seats)

| Size | Beds | Min seats 🔧 | Volume discount 🔧 |
|---|---|---|---|
| **Clinic** | 1–25 | 3 | — |
| **Community** | 26–100 | 15 | 10% |
| **Secondary** | 101–300 | 40 | 20% |
| **Tertiary** | 301–750 | 100 | 30% |
| **Enterprise** | 750+ / multi-site | Custom | 35%+ (negotiated) |

Every seat includes the **team platform**: ICU workstation + collaboration, OPD Queue + EMR, Ward Sync (basic Connect), hospital antimicrobial-policy overlay, **oncology treatment-plan execution**, admin console, and all Free features.

### Step 2 — AI PLAN (all-in per-seat, applies to all seats)

| AI plan | Per-seat/mo 🔧 | AI/day | What's included |
|---|---|---|---|
| **Credits-base** | **₹399** | shared hospital wallet (pay-go) | platform + AI from a topped-up wallet |
| **Pro** | **₹799** | ₹15/seat, pooled org-wide | platform + imaging fair-use |
| **Ultimate** | **₹1,499** | ₹25/seat / fair-use | platform + **all imaging** + Connect **full** interop + FollowCare full + white-label + analytics/API + dedicated support/SLA |

**Hospital monthly = max(min-seats, actual doctors) × per-seat × (1 − volume discount).** The min-seats floor is the effective platform commitment.

Illustrative (🔧):
- Community, 15 seats, **Pro**: 15 × ₹799 × 0.90 ≈ **₹10,786/mo**.
- Secondary, 40 seats, **Ultimate**: 40 × ₹1,499 × 0.80 ≈ **₹47,968/mo**.
- Clinic, 3 seats, **Credits-base**: 3 × ₹399 = ₹1,197/mo + a 🔧 ₹2,000 starter wallet.

### Add-on inclusion by AI plan

| Add-on | Credits | Pro | Ultimate |
|---|---|---|---|
| Ward Sync (basic Connect) | ✅ | ✅ | ✅ |
| OPD Queue + EMR | ✅ | ✅ | ✅ |
| Oncology treatment-plan execution | ✅ | ✅ | ✅ |
| Imaging AI (FundX/KardioX/ThoreX/SknX) | wallet | fair-use | ✅ full |
| Connect full interop (FHIR/HL7/DICOM/ABDM + AI mapping) | add-on | add-on | ✅ |
| FollowCare (post-discharge) | add-on | basic | ✅ full |
| White-label / analytics / API-SDK | add-on | add-on | ✅ |
| Priority / dedicated support + SLA | — | email | ✅ |

**Institution coupons (built):** admin issues codes → doctors redeem to unlock their seat → revocable (never nukes a doctor who paid separately). This is "the institution pays for its doctors."

---

## 7. Feature → tier matrix (A–Z, updated)

Legend: **F**=Free · **S**=Student · **P**=Pro · **U**=Ultimate · **O**=Physician Onco add-on · **H**=Hospital · **+**=paid add-on · 💰=AI-metered.

| Feature | Tier | Note |
|---|---|---|
| Reasoning engine + workspace | **F** | hook |
| Antibiotic engine + AWaRe + antibiogram | **F** | |
| Hospital antimicrobial-policy overlay | **H** | |
| Drug DB + interaction/QT/renal/bleeding safety | **F** | never blocked |
| OCR scan prescription/case sheet | **F** 3/day → **P** 💰 | |
| All calculators + electrolytes + renal + basic insulin | **F** | |
| Infusion / vasopressor + Nurse Mode | **H** | |
| MaiK Ask/Explain | **F** taste → **S/P/U** 💰 | rupee cap by tier |
| MaiK Instant KB (Tier-0) | **F** | ∞ deterministic |
| MaiK Deep Review / Clinical Case | **P/U** 💰 | |
| MaiK Patient Summary | **P/U** 💰 | |
| MaiK Research | **P** 10/day / **U** ∞ 💰 | |
| Voice dictation (Whisper) | **S/P/U** | on-device = free |
| MaiK Scribe (voice→EMR) | **S/P/U** | time-capped |
| Voice consult / ambient / TTS | **P/U** 💰 | |
| Imaging AI — FundX / ThoreX / SknX | **Co-Res** 4/day each · **P** 5/day · **U** 20/day · **H** 💰 | Free ❌ |
| KardioX ECG AI | **U/H** 💰 | Learn atlas **F/S** |
| ICU workstation + collaboration | **H** | |
| Lab Watch 24/7 | **P/U** (solo) / **H** | |
| **Personal OPD / My Clinic** (on-device: patient list, queue, consult EMR) | **F** 1 device → backup/sync **P/U** | solo doctor; local = ₹0 to serve |
| OPD Ask MaiK (AI Dx/Mx/Rx suggestions in the consult) | **P/U** 💰 | AI = metered |
| Hospital OPD Queue (multi-staff + GHIS/Connect + display + billing) | **H** | billing add-on; team product |
| **Onco: disease ref + staging + CTCAE + IO-tox + RECIST + drug interactions** | **F** | reference & safety |
| **Onco: protocols / library / OncoTree / recommend / evidence overlay** | **O** (+₹89) | treatment-planning workflow |
| **Onco: treatment-plan execution (role-split)** | **H** | team |
| Connect — Ward Sync (basic) | **H** | |
| Connect — full interop + AI mapping | **H**-Ultimate / **+** 💰 | |
| FollowCare (post-discharge) | **H** (Ultimate incl / **+**) | |
| KB + guidelines + offline + updates | **F** | |
| Knowledge Units / streaks | **F** | |
| Specialty workspaces (7) | **F** | |
| Personal Clinic EMR (on-device) | **F** 1 device → sync **P/U** | |
| Shared Clinic EMR | **P/U** or **H** | |
| My Cases + cross-device sync | save **F**; sync **P/U** | |
| Wearable (Apple Watch / Wear OS) | **P/U** | |
| AI Control Center | **H**/owner | |
| Steward ID / verification / onboarding / support | **F** | |

---

## 8. AI economics (anti-bankruptcy)

- **Daily rupee caps** (`AI_DAILY_COST_CAP_<ROLE>`): Free ₹0.5 · Student/Resident/Intern ₹5 · Co-Resident ₹6 pooled · Pro ₹10 · Ultimate ₹25 · Hospital-Pro ₹15/seat pooled · Hospital-Ultimate ₹25/seat or fair-use. Set so <5% of paying users ever hit them and worst-case margin stays ≥ ~25% after GST; tune live from the AI Control Center hit-rate.
- **Credits** (`CREDIT_CONVERSION=0.5`): ₹50 → ₹25 of AI, spent only above the cap. Overflow valve + power-user revenue; hospital Credits-base runs the whole org off one wallet.
- **On-device voice = ₹0 to serve** → Scribe/dictation "unlimited" with no cost risk (a genuine edge vs per-minute scribe products).
- **Answer cache** already drops repeat generic questions to ₹0.

---

## 9. Brand / website architecture

Headline: **"Choose how deeply StewardMD works with you."**

| Free | Student | Pro | Ultimate | Hospital |
|---|---|---|---|---|
| Think with StewardMD | Learn with StewardMD | Practice with StewardMD | Practice without limits | Run care with StewardMD |

Public pricing page shows **Free · Student · Pro ⭐ · Ultimate**, plus **"Hospitals & Institutions → Talk to us."** Co-Resident appears after clicking Student. Physician Onco appears as a +₹89 toggle on Pro/Ultimate. Hospital numbers stay sales-led.

---

## 10. Guardrails & go-live

- Safety warnings never hard-paywalled. Over-cap = "add credits / upgrade / wait," never a dead end (built `429 ai-cost-cap`).
- Enforcement flips only after a real payment test-purchase. Until then everyone stays free — no lockouts.
- **To go live:** confirm this doc → set prices + role caps in env (`PRO_PRICE_*`, `AI_DAILY_COST_CAP_<ROLE>`, onco SKU) → payment creds (PhonePe/Razorpay web live; native needs Play/Apple products + billing plugin) → test-purchase → flip (`PRO_FREE_UNTIL` past, `AI_COST_CAP_ON=1`, `FEATURES_ON=1`, `MAIK_ENFORCE_CAPS=1`).

Built and ready to carry all of this: roles, per-user/role rupee caps, credits, shared AI pool, institution coupons, admin console, Google/Apple IAP adapters. The only new SKU to wire is **Physician Onco (+₹89/mo)** as a feature-flag entitlement.

---

## 11. Final numbers at a glance

**Individual:** Free ₹0 · Student ₹199 · Co-Resident ₹299 · Pro ₹599 · Ultimate ₹1,499 · **+ Physician Onco ₹89.**
**AI caps/day:** ₹0.5 / ₹6 / ₹10 / ₹25. **Imaging/day:** 0 / 5 / 20.
**Hospital (per-seat/mo, min seats by beds, volume-discounted, sales-led):** Credits ₹399 · Pro ₹799 · Ultimate ₹1,499.

---

## 12. CRO add-ons (launch, referral, tax) — see `GROWTH_STRATEGY.md` §1

- **Free trial takes no card**; auto-drops to Free at end (never locks out).
- **Founding-Doctor offer:** first **500** verified doctors get **Pro for ₹399 for the whole year** (~₹33/mo; not per month). AI is a **fixed annual budget — ₹120 at signup + ONE ₹120 refill when spent = ₹240/yr hard ceiling, no daily reset**; beyond that, standard credits (₹50→₹25). Imaging 5/day draws from the same budget (imaging is what depletes it → renewal nudge). **Profit even at full AI burn: ₹399 − ~₹8 fees − ₹240 AI = ₹151/yr (~38% margin);** light users net more. Runs on the coupon + credits engine (set the founding role's daily free cap to ~₹0 so all AI draws from the granted annual pool; grant ₹120, auto-refill ₹120 once). Public countdown for urgency (land-grab for the first 500).
- **Referral:** refer a doctor → **both get ₹150 credits** (or 1 free Pro month) on the referee's activation. Runs on the credits engine.
- **Annual framing:** show monthly-equivalent + "2 months free" (e.g. Pro ₹4,999/yr = ₹416/mo).
- **GST:** B2C prices shown **inclusive**; B2B **ex-GST + GST invoice** (capture GSTIN at hospital checkout). Register for GST before the first paid rupee (SaaS = 18%).
- **In-app cap nudge** is the primary upsell surface (the built `429 ai-cost-cap` sheet).
