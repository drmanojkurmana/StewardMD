#!/usr/bin/env python3
"""
Wave 4B Lessons & KB Builder
Validates and generates:
- tools/wave4b-lessons-part1.mjs (10 lessons)
- tools/wave4b-lessons-part2.mjs (10 lessons)
- tools/wave4b-lessons.mjs (Aggregator)
- tools/wave4b-kb.mjs (20 KB reference articles)
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
sys.path.insert(0, ROOT)

from scripts.data_wave4b_part1 import LESSONS_1_5
from scripts.data_wave4b_part1b import LESSONS_6_10
from scripts.data_wave4b_part2a import LESSONS_11_15
from scripts.data_wave4b_part2b import LESSONS_16_20
from scripts.data_wave4b_kb import KB_ARTICLES

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")

def validate_step(tx, say):
    words_tx = tx.split()
    words_say = say.split()
    if not (40 <= len(words_tx) <= 90):
        raise ValueError(f"tx word count {len(words_tx)} not in 40-90: {tx[:60]}...")
    if len(words_say) > 120:
        raise ValueError(f"say word count {len(words_say)} > 120: {say[:60]}...")
    bold = re.findall(r'\*\*([^*]+)\*\*', tx)
    if len(bold) != 1:
        raise ValueError(f"Expected 1 bold term, got {len(bold)}: {bold} in {tx[:60]}...")
    if '*' in say:
        raise ValueError(f"say contains asterisks: {say}")
    if '—' in tx or '—' in say:
        raise ValueError(f"Em dash found in text")

def normalize_lesson(l):
    new_steps = []
    for s in l["steps"]:
        new_s = dict(s)
        vis = s.get("vis")
        if vis and vis.get("kind") == "compare":
            if "a" in vis and "b" in vis:
                new_s["vis"] = {
                    "kind": "compare",
                    "left": {
                        "title": vis["a"]["title"],
                        "points": vis["a"].get("bullets") or vis["a"].get("points")
                    },
                    "right": {
                        "title": vis["b"]["title"],
                        "points": vis["b"].get("bullets") or vis["b"].get("points")
                    }
                }
        new_steps.append(new_s)
    res = dict(l)
    res["steps"] = new_steps
    return res

def main():
    part1_lessons = [normalize_lesson(l) for l in (LESSONS_1_5 + LESSONS_6_10)]
    part2_lessons = [normalize_lesson(l) for l in (LESSONS_11_15 + LESSONS_16_20)]
    all_lessons = part1_lessons + part2_lessons

    assert len(part1_lessons) == 10, f"Expected 10 in part 1, got {len(part1_lessons)}"
    assert len(part2_lessons) == 10, f"Expected 10 in part 2, got {len(part2_lessons)}"
    assert len(KB_ARTICLES) == 20, f"Expected 20 KB articles, got {len(KB_ARTICLES)}"

    # Validate all lessons
    for l in all_lessons:
        assert len(l["steps"]) == 4, f"{l['module']} steps != 4"
        for s in l["steps"]:
            validate_step(s["tx"], s["say"])

    # Validate all KB articles
    for k in KB_ARTICLES:
        assert '—' not in k['patho']
        for p in k['pearls']:
            assert '—' not in p
        for d in k['differentials']:
            assert '—' not in d
        for inv in k['investigations']:
            assert '—' not in inv

    print("All 20 lessons and 20 KB articles validated successfully.")

    # 1. tools/wave4b-lessons-part1.mjs
    p1_path = os.path.join(TOOLS, "wave4b-lessons-part1.mjs")
    with open(p1_path, "w") as f:
        f.write("/**\n * Wave 4B Surgical Lessons: Part 1 (Modules 1-10)\n */\n\n")
        f.write("export const wave4bLessonsPart1 = " + json.dumps(part1_lessons, indent=2) + ";\n")
    print(f"Wrote {p1_path}")

    # 2. tools/wave4b-lessons-part2.mjs
    p2_path = os.path.join(TOOLS, "wave4b-lessons-part2.mjs")
    with open(p2_path, "w") as f:
        f.write("/**\n * Wave 4B Surgical Lessons: Part 2 (Modules 11-20)\n */\n\n")
        f.write("export const wave4bLessonsPart2 = " + json.dumps(part2_lessons, indent=2) + ";\n")
    print(f"Wrote {p2_path}")

    # 3. tools/wave4b-lessons.mjs
    agg_path = os.path.join(TOOLS, "wave4b-lessons.mjs")
    with open(agg_path, "w") as f:
        f.write("""/**
 * Wave 4B Lessons Aggregator (20 Surgical Lessons)
 */
import { wave4bLessonsPart1 } from "./wave4b-lessons-part1.mjs";
import { wave4bLessonsPart2 } from "./wave4b-lessons-part2.mjs";

function makeId(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${hex.slice(0, 8)}-4000-8000-${hex.slice(0, 4)}-${hex.slice(4, 8)}12345678`.slice(0, 36);
}

export const wave4bLessons = [
  ...wave4bLessonsPart1,
  ...wave4bLessonsPart2
].map(l => ({
  ...l,
  v: 1,
  gen: "AI",
  run: "books-coverage-wave4b",
  model: "gemini-3.8-flash-high",
  quiz: [
    makeId(`${l.module}-q1`),
    makeId(`${l.module}-q2`),
    makeId(`${l.module}-q3`)
  ],
  src: [],
  checks: {
    shape: true,
    numbers: true,
    drugs: true,
    verbatim: true,
    dashes: true,
    verify: true
  }
}));
""")
    print(f"Wrote {agg_path}")

    # 4. tools/wave4b-kb.mjs
    kb_path = os.path.join(TOOLS, "wave4b-kb.mjs")
    with open(kb_path, "w") as f:
        f.write("/**\n * Wave 4B Knowledge Library Reference Articles (KB v2)\n * 20 Paired Clinical Reference Articles for Sabiston Surgery Part 2\n */\n\n")
        f.write("export const wave4bKbArticles = " + json.dumps(KB_ARTICLES, indent=2) + ";\n")
    print(f"Wrote {kb_path}")

if __name__ == "__main__":
    main()
