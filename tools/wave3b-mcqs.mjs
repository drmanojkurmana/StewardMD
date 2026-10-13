/**
 * Aggregator for Wave 3B MCQs (230 questions across 23 modules)
 */
import { wave3bMcqsPart1 as part1 } from "./wave3b-mcqs-part1.mjs";
import { wave3bMcqsPart2 as part2 } from "./wave3b-mcqs-part2.mjs";
import { wave3bMcqsPart3 as part3 } from "./wave3b-mcqs-part3.mjs";

export const wave3bMcqs = {
  ...part1,
  ...part2,
  ...part3
};
