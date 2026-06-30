# provider.tf — Cloudflare Terraform provider (v5, official)
#
# v5 is the current, OpenAPI-generated provider. The cloudflare_ruleset resource
# in v5 uses ATTRIBUTE/LIST syntax (rules = [ { ... } ], action_parameters = { ... },
# headers = { "<Name>" = { operation = "set", value = "..." } }) — not the v4 blocks.

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      # Pin to the 5.x line (auto-generated schema). ~> 5.15 allows 5.15+ patches/minors
      # but blocks the next major (v6) so an upgrade is a deliberate, reviewed step.
      version = "~> 5.15"
    }
  }

  # Recommended for teams: use remote, locked state instead of local state.
  # backend "s3" { bucket = "..."; key = "stewardmd/cloudflare-headers.tfstate"; region = "..." }
}

provider "cloudflare" {
  # Never hardcode the token. Pass via TF_VAR_cloudflare_api_token or the
  # CLOUDFLARE_API_TOKEN env var. Token needs Zone → "Zone WAF/Transform Rules" edit
  # (Account: none required) on the target zone.
  api_token = var.cloudflare_api_token
}
