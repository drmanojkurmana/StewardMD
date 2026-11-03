import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const bpPath = path.join(ROOT, "prep/blueprints/ss/ss-plastic-surgery.json");
const bp = JSON.parse(fs.readFileSync(bpPath, "utf8"));

// Build sections structure for taxonomy
const sections = bp.sections.map(sec => ({
  id: sec.id,
  name: {
    en: sec.name,
  },
  modules: sec.modules.map(mod => {
    let name = mod.name;
    // Preserve existing exact module names
    if (mod.id === "spl-reconstructive") name = "Reconstructive surgery and flaps";
    if (mod.id === "spl-burns-hand") name = "Burns and hand surgery";
    if (mod.id === "spl-craniofacial-aesthetic") name = "Craniofacial and aesthetic surgery";
    return {
      id: mod.id,
      name: {
        en: name,
      },
      size: mod.size || ((mod.id === "spl-reconstructive" || mod.id === "spl-burns-hand" || mod.id === "spl-craniofacial-aesthetic") ? "l" : "m"),
    };
  }),
}));

console.log(`Generated ${sections.length} sections, ${sections.reduce((acc, s) => acc + s.modules.length, 0)} modules.`);

// Update prep/taxonomy-extra.json
const extraPath = path.join(ROOT, "prep/taxonomy-extra.json");
const extra = JSON.parse(fs.readFileSync(extraPath, "utf8"));
const ssSurgExtra = extra.branches.find(b => b.id === "ss-surgery");
if (!ssSurgExtra) throw new Error("ss-surgery branch not found in taxonomy-extra.json");
const plaExtra = ssSurgExtra.subjects.find(s => s.id === "ss-plastic-surgery");
if (!plaExtra) throw new Error("ss-plastic-surgery not found in taxonomy-extra.json");

plaExtra.sections = sections;
fs.writeFileSync(extraPath, JSON.stringify(extra, null, 1) + "\n");
console.log("Updated prep/taxonomy-extra.json");

// Update prep/taxonomy.json
const taxPath = path.join(ROOT, "prep/taxonomy.json");
const tax = JSON.parse(fs.readFileSync(taxPath, "utf8"));
const ssSurgTax = tax.branches.find(b => b.id === "ss-surgery");
if (!ssSurgTax) throw new Error("ss-surgery branch not found in taxonomy.json");
const plaTax = ssSurgTax.subjects.find(s => s.id === "ss-plastic-surgery");
if (!plaTax) throw new Error("ss-plastic-surgery not found in taxonomy.json");

plaTax.sections = sections;
fs.writeFileSync(taxPath, JSON.stringify(tax, null, 1) + "\n");
console.log("Updated prep/taxonomy.json");
