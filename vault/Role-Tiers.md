---
tags: [plan, billing, entitlements, cross-cutting]
status: PROPOSED (audit 2026-09-26), nothing enforced, owner decisions pending
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
| MaiK cloud AI (monthly tokens) | 5k | cap (low) | cap (low) | shared pool | 1M | 3M | 3M+ |
| CliniX (history, exam, OSCE, viva) | Respiratory only | Y (MBBS viva) | Y | Y (PG viva) | Y (PG viva) | Y | Y |
| KardiQ X **Learn** atlas + quiz | sample | Y | Y | Y | Y | Y | Y |
| RadioAnatome + 3D | Y | Y | Y | Y | Y | Y | Y |
| SURGX protocols / procedures / cases | Y | Y | Y | Y | Y | Y | Y |
| Dx My Patient / Start Case | L | L | Y | Y | Y | Y | Y |
| Imaging AI reads per day (ThoreX, KardiQ X AI, SknX, FundX) | 2 | 4 (L) | 4 (L) | 4 | 10 | 10 | 20 |
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
| MaiK Scribe (ward / discharge / OPD dictation) | - | - | - | - | Y | Y (50 credits) | Y (50 credits) |
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
| FollowCare / MAiTRI | - | - | - | - | - | Y (5 care credits) | Y (5 care credits) |
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
| Free, UG Student, Intern, Resident Pro, Clinician, Clinician Pro | 2 | 1 phone + 1 tablet. A second phone evicts the first phone, never the iPad. |
| Co-Resident | 2 | any class (two phones allowed), one login per the owner brief |

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
  and need no personal plan.
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
- **P0 Money and safety bugs (no plan change).** Fix 1, 2, 3, 7. Unit tests in
  `test/*.test.mjs` for `fulfilPurchase` add-on paths and `doApprove` by role.
- **P1 Role capture.** Verification chooser: student / intern / resident / doctor. Approve and
  auto-verify write `entitlements.role`. Residents: NMC auto-verify for the registration, plus a PG
  admission proof for the `resident` role. Students/interns get a `trainee` claim, never `verified`.
- **P2 One source of truth.** Pro claim becomes derived from `tier` (any paid tier = `pro:true`).
  Add admin `set-plan` (tier + expiry). Relabel in paywall + pro-notice + account screens only; keys
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

## 8. Owner decisions needed
- **D1 Co-Resident "one login".** Code today = two accounts sharing one AI pool (`seats:2`,
  `/billing/pool/link`). One shared login breaks identity: the PG logbook is a legal personal record,
  and verification, Rx and audit trails name ONE doctor. Recommendation: keep two logins on one
  subscription, one device each (the pair still pays Rs 299 total).
- **D2 Student vs Intern price.** One Trainee price (recommended) or two.
- **D3 Existing Pro subscribers.** Grandfather as Clinician features until renewal, or move to
  Resident Pro.
- **D4 Final prices.** Resolve finding 7; confirm Resident Pro / Clinician / Clinician Pro amounts.
- **D5 Beta imaging AI for Clinician.** Clinician Pro only (current) or all Clinician.
- **D6 Free plan devices.** 1 phone + 1 iPad like paid plans, or phone only.
- **D7 WardSynQ.** Extra doctor seat price beyond 2; beds rounding (101 beds = 2 x Rs 299?);
  who holds hospital backups (S1).

Related: [[StewardMD ID]] (access tiers), [[AI Control Center]], [[WardSynQ]], [[NMC Logbook]],
[[OPD Queue]], [[Decisions]], `docs/PRICING_PACKAGING.md`.
