import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import * as StatsAPI from "../functions/api/prep/stats.js";
import * as FlagAPI from "../functions/api/prep/flag.js";
import * as ItemStats from "../tools/prep-item-stats.mjs";
import * as Quality from "../tools/prep-quality.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("stats API: clean drops PII and invalid fields, de-duplicates items", () => {
  const payload = {
    v: 1,
    exam: "neet-pg",
    type: "grand",
    user_id: "secret-student-123",
    email: "student@example.com",
    device_id: "device-xyz",
    items: [
      ["item-1", 1, 45, 1],
      ["item-1", 0, 10, 0], // duplicate in same payload -> dropped
      ["item-2", null, 5, -1], // blank / omitted
      ["item-3", 1, 3601, 2], // seconds > 3600 -> dropped
      ["item-4", 1, 15, 4], // option 4 out of range -> dropped
      ["item-5", null, 10, 2], // blank with non-(-1) option -> dropped
      ["invalid item id with spaces!", 1, 10, 0] // invalid id -> dropped
    ]
  };

  const cleaned = StatsAPI.clean(payload);
  assert.ok(cleaned);
  assert.equal(cleaned.exam, "neet-pg");
  // Only valid, de-duplicated rows survive
  assert.deepEqual(cleaned.rows, [
    ["item-1", 1, 45, 1],
    ["item-2", null, 5, -1]
  ]);
  // No user_id or device_id survives
  assert.equal(cleaned.user_id, undefined);
  assert.equal(cleaned.email, undefined);
  assert.equal(cleaned.device_id, undefined);
});

test("stats API: POST stores aggregates to D1 and preserves privacy", async () => {
  const binds = [];
  const mockDb = {
    prepare: (sql) => ({
      bind: (...args) => {
        binds.push(args);
        return args;
      }
    }),
    batch: async (stmts) => stmts
  };

  const req = {
    request: {
      json: async () => ({
        v: 1,
        exam: "ini-cet",
        items: [
          ["q-101", 1, 25, 0],
          ["q-102", 0, 40, 2]
        ]
      })
    },
    env: { PREP_STATS_DB: mockDb }
  };

  const res = await StatsAPI.onRequestPost(req);
  assert.equal(res.status, 202);
  const data = await res.json();
  assert.equal(data.accepted, 2);
  assert.equal(data.stored, true);

  assert.equal(binds.length, 2);
  // Row 1: correct answer
  assert.equal(binds[0][0], "q-101");
  assert.equal(binds[0][1], "ini-cet");
  assert.equal(binds[0][2], 1); // right = 1
  assert.equal(binds[0][3], 0); // blank = 0
  assert.equal(binds[0][4], 25); // secs = 25
  assert.equal(binds[0][5], 1); // o0 = 1

  // Row 2: wrong answer
  assert.equal(binds[1][0], "q-102");
  assert.equal(binds[1][2], 0); // right = 0
  assert.equal(binds[1][3], 0); // blank = 0
  assert.equal(binds[1][4], 40); // secs = 40
  assert.equal(binds[1][7], 1); // o2 = 1
});

test("stats API: POST stores to KV when D1 binding is absent", async () => {
  const kvStore = new Map();
  const mockKv = {
    get: async (k) => kvStore.get(k) || null,
    put: async (k, v) => kvStore.set(k, v)
  };

  const req = {
    request: {
      json: async () => ({
        v: 1,
        exam: "fmge",
        items: [
          ["kv-1", 1, 20, 2],
          ["kv-1", 0, 15, 1] // wait, clean() will drop 2nd identical in one payload
        ]
      })
    },
    env: { UPDATES_KV: mockKv }
  };

  const res = await StatsAPI.onRequestPost(req);
  assert.equal(res.status, 202);
  const data = await res.json();
  assert.equal(data.stored, true);

  const stored = JSON.parse(kvStore.get("prep:stats:kv-1"));
  assert.ok(stored);
  assert.equal(stored.n, 1);
  assert.equal(stored.right, 1);
  assert.equal(stored.secs, 20);
  assert.equal(stored.o2, 1);
});

test("stats API: GET endpoint returns formatted aggregates with sample sizes and is owner-gated", async () => {
  const mockDb = {
    prepare: (sql) => ({
      bind: (id) => ({
        first: async () => {
          if (id === "item-agg-1") {
            return {
              item_id: "item-agg-1",
              exam: "neet-pg",
              n: 150,
              right: 120,
              blank: 6,
              secs: 4500,
              o0: 10,
              o1: 120,
              o2: 12,
              o3: 2,
              updated: "2026-10-12"
            };
          }
          return null;
        }
      })
    })
  };

  // Unauthorized access (not owner, no snapshot) -> 403
  const unauthReq = {
    request: { url: "https://stewardmd.in/api/prep/stats?item_id=item-agg-1", headers: new Headers() },
    env: { PREP_STATS_DB: mockDb }
  };
  const unauthRes = await StatsAPI.onRequestGet(unauthReq);
  assert.equal(unauthRes.status, 403);

  // Snapshot access -> permitted
  const snapReq = {
    request: { url: "https://stewardmd.in/api/prep/stats?item_id=item-agg-1&snapshot=1", headers: new Headers() },
    env: { PREP_STATS_DB: mockDb }
  };
  const res = await StatsAPI.onRequestGet(snapReq);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.item_id, "item-agg-1");
  assert.equal(json.sample_size, 150);
  assert.equal(json.exposures, 150);
  assert.equal(json.correct, 120);
  assert.equal(json.wrong, 24); // 150 - 120 - 6
  assert.equal(json.omitted, 6);
  assert.equal(json.p_value, 0.8);
  assert.equal(json.avg_secs, 30.0);
  assert.equal(json.omission_rate, 0.04);
});

