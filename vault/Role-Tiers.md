---
tags: [plan, billing, entitlements, cross-cutting]
status: owner decisions D1 D2 D3 D6 taken 2026-09-26; prices PROPOSED; nothing enforced
flags: ROLE_GATES_ON (unset), FEATURES_ON (unset), ENTITLEMENTS_ON (unset), DEVICE_LOCK_ON ("0")
---
# Role-based plans: audit and plan

Owner brief (2026-09-26): plans for **UG Student, Intern, Co-Resident (one login, two devices),
Resident Pro, Clinician, Clinician Pro**, plus **WardSynQ** (coming soon, Rs 299/month, "cheapest
EMR", per 100 beds, 2 doctors). Every plan other than Co-Resident = two devices, **one phone + one
iPad**. Clinician = everything, private clinic data on the doctor's own Google Drive. Clinician Pro =
everything plus our cloud.

## 1. What already exists (most of this is built and inert)
Two axes, not yet joined:
- **Pro claim** (`functions/_entitlement.js`, boolean `pro` + `proExp`). This is the ONLY gate
  actually enforced today (402 `needsProBody` on cloud-sync, lab-watch, queue-branding, AI budget).
- **Role + purchase tier** in Firestore `entitlements/{uid}` (`functions/_entitlements.js`):
  - `ROLES` = pro, physician, physician_pro, resident, co_resident, intern, student (WHO you are)
  - `TIERS` = free < trainee < coresident < pro < physician < physicianpro (WHAT you paid for)
  - Role x tier feature matrix in `functions/_features.js` `FEATURE_REGISTRY`, live only when
    `ROLE_GATES_ON=1` (unset). `deviceLimit()` / `clinicLimit()` exist; device lock is record-only
    (`DEVICE_LOCK_ON="0"`).

So the owner's ladder maps almost 1:1 onto existing keys. **Keep the internal keys, change the
labels** (App Store / Play product IDs are immutable, and paid users already hold these tiers).

| Owner's plan | Tier key (bought) | Role (verified) | Product ID today | Code price (m / yr) |
|---|---|---|---|---|
| Free (verified, no plan) | `free` | any | none | 0 |
| UG Student | `trainee` | `student` | `in.stewardmd.trainee.*` | 199 / 1,999 |
| Intern | `trainee` | `intern` | same | same |
| Co-Resident | `coresident` | `co_resident` | `in.stewardmd.coresident.*` | 299 / 2,999 |
| Resident Pro | `pro` (relabel) | `resident` | `in.stewardmd.pro.*` | 599 / 5,999 |
| Clinician | `physician` (relabel) | `physician` | `in.stewardmd.physician.*` | 749 / 7,499 (see 6.4) |
| Clinician Pro | `physicianpro` (relabel) | `physician_pro` | `in.stewardmd.physicianpro.*` | 899 / 8,999 (see 6.4) |
| **Ultimate** (friends and testers, never sold) | `ultimate` (NEW, above physicianpro) | any | none (admin grant only) | 0 |
| WardSynQ | NOT a user tier: a hospital tenant plan | n/a | none | 299 / month (owner) |

Recommendation: UG Student and Intern stay **one Trainee price**; the verified role decides which
features light up (this is the existing design, Decisions 2026-09-18 "purchase tier is separate from
verification role"). Split them into two prices only if the owner wants Intern priced differently.

## 2. Who gets what
Legend: **Y** = included, **-** = not included, **cap** = included with a limit, **L** = learning /
educational mode only (labelled, no clinical action).

### Learning and reference
| Feature | Free | UG Student | Intern | Co-Resident | Resident Pro | Clinician | Clinician Pro |
|---|---|---|---|---|---|---|---|
| Knowledge Library, Protocols, Antibiogram, Calculators, Drug DB, ICD, Govt Schemes, Search | Y | Y | Y | Y | Y | Y | Y |
| On-device MaiK (Decisions 2026-09-20: free for all) | Y | Y | Y | Y | Y | Y | Y |
| MaiK cloud AI (MaiK Tokens / month, section 10) | 10k | 24k | 24k | 40k shared | 72k | 100k | 160k |
| CliniX (history, exam, OSCE, viva) | Respiratory only | Y (MBBS viva) | Y | Y (PG viva) | Y (PG viva) | Y | Y |
| KardiQ X **Learn** atlas + quiz | sample | Y | Y | Y | Y | Y | Y |
| RadioAnatome + 3D | Y | Y | Y | Y | Y | Y | Y |
| SURGX protocols / procedures / cases | Y | Y | Y | Y | Y | Y | Y |
| Dx My Patient / Start Case | L | L | Y | Y | Y | Y | Y |
| Imaging AI reads per month (ThoreX, KardiQ X AI, SknX, FundX) | 5 | 15 (L) | 15 (L) | 16 shared | 50 | 60 | 100 |
| Imaging AI beta without access code | - | - | - | - | - | - | Y |

### Bedside clinical
| Feature | Free | UG Student | Intern | Co-Resident | Resident Pro | Clinician | Clinician Pro |
|---|---|---|---|---|---|---|---|
| Scan Meds / interactions | Y | Y | Y | Y | Y | Y | Y |
| Code Blue + Watch CPR | Y | L | Y | Y | Y | Y | Y |
| Insulin CDSS (trained-clinician ack) | - | - | Y | Y | Y | Y | Y |
| Specialty Kits | - | L | Y | Y | Y | Y | Y |
| Clinical Documents (certs, consent, referral) | - | - | draft, no Reg. No. | Y | Y | Y | Y |
| Prescription pad + RxChoice (needs FULL registration) | - | - | - | Y | Y | Y | Y |
| SURGX operative notes (PHI) | - | - | Y | Y | Y | Y | Y |
| Cross-device case sync | - | Y | Y | Y | Y | Y | Y |
| MaiK Scribe (ward / discharge / OPD dictation) | - | - | - | - | 40 notes | 200 consults | 300 consults |
| Lab Watch (Apple Watch) | - | - | - | - | Y | Y | Y |
| Oncology (ONCQIS, OncoTree, staging) | Y | Y | Y | Y | Y | Y | Y |
| Oncology AI extras | add-on | add-on | add-on | add-on | add-on | add-on | add-on |

### Team and hospital work
| Feature | Free | UG Student | Intern | Co-Resident | Resident Pro | Clinician | Clinician Pro |
|---|---|---|---|---|---|---|---|
| ICU & Ward units (join by invite) | - | - | member | Y | Y | Y | Y |
| Ward Sync (GHIS) | - | - | - | Y | Y | Y | Y |
| Colleagues: referrals, I-PASS handover, case rooms (both sides reg-verified) | - | - | - | Y | Y | Y | Y |
| NMC PG eLogbook (PGMER-2023, PG only) | - | - | - | Y | Y | - | - |
| Review Desk (approve AI-drafted content) | - | - | - | - | - | Y | Y |

### Own practice
| Feature | Free | UG Student | Intern | Co-Resident | Resident Pro | Clinician | Clinician Pro |
|---|---|---|---|---|---|---|---|
| OPD Queue + EMR, MaiK Ask, billing, branding | - | - | - | - | - | Y | Y |
| FollowCare / MAiTRI | - | - | - | - | - | Y (patient packs) | Y (patient packs) |
| Clinics included (Rs 139/clinic/mo beyond) | 0 | 0 | 0 | 0 | 0 | 4 | 6 |
| Clinic data on device + doctor's own Google Drive | - | - | - | - | - | Y | Y |
| Clinic data on StewardMD cloud (hosted, we hold PHI) | - | - | - | - | - | - | Y |

Reasoning behind the non-obvious rows:
- **Resident Pro gets no clinics / OPD.** PG residents in India are full-time under PGMER and may not
  run a private practice; the clinic rows are what separate Resident Pro from Clinician, so a
  consultant cannot buy the cheaper plan and get the practice tools. Scribe moves INTO Resident Pro
  (discharge summaries are resident work) to make the step up from Co-Resident worth paying for.
- **Intern gets no Rx pad and no PG logbook.** Interns hold provisional registration (Rx pad needs a
  full-register match) and PGMER logbook is PG only. A CRMI intern logbook is not built (Roadmap).
- **Students get learning surfaces only.** No PHI-writing, prescribing, or unit membership.
- **Clinician "gets all"** = every stable feature. Beta imaging AI without a code stays Clinician
  Pro only (Decisions 2026-09-18) unless the owner says otherwise (decision D5).

## 3. Devices: one phone + one iPad
| Plan | Slots | Rule |
|---|---|---|
| Free, UG Student, Intern, Resident Pro, Clinician, Clinician Pro, Ultimate | 2 | 1 phone + 1 tablet. A second phone evicts the first phone, never the iPad. |
| Co-Resident | 1 per login | two logins on one subscription, one device each (D1) |

Not counted: Apple Watch (paired through the phone, no sign-in), wardsynq.com staff logins
(tenant-scoped).

What has to change (today: `_devices.js` stores `[{id, at}]` in KV `dev:<uid>`, newest wins, limit
keyed on **role** not tier, id is a localStorage UUID):
1. Client reports a device **class** (`phone` / `tablet`) with the id. Use the Capacitor Device
   plugin `model` (UA sniffing is wrong on iPadOS, which reports as a Mac). Android tablet = smallest
   screen side >= 600dp.
2. Server stores `{id, cls, at}` and evicts within the same class; slot rules keyed on the **tier**.
3. Swap cooldown (proposal: at most 3 new devices per 30 days) so two people cannot rotate one login.
4. Flip `DEVICE_LOCK_ON` only after a shadow period that logs would-be evictions.

## 4. Where data lives, per plan
| Plan | Clinical data | Server holds PHI? |
|---|---|---|
| Student, Intern | device only (learning progress, SURGX notes for interns device-encrypted) | no |
| Co-Resident, Resident Pro | device + existing unit/logbook stores (Firestore, encrypted) | only what the unit/logbook already stores |
| Clinician | device + **doctor's own Google Drive** (`drive.file` scope) | no |
| Clinician Pro | device + Drive + **StewardMD cloud** (`clinic_hosted`) | yes |

Gap for Clinician on phone + iPad: `personal-clinic.js` (My Clinic, ON) is single-device localStorage
in plaintext with encrypted Drive backup/restore only. Two devices on one clinic need the **Shared
Clinic** Drive-delta sync (`clinic-*.js`, flag `smd_shared_clinic` OFF, never device-proven). That
must be proven on a real iPhone + iPad before Clinician is sold as "phone + iPad".

Gap for Clinician Pro: hosting clinic PHI is the open owner decision S1 ("where the record backups
live, and who holds them", Decisions 2026-09-16) plus DPDP duties. `clinic_hosted` has a matrix
row but no storage behind it.

## 5. WardSynQ (hospital plan, coming soon)
- A **tenant** entitlement (per hospital), not a user tier: `{beds, doctorSeats, planExp}` on the
  WardSynQ tenant, checked by the tenant routes. Owner brief: Rs 299/month per 100 beds with 2
  doctor seats. Nurses, reception, pharmacy, lab etc. sign in with staff email/PIN under the tenant
  and need no personal plan. Price model at 80% margin: section 11.
- Doctors in a WardSynQ hospital use StewardMD with their own plan; the hospital seat covers the
  WardSynQ record, not the doctor's personal StewardMD features.
- "Coming soon" = a waitlist tile + form only. All flags stay OFF (`smd_wardsynq`, `_shadow`,
  `_cutover`, `smd_wsq_push`): nothing is clinically approved, 0 of 16 threshold packs signed off,
  inpatient screens never run on a phone ([[WardSynQ]]).
- Conflicts to resolve: `docs/PRICING_PACKAGING.md` section 6 prices hospitals per doctor seat
  (Rs 399-1,499/seat, 15 minimum seats for 26-100 beds). Rs 299 per 100 beds is roughly 50x lower.
  Hosting, backups (S1) and hospital MaiK must be costed against it; hospital MaiK stays off by
  default and metered separately.

## 6. Audit findings to fix BEFORE enforcing anything
Verified in code 2026-09-26:
1. **Add-on purchases grant a full month of Pro.** `fulfilPurchase`
   (`functions/api/billing/[[path]].js:116`) routes `addon:onco` (Rs 89) and `addon:clinic` (Rs 139)
   to the `grantPro()` fallthrough, then records the add-on. Same class of bug the token packs and
   msg tiers already had. Add-ons must return before `grantPro`.
2. **Onco add-on iOS product ID mismatch.** Client sends `in.stewardmd.onco.monthly`
   (`pro-paywall.js:106`); server expects `in.stewardmd.addon.onco` (`planKeyFromProductId`). The iOS
   add-on grants Pro (via 1) but never sets `oncoAddonExp`.
3. **Owner approval of a student/intern writes `verified:true`.** `doApprove`
   (`functions/api/verifications/[[path]].js:86`) ignores the stored role, and the Rx pad gates only
   on `verified` (`prescription.js:55`). An approved medical student can prescribe with a
   "registration number" that is a college ID. Verification copy promises the opposite.
4. **Verification role never reaches `entitlements/{uid}.role`.** Only admin `set-role` writes it,
   so every role-keyed rule (device limit, clinic limit, AI budget promax, PG logbook) sees `null`.
   The chooser also has no separate "resident" (it is "Intern / Resident").
5. **PG logbook matrix is wrong both ways.** `pglog` admits role `intern` (PGMER is PG only) and
   omits tier `pro`, so a Resident Pro payer would be refused their own logbook.
6. **`deviceLimit` / `clinicLimit` key on role, not tier.** Role `pro` gets 2 clinics; after the
   relabel that is Resident Pro, which should get 0.
7. **Three different price tables.** Code defaults Physician 749 / Physician Pro 899;
   `wrangler.toml` env 1,499 / 2,499; `_pricing.js` 1,499 / 2,499; KV `billing:cfg` unknown. Pick one
   (server `plans()` is the stated source, Decisions 2026-09-18).
8. **No admin endpoint sets the purchase `tier`.** Comp / test / institution accounts can only get
   the Pro claim, which the matrix ignores.
9. **Per-module daily AI caps ignore tier** (`_ai_usage.js`); only the monthly token budget varies.
10. **Launch promo ends 2026-09-27 23:59 IST** (`PRO_FREE_UNTIL`): until then guests are Pro on the
    server. Enforcement work lands after that date anyway.
11. **KardiQ X Learn is behind the KardiQ X AI access code** (`smd_kardiox` def false since
    2026-09-25), so students cannot reach the atlas. Learn must be gated separately from the AI.
12. `student` plan `requiresVerify:true` is declared but not enforced.

## 7. Implementation plan (each phase behind a flag, recovery tag first)
- **P0 Money and safety bugs (no plan change).** Fix 1, 2, 3, 7 and 13 (token packs re-sized, section 10). Unit tests in
  `test/*.test.mjs` for `fulfilPurchase` add-on paths and `doApprove` by role.
- **P1 Role capture.** Verification chooser: student / intern / resident / doctor. Approve and
  auto-verify write `entitlements.role`. Residents: NMC auto-verify for the registration, plus a PG
  admission proof for the `resident` role. Students/interns get a `trainee` claim, never `verified`.
- **P2 One source of truth.** Pro claim becomes derived from `tier` (any paid tier = `pro:true`).
  Add admin `set-plan` (tier + expiry), the `ultimate` tier, and the reviewed Ultimate migration (section 9). Relabel in paywall + pro-notice + account screens only; keys
  and product IDs unchanged. Grandfather current `pro` subscribers who are consultants (D3).
- **P3 Matrix.** Update `FEATURE_REGISTRY` to section 2; fix `pglog`; add tier-based
  `deviceSlots` / `clinicLimit`. Ship the resolved feature list in `/billing/status` so the client
  (`SMD_PRO`, `home.js` tile `eligible()`) reads the server's answer instead of re-deriving it. New
  `ROLE_GATES_SHADOW=1` logs would-deny decisions for 2 weeks before `ROLE_GATES_ON=1`.
- **P4 Devices.** Section 3. Shadow first, then `DEVICE_LOCK_ON=1`.
- **P5 Clinician on Drive.** Prove Shared Clinic sync on iPhone + iPad; encrypt My Clinic at rest.
- **P6 Clinician Pro hosted.** Blocked on S1 + DPDP review.
- **P7 WardSynQ.** Waitlist tile now; tenant plan record + seat check when the owner releases it.
Each client phase: headless-browser test of the paywall and gated tiles per plan before build.

## 8. Owner decisions (2026-09-26)
- **D1 Co-Resident: TAKEN.** One subscription, two logins (one per resident), one device per
  login. Keeps the PG logbook, verification and Rx tied to one named doctor. The existing
  `seats:2` + `/billing/pool/link` design stays.
- **D2 Student and Intern: TAKEN.** One Trainee price; the verified role decides the features.
- **D3 Existing Pro holders: TAKEN.** Every account holding the `pro` claim today moves to a new
  **Ultimate** tier: everything, for the owner's friends and testers. See section 9.
- **D4 Prices: TAKEN as "owner asked for a price model at 80% margin".** Proposal in section 10.
- **D5 Beta imaging AI without an access code: OPEN** (owner asked what it is; explained in chat).
  ThoreX (chest X-ray), KardiQ X AI (ECG), SknX (skin), FundX (retina): unvalidated models, locked
  behind an access code since 2026-09-25. Today Clinician Pro skips the code. Recommendation:
  Clinician Pro + Ultimate skip the code; everyone else needs one.
- **D6 Free plan devices: TAKEN.** Phone + iPad, same as paid plans.
- **D7 WardSynQ: owner asked for a price model at 80% margin.** Proposal in section 11.

## 9. Ultimate (friends and testers)
- New tier key `ultimate`, ranked above `physicianpro`. **Never sold**: no product ID, not in
  `plans()`, not on the paywall. Granted only by the owner through the admin `set-plan` endpoint
  (finding 8 has to be built first).
- Gets every feature in section 2 plus beta imaging AI without a code. Legal gates still apply:
  the Rx pad still needs a full-register match and the PG logbook still needs a verified PG role.
- Devices: phone + iPad. Clinics: 10.
- Fair-use AI pool Rs 300/month per account (600,000 MaiK Tokens), may use Deep mode (section 12).
  Worst case cost = Rs 300 x number of Ultimate accounts per month; it is a marketing budget line.
- **Migration, reversible:** a script lists every account with `pro:true` and its `source`
  (owner, admin grant, coupon, subscription) for the owner to review BEFORE writing anything; then
  writes `tier:"ultimate"` with `tierExp` = the current `proExp` (forever stays forever). The `pro`
  claim is left in place, so rolling back = deleting the tier field. Real paying IAP subscribers,
  if any, are flagged separately rather than silently converted.
- Naming clash to fix in the docs: `docs/PRICING_PACKAGING.md` section 6 already uses "Ultimate" for
  a hospital AI plan, and "U" for Physician Pro elsewhere in that doc.

## 10. Price model (PROPOSED): 80% gross margin at FULL use of every allowance
Method: the included allowance of each plan, burned to 100%, must cost us at most 20% of what we
keep. What we keep on iOS / Play = price / 1.18 (GST inclusive) x 0.85 (15% store fee); on web
= price / 1.18 x 0.98 (2% gateway). iOS is the worst channel, so the allowances are sized for it;
web margins come out 2-3 points higher.

Cost basis (code: `functions/_ai_usage.js` `MODEL_RATES`, `docs/PRICING_PACKAGING.md` section 2):
MaiK answer Rs 0.04 average (gemini-2.5-flash), imaging read Rs 0.40, on-device dictation Rs 0,
Scribe consult **Rs 0.50 ASSUMED** (on-device Whisper + cloud structuring; Rs 6 if it falls back to
cloud audio at Rs 0.02/s), MaiK Ask interview Rs 0.20, FollowCare episode Rs 22 (call + SMS).
**Assumed, not measured:** platform overhead Rs 8/user/month, OPD infra Rs 10, hosted clinic Rs 50.
Recalibrate every number from AI Control Center actuals after 30 days of real use.

| Plan | Price / month | Annual (web) | Included per month | Cost at full use | Margin iOS | Margin web |
|---|---|---|---|---|---|---|
| Free | 0 | - | 10,000 MT (~125 answers), 5 imaging reads | Rs 15 (acquisition) | - | - |
| Trainee (UG Student / Intern) | **199** | 1,990 | 24,000 MT (~300 answers), 15 imaging reads | Rs 26 | 81.9% | 84.3% |
| Co-Resident (2 logins) | **299** | 2,990 | 40,000 MT shared (~500 answers), 16 imaging reads shared | Rs 42 | 80.3% | 82.9% |
| Resident Pro | **599** | 5,990 | 72,000 MT (~900 answers), 50 imaging reads, 40 dictated notes | Rs 84 | 80.5% | 83.1% |
| Clinician | **1,499** | 14,990 | 100,000 MT, 60 imaging, 200 Scribe consults, 50 MaiK Ask | Rs 202 | 81.3% | 83.8% |
| Clinician Pro | **2,499** | 24,990 | 160,000 MT, 100 imaging, 300 Scribe, 50 MaiK Ask, hosted clinic | Rs 348 | 80.7% | 83.2% |
| Ultimate | not sold | - | 600,000 MT fair use, everything | up to Rs 300 | - | - |

- Annual = 10 x monthly ("2 months free") holds 80% only on web (79.5-81.1%). On iOS offer annual at
  11 x monthly ("1 month free", about 79.6%), or accept about 77% there. Push annual to web.
- Clinician and Clinician Pro return to the signed-off v3 prices (Rs 1,499 / 2,499), which also
  resolves finding 7: the Rs 749 / 899 code defaults cannot carry Scribe + OPD at 80%.
- FollowCare stays **included as a feature** in Clinician and above, but patients are billed as
  packs: at Rs 22 per episode an included quota breaks 80%. See the pack table.
- Over any allowance: top-up packs or upgrade, never a hard lockout (existing principle).

Packs and add-ons (margin iOS / web):

| Item | Today | Margin today | Proposed | Margin proposed |
|---|---|---|---|---|
| MaiK Boost | Rs 49 = 50,000 MT | 29% / 39% | Rs 49 = 10,000 MT | 86% / 88% |
| MaiK Plus | Rs 199 = 250,000 MT | 13% / 24% | Rs 199 = 40,000 MT | 86% / 88% |
| MaiK Power | Rs 499 = 750,000 MT | **-4% (loss) / 10%** | Rs 499 = 100,000 MT | 86% / 88% |
| FollowCare 25 patients | Rs 2,499 (web 2,199) | 69% / 70% | Rs 3,799 (web 3,299) | 80% / 80% |
| Onco add-on | Rs 89 | 92% / 93% | keep | |
| Extra clinic | Rs 139 | 97% | keep | |

- **Finding 13: the MaiK Power pack loses money on iOS** and every token pack is under 40% margin,
  because packs are sold at 2,000 MT per rupee of price while 2,000 MT is also one rupee of our cost.
- FollowCare at 80% needs about Rs 150 per patient on iOS. The lever is cost, not price: a
  WhatsApp-first flow with a voice call only on a red flag would cut the Rs 22 episode sharply
  (the WhatsApp per-message rate must be confirmed before quoting it).
- Scribe packs (Rs 999 / 50, Rs 3,999 / 250) are fine if the Rs 0.50 consult cost holds; if the
  cloud-audio fallback is common they drop to about 72%. Measure before repricing.

## 11. WardSynQ price model (PROPOSED)
Sold B2B: quoted ex-GST with 18% on the invoice, paid on web (2% gateway), no store fee.
Cost basis, **all assumed**: Rs 20/hospital/month fixed (backups, monitoring), Rs 0.75/bed/month
(D1 writes and storage, push), Rs 5/doctor seat/month. Nurses and staff cost about nothing.

| Model | Price | Cost | Margin |
|---|---|---|---|
| Owner's brief: Rs 299 / month for 100 beds, 2 doctors | 299 | Rs 105 | 64%, before any support |
| **Proposed: Rs 299 per block of 25 beds / month, 2 doctor seats per block** | 25 beds 299, 100 beds 1,196, 300 beds 3,588 | 49 / 135 / 365 | 83% / 89% / 90% |

- Headline stays "EMR from Rs 299/month"; a 100-bed hospital pays Rs 1,196 (about Rs 12 per bed).
- Unlimited nurses, reception, pharmacy, lab and billing staff at no charge (adoption driver).
- Extra doctor seat Rs 149/month (97%).
- Hospital MaiK: off by default; Rs 399 per doctor seat per month, with a Rs 78 AI pool (about
  156,000 MT) per seat to hold 80%.
- Onboarding self-serve free; assisted onboarding + data migration Rs 4,999 one time; priority
  support Rs 999/month.
- Annual prepaid: 2 months free (web, so about 80% holds).
- "Cheapest EMR" is a comparative claim: ASCI requires it to be substantiated before it is used
  in advertising. Say "from Rs 299/month" until a documented comparison exists.
- Still "coming soon": nothing clinically approved, flags OFF (section 5).

## 12. AI model per plan (PROPOSED)
| Plan | On device | Cloud default | Deep mode |
|---|---|---|---|
| Free, Trainee | yes | gemini-2.5-flash (flash-lite once it is verified end to end: it 404s on one route today, `_ai_usage.js:373`) | no |
| Co-Resident, Resident Pro, Clinician | yes | gemini-2.5-flash | no |
| Clinician Pro, Ultimate | yes | gemini-2.5-flash | gemini-2.5-pro for deep review / research, debited from the pool at its real rate (about 40x flash per answer) |

- Gemini 3.x rates in `MODEL_RATES` are marked `est: true`; no plan is priced on them until Google
  publishes the rates and `AI_RATE_*` is set.
- PHI calls stay on the regional `asia-south1` endpoint for every plan (existing rule).
- One meter: today there are two (model-token budget in `_aibudget.js`: free 5k, Pro 1M,
  Physician 3M; and the inert rupee cost cap). The allowances above are rupee pools shown as
  MaiK Tokens; implementing them means moving the budget to the rupee meter.

Related: [[StewardMD ID]] (access tiers), [[AI Control Center]], [[WardSynQ]], [[NMC Logbook]],
[[OPD Queue]], [[Decisions]], `docs/PRICING_PACKAGING.md`.
