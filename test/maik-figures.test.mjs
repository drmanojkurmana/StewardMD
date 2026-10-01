/* test/maik-figures.test.mjs — related figures under a MaiK answer (functions/_figures.js).
 * A search step, never a model: pick the figure a trusted page is built around, skip logos and
 * junk, resolve relative URLs, and return nothing rather than a wrong image. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickFigure, findFigures } from "../functions/_figures.js";
import { TRUSTED_MEDICAL_DOMAINS } from "../functions/_search.js";

const PAGE = "https://www.med.unc.edu/medclerk/education/grading/hematuria/";
const HTML = `
<html><head><meta property="og:image" content="/img/unc-logo.png"></head><body>
<img src="/assets/logo.svg" alt="UNC School of Medicine logo" width="180" height="60">
<img src="https://cdn.example.org/spacer.gif" width="1" height="1">
<h2>AUA Microhematuria Evaluation Algorithm</h2>
<figure><img data-src="/files/aua-microhematuria-algorithm.png" alt="AUA Microhematuria Evaluation Algorithm" width="900" height="1200"><figcaption>Source: AUA 2020</figcaption></figure>
<img src="/img/campus-banner.jpg" alt="Campus" width="1600" height="400">
</body></html>`;

test("picks the figure the page is built around, not the logo, the banner or the tracking pixel", () => {
  const f = pickFigure(HTML, PAGE, "hematuria workup");
  assert.equal(f.img, "https://www.med.unc.edu/files/aua-microhematuria-algorithm.png");
  assert.match(f.alt, /Microhematuria Evaluation Algorithm/);
});

test("an empty src never resolves to the page itself; a srcset-only image uses its first candidate (aafp.org, production 2026-09-18)", () => {
  const page = "https://www.aafp.org/afp/2022/0700/acute-pancreatitis.html";
  const tag = '<title>Acute Pancreatitis: Diagnosis and Management</title><div class="aafp-article__figure"><img class="aafp-image__image" src="" srcset="https://dgnvxbcc3-res.cloudinary.com/image/upload/w_384/Journals/AFP/2022/0700/p1-f1-jpg.jpg 384w, https://dgnvxbcc3-res.cloudinary.com/image/upload/w_768/Journals/AFP/2022/0700/p1-f1-jpg.jpg 768w" alt="" width="1500"></div>';
  assert.equal(pickFigure(tag, page, "acute pancreatitis management").img, "https://dgnvxbcc3-res.cloudinary.com/image/upload/w_384/Journals/AFP/2022/0700/p1-f1-jpg.jpg");
  assert.equal(pickFigure('<figure><img src="" alt="Figure 1" width="900"></figure>', page, "acute pancreatitis management"), null, "no usable source -> nothing, never the page url");
});

test("relative and data-src URLs resolve against the page; http images are dropped", () => {
  const f = pickFigure('<img data-src="../x/algorithm-hematuria.png" alt="hematuria algorithm" width="800">', PAGE, "hematuria");
  assert.equal(f.img, "https://www.med.unc.edu/medclerk/education/grading/x/algorithm-hematuria.png");
  assert.equal(pickFigure('<img src="http://insecure.example/hematuria-algorithm.png" alt="hematuria algorithm" width="800">', PAGE, "hematuria"), null);
});

test("a page with only logos, icons and an unrelated og:image yields NOTHING (no wrong image, ever)", () => {
  const junk = '<meta property="og:image" content="/img/site-banner.jpg"><img src="/logo.png" alt="logo" width="300"><img src="/icons/share.svg" width="24">';
  assert.equal(pickFigure(junk, PAGE, "hematuria workup"), null);
});

test("og:image is accepted only when it names the topic or is plainly a figure, AND looks like an image file", () => {
  assert.equal(pickFigure('<meta property="og:image" content="/media/hematuria-algorithm.png">', PAGE, "hematuria").img, "https://www.med.unc.edu/media/hematuria-algorithm.png");
  assert.equal(pickFigure('<meta property="og:image" content="/media/hero.jpg">', PAGE, "hematuria"), null);
  // aafp.org (production, 2026-09-18): og:image was the article URL itself, text/html -> broken card.
  assert.equal(pickFigure('<meta property="og:image" content="https://www.aafp.org/afp/2022/0700/acute-pancreatitis">', "https://www.aafp.org/afp/2022/0700/acute-pancreatitis.html", "acute pancreatitis management"), null);
});

test("when a search returns only homepages, ONE reworded retry runs before giving up (hyperkalemia ECG, production 2026-09-18)", async () => {
  const searches = []; const realFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith("https://api.search.tinyfish.ai")) {
      const query = new URL(u).searchParams.get("query"); searches.push(query);
      const deep = /review article/.test(query);
      return { ok: true, json: async () => ({ results: deep
        ? [{ title: "Hyperkalaemia ECG Library", url: "https://litfl.com/hyperkalaemia-ecg-library/", snippet: "s" }]
        : [{ title: "LITFL", url: "https://litfl.com", snippet: "s" }, { title: "PMC", url: "https://pmc.ncbi.nlm.nih.gov", snippet: "s" }] }) };
    }
    return { ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => '<figure><img src="/wp-content/uploads/ECG-Hyperkalaemia-peaked-T.jpg" alt="Hyperkalaemia ECG" width="1024"></figure>' };
  };
  try {
    const r = await findFigures({ TINYFISH_API_KEY: "k" }, "hyperkalemia ECG changes");
    assert.deepEqual(searches, ["hyperkalemia ECG changes algorithm", "hyperkalemia ECG changes", "hyperkalemia ECG changes review article"]);
    assert.equal(r.length, 1); assert.match(r[0].img, /ECG-Hyperkalaemia-peaked-T\.jpg$/);
  } finally { global.fetch = realFetch; }
});

test("findFigures: untrusted pages and PDFs are skipped before any fetch; no key -> []", async () => {
  // TINYFISH_API_KEY absent: tinyfishSearch returns [] and so must we, without throwing.
  assert.deepEqual(await findFigures({}, "hematuria workup"), []);
  assert.deepEqual(await findFigures({ TINYFISH_API_KEY: "x" }, ""), []);
});

test("findFigures skips homepages, paywalled/blocking hosts and PDFs WITHOUT fetching them (production trace 2026-09-18)", async () => {
  const fetched = [];
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith("https://api.search.tinyfish.ai")) return { ok: true, json: async () => ({ results: [
      { title: "AASLD", url: "https://www.aasld.org/", snippet: "s" },                              // homepage
      { title: "AGA", url: "https://gastro.org", snippet: "s" },                                    // homepage, no slash
      { title: "UpToDate", url: "https://www.uptodate.com/contents/variceal-bleeding", snippet: "s" }, // paywalled
      { title: "Medscape", url: "https://emedicine.medscape.com/article/1/overview", snippet: "s" }, // 403 to the Worker
      { title: "Guideline PDF", url: "https://www.aasld.org/sites/default/files/varices.pdf", snippet: "s" },
      { title: "PMC", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/", snippet: "s" }
    ] }) };
    fetched.push(u);
    return { ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => '<title>Variceal bleeding</title><figure><img src="/blobs/varices-g0001.jpg" alt="Figure 1" width="800"></figure>' };
  };
  try {
    const r = await findFigures({ TINYFISH_API_KEY: "k" }, "variceal bleeding management", 3, { debug: true });
    assert.deepEqual(fetched, ["https://pmc.ncbi.nlm.nih.gov/articles/PMC1/"], "only the article page is read");
    assert.equal(r.length, 1); assert.equal(r[0].img, "https://pmc.ncbi.nlm.nih.gov/blobs/varices-g0001.jpg");
    assert.deepEqual(r._debug.map((d) => d.skip || "read"), ["homepage", "homepage", "no-figures-host", "no-figures-host", "pdf", "read"]);
  } finally { global.fetch = realFetch; }
});

test("trusted sources span the specialties (owner: a melena question must reach AASLD / ACG / AGA / ASGE)", () => {
  for (const d of ["aasld.org", "gi.org", "gastro.org", "asge.org", "bsg.org.uk", "acc.org", "escardio.org", "thoracic.org", "sccm.org", "kdigo.org", "nccn.org", "acog.org", "aap.org", "auanet.org", "rsna.org", "msdmanuals.com", "radiopaedia.org", "litfl.com"])
    assert.ok(TRUSTED_MEDICAL_DOMAINS.includes(d), "missing " + d);
  assert.ok(TRUSTED_MEDICAL_DOMAINS.length >= 80);
});

test("LIVE FINDINGS 2026-09-18: beacons and stock photos are never figures, even under on-topic text", () => {
  const dka = "https://www.ncbi.nlm.nih.gov/books/NBK560723/";
  // NCBI <noscript> stat beacon: an <img> with no alt sitting under a page full of the topic word.
  assert.equal(pickFigure('<p>Adult diabetic ketoacidosis management</p><noscript><img alt="" src="https://www.ncbi.nlm.nih.gov/stat?jsdisabled=true&amp;ncbi_db=books&amp;ncbi_pagename=Adult%20Diabetic%20Ketoacidosis"></noscript>', dka, "diabetic ketoacidosis management"), null);
  // Drupal stock photo next to on-topic prose, no alt naming the topic.
  assert.equal(pickFigure('<h2>DKA treatment</h2><p>diabetic ketoacidosis ...</p><img src="https://diabetes.org/sites/default/files/styles/program_card_392x560_/public/2023-09/co-worker-high-five.png.webp" alt="" width="392" height="560">', "https://diabetes.org/living-with-diabetes/dka", "diabetic ketoacidosis management"), null);
  // AAFP: alt="" and a journal file name, inside the article's figure wrapper (real markup).
  assert.equal(pickFigure('<title>Hematuria: Evaluation</title><div class="aafp-article__figure"><div class="aafp-image" data-testid="image-wrapper"><img class="aafp-image__image" src="https://dgnvxbcc3-res.cloudinary.com/image/upload/v1/Journals/AFP/2013/1201/p747-f2-jpg.jpg" alt="" width="1551" height="634"></div></div>', "https://www.aafp.org/afp/2013/1201/p747", "hematuria workup").img, "https://dgnvxbcc3-res.cloudinary.com/image/upload/v1/Journals/AFP/2013/1201/p747-f2-jpg.jpg");
  // Medscape: 1x1 placeholder src with the real thumbnail in data-src, inside inlineImage (real markup).
  assert.equal(pickFigure('<title>Hematuria Workup</title><!--VideoWidgets::figure--> <div class="inlineImage"> <a href="javascript:refImgShow(3)"><img src="//img.medscapestatic.com/pi/global/1x1.png" data-src="//img.medscapestatic.com/pi/meds/ckb/02/44702tn.jpg" alt="Microscopy of urinary sediment. Typical appearance" class="pborder"></a>', "https://emedicine.medscape.com/article/981898-workup", "hematuria workup").img, "https://img.medscapestatic.com/pi/meds/ckb/02/44702tn.jpg");
  // A real figure whose alt is only "Figure 1" still qualifies through the figure hint.
  assert.equal(pickFigure('<title>Melena: workup</title><figure><img src="https://cdn.ncbi.nlm.nih.gov/pmc/blobs/x/fped-09-780356-g0001.jpg" alt="Figure 1" width="800"></figure>', "https://pmc.ncbi.nlm.nih.gov/articles/PMC8692886/", "melena workup").img, "https://cdn.ncbi.nlm.nih.gov/pmc/blobs/x/fped-09-780356-g0001.jpg");
});

// Owner, 2026-09-27, over a strip of leg-ulcer photographs: "I wanted workup flowcharts; if they are
// absent show this". A PMC figure's alt is just "Figure 2"; what it shows is in the caption after it.
const PHOTO = '<figure><img src="/blobs/ulcer-g0001.jpg" alt="Venous leg ulcer on the medial malleolus" width="800"><figcaption>Venous leg ulcer. Wounds are irregular and shallow.</figcaption></figure>';
const ALGO = '<figure><img src="/blobs/ulcer-g0002.jpg" alt="Figure 2" width="800"><figcaption>Algorithm for the evaluation of a patient with a chronic leg ulcer.</figcaption></figure>';

test("on one page, a workup flowchart beats a better-scored photograph", () => {
  const f = pickFigure(PHOTO + ALGO, "https://pmc.ncbi.nlm.nih.gov/articles/PMC9/", "venous leg ulcer");
  assert.match(f.img, /ulcer-g0002\.jpg$/); assert.equal(f.diagram, true);
  const only = pickFigure(PHOTO, "https://pmc.ncbi.nlm.nih.gov/articles/PMC9/", "venous leg ulcer");
  assert.match(only.img, /ulcer-g0001\.jpg$/); assert.equal(only.diagram, false, "no flowchart: the photo is still the pick");
});

function fakeWeb(pages) {   // url -> html; every search returns every page
  const reads = [], searches = [];
  const fetchFn = async (url) => {
    const u = String(url);
    if (u.startsWith("https://api.search.tinyfish.ai")) { searches.push(new URL(u).searchParams.get("query")); return { ok: true, json: async () => ({ results: Object.keys(pages).map((url) => ({ title: "t", url, snippet: "s" })) }) }; }
    reads.push(u);
    return { ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => pages[u] || "" };
  };
  return { fetchFn, reads, searches };
}

test("across pages: flowcharts only when there are any, photographs as the fallback; each page read once", async () => {
  const realFetch = global.fetch;
  try {
    let w = fakeWeb({ "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/": PHOTO, "https://www.aafp.org/pubs/afp/issues/2019/0901/p1.html": ALGO });
    global.fetch = w.fetchFn;
    let r = await findFigures({ TINYFISH_API_KEY: "k" }, "venous leg ulcer");
    assert.deepEqual(w.searches, ["venous leg ulcer algorithm", "venous leg ulcer"], "the flowchart search runs beside the plain one");
    assert.equal(w.reads.length, 2, "a page both searches return is read once");
    assert.deepEqual(r.map((f) => f.img), ["https://www.aafp.org/blobs/ulcer-g0002.jpg"], "the photo is dropped when a flowchart exists");
    assert.ok(!("diagram" in r[0]) && !("score" in r[0]), "the response shape is unchanged");
    w = fakeWeb({ "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/": PHOTO });
    global.fetch = w.fetchFn;
    r = await findFigures({ TINYFISH_API_KEY: "k" }, "venous leg ulcer");
    assert.deepEqual(r.map((f) => f.img), ["https://pmc.ncbi.nlm.nih.gov/blobs/ulcer-g0001.jpg"], "no flowchart anywhere: the photo shows");
  } finally { global.fetch = realFetch; }
});

// ---- 2026-10-02: AJCC breast staging answered with a study table from a case-report paper ----
const SLNB_TITLE = "Metastasis from breast carcinoma to endometrial polyp";
const SLNB_PAGE = "https://pmc.ncbi.nlm.nih.gov/articles/PMC77/";
const SLNB_HTML = '<title>' + SLNB_TITLE + '</title><figure><img src="/blobs/slnb-table-g0003.jpg" alt="Table 2" width="900" height="500"><figcaption>Table 2. Sentinel lymph node biopsy studies in breast cancer.</figcaption></figure>';

test("figure hints / figure markup alone never qualify: the image must name a topic word (own text or page title)", () => {
  const pg = "https://pmc.ncbi.nlm.nih.gov/articles/PMC5/";
  assert.equal(pickFigure('<figure><img src="/blobs/fig-g0001.jpg" alt="Figure 1" width="800"><figcaption>An unrelated chart</figcaption></figure>', pg, "hematuria workup"), null);
  assert.equal(pickFigure('<title>Gout</title><figure><img src="/blobs/algorithm-g0001.jpg" alt="algorithm" width="800"></figure>', pg, "hematuria workup"), null);
  assert.ok(pickFigure('<figure><img src="/blobs/fig-g0001.jpg" alt="Hematuria algorithm" width="800"></figure>', pg, "hematuria workup"));
  assert.equal(pickFigure('<meta property="og:image" content="/media/algorithm.png">', pg, "hematuria"), null, "og:image needs the topic too");
});

test("a bare 'table' is not a workup diagram: a data table never outranks the topical figure", () => {
  const pg = "https://pmc.ncbi.nlm.nih.gov/articles/PMC6/";
  const html = '<figure><img src="/b/stag-g0001.jpg" alt="Breast cancer photo" width="800"></figure>' +
    '<figure><img src="/b/stag-g0002.jpg" alt="Table 1 breast cancer cohort" width="800"></figure>';
  const f = pickFigure(html, pg, "breast cancer");
  assert.equal(f.diagram, false);
});

test("AJCC breast staging: the SLNB study table on an unrelated case report is rejected; the staging figure wins", () => {
  assert.equal(pickFigure(SLNB_HTML, SLNB_PAGE, "AJCC breast cancer staging"), null, "no ajcc/staging word anywhere on that page");
  const ok = '<title>AJCC 8th edition breast cancer staging</title><figure><img src="/b/ajcc-g0001.jpg" alt="Anatomic stage groups" width="900"><figcaption>Breast cancer TNM staging</figcaption></figure>';
  assert.match(pickFigure(ok, "https://www.cancer.gov/x/staging", "AJCC breast cancer staging").img, /ajcc-g0001\.jpg$/);
});

test("findFigures skips case reports and unusual-site metastasis papers before reading them", async () => {
  const reads = []; const realFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith("https://api.search.tinyfish.ai")) return { ok: true, json: async () => ({ results: [
      { title: SLNB_TITLE, url: SLNB_PAGE, snippet: "s" },
      { title: "Granulomatous mastitis: a case report", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC78/", snippet: "s" },
      { title: "A case of breast cancer staging confusion", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC79/", snippet: "s" },
      { title: "Breast cancer staging (AJCC)", url: "https://www.cancer.gov/types/breast/staging", snippet: "s" }
    ] }) };
    reads.push(u);
    return { ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => '<title>AJCC breast staging</title><figure><img src="/b/ajcc-g0001.jpg" alt="AJCC breast cancer staging" width="900"></figure>' };
  };
  try {
    const r = await findFigures({ TINYFISH_API_KEY: "k" }, "AJCC breast staging", 3, { debug: true });
    assert.deepEqual(reads, ["https://www.cancer.gov/types/breast/staging"]);
    assert.equal(r.length, 1);
    assert.deepEqual(r._debug.filter((d) => d.skip).map((d) => d.skip), ["case-report", "case-report", "case-report"].slice(0, 3));
  } finally { global.fetch = realFetch; }
});
