/* test/research-f20-sources.test.mjs
 * Launch blocker F-20: the "Data sources and licences" screen, the owner-approved
 * sub-processor list, and the shared credit-line helper on the search, find,
 * paper card and studies screens. Renders the real screens in a vm sandbox and
 * scans the produced HTML; registry, script tag and build-www coverage are
 * checked against the real files.
 *
 * Synthetic data only. No em or en dashes.
 * Run:
 *   node --test --experimental-test-module-mocks --experimental-sqlite test/research-f20-sources.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

const NOTICES = {
  pubmed: "Courtesy of the U.S. National Library of Medicine",
  europe_pmc: "Data provided by Europe PMC",
  crossref: "Metadata provided by Crossref",
  clinicaltrials: "Data: ClinicalTrials.gov",
  openalex: "Data: OpenAlex",
  retraction: "Retraction data: Crossref / Retraction Watch"
};

const SOURCE_NAMES = [
  "PubMed (U.S. National Library of Medicine)",
  "Europe PMC",
  "Crossref",
  "ClinicalTrials.gov",
  "OpenAlex",
  "Retraction Watch (through Crossref)"
];

const PROCESSOR_NAMES = [
  "Cloudflare",
  "Google Firebase",
  "Google Vertex AI (Gemini)",
  "Runware",
  "OpenAI"
];

function asText(html) {
  return String(html).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

/* A fake DOM element good enough for the ResearchMD screens: id registration so
 * document.getElementById can find the find-sheet after createElement. */
function fakeElement(doc) {
  var el = {
    innerHTML: "",
    textContent: "",
    value: "",
    className: "",
    children: [],
    attributes: {},
    onclick: null,
    onchange: null,
    oninput: null,
    onsubmit: null,
    onkeydown: null,
    style: {},
    setAttribute: function (k, v) {
      this.attributes[k] = String(v);
      if (k === "id") this.id = String(v);
    },
    getAttribute: function (k) {
      return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
    },
    appendChild: function (c) { this.children.push(c); return c; },
    removeChild: function (c) { return c; },
    remove: function () {},
    addEventListener: function () {},
    removeEventListener: function () {},
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    classList: {
      add: function () {},
      remove: function () {},
      contains: function () { return false; }
    },
    focus: function () {},
    click: function () {}
  };
  var id = "";
  Object.defineProperty(el, "id", {
    get: function () { return id; },
    set: function (v) {
      id = String(v);
      if (doc) doc.registry[id] = el;
    },
    configurable: true,
    enumerable: true
  });
  return el;
}

function createSandbox(files, extraWin) {
  const ls = new Map();
  const doc = { registry: {}, ids: {} };
  const win = {
    document: {
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {},
      removeEventListener: function () {},
      createElement: function () { return fakeElement(doc); },
      getElementById: function (id) {
        if (doc.ids[id]) return doc.ids[id];
        return doc.registry[id] || null;
      },
      head: { appendChild: function () {} }
    },
    location: { origin: "https://stewardmd.in", search: "" },
    localStorage: {
      getItem: function (k) { return ls.has(k) ? ls.get(k) : null; },
      setItem: function (k, v) { ls.set(k, String(v)); },
      removeItem: function (k) { ls.delete(k); }
    },
    navigator: {},
    innerWidth: 390,
    Promise: Promise,
    Error: Error,
    Object: Object,
    Array: Array,
    RegExp: RegExp,
    String: String,
    JSON: JSON,
    Date: Date,
    Number: Number,
    Math: Math,
    isNaN: isNaN,
    parseInt: parseInt,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    encodeURIComponent: encodeURIComponent,
    addEventListener: function () {},
    removeEventListener: function () {}
  };
  for (const k of Object.keys(extraWin || {})) win[k] = extraWin[k];
  win.window = win;
  win.self = win;
  win.globalThis = win;
  const ctx = vm.createContext(win);
  for (const f of files) vm.runInContext(read(f), ctx);
  return { win: win, ctx: ctx, doc: doc };
}

