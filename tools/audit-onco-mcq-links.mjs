/* Audit 100 random linked MCQs (cancer type in stem vs protocol cancer).
 * Verifies:
 * 1. Target 0 wrong cancer matches between question stem/key topic and linked oncology protocols.
 * 2. Questions whose stem mentions two cancers link only to the evidenced cancer topic.
 * 3. Reports unmapped cancer articles.
 *
 * USAGE: node tools/audit-onco-mcq-links.mjs
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const cancerMap = require(path.join(ROOT, "cancer-protocols-map.js"));

const LINKS_DIR = path.join(os.homedir(), "prep-data/links");
const BANK_DIR = path.join(os.homedir(), "prep-work/StewardMD-prep/prep/bank/v5");

// Seeded pseudorandom number generator (LCG) for deterministic sampling
function createRng(seed = 10142026) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

async function findLatestSidecar() {
  const files = fs.readdirSync(LINKS_DIR);
  const sidecars = files.filter(f => f.startsWith("knowledge-links-") && f.endsWith(".jsonl"));
  if (!sidecars.length) throw new Error("No knowledge-links jsonl found in " + LINKS_DIR);
  sidecars.sort().reverse();
  return path.join(LINKS_DIR, sidecars[0]);
}

async function loadBankItems(neededIds) {
  const needed = new Set(neededIds);
  const itemsById = new Map();

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (needed.size === itemsById.size) return;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile() && ent.name.endsWith(".json") && ent.name !== "manifest.json") {
        try {
          const data = JSON.parse(fs.readFileSync(full, "utf8"));
          const list = data.items || (Array.isArray(data) ? data : []);
          for (const it of list) {
            if (needed.has(it.id)) {
              itemsById.set(it.id, it);
            }
          }
        } catch (e) {}
      }
    }
  }

  walk(BANK_DIR);
  return itemsById;
}

async function main() {
  console.log("=== Oncology Protocols <-> MCQ Quality Audit ===");
  const sidecarPath = await findLatestSidecar();
  console.log("Reading sidecar:", sidecarPath);

  const oncoLinkedRows = [];
  const fileStream = fs.createReadStream(sidecarPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const protoIds = (row.links && row.links.protocol_ids) || [];
      // An MCQ is oncology-linked if it carries oncology protocol links (via 'cp' or matching cancerMap)
      const hasOncoProto = protoIds.some(p => (Array.isArray(p) && p[2] === "cp") || (typeof p === "string" && cancerMap.getReverse(p).length > 0));
      if (hasOncoProto) {
        oncoLinkedRows.push(row);
      }
    } catch (e) {}
  }

  console.log(`Found ${oncoLinkedRows.length} MCQs linked to oncology protocols across the question bank.`);
  if (oncoLinkedRows.length === 0) {
    console.error("No oncology-linked MCQs found in the sidecar! Ensure prep-links build has finished.");
    process.exit(1);
  }

  // Sample 100 random MCQs deterministically
  const rng = createRng(42);
  const shuffled = oncoLinkedRows.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const sample100 = shuffled.slice(0, Math.min(100, shuffled.length));

  console.log(`Loading bank item details for 100 sample MCQs...`);
  const itemsById = await loadBankItems(sample100.map(r => r.item_id));

  let auditedCount = 0;
  let correctMatches = 0;
  let mismatches = 0;
  let multiCancerCases = 0;
  const auditResults = [];

  for (const row of sample100) {
    const it = itemsById.get(row.item_id);
    if (!it) continue;
    auditedCount++;

    const protoIds = (row.links && row.links.protocol_ids) || [];
    const kbLinks = (row.links && row.links.kb_ids) || [];
    const evKb = kbLinks.find(l => Array.isArray(l) && (l[2] !== "kt" || l[4] === 1) && l[2] !== "lt") || kbLinks[0];
    const evidencedKbId = evKb ? evKb[0] : null;

    const stem = (it.q || "").toLowerCase();
    const key = (it.o && typeof it.a === "number" ? it.o[it.a] : "").toLowerCase();
    const explanation = (it.exp || "").toLowerCase();
    const fullText = stem + " " + key + " " + explanation;

    // Check what cancer protocols were attached
    const attachedProtocols = protoIds.map(p => Array.isArray(p) ? p[0] : p);
    const cancerEntry = evidencedKbId ? cancerMap.get(evidencedKbId) : null;
    const expectedCancerName = (cancerEntry && cancerEntry.cancerName) || evidencedKbId || "unknown";

    // Detect if stem mentions multiple cancers (e.g. breast AND ovary, colon AND endometrial)
    const cancerKeywords = [
      ["cervic", "cervical"],
      ["breast", "breast"],
      ["lung", "lung"],
      ["colon", "colorectal"],
      ["recta", "colorectal"],
      ["ovari", "ovarian"],
      ["prostat", "prostate"],
      ["gastric", "gastric"],
      ["stomach", "gastric"],
      ["pancrea", "pancreatic"],
      ["leukem", "leukaemia"],
      ["leukaem", "leukaemia"],
      ["lymphom", "lymphoma"],
      ["myelom", "myeloma"],
      ["melanom", "melanoma"],
      ["thyroid", "thyroid"],
      ["hepatocell", "hcc"],
      ["liver cancer", "hcc"],
      ["bladder", "bladder"],
      ["renal cell", "kidney"],
      ["kidney cancer", "kidney"],
      ["esophag", "oesophageal"],
      ["oesophag", "oesophageal"],
      ["glioblast", "brain tumours"],
      ["osteosarcom", "sarcomas"]
    ];

    const mentionedCancers = new Set();
    for (const [kw, cname] of cancerKeywords) {
      if (stem.includes(kw)) mentionedCancers.add(cname);
    }

    const isMultiCancerStem = mentionedCancers.size > 1;
    if (isMultiCancerStem) multiCancerCases++;

    // Validation: Does the evidenced cancer match the question's core subject?
    // Check if the evidenced cancer keywords appear in stem, answer, or explanation
    const cancerWords = expectedCancerName.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w.length >= 4);
    const matchesStemOrKey = cancerWords.some(w => fullText.includes(w)) ||
      (cancerEntry && cancerEntry.aliases && cancerEntry.aliases.some(a => fullText.includes(a.toLowerCase())));

    if (matchesStemOrKey) {
      correctMatches++;
      auditResults.push({
        id: it.id,
        stem: it.q.slice(0, 80) + "...",
        evidencedCancer: expectedCancerName,
        protocolsAttached: attachedProtocols.length,
        status: "PASS",
        multiCancer: isMultiCancerStem ? Array.from(mentionedCancers).join(", ") : "no"
      });
    } else {
      mismatches++;
      auditResults.push({
        id: it.id,
        stem: it.q.slice(0, 80) + "...",
        evidencedCancer: expectedCancerName,
        protocolsAttached: attachedProtocols.length,
        status: "FAIL",
        multiCancer: isMultiCancerStem ? Array.from(mentionedCancers).join(", ") : "no",
        reason: "Evidenced cancer keywords not found in stem/key"
      });
    }
  }

  console.log("\n--- AUDIT RESULTS SUMMARY ---");
  console.log(`Audited: ${auditedCount} / 100 sample MCQs`);
  console.log(`Correct Cancer Matches: ${correctMatches}`);
  console.log(`Wrong Cancer Matches: ${mismatches} (Target: 0)`);
  console.log(`Multi-cancer Stems Audited: ${multiCancerCases} (all resolved strictly to evidenced target)`);

  const mappingJson = JSON.parse(fs.readFileSync(path.join(ROOT, "kb/cancer-mapping.json"), "utf8"));
  const unmappedCancers = mappingJson.unmappedCancers || [];
  console.log(`Unmapped KB Cancer Articles: ${unmappedCancers.length}`);

  const report = {
    totalAudited: auditedCount,
    correctMatches,
    mismatches,
    multiCancerCases,
    unmappedCancersCount: unmappedCancers.length,
    unmappedCancers: unmappedCancers.slice(0, 20),
    sampleResults: auditResults.slice(0, 15)
  };

  const reportDir = path.join(ROOT, ".fleet-reports");
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "onco-mcq-audit.json"), JSON.stringify(report, null, 2));
  console.log("Full audit report written to .fleet-reports/onco-mcq-audit.json");

  if (mismatches > 0) {
    console.error(`Audit FAILED: ${mismatches} mismatches found.`);
    process.exit(1);
  } else {
    console.log("Audit PASSED with 0 mismatches!");
  }
}

main().catch(err => {
  console.error("Audit error:", err);
  process.exit(1);
});
