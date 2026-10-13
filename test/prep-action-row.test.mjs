import { test } from "node:test"; import assert from "node:assert";
import A from "../prep-action-row.js";

const ITEM = { itemId: "sbs-descriptive-probability", itemType: "lesson", subject: "ss-biostatistics", module: "sbs-descriptive-probability" };
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test("reasons: the seven sheet choices, in order", () => {
  assert.deepEqual(A.REASONS.map((r) => r[0]), ["wrong-fact", "wrong-answer", "unclear", "image-problem", "typo", "offensive", "other"]);
  assert.equal(A.reasonLabel("image-problem"), "Image or diagram problem");
  assert.equal(A.validReason("wrong-key"), true, "legacy codes stay valid");
});

test("payload: full report carries id, type, reason, text, app version", () => {
  const r = A.buildPayload(ITEM, "wrong-fact", "  The mean is wrong. ", "1.2.3");
  assert.equal(r.ok, true);
  assert.deepEqual(r.payload, { itemId: ITEM.itemId, itemType: "lesson", subject: "ss-biostatistics", module: ITEM.module, reason: "wrong-fact", text: "The mean is wrong.", appVersion: "1.2.3" });
});

test("payload: note optional except for Other; 500 char cap", () => {
  assert.equal(A.buildPayload(ITEM, "typo", "").ok, true);
  assert.equal(A.buildPayload(ITEM, "other", "").ok, false);
  assert.match(A.buildPayload(ITEM, "other", "   ").error, /short note/);
  assert.equal(A.buildPayload(ITEM, "typo", "x".repeat(501)).ok, false);
  assert.equal(A.buildPayload(ITEM, "typo", "x".repeat(500)).ok, true);
  assert.equal(A.buildPayload(ITEM, "", "").ok, false);
  assert.equal(A.buildPayload(ITEM, "nonsense", "").ok, false);
});

test("payload: legacy reason codes pass through unchanged for old servers", () => {
  assert.equal(A.buildPayload(ITEM, "wrong-key", "").payload.reason, "wrong-key");
  assert.equal(A.buildPayload(ITEM, "outdated", "").payload.reason, "outdated");
});

test("queue: offline reports are kept and flushed in order, failures stay", async () => {
  const st = store();
  A.queueReport({ itemId: "a" }, st); A.queueReport({ itemId: "b" }, st);
  assert.equal(A.readQueue(st).length, 2);
  const sent = [];
  const n = await A.flushQueue(async (url, o) => { const p = JSON.parse(o.body); if (p.itemId === "b") throw new Error("down"); sent.push(p.itemId); return { ok: true }; }, st);
  assert.equal(n, 1); assert.deepEqual(sent, ["a"]);
  assert.deepEqual(A.readQueue(st).map((e) => e.payload.itemId), ["b"]);
});

test("send: network failure queues instead of throwing; success does not", async () => {
  const st = store();
  assert.equal(await A.send({ itemId: "x" }, async () => { throw new Error("offline"); }, st), "queued");
  assert.equal(A.readQueue(st).length, 1);
  const st2 = store();
  assert.equal(await A.send({ itemId: "x" }, async () => ({ ok: true }), st2), "sent");
  assert.equal(A.readQueue(st2).length, 0);
});

test("action row: three labelled filled-pill buttons, bookmark state, ID chips", () => {
  const h = A.actionRowHtml({ shareId: "L-KME-CGE-TXS", bookmarked: true, meta: [{ label: "Pearl ID", value: "PN-J3M5" }] });
  assert.match(h, /data-action-report/); assert.match(h, />Report</);
  assert.match(h, /data-act="id-share" data-v="L-KME-CGE-TXS"/); assert.match(h, />Share</);
  assert.match(h, /aria-pressed="true"/); assert.match(h, />Saved</);
  assert.match(h, /data-copy-id="PN-J3M5"/); assert.match(h, /Pearl ID/);
  const p = A.actionRowHtml({ pearl: true, bookmarked: false });
  assert.match(p, /data-pearl-act="report"/); assert.doesNotMatch(p, /data-action-report/, "pearl clicks are owned once");
});

test("sheet: title, seven radios, capped note, send and cancel", () => {
  const h = A.reportSheetHtml(ITEM);
  assert.match(h, /What is wrong\?/);
  assert.equal((h.match(/name="pn-rpt-reason"/g) || []).length, 7);
  assert.match(h, /maxlength="500"/); assert.match(h, /Send report/); assert.match(h, /data-rpt-cancel/);
  assert.match(h, /data-item-id="sbs-descriptive-probability"/); assert.match(h, /role="dialog"/);
});
