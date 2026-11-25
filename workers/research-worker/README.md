# stewardmd-research-worker

Worker front door for the ResearchMD job container (Phase 3, D-3). Cron
every minute -> one named Durable Object -> container `POST /drain`. The
container pulls the `research-jobs` queue itself, runs `pdf_extract`,
`stats_model` and `manuscript_draft` jobs, writes `result.json` to R2 and
settles each job with an HMAC callback. `fetch()` returns 404: nothing here
is public.

Contracts: `docs/research/contracts/phase-3/worker-runtime.md` (topology,
drain protocol, lease math), `phase-3/callback.md` (HMAC verification
order), `phase-3/job-message.schema.json`, `phase-5/job-messages.md`
(stats/manuscript message shapes), `phase-6/ipd.md` (IPD gate and the
"Worker decryption" seam).

## Secrets (never commit values)

Set from this directory; each command prompts for the value:

| Secret | Purpose | Set with |
|---|---|---|
| `DRAIN_TOKEN` | shared by the cron `X-Drain-Token` header and the container `/drain` check | `npx wrangler secret put DRAIN_TOKEN` |
| `CF_QUEUES_TOKEN` | Queues HTTP pull API token (queues read + write) | `npx wrangler secret put CF_QUEUES_TOKEN` |
| `R2_ACCESS_KEY_ID` | R2 S3 API access key | `npx wrangler secret put R2_ACCESS_KEY_ID` |
| `R2_SECRET_ACCESS_KEY` | R2 S3 API secret key | `npx wrangler secret put R2_SECRET_ACCESS_KEY` |
| `RESEARCH_CALLBACK_SECRET` | HMAC-SHA256 secret for worker -> Pages callbacks | `npx wrangler secret put RESEARCH_CALLBACK_SECRET` |
| `RESEARCH_IPD_KEK` | unwraps IPD snapshot data keys (`backend/research/stats/ipd_crypto.py`) | `npx wrangler secret put RESEARCH_IPD_KEK` |

`RESEARCH_IPD_KEK` rules:

- At least 16 characters. HKDF-SHA256 (salt `research-ipd-kek-v1`, info
  `ipd-snapshot-wrap`) derives the AES-KW wrapping key from it.
- Must be the SAME value as the Pages API project's `RESEARCH_IPD_KEK`,
  set there with
  `npx wrangler pages secret put RESEARCH_IPD_KEK --project-name stewardmd`.
- Unset or too short: IPD stats jobs fail `ipd_kek_unconfigured`. Wrong
  value: they fail `ipd_decrypt_failed`. The KEK never enters D1, R2,
  results or logs.

## Vars (non-secret)

`wrangler.toml` `[vars]`: `CF_ACCOUNT_ID`, `CF_QUEUE_ID`, `R2_ENDPOINT`,
`R2_BUCKET`, `RESEARCH_CALLBACK_URL`. Fill the empty ones at provisioning
(D-2).

## Container env forwarding

Wrangler vars/secrets are NOT auto-forwarded to the container. The
container process only sees what `src/index.js` lists in `ENV_KEYS` and
passes via `container.start({env})`. Two additions are required before
IPD stats jobs run end to end (owner-approved wiring, not yet in the
list):

- `RESEARCH_IPD_KEK` (decryption seam; `phase-6/ipd.md` "Worker
  decryption").
- `DRAIN_TOKEN` (the container `/drain` check reads it from process env;
  it is not in `ENV_KEYS` today, so `/drain` would answer 503).

## Deploy

Nothing here auto-deploys. Provisioning and `npx wrangler deploy` are
owner-approved steps (plan 3.1, D-2/D-3). A push to `main` deploys the
Pages API only, never this worker.
