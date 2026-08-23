#!/usr/bin/env bash
# scripts/verify-clinix-bundle.sh — confirm www/ actually contains CliniX BEFORE installing.
#
# CLAUDE.md's native-build rule: "verify the built public/index.html ?v= token + a code marker
# BEFORE installing". This is that check for CliniX. The failure it exists to catch is silent:
# root *.js and *.css are copied by glob, but clinix/ is a DATA directory and needs an explicit
# cp -R in build-www.sh. Without it the app installs fine, the tile appears, and every pathway
# renders empty on the device - which is exactly the kb/onco bug build-www.sh documents itself.
#
#   bash scripts/build-www.sh && bash scripts/verify-clinix-bundle.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WWW="$ROOT/www"
fail=0
say() { printf '  %-34s %s\n' "$1" "$2"; }
bad() { fail=1; printf '  %-34s %s\n' "$1" "MISSING  <-- $2"; }

[ -d "$WWW" ] || { echo "no www/ - run scripts/build-www.sh first"; exit 1; }
echo "CliniX bundle check: $WWW"

for f in clinix.js clinix-flags.js clinix-model.js clinix-content.js clinix-store.js \
         clinix-tutor.js clinix-diagrams.js clinix-screens.js clinix.css; do
  [ -f "$WWW/$f" ] && say "$f" "ok" || bad "$f" "root glob in build-www.sh"
done

for f in manifest.json skills/core.json skills/respiratory.json \
         diseases/copd.json diseases/pleural-effusion.json media/manifest.json; do
  [ -f "$WWW/clinix/$f" ] && say "clinix/$f" "ok" || bad "clinix/$f" "cp -R clinix in build-www.sh"
done

n=$(grep -c 'clinix.*\.js?v=' "$WWW/index.html" 2>/dev/null || echo 0)
[ "$n" -ge 7 ] && say "index.html script tags" "$n" || bad "index.html script tags" "expected >=7, got $n"
grep -q 'clinix\.css?v=' "$WWW/index.html" && say "index.html css link" "ok" || bad "index.html css link" "add the <link>"
grep -q 'act: "clinix"' "$WWW/home.js" && say "home tile (HOME_TOOLS)" "ok" || bad "home tile" "home.js ACT + HOME_TOOLS"
grep -q 'id: "clinix"' "$WWW/sidebar-redesign.js" && say "Settings toggle" "ok" || bad "Settings toggle" "sidebar-redesign.js TOGGLES"
say "sw.js CACHE" "$(grep -o 'stewardmd-nb[^\"]*' "$WWW/sw.js" 2>/dev/null || echo '?')"
say "clinix/ payload" "$(du -sh "$WWW/clinix" 2>/dev/null | cut -f1)"

# The OTA client only becomes live once the plugin is in the NATIVE project, which needs
# npm install + npx cap sync. Without that, native-ota.js ships but available() stays false.
[ -f "$WWW/native-ota.js" ] && say "native-ota.js (OTA client)" "ok" || bad "native-ota.js" "OTA stays inert"
if [ -f "$ROOT/android/capacitor.settings.gradle" ]; then
  grep -q -i "capacitor-updater" "$ROOT/android/capacitor.settings.gradle" \
    && say "OTA plugin in android project" "ok" \
    || say "OTA plugin in android project" "NOT SYNCED - run npm install && npx cap sync"
fi

echo
[ $fail -eq 0 ] && echo "PASS - safe to cap sync and install." || echo "FAIL - do NOT install this bundle."
exit $fail
