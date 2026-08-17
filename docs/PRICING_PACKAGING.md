# StewardMD — Pricing & Packaging (v5)

*v5 changes: AI usage is shown to users only in **MaiK Tokens**, never rupees (§8a — peg 2,000 MT = ₹1, ₹10 usage = 20,000 MT; packs 50k/250k/750k MT); GST guidance corrected (no startup waiver, but ₹20L threshold + 6% composition, §12). v4 set: FollowCare ₹4/min × 3–5 min ≈ ₹20/patient (quotas trimmed); **Device Voice "Ultra"** Pro-and-above perk; strike-through/anchor pricing (genuine only); coupons Android/Web only (Apple forbids IAP codes).*

*Signed-off commercial model. v3 splits the top of the ladder into **three attending tiers** — Pro ₹599 (clinical AI), **Physician ₹1,499** (run your clinic: Google-Drive Personal Clinic + capped FollowCare/Scribe/MaiK-Ask + unlimited Billing + optional Onco), and **Physician Pro ₹2,499** (we host PHI + higher AI/credits + OncoTree/ONCQIS included). Trainee tiers (Student/Intern/Resident ₹199, Co-Resident ₹299) and Pro are kept as-is. Per-patient AI (voice consult ₹3–5, FollowCare ~₹11) is metered by monthly quota + credits, separate from the daily text cap. Ladder: Free → ₹199 → ₹299 → ₹599 → ₹1,499 → ₹2,499.*

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

**Cheap — text AI (under the daily rupee cap):**
| Action | Approx cost to us |
|---|---|
| MaiK quick answer | ₹0.03 |
| MaiK deep review | ₹0.08 |
| Research / evidence | ₹0.10–0.15 |
| Patient summary | ₹0.09 |
| **Imaging read** (FundX/KardioX/ThoreX/SknX/OCR) | **₹0.35–0.50 each** |
| Voice **dictation** (on-device Whisper, plain STT) | **₹0.00** |
| KB search, calculators, drug DB, reasoning | ₹0.00 |

**Expensive — per-patient AI (metered SEPARATELY: monthly quota + credits, NOT under the daily text cap):**
| Action | Approx cost to us |
|---|---|
| **AI OPD voice consult / MaiK Scribe** (ambient + diarization + LLM structuring) | **₹3–5 per patient** |
| **FollowCare** — voice call | **₹4 per minute × 3–5 min ≈ ₹12–20 per call** |
| **FollowCare** — SMS | **₹1 per SMS** (7-day follow-up ≈ 7 SMS ≈ ₹7) |
| → **FollowCare episode** (1 call + 7-day SMS) | **≈ ₹20–27 per patient** |

Why the split matters: a busy OPD doctor scribing 30 patients/day at ₹4 each = ₹120/day = ₹3,600/mo, and a FollowCare episode is ~₹20 — that can never sit under a flat cap. So voice consult and FollowCare each get their own **monthly included quota + token overage**; only text AI runs off the daily rupee cap.

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

Ladder: **Free → Trainee ₹199 → Co-Resident ₹299 → Pro ₹599 → Physician ₹1,499 → Physician Pro ₹2,499.**
Trainee = Student / Intern / Resident (all one price band, kept as-is). "Physician" is the renamed former "Ultimate"; "Physician Pro" is a new top tier above it.

### 4a. Base ladder (unchanged tiers)
| | **Free** | **Trainee** (Student/Intern/Resident) | **Co-Resident** | **Pro** ⭐ |
|---|---|---|---|---|
| **Monthly** | ₹0 | **₹199** | **₹299** (2 accts) | **₹599** |
| **Annual** 🔧 | — | ₹1,999 | ₹2,999 | ₹4,999 |
| **Text AI cap/day** | ₹0.50 | ₹5 | ₹6 pooled | ₹10 |
| MaiK (text) · voice dictation (on-device) | taste | ✅ | ✅ pooled | ✅ |
| Patient Summary · Research | ❌ · taste | ❌ · educational | ❌ · 10/day | ✅ · 10/day |
| Imaging AI reads/day | ❌ | ❌ (Learn atlas) | 4/day each | 5/day |
| Personal Clinic (My Clinic) | on-device (1 device) | on-device | on-device | on-device + case sync |
| **Device Voice "Ultra"** (premium on-device model) | ❌ | ❌ | ❌ | ✅ |
| Lab Watch + wearable | ❌ | ❌ | ❌ | ✅ |

