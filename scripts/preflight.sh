#!/usr/bin/env bash
# preflight.sh — run BEFORE any native build (gradlew assembleDebug / iOS archive).
# Catches these failure classes that shipped broken builds this session:
#   1. Missing Firebase config  -> app crashes on launch ("Default FirebaseApp is not initialized"
#      at PushNotificationsPlugin.register) because app/build.gradle only applies google-services when
#      the file exists. This is the #1 thing to guard.
#   2. Unresolved merge markers in web entry files -> broken JS/HTML shipped.
#   3. Needle engine binaries not fetched (gitignored) -> Android link / iOS package resolution fails.
#      Set PLATFORM=android or PLATFORM=ios to check only the platform being built.
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

echo "== preflight 3/4: Needle native engine fetched =="
# The Needle plugin is linked into both apps, but its engine binaries are gitignored (fetch-needle.sh).
# Android: CMake links libs/arm64-v8a/libneedle.a. iOS: Package.swift's binaryTarget is the xcframework
# that make-xcframework.sh builds. PLATFORM=android|ios checks one; default checks both.
NEEDLE=local-plugins/capacitor-needle
if [ "${PLATFORM:-all}" != "ios" ]; then
  if [ -f "$NEEDLE/android/libs/arm64-v8a/libneedle.a" ]; then
    echo "  ok: $NEEDLE/android/libs/arm64-v8a/libneedle.a"
  else
    echo "  FAIL: $NEEDLE/android/libs/arm64-v8a/libneedle.a MISSING -> the Android native build will not link."
    echo "        Run:  $NEEDLE/scripts/fetch-needle.sh"
    fail=1
  fi
fi
if [ "${PLATFORM:-all}" != "android" ]; then
  if [ -d "$NEEDLE/ios/Frameworks/CNeedle.xcframework" ]; then
    echo "  ok: $NEEDLE/ios/Frameworks/CNeedle.xcframework"
  else
    echo "  FAIL: $NEEDLE/ios/Frameworks/CNeedle.xcframework MISSING -> the iOS build will not resolve the Needle package."
    echo "        Run:  $NEEDLE/scripts/fetch-needle.sh && $NEEDLE/scripts/make-xcframework.sh"
    fail=1
  fi
fi

echo "== preflight 4/4: unit tests =="
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