function plainContainer() {
  return {
    innerHTML: "",
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };
}

const FIND_RESULTS = [
  {
    source: "pubmed",
    pmid: "40959673",
    doi: "",
    title: "A PubMed trial",
    authors: ["One Author"],
    year: 2026,
    journal: "Journal One",
    abstract: "Synthetic abstract.",
    freeFullText: false
  },
  {
    source: "europe_pmc",
    pmid: "40959674",
    doi: "10.1000/synthetic",
    title: "An Europe PMC cohort",
    authors: ["Two Author"],
    year: 2025,
    journal: "Journal Two",
    abstract: "Synthetic abstract two.",
    freeFullText: true
  }
];

const TOPIC_RESULTS = [
  {
    source: "crossref",
    pmid: "",
    doi: "10.1000/crossref-paper",
    title: "A Crossref paper",
    authors: ["Three Author"],
    year: 2024,
    journal: "Journal Three",
    abstract: "",
    freeFullText: false
  },
  {
    source: "pubmed",
    pmid: "40959675",
    doi: "10.1000/pubmed-paper",
    title: "A PubMed paper",
    authors: ["Four Author"],
    year: 2026,
    journal: "Journal Four",
    abstract: "",
    freeFullText: false
  }
];

function apiStub(findResults) {
  return {
    request: function (method, path) {
      if (path.indexOf("/find-studies") >= 0 && method === "POST") {
        return Promise.resolve({ results: findResults });
      }
      if (path.indexOf("/searches") >= 0) return Promise.resolve({ searchRuns: [] });
      if (path.indexOf("/protocols") >= 0) return Promise.resolve({ protocols: [] });
      return Promise.resolve({});
    },
    upload: function () { return Promise.resolve({}); }
  };
}

const RESEARCH_FILES = ["research.js", "research-screen-sources.js"];

describe("F-20 screen registration", () => {
  test("research.js registers the sources screen in the More menu, labels and help", () => {
    const src = read("research.js");
    assert.ok(src.indexOf('var ADVANCED_SCREENS = { ipd: 1, institution: 1, credits: 1, templates: 1, journals: 1, sources: 1 };') >= 0,
      "ADVANCED_SCREENS contains sources");
    assert.ok(src.indexOf('var ADVANCED_TABS = ["ipd", "credits", "institution", "templates", "journals", "sources"];') >= 0,
      "ADVANCED_TABS contains sources");
    const sb = createSandbox(RESEARCH_FILES);
    assert.equal(sb.win.SMD_RESEARCH.TAB_LABELS.sources, "Data sources", "tab label");
    assert.ok(sb.win.SMD_RESEARCH.HELP.sources, "HELP entry exists");
    assert.equal(sb.win.SMD_RESEARCH.HELP.sources.name, "Data sources and licences", "help name");
  });

  test("index.html loads the screen script with a cache-bust token, like its neighbours", () => {
    const html = read("index.html");
    const m = html.match(/<script src="\/research-screen-sources\.js\?v=([^"]+)" defer><\/script>/);
    assert.ok(m, "defer script tag with ?v= token present");
    assert.ok(m && m[1].length > 0, "token is non-empty");
  });

  test("scripts/build-www.sh copies the new file (root *.js glob)", () => {
    const sh = read("scripts/build-www.sh");
    assert.ok(/for f in \*\.js; do/.test(sh), "root *.js copy loop exists");
    assert.ok(/capacitor\.config\.js\|capacitor\.config\.ts\) : ;;/.test(sh),
      "only the Capacitor configs are excluded from the loop");
    assert.ok(existsSync(join(ROOT, "research-screen-sources.js")), "the file exists at the repo root");
    const name = "research-screen-sources.js";
    const excluded = name === "capacitor.config.js" || name === "capacitor.config.ts";
    assert.equal(excluded, false, "the file is not one of the two loop excludes");
    const rootJs = readdirSync(ROOT).filter((f) => f.endsWith(".js"));
    assert.ok(rootJs.indexOf(name) >= 0, "readdir confirms a root .js the glob matches");
  });
});

