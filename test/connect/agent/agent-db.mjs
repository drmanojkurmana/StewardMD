// test/connect/agent/agent-db.mjs - D1-shaped in-memory mock for Connect Agent broker tests.
// Modeled after test/connect/onboard/onboard-db.mjs, extended with meta.changes tracking
// so compare-and-swap operations can detect 0-row updates faithfully.

export function makeAgentDb(seed = {}) {
  const tables = {};
  for (const k of Object.keys(seed)) tables[k] = seed[k].map((r) => ({ ...r }));
  const tableOf = (sql) => (sql.match(/(?:INTO|FROM|UPDATE)\s+(\w+)/i) || [])[1];
  // Each WHERE clause is `col = ?` (consumes one bind, in left-to-right order) or `col IS [NOT] NULL`
  // (consumes none) - activation.js's CAS guards use both shapes (e.g. "active_version_id IS NULL" for
  // the first-ever activation, "revoked_at IS NULL" to find the live activation row).
  const whereClauses = (sql) => {
    const w = (sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|$)/is) || [])[1];
    if (!w) return [];
    return w.split(/\s+AND\s+/i).map((c) => {
      c = c.trim();
      let m;
      if ((m = c.match(/^(\w+)\s+IS\s+NOT\s+NULL$/i))) return { col: m[1], op: "isnotnull" };
      if ((m = c.match(/^(\w+)\s+IS\s+NULL$/i))) return { col: m[1], op: "isnull" };
      if ((m = c.match(/^(\w+)\s*=\s*\?$/))) return { col: m[1], op: "eq" };
      return null;
    }).filter(Boolean);
  };
  const matches = (row, clauses, vals) => {
    let vi = 0;
    return clauses.every((cl) => {
      if (cl.op === "isnull") return row[cl.col] === null || row[cl.col] === undefined;
      if (cl.op === "isnotnull") return row[cl.col] !== null && row[cl.col] !== undefined;
      return String(row[cl.col]) === String(vals[vi++]);
    });
  };

  return {
    _tables: tables,
    prepare(sql) {
      let binds = [];
      const t = tableOf(sql);
      const stmt = {
        bind: (...a) => { binds = a; return stmt; },
        all: async () => {
          const rows = tables[t] || [];
          const cols = whereClauses(sql);
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
            const wc = whereClauses(sql);
            const setVals = binds.slice(0, setCols.length);
            const whereVals = binds.slice(setCols.length);
            for (const r of tables[t]) {
              if (matches(r, wc, whereVals)) {
                setCols.forEach((c, i) => { r[c] = setVals[i]; });
                changes++;
              }
            }
          } else if (/^\s*DELETE/i.test(sql)) {
            const wc = whereClauses(sql);
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
