#!/usr/bin/env bash
# scripts/verify-surgx-bundle.sh — confirm www/ actually contains SURGX BEFORE installing.
#
# Sibling of verify-clinix-bundle.sh, and it exists for the same recorded incident: a module can be
# present and working on the device while the service worker still serves the pre-module copies of
# the files that provide the DOOR to it. The symptom is maximally misleading - no tile, no toggle,
# and a module that is right there.
#
# test/surgx-content.test.mjs asserts the repo-side facts. This asserts the BUILT OUTPUT, which is
# the thing that actually reaches the phone.
#
#   bash scripts/build-www.sh && bash scripts/verify-surgx-bundle.sh
set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

WWW="www"
fail=0
say() { printf '%s %s\n' "$1" "$2"; }
chk() { if [ "$1" -eq 0 ]; then say "  ok  " "$2"; else say "  FAIL" "$2"; fail=$((fail+1)); fi; }

echo "SURGX bundle check on $WWW/"

[ -d "$WWW" ]; chk $? "www/ exists (run build-www.sh first)"

# 1. Every runtime file made it in.
for f in surgx-flags.js surgx-model.js surgx-content.js surgx-note-schema.js surgx-store.js \
         surgx-entitlement.js surgx-evidence.js surgx-diagrams.js surgx-screens.js surgx.js surgx.css; do
  [ -f "$WWW/$f" ]; chk $? "$f"
done

# 2. ws-surgery.js — SURGX projects it, so without it every engine protocol vanishes.
[ -f "$WWW/ws-surgery.js" ]; chk $? "ws-surgery.js (the protocol engine SURGX projects)"

# 3. The content directory. Root *.js/*.css are globbed by build-www.sh; DATA DIRS ARE NOT.
#    Without the explicit cp -R, the tile appears and every section renders empty on the device.
[ -f "$WWW/surgx/manifest.json" ]; chk $? "surgx/manifest.json"
[ -f "$WWW/surgx/protocols/engine-overlay.json" ]; chk $? "surgx/protocols/engine-overlay.json"
[ -f "$WWW/surgx/evidence/index.json" ]; chk $? "surgx/evidence/index.json"
[ -f "$WWW/surgx/media/manifest.json" ]; chk $? "surgx/media/manifest.json"
n=$(find "$WWW/surgx" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
[ "${n:-0}" -ge 20 ]; chk $? "surgx/ carries its content ($n json files, expected >= 20)"

# 4. THE ONE THAT BIT CLINIX: the files that provide the door must have a fresh ?v= token, or the
#    service worker keeps serving the pre-SURGX copies and there is no tile and no toggle.
for f in home.js sidebar-redesign.js workspaces.js; do
  grep -qE "/$f\?v=[^\"']*surgx" "$WWW/index.html"; chk $? "$f is loaded with a surgx-marked ?v= token"
done
grep -q 'surgx.css?v=' "$WWW/index.html"; chk $? "surgx.css is linked with a ?v= token"
grep -qE 'var CACHE = "[^"]*surgx' "$WWW/sw.js"; chk $? "sw.js CACHE was bumped for SURGX"

# 5. Load order is load-bearing: the model must resolve before the content loader uses its gates.
order_ok=$(awk '
  /surgx-flags\.js/   { f=NR }
  /surgx-model\.js/   { m=NR }
  /surgx-content\.js/ { c=NR }
  /surgx-screens\.js/ { s=NR }
  /\/surgx\.js\?v=/   { e=NR }
  END { print (f && m && c && s && e && f<m && m<c && c<s && s<e) ? 0 : 1 }
' "$WWW/index.html")
[ "$order_ok" = "0" ]; chk $? "script load order: flags < model < content < screens < surgx.js"

echo
if [ "$fail" -eq 0 ]; then
  echo "SURGX bundle looks correct. Safe to cap sync + install."
  echo "Reminder: devicectl uninstall BEFORE installing, to drop the stale service worker."
  exit 0
fi
echo "$fail check(s) failed — do NOT install this bundle."
exit 1