### 4b. The two clinic-owner tiers (NEW split)
Both are for a doctor running their own practice. **Physician** = solo clinic on your own Google Drive with sensible monthly caps. **Physician Pro** = we host it (cloud, PHI) with much higher AI + everything unlocked.

| | **Physician** | **Physician Pro** |
|---|---|---|
| **Monthly** 🔧 | **₹1,499** | **₹2,499** |
| **Annual** 🔧 | ₹14,999 | ₹24,999 |
| Everything in **Pro** | ✅ | ✅ |
| **Text AI cap/day** | ₹15 | ₹25 |
| Imaging AI reads/day | 15 | 30 |
| Priority reasoning model | ✅ | ✅ |
| **Device Voice "Ultra"** (premium on-device dictation model) | ✅ | ✅ |
| **Personal Clinic storage** | **own Google Drive** (we store no PHI) | **Cloud Sync — we host PHI**, multi-device realtime |
| **Clinic Billing** (invoices) | **unlimited** | **unlimited** |
| **FollowCare** (₹≈20/patient to us) | **10 patients/mo** incl → tokens | **25 patients/mo** incl → tokens |
| **MaiK Scribe / AI voice consult** (₹3–5/pt) | **40/mo** incl → tokens | **120/mo** incl → tokens |
| **MaiK Ask** (AI-guided history) | **40/mo** incl → tokens | **150/mo** incl → tokens |
| **OncoTree + ONCQIS** | **+₹89/mo add-on** (optional) | **✅ included** |
| Support | priority email | dedicated |

Over any daily cap or monthly quota → **top up tokens** (§7) or upgrade; never a hard lockout. Text AI runs off the daily rupee cap; the three per-patient items (FollowCare, voice consult, MaiK Ask) are **metered separately by monthly quota** because they cost real money per use — that's what keeps a high-volume OPD from inverting the tier.
**Device Voice "Ultra"** (a larger, higher-accuracy on-device speech model) is a **Pro-and-above** perk — it costs us ₹0 to run (on-device) so it's a pure differentiator that makes Pro worth buying.

**Margins (net of 18% GST):**
- **Physician ₹1,499** → net ~₹1,270; worst-case included cost ≈ FollowCare 10×₹20 (₹200) + Scribe 40×₹4 (₹160) + text (~₹100) ≈ ₹460 → **~₹810 contribution (64%)**; +₹89 Onco is near-pure margin.
- **Physician Pro ₹2,499** → net ~₹2,118; included cost ≈ FollowCare 25×₹20 (₹500) + Scribe 120×₹4 (₹480) + text (~₹150) ≈ ₹1,130 → **~₹988 contribution (47%)**; overage billed via tokens, so it only improves.

*Build note: the text cost-cap + credits are shipped; the three **monthly per-patient quota meters** (FollowCare, voice consult, MaiK Ask) + credit-overage still need wiring before go-live — same pattern as the built daily meter, keyed `<feature>:<uid>:<month>`.*

**Who:** Student = verified trainee (NMC-trainee/college proof required). Co-Resident = two trainees, one shared AI pool — "split StewardMD with your co-resident." Each account gets **4 imaging reads/day**; total cost is still governed by the shared ₹6/day pool.

**Trial:** 🔧 14 days (started ≤ cutover) / 7 days after. Built; `TRIAL14_UNTIL` default 15 Sep 2026 — *confirm the Sep 15 vs Sep 25 gap.*

---

## 5. Oncology — Physician Onco add-on (NEW)

Oncology is monetized: **only disease reference + AJCC/TNM staging are free** (the hook). Everything clinical-decision in onco is the **Physician Onco** pack.

- **Physician Onco — +₹89/month add-on on the Physician tier** (optional). Physician + Onco = **₹1,588/mo**. 🔧 annual +₹899/yr. **Included free in Physician Pro** (no add-on needed).
- **Unlocks: OncoTree navigator + ONCQIS** (the oncology treatment-planning workflow): Treatment-Plan Protocols, Protocol Library + Reference, OncoTree navigator, recommend engine, evidence overlay, favorites, TallMan.
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

