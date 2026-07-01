#!/usr/bin/env bash
# StewardMD — MaiK Vertex AI via Workload Identity Federation (KEYLESS).
# Reproducible, org-policy-compliant setup: NO service-account keys are created or
# uploaded (blocked by constraints/iam.disableServiceAccountKeyUpload). Instead a
# self-managed OIDC signing keypair is generated LOCALLY; only the PUBLIC JWK is
# uploaded to a WIF OIDC provider; the private key is stored ONLY as a Cloudflare
# Pages secret. The Cloudflare Worker self-signs an OIDC JWT -> STS token exchange
# -> SA impersonation -> Vertex AI.
#
# Usage:
#   ./scripts/setup-maik-wif.sh setup     # one-time: pool + provider + impersonation
#   ./scripts/setup-maik-wif.sh rotate    # generate a new key, upload JWK, print CF secret cmd
# Requires: gcloud (authed), openssl, node, wrangler (for the secret step).
set -euo pipefail

PROJECT="stewardmd-498ec"
POOL="maik-pool"
PROVIDER="maik-provider"
SA_EMAIL="maik-vertex-ai@${PROJECT}.iam.gserviceaccount.com"
ISSUER="https://stewardmd.in"
SUBJECT="maik-worker"
CF_PROJECT="stewardmd"
WORKDIR="$(mktemp -d)"; trap 'rm -rf "$WORKDIR"' EXIT
PROJNUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
AUDIENCE="//iam.googleapis.com/projects/${PROJNUM}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"

gen_keypair_and_jwk() {  # -> $WORKDIR/private.pem, $WORKDIR/jwks.json, prints KID
  node -e '
    const c=require("crypto"),fs=require("fs");
    const {publicKey,privateKey}=c.generateKeyPairSync("rsa",{modulusLength:2048});
    const kid="maik-"+Date.now().toString(36);
    const jwk=publicKey.export({format:"jwk"}); jwk.use="sig"; jwk.alg="RS256"; jwk.kid=kid;
    const d=process.argv[1];
    fs.writeFileSync(d+"/private.pem",privateKey.export({type:"pkcs8",format:"pem"}));
    fs.writeFileSync(d+"/jwks.json",JSON.stringify({keys:[jwk]}));
    process.stdout.write(kid);
  ' "$WORKDIR"
}

case "${1:-setup}" in
  setup)
    echo "1) Service account (least privilege: aiplatform.user only)"
    gcloud iam service-accounts create maik-vertex-ai --project="$PROJECT" \
      --display-name="MaiK Vertex AI" 2>/dev/null || echo "   (SA exists)"
    gcloud projects add-iam-policy-binding "$PROJECT" --condition=None \
      --member="serviceAccount:${SA_EMAIL}" --role="roles/aiplatform.user" >/dev/null
    echo "2) Workload Identity Pool"
    gcloud iam workload-identity-pools create "$POOL" --project="$PROJECT" --location=global \
      --display-name="MaiK WIF pool" 2>/dev/null || echo "   (pool exists)"
    echo "3) Local keypair + OIDC provider with UPLOADED public JWK (no public issuer endpoint)"
    KID="$(gen_keypair_and_jwk)"
    gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --project="$PROJECT" \
      --location=global --workload-identity-pool="$POOL" --display-name="MaiK Cloudflare OIDC" \
      --issuer-uri="$ISSUER" --attribute-mapping="google.subject=assertion.sub" \
      --jwk-json-path="$WORKDIR/jwks.json" 2>/dev/null || \
      gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" --project="$PROJECT" \
      --location=global --workload-identity-pool="$POOL" --jwk-json-path="$WORKDIR/jwks.json"
    echo "4) Allow the federated subject to impersonate the SA (keyless)"
    gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" --project="$PROJECT" \
      --role="roles/iam.workloadIdentityUser" \
      --member="principal://iam.googleapis.com/projects/${PROJNUM}/locations/global/workloadIdentityPools/${POOL}/subject/${SUBJECT}" >/dev/null
    echo "5) Set Cloudflare Pages secrets (private key stays local -> CF only):"
    cat "$WORKDIR/private.pem" | wrangler pages secret put GCP_WIF_PRIVATE_KEY --project-name "$CF_PROJECT"
    for kv in "AI_PROVIDER=vertex" "GCP_PROJECT=$PROJECT" "GCP_LOCATION=us-central1" \
              "GCP_SA_EMAIL=$SA_EMAIL" "GEMINI_MODEL=gemini-2.5-flash" \
              "GCP_WIF_AUDIENCE=$AUDIENCE" "GCP_WIF_KID=$KID" "GCP_WIF_ISSUER=$ISSUER" "GCP_WIF_SUBJECT=$SUBJECT"; do
      printf '%s' "${kv#*=}" | wrangler pages secret put "${kv%%=*}" --project-name "$CF_PROJECT"
    done
    echo "DONE. AUDIENCE=$AUDIENCE  KID=$KID"
    ;;
  rotate)  # generate a NEW key, upload it (JWKS holds <=8), swap the CF secret + KID
    echo "Rotating WIF signing key (append new JWK, then set CF secret; drop old key after propagation)"
    KID="$(gen_keypair_and_jwk)"
    gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" --project="$PROJECT" \
      --location=global --workload-identity-pool="$POOL" --jwk-json-path="$WORKDIR/jwks.json"
    cat "$WORKDIR/private.pem" | wrangler pages secret put GCP_WIF_PRIVATE_KEY --project-name "$CF_PROJECT"
    printf '%s' "$KID" | wrangler pages secret put GCP_WIF_KID --project-name "$CF_PROJECT"
    echo "Rotated. New KID=$KID"
    ;;
  *) echo "usage: $0 [setup|rotate]"; exit 1;;
esac
