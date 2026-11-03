// scripts/build-nephrology-blueprint.mjs
// Compiles the high-yield Nephrology Stage 1 blueprint adhering to:
// - Comprehensive Clinical Nephrology 7th Edition (CCN7)
// - Brenner and Rector's The Kidney 11th Edition (BR11)
// - Harrison's Principles of Internal Medicine 22nd Edition (H22) & Nephrology Notes by Dr VG
// - NMC DM Nephrology Curriculum / NBEMS NEET-SS Nephrology Medical Specialty Group
// - 60 modules across 10 sections, exactly 8 mustKnow facts per module (480 facts total, 60 % 3 == 0)
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("Running python generator to ensure full synchronization...");
execSync("python3 generate_nephro_blueprint.py", { cwd: ROOT, stdio: "inherit" });
