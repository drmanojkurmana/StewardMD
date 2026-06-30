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

## Notes
- Idempotent: the phase ruleset is a singleton; re-`apply` with no changes is a no-op.
- If a header ruleset already exists for this phase (created in the dashboard), import it first:
  `terraform import cloudflare_ruleset.security_headers zones/<zone_id>/<ruleset_id>`
- `coop_value` defaults to `same-origin-allow-popups`; set `same-origin` only after moving
  Firebase auth to `signInWithRedirect` (strict `same-origin` breaks popup OAuth).
