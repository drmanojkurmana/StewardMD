# StewardMD — Pricing & Packaging (v1 draft for owner review)

*Prepared as the commercial call for the founder. Every number below is a recommended starting point — the two dials you tune are **per-unit price** and **what sits behind the paywall**. I mark every assumption with 🔧 so you can correct it. Nothing here is enforced until you flip it (see §9).*

Date: 2026-08-16 · Applies to: mobile app (iOS/Android) + web

---

## 1. The five principles I priced against

1. **Free = cheap-to-serve + habit-forming + safety.** Anything deterministic/on-device costs us ≈₹0 and is what makes a doctor open the app every day. Those stay free forever. They are the acquisition engine, not lost revenue.
2. **Paid = expensive-to-serve OR team-scale.** We charge where we actually spend money (AI text, vision/imaging, server polling) or where the value is multi-user (ICU, OPD, Connect, FollowCare).
3. **Meter AI by RUPEE COST, not action count.** A MaiK text answer costs us ~₹0.03; an imaging read ~₹0.40 (13× more). A count-based cap would cut a doctor off from cheap queries while ignoring the expensive ones. The rupee cap I built is the correct, bankruptcy-proof design.
4. **B2C is the funnel; B2B (hospitals) is the revenue.** Free/cheap individual tiers capture doctors; hospitals monetize the team stack and pay per seat.
5. **Never hard-block a safety warning.** A drug-interaction, renal/hepatic/QT, or critical-value alert that's already computed is never paywalled mid-use. It's ethically required and it builds the trust that sells the paid tiers.

---

## 2. Cost reality (why the tiers look the way they do)

From the live cost model (`functions/_ai_usage.js`, ₹ per 1,000 tokens):

| Action | Model | Approx cost to us |
|---|---|---|
| MaiK quick answer | gemini-2.5-flash | **₹0.03** |
| MaiK deep review | flash | **₹0.08** |
| Research / evidence review | flash + retrieval | **₹0.10–0.15** |
| Patient summary (whole timeline) | flash | **₹0.09** |
| **Imaging read** (FundX / KardioX / ThoreX / SknX / OCR) | vision | **₹0.35–0.50 each** |
| Voice dictation / Scribe STT | **on-device Whisper** | **₹0.00** (free to serve) |
| KB semantic search, calculators, drug DB, reasoning | local | **₹0.00** |

**Conclusion that drives everything below:** text AI and voice are cheap → be generous. Imaging and heavy research are the cost → meter them. Typical heavy text-only doctor costs us **₹30–120/month**; add imaging and it can reach **₹300–500/month**. So a ₹499 Pro tier has healthy margin on text users, and imaging-heavy users are protected by the daily rupee cap + credits.

---

## 3. FREE forever (the hook)

Everything here is deterministic/on-device (≈₹0 to serve) or safety-critical. This is deliberately generous — it is our word-of-mouth engine among doctors.

- **Clinical reasoning engine** — live differential diagnosis, confidence scores, explainability, reasoning workspace.
- **Antibiotic decision engine** — empiric/definitive therapy, AWaRe, antibiogram (view), treatment-failure wizard.
- **Full drug database + all safety checks** — interactions, duplicates, QT, renal, bleeding. *(Safety = never paywalled.)*
- **All clinical calculators** — CrCl, MELD, scores, electrolyte correction, renal dosing; basic insulin dosing.
- **Knowledge Base + guidelines library + offline clinical content + Medical Updates feed.**
- **Specialty workspaces** — ENT, Ophthalmology, Paediatrics, Surgery, Urology, Ob-Gyn, Dentistry.
- **Oncology reference hub** — staging, protocol reference, CTCAE, RECIST (reference only; treatment-plan execution is Hospital).
- **My Cases** (save/reopen, 🔧 cap 10) + de-identified case share.
- **Personal Clinic EMR** — on-device, encrypted, 🔧 1 device (multi-device sync is Pro).
- **Steward ID / NMC verification / onboarding / support.**
- **A daily taste of MaiK AI** — 🔧 ₹0.50/day AI budget (~15 text answers) + 🔧 3 OCR scans/day. Enough to get hooked; the cap nudges upgrade.

**Not free:** imaging AI (too expensive), MaiK Scribe, Patient Summary, Research mode beyond the taste, cross-device sync, Lab Watch, and everything team/hospital.

