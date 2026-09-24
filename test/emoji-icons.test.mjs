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
