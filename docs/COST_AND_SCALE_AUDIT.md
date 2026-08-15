# Cost & Scale Audit (1000+ doctors)

Read-cost and RBAC findings for scale-out. Findings marked **[apply-on-device]** touch the
co-owned ICU realtime files (`icu-collab.js` / `icu.js`) and must be applied behind the existing
`smd_icu_v2` flag with a 2-device test — not swept in unilaterally. Nothing here is a live bug;
these are cost refinements + a design sketch.

## 1. Firestore read cost

The only client-side Firestore SDK consumers are `icu-collab.js` (ICU collab) and `queue.js` (OPD
queue). Everything else hits `stewardmd.in/api/*` (server-authoritative), where reads are the
server's, not each device's.

### 1a. Unbounded `orderBy` listeners — mitigated by TTL, refine later
`icu-collab.js` attaches live listeners on a patient's `timeline` and `tasks` subcollections with
`.orderBy("ts","desc")` and **no `.limit()`** (lines ~889, ~892, ~976). Each attach reads the whole
subcollection, and every doctor who opens that patient re-attaches.

- **Why it is not urgent:** the DPDP 7-day TTL (`retentionExpiry()`/`expiresAt`, line ~912) auto-
  expires timeline/tasks docs, so per-patient collection size is bounded to ~1 week of entries, not
  months of history. Worst-case per-attach read is small.
- **Refinement [apply-on-device]:** cap the *live* listener at the recent window
  (`.limit(200)`) and load older entries on demand behind the timeline's existing **Full/Day** bar
  (a one-shot paged `.get()`), so a busy patient's re-attach cost stays flat regardless of TTL
  window. Reversible: revert the `.limit()` to restore current behaviour.

### 1b. Listener fan-out per doctor
`subscribeGroups` + per-group + per-patient listeners mean an ICU doctor with N open patients holds
~2N+ live listeners. Billing is per-document-change delivered, so cost scales with *write* activity,
not idle listeners — acceptable at 1000 doctors. `unsubscribeAll()` (line ~211) already tears these
down on view exit; confirm it is called on logout and app-background (native pause) so backgrounded
devices stop accruing delivery reads. **[verify]**

### 1c. OPD queue polling — server-side reads
`queue.js` is poll-based against `/api/queue/*` (comment line ~5: "Realtime = poll; onSnapshot is a
later upgrade"). Client SDK reads are zero here, but each poll is a server Firestore read per active
nurse console / display board. At scale, tune the poll interval (display boards can poll slower than
the nurse console) or upgrade the board to a single shared `onSnapshot`. Low priority until board
count is high.

## 2. Org / hospital roles (design sketch — defer build)

Connect already has RBAC (`functions/_connect/enterprise/rbac.js`) scoped to Connect tenants. Lifting
it to an **app-level org admin** (a hospital admin who manages their doctors) is a multi-week feature
needing product decisions, so it is documented, not built:

- **Data model:** `orgs/{orgId}` (name, domain, plan) + `org_members/{orgId}/{uid}` (role ∈
  `org_admin | doctor`, status). Reuse the existing Firebase custom-claims path (`mergeUserClaims`)
  to stamp `{ org: orgId, orgRole }` so the claim travels in the ID token — no extra read on the hot
  path.
- **Admin surface:** the owner console (`functions/api/ai/[[path]].js` admin routes + home.js AI
  Control panel) already does user lookup + grant/revoke — an org-admin view is the same handlers
  scoped to `claims.org` instead of owner-only.
- **Invite flow:** email-domain auto-join (`@hospital.org` → pending) + admin approve, reusing the
  Resend branded-email path.
- **Why defer:** entitlement is currently free-for-everyone (beta); org roles only pay off once
  billing is per-org. Build alongside the paywall flip, not before. Gate behind `smd_orgs`.

## 3. Already covered (no action)

- **Backups/DR:** `docs/BACKUP_DR.md` + `scripts/backup-d1.sh`.
- **Crash telemetry:** `client-errors.js` → `/api/clientlog` → owner console.
- **Product analytics:** `functions/_analytics.js` allow-listed events → owner console.
- **Fleet controls / force-upgrade / maintenance / banners:** `remote-config.js` + `/api/config`.
- **Notification preferences:** `home.js openNotifPrefs` (categories, JR/intern safety locks,
  workspace/specialty filters, server sync).
- **In-app onboarding:** `onboarding.js` (SMD_TOUR).
- **Launch hardening checklist:** `docs/LAUNCH_SECURITY_RUNBOOK.md`.
