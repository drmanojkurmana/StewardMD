/* test/helpers/kits-share-world.mjs - an in-memory world for functions/_kits_share.js: Firestore with the
 * real commit guards (create-only, updateTime compare-and-set), a StewardMD ID directory, Firebase claims,
 * hospital memberships and a push recorder. Used by test/kits-share.test.mjs and the browser test
 * test/run-kits-share-ui.mjs (which serves the real handlers over it). */
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
export const KEY = Buffer.from(new Uint8Array(32).map((_, i) => (i * 37 + 11) & 255)).toString("base64url");
export const ENV = { FOLLOWCARE_PHI_KEY: KEY };
export const DIR = { "SMD-AAA111": "uA", "SMD-BBB222": "uB", "SMD-CCC333": "uC", "SMD-UNV000": "uU" };
export const CLAIMS = { uA: { verified: true, name: "Dr Asha" }, uB: { verified: true, name: "Dr Bala" }, uC: { verified: true, name: "Dr Chitra" }, uU: { verified: false, name: "Unverified" } };

export function world() {
  const docs = new Map(), pushes = [], limits = { block: false }; let clock = 0;
  const commit = async (writes) => {
    for (const w of writes) {
      if (w.delete) continue;
      const cur = docs.get(w.path), cd = w.cd;
      if (cd && cd.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" });
      if (cd && cd.updateTime && (!cur || cur.updateTime !== cd.updateTime)) throw Object.assign(new Error("stale"), { code: "precondition" });
    }
    for (const w of writes) {
      if (w.delete) { docs.delete(w.delete); continue; }
      const prev = docs.get(w.path);
      docs.set(w.path, { fields: JSON.parse(JSON.stringify({ ...(prev && w.merge ? prev.fields : {}), ...w.fields })), updateTime: "t" + (++clock) });
    }
    return { ok: true };
  };
  const deps = {
    fsGet: async (p) => { const d = docs.get(p); return d ? { id: p.split("/").pop(), fields: JSON.parse(JSON.stringify(d.fields)), updateTime: d.updateTime } : null; },
    fsBatchGet: async (ps) => new Map(await Promise.all(ps.map(async (p) => [p, await deps.fsGet(p)]))),
    fsQuery: async (coll, o) => {
      const out = [], ws = o && o.where ? [].concat(o.where) : [];
      for (const [p, d] of docs) {
        if (!p.startsWith(coll + "/")) continue;
        if (ws.some((w) => d.fields[w.field] !== w.value)) continue;
        out.push({ id: p.slice(coll.length + 1), fields: JSON.parse(JSON.stringify(d.fields)), updateTime: d.updateTime });
      }
      return out.slice(0, (o && o.limit) || 100);
    },
    fsCommit: commit,
    wCreate: (path, fields) => ({ path, fields, cd: { exists: false } }),
    wUpdate: (path, fields, o) => ({ path, fields, merge: true, cd: o && o.updateTime ? { updateTime: o.updateTime } : null }),
    wDelete: (path) => ({ delete: path }),
    resolveUid: async (ident) => (ident.smdId ? DIR[String(ident.smdId).toUpperCase()] || null : null),
    getClaims: async (uid) => CLAIMS[uid] || {},
    listOrgsForMember: async (ids) => (ids.includes("uB") ? [{ id: "org1", name: "City Hospital", memberRole: "doctor" }] : ids.includes("uC") ? [{ id: "org1", name: "City Hospital", memberRole: "pg_hod" }] : []),
    listOrgsForOwner: async (uid) => (uid === "uA" ? [{ id: "org1", name: "City Hospital" }] : []),
    push: async (uid, msg) => { pushes.push({ uid, msg }); },
    hitLimit: async () => ({ ok: !limits.block })
  };
  const ctx = (uid, now) => ({ env: ENV, uid, claims: Object.assign({ sub: uid }, CLAIMS[uid] || {}), deps, now: now || 1_000_000, waitUntil: null });
  return { docs, pushes, limits, deps, ctx };
}
