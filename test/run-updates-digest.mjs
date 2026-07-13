/* StewardMD — weekly digest test (pure Node). Mocks Gemini + verifies buildDigest
 * synthesis and the ISO week key. USAGE: node test/run-updates-digest.mjs
 */
import { buildDigest } from "../functions/_digest.js";
import { isoWeekKey } from "../functions/_updates_repo.js";

let fails = 0;
const chk = (n, ok, d) => { console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); if (!ok) fails++; };

let AI_CALLS = 0;
globalThis.fetch = async (u) => {
  if (String(u).indexOf("generativelanguage") >= 0) {
    AI_CALLS++;
    const obj = { headline: "This Week in Medicine — 3 updates", intro: "A busy week across cardiology and nephrology.", highlights: ["New hypertension guideline", "SGLT2i expanded in CKD"], sections: [{ label: "Guidelines", items: ["ACC/AHA hypertension update", "KDIGO CKD 2024"] }, { label: "Drug approvals", items: ["FDA approves X"] }] };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

(async () => {
  const env = { GEMINI_API_KEY: "test", AI_PROVIDER: "developer" };
  const items = [
    { type: "guideline", organization: "ACC/AHA", title: "2026 Hypertension Guideline", summary: "New BP targets." },
    { type: "guideline", organization: "KDIGO", title: "CKD 2024", summary: "SGLT2i for CKD." },
    { type: "drug_approval", organization: "FDA", title: "Approves X", summary: "New agent." },
  ];

  console.log("\n── buildDigest ──");
  AI_CALLS = 0;
  const r = await buildDigest(env, items);
  chk("ok with data", r.ok && !!r.data, r.error || "");
  chk("one AI call for the whole week", AI_CALLS === 1, "AI_CALLS=" + AI_CALLS);
  chk("has headline + intro", r.data && !!r.data.headline && !!r.data.intro);
  chk("has highlights", r.data && r.data.highlights.length === 2, JSON.stringify(r.data && r.data.highlights));
  chk("has grouped sections", r.data && r.data.sections.length === 2 && r.data.sections[0].items.length === 2);

  console.log("\n── empty week ──");
  AI_CALLS = 0;
  const e = await buildDigest(env, []);
  chk("no items → ok:false, no AI", e.ok === false && AI_CALLS === 0, JSON.stringify(e));

  console.log("\n── isoWeekKey ──");
  chk("Mon 2026-07-13 → 2026-W29", isoWeekKey(Date.parse("2026-07-13T00:00:00Z")) === "2026-W29");
  chk("format YYYY-Www", /^\d{4}-W\d{2}$/.test(isoWeekKey(Date.parse("2026-01-01T00:00:00Z"))));

  console.log(`\n${fails ? "❌ " + fails + " failed" : "✅ all passed"}\n`);
  process.exit(fails ? 1 : 0);
})();
