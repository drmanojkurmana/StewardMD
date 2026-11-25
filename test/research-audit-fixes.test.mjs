import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { createRequire } from "node:module";

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

test("search screen provides iOS-safe file picker, .txt NBIB detection, and unified search UI", () => {
  const srch = read("research-screen-search.js");
  assert.doesNotMatch(srch, /<input type="file" id="rmd_import_file"[^>]*accept=/);
  assert.match(srch, /PMID-/);
  assert.match(srch, /rmd_topic_q/);
  assert.match(srch, /\/find-studies/);
  assert.match(srch, /\/records/);
  const api = read("functions/api/research/[[path]].js");
  assert.match(api, /IMPORT_EXTENSIONS[\s\S]*txt:\s*1/);
  assert.match(api, /createDirectRecord/);
});

test("research-tutorial covers all 9 study designs, defaults ON, and celebrates publication", () => {
  const tut = read("research-tutorial.js");
  assert.doesNotMatch(tut, /[\u2013\u2014]/);
  for (const key of ["case", "case-series", "case-control", "cohort", "trial", "sr", "masterchart", "obs", "thesis"]) {
    assert.match(tut, new RegExp('key:\\s*"' + key + '"'), "tutorial example present for " + key);
  }
  assert.match(tut, /isTutorialDefault/);
  assert.match(tut, /showCelebration/);
  const shell = read("research.js");
  assert.match(shell, /#researchMD \.rmd-shell-center\s*\{/);
  assert.match(shell, /header-paste-link/);
  assert.match(shell, /open-read-study/);
  assert.match(shell, /data-rmd="open-read-study"[^>]*>RStudy</);
  assert.doesNotMatch(read("research-screen-studies.js"), /rmdStudiesPasteWrap/);
  assert.match(shell, /rmdTutWrap/);
  assert.match(shell, /submission-tracker/);
  assert.match(shell, /showCelebration/);
});

function buildZip(entries) {
  const localParts = [];
  const cdParts = [];
  let offset = 0;
  for (const { name, data, compress } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const raw = Buffer.from(data, "utf8");
    const body = compress ? deflateRawSync(raw) : raw;
    const method = compress ? 8 : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBytes.length, 26);
    localParts.push(lh, nameBytes, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBytes.length, 28);
    ch.writeUInt32LE(offset, 42);
    cdParts.push(ch, nameBytes);
    offset += lh.length + nameBytes.length + body.length;
  }
  const cd = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, cd, eocd]);
}

test("parseDocx extracts paginated paragraphs and tables while ignoring deleted track changes", async () => {
  const req = createRequire(import.meta.url);
  const thesis = req("../research-screen-thesis.js");
  assert.equal(typeof thesis.parseDocx, "function");
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:r><w:t>Background: BCG trial thesis</w:t></w:r><w:del><w:r><w:delText> 999</w:delText></w:r></w:del></w:p>' +
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
    '<w:p><w:r><w:t>Table 7. Pooled risk ratio was 0.49 across 120 patients.</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  const zip = buildZip([{ name: "word/document.xml", data: xml, compress: true }]);
  const ab = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
  const pages = await thesis.parseDocx(ab);
  assert.equal(pages.length, 2);
  assert.match(pages[0].text, /Background: BCG trial thesis/);
  assert.doesNotMatch(pages[0].text, /999/);
  assert.match(pages[1].text, /Table 7/);
  const ver = thesis.verifyNumbers("The pooled risk ratio was 0.49 across 120 patients.", pages);
  assert.equal(ver.flags.length, 0);
  assert.deepEqual(ver.locators.find((l) => l.number === "0.49"), { number: "0.49", page: 2, table: 7 });
});

test("wrangler.toml stays below Cloudflare Pages 128 text-binding cap", () => {
  const toml = read("wrangler.toml");
  const sec = toml.split("[env.production.vars]")[1].split(/\n\[/)[0];
  const varLines = sec.split("\n").filter((l) => /^[A-Z0-9_]+\s*=/.test(l));
  assert.ok(varLines.length <= 32, `too many [env.production.vars]: ${varLines.length}`);
});

test("research-screen-studies clears edit pin and opens Study Details on mobile tap", () => {
  const st = read("research-screen-studies.js");
  assert.match(st, /isPhoneViewport/);
  assert.match(st, /viewMode = isPhoneViewport\(container\) \? "detail" : "list"/);
  assert.match(st, /rmd-mobile-back-studies/);
});

test("research-screen-run places exports below forest plot, supports PNG download, and guards share cancellation", () => {
  const run = read("research-screen-run.js");
  assert.match(run, /data-rmd="export-png"/);
  assert.match(run, /exportForestPng/);
  assert.match(run, /checkMeasureCompatibility/);
  assert.doesNotMatch(run, /rmd-topbar-actions[\s\S]*data-rmd="export-csv"/);
  const shell = read("research.js");
  assert.match(shell, /isShareCancel/);
});
