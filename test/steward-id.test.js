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

  // GUARD: mint must NOT clobber an e_{hash} pointer already owned by a DIFFERENT uid
  // (one-email-one-account). Pre-seed the email index to another account, then mint.
  S._reset();
  const shared = "shared@hospital.org";
  const eKey = "e_" + S.emailHash(shared);
  const profStore3 = { self: {} };
  const dir3 = {}; dir3[eKey] = { uid: "owner-uid", name: "Dr Owner", smdId: "SMD-OWNER1", at: "T0" };
  const fakeDb3 = makeFakeDb(profStore3, dir3);
  const id3 = await new Promise(r => S.ensure(depsFor(fakeDb3, "intruder-uid", "Dr Intruder", shared), r));
  assert.ok(/^SMD-[A-Z2-9]{6}$/.test(id3), "intruder still gets its own id");
  assert.equal(dir3[eKey].uid, "owner-uid", "email index NOT clobbered — still points to the original owner");
  assert.ok(dir3[id3] && dir3[id3].uid === "intruder-uid", "intruder's by-id directory entry is written");

  // ACCOUNT SWITCH: now that the ID is minted for EVERY signed-in user, a sign-out → sign-in as
  // someone else happens inside one page lifetime. The cache must never hand account B the ID it
  // resolved for account A (that ID travels into referrals, invites and the directory).
  S._reset();
  const profA = { self: { smdId: "SMD-AAAAA2" } };
  const dirAB = {};
  const idA = await new Promise(r => S.ensure(depsFor(makeFakeDb(profA, dirAB), "uidA", "Dr A", "a@h.org"), r));
  assert.equal(idA, "SMD-AAAAA2", "account A resolves its own id");
  assert.equal(S.my("uidA"), "SMD-AAAAA2", "my() returns it for its owner");
  assert.equal(S.my("uidB"), null, "my() refuses to hand A's id to another uid");
  const profB = { self: { smdId: "SMD-BBBBB3" } };
  const idB = await new Promise(r => S.ensure(depsFor(makeFakeDb(profB, dirAB), "uidB", "Dr B", "b@h.org"), r));
  assert.equal(idB, "SMD-BBBBB3", "account B resolves ITS id, not A's cached one");
  assert.equal(S.my("uidB"), "SMD-BBBBB3", "cache now belongs to B");

  // ---- PERMANENCE ----------------------------------------------------------
  // The ID is advertised as permanent ("It never changes"), so every path that could
  // hand back a DIFFERENT id for the same account is pinned here.

  // A profile read that FAILS must not mint. This was the bug: one unreachable-Firestore
  // moment reissued the user's "permanent" ID and overwrote the old one.
  S._reset();
  const dirFail = {};
  const failDb = Object.assign(makeFakeDb({ self: { smdId: "SMD-KEEPME" } }, dirFail), {
    collection(name) {
      if (name === "users") return { doc() { return { collection() { return { doc() { return { get: () => Promise.reject(new Error("unavailable")) }; } }; } }; } };
      return { doc(id) { return docRef(dirFail, id); } };
    }
  });
  const idFail = await new Promise(r => S.ensure(depsFor(failDb, "uidF", "Dr F", "f@h.org"), r));
  assert.equal(idFail, null, "unreadable profile -> no id, NOT a fresh mint");
  assert.equal(Object.keys(dirFail).length, 0, "nothing was written to the directory");

  // A profile doc that lost its smdId recovers the account's OWN id from the email index
  // instead of minting a new one (same uid only).
  S._reset();
  const eOwn = "e_" + S.emailHash("own@h.org");
  const profLost = { self: { name: "Dr O" } };
  const dirOwn = {}; dirOwn[eOwn] = { uid: "uidO", name: "Dr O", smdId: "SMD-OWNID2", at: "T0" };
  const idAdopt = await new Promise(r => S.ensure(depsFor(makeFakeDb(profLost, dirOwn), "uidO", "Dr O", "own@h.org"), r));
  assert.equal(idAdopt, "SMD-OWNID2", "adopted its own id back");
  assert.equal(profLost.self.smdId, "SMD-OWNID2", "and wrote it back to the profile");
  assert.equal(Object.keys(dirOwn).length, 1, "no new directory row was minted");

  // ... but never adopts an index pointer owned by someone else.
  S._reset();
  const eOther = "e_" + S.emailHash("other@h.org");
  const dirOther = {}; dirOther[eOther] = { uid: "someone-else", name: "Dr X", smdId: "SMD-THEIRS", at: "T0" };
  const idNoSteal = await new Promise(r => S.ensure(depsFor(makeFakeDb({ self: {} }, dirOther), "uidN", "Dr N", "other@h.org"), r));
  assert.ok(idNoSteal && idNoSteal !== "SMD-THEIRS", "minted its own id, did not take theirs");
  assert.equal(dirOther[eOther].uid, "someone-else", "the other account's pointer is untouched");

  // Two devices minting at once: the second must adopt the id the first already wrote to the
  // profile doc, not rename the account to its own fresh one.
  S._reset();
  const profRace = { self: {} };
  const dirRace = {};
  const raceDb = makeFakeDb(profRace, dirRace);
  const baseTx = raceDb.runTransaction.bind(raceDb);
  let firstDirClaim = true;
  raceDb.runTransaction = function (fn) {
    // The other device wins the profile doc between our directory claim and our profile write.
    if (firstDirClaim && Object.keys(dirRace).length === 1) { firstDirClaim = false; profRace.self = { smdId: "SMD-OTHERD" }; }
    return baseTx(fn);
  };
  const idRace = await new Promise(r => S.ensure(depsFor(raceDb, "uidR", "Dr R", "r@h.org"), r));
  assert.equal(idRace, "SMD-OTHERD", "loser adopts the winner's id");
  assert.equal(profRace.self.smdId, "SMD-OTHERD", "profile keeps the id it already had");
  assert.equal(dirRace["e_" + S.emailHash("r@h.org")].smdId, "SMD-OTHERD", "email index points at the surviving id");

  console.log("ok");
})();
