#!/usr/bin/env bash
# test/native-host/run.sh — check the Edge native code WITHOUT a phone (Linux host; not part of npm test).
#
#   test/native-host/run.sh android   build the llama and speech plugins; 16 KB alignment, JNI exports,
#                                     every import resolvable at API 26
#   test/native-host/run.sh llama     the REAL llama_jni.cpp + LlamaEngine on this CPU with FunctionGemma,
#                                     with and without the router grammar, and the forced prefix + digit pick
#                                     (its tokens must be the llama-json target's: {"option": = 14937 4485 1083)
#   test/native-host/run.sh all
# LIMIT=60 (rows per model run; 0 = all 1,512). WORK=<dir> for downloads and builds (default /tmp/smd-native).
#
# `llama` also runs on macOS (arm64) with JAVA_HOME set.
# Needs: ANDROID_HOME with ndk;27.2.12479018 and cmake;3.22.1, JDK 21, node. Run `node scripts/edge/export.mjs` first.
# The Needle mode and plugin were removed on 2026-11-13 (StewardMD Edge is rules only); FunctionGemma stays
# here only as the test model for capacitor-llama's grammar and forced-pick features, which MaiK keeps.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; HERE="$ROOT/test/native-host"
WORK="${WORK:-/tmp/smd-native}"; LIMIT="${LIMIT:-60}"; MODE="${1:-all}"; mkdir -p "$WORK"
NDK="${ANDROID_HOME:?set ANDROID_HOME}/ndk/27.2.12479018"; TC="$NDK/toolchains/llvm/prebuilt/linux-x86_64"
JOS="$(uname | tr '[:upper:]' '[:lower:]')"; NPROC="$(getconf _NPROCESSORS_ONLN)"
JINC="-I${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}/include -I${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}/include/$JOS"
# A JDK without headers (Android Studio's JBR): the NDK's jni.h is self-contained, use it.
[ -f "${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}/include/jni.h" ] || { mkdir -p "$WORK/jni"; cp "$NDK"/toolchains/llvm/prebuilt/*/sysroot/usr/include/jni.h "$WORK/jni/"; JINC="-I$WORK/jni"; }
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
BAKE="$ROOT/vault/plans/edge-data/dataset/export/bakeoff/test.jsonl"

fetch() {  # url dest sha256
  [ -f "$2" ] && echo "$3  $2" | sha256 -c - >/dev/null 2>&1 && return 0
  mkdir -p "$(dirname "$2")"; curl -fL --retry 3 -o "$2.part" "$1"
  echo "$3  $2.part" | sha256 -c - >/dev/null || { echo "SHA-256 MISMATCH: $1"; exit 1; }; mv "$2.part" "$2"
}
stubs() {
  mkdir -p "$WORK/stub/android" "$WORK/stublib"
  cp "$HERE/android_log_stub.h" "$WORK/stub/android/log.h"
  cc -c -fPIC -O2 "$HERE/android_log_stub.c" -o "$WORK/stublib/log.o" && ar rcs "$WORK/stublib/liblog.a" "$WORK/stublib/log.o"
}
rows() {  # the exported bake-off prompts with the router's own grammar string, base64 per field
  [ -f "$BAKE" ] || { echo "run node scripts/edge/export.mjs first"; exit 1; }
  (cd "$ROOT" && node -e '
    const fs=require("fs"), E=require("./edge-router.js"), lim=+process.argv[2];
    let r=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(JSON.parse);
    if (lim) r=r.filter((_,i)=>i%Math.max(1,Math.floor(r.length/lim))===0).slice(0,lim);
    const b=(s)=>Buffer.from(s,"utf8").toString("base64");
    fs.writeFileSync(process.argv[3], r.map(x=>[x.id,b(x.system),b(x.prompt),b(E.grammarFor(x.n_options)),x.n_options].join("\t")).join("\n")+"\n");
    fs.writeFileSync(process.argv[4], JSON.stringify(E.TOOL_SCHEMA)); fs.writeFileSync(process.argv[5], E.SYSTEM);' "$BAKE" "$LIMIT" "$WORK/rows.tsv" "$WORK/tools.json" "$WORK/system.txt")
}

android() {
  local G="$WORK/gradle"; rm -rf "$G"; mkdir -p "$G"
  cat > "$G/settings.gradle" <<EOF
include ':capacitor-android'
project(':capacitor-android').projectDir = new File('$ROOT/node_modules/@capacitor/android/capacitor')
include ':stewardmd-capacitor-llama'
project(':stewardmd-capacitor-llama').projectDir = new File('$ROOT/local-plugins/capacitor-llama/android')
include ':capacitor-community-speech-recognition'
project(':capacitor-community-speech-recognition').projectDir = new File('$ROOT/local-plugins/capacitor-community-speech-recognition/android')
EOF
  # Google's mirror of Maven Central first: Maven Central rate-limits cloud IPs (HTTP 429).
  cat > "$G/build.gradle" <<EOF
buildscript { repositories { google(); maven { url 'https://maven-central.storage-download.googleapis.com/maven2/' }; mavenCentral() }
  dependencies { classpath 'com.android.tools.build:gradle:8.13.0' } }
apply from: '$ROOT/android/variables.gradle'
allprojects { repositories { google(); maven { url 'https://maven-central.storage-download.googleapis.com/maven2/' }; mavenCentral() } }
EOF
  echo "org.gradle.jvmargs=-Xmx4g" > "$G/gradle.properties"; echo "android.useAndroidX=true" >> "$G/gradle.properties"
  echo "sdk.dir=$ANDROID_HOME" > "$G/local.properties"; cp -r "$ROOT/android/gradle" "$ROOT/android/gradlew" "$G/"
  (cd "$ROOT" && git submodule update --init --depth 1 local-plugins/capacitor-llama/android/src/main/cpp/llama-cpp)
  (cd "$G" && ./gradlew --no-daemon -q :stewardmd-capacitor-llama:assembleDebug :capacitor-community-speech-recognition:assembleDebug)
  echo "speech plugin (on-device option, A1.2): compiled"
  local fail=0
  for so in "$ROOT"/local-plugins/capacitor-llama/android/build/intermediates/merged_native_libs/debug/mergeDebugNativeLibs/out/lib/arm64-v8a/lib*_jni.so; do
    local d; d="$(dirname "$so")"
    local align; align="$("$TC/bin/llvm-readelf" -lW "$so" | awk '/LOAD/{print $NF}' | sort -u | tr '\n' ' ')"
    { for l in libc libm libdl liblog libandroid; do f="$TC/sysroot/usr/lib/aarch64-linux-android/26/$l.so"; [ -f "$f" ] && "$TC/bin/llvm-nm" -D --defined-only "$f"; done
      "$TC/bin/llvm-nm" -D --defined-only "$d/libc++_shared.so"; } | awk '{print $NF}' | sed 's/@.*//' | sort -u > "$WORK/defs.txt"
    "$TC/bin/llvm-nm" -D -u "$so" | awk '{print $NF}' | sed 's/@.*//' | sort -u > "$WORK/undef.txt"
    local unres; unres="$(comm -23 "$WORK/undef.txt" "$WORK/defs.txt" | tr '\n' ' ')"
    echo "$(basename "$so"): LOAD align [$align] imports $(wc -l < "$WORK/undef.txt"), unresolved at API 26: [${unres}]"
    [ "$align" = "0x4000 " ] || fail=1; [ -z "$unres" ] || fail=1
    "$TC/bin/llvm-nm" -D --defined-only "$so" | grep -o 'Java_[A-Za-z_]*' | sed 's/^/  export /'
  done
  [ $fail = 0 ] && echo "ANDROID: PASS" || { echo "ANDROID: FAIL"; exit 1; }
}