---

## 4. Individual plans (B2C — web + app)

Maps your live site (₹199 / ₹499 / ₹1,199 + 7-day free) and the built roles.

| Plan | Price 🔧 | Who | AI daily ₹ cap 🔧 | Headline unlocks |
|---|---|---|---|---|
| **Free** | ₹0 | Everyone | ₹0.5/day | §3 above |
| **Student / Resident** | **₹199/mo** · ₹1,999/yr | Verified trainee (NMC trainee / college) | ₹6/day | Full MaiK, educational V2 (KardioX Learn atlas), Scribe, sync — trainee price |
| **Co-Resident (dual)** | **₹299/mo** | 2 trainee accounts, **one shared AI pool** | ₹6/day pooled | Two logins share a single AI bucket (already built) |
| **Pro (attending)** | **₹499/mo** · ₹3,999/yr *(~2 mo free)* | Practising doctor | ₹15/day | Unlimited* MaiK, on-device Scribe unlimited, Patient Summary, Research (10/day), imaging AI fair-use (🔧 20 reads/day), cross-device sync, Lab Watch, wearable |
| **Ultimate (individual)** | **₹1,199/mo** · ₹11,999/yr | Power / imaging-heavy | ₹40/day | Everything in Pro + high AI cap, imaging-heavy, priority reasoning model (2.5-pro deep review), unlimited research, earliest access to FundX/KardioX/ThoreX/SknX, extended Scribe time caps |

\*"Unlimited" = fair-use behind the daily rupee cap. Over the cap → **buy credits** (₹50 → ₹25 of AI, already built) or upgrade, or wait for the midnight reset. No one is ever hard-locked.

**Free trial:** 🔧 14 days for accounts started on/before the cutover, 7 days after (built; env `TRIAL14_UNTIL`, default 15 Sep 2026 — *please confirm the cutover; you wrote "14 till Sep 15, 7 after Sep 25", a 10-day gap*).

**Margin check:** Pro ₹499 with a ₹15/day cap caps our worst-case cost at ₹450/mo, but typical use is ₹30–120/mo → strong margin. Ultimate ₹1,199 with ₹40/day protects the downside; true power users pay more via credits.

---

## 5. Hospital plans (B2B) — the two-step model you asked for

### Step 1 — pick your SIZE (by beds → doctor seats)

Indian hospitals run ~1 doctor per 4–6 beds across shifts. Included seats scale with beds; extra seats are an add-on. Bigger tiers get volume discounts.

| Size tier | Beds | Included doctor seats 🔧 | Volume discount 🔧 | Typical setting |
|---|---|---|---|---|
| **Clinic** | 1–25 | 3 | — | Nursing home / polyclinic |
| **Community** | 26–100 | 15 | 10% | Small hospital |
| **Secondary** | 101–300 | 40 | 20% | District / mid hospital |
| **Tertiary** | 301–750 | 100 | 30% | Medical college / large |
| **Enterprise** | 750+ / multi-site | Custom | 35%+ (negotiated) | Chain / apex |

Every seat includes the **team clinical platform**: ICU workstation + collaboration, OPD Queue + EMR, Ward Sync (basic Connect), shared hospital antimicrobial-policy overlay, oncology treatment-plan (role-split doctor/nurse), admin console — plus all Free individual features for every doctor.

Extra seat beyond the included count: charged at the per-seat rate of the chosen AI plan (below).

### Step 2 — pick your AI PLAN (applies to all seats)

| AI plan | Per-seat/mo 🔧 | AI included | Best for |
|---|---|---|---|
| **Credits-base** | **₹299** | Platform only; AI drawn from a **shared hospital credit wallet** (pay-as-you-go, admin tops up) | Hospitals unsure of AI usage / cost-conscious; uses the credits engine (built) |
| **Pro** | **₹699** | ₹15/seat/day AI allowance, **pooled org-wide**; moderate imaging | Predictable monthly for typical AI use |
| **Ultimate** | **₹1,299** | High / uncapped fair-use AI, **all imaging modules**, priority models | Imaging-heavy, teaching, apex hospitals |

**Hospital price = seats × per-seat × (1 − volume discount).** Two dials, fully flexible.

