/**
 * Wave 4A Lessons Aggregator (20 Surgical Lessons)
 */
import { wave4aLessonsPart1 } from "./wave4a-lessons-part1.mjs";
import { wave4aLessonsPart2 } from "./wave4a-lessons-part2.mjs";

function makeId(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${hex.slice(0, 8)}-4000-8000-${hex.slice(0, 4)}-${hex.slice(4, 8)}12345678`.slice(0, 36);
}

export const wave4aLessons = [
  ...wave4aLessonsPart1,
  ...wave4aLessonsPart2
].map(l => ({
  ...l,
  v: 1,
  gen: "AI",
  run: "books-coverage-wave4",
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
