// emoji-icons.js pure part: which emoji become which icon, what is kept, what is stripped.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const store = new Map();
global.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null) } };
const E = require("../emoji-icons.js");
const seg = (s) => E.segments(s).map((x) => (x.t != null ? x.t : x.icon ? "<" + x.icon + (x.tone ? ":" + x.tone : "") + ">" : "<dot " + x.dot + ">"));

test("clinical emoji become the matching line icon", () => {
  assert.deepEqual(seg("🔔 Notifications"), ["<bell>", " Notifications"]);
  assert.deepEqual(seg("🩺 Clinical"), ["<steth>", " Clinical"]);
  assert.deepEqual(seg("💊💉 meds"), ["<pills>", "<syringe>", " meds"]);
  assert.deepEqual(seg("👩‍⚕️ Doctor"), ["<steth>", " Doctor"], "ZWJ health worker sequence");
  assert.deepEqual(seg("✏️"), ["<edit>"]);
});

test("status emoji keep their meaning as coloured icons and dots", () => {
  assert.deepEqual(seg("✅ Saved"), ["<check:ok>", " Saved"]);
  assert.deepEqual(seg("⚠️ Low K"), ["<warn:warn>", " Low K"]);
  assert.deepEqual(seg("❌ Failed"), ["<close:bad>", " Failed"]);
  assert.deepEqual(seg("🟢 Online 🔴 Down"), ["<dot #16a34a>", " Online ", "<dot #dc2626>", " Down"]);
});

test("typography is not emoji: arrows, ticks, stars, (c)(tm) stay as text", () => {
  for (const s of ["Rate ↗ 5%", "Score ✓ done ★", "©2026 StewardMD™", "A ↔ B", "▶ Play", "☐ task"]) {
    assert.equal(E.strip(s), s, s); assert.equal(E.has(s), false, s);
  }
});

test("strip() for places that cannot hold an icon: tidy spacing, keycaps keep the digit", () => {
  assert.equal(E.strip("🔔 Notifications"), "Notifications");
  assert.equal(E.strip("Dose 💊 now"), "Dose now");
  assert.equal(E.strip("Step 1️⃣"), "Step 1");
  assert.equal(E.strip("🇮🇳 India"), "India");
  assert.equal(E.strip("no emoji here"), "no emoji here");
});

