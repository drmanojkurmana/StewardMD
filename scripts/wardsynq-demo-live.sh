#!/usr/bin/env bash
# scripts/wardsynq-demo-live.sh - put the DEMO hospital on a live wardsynq.com and print its logins.
#
# WHAT THIS DOES, ON PRODUCTION:
#   1. Signs you in (Firebase, email + password) ONLY to obtain a short-lived ID token. Your password
#      is read from the terminal with echo off, is never written to disk, never passed as an argument
#      (so it cannot appear in `ps` or your shell history) and never leaves this machine except in
#      the sign-in request itself.
#   2. Finds the existing DEMO hospital on that account, or creates one.
#   3. Seeds it through the real API: 100 beds, 80 occupied, 164 staff, 15 wards, 20 departments,
#      every role performing its own work.
#   4. Prints the staff logins so you can sign in as a nurse, a pharmacist, a doctor or an admin.
#
# THE DATA IS FABRICATED. The hospital's name contains DEMO, the seeder refuses to write to any
# hospital whose name does not, every patient name is obviously invented, and both the site chrome
# and the ward chart carry a permanent DEMO tag. It lives in its own tenant, separate from any real
# hospital's record.
#
# Re-running is safe: the seeder stops with "Already seeded" and writes nothing.
#
#   scripts/wardsynq-demo-live.sh                      # asks for the email, then the password
#   WSQ_EMAIL=you@example.com scripts/wardsynq-demo-live.sh
#   BASE=https://wardsynq.com scripts/wardsynq-demo-live.sh --dry-run
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${BASE:-https://wardsynq.com}"
# The same public Firebase web API key the sign-in page itself uses (it is in the page source; a web
# API key identifies the project and is not a secret).
FB_KEY="${FB_KEY:-AIzaSyCaqxRQfMtq95j0J_vLj7EF4sxrN0FhO0I}"

EMAIL="${WSQ_EMAIL:-}"
if [ -z "$EMAIL" ]; then printf 'StewardMD account email: '; read -r EMAIL; fi
printf 'Password for %s (not shown): ' "$EMAIL"
stty -echo; read -r PASSWORD; stty echo; printf '\n'

echo "Signing in..."
TOKEN="$(PASSWORD="$PASSWORD" EMAIL="$EMAIL" FB_KEY="$FB_KEY" node -e '
const body = JSON.stringify({ email: process.env.EMAIL, password: process.env.PASSWORD, returnSecureToken: true });
fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + process.env.FB_KEY,
  { method: "POST", headers: { "Content-Type": "application/json" }, body })
  .then((r) => r.json())
  .then((j) => {
    if (!j.idToken) {
      const m = (j.error && j.error.message) || "sign-in failed";
      // Say what to do about it rather than echoing Google-speak at somebody.
      if (/EMAIL_NOT_FOUND|INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD/.test(m)) {
        process.stderr.write("That email and password were not accepted.\nIf this account does not exist yet, create it at " + (process.env.BASE || "https://wardsynq.com") + " (Owner / Doctor, or Continue with Google) and run this again.\n");
      } else process.stderr.write("Sign-in failed: " + m + "\n");
      process.exit(1);
    }
    process.stdout.write(j.idToken);
  })
  .catch((e) => { process.stderr.write("Could not reach the sign-in service: " + e.message + "\n"); process.exit(1); });
')"
unset PASSWORD
echo "Signed in."

cd "$ROOT"
BASE="$BASE" WSQ_OWNER_TOKEN="$TOKEN" node scripts/wardsynq-demo-hospital.mjs "$@"
