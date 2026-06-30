# variables.tf — inputs for the StewardMD Cloudflare security-headers module

variable "cloudflare_api_token" {
  description = "Cloudflare API token with Zone:Transform Rules edit on the target zone. Provide via TF_VAR_cloudflare_api_token / CLOUDFLARE_API_TOKEN — do NOT commit."
  type        = string
  sensitive   = true
}

variable "zone_id" {
  description = "Cloudflare Zone ID for the StewardMD domain (Dashboard → the zone → Overview → API → Zone ID)."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.zone_id))
    error_message = "zone_id must be a 32-character hexadecimal Cloudflare zone id."
  }
}

variable "domain" {
  description = "The HTML site host that should receive document security headers (CSP, framing, COOP/CORP). The cross-origin API host is intentionally excluded."
  type        = string
  default     = "stewardmd.in"
}

variable "api_domain" {
  description = "API host used by the app (added to CSP connect-src). Excluded from the document-scoped header rule so CORP/COOP don't block cross-origin fetches."
  type        = string
  default     = "api.stewardmd.in"
}

variable "api_fallback_origin" {
  description = "Fallback API origin allowed in CSP connect-src (e.g. the *.workers.dev URL). Set to \"\" to omit."
  type        = string
  default     = "https://stewardmd-api.drmanojkurmana.workers.dev"
}

# ---- Content-Security-Policy rollout control ----
variable "csp_enforce" {
  description = "false = ship as Content-Security-Policy-Report-Only (observe, don't block). true = enforce as Content-Security-Policy. Roll out report-only FIRST, watch the console, then flip to true."
  type        = bool
  default     = false
}

# ---- Cross-Origin-Opener-Policy ----
# NOTE: the spec asked for COOP "same-origin", but StewardMD signs in with Firebase
# signInWithPopup, which a strict "same-origin" COOP breaks (the popup loses
# window.opener and can't post the auth result back). Default to the popup-safe value;
# set to "same-origin" only after migrating to signInWithRedirect.
variable "coop_value" {
  description = "Cross-Origin-Opener-Policy value. 'same-origin-allow-popups' keeps Firebase signInWithPopup working; 'same-origin' is stricter but breaks popup OAuth."
  type        = string
  default     = "same-origin-allow-popups"

  validation {
    condition     = contains(["same-origin", "same-origin-allow-popups", "unsafe-none"], var.coop_value)
    error_message = "coop_value must be one of: same-origin, same-origin-allow-popups, unsafe-none."
  }
}

# ---- HSTS ----
variable "hsts_max_age" {
  description = "Strict-Transport-Security max-age in seconds (31536000 = 1 year)."
  type        = number
  default     = 31536000
}

variable "hsts_preload" {
  description = "Append '; preload' to HSTS. Only enable after every *.<domain> host is HTTPS-only AND you intend to submit to hstspreload.org (hard to undo)."
  type        = bool
  default     = false
}
