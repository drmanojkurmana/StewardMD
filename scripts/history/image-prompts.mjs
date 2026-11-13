// Today in Medical History pictures: from data/history/image-subjects.txt (ONE hand-picked subject per day: the
// day's main event) writes data/history/gemini/gemini-prompt-N-of-M.txt for the subjects that have NO picture yet
// in data/history/img/, at most 100 per prompt (a Gemini task makes about 100 images), each a complete prompt to
// paste into Gemini, plus image-prompts.csv (every subject, with its picture status). The images come back named
// MM-DD-YYYY.png; scripts/history/import-images.sh converts them to data/history/img/<id>.webp. Run it again after
// an import and the prompts shrink to what is still missing.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "data/history/gemini");

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
  for (const f of readdirSync(OUT)) if (/^(gemini-prompt-.*\.txt|1-START-HERE\.md|batches\.md|GEMINI-FULL-PROMPT\.md)$/.test(f)) unlinkSync(join(OUT, f));
  const has = (r) => existsSync(join(ROOT, "data/history/img", r.key + "-" + r.y + ".webp"));
  const todo = list.filter((r) => !has(r));
  // Self-contained prompts of at most 100 (a Gemini task makes up to about 100 images), for missing pictures only.
  const parts = [];
  for (let i = 0; i < todo.length; i += 100) parts.push(todo.slice(i, i + 100));
  const M = parts.length;
  const label = (k) => +k.slice(3) + " " + MONTHS[+k.slice(0, 2) - 1];
  const csv = [["prompt", "file", "date", "year", "event", "subject"].join(",")];
  list.filter(has).forEach((r) => csv.push(["done", r.file, r.key, r.y === "day" ? "every year" : r.y.replace("b", ""), q(title(r)), q(r.subject)].join(",")));
  parts.forEach((part, pi) => {
    let t = `Create ${part.length} images with your image generation model. Do not write code. Do not describe images instead of making them. Do not ask questions; make all ${part.length}.

This is part ${pi + 1} of ${M} of a set for a medical app's "Today in Medical History" banner (${label(part[0].key)} to ${label(part[part.length - 1].key)}). One image per line below. Every image must match the earlier images of this set exactly in style: one consistent set.

STYLE FOR EVERY IMAGE:
${STYLE}

Each line gives the file name, then what to draw and where the single amber highlight goes. Draw the anatomy, instrument, organism, molecule or building named; never a person's face or portrait.

OUTPUT: name every image exactly with its file name (for example ${part[0].file}) and give me all ${part.length} together in one ZIP file to download. If a ZIP is not possible, show them in the order listed with the file name under each.

THE ${part.length} IMAGES:
`;
    part.forEach((r, i) => {
      t += `${i + 1}. ${r.file}: ${r.subject}. (${title(r)}, ${r.y === "day" ? "observed every year" : r.y.replace("b", "")})\n`;
      csv.push([pi + 1, r.file, r.key, r.y === "day" ? "every year" : r.y.replace("b", ""), q(title(r)), q(r.subject)].join(","));
    });
    writeFileSync(join(OUT, `gemini-prompt-${pi + 1}-of-${M}.txt`), t);
  });
  writeFileSync(join(OUT, "image-prompts.csv"), csv.join("\n") + "\n");
  console.log("subjects", list.length, "with pictures", list.length - todo.length, "prompts", parts.map((p) => p.length).join("/") || "none needed");
}
