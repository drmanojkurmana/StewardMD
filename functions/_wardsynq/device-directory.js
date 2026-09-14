/* functions/_wardsynq/device-directory.js — which phones belong to which hospital identity.
 *
 * S3 P0 (design section 3.4). The DeviceDirectory port: bind, unbind, devicesFor, plus the notice
 * pointer (nid -> which hospital and which loop). Push used to be able to address only a Firebase
 * account and found it by listing EVERY token in KV per send; hospital staff signed in with a PIN could
 * not be reached at all. This is an index per identity instead of a scan.
 *
 * THE STORE IS INJECTED. Anything with get(key) -> string|null, put(key, string), delete(key) works:
 * Cloudflare KV today, another key-value store after the D12 move. Nothing Cloudflare-specific here.
 *
 * WHAT IS STORED. Token ids (a hash of the device token, the key the existing token record already
 * lives under) and identities. The pointer holds ids only. No patient data is ever written here.
 */

const WHO = "push:who:";
const NOTICE = "push:notice:";
const MAX_DEVICES = 20;
const str = (v) => (v == null ? "" : String(v).trim());

async function readJson(store, key) {
  const raw = await store.get(key);
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
}

/* ponytail: read-modify-write per identity key, no lock. Two phones of the same person binding in the
 * same instant can lose one; the losing phone re-binds on its next launch. A per-key lock or a store
 * with conditional writes when that race is seen. */
function deviceDirectory(store) {
  if (!store || typeof store.get !== "function" || typeof store.put !== "function") return null;
  const key = (orgId, identity) => `${WHO}${str(orgId)}~${str(identity)}`;
  return {
    /** Binds one device to every identity form the server derived for the caller. First is primary. */
    async bind(orgId, identities, tokenId) {
      const ids = [...new Set((identities || []).map(str).filter(Boolean))];
      if (!str(orgId) || !ids.length || !str(tokenId)) throw new Error("orgId, identity and device are required");
      for (const id of ids) {
        const cur = (await readJson(store, key(orgId, id))) || { tokenIds: [] };
        const tokenIds = [str(tokenId), ...(cur.tokenIds || []).filter((t) => t !== str(tokenId))].slice(0, MAX_DEVICES);
        const also = id === ids[0] ? [...new Set([...(cur.also || []), ...ids.slice(1)])] : (cur.also || []);
        await store.put(key(orgId, id), JSON.stringify({ tokenIds, also, at: new Date().toISOString() }));
      }
      return { bound: ids.length };
    },
    /** Every device of this identity, and of the other forms it was bound under, stops receiving alerts. */
    async unbind(orgId, identity) {
      const cur = await readJson(store, key(orgId, identity));
      if (!cur) return { removed: 0 };
      const keys = [key(orgId, identity), ...(cur.also || []).map((a) => key(orgId, a))];
      for (const k of keys) await store.delete(k);
      return { removed: (cur.tokenIds || []).length };
    },
    /** This one device stops receiving this hospital's alerts (a sign-out on it); the person's other phones keep them. */
    async release(orgId, identities, tokenId) {
      let removed = 0;
      for (const id of new Set((identities || []).map(str).filter(Boolean))) {
        const cur = await readJson(store, key(orgId, id));
        if (!cur || !(cur.tokenIds || []).includes(str(tokenId))) continue;
        await store.put(key(orgId, id), JSON.stringify({ ...cur, tokenIds: cur.tokenIds.filter((t) => t !== str(tokenId)), at: new Date().toISOString() }));
        removed++;
      }
      return { removed };
    },
    async devicesFor(orgId, identity) {
      const cur = await readJson(store, key(orgId, identity));
      return cur && Array.isArray(cur.tokenIds) ? cur.tokenIds : [];
    },
    async putNotice(nid, pointer) { await store.put(NOTICE + str(nid), JSON.stringify(pointer)); },
    async getNotice(nid) { return /^[0-9a-f]{32}$/.test(str(nid)) ? readJson(store, NOTICE + str(nid)) : null; },
  };
}

export { deviceDirectory };
