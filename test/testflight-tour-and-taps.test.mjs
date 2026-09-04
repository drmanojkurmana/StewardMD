// Regression guard for the three TestFlight bugs fixed in build 4 (July 2026):
//   1. Guided tour appeared over the sign-in screen before login.
//   2. Medical Update card action buttons were untappable (home FAB floating over them).
//   3. MaiK answer: source disclosure + "Show more" did not respond.
// Part A runs the REAL onboarding.js gating functions (extracted from source, like
// sw-activate.test.mjs) so a behavioural revert fails. Parts B/C assert the home.js fix
// invariants are present and the buggy patterns are gone, so a code revert fails too.
// Run: node test/testflight-tour-and-taps.test.mjs   (or: npm test)
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("✗ FAIL:", n); } };

// ── Part A — REAL onboarding.js tour gating (bug 1) ──────────────────────────
const onb = readFileSync(new URL("../onboarding.js", import.meta.url), "utf8");
const gatingSrc = (onb.match(/function gateUp\(\) \{[\s\S]*?\n  \}\n  function homeForeground\(\) \{[\s\S]*?\n  \}/) || [])[0];
ok("onboarding.js: gateUp()+homeForeground() found in source", !!gatingSrc);
if (gatingSrc) {
  const make = new Function("document", "visible", gatingSrc + "\nreturn { gateUp: gateUp, homeForeground: homeForeground };");
  // Fake DOM: home = #homeV2 (may be rendered `.on` under a gate); gates = visible overlays.
  const scene = ({ home = null, gates = [] }) => make(
    { getElementById: (id) => {
        if (id === "homeV2") return home;
        return gates.includes(id) ? { _vis: true } : null;
      },
      // onboarding.js's homeForeground() also probes overlays via querySelector
      // (appOverlayUp); stub it so the extracted gating fn runs (no overlay in these scenes).
      querySelector: () => null },
    (el) => !!(el && el._vis)
  );
  const homeUnderGate = { _vis: true, classList: { contains: (c) => c === "on" } };
  const homeActive    = { _vis: true, classList: { contains: (c) => c === "on" } };
  const homeNotYetOn  = { _vis: false, classList: { contains: () => false } };

  // THE bug: home is rendered (.on, visible) UNDER the sign-in gate → tour must NOT show.
  ok("tour BLOCKED while sign-in gate is up (home rendered underneath)",
    scene({ home: homeUnderGate, gates: ["accountGate"] }).homeForeground() === false);
  ok("tour BLOCKED while intro poster is up",
    scene({ home: homeUnderGate, gates: ["introPoster"] }).homeForeground() === false);
  ok("tour BLOCKED while doctor-verification gate is up",
    scene({ home: homeUnderGate, gates: ["verifyGate"] }).homeForeground() === false);
  ok("tour BLOCKED before home is the active screen (no .on yet)",
    scene({ home: homeNotYetOn, gates: [] }).homeForeground() === false);
  // Correct path: home active and no gate → tour allowed.
  ok("tour ALLOWED once home is active and no gate is up",
    scene({ home: homeActive, gates: [] }).homeForeground() === true);
}

// ── Part B — REAL home.js FAB-over-overlay guard (bug 2) ─────────────────────
const home = readFileSync(new URL("../home.js", import.meta.url), "utf8");
ok("home.js: FAB hidden while a notifications/detail overlay is open",
  /overlayUp\s*=\s*!!document\.querySelector\(["']\.ntf-overlay\.on["']\)/.test(home));
ok("home.js: FAB visibility actually gates on overlayUp",
  /if \(gateUp \|\| overlayUp\) show = false/.test(home));

// ── Part C — REAL home.js MaiK disclosure + show-more delegation (bug 3) ─────
ok("home.js: source <details> toggled explicitly (WebKit flex-summary fix)",
  /closest\(["']\.maik-src summary["']\)/.test(home) && /dts\.open = !dts\.open/.test(home));
ok("home.js: 'Show more/less' handled via delegation (survives cache restore)",
  /closest\(["']\.maik-more["']\)/.test(home));
ok("home.js: the fragile live-only 'Show more' listener is gone",
  !/mb\.addEventListener\(["']click["']/.test(home));
// Selector widened 2026-09-03 to include [data-maik-tool] and [data-maik-refine] - without them the
// "Open Drug Index" / calculators / interactions chips and the refine chips never reached the click
// handler at all (found live on the owner's phone). Still one delegated listener, still data-maik-q.
ok("home.js: follow-up chips still routed via delegated data-maik-q",
  /closest\(["']\[data-maik-q\],\[data-maik-web\],\[data-maik-tool\],\[data-maik-refine\]["']\)/.test(home));

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
