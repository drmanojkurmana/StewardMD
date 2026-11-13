#!/usr/bin/env bash
# preflight.sh — run BEFORE any native build (gradlew assembleDebug / iOS archive).
# Catches these failure classes that shipped broken builds this session:
#   1. Missing Firebase config  -> app crashes on launch ("Default FirebaseApp is not initialized"
#      at PushNotificationsPlugin.register) because app/build.gradle only applies google-services when
#      the file exists. This is the #1 thing to guard.
#   2. Unresolved merge markers in web entry files -> broken JS/HTML shipped.
#   3. A native project still wiring in the removed Needle plugin (capacitor-needle, deleted 2026-11-13):
#      a stale `cap sync` or an old checkout would fail the Android link / iOS package resolution.
# Also runs the unit suite (skippable with RUN_TESTS=0 for a config-only check).
# Exits non-zero on any hard failure so the build aborts.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0

echo "== preflight 1/4: Firebase config present =="
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

echo "== preflight 2/4: no unresolved merge markers in web entry files =="
if grep -RIlnE '^(<<<<<<<|>>>>>>>|=======$)' index.html ./*.js 2>/dev/null; then
  echo "  FAIL: merge conflict markers found above."
  fail=1
else
  echo "  ok"
fi

echo "== preflight 3/4: removed Needle plugin not wired in =="
if grep -n "capacitor-needle\|CapacitorNeedle" android/capacitor.settings.gradle android/app/capacitor.build.gradle ios/App/CapApp-SPM/Package.swift 2>/dev/null; then
  echo "  FAIL: the Needle plugin was removed on 2026-11-13 but a native project still references it (above)."
  echo "        Run:  npm install && npx cap sync"
  fail=1
else
  echo "  ok"
fi

echo "== preflight 4/4: unit tests =="
if [ "${RUN_TESTS:-1}" = "0" ]; then
  echo "  skipped (RUN_TESTS=0)"
elif command -v node >/dev/null 2>&1; then
  # Flagged form, as CI and npm test: bare `node --test` fails every file that calls mock.module().
  if node --test --experimental-test-module-mocks --experimental-sqlite test/*.test.mjs >/tmp/smd-preflight-tests.log 2>&1; then
    echo "  ok: unit tests pass"
  else
    echo "  FAIL: unit tests failed (tail below)"; tail -15 /tmp/smd-preflight-tests.log
    fail=1
  fi
else
  echo "  warn: node not found, skipping tests"
fi

if [ "$fail" = "0" ]; then echo "PREFLIGHT OK"; else echo "PREFLIGHT FAILED — do not build/release"; exit 1; fi
