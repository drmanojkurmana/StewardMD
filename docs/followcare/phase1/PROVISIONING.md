# FollowCare AI — Phase 1 provisioning & deploy runbook

Everything in Phase 1 is **built, tested (61 unit tests), and merged to `main`** but ships **behind a
default-OFF flag** and **inert until you provision the items below**. Nothing here changes existing app
behaviour: with `smd_followcare` off there is no home tile, and the API returns `disabled` unless enabled.

This is the owner checklist. Do the steps in order; each is independent and reversible.

---

## 0. What Phase 1 delivers

| Piece | File(s) | Runs where |
|---|---|---|
| Deterministic Recovery Engine + 9 pathways | `followcare-engine.js`, `followcare-pathways.js` | client + server (one source of truth) |
| Assessment + scheduling (pure) | `followcare-assessment.js`, `followcare-schedule.js` | client + server |
| Server data/API layer | `functions/_followcare.js`, `functions/api/followcare/[[path]].js` | Cloudflare Pages Functions |
| SMS + dispatch + daily scheduler | `functions/_followcare_sms.js`, `functions/_followcare_dispatch.js` | Pages Functions |
| Patient portal (login-free web) | `followcare.html` → `/followcare?t=…` | Cloudflare Pages (web only) |
| Doctor in-app module | `followcare.js` + home tile | app (flag-gated) |

Data model (all **server-only**, service-account, deny-all client rules): `fc_episodes`, `fc_assessments`,
`fc_events` (audit), `fc_delivery` (message log), `fc_doctors` (doctor→hospital binding).

---

## 1. Secrets & environment variables (Cloudflare Pages → production)

Set these on the **Pages** project (Settings → Environment variables → Production), then redeploy.

### Required (FollowCare will not enroll or issue links without these — it fails **closed**)

| Var | What | How to generate |
|---|---|---|
| `FOLLOWCARE_TOKEN_SECRET` | HMAC secret for patient link tokens | `openssl rand -hex 32` |
| `FOLLOWCARE_PHI_KEY` | base64 **32-byte** AES-256 key for PHI at rest | `openssl rand -base64 32` |

`FIREBASE_SERVICE_ACCOUNT` is already set (reused) — no action.

> ⚠️ Treat both as secrets. Rotating `FOLLOWCARE_PHI_KEY` makes existing encrypted phone/name/mrn
> **unreadable** (they were encrypted with the old key) — only rotate before real patient data exists,
> or add a key-version migration first. Rotating `FOLLOWCARE_TOKEN_SECRET` invalidates all outstanding
> patient links (they must be re-sent).

### Optional / tuning

| Var | Default | What |
|---|---|---|
| `FOLLOWCARE_ENABLED` | `1` | server master switch; set `0` to hard-disable the API |
| `FOLLOWCARE_LINK_BASE` | `https://stewardmd.in/followcare` | base URL put in the patient link |
| `FOLLOWCARE_LINK_TTL_DAYS` | `45` | link/token lifetime |
| `FOLLOWCARE_DEFAULT_CC` | `91` | country code added to bare 10-digit numbers |
| `FOLLOWCARE_SCHEDULER_CAP` | `500` | max episodes processed per scheduler run |
| `FOLLOWCARE_APP_TOKEN` | — | optional extra app-gate token (browser/native already pass via Origin) |
| `FOLLOWCARE_KV` | falls back to existing KV | dedicated KV namespace for rate-limits (recommended at scale) |

### SMS provider — pick ONE (leave unset to run link-generation without auto-send)

`FOLLOWCARE_SMS_PROVIDER` = `twofactor` | `msg91` | `twilio` | `gupshup`

- **twofactor** (2Factor.in, India, DLT Transactional SMS): `TWOFACTOR_API_KEY` (secret), `TWOFACTOR_SENDER`
  (your DLT header, e.g. 6 chars), `TWOFACTOR_TEMPLATE_CHECKIN` (the DLT-approved **template name** in your
  2Factor account). The check-in text is defined by that template and filled from VAR1 = patient first name,
  VAR2 = the opaque link. Register a transactional template whose body contains those two variables + your
  link domain (DLT requires the URL/header be pre-approved). Uses your **Transactional SMS** balance.