describe("F-20 sources screen renders every source and processor", () => {
  function renderSourcesScreen(project) {
    const sb = createSandbox(RESEARCH_FILES);
    sb.win.SMD_RESEARCH.store = {
      getActiveProject: function () {
        return project === undefined ? { id: "prj_f20", title: "F-20 test project" } : project;
      }
    };
    const container = plainContainer();
    assert.ok(sb.win.SMD_RESEARCH.screens.sources, "screens.sources exists");
    sb.win.SMD_RESEARCH.screens.sources.render(container);
    return container.innerHTML;
  }

  test("every source renders with its name, sent and licence rows and required notice verbatim", () => {
    const html = renderSourcesScreen();
    const text = asText(html);
    for (const name of SOURCE_NAMES) {
      assert.ok(text.indexOf(name) >= 0, "source card: " + name);
    }
    for (const id of Object.keys(NOTICES)) {
      assert.ok(text.indexOf(NOTICES[id]) >= 0, "notice verbatim: " + NOTICES[id]);
    }
    assert.ok(html.indexOf('data-rmd-source="pubmed"') >= 0, "pubmed card is addressable");
    assert.ok(text.indexOf("Sent") >= 0, "sent column present");
    assert.ok(text.indexOf("Licence") >= 0, "licence column present");
  });

  test("each source card carries the Visit and Terms outbound links", () => {
    const html = renderSourcesScreen();
    const links = html.match(/<a href="[^"]+" target="_blank" rel="noopener noreferrer"/g) || [];
    assert.ok(links.length >= 12, "two outbound links per source card, got " + links.length);
    assert.ok(html.indexOf("https://pubmed.ncbi.nlm.nih.gov/") >= 0, "PubMed site link");
    assert.ok(html.indexOf("https://www.nlm.nih.gov/databases/download/terms_and_conditions.html") >= 0, "NLM terms link");
    assert.ok(html.indexOf("https://europepmc.org/") >= 0, "Europe PMC site link");
    assert.ok(html.indexOf("https://www.ebi.ac.uk/about/terms-of-use/") >= 0, "EMBL-EBI terms link");
    assert.ok(html.indexOf("https://www.crossref.org/terms/") >= 0, "Crossref terms link");
    assert.ok(html.indexOf("https://clinicaltrials.gov/about-site/terms-conditions") >= 0, "ClinicalTrials.gov terms link");
    assert.ok(html.indexOf("https://help.openalex.org/") >= 0, "OpenAlex terms link");
    assert.ok(html.indexOf("https://gitlab.com/crossref/retraction-watch-data") >= 0, "Retraction Watch dataset link");
  });

  test("the screen states that only search words and identifiers are sent, never patient data", () => {
    const text = asText(renderSourcesScreen());
    assert.ok(text.indexOf("Never patient data") >= 0, "never-patient-data line per source");
    assert.ok(text.indexOf("Patient data is never sent to a literature database") >= 0, "intro line");
  });

  test("the sub-processor section lists the five owner-approved processors", () => {
    const html = renderSourcesScreen();
    const text = asText(html);
    assert.ok(text.indexOf("Who processes your data") >= 0, "section heading");
    for (const name of PROCESSOR_NAMES) {
      assert.ok(html.indexOf('data-rmd-processor="' + name + '"') >= 0, "processor box: " + name);
    }
    assert.ok(text.indexOf("sub-processors (companies that handle data for us under contract)") >= 0, "sub-processor wording");
    assert.ok(text.indexOf("United States, the European Union and Singapore") >= 0, "Cloudflare cache countries");
    assert.ok(text.indexOf("passes the text to an OpenAI GPT model") >= 0, "Runware passes to OpenAI");
    assert.ok(html.indexOf("https://stewardmd.in/privacy.html") >= 0, "privacy policy outbound link");
  });

  test("the screen renders without a project too (reachable from any project state)", () => {
    const html = renderSourcesScreen(null);
    assert.ok(asText(html).indexOf("Data sources and licences") >= 0, "title renders");
    assert.ok(html.indexOf('rmd-badge-soft') < 0, "no project badge without a project");
  });

  test("no em or en dashes anywhere in the rendered screen", () => {
    const html = renderSourcesScreen();
    assert.ok(html.indexOf("\u2014") < 0 && html.indexOf("\u2013") < 0, "no em or en dash");
  });

  test("Semantic Scholar is not listed (its connector is a refusing stub)", () => {
    const text = asText(renderSourcesScreen());
    assert.ok(text.indexOf("Semantic Scholar") < 0, "Semantic Scholar absent");
  });
});