test("stats tool: n < 100 yields 'not enough data'; n >= 100 computes difficulty and discrimination", () => {
  // Low sample size: n = 40 (< 100)
  const lowSampleStat = {
    item_id: "item-low",
    n: 40,
    right: 30,
    blank: 2,
    secs: 800,
    o0: 5,
    o1: 30,
    o2: 3,
    o3: 0,
    upper_right: 18,
    lower_right: 12
  };
  const lowResult = ItemStats.analyzeItem(lowSampleStat, { key: 1 });
  assert.equal(lowResult.difficulty, "not enough data");
  assert.equal(lowResult.discrimination, null);
  assert.equal(lowResult.discrimination_status, "not enough data");
  assert.equal(lowResult.flags.length, 0); // No flags triggered when n < 100

  // High sample size: n = 200 (>= 100)
  const highSampleStat = {
    item_id: "item-high",
    n: 200,
    right: 170,
    blank: 6,
    secs: 5000,
    o0: 10,
    o1: 170,
    o2: 10,
    o3: 4,
    upper_right: 95,
    lower_right: 75,
    upper_n: 100,
    lower_n: 100
  };
  const highResult = ItemStats.analyzeItem(highSampleStat, { key: 1 });
  assert.equal(highResult.difficulty, "Easy"); // p = 170/200 = 0.85 >= 0.8
  assert.equal(highResult.p_value, 0.85);
  assert.equal(highResult.discrimination, 0.2); // (95/100 - 75/100)
  assert.equal(highResult.discrimination_status, "computed");
});

test("stats tool: flags items with suspect keys, high omission, or abnormal response times", () => {
  // Suspect key: official key is 0 (A), but 60% of students chose 2 (C) with n = 150
  const suspectKeyStat = {
    item_id: "item-suspect-key",
    n: 150,
    right: 30, // option A
    blank: 0,
    secs: 4500,
    o0: 30, // 20%
    o1: 15,
    o2: 95, // 63.3% chose option C
    o3: 10
  };
  const suspectRes = ItemStats.analyzeItem(suspectKeyStat, { key: 0 });
  assert.ok(suspectRes.flags.some((f) => f.type === "wrong_key_suspect"));
  assert.match(suspectRes.flags[0].reason, /statistically suspect key: option C chosen by 63% vs key A/);

  // High omission rate: 35% omitted with n = 120
  const highOmitStat = {
    item_id: "item-omit",
    n: 120,
    right: 50,
    blank: 42, // 35%
    secs: 3600,
    o0: 50,
    o1: 15,
    o2: 8,
    o3: 5
  };
  const omitRes = ItemStats.analyzeItem(highOmitStat, { key: 0 });
  assert.ok(omitRes.flags.some((f) => f.type === "high_omission"));
  assert.match(omitRes.flags[0].reason, /high omission rate: 35% omitted/);

  // Abnormally fast time: average 3.2s with n = 100
  const fastStat = {
    item_id: "item-fast",
    n: 100,
    right: 80,
    blank: 0,
    secs: 320, // 3.2s avg
    o0: 80,
    o1: 10,
    o2: 5,
    o3: 5
  };
  const fastRes = ItemStats.analyzeItem(fastStat, { key: 0 });
  assert.ok(fastRes.flags.some((f) => f.type === "abnormal_time_fast"));
  assert.match(fastRes.flags[0].reason, /abnormally fast average response time/);
});