Worked examples (🔧 illustrative):
- Community, 15 seats, **Pro**: 15 × ₹699 × 0.90 ≈ **₹9,435/mo**.
- Secondary, 40 seats, **Ultimate**: 40 × ₹1,299 × 0.80 ≈ **₹41,568/mo**.
- Clinic, 3 seats, **Credits-base**: 3 × ₹299 = ₹897/mo + a ₹2,000 starter AI wallet.

### Add-on inclusion by AI plan

| Add-on | Credits-base | Pro | Ultimate |
|---|---|---|---|
| Ward Sync (basic Connect / GHIS pull) | ✅ | ✅ | ✅ |
| OPD Queue + EMR | ✅ | ✅ | ✅ |
| Imaging AI (FundX / KardioX / ThoreX / SknX) | wallet pay-go | fair-use | ✅ full |
| Connect **full** interop (FHIR/HL7/DICOM/ABDM + AI field mapping) | add-on | add-on | ✅ included |
| FollowCare (post-discharge) | add-on | basic included | ✅ full included |
| White-label branding | add-on | add-on | ✅ included |
| Analytics / admin dashboards / API-SDK | add-on | add-on | ✅ included |
| Priority / dedicated support + training + SLA | — | email | ✅ dedicated |

**Institution coupons (built):** a hospital that pays for its doctors gets admin-issued codes; each doctor redeems in-app to unlock their seat; revocable anytime (revoke never nukes a doctor who separately paid). This is the mechanism for "institution pays for their doctors."

---

## 6. Complete feature → tier matrix (A–Z)

Legend: **F**=Free · **S**=Student ₹199 · **P**=Pro ₹499 · **U**=Ultimate ₹1,199 · **H**=Hospital (team platform, all AI plans) · **+**=paid add-on · 💰=AI-metered.

| Feature | Tier | Note |
|---|---|---|
| Differential-diagnosis reasoning engine + workspace | **F** | flagship hook, cheap |
| Antibiotic engine + AWaRe + antibiogram (view) | **F** | |
| Hospital antimicrobial-policy overlay | **H** | hospital-specific |
| Drug database + interaction/QT/renal/bleeding safety | **F** | safety = never blocked |
| OCR scan a prescription/case sheet | **F** taste → **P** 💰 | free 3/day, then Pro |
| All calculators + electrolytes + renal dosing | **F** | |
| Insulin dosing CDSS (correction/meal/basal, DKA, peds) | **F** | 🔧 staged (flag off) |
| Infusion / vasopressor calculator + Nurse Mode | **H** | ICU/team |
| MaiK Ask / Explain (core) | **F** taste → **S/P/U** 💰 | daily ₹ cap by tier |
| MaiK Instant KB engine (Tier-0) | **F** | deterministic, ∞ |
| MaiK Deep Review / Clinical Case | **P/U** 💰 | |
| MaiK Patient Summary | **P/U** 💰 | Pro-only |
| MaiK Research / Evidence Review | **P** (10/day) / **U** (∞) 💰 | |
| MaiK conversation threads / history | **F** | on-device |
| Voice: clinical dictation (Whisper) | **P/U** | on-device = free to serve |
| MaiK Scribe (voice → EMR fill) | **P/U** | time-capped |
| Voice consult / ambient / diarization | **P/U** 💰 | |
| TTS read-aloud | **P/U** 💰 | |
| FundX (fundus AI) | **U** / **H**-Ultimate / **+** 💰 | 🔧 staged |
| KardioX (ECG AI) + Learn atlas | atlas **F/S**; ECG AI **U/H/+** 💰 | 🔧 staged |
| ThoreX (chest X-ray) | **U/H/+** 💰 | 🔧 staged |
| SknX (dermatology) | **U/H/+** 💰 | 🔧 staged |
| ICU workstation (all tabs) | **H** | team |
| ICU collaboration (rounds/tasks/timeline) | **H** | |
| Lab Watch 24/7 alerts | **P/U** (solo) / **H** | server polling cost |
| OPD Queue + EMR + display + billing | **H** (+billing add-on) | |
| Oncology reference hub | **F** | reference only |
| Oncology treatment-plan execution (role-split) | **H** | |
| Connect — Ward Sync (basic) | **H** | |
| Connect — full interop (FHIR/HL7/DICOM/ABDM) | **H**-Ultimate / **+** | |
| Connect — AI field mapping | **H** **+** 💰 | |
| FollowCare (post-discharge) | **H** (Ultimate incl / **+**) | |
| Knowledge Base + guidelines + offline + updates | **F** | |
| Knowledge Units / streaks / engagement | **F** | |
| Specialty workspaces (7 specialties) | **F** | |
| Personal Clinic EMR (on-device) | **F** (1 device) → sync **P/U** | |
| Shared Clinic EMR (small team) | **P/U** or **H** | 🔧 staged |
| My Cases + cross-device sync | save **F**; sync **P/U** | |
| Wearable (Apple Watch / Wear OS) | **P/U** | |
| AI Control Center (governance) | **H**/owner | admin |
| Steward ID / verification / onboarding / support | **F** | |

