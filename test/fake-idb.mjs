/* A small in-memory IndexedDB for node tests of prep-decks.js: open with upgrade, object stores with a keyPath, an
 * index by one field, get, put, delete, getAll, index getAll and getAllKeys, transactions that complete on a later
 * tick, onclose. Failure knobs: failOpens (the next N opens fire onerror), and close() drops every open connection
 * (as WebKit does when its storage process goes away). Not a general IndexedDB. */
export function fakeIndexedDB() {
  const dbs = new Map();   // name -> { version, stores: Map(name -> { keyPath, index: field|null, rows: Map }) }
  const conns = new Set();
  const later = (fn) => setTimeout(fn, 0);
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const api = {
    failOpens: 0, opens: 0,
    dropConnections() { for (const c of conns) { c._closed = true; if (c.onclose) c.onclose(); } conns.clear(); },
    wipe() { dbs.clear(); },
    open(name, version) {
      const rq = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      api.opens++;
      later(() => {
        if (api.failOpens > 0) { api.failOpens--; rq.error = new Error("UnknownError"); if (rq.onerror) rq.onerror(); return; }
        let d = dbs.get(name);
        const upgrade = !d || d.version < version;
        if (!d) { d = { version: 0, stores: new Map() }; dbs.set(name, d); }
        const conn = {
          _closed: false, onclose: null, onversionchange: null,
          objectStoreNames: { contains: (n) => d.stores.has(n) },
          createObjectStore(n, opts) { const s = { keyPath: opts.keyPath, index: null, rows: new Map() }; d.stores.set(n, s); return { createIndex: (iname, field) => { s.index = field; } }; },
          close() { conn._closed = true; conns.delete(conn); },
          transaction(names, mode) {
            if (conn._closed) { const e = new Error("The database connection is closing."); e.name = "InvalidStateError"; throw e; }
            const t = { oncomplete: null, onerror: null, onabort: null, error: null };
            const reqs = [];
            const mk = (fn) => { const r = { result: undefined, onsuccess: null }; reqs.push(() => { r.result = fn(); if (r.onsuccess) r.onsuccess(); }); return r; };
            t.objectStore = (n) => {
              const s = d.stores.get(n);
              if (!s) throw new Error("no store " + n);
              return {
                get: (k) => mk(() => clone(s.rows.get(k))),
                put: (v) => { if (mode !== "readwrite") throw new Error("readonly"); return mk(() => { s.rows.set(v[s.keyPath], clone(v)); return v[s.keyPath]; }); },
                delete: (k) => mk(() => { s.rows.delete(k); }),
                getAll: () => mk(() => [...s.rows.values()].map(clone)),
                index: () => ({
                  getAll: (v) => mk(() => [...s.rows.values()].filter((r) => r[s.index] === v).map(clone)),
                  getAllKeys: (v) => mk(() => [...s.rows.values()].filter((r) => r[s.index] === v).map((r) => r[s.keyPath])),
                }),
              };
            };
            later(() => { try { while (reqs.length) reqs.shift()(); while (reqs.length) reqs.shift()(); if (t.oncomplete) t.oncomplete(); } catch (e) { t.error = e; if (t.onerror) t.onerror(); } });
            return t;
          },
        };
        rq.result = conn;
        if (upgrade && rq.onupgradeneeded) { d.version = version; rq.onupgradeneeded(); }
        conns.add(conn);
        if (rq.onsuccess) rq.onsuccess();
      });
      return rq;
    },
  };
  return api;
}