llama() {
  stubs; rows
  local L="$WORK/llama"; mkdir -p "$L"
  (cd "$ROOT" && git submodule update --init --depth 1 local-plugins/capacitor-llama/android/src/main/cpp/llama-cpp)
  cmake -S "$ROOT/local-plugins/capacitor-llama/android/src/main/cpp" -B "$L/build" -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=ON -DGGML_METAL=OFF \
    -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DCMAKE_LIBRARY_PATH="$WORK/stublib" -DCMAKE_C_FLAGS="-I$WORK/stub" \
    -DCMAKE_CXX_FLAGS="-I$WORK/stub $JINC -include cstring" >/dev/null
  cmake --build "$L/build" -j"$NPROC" --target llama_jni >/dev/null
  # FunctionGemma 270M Q8_0 from ggml-org, pinned by revision and sha256 (Gemma terms of use).
  fetch "https://huggingface.co/ggml-org/functiongemma-270m-it-GGUF/resolve/2566ce14aedfc14fdd0de955ba67346425e67126/functiongemma-270m-it-q8_0.gguf" \
    "$WORK/models/functiongemma-270m-it-q8_0.gguf" 83940d4dd9676710856f43523bed096164a595a96f6b34771610a03937de5270
  local J="$ROOT/local-plugins/capacitor-llama/android/src/main/java/in/stewardmd/llama"
  rm -rf "$L/classes"; javac -d "$L/classes" "$HERE/Log.java" "$J"/LlamaNative.java "$J"/LlamaEngine.java "$J"/LlamaErr.java "$J"/LlamaException.java "$HERE/GrammarHarness.java"
  for g in on off pick; do
    java -Djava.library.path="$L/build" -cp "$L/classes" GrammarHarness "$WORK/models/functiongemma-270m-it-q8_0.gguf" "$WORK/rows.tsv" $g > "$WORK/llama-$g.jsonl" 2>/dev/null
  done
  (cd "$ROOT" && node -e '
    const fs=require("fs"), idx={}; fs.readFileSync(process.argv[3],"utf8").split("\n").filter(Boolean).map(JSON.parse).forEach(r=>idx[r.id]=r);
    for (const g of ["on","off"]) {
      const L=fs.readFileSync(process.argv[1]+"/llama-"+g+".jsonl","utf8").split("\n").filter(Boolean).map(JSON.parse); let v=0; const preds=[];
      L.forEach(l=>{ try { const o=JSON.parse(l.text).option; if (Number.isInteger(o)) { v++; preds.push({id:l.id,option:o,confidence:null,ms:l.ms,status:"ok"}); } } catch(e) {} });
      const ms=L.map(l=>l.ms).sort((a,b)=>a-b);
      console.log("grammar "+g+": valid {\"option\":n} "+v+"/"+L.length+", p50 "+ms[ms.length>>1]+" ms (this CPU, not a phone)");
      if (g==="on") fs.writeFileSync(process.argv[2], preds.map(p=>JSON.stringify(p)).join("\n")+"\n");
    }
    // Forced prefix + digit pick: the served tokens must be the llama-json target {"option":n} (training
    // text, no train/serve drift), and the answer is compared with the grammar run above.
    const P=fs.readFileSync(process.argv[1]+"/llama-pick.jsonl","utf8").split("\n").filter(Boolean).map(JSON.parse);
    const on={}; fs.readFileSync(process.argv[1]+"/llama-on.jsonl","utf8").split("\n").filter(Boolean).map(JSON.parse).forEach(l=>{ try { on[l.id]=JSON.parse(l.text).option; } catch(e) {} });
    const dig={}; let bad=0, same=0;
    P.forEach(l=>{ if (l.option==null || l.tail.slice(0,3).join(" ")!=="14937 4485 1083") bad++; else { (dig[l.option]=dig[l.option]||new Set()).add(l.tail[3]); if (on[l.id]===l.option) same++; } });
    const digOk=Object.values(dig).every(s=>s.size===1) && (!dig[3] || dig[3].has(236800));
    const pm=P.map(l=>l.ms).sort((a,b)=>a-b);
    console.log("pick: "+(P.length-bad)+"/"+P.length+" end in {\"option\": = 14937 4485 1083, one token per digit "+(digOk?"yes":"NO")+
      ", same option as the grammar run "+same+"/"+P.length+", p50 "+pm[pm.length>>1]+" ms (this CPU)");
    if (bad || !digOk) { console.log("PICK: FAIL"); process.exit(1); }
    ' "$WORK" "$WORK/preds-functiongemma-base.jsonl" "${BAKE%test.jsonl}test.index.jsonl")
  echo "score: node scripts/edge/score.mjs --pred $WORK/preds-functiongemma-base.jsonl"
}

case "$MODE" in
  android) android ;; llama) llama ;;
  all) android; llama ;;
  *) echo "usage: $0 android|llama|all"; exit 2 ;;
esac
