// scripts/build-medical-oncology-blueprint.mjs
// Compiles the high-yield Medical Oncology blueprint adhering to:
// - DeVita 12e, Harrison 22e, ESMO/NCCN, and INI-SS / NEET-SS high-yield review sources
// - 91 modules across 12 sections
// - 8 to 15 mustKnow facts per topic
// - Every fact carries terms, numbers/drugs where applicable, and citation source
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
console.log("Compiling Medical Oncology blueprint...");
