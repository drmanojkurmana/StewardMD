/* StewardMD — Medical Updates unit tests (pure Node, mock D1). No network, no AI.
 * Proves: RSS parsing, relevance filter, SHA-256 dedup determinism, and the D1 feed
 * query builder (filters + cursor pagination + nextCursor).
 * USAGE: node test/run-medical-updates.mjs
 */
import { parseRss, keepItem, sha256hex, itemHashInput } from "../functions/_updates_util.js";
import * as repo from "../functions/_updates_repo.js";

let fails = 0;
const chk = (n, ok, d) => { console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); if (!ok) fails++; };

// Records the last prepared SQL + binds, returns the supplied rows from .all().
function mockDb(rows) {
  const state = { sql: null, binds: null };
  return {
    _state: state,
    prepare(sql) {
      state.sql = sql;
      return { bind(...b) { state.binds = b; return { all: async () => ({ results: rows }), first: async () => rows[0] || null, run: async () => ({}) }; } };
    },
  };
}
const mkRow = (i, over) => Object.assign({ id: "u" + i, doc_key: "k" + i, type: "guideline", organization: "ESC", workspace: "internal_medicine", branch: "cardiology", title: "Item " + i, body: "", summary: "s", category: "guideline", published_ts: 2000 - i, importance: "normal", est_read_min: 3, official_url: "https://x/" + i, version: "", doi: "", pmid: "", pinned: 0, auto: 1 }, over || {});

(async () => {
  console.log("\n── RSS parsing ──");
  {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title>FDA Approves New Cardiac Drug</title><link>https://fda/1</link><description>Great news &amp; more</description><pubDate>Wed, 01 Jul 2026 10:00:00 GMT</pubDate></item>
      <item><title><![CDATA[Safety Alert: Recall of X]]></title><guid>https://fda/2</guid><description>details</description></item>
    </channel></rss>`;
    const items = parseRss(xml);
    chk("parses 2 items", items.length === 2, JSON.stringify(items.map(i => i.title)));
    chk("decodes entities + strips CDATA", items[0].description === undefined && items[0].desc === "Great news & more" && items[1].title === "Safety Alert: Recall of X");
    chk("falls back guid→url", items[1].url === "https://fda/2");
    chk("parses pubDate", items[0].ts === Date.parse("Wed, 01 Jul 2026 10:00:00 GMT"));
  }
  {
    const atom = `<feed><entry><title>WHO Update</title><link href="https://who/9"/><summary>x</summary><updated>2026-07-02T00:00:00Z</updated></entry></feed>`;
    const items = parseRss(atom);
    chk("Atom fallback: 1 entry, link href", items.length === 1 && items[0].url === "https://who/9");
  }

  console.log("\n── relevance filter ──");
  chk("approval feed keeps 'approves'", keepItem("drug_approval", "FDA approves drug", "") === true);
  chk("approval feed drops non-approval", keepItem("drug_approval", "FDA warns about risk", "") === false);
  chk("approval feed drops pet-food noise", keepItem("drug_approval", "FDA approves pet food for dogs", "") === false);
  chk("safety feed keeps everything medical", keepItem("safety_alert", "Boxed warning added", "") === true);
  chk("guideline feed passes through", keepItem("guideline", "New hypertension guideline", "") === true);

  console.log("\n── SHA-256 dedup determinism ──");
  {
    const a = { title: "T", url: "U", ts: 100, desc: "D" };
    const h1 = await sha256hex(itemHashInput(a));
    const h2 = await sha256hex(itemHashInput({ ...a }));
    const h3 = await sha256hex(itemHashInput({ ...a, desc: "changed" }));
    chk("identical item → identical hash (unchanged → no AI)", h1 === h2 && h1.length === 64);
    chk("changed description → different hash (triggers re-summarize)", h1 !== h3);
  }

  console.log("\n── D1 feed query builder ──");
  {
    // 21 rows for limit 20 → one extra signals a next page
    const rows = Array.from({ length: 21 }, (_, i) => mkRow(i));
    const env = { UPDATES_DB: mockDb(rows) };
    const res = await repo.getFeed(env, { limit: 20 });
    chk("returns limit items (not the +1 probe)", res.items.length === 20, "got " + res.items.length);
    chk("computes nextCursor from last item", res.items.length === 20 && res.nextCursor === (rows[19].published_ts + "_" + rows[19].id), res.nextCursor);
    chk("rowToItem maps legacy + new fields (incl. branch)", res.items[0].ts === rows[0].published_ts && res.items[0].category === "guideline" && res.items[0].source === "ESC" && res.items[0].url === "https://x/0" && res.items[0].branch === "cardiology");
  }
  {
    const env = { UPDATES_DB: mockDb([]) };
    await repo.getFeed(env, { type: "drug_approval", workspace: "internal_medicine", branch: "cardiology", q: "sglt2", before: "1500_u5", limit: 10 });
    const s = env.UPDATES_DB._state;
    chk("SQL has type filter", /type = \?/.test(s.sql));
    chk("SQL has workspace filter", /workspace = \?/.test(s.sql));
    chk("SQL has branch filter", /branch = \?/.test(s.sql));
    chk("SQL has search filter", /lower\(title\) LIKE/.test(s.sql));
    chk("SQL has cursor clause", /published_ts < \? OR \(published_ts = \? AND id < \?\)/.test(s.sql));
    chk("binds end with limit+1 probe", s.binds[s.binds.length - 1] === 11, "last bind " + s.binds[s.binds.length - 1]);
    chk("cursor bind split into ts + id", s.binds.includes(1500) && s.binds.includes("u5"));
  }
  {
    // No D1 bound → legacy KV fallback keeps the feed alive
    const kv = { async get() { return [{ id: "old", title: "Legacy", ts: 5, category: "approval" }]; } };
    const res = await repo.getFeed({ UPDATES_KV: kv }, {});
    chk("legacy KV fallback when no D1", res.items.length === 1 && res.items[0].title === "Legacy" && res.nextCursor === null);
  }

  console.log(`\n${fails ? "❌ " + fails + " failed" : "✅ all passed"}\n`);
  process.exit(fails ? 1 : 0);
})();
