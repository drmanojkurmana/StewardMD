import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

test("build-www.sh ships data/research-consent-templates.json", () => {
  const sh = read("scripts/build-www.sh");
  assert.match(sh, /data\/research-consent-templates\.json/);
});

test("consent loaders prefer SMD_CONTENT.fetchJSON for encrypted bundles", () => {
  for (const f of ["research-screen-start.js", "research-screen-pubconsent.js"]) {
    const src = read(f);
    assert.match(src, /SMD_CONTENT\.fetchJSON\(["']data\/research-consent-templates\.json["']\)/, f);
  }
});

test("no ResearchMD file references nonexistent SMD.auth.getToken", () => {
  for (const f of ["research-screen-manuscript.js", "research-screen-pubconsent.js", "research-screen-novelty.js", "research-screen-start.js"]) {
    assert.doesNotMatch(read(f), /SMD\.auth\.getToken/, f);
  }
});

test("casefile loader reads list/case id before falling back", () => {
  const src = read("research-screen-manuscript.js");
  assert.match(src, /G\.RMDStore\.list\(id,\s*["']casefile["']\)/);
  assert.match(src, /isCaseProject\(proj\)/);
  assert.match(src, /EXTRA_SECTION_META/);
  assert.match(src, /sectionSidebarItems/);
});

test("projects and shell route to study journey first screen and provide ready/consort/backup help", () => {
  const shell = read("research.js");
  const projects = read("research-screen-projects.js");
  assert.match(shell, /journeyFor\(actProj\)\[0\]/);
  assert.match(shell, /ready:\s*\{/);
  assert.match(shell, /consort:\s*\{/);
  assert.match(shell, /backup:\s*\{/);
  assert.match(projects, /SMD\.journeyFor\(proj\)\[0\]/);
  assert.match(projects, /Case Report \(CARE\)/);
});

test("clipboard copy in pubconsent and ctri has execCommand fallback", () => {
  for (const f of ["research-screen-pubconsent.js", "research-screen-ctri.js"]) {
    assert.match(read(f), /execCommand\(["']copy["']\)/, f);
  }
});