describe("F-20 shared credit helper", () => {
  test("creditHtml joins the required notices and renders the retrieval date", () => {
    const sb = createSandbox(RESEARCH_FILES);
    const SMD = sb.win.SMD_RESEARCH;
    assert.equal(SMD.sources.notice("pubmed"), NOTICES.pubmed, "notice() returns the verbatim string");
    const when = new Date(2026, 10, 27, 9, 30, 0).getTime();
    const line = SMD.sources.creditHtml(["crossref", "pubmed"], when, { attr: 'data-rmd="x"' });
    assert.ok(line.indexOf(NOTICES.pubmed) >= 0, "pubmed notice present");
    assert.ok(line.indexOf(NOTICES.crossref) >= 0, "crossref notice present");
    assert.ok(line.indexOf("Retrieved 27 Nov 2026") >= 0, "retrieval date rendered");
    assert.ok(line.indexOf('data-rmd="x"') >= 0, "attribute passthrough");
    assert.equal(SMD.sources.creditHtml([], null), "", "empty input renders nothing");
    assert.equal(SMD.sources.creditHtml(["nope"], null), "", "unknown source renders nothing");
    const undated = SMD.sources.creditHtml("europe_pmc", null);
    assert.ok(undated.indexOf(NOTICES.europe_pmc) >= 0 && undated.indexOf("Retrieved") < 0, "no date when none given");
  });

  test("itemsSources reads per-item source and merged sources arrays in house order", () => {
    const sb = createSandbox(RESEARCH_FILES);
    const ids = sb.win.SMD_RESEARCH.sources.itemsSources([
      { source: "crossref" },
      { source: "pubmed", sources: ["pubmed", "europe_pmc"] },
      { source: "unknown_db" },
      { source: "europe_pmc" }
    ]);
    /* The array comes from the vm context; compare its content, not its prototype. */
    assert.equal(ids.join(","), "pubmed,europe_pmc,crossref", "deduped and ordered");
  });
});

describe("F-20 credit lines on the search screen", () => {
  test("quick-search results show the notices of the sources present plus the retrieval date", async () => {
    const sb = createSandbox(["research.js", "research-screen-sources.js", "research-screen-search.js"]);
    const SMD = sb.win.SMD_RESEARCH;
    SMD.store = { getActiveProject: function () { return { id: "prj_f20", title: "F-20 search", serverId: "srv_f20", role: "owner" }; } };
    SMD.api = apiStub(TOPIC_RESULTS);
    SMD.ai = {
      state: function () { return null; },
      barHtml: function () { return ""; },
      noteHtml: function () { return ""; },
      clearNote: function () {},
      bind: function () {}
    };

    const topicBtn = fakeElement(null);
    const topicInput = fakeElement(null);
    const container = {
      innerHTML: "",
      querySelector: function (sel) {
        if (sel === "#rmd_topic_q") return topicInput;
        return null;
      },
      querySelectorAll: function (sel) {
        if (sel === '[data-rmd="topic-search"]') return [topicBtn];
        return [];
      }
    };
    SMD.screens.search.render(container);
    await sleep(60); /* the first render is the loading shell; load() re-renders when it resolves */
    assert.ok(container.innerHTML.indexOf("Quick Search") >= 0, "search screen rendered");
    topicInput.oninput.call({ value: "BCG tuberculosis trial" });
    topicBtn.onclick.call(topicBtn);
    await sleep(60);

    const html = container.innerHTML;
    assert.ok(html.indexOf('data-rmd="topic-sources-credit"') >= 0, "credit line present");
    const text = asText(html);
    assert.ok(text.indexOf(NOTICES.pubmed) >= 0, "NLM notice on quick-search results");
    assert.ok(text.indexOf(NOTICES.crossref) >= 0, "Crossref notice on quick-search results");
    assert.ok(text.indexOf(NOTICES.europe_pmc) < 0, "no Europe PMC notice: no europe_pmc item in this result set");
    assert.ok(/Retrieved \d{1,2} [A-Z][a-z]{2} \d{4}/.test(text), "retrieval date rendered");
  });
});

