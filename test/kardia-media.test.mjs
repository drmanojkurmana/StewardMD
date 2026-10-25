/* test/kardia-media.test.mjs — kardia/media/credits.json (WP12b clean clips).
 *
 * The app may only show de-identified scans: every entry must carry a
 * commercial-use licence (CC BY, CC BY-SA, CC0 or public domain — never NC
 * or ND), full attribution with a live source URL, a note of the
 * de-identification changes, and a sha256 so the app can verify the file it
 * ships. When the clean files are present locally under work/clips-clean
 * they must exist on disk.
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  x FAIL:", n); } };

const credits = JSON.parse(readFileSync(new URL("../kardia/media/credits.json", import.meta.url), "utf8"));
const clips = credits.clips;

ok("credits: parses to a non-empty clips array", Array.isArray(clips) && clips.length > 0);

const allowed = ["CC BY", "CC BY-SA", "CC0", "public domain"];
const seen = new Set();
for (const c of clips) {
  const tag = c.file || "(missing file)";
  ok(`${tag}: licence is in the allowed commercial-use list`, typeof c.licence === "string" &&
    allowed.some((a) => c.licence === a || c.licence.startsWith(a + " ") || c.licence.startsWith(a + "-")));
  ok(`${tag}: licence has no NC or ND term`, typeof c.licence === "string" && !/(NC|ND)/.test(c.licence));
  ok(`${tag}: attribution is a non-empty string`, typeof c.attribution === "string" && c.attribution.trim().length > 0);
  ok(`${tag}: source URL is http(s)`, typeof c.source === "string" && /^https?:\/\//.test(c.source));
  ok(`${tag}: changes note names cropping and masking`, typeof c.changes === "string" &&
    /crop/i.test(c.changes) && /mask/i.test(c.changes));
  ok(`${tag}: sha256 is 64 hex chars`, typeof c.sha256 === "string" && /^[0-9a-f]{64}$/.test(c.sha256));
  ok(`${tag}: bytes is a positive integer`, Number.isInteger(c.bytes) && c.bytes > 0);
  ok(`${tag}: file name is unique`, !seen.has(c.file));
  seen.add(c.file);

  const local = new URL(`../work/clips-clean/${c.file}`, import.meta.url);
  if (existsSync(local)) {
    const buf = readFileSync(local);
    ok(`${tag}: bytes match the file on disk`, buf.length === c.bytes);
    ok(`${tag}: sha256 matches the file on disk`, createHash("sha256").update(buf).digest("hex") === c.sha256);
    ok(`${tag}: output is at most 3 MB`, buf.length <= 3 * 1024 * 1024);
  } else {
    console.log(`  - SKIP (absent locally): ${tag}`);
  }
}

console.log(`\nkardia-media: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
