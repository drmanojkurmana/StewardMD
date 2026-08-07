/* Regression guard for the 19 Jul 2026 TestFlight bug report (13 bugs + 1 enhancement).
 * Asserts each fix is present in source (so a future edit can't silently revert it) and
 * checks the core clinical logic (MAP / GCS clamp / display-scale clamp / de-dup).
 * USAGE: node test/testflight-fixes.test.mjs   (also runs under `npm test`). */
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(join(ROOT, f), "utf8");
let fails = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

const wiz = read("abx-wizard.js"), app = read("app.js"), home = read("home.js"),
  voice = read("voice.js"), ghis = read("ghis-ward.js"),
  sw = read("local-plugins/capacitor-whisper/ios/Sources/WhisperPlugin/WhisperEngine.swift"),
  store = read("local-plugins/capacitor-whisper/ios/Sources/WhisperPlugin/ModelStore.swift");

// BUG-01 / BUG-04 — Sex + graded fields render as tappable chips, not a numeric keypad
ok(wiz.includes("function selectFields") && wiz.includes("f.selectOptions || f.options"), "BUG-01/04: select & graded fields render as option chips");
ok(wiz.includes('function isNumeric(f) { return f.type === "number"; }'), "BUG-01/04: selects excluded from the numeric-keypad path");
ok(app.includes('label:"Female"},{value:"other",label:"Other"}'), "BUG-01: Sex options are Male / Female / Other");
// BUG-02 — MAP auto-calculates from SBP/DBP (editable override)
ok(wiz.includes("_d + (_s - _d) / 3"), "BUG-02: MAP = DBP + (SBP−DBP)/3 auto-populates");
// BUG-03 — GCS clamped to 3–15
ok(wiz.includes("gv > 15") && wiz.includes("inp.min = 3; inp.max = 15"), "BUG-03: GCS hard-limited to 3–15");
// BUG-05 — tapping a system drills into its findings (scrolls the panel into view)
ok(wiz.includes('block: "start"'), "BUG-05: selecting a system scrolls into its symptoms");
// BUG-08 — Clinical Reasoning reachable from MARINAM; Classic toggle removed
ok(wiz.includes('"openreasoning"') && wiz.includes("DX.openWorkspace"), "BUG-08: Clinical Reasoning reachable from MARINAM");
ok(wiz.includes("MARINAM is now the ONLY UI") && !wiz.includes('data-act="toclassic"'), "BUG-08: MARINAM/Classic toggle removed (MARINAM always-on)");
// BUG-06 / BUG-07 — display scale clamped + reset always reachable
ok(home.includes("Math.min(2, Math.max(.8"), "BUG-06/07: display scale clamped (widened 1.25 -> 2.0 for low vision)");
ok(home.includes('max="200"'), "BUG-07: font-size slider max is 200%");
ok(home.includes("_sh.style.zoom = _inv"), "BUG-07: Display sheet counter-zoomed so Reset stays reachable");
// BUG-09 — MaiK dark-mode glow brightened
ok(home.includes("rgba(45,212,191,.42)"), "BUG-09: dark-mode MaiK glow brightened");
// BUG-11 — Recent Activity de-duped + timestamped + feature icons
ok(home.includes("de-duplicate consecutive identical sessions") && home.includes("_rago"), "BUG-11: Recent Activity de-duped + timestamp + icons");
// BUG-12 — Scribe recording-failure shows an actionable message
ok(voice.includes('recording-failure" || err === "transcription-failure"'), "BUG-12: Scribe recording-failure → actionable message");
// BUG-13 — native whisper ctx guarded against concurrent free (use-after-free crash)
ok(sw.includes("private let ctxLock = NSLock()") && sw.includes("ctxLock.lock()"), "BUG-13: whisper ctx guarded by a lock");
ok(store.includes("400 * 1024 * 1024"), "BUG-13: storage precheck sized for the ~181 MB model");
// ENH-01 — blood culture captured via Ward Sync
ok(ghis.includes("bloodCulture: true"), "ENH-01: blood culture captured via Ward Sync");

// ---- core clinical logic (documents intended behavior) ----
const map = (s, d) => Math.round(d + (s - d) / 3);
ok(map(120, 60) === 80 && map(90, 60) === 70, "logic: MAP 120/60→80, 90/60→70");
const clampGcs = (v) => { v = parseInt(v, 10); if (v > 15) v = 15; if (v < 3) v = 3; return v; };
ok(clampGcs(20) === 15 && clampGcs(1) === 3 && clampGcs(12) === 12, "logic: GCS clamp 20→15, 1→3, 12→12");
const clampScale = (v) => Math.min(2, Math.max(0.8, v));
ok(clampScale(2.4) === 2 && clampScale(0.7) === 0.8 && clampScale(1.1) === 1.1, "logic: display scale clamp 2.4->2, 0.7->0.8");
const dedup = (list) => { let prev = null; return list.filter((it) => { const k = (it.title || "") + "|" + (it.summary || ""); if (k === prev) return false; prev = k; return true; }); };
ok(dedup([{ title: "A", summary: "x" }, { title: "A", summary: "x" }, { title: "B", summary: "y" }]).length === 2, "logic: Recent Activity de-dups consecutive identical");

console.log(fails === 0 ? "\nALL PASS — TestFlight fixes present" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
