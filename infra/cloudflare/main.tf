# main.tf — StewardMD production security response headers via a Cloudflare
# Response Header Transform Rules ruleset (phase: http_response_headers_transform).
#
# Design:
#   • Rule 1 (document headers) is scoped to the HTML host (var.domain) so that
#     CORP/COOP/CSP never apply to the cross-origin JSON API (api.<domain>), which
#     would otherwise break the app's fetch() calls and Firebase popup auth.
#   • Rule 2 (HSTS) applies zone-wide (expression "true") — HSTS is safe and
#     desirable on every HTTPS host, including the API.
# Idempotent: a single ruleset is the singleton for this phase; re-apply is a no-op
# when nothing changed. `ref` gives each rule a stable identity across applies.

locals {
  # Report-only first, then enforce: the header NAME switches on var.csp_enforce.
  csp_header_name = var.csp_enforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only"

  # Permissions-Policy: deny every browser feature the app does not use. "()" = deny
  # for all origins; "(self)" = first-party only. interest-cohort opts out of FLoC.
  permissions_policy = join(", ", [
    "accelerometer=()", "ambient-light-sensor=()", "autoplay=()", "battery=()",
    "camera=()", "display-capture=()", "document-domain=()", "encrypted-media=()",
    "fullscreen=(self)", "geolocation=()", "gyroscope=()", "magnetometer=()",
    "microphone=()", "midi=()", "payment=()", "picture-in-picture=()", "usb=()",
    "xr-spatial-tracking=()", "interest-cohort=()",
  ])

  # HSTS: force HTTPS for max-age, cover subdomains, optional preload.
  hsts_value = "max-age=${var.hsts_max_age}; includeSubDomains${var.hsts_preload ? "; preload" : ""}"

  # Content-Security-Policy. Sources are scoped to exactly what StewardMD loads:
  #   Firebase SDK (gstatic) + Google sign-in (apis.google.com / accounts.google.com /
  #   *.firebaseapp.com), the API host(s), Google Fonts, and Firebase data endpoints.
  # NOTE: script-src keeps 'unsafe-inline' because the app uses inline on* handlers;
  # the gold78 shared-case HTML sanitizer is the compensating control for XSS.
  csp = join("; ", compact([
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com https://accounts.google.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    trimspace("connect-src 'self' https://${var.api_domain} ${var.api_fallback_origin} https://*.googleapis.com https://*.firebaseio.com https://accounts.google.com"),
    "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ]))
}

resource "cloudflare_ruleset" "security_headers" {
  zone_id = var.zone_id
  name    = "StewardMD security response headers"
  kind    = "zone"
  phase   = "http_response_headers_transform"

  rules = [
    # ---- Rule 1: document/site security headers (HTML host only) ----
    {
      ref         = "stewardmd_document_security_headers"
      description = "CSP, framing, referrer, permissions and cross-origin isolation for the StewardMD site"
      enabled     = true
      expression  = "(http.host eq \"${var.domain}\")"
      action      = "rewrite"
      action_parameters = {
        headers = merge(
          {
            # Clickjacking: refuse to be framed (legacy header; frame-ancestors in CSP is the modern equivalent).
            "X-Frame-Options" = { operation = "set", value = "DENY" }
            # MIME sniffing: force declared Content-Type, blocks content-type confusion attacks.
            "X-Content-Type-Options" = { operation = "set", value = "nosniff" }
            # Referrer: send origin only on cross-origin nav; full URL same-origin.
            "Referrer-Policy" = { operation = "set", value = "strict-origin-when-cross-origin" }
            # Feature policy: disable unused powerful APIs (camera, mic, geo, payment, ...).
            "Permissions-Policy" = { operation = "set", value = local.permissions_policy }
            # Process isolation for the top-level document (popup-safe value by default).
            "Cross-Origin-Opener-Policy" = { operation = "set", value = var.coop_value }
            # Resource isolation: this origin's responses load only same-origin (safe here
            # because it is scoped to the document host, NOT the cross-origin API).
            "Cross-Origin-Resource-Policy" = { operation = "set", value = "same-origin" }
          },
          # CSP — name flips between enforce and report-only via var.csp_enforce.
          { (local.csp_header_name) = { operation = "set", value = local.csp } },
        )
      }
    },

    # ---- Rule 2: HSTS, zone-wide (every HTTPS host, including the API) ----
    {
      ref         = "stewardmd_hsts"
      description = "HTTP Strict Transport Security for all hosts in the zone"
      enabled     = true
      expression  = "true"
      action      = "rewrite"
      action_parameters = {
        headers = {
          "Strict-Transport-Security" = { operation = "set", value = local.hsts_value }
        }
      }
    },
  ]
}