test("stats tool: writing flags sets requires_review with append-only history and never edits keys", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quality-stats-test-"));
  try {
    const existingRec = {
      item_id: "item-to-flag",
      bank: "medmcqa",
      bank_version: "v1",
      status: "approved",
      status_changed_at: "2026-10-10T00:00:00.000Z",
      key: { value: 0, confidence: "verified_human" },
      history: [{ at: "2026-10-10T00:00:00.000Z", by: "owner:reviewer", action: "status_change", reason: "approved by qualified reviewer" }]
    };

    Quality.writeSidecar(tmp, "v1", new Map([["anatomy", [existingRec]]]));

    const loaded = Quality.loadSidecar(tmp);

    const flaggedAnalysis = [{
      item_id: "item-to-flag",
      flags: [{
        type: "wrong_key_suspect",
        reason: "statistically suspect key: option C chosen by 65% vs key A (20%) with n=120"
      }]
    }];

    const result = ItemStats.applyStatsFlags(loaded, flaggedAnalysis, { at: "2026-10-12T12:00:00.000Z" });
    assert.equal(result.flagged_items, 1);
    assert.equal(result.entries_added, 1);

    const updated = loaded.ids.get("item-to-flag").rec;
    // Status transitioned to requires_review
    assert.equal(updated.status, "requires_review");
    assert.equal(updated.status_changed_at, "2026-10-12T12:00:00.000Z");

    // History is append-only: original entry preserved
    assert.equal(updated.history.length, 2);
    assert.equal(updated.history[0].action, "status_change");
    assert.equal(updated.history[1].action, "flagged");
    assert.equal(updated.history[1].by, "prep-item-stats");
    assert.equal(updated.history[1].source, "item statistics");

    // The answer key is NEVER rewritten automatically
    assert.deepEqual(updated.key, { value: 0, confidence: "verified_human" });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("stats tool: blueprint and learning objective coverage computes denominators correctly", () => {
  const mockProfiles = {
    "neet-pg": {
      name: "NEET-PG",
      format: { questions: 200 },
      blueprint: {
        kind: "official_counts",
        subjects: {
          anatomy: 15,
          physiology: 15,
          biochemistry: 15
        }
      }
    }
  };

  const mockBankItems = [
    { id: "1", subject: "anatomy", module: "upper-limb", lo: "brachial-plexus" },
    { id: "2", subject: "anatomy", module: "upper-limb", lo: "brachial-plexus" },
    { id: "3", subject: "anatomy", module: "lower-limb", lo: "femoral-triangle" },
    { id: "4", subject: "physiology", module: "cvs", lo: "cardiac-cycle" }
  ];

  const cov = ItemStats.computeCoverage(mockProfiles, mockBankItems);
  assert.equal(cov.total_bank_items, 4);
  assert.equal(cov.total_modules, 3);

  const neet = cov.exams["neet-pg"];
  assert.ok(neet);
  const anat = neet.subjects.find((s) => s.subject === "anatomy");
  assert.equal(anat.target_questions, 15);
  assert.equal(anat.actual_questions, 3);
  assert.equal(anat.shortfall, 12);
  assert.equal(anat.objectives_count, 2); // brachial-plexus, femoral-triangle

  const md = ItemStats.generateReportMarkdown(cov, []);
  assert.match(md, /Metric Definitions & Sample Size Rules/);
  assert.match(md, /Sample Size \(\$n\$\)/);
  assert.match(md, /Difficulty \(\$p\$-value\)/);
  assert.match(md, /Discrimination \(\$D\$ \/ \$r_\{pbis\}\$\)/);
});

test("flag API: reaching HIDE_AT writes quality history entry and sets requires_review", async () => {
  globalThis.__SMD_TEST_TRUST_CF_ACCESS_HEADER = true;
  const kvStore = new Map();
  const mockKv = {
    get: async (k) => kvStore.get(k) || null,
    put: async (k, v) => kvStore.set(k, v)
  };

  // 3 separate student reports -> reaches HIDE_AT (3)
  for (let reporter = 1; reporter <= 3; reporter++) {
    const res = await FlagAPI.onRequestPost({
      request: {
        headers: new Headers({
          "Cf-Access-Authenticated-User-Email": `student${reporter}@stewardmd.in`
        }),
        json: async () => ({
          itemId: "flag-target-item",
          subject: "pharmacology",
          module: "antibiotics",
          reason: "wrong-key"
        })
      },
      env: {
        MAIK_KV: mockKv
      }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.counted, true);
  }

  // 1. Verify flag record reached HIDE_AT (3)
  const key = "prep:flag:flag-target-item";
  const rec = JSON.parse(kvStore.get(key) || "{}");
  assert.equal(rec.n, 3);
  assert.equal(rec.reasons["wrong-key"], 3);

  // 2. Verify prep:hidden has the item
  const hid = JSON.parse(kvStore.get("prep:hidden") || "{}");
  assert.ok(hid["flag-target-item"]);

  // 3. Verify quality history entry was written and status set to requires_review
  const qKey = "prep:quality:flag-target-item";
  const qRec = JSON.parse(kvStore.get(qKey) || "null");
  assert.ok(qRec, "quality record must be written in KV");
  assert.equal(qRec.item_id, "flag-target-item");
  assert.equal(qRec.status, "requires_review");
  assert.equal(qRec.subject, "pharmacology");
  assert.equal(qRec.module, "antibiotics");
  assert.ok(qRec.status_changed_at);
  assert.equal(qRec.history.length, 1);
  assert.equal(qRec.history[0].action, "flagged");
  assert.equal(qRec.history[0].by, "prep-flag");
  assert.equal(qRec.history[0].source, "student report");
  assert.match(qRec.history[0].reason, /3 separate student reports \(wrong-keyx3\)/);
});
