/* Unit tests: ResearchMD pubconsent rich-text editor, HTML sanitiser,
 * HTML-to-DOCX formatting runs, empty-draft error, plain-text fallback, and RTL.
 * Run: node --test --experimental-test-module-mocks --experimental-sqlite test/research-pubconsent-editor.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pubconsent = require("../research-screen-pubconsent.js");

function bytesToStr(u8) {
  return Buffer.from(u8).toString("utf8");
}

describe("research-screen-pubconsent editor & docx unit tests", () => {
  test("sanitizeConsentHtml strips script, style, on*, links, and images while keeping allowed tags", () => {
    const dirty =
      '<script>alert("xss")</script>' +
      '<style>body{color:red}</style>' +
      '<h2 onclick="evil()" style="color:red; text-align:center">Consent Heading</h2>' +
      '<h3 style="text-align:right">Subheading</h3>' +
      '<p onmouseover="evil()">Hello <b>bold</b> <strong>strong</strong> <i>italic</i> <em>em</em> <u>under</u> <a href="https://evil.example" onclick="evil()">visit link</a><img src="x" onerror="evil()"><svg onload="evil()"><circle/></svg></p>' +
      '<div align="center" data-track="1">Centered div<br><span class="rmd-ce-sz-lg extra-bad">Large</span> <span class="rmd-ce-sz-sm">Small</span> <span class="rmd-ce-sz-md">Norm</span></div>' +
      '<ul><li>One</li></ul><ol><li>Two</li></ol>' +
      '<iframe src="https://evil.example"></iframe>';

    const clean = pubconsent.sanitizeConsentHtml(dirty);

    assert.equal(/<script/i.test(clean), false, "no script tag");
    assert.equal(/alert\(/i.test(clean), false, "no script body");
    assert.equal(/<style/i.test(clean), false, "no style tag");
    assert.equal(/display:none|color:red/i.test(clean), false, "disallowed style props stripped");
    assert.equal(/on(click|mouseover|error|load)/i.test(clean), false, "no event handlers");
    assert.equal(/<a\b|href=/i.test(clean), false, "no links survive");
    assert.equal(/<img\b|<svg\b|<iframe\b/i.test(clean), false, "no images/svg/iframe survive");
    assert.equal(/extra-bad|data-track/i.test(clean), false, "disallowed classes/attrs stripped");

    assert.match(clean, /<h2 style="text-align:center">Consent Heading<\/h2>/);
    assert.match(clean, /<h3 style="text-align:right">Subheading<\/h3>/);
    assert.match(clean, /<b>bold<\/b>/);
    assert.match(clean, /<strong>strong<\/strong>/);
    assert.match(clean, /<i>italic<\/i>/);
    assert.match(clean, /<em>em<\/em>/);
    assert.match(clean, /<u>under<\/u>/);
    assert.match(clean, /visit link/);
    assert.match(clean, /<div style="text-align:center">Centered div<br>/);
    assert.match(clean, /<span class="rmd-ce-sz-lg">Large<\/span>/);
    assert.match(clean, /<span class="rmd-ce-sz-sm">Small<\/span>/);
    assert.match(clean, /<span class="rmd-ce-sz-md">Norm<\/span>/);
    assert.match(clean, /<ul><li>One<\/li><\/ul>/);
    assert.match(clean, /<ol><li>Two<\/li><\/ol>/);
  });

  test("htmlToDocxParagraphs and createDocx emit <w:b/>, <w:i/>, <w:u>, w:jc, w:sz, w:bidi, and w:rtl", () => {
    const html =
      '<h2 style="text-align:center">Patient Consent</h2>' +
      '<p style="text-align:left">I <b>agree</b> to <i>all</i> <u>terms</u>.</p>' +
      '<p style="text-align:right"><span class="rmd-ce-sz-sm">Small note</span> <span class="rmd-ce-sz-md">Normal</span> <span class="rmd-ce-sz-lg">Large text</span></p>' +
      '<ul><li>Bullet one</li></ul>' +
      '<ol><li>Numbered one</li></ol>';

    const ltrXml = pubconsent.htmlToDocxParagraphs(html, false).join("");
    assert.match(ltrXml, /<w:b\/>/, "bold run emitted");
    assert.match(ltrXml, /<w:i\/>/, "italic run emitted");
    assert.match(ltrXml, /<w:u w:val="single"\/>/, "underline run emitted");
    assert.match(ltrXml, /<w:jc w:val="center"\/>/, "center alignment emitted");
    assert.match(ltrXml, /<w:jc w:val="left"\/>/, "left alignment emitted");
    assert.match(ltrXml, /<w:jc w:val="right"\/>/, "right alignment emitted");
    assert.match(ltrXml, /<w:sz w:val="18"\/>/, "small size emitted");
    assert.match(ltrXml, /<w:sz w:val="22"\/>/, "normal size emitted");
    assert.match(ltrXml, /<w:sz w:val="28"\/>/, "large size emitted");
    assert.match(ltrXml, /<w:sz w:val="32"\/>/, "h2 size emitted");
    assert.match(ltrXml, /\u2022 /, "bullet prefix emitted");
    assert.match(ltrXml, /1\. /, "numbered prefix emitted");

    const rtlXml = pubconsent.htmlToDocxParagraphs("<p>یہ رضامندی ہے</p>", true).join("");
    assert.match(rtlXml, /<w:bidi\/>/, "RTL paragraph emits w:bidi");
    assert.match(rtlXml, /<w:rtl\/>/, "RTL run emits w:rtl");
    assert.match(rtlXml, /<w:jc w:val="right"\/>/, "RTL paragraph defaults to right align");

    const docxBytes = pubconsent.createDocx("Consent Title", [
      { heading: "Urdu Section", html: "<p><b>رضامندی</b></p>", isRtl: true, size: 28 },
      { pageBreak: true },
      { heading: "English Section", html, isRtl: false, size: 24 }
    ]);
    const docxStr = bytesToStr(docxBytes);
    assert.match(docxStr, /<w:b\/>/);
    assert.match(docxStr, /<w:i\/>/);
    assert.match(docxStr, /<w:u w:val="single"\/>/);
    assert.match(docxStr, /<w:jc w:val="center"\/>/);
    assert.match(docxStr, /<w:sz w:val="18"\/>/);
    assert.match(docxStr, /<w:bidi\/>/);
    assert.match(docxStr, /<w:rtl\/>/);
  });

  test("plainTextToHtml and htmlToPlainText handle legacy plain-text records without *Html", () => {
    const plain = "Line 1 <script>\nLine 2\n\nParagraph 2";
    const html = pubconsent.plainTextToHtml(plain);
    assert.equal(html, "<p>Line 1 &lt;script&gt;<br>Line 2</p><p>Paragraph 2</p>");
    const back = pubconsent.htmlToPlainText(html);
    assert.equal(back, "Line 1 <script>\nLine 2\n\nParagraph 2");
  });

  test("RTL helpers identify Urdu and provide Nastaliq font stack", () => {
    assert.equal(pubconsent.isRtlLang("ur"), true);
    assert.equal(pubconsent.isRtlLang("Urdu"), true);
    assert.equal(pubconsent.isRtlLang("hi"), false);
    assert.equal(pubconsent.langCodeFor("Urdu"), "ur");
    assert.match(pubconsent.fontStackFor("ur"), /Noto Nastaliq Urdu/);
  });

  test("pubconsent source uses ResearchMD theme tokens, updated cost text, and zero em/en dashes", () => {
    const src = readFileSync(new URL("../research-screen-pubconsent.js", import.meta.url), "utf8");
    assert.match(src, /Costs about 2 MaiK tokens/, "uses standard cost text");
    assert.doesNotMatch(src, /Estimated cost:/, "old cost text removed");
    assert.doesNotMatch(src, /#071318|#1f363d|#8ea3a6|#ff6b6b|#ff8787/i, "hardcoded dark colours removed");
    assert.match(src, /MaiK returned an empty consent\. Try again, or type it below\./, "empty draft error copy present");
    assert.equal(/[\u2013\u2014]/.test(src), false, "no em or en dashes in research-screen-pubconsent.js");
  });

  test("tutorial mock returns realistic demo draft for publication_consent and preserves other tasks", async () => {
    const origWin = globalThis.window;
    const storeMap = {};
    globalThis.localStorage = {
      getItem: (k) => (k in storeMap ? storeMap[k] : null),
      setItem: (k, v) => { storeMap[k] = String(v); },
      removeItem: (k) => { delete storeMap[k]; }
    };
    const fakeApi = {
      request: async () => ({ ok: true }),
      upload: async () => ({})
    };
    globalThis.SMD_RESEARCH = {
      api: fakeApi,
      store: {
        getState: () => ({ projects: [], studies: {}, runs: {} }),
        setActiveProject: () => {},
        getActiveProject: () => ({ id: "tut_case", serverId: "tut_case", tutorial: true, tutorialKey: "case" })
      },
      screens: { pubconsent }
    };
    globalThis.window = globalThis;

    const tut = require("../research-tutorial.js");
    tut.startTutorial("case", { reset: true });

    const enRes = await fakeApi.request("POST", "/v1/projects/tut_case/ai-draft", {
      task: "publication_consent",
      input: { language: "English", includesImages: true, journalName: "BMJ Case Reports" }
    });
    assert.ok(enRes.draft && enRes.draft.english.includes("PATIENT CONSENT FOR PUBLICATION"), "English tutorial draft uses consent template");
    assert.equal(enRes.draft.local, "", "English draft has empty local field");
    assert.equal(enRes.draft.languageName, "English");

    const hiRes = await fakeApi.request("POST", "/v1/projects/tut_case/ai-draft", {
      task: "publication_consent",
      input: { language: "Hindi", includesImages: false }
    });
    assert.ok(hiRes.draft && hiRes.draft.english.includes("PATIENT CONSENT FOR PUBLICATION"), "Non-English tutorial draft includes English copy");
    assert.ok(hiRes.draft.local && /MaiK/i.test(hiRes.draft.local) && /Hindi/i.test(hiRes.draft.local), "Non-English tutorial draft includes clearly labelled demo local line");
    assert.equal(hiRes.draft.languageName, "Hindi");

    const otherRes = await fakeApi.request("POST", "/v1/projects/tut_case/ai-draft", {
      task: "protocol",
      input: {}
    });
    assert.deepEqual(otherRes.draft, {}, "other ai-draft tasks keep existing mock");

    if (origWin === undefined) delete globalThis.window;
    else globalThis.window = origWin;
  });
});
