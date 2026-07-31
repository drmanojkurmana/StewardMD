// functions/_connect/testkit.js — in-repo helpers for tests + local integration (NOT shipped in the client)
export function flagOn(env) { return String(env && env.CONNECT_FLAG) === "1"; }

export function jsonResponse(obj, opts = {}) {
  const headers = Object.assign(
    { "content-type": "application/json", "cache-control": "no-store", "pragma": "no-cache" },
    opts.headers || {});
  return new Response(JSON.stringify(obj), { status: opts.status || 200, headers });
}

export function makeMockKv() {
  const m = new Map();
  return {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => { m.set(k, String(v)); },
    delete: async (k) => { m.delete(k); },
  };
}

// Minimal D1-shaped mock: table lookups keyed by the first `?` bind on a WHERE.
export function makeMockDb(seed = {}) {
  const tables = JSON.parse(JSON.stringify(seed));
  return {
    _tables: tables,
    prepare(sql) {
      let binds = [];
      const stmt = {
        bind: (...args) => { binds = args; return stmt; },
        first: async () => run(sql, binds, tables)[0] || null,
        all: async () => ({ results: run(sql, binds, tables) }),
        run: async () => { mutate(sql, binds, tables); return { success: true }; },
      };
      return stmt;
    },
  };
}
function tableOf(sql) { return (sql.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i) || [])[1]; }
function run(sql, binds, tables) {
  const t = tableOf(sql); const rows = tables[t] || [];
  if (!/WHERE/i.test(sql)) return rows.slice();
  const col = (sql.match(/WHERE\s+(\w+)\s*=\s*\?/i) || [])[1];
  return rows.filter((r) => String(r[col]) === String(binds[0]));
}
function mutate(sql, binds, tables) {
  if (/^\s*INSERT/i.test(sql)) {
    const t = tableOf(sql); tables[t] = tables[t] || [];
    tables[t].push({ _raw: binds });          // append-only; enough for audit tests
  }
  // UPDATE/DELETE intentionally unsupported for connect_audit_event (append-only invariant).
}
