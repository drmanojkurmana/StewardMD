/* StewardMD — Medical Updates pipeline integration test (pure Node).
 * Mocks D1 + the RSS feed + Gemini so we can COUNT AI calls and prove the core
 * cost guarantee: AI runs ONLY for genuinely new/changed documents.
 * USAGE: node test/run-updates-pipeline.mjs
 */
import { runPipeline } from "../functions/_updates_pipeline.js";

let fails = 0;
const chk = (n, ok, d) => { console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); if (!ok) fails++; };

// ---- mutable RSS feed the mock server returns ----
let FEED_ITEMS = [
  { title: "FDA approves new cardiac drug", link: "https://fda/1", desc: "Original description one.", date: "Wed, 01 Jul 2026 10:00:00 GMT" },
  { title: "FDA approves second agent", link: "https://fda/2", desc: "Original description two.", date: "Thu, 02 Jul 2026 10:00:00 GMT" },
];
function feedXml() {
  return `<rss><channel>` + FEED_ITEMS.map((i) =>
    `<item><title>${i.title}</title><link>${i.link}</link><description>${i.desc}</description><pubDate>${i.date}</pubDate></item>`).join("") + `</channel></rss>`;
}

// ---- AI call counter + mock Gemini ----
let AI_CALLS = 0;
let DIFF_CALLS = 0;
function gpart(obj) { return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) }; }
function geminiResponse() {
  return gpart({ title: "Summary", organization: "FDA", specialty: "cardiology", release_date: "2026-07-01", version: "1", importance: "high", estimated_read_time: 3, summary: "An original plain-language summary.", major_changes: ["x"], what_changed: [], clinical_impact: "High.", clinical_pearls: ["p"], new_recommendations: [], removed_recommendations: [], practice_points: [], evidence_level: "A", keywords: ["cardio"], official_url: "", official_pdf_url: "", doi: "", pmid: "" });
}
function geminiDiffResponse() {
  return gpart({ changes: [{ topic: "Blood pressure target", previous: "<130/80", current: "<120 systolic (selected CKD)", impact: "High" }] });
}
globalThis.fetch = async (u, opts) => {
  const url = String(u);
  if (url.indexOf("generativelanguage") >= 0) {
    AI_CALLS++;
    const body = (opts && opts.body) || "";
    if (body.indexOf("MATERIALLY CHANGED") >= 0) { DIFF_CALLS++; return geminiDiffResponse(); }   // Phase 3 diff prompt
    return geminiResponse();
  }
  // RSS feed
  return { ok: true, status: 200, text: async () => feedXml(), headers: { get: () => "" } };
};

// ---- mock D1 (pattern-matched on the exact SQL the pipeline path issues) ----
function mockDb() {
  const byKey = new Map(), byId = new Map(), versions = [];
  const sources = [{ id: "fda-press", name: "FDA Press", workspace: "internal_medicine", type: "drug_approval", parser_type: "rss", rss_url: "https://feed", guideline_page: "", homepage: "", enabled: 1, priority: 10, etag: "", last_modified: "", content_length: "" }];
  // INSERT column order from repo.insertUpdate:
  const COLS = ["id", "doc_key", "source_id", "type", "organization", "workspace", "branch", "title", "body", "category", "published_ts", "importance", "est_read_min", "summary", "summary_json", "official_url", "official_pdf_url", "doi", "pmid", "keywords", "version", "content_hash", "auto", "pinned", "created_ts", "updated_ts"];
  function insert(binds) { const row = {}; COLS.forEach((c, i) => row[c] = binds[i]); byKey.set(row.doc_key, row); byId.set(row.id, row); }
  function update(binds) { // updateExisting order: type,org,ws,branch,title,body,cat,pub,imp,read,summary,sj,url,pdf,doi,pmid,kw,ver,content_hash(18),updated_ts(19),id(20)
    const id = binds[binds.length - 1], row = byId.get(id); if (row) { row.content_hash = binds[18]; row.title = binds[4]; row.summary = binds[10]; }
  }
  return {
    _byKey: byKey,
    _versions: versions,
    prepare(sql) {
      const stmt = (b) => ({
        bind: (...nb) => stmt(nb),
        all: async () => {
          if (/FROM sources/.test(sql) && /enabled = 1/.test(sql)) return { results: sources.filter((s) => s.enabled) };
          return { results: [] };
        },
        first: async () => {
          if (/FROM updates WHERE doc_key/.test(sql)) return byKey.get(b[0]) || null;
          return null;
        },
        run: async () => {
          if (/INSERT INTO updates/.test(sql)) insert(b);
          else if (/UPDATE updates SET/.test(sql)) update(b);
          else if (/INSERT INTO update_versions/.test(sql)) versions.push({ update_id: b[1], version: b[2], summary_json: b[4], whats_changed_json: b[5] });
          return {};
        },
      });
      return stmt([]);
    },
  };
}

(async () => {
  const db = mockDb();
  const env = { UPDATES_DB: db, GEMINI_API_KEY: "test", AI_PROVIDER: "developer" };

  console.log("\n── run 1: fresh feed (all new) ──");
  AI_CALLS = 0;
  const r1 = await runPipeline(env);
  chk("2 new items stored", r1.new === 2, JSON.stringify({ new: r1.new, updated: r1.updated, unchanged: r1.unchanged }));
  chk("AI called exactly twice (once per new doc)", AI_CALLS === 2, "AI_CALLS=" + AI_CALLS);
  chk("rows persisted to D1", db._byKey.size === 2);
  chk("returns push items with workspace (for targeted push)", (r1.items || []).length === 2 && r1.items.every((i) => i.workspace && i.id), JSON.stringify((r1.items || []).map((i) => i.workspace)));

  console.log("\n── run 2: identical feed (nothing changed) ──");
  AI_CALLS = 0;
  const r2 = await runPipeline(env);
  chk("all items unchanged", r2.unchanged === 2 && r2.new === 0 && r2.updated === 0, JSON.stringify({ new: r2.new, updated: r2.updated, unchanged: r2.unchanged }));
  chk("ZERO AI calls on unchanged run (the cost guarantee)", AI_CALLS === 0, "AI_CALLS=" + AI_CALLS);

  console.log("\n── run 3: one item's content changed (Phase 3 What's-Changed) ──");
  FEED_ITEMS[0].desc = "This description was revised — new evidence.";
  AI_CALLS = 0; DIFF_CALLS = 0;
  const r3 = await runPipeline(env);
  chk("exactly one updated, one unchanged", r3.updated === 1 && r3.unchanged === 1, JSON.stringify({ new: r3.new, updated: r3.updated, unchanged: r3.unchanged }));
  chk("AI called twice for the changed doc (summarize + diff)", AI_CALLS === 2 && DIFF_CALLS === 1, "AI_CALLS=" + AI_CALLS + " DIFF_CALLS=" + DIFF_CALLS);
  const v = db._versions.filter((x) => x.whats_changed_json);
  chk("version row records the What's-Changed diff", v.length === 1 && /Blood pressure target/.test(v[0].whats_changed_json), JSON.stringify(v[0] && v[0].whats_changed_json));

  console.log(`\n${fails ? "❌ " + fails + " failed" : "✅ all passed"}\n`);
  process.exit(fails ? 1 : 0);
})();
