#!/usr/bin/env bash
# scripts/wardsynq-demo-live.sh - put the DEMO hospital on a live wardsynq.com and print its logins.
#
# TWO WAYS IN. Prefer the first: no password goes anywhere near this machine.
#
#   1. A TOKEN FROM THE BROWSER (recommended)
#        Sign in at https://wardsynq.com, open the browser console, and run:
#            await firebase.auth().currentUser.getIdToken()
#        Copy the string it prints, then:
#            WSQ_OWNER_TOKEN='eyJ...' scripts/wardsynq-demo-live.sh
#        The token is short-lived (about an hour) and is all this needs.
#
#   2. EMAIL AND PASSWORD, when there is a real terminal
#        scripts/wardsynq-demo-live.sh you@example.com
#        The password is read from the terminal with echo off, is never written to disk and is
#        never passed as an argument, so it cannot reach the process list or your shell history.
#        If the password must come from a file (no terminal available):
#            WSQ_PASSWORD_FILE=/path/to/file scripts/wardsynq-demo-live.sh you@example.com
#        Delete that file afterwards.
#
# WHAT IT DOES, ON PRODUCTION: finds the existing DEMO hospital on that account or creates one, then
# seeds it through the real API (100 beds, 80 occupied, 164 staff, 15 wards, 20 departments, every
# role performing its own work), then prints the staff logins.
#
# THE DATA IS FABRICATED. The hospital's name contains DEMO, the seeder refuses to write to any
# hospital whose name does not, every patient name is obviously invented, and both the site chrome
# and the ward chart carry a permanent DEMO tag. It lives in its own tenant, separate from any real
# hospital's record. Re-running is safe: the seeder stops with "Already seeded" and writes nothing.
#
#   WSQ_DEMO_MAIK=1   also switch MaiK on for the demo (a real model is configured in production)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${BASE:-https://wardsynq.com}"
# The same public Firebase web API key the sign-in page itself uses. A web API key identifies the
# project and is not a secret; it is in the page source.
FB_KEY="${FB_KEY:-AIzaSyCaqxRQfMtq95j0J_vLj7EF4sxrN0FhO0I}"

TOKEN="${WSQ_OWNER_TOKEN:-}"

if [ -z "$TOKEN" ]; then
  EMAIL="${1:-${WSQ_EMAIL:-}}"
  if [ -z "$EMAIL" ]; then
    echo "Who is creating the hospital? Pass the account email, or a token from the browser:" >&2
    echo "  scripts/wardsynq-demo-live.sh you@example.com" >&2
    echo "  WSQ_OWNER_TOKEN='eyJ...' scripts/wardsynq-demo-live.sh     (see the header of this file)" >&2
    exit 2
  fi

  if [ -n "${WSQ_PASSWORD_FILE:-}" ]; then
    [ -r "$WSQ_PASSWORD_FILE" ] || { echo "Cannot read $WSQ_PASSWORD_FILE" >&2; exit 2; }
    PASSWORD="$(cat "$WSQ_PASSWORD_FILE")"
  elif [ -r /dev/tty ]; then
    # /dev/tty explicitly, not stdin: this is often run where stdin is not a terminal.
    printf 'Password for %s (not shown): ' "$EMAIL" > /dev/tty
    stty -echo < /dev/tty; IFS= read -r PASSWORD < /dev/tty; stty echo < /dev/tty; printf '\n' > /dev/tty
  else
    echo "No terminal available to ask for a password." >&2
    echo "Use a browser token instead - it is the better way anyway:" >&2
    echo "  sign in at $BASE, then in the browser console:  await firebase.auth().currentUser.getIdToken()" >&2
    echo "  WSQ_OWNER_TOKEN='eyJ...' scripts/wardsynq-demo-live.sh" >&2
    exit 2
  fi

  echo "Signing in as $EMAIL ..."
  TOKEN="$(PASSWORD="$PASSWORD" EMAIL="$EMAIL" FB_KEY="$FB_KEY" BASE="$BASE" node -e '
  const body = JSON.stringify({ email: process.env.EMAIL, password: process.env.PASSWORD, returnSecureToken: true });
  fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + process.env.FB_KEY,
    { method: "POST", headers: { "Content-Type": "application/json" }, body })
    .then((r) => r.json())
    .then((j) => {
      if (!j.idToken) {
        const m = (j.error && j.error.message) || "sign-in failed";
        // Say what to do about it rather than echoing Google-speak at somebody.
        if (/EMAIL_NOT_FOUND|INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD/.test(m)) {
          process.stderr.write("That email and password were not accepted.\nIf the account does not exist yet, create it at " + process.env.BASE + " (Owner / Doctor, or Continue with Google) and run this again.\nIf you signed up with Google there is no password: use a browser token instead, see the header of this script.\n");
        } else process.stderr.write("Sign-in failed: " + m + "\n");
        process.exit(1);
      }
      process.stdout.write(j.idToken);
    })
    .catch((e) => { process.stderr.write("Could not reach the sign-in service: " + e.message + "\n"); process.exit(1); });
  ')"
  unset PASSWORD
  echo "Signed in."
fi

cd "$ROOT"

# PREFLIGHT. A rejected token used to surface twenty seconds later as "no staff session for
# admin@example.test - PIN login did not succeed", which names the wrong problem entirely. Ask the
# server who this token is before doing anything, and say plainly when the answer is nobody.
echo "Checking the token against $BASE ..."
WHO="$(BASE="$BASE" TOKEN="$TOKEN" node -e '
fetch(process.env.BASE + "/api/queue/whoami", { headers: { Authorization: "Bearer " + process.env.TOKEN } })
  .then((r) => r.json().then((j) => ({ status: r.status, j })))
  .then(({ status, j }) => {
    if (status === 401 || !j || !j.ok) { process.stderr.write("REJECTED\n"); process.exit(1); }
    if (j.kind !== "firebase") { process.stderr.write("NOT_AN_ACCOUNT:" + j.kind + "\n"); process.exit(1); }
    process.stdout.write((j.name || j.smdId || "your account") + " (" + j.kind + ")");
  })
  .catch((e) => { process.stderr.write("UNREACHABLE:" + e.message + "\n"); process.exit(1); });
')" || {
  echo "" >&2
  echo "That token was not accepted by $BASE." >&2
  echo "A browser token expires after about an hour - get a fresh one:" >&2
  echo "  sign in at $BASE, then in the browser console:  await firebase.auth().currentUser.getIdToken()" >&2
  echo "Creating a hospital needs a StewardMD ACCOUNT (Owner / Doctor sign-in), not a staff PIN session." >&2
  exit 1
}
echo "Signed in as $WHO."

BASE="$BASE" WSQ_OWNER_TOKEN="$TOKEN" node scripts/wardsynq-demo-hospital.mjs
