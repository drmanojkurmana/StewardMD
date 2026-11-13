// Today in Medical History pictures: from data/history/image-subjects.txt (one hand-picked subject per day)
// writes, under data/history/gemini/:
//   1-START-HERE.md       the instruction to paste into Gemini once (style, rules, how to reply)
//   batches.md            37 messages of 10 days each, to paste one after another
//   image-prompts.csv     the same 366 rows as a table (file name, event, full prompt)
// Images come back as PNG/JPG; scripts/history/import-images.sh converts them to data/history/img/<id>.webp.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "data/history/gemini");
const PER = 10;

export const STYLE =
  "Holographic medical illustration: glowing translucent line art, like an X-ray hologram. " +
  "Thin luminous mint and cyan lines (#8FF0D2, #5EEAD4) with a soft inner glow, subtle 3D depth and fine wireframe detail. " +
  "Exactly ONE small warm amber-orange highlight (#FF9A3D) with a soft bloom, on the point named in the subject. " +
  "PURE BLACK background (#000000): no gradient, no vignette, no floor, no frame, no stars, no particles. " +
  "One subject, centred slightly right, filling about 70% of the frame, black space all around it. " +
  "No text, letters, labels, numbers, logos or watermark anywhere. " +
  "No human faces and no portraits of real people. " +
  "Elegant, premium, clinical and anatomically correct; not cartoonish, not photographic. Landscape 4:3.";

export function subjects() {
  return readFileSync(join(ROOT, "data/history/image-subjects.txt"), "utf8").split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const [key, y, subject] = l.split("|"); return { key, y, subject: subject.trim(), file: key + "-" + y + ".png" }; });
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const list = subjects();
  const ev = {};
  for (let m = 1; m <= 12; m++) Object.assign(ev, JSON.parse(readFileSync(join(ROOT, "data/history", String(m).padStart(2, "0") + ".json"), "utf8")));
  const title = (r) => ev[r.key].find((e) => e.id === r.key + "-" + r.y).t;
  mkdirSync(OUT, { recursive: true });
  const batches = Math.ceil(list.length / PER);

  writeFileSync(join(OUT, "1-START-HERE.md"), `# Gemini: Today in Medical History pictures

Paste everything in the box below into a NEW Gemini chat (Gemini app, image model on, e.g. "Create images").
Then paste the batches from batches.md one at a time (Batch 1, then Batch 2, ... Batch ${batches}).

----------------------------------------------------------------
You are illustrating a medical app's "Today in Medical History" banner. I will send you ${batches} batches.
Each batch lists up to ${PER} pictures. For EVERY line in a batch, generate ONE image with your image
generation model. Do not write code, do not describe the image instead of making it, do not ask questions.

Make the images in the order listed. Under each image write only its file name (for example 01-05-1896.png)
so I can save it with that name. If you cannot fit the whole batch in one reply, stop after the last finished
image and write "continue from N"; I will reply "continue".

STYLE FOR EVERY IMAGE (never change it between images, they must look like one set):
${STYLE}

The "Subject" line says what to draw and where the single amber highlight goes. Draw the anatomy,
instrument, organism, molecule or building it names; never a person's face or portrait.
Reply "Ready" now, and wait for Batch 1.
----------------------------------------------------------------
`);

  let md = "# Batches (paste one at a time after the START-HERE message)\n";
  const csv = [["file", "date", "year", "event", "subject", "prompt"].join(",")];
  for (let b = 0; b < batches; b++) {
    const part = list.slice(b * PER, b * PER + PER);
    const first = part[0].key, last = part[part.length - 1].key;
    const label = (k) => +k.slice(3) + " " + MONTHS[+k.slice(0, 2) - 1];
    md += `\n## Batch ${b + 1} of ${batches} (${label(first)} to ${label(last)})\n\n\`\`\`\nBatch ${b + 1} of ${batches}. Generate these ${part.length} images, one per line, in this order, in the agreed style:\n`;
    part.forEach((r, i) => { md += `${i + 1}. ${r.file}. Subject: ${r.subject}. (Event: ${title(r)}, ${r.y.replace("b", "")})\n`; });
    md += "```\n";
    for (const r of part) csv.push([r.file, r.key, r.y.replace("b", ""), q(title(r)), q(r.subject), q(STYLE + " Subject: " + r.subject + ".")].join(","));
  }
  writeFileSync(join(OUT, "batches.md"), md);
  writeFileSync(join(OUT, "image-prompts.csv"), csv.join("\n") + "\n");
  console.log("subjects", list.length, "batches", batches);
}
