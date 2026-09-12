/* scripts/gen-schema-doc.mjs — regenerate connect-agent/manifest/schema-doc.mjs from schema.json.
 *
 * Run after editing schema.json:  node scripts/gen-schema-doc.mjs
 * test/connect-schema-doc.test.mjs fails if you forget. See schema-doc.mjs's own header for why the
 * generated twin exists at all (Cloudflare's esbuild predates import attributes).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "connect-agent", "manifest");
const doc = JSON.parse(readFileSync(join(DIR, "schema.json"), "utf8"));
const header = readFileSync(join(DIR, "schema-doc.mjs"), "utf8").split("export default ")[0];
writeFileSync(join(DIR, "schema-doc.mjs"), header + JSON.stringify(doc, null, 2) + ";\n");
console.log("schema-doc.mjs regenerated from schema.json");
