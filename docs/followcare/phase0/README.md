# FollowCare AI — Phase 0 Design Package & Report
**Hospital Recovery Intelligence Platform · a StewardMD module**
Phase 0 (Product & System Design). **No implementation code written** — this is the approved-blueprint gate. Awaiting your approval before Phase 1.

---

## How Phase 0 was produced
1. Read the complete roadmap (Phase 0–5) — it is the source of truth.
2. Ran a **6-subsystem reconnaissance of the existing StewardMD repo** (auth/OTP/RBAC/tenant/consent/audit · data layer · backend infra · messaging · AI modules · frontend/UI) to satisfy the reuse-first mandate.
3. Authored the full Phase 0 deliverable set, reuse-grounded throughout.

## Document index (`docs/followcare/phase0/`)
| # | Deliverable | File |
|---|---|---|
| 00 | **Reuse Inventory** (reuse-vs-build, centerpiece) | `00-reuse-inventory.md` |
| 1 | PRD (vision/mission/FRs/NFRs/metrics/roadmap/risks) | `01-PRD.md` |
| 2 | User Personas (+ RBAC role set) | `02-personas.md` |
| 3 | User Journey Maps | `03-journey-maps.md` |
| 4·5 | Information Architecture · Screen Inventory | `04-05-ia-and-screens.md` |
| 6·7 | UI Design System · Wireframes | `06-07-design-system-and-wireframes.md` |
| 8·9 | Clinical Workflows · AI Conversation Design | `08-09-workflows-and-conversation.md` |
| 10·11 | Disease Library · Escalation Matrix | `10-disease-library-and-escalation.md` |
| 12 | Messaging Strategy | `12-messaging-strategy.md` |
| 13·15 | Multi-Tenant · Security Architecture | `13-15-multitenant-and-security.md` |
| 14 | Database Design | `14-database-design.md` |
| 16 | API Design (FHIR-ready) | `16-api-design.md` |
| 17 | AI Architecture | `17-ai-architecture.md` |
| 18·19 | Analytics · White-Label | `18-19-analytics-and-whitelabel.md` |
| 20 | Technical & Deployment Architecture | `20-technical-architecture.md` |
| 21 | Phase 1 Implementation Checklist | `21-phase1-implementation-checklist.md` |

---

## Report (per the after-each-phase mandate)

### Completed (Phase 0 deliverables)
✅ PRD · personas · journeys · IA · screens · wireframes · design system · clinical workflows · AI conversation design · disease library · escalation matrix · messaging strategy · multi-tenant · database schema · security design · API spec · AI architecture · analytics · white-label · deployment architecture · Phase 1 checklist · **reuse inventory**.

### Architecture decisions (key)
- **Reuse-first, proven:** LLM layer (`callGemini`, Vertex+failover+WIF), auth (Firebase + OTP engine), Firestore CRUD (`_fbfirestore`), the **`icuGroups` membership/rules pattern** as the multi-tenant blueprint, design system (`rds-*`), module-mount pattern (ThoreX), ICU-board dashboards, email (Resend), push + escalation (`_taskpush`), cron cadence, deployment pipeline, standalone-page → patient portal template, and the **deterministic-engine-owns-decision safety pattern**.
- **New systems (all justified in `00-reuse-inventory.md`):** SMS provider + unified messaging dispatcher (+WhatsApp interface); Cloudflare **Queue** for 10k+ scale; the **FollowCare data model** (episode/assessment/adherence/appointment/score/message) + a **server-issued patient key**; **`hospitalId` multi-tenant boundary** + central immutable audit log; **Recovery/risk engine + disease pathways + conversation-state engine + escalation logic + i18n**; two UI surfaces (in-app module + patient portal); delivery-log + webhooks; R2 media bucket; chart/timeline UI components.

### Database changes (proposed for Phase 1)
- **Firestore:** `followcare/{hospitalId}` (config, members, pathways, patients, episodes → assessments/adherence/appointments/scores/tasks/timeline/messages), `consent/…`, `auditLog/…`.
- **D1 (`FOLLOWCARE_DB`):** `fc_messages` (delivery log), `fc_episode_rollup` (analytics).
- **KV/R2/Queue:** `FOLLOWCARE_KV`, `followcare-media`, `FOLLOWCARE_Q`.
- Firestore rules block (tenant + role, append-only, server-only audit/consent). PHI encrypted at rest.

### API changes (proposed)
New namespace `functions/api/followcare/[[path]].js` — doctor · patient (link-only OTP) · hospital · notifications/webhooks · analytics/reports · future EMR/FHIR. Full list in `16-api-design.md`.

### Files created (this phase — **all documentation, zero code**)
16 design docs under `docs/followcare/phase0/`. **Files modified: none** (no production code touched, per the Phase 0 rule).

### Remaining work
This IS the remaining work, phased: **Phase 1 (MVP)** per `21-phase1-implementation-checklist.md`, then Phases 2–5 per the roadmap. Each gated, reviewed, approved before the next.

### Potential risks (top)
1. **SMS deliverability in India** (DLT sender-ID/templates) — mitigate via provider abstraction + fallback to email + delivery logs.
2. **PHI exposure** — opaque tokens, OTP gate, no PHI in links/SMS/logs, encryption, audit.
3. **Multi-tenant leakage** — `hospitalId` on every record + rules + API + a dedicated cross-tenant test suite (Phase 1 gate).
4. **Scale (10k+)** — the Queue is a hard dependency; must be built and load-tested in Phase 1.
5. **Clinical safety/liability** — engine-owns-decision + safety layer + explainability + human-in-loop escalation; clinician sign-off on every disease pathway.
6. **Scope creep** — hard phase gates; reuse-first; no parallel systems.

### Future improvements (adopted from roadmap ⭐)
Recovery **Confidence** Score alongside Recovery Score; Hospital Recovery Radar™ morning brief; Digital Care Orchestrator™ (coordinates next actions, not just reminders); AI Recovery Twin™ + cross-module intelligence (ThoreX/Kardiq/MaiK/ICU) in Phase 5.

---

## Decision requested
**Approve Phase 0** to proceed to Phase 1 (MVP build) — or send changes to any deliverable. Per your rule, I will **not** begin Phase 1 until you approve. Specific points worth your explicit sign-off:
1. The **reuse-vs-build** decisions in `00-reuse-inventory.md` (esp. the 7 new systems).
2. The **`hospitalId` multi-tenant model** + `icuGroups`-pattern rules.
3. The **9 Phase-1 disease pathways** (need clinical sign-off before build).
4. The **SMS provider** choice (MSG91 / Gupshup / Twilio) and DLT setup ownership.
5. The **Recovery Confidence Score** adoption.
