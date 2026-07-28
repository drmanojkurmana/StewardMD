# FollowCare AI — Reuse Inventory (reuse-first mandate)
Phase 0 centerpiece. Synthesizes a full 6-subsystem reconnaissance of the StewardMD repo. **Rule: extend existing code; build new only where nothing covers the need; every new/parallel system is justified below.**

Legend: **REUSE** (import/use as-is) · **EXTEND** (add params/roles/types to existing) · **BUILD** (new — justified).

---

## 1. Frontend / UI
| Need | Decision | StewardMD component / justification |
|---|---|---|
| Design tokens, dark/light, severity ramp | **REUSE** | `redesign-system.css` `rds-*` + `--sev-critical/urgent/warning/stable/info/done` |
| Buttons, cards, chips, badges, banners, **stat tiles**, list rows, sheets, toasts, skeletons, states | **REUSE** | `rds-btn/-card/-chip/-badge--*/-banner--*/-vital/-list-row/-sheet/-toast/-skeleton/-state` |
| Icons, fonts | **REUSE** | self-hosted Material Symbols Rounded + IBM Plex |
| Haptics, toast, theme-sync, swipe-back | **REUSE** | `haptics.js` (`SMD_HAPTICS`), `toast.js`, `theme-*.js` |
| In-app doctor **module shell** | **BUILD (from template)** | copy `thorex.js` pattern → `followcare.js` (`window.FOLLOWCARE`, `#followcareRoot`, `.fc-*`), `followcare-flags.js`, `followcare-screens.js`, `followcare.css`. *Justified: each module is its own overlay root; no shared module shell exists to extend.* |
| Home tile + routing + sidebar | **EXTEND** | add `.rnav-tile data-act="followcare"` + `ACT.followcare` in `home.js`; toggle in `sidebar-redesign.js TOGGLES[]`; `<script defer>` in `index.html`; `build-www.sh` auto-bundles |
| Doctor/hospital **dashboards** | **REUSE (pattern)** | ICU v2 Unit Board (`icu.js`): stat strip, filter chips, severity patient cards, bottom bar, empty states |
| Charts / timeline / progress ring / segmented | **BUILD** | *Justified: no chart/timeline component in `rds-*`.* Build from `rds-card` + inline SVG (module-tile sparkline precedent) → shared `fc-chart` helpers |

## 2. Patient web portal (link-only, no app)
| Need | Decision | Component / justification |
|---|---|---|
| Hosting / routing | **REUSE** | Cloudflare Pages serves repo root; Pages Functions under `functions/` |
| Login-free branded page | **REUSE (template)** | standalone pages (`support.html`, `_middleware.js COMING_SOON_HTML`) inline brand tokens, zero app JS |
| Serve `/f/<token>` or `/followcare/p/<token>` | **BUILD (from template)** | Pages Function `functions/followcare/p/[token].js` returns branded HTML; add path to `_middleware.js PUBLIC_PAGES` (or serve under already-ungated `/api/*`) |
| OTP UI (6-digit, resend, lockout) | **REUSE** | `email-auth.js` `.smdea-otp` flow |
| Patient **phone/SMS OTP** backend | **EXTEND + BUILD** | reuse OTP engine (`functions/api/auth/[[path]].js` — gen/store/verify/throttle/lockout, esp. the unauthenticated `reset-request` template) keyed `otp:fc:<episodeId|phone>`, tokenless; **BUILD** the SMS delivery (see §4) |

## 3. Auth / RBAC / tenant / consent / audit
| Need | Decision | Component / justification |
|---|---|---|
| Doctor auth (Firebase token verify, owner gate, claims) | **REUSE** | `_fbauth.js` (`verifyFirebaseToken`, `identify`), `_adminauth.js` (`ownerOK`), `_fbadmin.js` (claims, service-account token) |
| RBAC roles | **EXTEND** | add `nurse/coordinator/quality/admin/superintendent/executive/hospital_it` to `_entitlements.js ROLES` + `_features.js` FollowCare feature keys |
| Team RBAC enforced in rules | **REUSE (template)** | `icuGroups` membership+role model + `firestore.rules` (`isMember/roleOf/isAdmin/canInstruct`) — re-scope group→hospital/ward |
| **`hospitalId` multi-tenant boundary** | **BUILD** | *Justified: no `hospitalId` on records today; hospital is a free-text string. Biggest gap.* Add `hospitalId` to every record + rule predicate, modeled on the `icuGroups` pattern; provision via extended `hospitalRequests→hospitalsApproved` flow. |
| Consent (versioned, re-consent, DSAR) | **REUSE + EXTEND** | `SMD_PRIVACY`/`SMD_CONSENT` + `privacyRequests`; add a **patient-facing** consent record (link-based, non-account) using the guest/localStorage-consent precedent |
| PHI encrypt-at-rest + TTL + revoke | **REUSE (pattern)** | `_watch.js` AES-GCM + `expirationTtl` + `forget` for any patient PII |
| Central immutable **audit log** | **BUILD** | *Justified: today's audit is per-patient client-written timeline; enterprise needs a server-written, tenant-scoped, immutable log.* Model on the append-only timeline rules (`create if by==auth.uid; update/delete:false`) as `auditLog/{hospitalId}/events`, written by the service account |

