const assert = require("assert");
const S = require("../steward-id.js");

// genId format
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
for (let i = 0; i < 2000; i++) {
  const id = S.genId();
  assert.ok(/^SMD-[A-Z2-9]{6}$/.test(id), "shape " + id);
  const body = id.slice(4);
  for (const ch of body) assert.ok(ALPHA.indexOf(ch) >= 0, "no ambiguous char in " + id);
  assert.ok(!/[O01IL]/.test(body), "never O/0/1/I/L: " + id);
}
// emailHash stability + case-insensitivity
assert.equal(S.emailHash("Dr@X.com"), S.emailHash("dr@x.com"), "case-insensitive");
assert.equal(typeof S.emailHash("a@b.com"), "string");
assert.ok(S.emailHash("a@b.com") !== S.emailHash("a@c.com"), "different emails differ");
// normalizeId
assert.equal(S.normalizeId("abc234"), "SMD-ABC234", "bare code gets prefix");
assert.equal(S.normalizeId(" smd-abc234 "), "SMD-ABC234", "trim+upper");

// --- tiny in-memory Firestore double (transaction + doc get/set) ---
// docRef() models a Firestore-ish doc reference. `store` is a plain object keyed by doc id
// (for a "collection"); `subFor` (optional) lets a doc expose a nested `.collection(name).doc(id)`
// (used for users/{uid}/profile/self).
function docRef(store, id, subStore) {
  return {
    _get() {
      return Object.prototype.hasOwnProperty.call(store, id)
        ? { exists: true, data: () => store[id] }
        : { exists: false, data: () => ({}) };
    },
    _set(val) { store[id] = val; },
    get() { return Promise.resolve(this._get()); },
    set(val, opts) {
      if (opts && opts.merge && store[id]) {
        store[id] = Object.assign({}, store[id], val);
      } else {
        store[id] = val;
      }
      return Promise.resolve();
    },
    collection(name) {
      // Only the profile doc needs a nested collection (profile/self).
      return { doc(sub) { return docRef(subStore, sub); } };
    }
  };
}

function makeFakeDb(profStore, dir) {
  return {
    _prof: profStore, _dir: dir,
    collection(name) {
      const db = this;
      if (name === "doctorDirectory") {
        return { doc(id) { return docRef(db._dir, id); } };
      }
      if (name === "users") {
        // users/{uid} -> a doc whose only use here is .collection("profile").doc("self")
        return { doc(uid) { return { collection(sub) { return { doc(id) { return docRef(db._prof, id); } }; } }; } };
      }
      throw new Error("unexpected collection " + name);
    },
    runTransaction(fn) {
      const tx = {
        get(ref) { return Promise.resolve(ref._get()); },
        set(ref, val) { ref._set(val); }
      };
      return Promise.resolve().then(() => fn(tx));
    }
  };
}

function depsFor(db, uid, name, email) {
  return {
    getDb: () => db,
    getUid: () => uid,
    getName: () => name,
    getEmail: () => email,
    serverTimestamp: () => "TS"
  };
}

(async () => {
  // ensure(): idempotent — existing smdId is NOT re-minted
  const profStore = { self: { smdId: "SMD-EXIST9" } };
  const fakeDb = makeFakeDb(profStore, {});
  const id1 = await new Promise(r => S.ensure(depsFor(fakeDb, "uid1", "Dr A", "a@b.com"), r));
  assert.equal(id1, "SMD-EXIST9", "returns cached, no mint");

  S._reset();

  // ensure(): no smdId -> mints exactly one, writes directory + profile
  const profStore2 = { self: {} };
  const dir2 = {};
  const fakeDb2 = makeFakeDb(profStore2, dir2);
  const id2 = await new Promise(r => S.ensure(depsFor(fakeDb2, "uid2", "Dr B", "b@b.com"), r));
  assert.ok(/^SMD-[A-Z2-9]{6}$/.test(id2), "minted an id");
  assert.equal(profStore2.self.smdId, id2, "cached on profile");
  assert.ok(dir2[id2] && dir2[id2].uid === "uid2", "directory entry by id");
  assert.ok(dir2["e_" + S.emailHash("b@b.com")], "email index written");
  console.log("ok");
})();