describe("F-20 credit lines on the find sheet", () => {
  test("find results show the notices of the sources present plus the retrieval date", async () => {
    const sb = createSandbox(["research.js", "research-screen-sources.js", "research-screen-find.js"]);
    const SMD = sb.win.SMD_RESEARCH;
    SMD.api = apiStub(FIND_RESULTS);
    sb.doc.ids["rmd_find_query"] = { value: "BCG tuberculosis", oninput: null, onkeydown: null };
    sb.doc.ids["rmd_find_outcome"] = { value: "confirmed tuberculosis", oninput: null };
    sb.doc.ids["researchMD"] = fakeElement(sb.doc);

    assert.ok(SMD.find && SMD.find.open, "find module exposed");
    SMD.find.open({ id: "prj_f20", title: "F-20 find", serverId: "srv_f20" });
    const sheet = sb.doc.registry["rmdFindSheet"];
    assert.ok(sheet, "find sheet element created");
    const queryEl = sb.doc.ids["rmd_find_query"];
    assert.ok(queryEl.onkeydown, "query keyboard handler bound (Enter runs the search)");
    queryEl.onkeydown({ key: "Enter", keyCode: 13, preventDefault: function () {} });
    await sleep(60);

    const html = sheet.innerHTML;
    const text = asText(html);
    assert.ok(text.indexOf(FIND_RESULTS[0].title) >= 0, "results rendered");
    assert.ok(html.indexOf('data-find="sources-credit"') >= 0, "credit line present");
    assert.ok(text.indexOf(NOTICES.pubmed) >= 0, "NLM notice on find results");
    assert.ok(text.indexOf(NOTICES.europe_pmc) >= 0, "Europe PMC notice on find results");
    assert.ok(/Retrieved \d{1,2} [A-Z][a-z]{2} \d{4}/.test(text), "retrieval date rendered");
  });
});

describe("F-20 credit lines on the paper card", () => {
  test("the study card shows all three database credit lines at its foot", () => {
    const sb = createSandbox(["research.js", "research-screen-sources.js", "research-screen-papercard.js"]);
    const SMD = sb.win.SMD_RESEARCH;
    SMD.store = { getActiveProject: function () { return null; } };
    const card = {
      title: "A synthetic trial",
      authors: ["Five Author", "Six Author"],
      journal: "Journal Five",
      year: 2026,
      pmid: "40959676",
      doi: "10.1000/card",
      findings: [],
      sections: [{ label: "", text: "Synthetic section." }],
      design: { label: "Randomised trial" },
      sampleSize: { n: 120 },
      method: "cache"
    };
    const container = plainContainer();
    assert.ok(SMD.paperCard && SMD.paperCard.render, "paperCard.render exposed");
    SMD.paperCard.render(container, card, {});
    const text = asText(container.innerHTML);
    assert.ok(text.indexOf("A synthetic trial") >= 0, "card rendered");
    assert.ok(container.innerHTML.indexOf('data-rmd="card-sources-credit"') >= 0, "credit line present");
    assert.ok(text.indexOf(NOTICES.pubmed) >= 0, "NLM notice on the card");
    assert.ok(text.indexOf(NOTICES.europe_pmc) >= 0, "Europe PMC notice on the card");
    assert.ok(text.indexOf(NOTICES.crossref) >= 0, "Crossref notice on the card");
  });
});

