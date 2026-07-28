# FollowCare AI — Information Architecture & Screen Inventory
Phase 0 deliverables #4 (IA) + #5 (Screens). Two surfaces: the in-app **doctor/hospital module** (inside StewardMD) and the link-only **patient portal**.

## Information architecture
```
StewardMD
 ├─ Home  (rnav tile: "FollowCare AI", data-act="followcare", flag smd_followcare)
 ├─ Patients ─▶ [Enroll in FollowCare] on each patient page
 ├─ MaiK AI · Kardiq AI · ThoreX AI · ICU · Antibiogram
 └─ FollowCare AI  (#followcareRoot overlay, .fc-*)
     ├─ Dashboard (Command Center)           default
     ├─ Patients
     │   ├─ Active
     │   ├─ High Risk / Smart Queue
     │   └─ Completed
     ├─ Analytics            (P3)
     ├─ Templates (Disease pathways)
     ├─ Settings (Admin)      (RBAC: admin)
     └─ Reports              (P3)
 Hospital / leadership views (P3): Department · Hospital · Executive · Quality · Nurse · Care-Coordinator dashboards
```
```
Patient Portal (stewardmd.in/f/<token>)  — no app, no account
 ├─ Welcome (hospital + doctor branding)
 ├─ OTP verification
 ├─ Consent (first visit)
 ├─ Assessment (conversational)
 ├─ Medication check-in
 ├─ Appointment / Recovery timeline
 └─ Thank you  (or Urgent-advice screen on Red)
```
Bottom-nav (doctor module, ICU-board pattern): **Patients · Analytics · Templates · Settings**.

## Screen inventory
### Doctor / hospital module (in-app)
| # | Screen | Phase | Key elements |
|---|---|---|---|
| D1 | **Enroll** (on patient page) | 1 | auto-filled form: diagnosis, discharge date, phone, email, caregiver, language, duration, pathway, doctor, hospital; consent tick; "Enroll (<30s)" |
| D2 | **Dashboard / Command Center** | 1→3 | stat strip (Active/Pending/High-risk/Completed/Recovered-today); Smart Queue (sickest first, P2); morning digest (P3) |
| D3 | **Patient list** (Active/High-risk/Completed) | 1 | filter chips; severity patient cards (recovery score, trend, last check-in) |
| D4 | **Patient timeline** | 1 | assessments over days, responses, adherence, recovery trend chart, escalation history; actions (pause/resume/extend/close/archive, acknowledge) |
| D5 | **AI summary card** | 2 | 30-sec: score, top reasons, recommendation |
| D6 | **Templates** (pathway editor) | 1→2 | list of disease pathways; edit questions/red-flags/schedule (versioned, RBAC) |
| D7 | **Analytics** | 3 | disease/KPI/benchmark charts + AI insights |
| D8 | **Reports** | 3 | export PDF/Excel/CSV |
| D9 | **Admin Settings** | 1 | branding (logo/name/signature), SMS/email templates, language, reminder timings, members/roles, policies |
| D10 | Department / Hospital / Executive / Quality dashboards | 3 | leadership rollups; Recovery Radar™ brief |
| D11 | Nurse / Care-Coordinator work queues | 3 | today's calls, med issues, pending, photo reviews, booking tasks |

### Patient portal (link-only)
| # | Screen | Phase | Key elements |
|---|---|---|---|
| P1 | **Welcome / brand** | 1 | hospital logo (primary) + Dr name + "Powered by StewardMD"; "Start (2 min)" |
| P2 | **OTP** | 1 | 6-digit `.smdea-otp`, resend, lockout |
| P3 | **Consent** | 1 | language-specific; accept to continue |
| P4 | **Assessment** | 1→2 | conversational: "Day 4 check — how are you? 🙂 Better / 😐 Same / ☹ Worse"; dynamic (P1) → adaptive (P2); emoji/voice/number/photo inputs; own language |
| P5 | **Medication check-in** | 1 | today's meds → Taken/Skipped/Not available (+reason) |
| P6 | **Appointment / Timeline** | 1 | next review; discharge→dayN→recovered timeline |
| P7 | **Thank you** | 1 | reassurance + next check-in date |
| P8 | **Urgent advice** | 1 | on Red: clear urgent-care/emergency guidance (engine-decided) |
| P9 | **Wound photo upload** | 5 | camera/upload → R2 |
| P10 | Caregiver views | 5 | consent-scoped reminders/red-flags/progress |

**Accessibility across all:** large touch targets (48px `rds-*`), dark/light, WCAG contrast, multi-language, low-literacy (emoji + voice), screen-reader labels, no time-pressure.
