// test/connect/agent/agent-db.mjs - D1-shaped in-memory mock for Connect Agent broker tests.
// Modeled after test/connect/onboard/onboard-db.mjs, extended with meta.changes tracking
// so compare-and-swap operations can detect 0-row updates faithfully.

export function makeAgentDb(seed = {}) {
  const tables = {};
  for (const k of Object.keys(seed)) tables[k] = seed[k].map((r) => ({ ...r }));
  const tableOf = (sql) => (sql.match(/(?:INTO|FROM|UPDATE)\s+(\w+)/i) || [])[1];
  const whereCols = (sql) => {
    const w = (sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|$)/is) || [])[1];
    return w ? w.split(/\s+AND\s+/i).map((c) => (c.match(/(\w+)\s*=\s*\?/) || [])[1]).filter(Boolean) : [];
  };
  const matches = (row, cols, vals) => cols.every((c, i) => String(row[c]) === String(vals[i]));

  return {
    _tables: tables,
    prepare(sql) {
      let binds = [];
      const t = tableOf(sql);
      const stmt = {
        bind: (...a) => { binds = a; return stmt; },
        all: async () => {
          const rows = tables[t] || [];
          const cols = whereCols(sql);
          return { results: cols.length ? rows.filter((r) => matches(r, cols, binds)) : rows.slice() };
        },
        first: async () => (await stmt.all()).results[0] || null,
        run: async () => {
          tables[t] = tables[t] || [];
          let changes = 0;
          if (/^\s*INSERT/i.test(sql)) {
            const cols = (sql.match(/\(([^)]+)\)/) || [])[1].split(",").map((c) => c.trim());
            const row = {};
            cols.forEach((c, i) => { row[c] = binds[i]; });
            tables[t].push(row);
            changes = 1;
          } else if (/^\s*UPDATE/i.test(sql)) {
            const setCols = (sql.match(/SET\s+(.+?)\s+WHERE/is)[1]).split(",").map((c) => (c.match(/(\w+)\s*=\s*\?/) || [])[1]);
            const wc = whereCols(sql);
            const setVals = binds.slice(0, setCols.length);
            const whereVals = binds.slice(setCols.length);
            for (const r of tables[t]) {
              if (matches(r, wc, whereVals)) {
                setCols.forEach((c, i) => { r[c] = setVals[i]; });
                changes++;
              }
            }
          } else if (/^\s*DELETE/i.test(sql)) {
            const wc = whereCols(sql);
            const before = tables[t].length;
            tables[t] = tables[t].filter((r) => !matches(r, wc, binds));
            changes = before - tables[t].length;
          }
          return { success: true, meta: { changes }, changes };
        },
      };
      return stmt;
    },
  };
}
