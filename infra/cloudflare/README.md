# StewardMD — Cloudflare security response headers (Terraform)

Production security headers for `stewardmd.in`, managed as a single Cloudflare
**Response Header Transform Rules** ruleset (`http_response_headers_transform` phase),
using the official Cloudflare provider **v5**.

## Headers managed

| Header | Value | Notes |
|---|---|---|
| `Content-Security-Policy[-Report-Only]` | scoped allowlist | report-only first (`csp_enforce = false`), then enforce |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | zone-wide (incl. API); `+preload` optional |
| `X-Frame-Options` | `DENY` | clickjacking (legacy; CSP `frame-ancestors 'none'` is the modern form) |
| `X-Content-Type-Options` | `nosniff` | blocks MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | |
| `Permissions-Policy` | deny all unused features | camera/mic/geo/payment/usb/... off |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | popup-safe for Firebase `signInWithPopup` |
| `Cross-Origin-Resource-Policy` | `same-origin` | document host only (not the cross-origin API) |

Document headers (CSP/COOP/CORP/etc.) are scoped to `var.domain` so they never break
the cross-origin API at `api.stewardmd.in`. HSTS is applied zone-wide.

## Usage

```bash
export TF_VAR_cloudflare_api_token="<token: Zone → Transform Rules: Edit>"
cp terraform.tfvars.example terraform.tfvars   # set zone_id

terraform init      # download provider, create lock file
terraform plan      # review (ships CSP as Report-Only by default)
terraform apply      # create the ruleset

# After observing zero CSP violations in the browser console, enforce:
terraform apply -var="csp_enforce=true"
```

The API token needs **Zone → Transform Rules → Edit** on the StewardMD zone.

State lives in **HCP Terraform** (see `backend.tf`), so run `terraform login` once and set
`TF_CLOUD_ORGANIZATION` + `TF_WORKSPACE` before `init`.

## Continuous delivery (GitHub Actions)

`.github/workflows/terraform-cloudflare.yml` runs **plan on PRs** (posted as a PR comment)
and **apply on merge to `main`** — only when files under `infra/cloudflare/**` change.

One-time setup:

1. **HCP Terraform** (free): create an organization + a workspace, and set the workspace
   **Execution Mode = Local** (so the CLI on the GitHub runner drives plan/apply and reads
   the GitHub-provided variables; HCP just stores state).
2. **Repo → Settings → Secrets and variables → Actions**
   - Secrets: `CLOUDFLARE_API_TOKEN` (Zone → Transform Rules: Edit), `TF_API_TOKEN` (HCP team/user token).
   - Variables: `CF_ZONE_ID`, `TF_CLOUD_ORGANIZATION`, `TF_WORKSPACE`.
3. **Repo → Settings → Environments → `production`**: add a **required reviewer** so every
   apply needs manual approval before it goes live.

Rollout stays the same: the committed default ships CSP as **Report-Only**; once the console
is clean, bump `csp_enforce = true` (commit it, or set a `TF_VAR_csp_enforce` repo variable).

> Prefer to keep state inside Cloudflare? Swap `backend.tf` for an S3-compatible backend on a
> Cloudflare **R2** bucket (`endpoints.s3 = https://<acct>.r2.cloudflarestorage.com`, `region = "auto"`,
> `skip_*` flags, R2 token via `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`).

## Notes
- Idempotent: the phase ruleset is a singleton; re-`apply` with no changes is a no-op.
- If a header ruleset already exists for this phase (created in the dashboard), import it first:
  `terraform import cloudflare_ruleset.security_headers zones/<zone_id>/<ruleset_id>`
- `coop_value` defaults to `same-origin-allow-popups`; set `same-origin` only after moving
  Firebase auth to `signInWithRedirect` (strict `same-origin` breaks popup OAuth).
