/* Builds prep/tts/lex-v1.txt, the pronunciation lexicon of the natural lesson voice (prep-voice.js): every word the
 * lessons narrate (steps' say, key points, card text), plus the stems a spelling or suffix rule can reach, looked up in
 * the CMU Pronouncing Dictionary (ISC licence) and written as "word phonemes" in the symbols Kokoro was trained on.
 * Words the dictionary lacks are not listed; the app spells them out by rule.
 *   npm pack cmu-pronouncing-dictionary && tar xzf cmu-pronouncing-dictionary-*.tgz
 *   node tools/prep-voice-lex.mjs package/index.js
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const V = req("../prep-voice.js");
const dictPath = path.resolve(process.argv[2] || "node_modules/cmu-pronouncing-dictionary/index.js");
const dict = req(dictPath).dictionary;
const dir = "prep/lessons/v1/";
const words = new Set(["a", "i", "point", "minus", "and", "hundred", "thousand", "million", "percent", "per", "to", "or", "at", "least", "most", "greater", "less", "than", "about", "plus", "for", "example", "that", "is", "versus", "doctor"]);
for (let n = 0; n < 20; n++) V.numberWords(String(n)).forEach((w) => words.add(w));
["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"].forEach((w) => words.add(w));
const add = (t) => { for (const w of String(t || "").toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []) words.add(w); };
for (const f of fs.readdirSync(dir)) {
  if (f === "index.json") continue;
  let j; try { j = JSON.parse(fs.readFileSync(dir + f, "utf8")); } catch { continue; }
  (j.steps || []).forEach((s) => add(s.say));
  (j.keys || []).forEach(add);
  (j.cards || []).forEach((c) => { add(c.f); add(c.b); });
}
const cands = (w) => {
  const a = V.americanize(w), out = [w, a];
  for (const x of [w, a]) {
    let m;
    if ((m = /^(.*[^s])s$/.exec(x))) out.push(m[1]);
    if ((m = /^(.*)es$/.exec(x))) out.push(m[1]);
    if ((m = /^(.*)ed$/.exec(x))) out.push(m[1], m[1] + "e");
    if ((m = /^(.*)ing$/.exec(x))) out.push(m[1], m[1] + "e");
    if ((m = /^(.*)ly$/.exec(x))) out.push(m[1]);
    if ((m = /^(.*)ally$/.exec(x))) out.push(m[1]);
  }
  return out;
};
const keep = new Set();
for (const w of words) for (const c of cands(w)) if (dict[c]) keep.add(c);
const lines = [...keep].sort().map((w) => w + " " + V.arpaToPhones(dict[w]));
fs.mkdirSync("prep/tts", { recursive: true });
fs.writeFileSync("prep/tts/lex-v1.txt", lines.join("\n") + "\n");
console.log("lexicon: " + lines.length + " words, " + fs.statSync("prep/tts/lex-v1.txt").size + " bytes (corpus " + words.size + " words)");