---

## 7. AI economics & the credit model (anti-bankruptcy)

- **Daily rupee cap per user/role** (`AI_DAILY_COST_CAP_<ROLE>` / per-user override) is the hard floor on our exposure. Suggested caps: Free ₹0.5 · Student ₹6 · Pro ₹15 · Ultimate ₹40 · Hospital-Pro ₹15/seat pooled · Hospital-Ultimate ₹40/seat or uncapped fair-use.
- **Credits** (`CREDIT_CONVERSION=0.5`): buy ₹50 → get ₹25 of AI allowance, spent only above the daily cap. This is the pay-as-you-go safety valve so a doctor is never hard-blocked, and it captures revenue from the true power users. Hospitals on Credits-base run their whole AI off one shared wallet.
- **On-device voice is free to serve** → dictation/Scribe can be "unlimited" without cost risk. Big differentiator vs competitors who pay per voice-minute.
- **Answer cache** (zero-token KV cache of generic questions, never PHI) already cuts repeat-question cost to ₹0.

---

## 8. Guardrails (non-negotiable)

- Safety warnings already computed (interactions, renal/hepatic/QT, organ-safety overlay, critical-value flags) are **never** hard-paywalled.
- Over a cap, the app shows "AI limit reached — add credits / upgrade / wait for reset," never a dead end (built: the `429 ai-cost-cap` sheet).
- Enforcement flips only **after** a real payment test-purchase succeeds (see §9). Until then everyone stays free — no lockouts.

---

## 9. What must happen before we can charge (maps to what's already built)

Everything below is coded and inert behind the launch promo. To go live you provide/decide, then we flip:

1. **Confirm this document** (edit the 🔧 items — prices, seat counts, caps, trial cutover, free/paid line).
2. **Prices** into `/billing/plans` + role caps (`PRO_PRICE_*`, `AI_DAILY_COST_CAP_<ROLE>`).
3. **Payment creds**: PhonePe/Razorpay are wired for web; native needs Play + Apple store products + creds + a StoreKit/Play-Billing plugin on the client.
4. **Test-purchase** succeeds on ≥1 path.
5. **Flip**: set `PRO_FREE_UNTIL` to a past date + `AI_COST_CAP_ON=1` + `FEATURES_ON=1` + `MAIK_ENFORCE_CAPS=1`.

Built and ready to carry this model: roles (student/intern/resident/co_resident/physician/physician_pro), per-user/role rupee cost cap, credits (₹50→₹25), co-resident/hospital shared AI pool, institution coupons, admin console (Pro tab: coupons + credits + cost-cap + pool), IAP verification adapters (Google + Apple).

---

## 10. Open decisions for you (my recommendation in **bold**)

1. **Free-tier AI taste size** — **₹0.5/day (~15 answers)**. More = better hook, higher cost.
2. **Does Free get any imaging AI?** — **No** (too expensive; imaging is the paid differentiator).
3. **Imaging AI in individual Pro?** — **Yes, fair-use 20/day**; heavy → Ultimate/credits.
4. **Hospital per-seat prices** — **₹299 / ₹699 / ₹1,299** (Credits/Pro/Ultimate). Tune to market.
5. **Included seats per bed tier** — as in §5. Generous drives adoption.
6. **Trial cutover date** — resolve the Sep 15 vs Sep 25 gap; **use Sep 15**.
7. **Annual discount** — **~2 months free** (₹499→₹3,999/yr).
8. **Student verification** — require NMC-trainee/college proof for ₹199 (prevents attendings taking the cheap tier).

*Mark this up and hand it back — I'll turn your edits into the live price list + the enforcement flip.*