test("every mapped icon name exists in the app's ICONS catalogue (home.js)", () => {
  const names = new Set([...readFileSync(new URL("../home.js", import.meta.url), "utf8").matchAll(/^\s{4}([a-zA-Z_]+):\s*'/gm)].map((m) => m[1]));
  const missing = [...new Set(Object.values(E.MAP))].filter((n) => !names.has(n));
  assert.deepEqual(missing, []);
});

test("flag smd_noemoji=0 disables it", () => {
  assert.equal(E.enabled(), true);
  store.set("smd_noemoji", "0"); assert.equal(E.enabled(), false); store.clear();
});

test("text leaving the page (PDF, share, clipboard, notifications) is stripped at the shared entry points", () => {
  const out = E.stripDeep({ title: "✅ Saved", text: "🩺 Note for 💊 dose", url: "https://x", notifications: [{ title: "🔔 Rounds", body: "⚠️ K 2.9", id: 1 }] }, 0);
  assert.deepEqual(out, { title: "Saved", text: "Note for dose", url: "https://x", notifications: [{ title: "Rounds", body: "K 2.9", id: 1 }] });
  const src = readFileSync(new URL("../emoji-icons.js", import.meta.url), "utf8");
  for (const hook of ['W.SMD_PDF, "fromHtml"', 'W.SMD_NATIVE, "sharePdfFromHtml"', 'W.navigator, "share"', '"writeText"', 'P.Share, "share"', 'P.LocalNotifications, "schedule"'])
    assert.ok(src.includes(hook), hook);
});

test("AI dashes: asides become commas, ranges and empty values keep their meaning", () => {
  const T = [
    ["Surgical intelligence — notes", "Surgical intelligence, notes"], ["AMR—the silent pandemic", "AMR, the silent pandemic"],
    ["Use it -- carefully", "Use it, carefully"], ["x — y — z.", "x, y, z."], ["Warfarin — avoid; INR — check", "Warfarin, avoid; INR, check"],
    ["Dose 5—10 mg", "Dose 5-10 mg"], ["Age 5 – 10 years", "Age 5-10 years"], ["Duration 7–10 days", "Duration 7–10 days"],
    ["—", "–"], ["HR: —", "HR: –"], ["SBP/DBP —/—", "SBP/DBP –/–"], ["MAP (—)", "MAP (–)"], ["K+ — 2.9 — low", "K+, 2.9, low"],
    ["End of line —", "End of line"], ["— leading", "leading"],
    ["Low-dose aspirin", "Low-dose aspirin"], ["a--b", "a--b"], ["CSS --var stays", "CSS --var stays"], ["no dashes here", "no dashes here"],
  ];
  for (const [a, b] of T) assert.equal(E.tidy(a), b, a);
  assert.equal(E.tidy("Title —", { next: true }), "Title, ", "text continues in the next element");
  assert.equal(E.tidy("— avoid with", { prev: true }), ", avoid with", "text continues from the previous element");
  for (const [, b] of T) assert.equal(E.tidy(b), b, "idempotent: " + b);
});

test("same(): code that reads screen text back still matches what it rendered", () => {
  assert.ok(E.same("  Wells score, PE ", "Wells score — PE"));
  assert.ok(E.same(" Notifications", "🔔 Notifications"));
  assert.ok(!E.same("Wells score, DVT", "Wells score — PE"));
  for (const [f, needle] of [["search.js", "SMD_EMOJI_ICONS.same(els[i].textContent, t.title)"], ["home.js", "SMD_EMOJI_ICONS.norm(x.textContent)"],
    ["medlist.js", "SMD_EMOJI_ICONS.same(x.textContent, draft.route)"], ["medlist.js", "SMD_EMOJI_ICONS.same(x.textContent, draft.freq)"],
    ["opd-emr.js", "SMD_EMOJI_ICONS.same(el.textContent, txt)"]])
    assert.ok(readFileSync(new URL("../" + f, import.meta.url), "utf8").includes(needle), f + ": " + needle);
});

test("flag smd_nodash=0 leaves dashes as authored", () => {
  assert.equal(E.dashOn(), true);
  store.set("smd_nodash", "0"); assert.equal(E.dashOn(), false); assert.equal(E.display("A — B"), "A — B"); store.clear();
  assert.equal(E.display("🔔 A — B"), "A, B");
});

test("textbooks as sources become generic references; page numbers go; clinical eponyms stay", () => {
  const G = E.GENERIC_REF;
  
  assert.equal(E.scrubBooks(G), G, "the generic line is never re-scrubbed");
  assert.equal(E.scrubBooks("Clostridial myositis (Harrison 22e p.1096)."), "Clostridial myositis.");
  assert.equal(E.scrubBooks("infection (p.123, p.456). Next"), "infection. Next");
  assert.equal(E.scrubBooks("Harrison 22e p.302"), G);
  assert.equal(E.scrubBooks("Harrison's Principles of Internal Medicine, 22e (2025)"), G);
  const T = [
    ["Harrison's Principles of Internal Medicine, 22e, p. 1234", G],
    ["Source: Harrison 22e; IDSA Practice Guidelines", "Source: " + G + "; IDSA Practice Guidelines"],
    ["instead Harrison enumerates risk factors", "instead the reference enumerates risk factors"],
    ["Harrison notes that sepsis", "The reference notes that sepsis"],
    ["Nelson Textbook of Pediatrics", G],
    ["Mandell, Douglas, and Bennett's Principles and Practice of Infectious Diseases", G],
    ["Adams and Victor's Principles of Neurology, 11th ed, Chapter 16", G],
    ["See Harrison (pp. 152-153) for details.", "See the reference for details."],
    ["Harrison; Nelson Textbook of Pediatrics; IDSA", G + "; IDSA"],
    ["Regimens · Sanford-aligned", "Regimens · Guideline-aligned"],
  ];
  for (const [a, b] of T) assert.equal(E.scrubBooks(a), b, a);
  for (const keep of ["Harrison's groove in rickets", "Fitzpatrick skin type IV", "Braunwald classification of unstable angina", "Kaplan-Meier survival",
    "Brenner tumour of ovary", "Nelson syndrome after adrenalectomy", "Rockwood classification type III", "Page 2 of 5", "p53 mutation and p = 0.05"])
    assert.equal(E.scrubBooks(keep), keep, keep);
  store.set("smd_nobooks", "0"); assert.equal(E.display("Harrison 22e, p. 12"), "Harrison 22e, p. 12"); store.clear();
});
