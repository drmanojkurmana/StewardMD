// Writes data/history/image-prompts.csv: one row per event, the full prompt for an image generator.
// Priority 1 = the day's featured event (366 images, one per day); priority 2 = the second event (optional).
// Save each result as data/history/img/<file> (MM-DD-YYYY.webp), then run build-history.mjs.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VISUAL = ["Surgery", "Discovery", "Vaccine & Drug", "Public Health", "Nobel & Award", "Institution", "Pioneer"];

export const STYLE =
  "Holographic medical illustration, glowing translucent line art like an X-ray hologram. " +
  "Thin luminous mint and cyan lines (#8FF0D2, #5EEAD4) with soft inner glow, subtle volumetric depth, fine wireframe detail. " +
  "Exactly ONE small warm amber-orange highlight (#FF9A3D) with a soft bloom on the single most important point. " +
  "PURE BLACK background (#000000), no gradient, no vignette, no floor, no frame. " +
  "Subject centred slightly right, filling about 70% of the frame, with clear black space around it. " +
  "No text, no letters, no labels, no numbers, no logos, no watermark. " +
  "No human faces or portraits of real people: show the anatomy, instrument, organism or object the event is about. " +
  "Clean, elegant, premium, clinical; not cartoonish, not photographic. Landscape 4:3, 1200x900.";

function pickOrder(evs) {
  return evs.map((e, i) => ({ e, i })).sort((a, b) => VISUAL.indexOf(a.e.c) - VISUAL.indexOf(b.e.c) || a.i - b.i);
}
const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = [["priority", "file", "date", "year", "category", "event", "prompt"].join(",")];
  let n1 = 0, n2 = 0;
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    const days = JSON.parse(readFileSync(join(ROOT, "data/history", mm + ".json"), "utf8"));
    for (const [key, evs] of Object.entries(days)) {
      pickOrder(evs).forEach(({ e }, k) => {
        const subject = "Subject: the anatomy, instrument, organism or object that best tells this story: " + e.t + ". Context: " + e.s;
        rows.push([k === 0 ? 1 : 2, key + "-" + e.y + ".webp", key, e.y, q(e.c), q(e.t), q(STYLE + " " + subject)].join(","));
        k === 0 ? n1++ : n2++;
      });
    }
  }
  writeFileSync(join(ROOT, "data/history/image-prompts.csv"), rows.join("\n") + "\n");
  console.log("priority 1:", n1, "priority 2:", n2);
}
