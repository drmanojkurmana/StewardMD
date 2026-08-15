/* test/support.test.mjs — support tickets: unique id, ownership, threaded replies, resolve.
 * node --test test/support.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTicket, addMessage, setStatus, getTicket, listTickets, listMine, makeId, isStatus } from "../functions/_support.js";

function fakeStore() { const m = new Map(); return { get: (k) => Promise.resolve(m.has(k) ? m.get(k) : null), put: (k, v) => { m.set(k, v); return Promise.resolve(); } }; }
const NOW = Date.parse("2026-08-16T10:00:00Z");
const WHO = { id: "fb:doc1", email: "doc1@x.in", name: "Dr One" };

test("complaint id is SMD- prefixed and deterministic from entropy", () => {
  assert.match(makeId([123456, 789]), /^SMD-[0-9A-Z]{6}$/);
  assert.equal(makeId([1, 2]), makeId([1, 2]));   // pure
  assert.notEqual(makeId([1, 2]), makeId([9, 9]));
});

test("create assigns a unique id, opens the ticket, records the first message", async () => {
  const s = fakeStore();
  const t = await createTicket(s, WHO, { subject: "Voice broken", text: "no transcript" }, [42, 99], NOW);
  assert.match(t.id, /^SMD-/);
  assert.equal(t.status, "open");
  assert.equal(t.owner, "fb:doc1");
  assert.equal(t.email, "doc1@x.in");
  assert.equal(t.messages.length, 1);
  assert.equal(t.messages[0].from, "user");
  const list = await listTickets(s);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, t.id);
  assert.equal(list[0].unread, true);   // owner sees it as unread
});

test("empty subject+text is rejected", async () => {
  const s = fakeStore();
  await assert.rejects(() => createTicket(s, WHO, { subject: "  ", text: "" }, [1, 2], NOW));
});

test("owner reply threads onto the ticket; reply&resolve flips status", async () => {
  const s = fakeStore();
  const t = await createTicket(s, WHO, { subject: "Q", text: "help" }, [7, 7], NOW);
  await addMessage(s, t.id, "support", "try reinstall", NOW + 1000, "resolved");
  const got = await getTicket(s, t.id);
  assert.equal(got.messages.length, 2);
  assert.equal(got.messages[1].from, "support");
  assert.equal(got.status, "resolved");
  const resolved = await listTickets(s, "resolved");
  assert.equal(resolved.length, 1);
  assert.equal((await listTickets(s, "open")).length, 0);
});

test("listMine returns only the caller's tickets", async () => {
  const s = fakeStore();
  await createTicket(s, { id: "fb:doc1", email: "a@x" }, { subject: "mine", text: "x" }, [1, 1], NOW);
  await createTicket(s, { id: "fb:doc2", email: "b@x" }, { subject: "theirs", text: "y" }, [2, 2], NOW + 1);
  const mine = await listMine(s, "fb:doc1");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].subject, "mine");
});

test("reopen via setStatus and isStatus guard", async () => {
  const s = fakeStore();
  const t = await createTicket(s, WHO, { subject: "x", text: "y" }, [3, 3], NOW);
  await setStatus(s, t.id, "resolved", NOW + 1);
  const r = await setStatus(s, t.id, "open", NOW + 2);
  assert.equal(r.status, "open");
  assert.equal(isStatus("bogus"), false);
  assert.equal(await setStatus(s, t.id, "bogus", NOW + 3), null);
});
