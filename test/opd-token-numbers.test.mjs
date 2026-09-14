/* test/opd-token-numbers.test.mjs - the OPD token a patient hears called in the waiting hall.
 *
 * _queue_engine.js addTicket allocates the token in the SAME commit that creates the ticket, guarded on
 * the counter q_token_counters/<hospital>__<day>__<scope> being unchanged since it was read. This drives
 * a fake Firestore with the real commit semantics (a stale updateTime or an existing doc fails the whole
 * commit, nothing applied), so duplicates, burnt numbers and ticket-without-token are all observable.
 *
 * Run: node --experimental-test-module-mocks --test test/opd-token-numbers.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const docs = new Map();          // path -> { fields, updateTime }
let clock = 1;
let failNext = null;             // (writes) => Error | null, consulted once per commit
let barrier = null;              // { want, arrived, release } - holds counter reads until `want` have read
function reset() { docs.clear(); clock = 1; failNext = null; barrier = null; }
const counterPaths = () => [...docs.keys()].filter((k) => k.startsWith("q_token_counters/"));
const tickets = () => [...docs.entries()].filter(([k]) => k.startsWith("q_tickets/")).map(([k, d]) => ({ id: k.slice(10), ...d.fields }));

mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_env, path) => {
      if (barrier && path.startsWith("q_token_counters/")) {
        const snap = docs.get(path);
        const b = barrier;
        b.arrived++;
        if (b.arrived >= b.want) b.release();
        await b.gate;
        return snap ? { id: path, name: path, fields: { ...snap.fields }, updateTime: snap.updateTime } : null;
      }
      const d = docs.get(path);
      return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null;
    },
    fsQuery: async (_env, coll, opts) => {
      const w = opts && opts.where;
      return [...docs.entries()].filter(([k, d]) => k.startsWith(coll + "/") && k.indexOf("/", coll.length + 1) < 0 && (!w || d.fields[w.field] === w.value))
        .map(([k, d]) => ({ id: k.slice(coll.length + 1), fields: { ...d.fields } }));
    },
    fsCommit: async (_env, writes) => {
      if (failNext) { const f = failNext; const err = f(writes); if (err) throw err; }
      for (const w of writes || []) {
        const cd = w.currentDocument, cur = docs.get(w.update.name);
        if (cd && cd.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" });
        if (cd && cd.updateTime && (!cur || cur.updateTime !== cd.updateTime)) throw Object.assign(new Error("stale"), { code: "precondition" });
      }
      for (const w of writes || []) {
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_env, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_env, path, fields, opts) => {
      const w = { update: { name: path, fields } };
      if (opts && opts.updateTime) w.currentDocument = { updateTime: opts.updateTime };
      else if (opts && opts.exists === true) w.currentDocument = { exists: true };
      return w;
    },
    wDelete: (_env, path) => ({ delete: path }),
  },
});
mock.module("../functions/_queue.js", {
  namedExports: {
    encPHI: async (_e, v) => (v ? "enc:" + v : ""), decPHI: async (_e, v) => String(v || "").replace(/^enc:/, ""),
    mintTicketToken: async () => "tok", verifyTicketToken: async () => ({ ok: true }), ticketIdFromToken: () => "",
    // Only so the org store (rooms, OPD-02) can load; nothing here signs a token.
    signToken: async () => "", verifyToken: async () => ({ ok: false }), idFromToken: () => "", queueSecret: () => "",
  },
});
const notified = [];
mock.module("../functions/_queue_notify.js", {
  namedExports: { runQueueNotifications: async () => {}, notifyTicket: async (_e, _s, t, ev) => { notified.push({ ev, token: t.token }); } },
});

const Q = await import("../functions/_queue_engine.js");
const { tokenConfig, tokenScope, formatToken } = await import("../functions/_opd_org.js");
const ENV = {};
const H = "hosp1";
const DAY = "2026-09-14";
const session = (doctorUid, date, hospitalId) => Q.getOrCreateSession(ENV, { hospitalId: hospitalId || H, doctorUid, department: "General", date: date || DAY });
const add = (s, name, extra) => Q.addTicket(ENV, s, { name, mobile: "9876543210", mrn: "MR1234", ...(extra || {}) }, "desk1");

test("sequential allocation gives 1, 2, 3 and stores the counter per hospital, day and scope", async () => {
  reset();
  const s = await session("d1");
  const out = [];
  for (const n of ["Asha", "Ravi", "Meena"]) out.push((await add(s, n)).token);
  assert.deepEqual(out, ["1", "2", "3"]);
  assert.deepEqual(counterPaths(), ["q_token_counters/" + H + "__" + DAY + "__hospital"]);
  assert.equal(docs.get(counterPaths()[0]).fields.n, 3);
  for (const t of tickets()) assert.equal(t.tokenScope, "hospital");
});

test("every doctor's session in a hospital draws from the one hospital sequence", async () => {
  reset();
  const a = await session("d1"), b = await session("d2");
  assert.equal((await add(a, "A")).token, "1");
  assert.equal((await add(b, "B")).token, "2");
  assert.equal((await Q.addToPool(ENV, { id: H }, { name: "C", date: DAY })).token, "3", "the unassigned pool too");
});

test("RACE: two desks reading the same counter version get distinct tokens; the loser retries", async () => {
  reset();
  const s = await session("d1");
  await add(s, "first");   // counter exists, so both racers hold the same updateTime
  let preconditionFailures = 0;
  failNext = (writes) => {
    const c = writes[0].currentDocument, cur = docs.get(writes[0].update.name);
    if (c && c.updateTime && cur && cur.updateTime !== c.updateTime) preconditionFailures++;
    return null;
  };
  let release; barrier = { want: 2, arrived: 0, gate: new Promise((r) => (release = r)), release: () => { barrier = null; release(); } };
  const [x, y] = await Promise.all([add(s, "desk A"), add(s, "desk B")]);
  assert.deepEqual([x.token, y.token].sort(), ["2", "3"], "distinct, consecutive");
  assert.equal(preconditionFailures, 1, "exactly one commit lost the compare-and-set and re-read");
  const live = tickets().map((t) => t.token);
  assert.equal(new Set(live).size, live.length, "no two live tickets share a token");
  assert.equal(live.length, 3);
});

test("RACE: many desks at once never collide", async () => {
  reset();
  const s = await session("d1");
  const out = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => add(s, "p" + i)));
  const ok = out.filter((r) => r.status === "fulfilled").map((r) => r.value.token);
  assert.equal(new Set(ok).size, ok.length);
  assert.equal(tickets().length, ok.length, "a refused registration left no ticket behind");
});

test("a failed commit burns no number and leaves no ticket without one", async () => {
  reset();
  const s = await session("d1");
  assert.equal((await add(s, "one")).token, "1");
  failNext = () => { failNext = null; return Object.assign(new Error("fs_commit_failed"), { code: "fs_commit", status: 503 }); };
  await assert.rejects(add(s, "lost"), /fs_commit_failed/);
  assert.equal(tickets().length, 1, "no ticket created");
  assert.equal(docs.get(counterPaths()[0]).fields.n, 1, "counter unchanged");
  assert.equal((await add(s, "two")).token, "2", "the number was not burnt");
});

test("persistent contention is refused with 409 rather than risk a duplicate", async () => {
  reset();
  const s = await session("d1");
  await add(s, "one");
  failNext = () => Object.assign(new Error("stale"), { code: "precondition" });
  await assert.rejects(add(s, "never"), (e) => e.status === 409 && e.message === "token_contention");
  failNext = null;
  assert.equal(tickets().length, 1);
  assert.equal(docs.get(counterPaths()[0]).fields.n, 1);
});

test("the token is stable across move, priority change, recall and reassignment to another doctor", async () => {
  reset();
  const s = await session("d1");
  const t1 = await add(s, "a"), t2 = await add(s, "b"), t3 = await add(s, "c");
  const tokenOf = (id) => docs.get("q_tickets/" + id).fields.token;
  await Q.moveTicket(ENV, s, t3.id, { toIndex: 0, category: "elderly" }, "nurse");
  await Q.setPriority(ENV, s, t2.id, 2, "nurse");
  await Q.setStatus(ENV, s, t1.id, "called", "nurse");
  await Q.setStatus(ENV, s, t1.id, "waiting", "nurse");   // did not come in: sent back to the hall
  await Q.setStatus(ENV, s, t1.id, "called", "nurse");    // recalled
  await Q.assignTicket(ENV, s, t3.id, "d2", {}, "desk1");
  assert.equal(docs.get("q_tickets/" + t3.id).fields.sessionId, (await session("d2")).id, "really moved");
  assert.deepEqual([tokenOf(t1.id), tokenOf(t2.id), tokenOf(t3.id)], ["1", "2", "3"]);
});

test("a cancelled ticket's number is not reused that day; a new day starts again at 1", async () => {
  reset();
  const s = await session("d1");
  await add(s, "a");
  const b = await add(s, "b");
  await Q.setStatus(ENV, s, b.id, "cancelled", "desk1");
  assert.equal((await add(s, "c")).token, "3");
  assert.equal((await add(await session("d1", "2026-09-15"), "tomorrow")).token, "1");
  assert.equal((await add(await session("d1", DAY, "hosp2"), "other hospital")).token, "1");
});

// Departments are q_departments rows: the counter and the prefix follow the id, never the name.
const DEPT = (id, name, code, extra) => docs.set("q_departments/" + id, { fields: { id, orgId: H, name, code: code || "", type: "general", active: true, ...(extra || {}) }, updateTime: "t0" });
function seedDepts() { DEPT("dcard", "Cardiology"); DEPT("dmed", "General Medicine", "GM"); DEPT("dortho", "Orthopaedics"); DEPT("dold", "Closed Unit", "CU", { active: false }); }

test("OPD-01 department scope: each department counts separately under its id, with its prefix; config read from the org when not passed", async () => {
  reset(); seedDepts();
  const tokens = { scope: "department", prefixes: { dcard: "c", "general medicine": "XX", Bad: "!!" } };
  const org = { id: H, tokens: tokenConfig(tokens) };
  const pool = (b) => Q.addToPool(ENV, org, { name: "x", date: DAY, ...b });
  const t1 = await pool({ departmentId: "dcard" });
  assert.equal(t1.token, "C-001");
  assert.equal(t1.departmentId, "dcard"); assert.equal(t1.department, "Cardiology", "ticket carries the id and the current name");
  assert.equal((await pool({ department: "cardiology " })).token, "C-002", "a name matches its department, case-insensitively");
  assert.equal((await pool({ departmentId: "dmed" })).token, "XX-001", "a legacy name-keyed prefix is still read");
  await assert.rejects(pool({ departmentId: "dortho" }), (e) => e.status === 422 && e.message === "token_prefix_missing" && e.departmentName === "Orthopaedics", "OPD-03 (D14): no prefix and no usable code is refused, never a plain colliding number");
  await assert.rejects(pool({}), (e) => e.status === 422 && e.message === "token_department_required", "OPD-03 (D14): no department at all is refused, never a shared dept-none counter");
  await assert.rejects(pool({ department: "Dermatology" }), (e) => e.status === 422 && e.message === "token_department_required" && e.departmentName === "Dermatology", "an unmapped name is refused and named");
  assert.ok(!counterPaths().some((k) => /dept-dortho|dept-none/.test(k)), "a refusal creates no counter");
  assert.equal(tickets().length, 3, "and no ticket");
  assert.ok(counterPaths().includes("q_token_counters/" + H + "__" + DAY + "__dept-dcard"), "counter keyed by department id");
  // A room/doctor session carries no org; addTicket reads q_orgs/<hospital>.
  docs.set("q_orgs/" + H, { fields: { tokens }, updateTime: "t0" });
  assert.equal((await add(await session("d1"), "via org", { departmentId: "dcard" })).token, "C-003");
  assert.deepEqual(tokenScope({}, { id: "dcard", name: "Cardiology" }), { key: "hospital", prefix: "" }, "default is the whole hospital");
  assert.deepEqual(tokenConfig(tokens).prefixes, { dcard: "C", "general medicine": "XX" }, "junk prefixes dropped");
  assert.equal(formatToken("", 12), "12");
  assert.equal(formatToken("A", 12), "A-012");
});

test("OPD-01 where the department comes from: picker, then room, then the ticket's own name or an alias, then the session", async () => {
  reset(); seedDepts();
  const tokens = { scope: "department", prefixes: { dcard: "C", dmed: "M", dortho: "O" }, deptAliases: { "Gen Med OPD": "dmed", "Bone clinic": "dortho" } };
  docs.set("q_orgs/" + H, { fields: { tokens }, updateTime: "t0" });
  docs.set("q_rooms/r-ortho", { fields: { orgId: H, name: "Room 4", departmentId: "dortho" }, updateTime: "t0" });
  const s = await Q.getOrCreateSession(ENV, { hospitalId: H, doctorUid: "d9", department: "Gen Med OPD", date: DAY });
  assert.equal((await add(s, "session")).token, "M-001", "the doctor session's department, through its alias");
  assert.equal((await add(s, "import row", { department: "bone clinic" })).token, "O-001", "the ticket's own department name beats the session's");
  assert.equal((await add(s, "room", { roomId: "r-ortho", department: "Cardiology" })).token, "O-002", "the room beats a name");
  assert.equal((await add(s, "picker", { departmentId: "dcard", roomId: "r-ortho" })).token, "C-001", "the desk's picker beats everything");
  const before = tickets().length;
  await assert.rejects(add(s, "closed", { departmentId: "dold" }), (e) => e.status === 422 && e.message === "department_not_found", "an inactive department is refused, not guessed");
  await assert.rejects(add(s, "foreign", { departmentId: "no-such" }), (e) => e.status === 422);
  assert.equal(tickets().length, before, "a refused registration leaves no ticket");
  docs.set("q_rooms/r-foreign", { fields: { orgId: "hosp2", name: "Theirs", departmentId: "dcard" }, updateTime: "t0" });
  assert.equal((await add(s, "foreign room", { roomId: "r-foreign" })).token, "M-002", "another hospital's room lends no department");
});

test("OPD-01 a renamed department keeps its sequence and prefix; a sequence started under the old name key today is continued", async () => {
  reset(); seedDepts();
  const org = { id: H, tokens: tokenConfig({ scope: "department", prefixes: { dcard: "C" } }) };
  // Before D7 the counter was keyed by the name slug. Today's morning ran to 5 under it.
  docs.set("q_token_counters/" + H + "__" + DAY + "__dept-cardiology", { fields: { n: 5 }, updateTime: "t0" });
  assert.equal((await Q.addToPool(ENV, org, { name: "a", departmentId: "dcard", date: DAY })).token, "C-006", "no second C-001 today");
  DEPT("dcard", "Heart Centre");
  const renamed = await Q.addToPool(ENV, org, { name: "b", departmentId: "dcard", date: DAY });
  assert.equal(renamed.token, "C-007");
  assert.equal(renamed.department, "Heart Centre");
});

test("OPD-01 hospital scope: the picker still records the department, and the one sequence is unchanged", async () => {
  reset(); seedDepts();
  const t = await Q.addToPool(ENV, { id: H, tokens: tokenConfig({}) }, { name: "a", departmentId: "dmed", date: DAY });
  assert.equal(t.token, "1");
  assert.equal(t.department, "General Medicine");
  assert.deepEqual(counterPaths(), ["q_token_counters/" + H + "__" + DAY + "__hospital"]);
});

test("OPD-02 a room carries its department name from its departmentId; routing a patient to another department's room keeps the token and shows the new department", async () => {
  reset(); seedDepts();
  const ORG = await import("../functions/_opd_org_store.js");
  const rm = await ORG.createRoom(ENV, H, { name: "Bone room", departmentId: "dortho", assignment: { mode: "primary", primary: "dr1", doctors: ["dr1"] } }, "admin");
  assert.equal(rm.department, "Orthopaedics");
  assert.equal(docs.get("q_rooms/" + rm.id).fields.department, undefined, "the name is not stored on the room");
  assert.equal((await ORG.listRooms(ENV, H))[0].department, "Orthopaedics");
  DEPT("dortho", "Bones and Joints");
  assert.equal((await ORG.getRoom(ENV, rm.id)).department, "Bones and Joints", "a renamed department shows its new name");
  const org = { id: H, tokens: tokenConfig({ scope: "department", prefixes: { dmed: "M" } }) };
  const t = await Q.addToPool(ENV, org, { name: "moved", departmentId: "dmed", date: DAY });
  const sessionsBefore = [...docs.keys()].filter((k) => k.startsWith("q_sessions/"));
  await Q.assignToRoom(ENV, org, t.id, await ORG.getRoom(ENV, rm.id), { date: DAY }, "nurse");
  const f = docs.get("q_tickets/" + t.id).fields;
  assert.equal(f.token, "M-001", "the number the patient heard is kept");
  assert.equal(f.departmentId, "dortho"); assert.equal(f.department, "Bones and Joints");
  const roomSession = docs.get("q_sessions/" + f.sessionId).fields;
  assert.equal(roomSession.department, "", "the room session id is not keyed by the department (no mid-day session split)");
  assert.ok(sessionsBefore.length >= 1);
});

test("OPD-03 (D14) pure: department scope cannot be saved while a department lacks a prefix or two share one", async () => {
  const { tokenConfigProblems } = await import("../functions/_opd_org.js");
  const depts = [{ id: "a", name: "Cardiology", code: "" }, { id: "b", name: "Medicine", code: "MED" }, { id: "c", name: "Closed", active: false }];
  assert.deepEqual(tokenConfigProblems({ scope: "hospital" }, depts), [], "hospital scope needs no prefixes");
  assert.deepEqual(tokenConfigProblems({ scope: "department" }, depts), ["Cardiology has no prefix."], "an inactive department is not counted; a code is a prefix");
  assert.deepEqual(tokenConfigProblems({ scope: "department", prefixes: { a: "MED" } }, depts), ["Cardiology and Medicine both use the prefix MED."]);
  assert.deepEqual(tokenConfigProblems({ scope: "department", prefixes: { a: "C" }, deptAliases: { old: "c" } }, depts), ['The name "old" points to a department that is not active here.']);
  assert.deepEqual(tokenConfigProblems({ scope: "department", prefixes: { a: "C" } }, depts), []);
});

test("OPD-01 an EMR import names the department its refused rows need, and imports the rest", async () => {
  reset(); seedDepts();
  docs.set("q_orgs/" + H, { fields: { tokens: { scope: "department", prefixes: { dmed: "M" }, deptAliases: { "gen med": "dmed" } } }, updateTime: "t0" });
  const { importRoster } = await import("../functions/_queue_ghis.js");
  const s = await Q.getOrCreateSession(ENV, { hospitalId: H, doctorUid: "d1", department: "", date: DAY });
  const r = await importRoster(ENV, s, [
    { PatientName: "One", PatientId: "MR1", VisitId: "v1", Department: "Gen Med" },
    { PatientName: "Two", PatientId: "MR2", VisitId: "v2", Department: "Skin OPD" },
    { PatientName: "Three", PatientId: "MR3", VisitId: "v3", Department: "Orthopaedics" },
  ], "import");
  assert.equal(r.imported, 1);
  assert.deepEqual(r.issues, [{ reason: "token_department_required", department: "Skin OPD" }, { reason: "token_prefix_missing", department: "Orthopaedics" }]);
  assert.deepEqual(tickets().map((t) => t.token), ["M-001"]);
  assert.doesNotMatch(JSON.stringify(r.issues), /One|Two|Three|MR\d/, "an issue names a department, never a patient");
});

test("the allocation is audited on the register row, token in meta and no PHI", async () => {
  reset();
  notified.length = 0;
  const t = await add(await session("d1"), "Asha Kumar");
  const ev = [...docs.values()].map((d) => d.fields).find((f) => f.action === "register" && f.ticketId === t.id);
  assert.ok(ev, "register row written");
  assert.match(ev.meta, /token:1\b/);
  assert.doesNotMatch(JSON.stringify(ev), /Asha|Kumar|9876543210|MR1234/);
  assert.deepEqual(notified, [{ ev: "registered", token: "1" }], "the registration message gets the token");
});

test("the doctor/desk view carries the token; an old ticket without one carries none", async () => {
  reset();
  const s = await session("d1");
  await add(s, "new");
  docs.set("q_tickets/legacy", { fields: { sessionId: s.id, hospitalId: H, status: "waiting", encName: "enc:Old", registeredAt: 1 }, updateTime: "t0" });
  const view = await Q.decorateForDoctor(ENV, await Q.listTickets(ENV, s.id));
  assert.equal(view.find((t) => t.name === "new").token, "1");
  assert.equal(view.find((t) => t.id === "legacy").token, undefined, "no backfill");
  assert.equal(tokenOf(docs, "legacy"), undefined);
});
function tokenOf(d, id) { return d.get("q_tickets/" + id).fields.token; }

test("screens: desk, doctor queue and call-next show the token; the wall shows tokens only; cache tokens bumped", () => {
  const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
  const q = read("queue.js"), opd = read("opd.html"), wall = read("opd-display.html"), idx = read("index.html");
  assert.match(q, /q-tl-nm">' \+ tok\(t\)/, "doctor queue row");
  assert.match(q, /<h3>' \+ tok\(cur\)/, "doctor consult card");
  assert.match(q, /q-fd-row"><div>' \+ tok\(t\)/, "front desk pool row");
  assert.equal((opd.match(/'\+tok\(t\)\+esc\(t\.name/g) || []).length, 3, "OPD console rows");
  assert.match(opd, /Now calling token "\+nx\.token/, "call-next result after checkout");
  assert.doesNotMatch(wall, /Asha Kumar|R\. Mehta|shortName/, "no patient names on the wall, not even in its preview");
  assert.match(wall, /"Token " \+ n/);
  assert.match(idx, /queue\.js\?v=[\w-]+/);
  assert.match(idx, /queue\.css\?v=[\w-]+/);
  assert.match(read("wardsynq/site/index.html"), /pages\/admin\.js\?v=\d+/);
});