Legend: **F**=Free · **S**=Trainee (Student/Intern/Resident) · **P**=Pro · **Ph**=Physician · **U**=Physician Pro · **O**=Physician Onco add-on · **H**=Hospital · **+**=paid add-on · 💰=AI-metered.

| Feature | Tier | Note |
|---|---|---|
| Reasoning engine + workspace | **F** | hook |
| Antibiotic engine + AWaRe + antibiogram | **F** | |
| Hospital antimicrobial-policy overlay | **H** | |
| Drug DB + interaction/QT/renal/bleeding safety | **F** | never blocked |
| OCR scan prescription/case sheet | **F** 3/day → **P** 💰 | |
| All calculators + electrolytes + renal + basic insulin | **F** | |
| Infusion / vasopressor + Nurse Mode | **H** | |
| MaiK Ask/Explain (text) | **F** taste → **S/P/Ph/U** 💰 | rupee cap by tier |
| MaiK Instant KB (Tier-0) | **F** | ∞ deterministic |
| MaiK Deep Review / Clinical Case | **P/Ph/U** 💰 | |
| MaiK Patient Summary | **P/Ph/U** 💰 | |
| MaiK Research | **P/Ph** 10/day · **U** ∞ 💰 | |
| Voice dictation (on-device Whisper) | **S/P/Ph/U** | ₹0 to serve |
| **Device Voice "Ultra"** (premium on-device model) | **P/Ph/U** | ₹0, Pro-and-above perk |
| **MaiK Scribe / AI voice consult** (ambient→EMR) | **Ph** 40/mo · **U** 120/mo → credits 💰 | ₹3–5/pt |
| **MaiK Ask** (AI-guided patient history) | **Ph** 40/mo · **U** 150/mo → credits 💰 | |
| Imaging AI — FundX / ThoreX / SknX | **Co-Res** 4/day · **P** 5 · **Ph** 15 · **U** 30 · **H** 💰 | Free ❌ |
| KardioX ECG AI | **Ph/U/H** 💰 | Learn atlas **F/S** |
| ICU workstation + collaboration | **H** | |
| Lab Watch 24/7 | **P/Ph/U** (solo) / **H** | |
| **Personal Clinic / My Clinic** (patient list, queue, consult EMR) | on-device **F**→**P** | local = ₹0 |
| Personal Clinic — own **Google Drive** backup (no PHI on us) | **Ph** | cheap |
| Personal Clinic — **Cloud Sync (we host PHI, multi-device)** | **U** | our storage + DPDP liability |
| **Clinic Billing** (invoices) | **Ph/U** unlimited | deterministic |
| Hospital OPD Queue (multi-staff + GHIS/Connect + display + billing) | **H** | team product |
| **Onco: disease ref + staging + CTCAE + IO-tox + RECIST + drug interactions** | **F** | reference & safety |
| **Onco: protocols / library / OncoTree / ONCQIS / recommend** | **O** +₹89 on **Ph** · incl in **U** | treatment-planning |
| **Onco: treatment-plan execution (role-split)** | **H** | team |
| Connect — Ward Sync (basic) | **H** | |
| Connect — full interop + AI mapping | **H**-Ultimate / **+** 💰 | |
| FollowCare (post-discharge) | **Ph** 10 pts/mo · **U** 25 pts/mo → tokens · **H** | ₹20/patient episode |
| MaiK Scribe in OPD / AI voice consult | **U** 60/mo incl → credits · **H** 💰 | ₹3–5/patient |
| MaiK Ask (AI-guided history) · Clinic Billing | **U** · **H** | |
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

- **Daily TEXT-AI rupee caps** (`AI_DAILY_COST_CAP_<ROLE>`): Free ₹0.5 · Student/Intern/Resident ₹5 · Co-Resident ₹6 pooled · Pro ₹10 · Physician ₹15 · Physician Pro ₹25 · Hospital-Pro ₹15/seat pooled · Hospital-Ultimate ₹25/seat or fair-use. Set so <5% of paying users ever hit them and worst-case margin stays ≥ ~25% after GST; tune live from the AI Control Center hit-rate.
- **Per-patient AI (voice consult ₹3–5, FollowCare ~₹20) is metered SEPARATELY** — monthly included quota per tier + token overage — so a high-volume OPD can never invert the tier. Never counted in the daily text cap.
- **On-device voice DICTATION = ₹0 to serve** → plain dictation unlimited from Trainee up; the **Ultra** on-device model is a Pro-and-above perk (also ₹0 to run). The AI OPD **voice consult / Scribe** (ambient + structuring) costs ₹3–5/pt and is quota-metered.
- **Answer cache** already drops repeat generic questions to ₹0.