## 4. Messaging
| Need | Decision | Component / justification |
|---|---|---|
| Branded transactional **email** | **REUSE + EXTEND** | `_email.js sendBranded()` (Resend, verified domain); **EXTEND** with hospital/doctor branding params + literal "Powered by StewardMD" |
| **SMS** (India) | **BUILD** | *Justified: zero SMS anywhere.* New `_sms.js` provider (MSG91/Gupshup/Twilio) with DLT sender-ID/templates, mirroring `_email.js` shape |
| WhatsApp | **BUILD (interface now, impl P4)** | slot behind the messaging dispatcher (pattern from `_nativepush.js`) |
| **Doctor/nurse** push + escalation/reminder logic | **REUSE** | `_nativepush.js sendNativeToAll`, `_apns.js`/`_fcm.js`/`_webpush.js`, and `_taskpush.js` (once-only guard, retry-cap, tier/preference fan-out, `sweepOverdue`) |
| Unified provider interface | **BUILD** | `MessagingProvider.send(channel, msg)` + `channelConfigured(env, channel)` — modeled on `_nativepush.js` dispatcher; makes SMS/WhatsApp swappable |
| Reminder **cadence / cron** | **REUSE (pattern)** | Worker `scheduled()` → admin-token POST → Pages endpoint; day-N sweep + KV send-once idempotency (`api/lifecycle`, `_lifecycle.js`) |
| **Delivery log** (sent/delivered/failed/opened) + webhooks | **BUILD** | *Justified: nothing persists per-message state; no open-tracking.* New store (KV + D1 `fc_messages`) + Resend/SMS/WhatsApp status webhooks |

## 5. Backend infrastructure
| Need | Decision | Component / justification |
|---|---|---|
| API routing | **REUSE** | Pages Functions `functions/api/followcare/[[path]].js` (`params.path` sub-router); `/api/*` is never middleware-gated |
| Object storage (photos, PDFs) | **REUSE (pattern) + BUILD binding** | R2 upload/validate/lifecycle from `api/kardiox` (size cap + MIME + magic-byte + delete-after); **BUILD** an R2 bucket `followcare-media` + Pages binding |
| **Async queue** (10k+ concurrent sends) | **BUILD** | *Justified: no Cloudflare Queues anywhere; today's fan-out is inline `Promise.all` capped ~300/run.* Add `[[queues.producers]] FOLLOWCARE_Q` + a consumer Worker `queue(batch)` with batching/retries/DLQ |
| New cron line | **EXTEND** | add trigger to `worker/wrangler.jsonc` + branch in `worker/src/index.js scheduled()` → `/api/followcare/reminders/run` (which **enqueues**) |
| Deploy | **REUSE** | Pages auto-deploy on merge (functions + root); `deploy-worker.yml` for Worker code |
| Secrets/env | **REUSE** | Pages/Worker secret mgmt; add FollowCare vars (SMS keys, queue, R2, branding) |

## 6. Data layer
| Need | Decision | Component / justification |
|---|---|---|
| Server Firestore CRUD | **REUSE** | `_fbfirestore.js` (`fsGet/fsCommit/wCreate/wUpdate/fsQuery`), `_fbadmin.js` service-account token |
| Multi-tenant collection blueprint | **REUSE (pattern)** | `icuGroups` + members + append-only timeline + tasks + TTL |
| Per-episode tracking + cron scan | **REUSE (pattern)** | `_watch.js` (per-user/per-patient/per-episode KV + change-detection + `listWatchUids` cron scan) |
| D1 tables / KV JSON | **REUSE (template)** | `_updates_repo.js` + `updates_schema.sql` (D1); `api/cases` per-uid KV JSON |
| **First-class episode/assessment/adherence/appointment/recoveryScore/message models** | **BUILD** | *Justified: no episode entity; patient IDs are client-minted `"p"+Date.now()`; discharge is destructive; scores are derived-and-discarded.* New collections/tables (see `14-database-design.md`); a **server-issued stable patient/episode key** |

## 7. AI
| Need | Decision | Component / justification |
|---|---|---|
| LLM calls (Gemini Vertex+failover, WIF, model override, streaming) | **REUSE** | import `callGemini` from `functions/api/ai/[[path]].js` |
| Quota/metering/budget/breaker | **EXTEND** | `checkQuota`/`recordUsage`/`meterTokens` (`_usage.js`) + `_aibudget.js` — add `followcare` type |
| "Engine authoritative / LLM must not override" | **REUSE (pattern)** | `RAG_SYS` prompt scaffold + `renderGroundedPrompt` + forbidden-phrase gating + `verifyGrounding` |
| PHI redaction, JSON parse, doctor summary | **REUSE** | `SMD_redactPHI`, `parseJsonLoose`, `_summarize.js` |
| Semantic parsing (symptom→concept) | **REUSE** | `/api/ai/refine` router |
| **Recovery/risk engine, disease pathways, conversation-state, escalation logic, i18n, cross-module read-adapters** | **BUILD** | *Justified: existing engines are diagnostic/severity, not longitudinal recovery; no conversation state machine, no i18n output layer.* Model on `reasoning.js gate()` + `icu-autoscores.js` `{__missing}` pattern (see `17-ai-architecture.md`) |

---

## Summary — the only genuinely NEW systems (all justified above)
1. **SMS provider** (`_sms.js`) + unified messaging dispatcher + WhatsApp interface.
2. **Cloudflare Queue** (`FOLLOWCARE_Q`) + consumer Worker for scale.
3. **FollowCare data model** — episode/assessment/adherence/appointment/recoveryScore/message + server-issued patient key.
4. **`hospitalId` multi-tenant boundary** + central immutable audit log.
5. **Recovery/risk engine + disease pathways + conversation-state engine + escalation logic + i18n**.
6. **Two UI surfaces** — in-app doctor module (from ThoreX template) + link-only patient portal (from standalone-page template).
7. **Delivery-log store + provider webhooks**; **R2 `followcare-media` bucket**; **chart/timeline UI components**.

Everything else is reuse/extend. No parallel duplication of auth, LLM, email, push, Firestore, design system, cron, or deployment.
