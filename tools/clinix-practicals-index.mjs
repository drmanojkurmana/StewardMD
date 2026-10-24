#!/usr/bin/env node
/* tools/clinix-practicals-index.mjs
 * Indexes all CliniX practicals decks into clinix/practicals/index.json deterministically.
 * Usage: node tools/clinix-practicals-index.mjs [--check] [--dir <practicalsDir>] [--out <outputFile>]
 * Exit 0 on success, exit 1 on error or check mismatch.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const DEFAULT_DIR = join(ROOT, "clinix/practicals");
const DEFAULT_OUT = join(ROOT, "clinix/practicals/index.json");

export function buildPracticalsIndex(practicalsDir = DEFAULT_DIR) {
  const subjects = readdirSync(practicalsDir)
    .filter((f) => {
      const p = join(practicalsDir, f);
      return statSync(p).isDirectory();
    })
    .sort();

  const decks = [];

  for (const subject of subjects) {
    const subDir = join(practicalsDir, subject);
    const files = readdirSync(subDir)
      .filter((f) => f.endsWith(".json") && f !== "index.json")
      .sort();

    for (const f of files) {
      const filePath = join(subDir, f);
      const raw = readFileSync(filePath, "utf8");
      let d;
      try {
        d = JSON.parse(raw);
      } catch (err) {
        throw new Error(`Failed to parse ${filePath}: ${err.message}`);
      }

      if (d.v !== 1 || !d.subject || !d.section || !d.title) {
        throw new Error(`Deck ${filePath} missing required schema fields (v: 1, subject, section, title)`);
      }

      const kindsSet = new Set();
      const items = Array.isArray(d.items) ? d.items : [];
      for (const item of items) {
        if (item.kind) kindsSet.add(item.kind);
      }
      const kinds = Array.from(kindsSet).sort();

      decks.push({
        subject: d.subject,
        section: d.section,
        title: d.title,
        intro: d.intro || { en: "" },
        itemCount: items.length,
        kinds: kinds,
        file: `practicals/${d.subject}/${d.section}.json`
      });
    }
  }

  // Sort decks deterministically by subject, then section
  decks.sort((a, b) => {
    if (a.subject !== b.subject) return a.subject.localeCompare(b.subject);
    return a.section.localeCompare(b.section);
  });

  return {
    v: 1,
    decks: decks
  };
}

function main() {
  const args = process.argv.slice(2);
  let check = false;
  let dir = DEFAULT_DIR;
  let out = DEFAULT_OUT;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--check") check = true;
    else if (args[i] === "--dir" && args[i + 1]) dir = resolve(args[++i]);
    else if (args[i] === "--out" && args[i + 1]) out = resolve(args[++i]);
  }

  const indexData = buildPracticalsIndex(dir);
  const json = JSON.stringify(indexData, null, 2) + "\n";

  if (check) {
    let existing = "";
    try {
      existing = readFileSync(out, "utf8");
    } catch (e) {
      console.error(`Check failed: ${out} does not exist.`);
      process.exit(1);
    }
    if (existing !== json) {
      console.error(`Check failed: ${out} does not match computed index.`);
      process.exit(1);
    }
    console.log(`Practicals index up to date (${indexData.decks.length} decks).`);
    process.exit(0);
  }

  writeFileSync(out, json, "utf8");
  console.log(`Wrote practicals index with ${indexData.decks.length} decks to ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