### 8a. MaiK Tokens — the in-app AI currency (never show rupees)
**The user never sees AI usage in rupees.** All usage, the daily allowance, the balance, and top-ups are shown in **MaiK Tokens (MT)**. Rupees appear ONLY on the price of a token pack. Internally the engine still tracks the real ₹ cost (unchanged); the app just displays it as MT. Peg (🔧 tunable): **2,000 MaiK Tokens = ₹1 of AI**, so ₹10 of usage reads as **20,000 MaiK Tokens** (a big, "spendable" number).

**Daily allowance shown per tier** (= the ₹ cap × 2,000): Free **1,000 MT** · Trainee **10,000 MT** · Co-Resident **12,000 MT pooled** · Pro **20,000 MT** · Physician **30,000 MT** · Physician Pro **50,000 MT**.

**What actions spend** (illustrative, shown in-app): MaiK answer ~60 MT · Deep review ~160 · Research ~250 · Patient summary ~190 · Imaging read ~800 · Voice consult/Scribe ~8,000 · FollowCare episode ~40,000.

**Top-up packs** (₹ shown only here; our cost basis 2,000 MT = ₹1):

| Pack | MaiK Tokens | Price 🔧 | Struck | Save | Our cost | Margin |
|---|---|---|---|---|---|---|
| **Boost** | **50,000 MT** | **₹49** | — | — | ₹25 | ₹24 |
| **Plus** ⭐ | **250,000 MT** | **₹199** | ~~₹245~~ | 19% | ₹125 | ₹74 |
| **Power** | **750,000 MT** | **₹499** | ~~₹735~~ | 32% | ₹375 | ₹124 |

