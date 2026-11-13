#!/usr/bin/env node
/* tools/watermark-trace.mjs — forensics for PrepNucleus per-user bank watermarks (owner 2026-11-13).
 *
 * Given leaked text (file or stdin) and optionally the bank file key, extract zero-width marks and the
 * whitespace variant bit, then list matching user ids by recomputing HMAC over candidates.
 *
 * Usage:
 *   node tools/watermark-trace.mjs --text leaked.txt --file-key v5/medicine/mcq/med-aml.json --ids ids.txt
 *   cat leaked.txt | node tools/watermark-trace.mjs --file-key v5/medicine/mcq/med-aml.json --ids ids.txt
 *   node tools/watermark-trace.mjs --text leaked.txt --file-key ... --ids ids.txt --secret-env WATERMARK_SECRET
 *
 * Candidate ids: one per line in --ids (full identify() ids like fb:<uid>, or raw Firebase uids — both tried).
 * Optional --firebase: page Identity Toolkit accounts (read-only) when Firebase admin env is configured.
 *
 * Never prints the secret. Exit 0 always when the tool runs; match count is in the JSON summary.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractMarks,
  bitsToHex40,
  detectVariantBit,
  matchCandidates,
  hmacMarkMaterial,
  stripWatermarkMarks,
} from "../functions/_prep_watermark.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  return `Usage: node tools/watermark-trace.mjs --text <file|-> --file-key <bank/path.json> --ids <file> [--secret-env WATERMARK_SECRET] [--firebase]

  --text       leaked text file, or "-" for stdin (default "-")
  --file-key   bank path as served (e.g. v5/medicine/mcq/med-aml.json); required to match users
  --ids        candidate user ids, one per line (fb:<uid> or raw uid)
  --secret-env env var holding WATERMARK_SECRET (default WATERMARK_SECRET)
  --firebase   also load candidate uids from Firebase Identity Toolkit (read-only listUsersPage)
  --json       print machine-readable JSON only
`;
}

function parseArgs(argv) {
  const o = { text: "-", fileKey: "", ids: "", secretEnv: "WATERMARK_SECRET", firebase: false, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { help: true };
    if (a === "--text") o.text = argv[++i] || "";
    else if (a === "--file-key") o.fileKey = argv[++i] || "";
    else if (a === "--ids") o.ids = argv[++i] || "";
    else if (a === "--secret-env") o.secretEnv = argv[++i] || "WATERMARK_SECRET";
    else if (a === "--firebase") o.firebase = true;
    else if (a === "--json") o.json = true;
    else if (a === "--") break;
    else return { error: "unknown arg: " + a };
  }
  return o;
}

function readText(spec) {
  if (!spec || spec === "-") return fs.readFileSync(0, "utf8");
  return fs.readFileSync(spec, "utf8");
}

function readIds(file) {
  if (!file) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

function expandIds(ids) {
  /* Try both fb:<uid> and raw uid forms used by identify(). */
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const forms = [id];
    if (id.startsWith("fb:")) forms.push(id.slice(3));
    else forms.push("fb:" + id);
    for (const f of forms) {
      if (!seen.has(f)) { seen.add(f); out.push(f); }
    }
  }
  return out;
}

async function loadFirebaseIds() {
  /* Read-only: listUsersPage from _fbadmin. Needs the same Firebase admin env as other owner tools. */
  const env = { ...process.env };
  if (!env.FIREBASE_PROJECT_ID && !env.FB_SERVICE_ACCOUNT && !env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error("firebase: set FIREBASE_PROJECT_ID and service-account env (same as other owner tools)");
  }
  const { listUsersPage } = await import("../functions/_fbadmin.js");
  const ids = [];
  let pageToken = null;
  do {
    const page = await listUsersPage(env, pageToken, 1000);
    for (const u of page.users || []) {
      if (u.uid) ids.push("fb:" + u.uid);
    }
    pageToken = page.nextPageToken || null;
  } while (pageToken);
  return ids;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { process.stdout.write(usage()); return; }
  if (args.error) { process.stderr.write(args.error + "\n" + usage()); process.exit(2); }

  const secret = process.env[args.secretEnv] || "";
  if (!secret) {
    process.stderr.write("Missing secret in env $" + args.secretEnv + " (never pass the secret on the CLI).\n");
    process.exit(2);
  }
  if (!args.fileKey) {
    process.stderr.write("--file-key is required to match candidates.\n" + usage());
    process.exit(2);
  }

  const leaked = readText(args.text);
  const marks = extractMarks(leaked);
  const variant = detectVariantBit(leaked);
  const markHexes = marks.map(bitsToHex40);

  let candidates = expandIds(readIds(args.ids));
  if (args.firebase) {
    const fb = await loadFirebaseIds();
    candidates = expandIds(candidates.concat(fb));
  }
  if (!candidates.length) {
    process.stderr.write("No candidate ids. Pass --ids <file> and/or --firebase.\n");
    process.exit(2);
  }

  const hits = await matchCandidates(marks, candidates, args.fileKey, secret);

  /* Optional variant filter: when variant bit is detectable, drop candidates whose HMAC variant disagrees. */
  let filtered = hits;
  if (variant != null && hits.length) {
    const kept = [];
    for (const id of hits) {
      const { variantBit } = await hmacMarkMaterial(secret, id, args.fileKey);
      if (variantBit === variant) kept.push(id);
    }
    if (kept.length) filtered = kept;
  }

  const summary = {
    fileKey: args.fileKey,
    marksFound: marks.length,
    markHex: markHexes,
    variantBit: variant,
    candidatesChecked: candidates.length,
    matches: filtered,
    plainLength: stripWatermarkMarks(leaked).length,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return;
  }

  process.stdout.write("Watermark trace\n");
  process.stdout.write("  file key:     " + summary.fileKey + "\n");
  process.stdout.write("  marks found:  " + summary.marksFound + (markHexes.length ? " (" + markHexes.join(", ") + ")" : "") + "\n");
  process.stdout.write("  variant bit:  " + (variant == null ? "(not detected)" : String(variant)) + "\n");
  process.stdout.write("  candidates:   " + summary.candidatesChecked + "\n");
  if (!filtered.length) {
    process.stdout.write("  matches:      (none)\n");
  } else {
    process.stdout.write("  matches:\n");
    for (const id of filtered) process.stdout.write("    - " + id + "\n");
  }
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack || e) + "\n");
  process.exit(1);
});
