/* mgmt/lint.mjs — advisory checks on generated sidecars (kb/_mgmt/<id>.json).
   Flags: prescribing-style doses (number+unit+route/freq — same regex the KB
   validator uses), a targeted list of American spellings (house style is
   British), and too-short arrays. Not a hard gate; prints ids to regenerate. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MG = join(process.cwd(), "kb", "_mgmt");
const DOSE_RE = /(\b\d+(\.\d+)?\s?(mg|mcg|µg|units?|iu)\/kg\b)|(\b\d+(\.\d+)?\s?(mg|mcg|µg|g|units?|iu)\/day\b)|(\b\d+(\.\d+)?\s?(mg|mcg|µg|g|units?|iu)\b[^.]{0,25}\b(IV|IM|PO|SC|SL|BD|OD|TDS|QID|q\d+h|once daily|twice daily|every \d+ hours?)\b)/i;
const US_RE = /\b(tumor|tumors|edema|edematous|hemorrhage|hemorrhagic|hematoma|hematuria|hematologic\w*|anemia|anemic|pediatric\w*|orthopedic|esophag\w+|estrogen\w*|leukemi\w*|diarrhea|hemoglobin|celiac|ischemi\w*|fetal|fetus|gynecolog\w*|hospitalization|immunization|catheterization|hemodynamic\w*|hemolysis|hemolytic|edematous|oral cavity tumor)\b/i;

const files = readdirSync(MG).filter((f) => f.endsWith(".json") && f !== "_index.json");
const flags = [];
for (const f of files) {
  let sc;
  try { sc = JSON.parse(readFileSync(join(MG, f), "utf8")); } catch (e) { flags.push(["BADJSON", f, e.message]); continue; }
  const arr = Array.isArray(sc.management) ? sc.management : null;
  if (!arr) { flags.push(["NOARRAY", sc.id || f, ""]); continue; }
  if (arr.length < 3) flags.push(["SHORT", sc.id, arr.length + " items"]);
  arr.forEach((s) => {
    if (typeof s !== "string") { flags.push(["NONSTRING", sc.id, String(s)]); return; }
    if (DOSE_RE.test(s)) flags.push(["DOSE", sc.id, s]);
    if (US_RE.test(s)) flags.push(["US-SPELL", sc.id, s]);
  });
}
flags.forEach((x) => console.log(x[0] + "  " + x[1] + (x[2] ? "  :: " + x[2] : "")));
console.log(`sidecars=${files.length} flagged=${flags.length}`);
process.exit(flags.some((x) => x[0] === "BADJSON" || x[0] === "NOARRAY" || x[0] === "NONSTRING") ? 1 : 0);
