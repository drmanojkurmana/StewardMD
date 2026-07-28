# FollowCare AI — User Journey Maps
Phase 0 deliverable #3. End-to-end journeys with the touchpoints, system events, and (in brackets) the reused/new StewardMD component behind each step.

---

## Doctor journey (inside StewardMD)
```
Admission → Treatment → Discharge decision
   │  [existing StewardMD patient/ICU workflow]
   ▼
Open patient → "Enroll in FollowCare AI"        [NEW module button on patient page]
   │  auto-fills diagnosis/discharge date/mobile/doctor/hospital from patient data
   ▼
Confirm enrollment (<30s) + consent captured    [reuse SMD_CONSENT; NEW episode record]
   │  → server issues episodeId; schedules assessments; queues first message
   ▼
FollowCare Dashboard (once/morning)             [NEW module + reuse dashboard UI patterns]
   │  AI Smart Queue: sickest first (P2/P3)
   ▼
Review Alert card (30-sec summary)              [P2 AI summary; P1 raw responses]
   │  acts: reassure / teleconsult / review / pause / extend
   ▼
Close / Archive episode → "Recovered"           [NEW episode lifecycle]
```
**Doctor never installs anything new** — FollowCare is a module in the app they already use. Morning digest (push/email) replaces per-patient polling (Phase 3).

---

## Patient journey (link-only, no app)
```
Hospital discharge → enrolled by doctor
   ▼
Receives branded SMS/email                       [reuse Resend email; NEW SMS provider]
   │  "GITAM Hospital · Day 3 Recovery Check · Dr Manoj · [link] · Powered by StewardMD"
   ▼
Taps opaque link → branded portal opens          [NEW patient web portal; reuse design system]
   │  no PHI in link; hospital + doctor branding
   ▼
OTP verification (phone)                          [reuse OTP engine, tokenless variant + NEW SMS]
   ▼
Consent (first time)                              [reuse consent pattern, patient-facing variant]
   ▼
2-minute conversational assessment                [P1 dynamic questionnaire; P2 adaptive AI]
   │  emoji / voice / own language
   ▼
Medication confirm · appointment view · timeline  [NEW assessment/adherence/appt UI]
   ▼
"Thank you — next check-in <date>" (or urgent advice if Red)
   ▼
… repeats per schedule … → Recovered
```
**Patient effort:** open link → OTP → answer → done. No account, no install, no password.

---

## Caregiver journey (Phase 1: reminders; Phase 5: portal)
```
Enrolled with caregiver number (optional)
   ▼
Receives reminders / red-flag / emergency advice   [reuse messaging; consent-gated]
   ▼ (Phase 5)
Caregiver dashboard (with patient consent): meds, appts, red flags, progress
```

---

## Hospital / leadership journey
```
Admin onboards hospital (logo, sender ID, departments, doctors, roles, policies)  [NEW onboarding; reuse hospitalRequests provisioning]
   ▼
Hospital Dashboard: active / completed / pending / high-risk / completion% / avg recovery days   [P1 basic → P3 full]
   ▼
Department + Quality + Executive dashboards        [P3]
   ▼
Recovery Radar™ morning AI brief (one page)         [P3/P5]
   ▼
Analytics → Quality meeting → Reports (PDF/Excel/CSV)   [P3 reporting]
   ▼
Benchmarking vs own history → improvement projects
```

---

## Cross-cutting system journey (what happens automatically)
```
Enroll → episode created → assessments scheduled (disease template)
   ▼
Cron (Worker) → enqueue due messages → Queue consumer → SMS/email (branded) → delivery-log
   ▼
Patient completes → engine scores + assigns escalation level (Green/Yellow/Orange/Red)
   ▼
Green: continue · Yellow: tighten cadence · Orange: doctor alert · Red: urgent advice + doctor+oncall+dashboard
   ▼
Missed: reminder → (P3) nurse task → doctor notify   (never silently downgrades risk)
   ▼
Completion criteria met → episode closes "Recovered" → analytics updated → audit logged
```
Every step is tenant-scoped (`hospitalId`), consent-gated, audit-logged, and PHI-safe (opaque tokens, no PHI in links/SMS).
