/* test/maik-chat-skin.test.mjs — the MaiK CHAT skin (body.mkchat), source-level.
 *
 * Owner (2026-09-04): "not getting a feel of using an AI assistant like ChatGPT or Claude". The
 * audit found five concrete differences (boxed answer cards with an uppercase label, a disclaimer
 * inside every answer on top of the banner, 13px widget text, up to 17 loud chips per answer, a
 * skeleton-bar loader). The skin is presentation-only CSS behind a default-ON flag with a kill
 * switch, so this guards three things: the flag really defaults on and can be turned off, each of
 * the five fixes is present in the CSS, and the app-facing strings the audit flagged (emoji chip
 * prefixes, em-dashes) are gone. home.js is a giant IIFE that needs a real WebView to run, so this
 * is a source-level test by the same convention as testflight-tour-and-taps.test.mjs. */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const home = readFileSync(new URL("../home.js", import.meta.url), "utf8");

// ── the flag ──
const flag = home.match(/var k = "smd_mkchat"[\s\S]*?\}\)\(\);/);
ok("the mkchat flag IIFE exists", !!flag);
const f = flag ? flag[0] : "";
ok("it is DEFAULT ON: only an explicit \"0\" turns it off", /localStorage\.getItem\(k\) === "0"/.test(f) && /if \(off\) return;/.test(f));
ok("?mkchat=0 persists the kill switch, ?mkchat=1 clears it", /mkchat=0\\b/.test(f) && /setItem\(k, "0"\)/.test(f) && /mkchat=1\\b/.test(f) && /removeItem\(k\)/.test(f));
ok("it only adds a body class (presentation-only, no DOM/logic change)", /classList\.add\("mkchat"\)/.test(f) && !/innerHTML|appendChild|createElement/.test(f));

// ── the five fixes, in the CSS ──
const css = home.match(/\/\* ══ MaiK CHAT skin[\s\S]*?\/\* ══ MaiK UI 2/);
ok("the chat-skin CSS block exists, before the UI 2 block", !!css);
const c = css ? css[0] : "";
ok("1. assistant answers are unboxed: no background, border, radius or shadow", /body\.mkchat #maikSheet \.maik-b\.ai\{[^}]*background:transparent[^}]*border:none[^}]*border-radius:0[^}]*box-shadow:none/.test(c));
ok("1. the uppercase MAIK label over every answer is hidden (with !important, the web path inlines its own display)", /body\.mkchat #maikSheet \.maik-attr\{display:none!important\}/.test(c));
ok("1. the user's message stays a bubble (only that side is boxed)", /body\.mkchat #maikSheet \.maik-b\.you\{[^}]*border-radius:18px 18px 6px 18px/.test(c));
ok("2. the per-answer disclaimer line is hidden; the banner is the one disclaimer", /body\.mkchat #maikSheet \.maik-edu\{display:none\}/.test(c));
ok("2. confidence pills hidden except the LOWER-match warning", /\.maik-conf\{display:none\}/.test(c) && /\.maik-conf-lower\{display:inline-flex\}/.test(c));
ok("3. body text is reading-size (15px)", /\.maik-p,body\.mkchat #maikSheet \.maik-li,body\.mkchat #maikSheet \.maik-streaming\{font-size:15px/.test(c));
ok("4. chips are quiet outlines, no fill, no shadow, no lift on hover", /\.maik-fu,body\.mkchat #maikSheet \.maik-chip\{background:transparent;border:1px solid var\(--mk-bd\)/.test(c) && /transform:none/.test(c));
ok("4. the uppercase section labels (Refine / Open in app) become plain sentence labels", /\.maik-refine-lbl,body\.mkchat #maikSheet \.maik-tools-lbl\{text-transform:none;letter-spacing:0/.test(c));
ok("5. skeleton bars are hidden while thinking", /body\.mkchat #maikSheet \.maik-sk\{display:none\}/.test(c));
ok("tokens are not redefined (dark mode follows the existing --mk-* set)", !/--mk-bg:|--mk-ink:|--mk-teal:/.test(c));

// ── the strings the audit flagged ──
for (const s of ["Red flags not to miss", "First-line treatment", "What to investigate", "Differentials and mimics"]) {
  ok(`follow-up chip "${s}" is emoji-free`, new RegExp('label: "' + s + '"').test(home));
}
ok("no emoji chip prefixes remain on the follow-up labels", !/label: "[\u{1F6A9}\u{1F48A}\u{1F52C}\u{1F500}] /u.test(home));
for (const s of ["Thanks, noted.", "Thanks for telling us. This helps.", "Sorry it missed. Please tell us why, so we can improve.",
                 "Almost there, finalizing", "Different topic: search the web", "Saved only on this device. Your history never leaves your phone.",
                 "MaiK took too long to respond. The knowledge search may be busy.", "Clinical workflow: next steps",
                 "Couldn't load the detail. Ask again for the full answer.", "not directly supported by the cited sources. Verify before acting."]) {
  ok(`de-dashed app string present: "${s.slice(0, 40)}"`, home.includes(s));
}
for (const gone of ["Thanks — noted.", "Almost there — finalizing", "Different topic — search the web", "Clinical workflow — next steps",
                    "MaiK is unavailable right now — ", "Sources differ — "]) {
  ok(`em-dash string gone: "${gone.slice(0, 40)}"`, !home.includes(gone));
}

console.log(`maik-chat-skin: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
