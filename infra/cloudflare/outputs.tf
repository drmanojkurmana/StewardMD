# outputs.tf — useful values after apply

output "ruleset_id" {
  description = "ID of the http_response_headers_transform ruleset."
  value       = cloudflare_ruleset.security_headers.id
}

output "csp_mode" {
  description = "Which CSP header is being emitted (report-only vs enforced)."
  value       = local.csp_header_name
}

output "content_security_policy" {
  description = "The exact CSP value applied — paste into a browser CSP evaluator to review."
  value       = local.csp
}

output "managed_response_headers" {
  description = "Security headers managed by this module."
  value = [
    local.csp_header_name,
    "Strict-Transport-Security",
    "X-Frame-Options",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Cross-Origin-Opener-Policy",
    "Cross-Origin-Resource-Policy",
  ]
}
