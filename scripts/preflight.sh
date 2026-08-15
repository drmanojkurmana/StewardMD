#!/usr/bin/env bash
# preflight.sh — run BEFORE any native build (gradlew assembleDebug / iOS archive).
# Catches the two failure classes that shipped broken builds this session:
#   1. Missing Firebase config  -> app crashes on launch ("Default FirebaseApp is not initialized"
#      at PushNotificationsPlugin.register) because app/build.gradle only applies google-services when
#      the file exists. This is the #1 thing to guard.
#   2. Unresolved merge markers in web entry files -> broken JS/HTML shipped.
# Also runs the unit suite (skippable with RUN_TESTS=0 for a config-only check).
# Exits non-zero on any hard failure so the build aborts.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0

echo "== preflight 1/3: Firebase config present =="
# Android phone Firebase config is REQUIRED (its absence crashes the app on launch).
if [ -f android/app/google-services.json ]; then
  echo "  ok: android/app/google-services.json"
else
  echo "  FAIL: android/app/google-services.json MISSING -> app WILL crash on launch."
  echo "        Copy it in before building:  cp <source>/android/app/google-services.json android/app/"
  fail=1
fi
# Wear + iOS are warnings (wear degrades to no-Firebase gracefully; iOS plist path varies).
[ -f android/wear/google-services.json ] && echo "  ok: android/wear/google-services.json" || echo "  warn: android/wear/google-services.json missing (Wear Firebase off)"
ls ios/App/App/GoogleService-Info.plist >/dev/null 2>&1 && echo "  ok: iOS GoogleService-Info.plist" || echo "  warn: iOS GoogleService-Info.plist missing"

echo "== preflight 2/3: no unresolved merge markers in web entry files =="
if grep -RIlnE '^(<<<<<<<|>>>>>>>|=======$)' index.html ./*.js 2>/dev/null; then
  echo "  FAIL: merge conflict markers found above."
  fail=1
else
  echo "  ok"
fi

echo "== preflight 3/3: unit tests =="
if [ "${RUN_TESTS:-1}" = "0" ]; then
  echo "  skipped (RUN_TESTS=0)"
elif command -v node >/dev/null 2>&1; then
  if node --test test/*.test.mjs >/tmp/smd-preflight-tests.log 2>&1; then
    echo "  ok: unit tests pass"
  else
    echo "  FAIL: unit tests failed (tail below)"; tail -15 /tmp/smd-preflight-tests.log
    fail=1
  fi
else
  echo "  warn: node not found, skipping tests"
fi

if [ "$fail" = "0" ]; then echo "PREFLIGHT OK"; else echo "PREFLIGHT FAILED — do not build/release"; exit 1; fi