- **msg91** (India, DLT): `MSG91_AUTHKEY`, `MSG91_SENDER` (6-char header), `MSG91_TEMPLATE_CHECKIN`
  (DLT-approved flow/template id). The message text is defined by the approved template; it is filled
  from variables — map your template variables to `var1` = patient first name, `var2` = link (the code
  also passes `name`/`link` keys, use whichever your template expects).
- **twilio**: `TWILIO_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (E.164 sender).
- **gupshup**: `GUPSHUP_API_KEY`, `GUPSHUP_SOURCE`.

Until a provider is configured, the dispatcher **logs `not_configured` and does not fake a send** — the
doctor can still generate and share the link manually (copy/share button in the app).

> **India DLT is a hard external dependency.** Register the entity, the sender header, and the check-in
> template on your DLT operator before `msg91` will deliver. This is the one item only you can do.

---

## 2. Deploy the Firestore rules

The FollowCare collections are already added to `firestore.rules` as explicit deny-all (server-account
only). Editing the file does **not** change production — deploy separately:

```bash
firebase deploy --only firestore:rules
```

No composite indexes are required (queries use single-field equality filters only).

---

## 3. Enable the daily scheduler (cron)

The scheduler is a real endpoint; a daily cron must call it. It sends due check-in links + reminders and
escalates missed check-ins.

**Endpoint:** `POST https://stewardmd.in/api/followcare/admin/run-scheduler`
**Auth:** owner Google login **or** header `X-Admin-Token: <UPDATES_ADMIN_TOKEN or VERIFY_ADMIN_TOKEN>`
(same admin-token convention as the existing crons).

Wire it with a Cloudflare **Cron Trigger** on a small scheduled Worker (or add to the existing
`stewardmd-api` Worker's `scheduled()`):

```js
// runs e.g. daily at 03:30 UTC (09:00 IST); pick a time that suits your DLT sending window
export default {
  async scheduled(event, env, ctx) {
    await fetch("https://stewardmd.in/api/followcare/admin/run-scheduler", {
      method: "POST",
      headers: { "X-Admin-Token": env.VERIFY_ADMIN_TOKEN },
    });
  },
};
```

```
# wrangler.toml
[triggers]
crons = ["30 3 * * *"]
```

At beta volumes this runs inline (capped by `FOLLOWCARE_SCHEDULER_CAP`). For a large tenant, move to a
Cloudflare Queue producer/consumer driven by the same `plan()` decision — documented, not yet wired.

---

## 4. Turn it on

Per the StewardMD reversible-change norm, the master flag `smd_followcare` is **default OFF**.

- Per device / testing: append `?fc=1` to the app URL, or set `localStorage.smd_followcare = "1"`.
- Enabling shows the **FollowCare** tile in Clinical Tools; the doctor sets their hospital once, then enrolls.

Recovery point before enabling widely: this is all additive + flag-gated, so disabling the flag fully
reverts the UI. The server API also honours `FOLLOWCARE_ENABLED=0` as a kill switch.

---

## 5. Smoke test (after provisioning)

1. **Enroll:** in the app (with `?fc=1`), open FollowCare → set hospital → enroll a test patient with
   YOUR own mobile + a near/past discharge date → you get a link.
2. **Portal:** open the link in a plain browser (not signed in) → the day's check-in renders (generic
   greeting, no name in the page). Submit → you get a safe, engine-decided message.
3. **Board:** back in the app, the episode shows with its escalation + timeline; a red answer pushes a
   de-identified “review needed” notification to your device and keeps the episode flagged until you
   tap **Mark reviewed**.
4. **Scheduler:** `curl -X POST -H "X-Admin-Token: <token>" https://stewardmd.in/api/followcare/admin/run-scheduler`
   → returns `{ ok, summary:{ scanned, sent, reminded, missedEscalated, skipped } }`.
5. **SMS (if configured):** the check-in link arrives by SMS in the patient's language.

---

## 6. Safety invariants (do not regress)

- The AI **never** changes prescriptions, diagnoses, stops medicines, or replaces the treating doctor —
  it scores recovery and routes escalations only.
- Patients **never** install the app; they use the login-free token link.
- **No PHI** in URLs, link tokens, logs, or the patient-facing page. Phone/name/mrn are AES-256-GCM at rest.
- The recovery decision is computed **server-side** (a tampered client cannot fake a "green").
- A red flag always tells the patient to seek urgent in-person care.