describe("F-20 credit lines on the studies screen", () => {
  function studiesSandbox(studies) {
    const sb = createSandbox(["research.js", "research-screen-sources.js", "research-screen-studies.js"]);
    const SMD = sb.win.SMD_RESEARCH;
    SMD.store = {
      getActiveProject: function () { return { id: "prj_f20", title: "F-20 studies", discipline: "Medicine" }; },
      getStudies: function () { return studies; },
      getConflict: function () { return null; },
      getActiveStudy: function () { return studies[0] || null; },
      getStudy: function (id) {
        for (var i = 0; i < studies.length; i++) if (studies[i].id === id) return studies[i];
        return null;
      }
    };
    SMD.api = { request: function () { return Promise.resolve({ available: false, retractions: {} }); } };
    return sb;
  }

  test("a study added from an online database shows the credit lines in its provenance box", async () => {
    const study = {
      id: "st_f20_1",
      label: "BCG trial 1994",
      measure: "RR",
      inputs: { events1: 4, n1: 123, events2: 11, n2: 139 },
      locator: { kind: "manual", citation: "PMID 12345. DOI 10.1000/bcg-trial", page: "", section: "Results", table: "", quote: "Synthetic quote." },
      quote: "Synthetic quote.",
      verified: true,
      version: 1
    };
    const sb = studiesSandbox([study]);
    const container = plainContainer();
    sb.win.SMD_RESEARCH.screens.studies.render(container);
    await sleep(30);
    const html = container.innerHTML;
    const text = asText(html);
    assert.ok(text.indexOf("Evidence Provenance") >= 0, "detail pane rendered");
    assert.ok(html.indexOf('data-rmd="study-sources-credit"') >= 0, "credit line present");
    assert.ok(text.indexOf(NOTICES.pubmed) >= 0, "NLM notice for the PMID marker");
    assert.ok(text.indexOf(NOTICES.europe_pmc) >= 0, "Europe PMC notice for the DOI marker");
    assert.ok(text.indexOf(NOTICES.crossref) >= 0, "Crossref notice for the DOI marker");
  });

  test("a manually typed citation without PMID or DOI gets no credit line", async () => {
    const study = {
      id: "st_f20_2",
      label: "Manual study",
      measure: "RR",
      inputs: { events1: 4, n1: 123, events2: 11, n2: 139 },
      locator: { kind: "manual", citation: "Aronson JD, Am Rev Tuberc 1948; 58:255-281", page: "258", section: "", table: "", quote: "" },
      quote: "",
      verified: false,
      version: 1
    };
    const sb = studiesSandbox([study]);
    const container = plainContainer();
    sb.win.SMD_RESEARCH.screens.studies.render(container);
    await sleep(30);
    assert.ok(container.innerHTML.indexOf('data-rmd="study-sources-credit"') < 0, "no credit line without a database marker");
  });

  test("a PMID-only citation credits NLM only", async () => {
    const study = {
      id: "st_f20_3",
      label: "PMID only study",
      measure: "OR",
      inputs: { effect: 0.5, ciLower: 0.3, ciUpper: 0.8 },
      locator: { kind: "manual", citation: "PMID 40959673", page: "", section: "", table: "", quote: "" },
      quote: "",
      verified: false,
      version: 1
    };
    const sb = studiesSandbox([study]);
    const container = plainContainer();
    sb.win.SMD_RESEARCH.screens.studies.render(container);
    await sleep(30);
    const text = asText(container.innerHTML);
    assert.ok(text.indexOf(NOTICES.pubmed) >= 0, "NLM notice present");
    assert.ok(text.indexOf(NOTICES.europe_pmc) < 0, "no Europe PMC notice without a DOI");
    assert.ok(text.indexOf(NOTICES.crossref) < 0, "no Crossref notice without a DOI");
  });
});
