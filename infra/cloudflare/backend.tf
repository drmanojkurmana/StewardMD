# backend.tf — remote state.
#
# CI runs on ephemeral runners, so it CANNOT use local state — it needs a shared,
# locked remote backend. We use HCP Terraform (app.terraform.io, free) as the single
# source of truth for state, for both CI and humans.
#
# Org + workspace are read from env so nothing identifying is committed:
#   TF_CLOUD_ORGANIZATION   e.g. "stewardmd"
#   TF_WORKSPACE            e.g. "cloudflare-headers"
# Auth: CI uses the TF_API_TOKEN secret (via setup-terraform); locally run
# `terraform login` once. Set the HCP workspace's Execution Mode to **Local** so the
# Terraform CLI on the GitHub runner drives plan/apply (and reads the GH-provided
# TF_VAR_* / CLOUDFLARE_API_TOKEN), with HCP storing only the state.
#
# Prefer to keep everything inside Cloudflare instead? Replace this block with an
# S3-compatible backend pointed at a Cloudflare R2 bucket (see README).
terraform {
  cloud {}
}
