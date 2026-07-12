/* StewardMD — litapi (Europe PMC) pipeline test (pure Node). Mocks the Europe PMC
 * search, Gemini, and D1 to prove auto-discovery + dedup + the no-AI-on-unchanged rule.
 * USAGE: node test/run-updates-litapi.mjs
 */
import { runPipeline } from "../functions/_updates_pipeline.js";

let fails = 0;
const chk = (n, ok, d) => { console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); if (!ok) fails++; };

// mutable Europe PMC result set
let EPMC = [
  { id: "1", source: "MED", pmid: "111", doi: "10.1/a", title: "KDIGO 2024 CKD Guideline", abstractText: "A".repeat(600), firstPublicationDate: "2024-03-01", journalTitle: "Kidney Int" },
  { id: "2", source: "MED", pmid: "222", doi: "10.1/b", title: "KDIGO Diabetes in CKD", abstractText: "B".repeat(600), firstPublicationDate: "2024-05-01", journalTitle: "Kidney Int" },
  { id: "3", source: "MED", pmid: "333", doi: "10.1/c", title: "Short statement", abstractText: "too short", firstPublicationDate: "2024-06-01" }, // filtered (no abstract)
];
let AI_CALLS = 0;
function gemini() {
  const obj = { title: "Guideline summary", organization: "KDIGO", specialty: "nephrology", importance: "high", estimated_read_time: 5, summary: "Original summary.", major_changes: [], what_changed: [], clinical_impact: "impact", clinical_pearls: ["pearl1", "pearl2"], new_recommendations: ["new1"], removed_recommendations: [], practice_points: ["pp1"], evidence_level: "A", keywords: ["k"], official_url: "", official_pdf_url: "", doi: "", pmid: "" };
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) };
}
globalThis.fetch = async (u) => {
  const url = String(u);
  if (url.indexOf("europepmc") >= 0) return { ok: true, status: 200, json: async () => ({ resultList: { result: EPMC } }) };
  if (url.indexOf("generativelanguage") >= 0) { AI_CALLS++; return gemini(); }
  return { ok: false, status: 404, text: async () => "" };
};

function mockDb() {
  const byKey = new Map(), byId = new Map();
  const sources = [{ id: "kdigo", name: "KDIGO", workspace: "internal_medicine", branch: "nephrology", type: "guideline", parser_type: "litapi", query: "KDIGO guideline", rss_url: "", enabled: 1, priority: 10 }];
  const COLS = ["id", "doc_key", "source_id", "type", "organization", "workspace", "branch", "title", "body", "category", "published_ts", "importance", "est_read_min", "summary", "summary_json", "official_url", "official_pdf_url", "doi", "pmid", "keywords", "version", "content_hash", "auto", "pinned", "created_ts", "updated_ts"];
  const insert = (b) => { const r = {}; COLS.forEach((c, i) => r[c] = b[i]); byKey.set(r.doc_key, r); byId.set(r.id, r); };
  return {
    _byKey: byKey,
    prepare(sql) {
      const stmt = (b) => ({
        bind: (...nb) => stmt(nb),
        all: async () => (/FROM sources/.test(sql) ? { results: sources } : { results: [] }),
        first: async () => (/FROM updates WHERE doc_key/.test(sql) ? (byKey.get(b[0]) || null) : null),
        run: async () => { if (/INSERT INTO updates/.test(sql)) insert(b); return {}; },
      });
      return stmt([]);
    },
  };
}

(async () => {
  const db = mockDb();
  const env = { UPDATES_DB: db, GEMINI_API_KEY: "test", AI_PROVIDER: "developer" };

  console.log("\n── run 1: auto-discover guideline documents ──");
  AI_CALLS = 0;
  const r1 = await runPipeline(env);
  chk("2 guideline docs stored (short-abstract one filtered out)", r1.new === 2, JSON.stringify({ new: r1.new, unchanged: r1.unchanged }));
  chk("AI called once per real doc", AI_CALLS === 2, "AI_CALLS=" + AI_CALLS);
  chk("doc_key is DOI-based", [...db._byKey.keys()].every((k) => k.startsWith("doi:")), [...db._byKey.keys()].join(","));
  const row = db._byKey.get("doi:10.1/a");
  chk("card carries pmid + rich summary_json", row && row.pmid === "111" && /clinical_pearls/.test(row.summary_json));
  chk("card type=guideline, branch=nephrology", row && row.type === "guideline" && row.branch === "nephrology");

  console.log("\n── run 2: same results (nothing changed) ──");
  AI_CALLS = 0;
  const r2 = await runPipeline(env);
  chk("all unchanged", r2.unchanged === 2 && r2.new === 0, JSON.stringify({ new: r2.new, unchanged: r2.unchanged }));
  chk("ZERO AI calls on unchanged run", AI_CALLS === 0, "AI_CALLS=" + AI_CALLS);

  console.log(`\n${fails ? "❌ " + fails + " failed" : "✅ all passed"}\n`);
  process.exit(fails ? 1 : 0);
})();
