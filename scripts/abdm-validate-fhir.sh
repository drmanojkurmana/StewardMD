#!/bin/bash
# scripts/abdm-validate-fhir.sh — validate every emitted ABDM bundle against the REAL NRCES IG.
#
# WHY. Our own validateNdhmDoc is a structural gate, not profile conformance. It passed all eight HI types
# while HAPI, against nrces.in/ndhm/fhir/r4, rejected all eight - because five of the profiles allow
# Composition.section a maximum of ONE with entry slicing CLOSED, and we were emitting five sections for
# everything. A serializer test that only asks our own serializer whether it is happy proves nothing.
#
# This is the tool ABDM's own FAQ (Q37/Q46) names: HAPI validator_cli 6.2.1 with -ig https://nrces.in/ndhm/fhir/r4.
#
# Usage:
#   ./scripts/abdm-validate-fhir.sh              # generate bundles + validate, print a summary
#   ./scripts/abdm-validate-fhir.sh --verbose    # also print every diagnostic
#
# First run downloads ~220MB of jar and the IG packages into ~/.fhir/packages and takes several minutes.
# Later runs are ~40s per bundle. Set ABDM_VALIDATOR_JAR to reuse a jar you already have.
set -uo pipefail
cd "$(dirname "$0")/.."

WORK="${ABDM_VALIDATOR_WORK:-${TMPDIR:-/tmp}/abdm-fhir}"
JAR="${ABDM_VALIDATOR_JAR:-$WORK/validator_cli.jar}"
VER="${ABDM_VALIDATOR_VERSION:-6.2.1}"      # the version ABDM's FAQ names
IG="${ABDM_NRCES_IG:-https://nrces.in/ndhm/fhir/r4}"
mkdir -p "$WORK/bundles"

# Java: prefer JAVA_HOME, then the Android Studio JBR (which is what is actually installed on this mac),
# then whatever is on PATH.
JAVA=""
for cand in "${JAVA_HOME:-}/bin/java" \
            "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java" \
            "$(command -v java 2>/dev/null || true)"; do
  [ -n "$cand" ] && [ -x "$cand" ] && { JAVA="$cand"; break; }
done
[ -n "$JAVA" ] || { echo "no JDK found. Set JAVA_HOME to a JDK 17+ and re-run." >&2; exit 3; }

if [ ! -s "$JAR" ]; then
  echo "downloading HAPI validator_cli $VER (~220MB, once)..."
  curl -fsSL -o "$JAR" \
    "https://github.com/hapifhir/org.hl7.fhir.core/releases/download/$VER/validator_cli.jar" \
    || { echo "download failed" >&2; exit 3; }
fi

echo "generating bundles..."
node scripts/abdm-emit-bundles.mjs "$WORK/bundles" || exit 1

LOG="$WORK/validate.log"
: > "$LOG"
fail=0
for f in "$WORK/bundles"/*.json; do
  name=$(basename "$f" .json)
  # -tx n/a: no terminology server. Structural + profile conformance is what we are asserting; code
  # membership in an external value set is a separate (and network-flaky) question.
  out=$("$JAVA" -Xmx4g -jar "$JAR" "$f" -version 4.0.1 -ig "$IG" -tx n/a -output-style compact 2>&1)
  echo "===== $name" >> "$LOG"; echo "$out" >> "$LOG"
  errs=$(printf '%s\n' "$out" | grep -cE ": Error - " || true)
  printf '%-26s %s\n' "$name" "$([ "$errs" -eq 0 ] && echo "PASS" || echo "$errs error(s)")"
  [ "$errs" -eq 0 ] || fail=1
  [ "${1:-}" = "--verbose" ] && printf '%s\n' "$out" | grep -E ": Error - " | sed 's/^/    /'
done

echo
echo "full log: $LOG"
[ "$fail" -eq 0 ] && echo "ALL BUNDLES CONFORM to $IG" || echo "conformance FAILED - see the log"
exit "$fail"
