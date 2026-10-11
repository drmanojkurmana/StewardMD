#!/usr/bin/env node
// tools/prep-imgclassify.mjs - Cheap vision classifier for candidate images using claude-haiku-5-5.
// Evaluates:
//   - Subject (Pathology, Anatomy, Surgery) & specific topic
//   - Image type (histology, gross specimen, cytology, dissection, cross-section, illustration, intraoperative, instrument)
//   - Patient de-identification: identifiable faces, eyes, tattoos, names, hospital marks (hard reject)
//   - Burned-in text: checks if text directly names the answer on the image
//   - Quality & teachability (1-5 scale)
//   - Caption authority: confirms caption unambiguously supplies the ground-truth diagnosis/structure
//
// Key: ~/.config/stewardmd/anthropic.env (never printed or exposed)
// Logs: ~/prep-data/assessment/spend-ledger.tsv

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(os.homedir(), "prep-data", "assessment", "images");

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i < 0 ? d : argv[i + 1]; };
const LEDGER = opt("ledger", path.join(os.homedir(), "prep-data", "assessment", "spend-ledger.tsv"));
const POOL_FILE = opt("pool", path.join(DATA_DIR, "pool.jsonl"));
const OUT_FILE = opt("out", path.join(DATA_DIR, "classified.jsonl"));
const LIMIT = Number(opt("limit", 0)) || 0;
const CONCURRENCY = Number(opt("concurrency", 5)) || 5;
const MODEL = "claude-haiku-5-5";

const PRICES = {
  "claude-haiku-5-5": { in: 0.10, out: 0.50, batch_in: 0.05, batch_out: 0.25 },
  "claude-sonnet-5-5": { in: 2.00, out: 10.00, batch_in: 1.00, batch_out: 5.00 },
};

export function loadEnv() {
  const f = path.join(os.homedir(), ".config", "stewardmd", "anthropic.env");
  if (!fs.existsSync(f)) throw new Error("anthropic.env missing");
  const env = {};
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && (m[1] === "ANTHROPIC_API_KEY" || m[1] === "ANTHROPIC_WORKSPACE_ID")) env[m[1]] = m[2];
  }
  if (!env.ANTHROPIC_API_KEY) throw new Error("No ANTHROPIC_API_KEY in env file");
  return env;
}

export function logLedger(job, model, usage, costUsd, note) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const row = [
    dateStr,
    job,
    model,
    usage.input_tokens || 0,
    usage.output_tokens || 0,
    costUsd.toFixed(4),
    note
  ].join("\t");
  fs.appendFileSync(LEDGER, row + "\n");
}

export const CLASSIFY_SYSTEM_PROMPT = `You are a medical school professor and board exam question reviewer for NEET-PG, INI-CET, and USMLE.
Analyze the provided medical image and its source caption/metadata.
Evaluate clinical validity, board teachability, de-identification compliance, and image clarity.

Strict Rules:
1. Patient De-Identification: If ANY human face, recognizable eyes/nose/mouth, patient name, medical record number, birth date, hospital name, or identifiable personal feature is visible, flag is_clinical_photo_with_identifiable_person: true and keep: false.
2. Authority Rule: The caption/source text MUST establish an authoritative diagnosis, pathological condition, anatomical structure, or surgical entity. If the caption is vague, ambiguous, or lacks a definitive diagnosis, keep: false.
3. Burned-In Text: If the image has text printed directly on it that explicitly states the diagnosis/answer (e.g., "Glioblastoma Multiforme"), flag burned_in_text_reveals_diagnosis: true and keep: false. Minor stain labels (e.g. "H&E", "PAS"), magnification ("40x", "100 um"), or anatomical letter markers ("A", "B", "arrow") are acceptable if they do not spell out the final diagnosis.
4. Quality & Teachability: Rate teachability 1 to 5. 5 = classic board hallmark, 4 = very good, 3 = acceptable, 1-2 = poor/obscure. Only keep images with teachability >= 3 and quality in ["high", "medium"].

Output valid JSON only matching this schema:
{
  "subject": "pathology" | "anatomy" | "surgery" | "other",
  "topic": string (e.g. "burkitt-lymphoma", "celiac-trunk", "laparoscopic-cholecystectomy"),
  "image_type": "histology" | "gross_pathology" | "cytology" | "ihc" | "dissection" | "illustration" | "cross_section" | "intraoperative" | "specimen" | "instrument" | "other",
  "is_clinical_photo_with_identifiable_person": boolean,
  "burned_in_text": string[],
  "burned_in_text_reveals_diagnosis": boolean,
  "quality": "high" | "medium" | "low",
  "caption_states_specific_diagnosis_or_structure": boolean,
  "authoritative_answer": string (exact diagnosis or structure from caption),
  "teachability": number (1-5),
  "keep": boolean,
  "rejection_reason": string | null
}`;

