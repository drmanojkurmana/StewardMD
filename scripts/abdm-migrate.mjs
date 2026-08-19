#!/usr/bin/env node
// scripts/abdm-migrate.mjs — apply the ABDM schema migration to a D1 database, or to a local SQLite file.
//
// WHY A SCRIPT AND NOT A COMMENT. db/connect_abdm_schema.sql is all CREATE TABLE IF NOT EXISTS, which is
// right for a fresh D1 and does nothing for a provisioned one - SQLite has no ADD-COLUMN-IF-NOT-EXISTS.
// Five "a provisioned D1 needs ALTER TABLE ..." comments had accumulated, and a migration that lives in a
// comment is one somebody forgets. The failure surfaces at runtime, on a patient's record.
//
// The plan comes from functions/_connect/abdm/migrate.js, which is the single declarative source and is
// tested against a real SQLite engine in test/connect/abdm/migration.test.mjs.
//
// ALWAYS DRY-RUN FIRST. Nothing here is destructive (it only ever ADDs), but seeing the plan before
// touching a provisioned database is the cheap habit.
//
// Usage:
//   ./scripts/abdm-migrate.mjs --plan                       # what WOULD change on the remote D1
//   ./scripts/abdm-migrate.mjs --apply                      # apply to the remote D1
//   ./scripts/abdm-migrate.mjs --plan  --local              # against the local wrangler D1
//   ./scripts/abdm-migrate.mjs --apply --sqlite ./x.sqlite  # against a plain SQLite file
//
// The D1 path shells out to `wrangler d1 execute`, so it uses whatever credentials wrangler already has.

import { execFileSync } from "node:child_process";
import { migrateAbdm } from "../functions/_connect/abdm/migrate.js";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const DB = val("--db") || "stewardmd-connect";
const dryRun = has("--plan") || !has("--apply");
const sqlitePath = val("--sqlite");
const local = has("--local");

function d1Io() {
  const base = ["d1", "execute", DB, local ? "--local" : "--remote", "--json"];
  const run = (sql) => {
    const out = execFileSync("npx", ["wrangler", ...base, "--command", sql], {
      encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    });
    // wrangler prints a banner before the JSON; take from the first bracket.
    const i = out.search(/[[{]/);
    if (i < 0) return [];
    const parsed = JSON.parse(out.slice(i));
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    return (first && first.results) || [];
  };
  return { all: async (sql) => run(sql), exec: async (sql) => { run(sql); } };
}

async function sqliteIo(path) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path);
  return { all: async (sql) => db.prepare(sql).all(), exec: async (sql) => { db.exec(sql); } };
}

const io = sqlitePath ? await sqliteIo(sqlitePath) : d1Io();
const target = sqlitePath ? sqlitePath : `D1 "${DB}" (${local ? "local" : "REMOTE"})`;

console.log(`${dryRun ? "PLAN (nothing will be changed)" : "APPLYING"} -> ${target}\n`);
let out;
try {
  out = await migrateAbdm(io, { dryRun });
} catch (e) {
  console.error("migration failed:", e && e.message);
  process.exit(1);
}

const show = (label, list) => {
  if (!list.length) return;
  console.log(label);
  for (const x of list) console.log("  " + x);
};
show(dryRun ? "tables that WOULD be created:" : "tables created:", out.tablesCreated);
show(dryRun ? "columns that WOULD be added:" : "columns added:", out.columnsAdded);

const blocked = out.skipped.filter((s) => s.startsWith("missing-base-table:"));
if (blocked.length) {
  console.log("\nBLOCKED - the base schema has never been applied to this database:");
  for (const b of blocked) console.log("  " + b.split(":")[1]);
  console.log("\nApply db/connect_abdm_schema.sql first; it owns the base shape, and inventing it here");
  console.log("would give you two sources of truth for the same tables.");
  process.exit(2);
}

if (!out.tablesCreated.length && !out.columnsAdded.length) console.log("nothing to do: the schema is current.");
else if (dryRun) console.log("\nre-run with --apply to make these changes.");
else console.log("\ndone.");
