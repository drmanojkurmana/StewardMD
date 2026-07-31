// functions/_connect/abdm/abdm-testkit.js — test-only mock D1 (with UPDATE/meta.changes) + mock R2.
export function makeAbdmDb(seed = {}) {
  const tables = JSON.parse(JSON.stringify(seed));
  const table = (sql) => (sql.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i) || [])[1];
  const cols = (sql) => (sql.match(/\(([^)]+)\)\s*VALUES/i)?.[1] || "").split(",").map((s) => s.trim());
  function where(sql, binds, rows, bindOffset) {
    // supports: WHERE a=? [AND b<>?]  — enough for our lookups + the CAS guard.
    // Scan only the WHERE clause so an UPDATE's `SET col=?` isn't parsed as a guard condition.
    const clause = (sql.match(/\bWHERE\b([\s\S]*)$/i) || [, ""])[1];
    // Fail LOUD on any predicate we don't implement. Silently dropping one (e.g. `expires_at < ?`)
    // would collapse the WHERE to a no-op and match the whole table — a DELETE-everything landmine.
    // Validate per-predicate shape (so the supported `<>` isn't false-flagged by a bare `<` scan).
    for (const pred of clause.split(/\bAND\b/i).map((s) => s.trim()).filter(Boolean)) {
      if (!/^\s*\w+\s*(=|<>)\s*\?\s*$/.test(pred)) {
        throw new Error("abdm mock D1: unsupported WHERE (only 'col=? [AND col<>?]' supported) — filter in JS or extend the mock");
      }
    }
    const m = [...clause.matchAll(/(\w+)\s*(=|<>)\s*\?/g)];
    return rows.filter((r) => m.every((mm, i) => {
      const v = binds[bindOffset + i]; return mm[2] === "=" ? String(r[mm[1]]) === String(v) : String(r[mm[1]]) !== String(v);
    }));
  }
  return {
    _tables: tables,
    prepare(sql) {
      let binds = [];
      const stmt = { bind: (...a) => { binds = a; return stmt; } };
      stmt.first = async () => { const t = table(sql); return where(sql, binds, tables[t] || [], 0)[0] || null; };
      stmt.all = async () => { const t = table(sql); return { results: where(sql, binds, tables[t] || [], 0) }; };
      stmt.run = async () => {
        const t = table(sql); tables[t] = tables[t] || [];
        if (/^\s*INSERT/i.test(sql)) { const c = cols(sql); const row = {}; c.forEach((k, i) => (row[k] = binds[i])); tables[t].push(row); return { success: true, meta: { changes: 1 } }; }
        if (/^\s*UPDATE/i.test(sql)) {
          const set = sql.match(/SET\s+(.+?)\s+WHERE/is)[1].split(",").map((s) => s.trim().replace(/=\?$/, "").trim());
          const nSet = set.length;
          const matched = where(sql, binds, tables[t], nSet);   // WHERE binds come AFTER the SET binds
          let changes = 0;
          for (const r of matched) { set.forEach((col, i) => (r[col] = binds[i])); changes++; }
          return { success: true, meta: { changes } };
        }
        if (/^\s*DELETE/i.test(sql)) { const before = tables[t].length; tables[t] = tables[t].filter((r) => !where(sql, binds, [r], 0).length); return { success: true, meta: { changes: before - tables[t].length } }; }
        return { success: true, meta: { changes: 0 } };
      };
      return stmt;
    },
  };
}

export function makeR2() {
  const m = new Map();
  return {
    put: async (k, v, opts = {}) => { m.set(k, { body: String(v), customMetadata: opts.customMetadata || {}, uploaded: (opts.customMetadata && opts.customMetadata.ts) || null }); },
    get: async (k) => { const o = m.get(k); return o ? { text: async () => o.body, customMetadata: o.customMetadata } : null; },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix = "" } = {}) => ({ objects: [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, o]) => ({ key: k, customMetadata: o.customMetadata })) }),
  };
}