async function callClaudeVision(env, imageBase64, mediaType, promptText) {
  const body = {
    model: MODEL,
    max_tokens: 2500,
    thinking: { type: "disabled" },
    system: CLASSIFY_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: imageBase64
            }
          },
          {
            type: "text",
            text: promptText
          }
        ]
      }
    ]
  };

  const headers = {
    "content-type": "application/json",
    "x-api-key": env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01"
  };
  if (env.ANTHROPIC_WORKSPACE_ID) {
    headers["anthropic-workspace-id"] = env.ANTHROPIC_WORKSPACE_ID;
  }

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000)
      });

      if (!res.ok) {
        const errText = await res.text();
        if ((res.status === 429 || res.status >= 500) && attempt < 4) {
          const delay = attempt * 2000;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Anthropic HTTP ${res.status}: ${errText.slice(0, 300)}`);
      }

      return await res.json();
    } catch (e) {
      if (attempt < 4 && !String(e.message).includes("HTTP 40")) {
        await new Promise((r) => setTimeout(r, attempt * 2000));
        continue;
      }
      throw e;
    }
  }
}

async function main() {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Usage: node tools/prep-imgclassify.mjs [--limit N] [--concurrency N] [--pool F] [--out F] [--ledger F]");
    console.log("Classifies pool images with Haiku vision. Resumable: skips ids already in out file. Limit 0 = all remaining.");
    return;
  }
  console.log("=== PrepNucleus Image Classifier (Claude Haiku 5.5 Vision) ===");
  const env = loadEnv();

  if (!fs.existsSync(POOL_FILE)) {
    console.error("Pool file not found:", POOL_FILE);
    process.exit(1);
  }

  const pool = fs.readFileSync(POOL_FILE, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  console.log(`Loaded ${pool.length} candidate images from pool.`);

  const classifiedDone = new Map();
  if (fs.existsSync(OUT_FILE)) {
    const lines = fs.readFileSync(OUT_FILE, "utf8").trim().split("\n").filter(Boolean);
    for (const l of lines) {
      try {
        const item = JSON.parse(l);
        classifiedDone.set(item.id, item);
      } catch {}
    }
  }
  console.log(`Already classified: ${classifiedDone.size}`);

  const todo = pool.filter((it) => !classifiedDone.has(it.id));
  const work = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
  console.log(`To classify: ${work.length} items (concurrency: ${CONCURRENCY})`);

  let completed = 0, kept = 0, rejected = 0;
  let totalInputTokens = 0, totalOutputTokens = 0;

  async function worker(item) {
    if (!fs.existsSync(item.filePath)) {
      console.warn("File missing:", item.filePath);
      return;
    }

    const imgBuf = fs.readFileSync(item.filePath);
    const b64 = imgBuf.toString("base64");
    const mediaType = "image/webp";

    const promptText = `Source Metadata:
Title: ${item.title}
Subject Hint: ${item.subject}
Author: ${item.author}
Licence: ${item.licence}
Caption: ${item.caption}

Classify this image and source caption according to the instructions and return the JSON object.`;

    try {
      const resp = await callClaudeVision(env, b64, mediaType, promptText);
      const textBlock = (resp.content || []).filter(b => b.type === "text").pop();
      const text = textBlock ? textBlock.text : "{}";
      const mMatch = text.match(/\{[\s\S]*\}/);
      if (!mMatch) {
        console.warn(`[Skip] No JSON found for ${item.id}`);
        return;
      }
      const parsed = JSON.parse(mMatch[0]);

      const usage = resp.usage || { input_tokens: 0, output_tokens: 0 };
      totalInputTokens += usage.input_tokens || 0;
      totalOutputTokens += usage.output_tokens || 0;

      const record = {
        id: item.id,
        file: item.file,
        filePath: item.filePath,
        sha256: item.sha256,
        sha12: item.sha12,
        title: item.title,
        source: item.source,
        sourceUrl: item.sourceUrl,
        author: item.author,
        licence: item.licence,
        licenceStandard: item.licenceStandard,
        licenceUrl: item.licenceUrl,
        shareAlike: item.shareAlike,
        caption: item.caption,
        classification: parsed,
        keep: !!parsed.keep,
        subject: parsed.subject || item.subject,
        teachability: parsed.teachability || 0,
        authoritativeAnswer: parsed.authoritative_answer || ""
      };

      fs.appendFileSync(OUT_FILE, JSON.stringify(record) + "\n");
      classifiedDone.set(record.id, record);
      completed++;
      if (record.keep) kept++; else rejected++;

      if (completed % 10 === 0 || completed === work.length) {
        console.log(`[Classify] ${completed}/${work.length} | Kept: ${kept} | Rejected: ${rejected}`);
      }
    } catch (e) {
      console.error(`Error classifying ${item.id}:`, e.message);
    }
  }

  // Pool execution
  let idx = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (idx < work.length) {
        const item = work[idx++];
        await worker(item);
      }
    })
  );

  const priceIn = PRICES[MODEL].in / 1e6;
  const priceOut = PRICES[MODEL].out / 1e6;
  const cost = (totalInputTokens * priceIn) + (totalOutputTokens * priceOut);

  logLedger(
    "classify-images-haiku",
    MODEL,
    { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
    cost,
    `Classified ${completed} images; kept ${kept}, rejected ${rejected}`
  );

  console.log(`\n=== Classification Completed ===`);
  console.log(`Total: ${completed} | Kept: ${kept} | Rejected: ${rejected}`);
  console.log(`Tokens: in=${totalInputTokens}, out=${totalOutputTokens} | Cost: $${cost.toFixed(4)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  });
}