Psychology: a five/six-figure token balance feels abundant and spendable (unlike "₹25 of AI", which reads as *losing half*); charm prices; the **strike-through is honest** (entry rate ₹0.00098/MT, so bigger packs genuinely save, no fake MRP which India's ASCI/CCPA penalise). One wallet powers all overage (text, imaging, voice, FollowCare); hospital Credits-base = one shared org MT wallet. The "AI limit hit" sheet reads "You've used today's MaiK Tokens" with a Top-up button.

---

## 9. Brand / website architecture

Headline: **"Choose how deeply StewardMD works with you."**

| Free | Trainee | Pro | Physician | Physician Pro | Hospital |
|---|---|---|---|---|---|
| Think | Learn | Practice | Run your clinic | Run your clinic without limits | Run care |

Public pricing page shows **Free · Trainee · Pro ⭐ · Physician · Physician Pro**, plus **"Hospitals & Institutions → Talk to us."** Co-Resident appears after clicking Trainee. Physician Onco (OncoTree + ONCQIS) is a +₹89 toggle on Physician (and included in Physician Pro). Hospital numbers stay sales-led.

---

## 10. Guardrails & go-live

- Safety warnings never hard-paywalled. Over-cap = "add credits / upgrade / wait," never a dead end (built `429 ai-cost-cap`).
- Enforcement flips only after a real payment test-purchase. Until then everyone stays free — no lockouts.
- **To go live:** confirm this doc → set prices + role caps in env (`PRO_PRICE_*`, `AI_DAILY_COST_CAP_<ROLE>`, onco SKU) → payment creds (PhonePe/Razorpay web live; native needs Play/Apple products + billing plugin) → test-purchase → flip (`PRO_FREE_UNTIL` past, `AI_COST_CAP_ON=1`, `FEATURES_ON=1`, `MAIK_ENFORCE_CAPS=1`).

Built and ready to carry all of this: roles, per-user/role rupee caps, credits, shared AI pool, institution coupons, admin console, Google/Apple IAP adapters. The only new SKU to wire is **Physician Onco (+₹89/mo)** as a feature-flag entitlement.

---

## 11. Final numbers at a glance

**Individual:** Free ₹0 · Trainee (Student/Intern/Resident) ₹199 · Co-Resident ₹299 · Pro ₹599 · **Physician ₹1,499** · **Physician Pro ₹2,499.**
**Physician ₹1,499** (was Ultimate): everything in Pro + own-Google-Drive Personal Clinic + unlimited Clinic Billing + FollowCare 10 pts/mo + MaiK Scribe/voice consult 40/mo + MaiK Ask 40/mo (all → tokens over quota) + Device Voice Ultra + **Onco optional +₹89**.
**Physician Pro ₹2,499:** everything in Physician + **Cloud Sync (we host PHI)** + higher AI (₹25/day text) + FollowCare 25/mo + Scribe 120/mo + MaiK Ask 150/mo + **OncoTree + ONCQIS included** + dedicated support.
**Text AI caps/day:** Free ₹0.5 · Trainee ₹5 · Co-Res ₹6 · Pro ₹10 · Physician ₹15 · Physician Pro ₹25. **Imaging/day:** 0 / 0 / 4 / 5 / 15 / 30. Per-patient AI (voice ₹3–5, FollowCare ~₹20) metered by monthly quota + **tokens** (§8a).
**AI Tokens:** 1M ₹29 · 5M ₹119 · 15M ₹299 (one wallet, big-number packs, honest strike-through). **Founding:** 500 doctors, ₹399/yr.
**Hospital (per-seat/mo, min seats by beds, volume-discounted, sales-led):** Credits ₹399 · Pro ₹799 · Ultimate ₹1,499.

---

## 12. CRO add-ons (launch, referral, tax) — see `GROWTH_STRATEGY.md` §1

- **Free trial takes no card**; auto-drops to Free at end (never locks out).
- **Founding-Doctor offer:** first **500** verified doctors get **Pro for ₹399 for the whole year** (~₹33/mo; not per month). AI is a **fixed annual token pool** (≈ the ₹240/yr cost ceiling, no daily reset); beyond that, buy token packs (§8a). **Profit even at full burn ≈ ₹150/yr (~38% margin);** light users net more. Runs on the coupon + token engine. Public countdown for urgency.
- **Referral:** refer a doctor → **both get bonus tokens** (e.g. 5,000,000 tokens) or 1 free Pro month on the referee's activation.
- **Strike-through / anchor pricing everywhere:** show the higher **regular** price struck next to the launch/plan price so every screen reads as a saving, e.g. **~~₹1,000~~ ₹299**, "**₹4,999/yr ~~₹7,188~~, 2 months free**", token packs "~~₹435~~ ₹299". *Anchors must be genuine* (the real regular price or the entry per-token rate), never a fabricated MRP — India's ASCI/CCPA penalise fake strike-throughs.
- **Annual framing:** monthly-equivalent + "2 months free" (Pro ₹4,999/yr = ₹416/mo).
- **GST (no startup waiver exists):** DPIIT-recognised startups get income-tax relief (80-IAC holiday) and angel-tax exemption, but **there is no GST exemption for startups**. What actually helps early on: (a) **no GST registration or charge required below ₹20 lakh** annual turnover (₹10L in special-category states), so early revenue is GST-free and margins are higher; (b) the **composition scheme for services (6%)** is available up to ₹50L turnover instead of the full 18%; (c) once regular-registered, SaaS is **18%**. Plan pricing so it works at 18%, enjoy the sub-threshold headroom while it lasts, and register the moment you approach ₹20L. Caveat: selling through an e-commerce operator / marketplace or making inter-state B2B supply can force registration earlier. *Confirm the exact position with a CA — this is guidance, not tax advice.* Display: B2C prices **inclusive**; B2B **ex-GST + GST invoice** (capture GSTIN at checkout) once registered.
- **Coupons = Android + Web only.** Apple forbids external discount codes inside IAP, so the coupon-redeem field is **shown on Android/Web (Razorpay/PhonePe/Play) and hidden on iOS**; iOS discounts use **Apple Offer Codes** or a "redeem on stewardmd.in" link (purchase on web, entitlement syncs to the account). The built coupon engine already grants server-side, so a web redeem unlocks the iOS app automatically.
- **In-app cap nudge** is the primary upsell surface (the built `429 ai-cost-cap` sheet).
