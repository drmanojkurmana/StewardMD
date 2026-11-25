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

import * as europepmc from "../functions/api/research/_connectors/europepmc.js";

test("studies screen mobile CSS wraps topbar actions and prevents shell horizontal overflow", () => {
  const shell = read("research.js");
  const pc = read("research-screen-papercard.js");
  assert.match(shell, /#researchMD \.rmd-shell-body\s*\{[^}]*overflow-x:\s*hidden/);
  assert.match(shell, /#researchMD \.rmd-topbar-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(pc, /\.rmd-paste-input-row\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(pc, /\.rmd-paste-input\s*\{[^}]*min-width:\s*0/);
});

test("wrangler.toml configures RESEARCH_CONTACT_EMAIL for live connectors", () => {
  const toml = read("wrangler.toml");
  assert.match(toml, /\[env\.production\.vars\][\s\S]*RESEARCH_CONTACT_EMAIL\s*=\s*"[^"]+@[^"]+"/);
});

test("search screen maps language and studyType filters to valid connector schemas", () => {
  const src = read("research-screen-search.js");
  assert.doesNotMatch(src, /filters\.language\s*=/);
  assert.doesNotMatch(src, /filters\.studyType\s*=/);
  assert.match(src, /filters\.languages\s*=/);
  assert.match(src, /filters\.publicationTypes\s*=/);
});

test("europepmc connector uses ebi.ac.uk and reads object resultList.result payloads", async () => {
  const src = read("functions/api/research/_connectors/europepmc.js");
  assert.match(src, /https:\/\/www\.ebi\.ac\.uk\/europepmc\/webservices\/rest\/search/);
  const calls = [];
  const fetchMock = async (url) => {
    calls.push(String(url));
    const u = new URL(url);
    if (u.searchParams.get("resultType") === "core") {
      return new Response(JSON.stringify({
        resultList: { result: [{ id: "101", source: "MED", pmid: "101", title: "Trial A", pubYear: "2024", authorString: "Patel R" }] }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      hitCount: 1,
      nextCursorMark: "c2",
      resultList: { result: [{ id: "101", source: "MED" }] }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const out = await europepmc.search("BCG", { languages: ["eng"] }, "2026-11-25", {
    contactEmail: "support@stewardmd.in",
    fetch: fetchMock,
    bucket: { acquire: async () => {} }
  });
  assert.deepEqual(out.ids, ["MED:101"]);
  assert.equal(out.totalCount, 1);
  const recs = await europepmc.fetchRecords(out.ids, {
    contactEmail: "support@stewardmd.in",
    fetch: fetchMock,
    bucket: { acquire: async () => {} }
  });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].title, "Trial A");
});
