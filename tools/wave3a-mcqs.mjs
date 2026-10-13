/**
 * Aggregator for Wave 3A MCQs
 */
import { wave3aMcqsByTopic as part1 } from "./wave3a-mcqs-part1.mjs";
import { wave3aMcqsPart2 as part2 } from "./wave3a-mcqs-part2.mjs";
import { wave3aMcqsPart3 as part3 } from "./wave3a-mcqs-part3.mjs";

export const wave3aMcqs = {
  ...part1,
  ...part2,
  ...part3
};
