/* PrepNucleus Layer C: the student's source, read on the phone. window.PREP_SRC. ES5.
   Contract: vault/plans/PrepNucleus-LayerC.md 4 (prep-source.js), 6.0 (sentences), 8.5 (prepScrub), 9.3 (caps).

   A source is pasted notes or a digital PDF. Both become pages of lines { tx, head }, then one list of sentences
   numbered across the whole document { n, p, h, tx, s } (number, page, heading, text, section id). Headings split the
   document into sections "sec-0", "sec-1", ...: in a PDF a heading is a short line set in a clearly larger font than
   the body (font size from textContent.items[].transform); in notes it is a "#" line, a short ALL CAPS line or a short
   line ending in a colon. Running headers, footers and page numbers that repeat across pages are dropped.
   PDF: pdf.js text layer from the vendored copy (/vendor/pdfjs, the same files icu.js, medlist.js and home.js load),
   loaded only when a PDF is picked. No CDN. Scanned or garbled pages are rendered and read by on-device OCR in the
   app (Phase 3b, readPages below); the web build skips them.
   Caps: 60 pages, 300,000 characters per deck. prepScrub finds and removes emails, phone numbers, Aadhaar-like
   12-digit numbers, hospital ids (MRN, UHID, IP or OP no, reg no, bed or ward with a number) and "patient name"
   to the end of the line, keeping every other number and every newline. Nothing in this file sends anything. */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  var PAGE_CAP = 60, CHARS_CAP = 300000, MIN_CHARS = 200, CHUNK_TOK = 5000, SCANNED_CHARS = 200;

  function fixText(s) {
    return String(s == null ? "" : s)
      .replace(/\uFB00/g, "ff").replace(/\uFB01/g, "fi").replace(/\uFB02/g, "fl").replace(/\uFB03/g, "ffi").replace(/\uFB04/g, "ffl")
      .replace(/[\u00A0\u2007\u202F\t]/g, " ").replace(/\u00AD/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-");
  }
  function squash(s) { return String(s).replace(/ {2,}/g, " ").replace(/^ +| +$/g, ""); }
  function words(s) { var m = String(s).match(/\S+/g); return m ? m.length : 0; }

  /* ---------- PDF text layer ---------- */
  // Font size of a text item from its transform [a, b, c, d, e, f]: the length of the vertical vector (c, d).
  function fontSize(tr) {
    if (!tr || tr.length < 4) return 0;
    var c = +tr[2] || 0, d = +tr[3] || 0;
    return Math.round(Math.sqrt(c * c + d * d) * 10) / 10;
  }
  /* pdf.js textContent.items -> lines [{ tx, size }]. Items stay in content-stream order (reading order for most
     PDFs, including two-column ones). A line ends at hasEOL or when the baseline moves by more than half the font
     size; a space is added between items with a visible gap. size = the font size carrying most of the line's text. */
  function itemsToLines(items) {
    var lines = [], cur = null;
    function close() {
      if (!cur) return;
      var tx = squash(fixText(cur.tx)), best = 0, bw = -1;
      for (var k in cur.w) if (cur.w[k] > bw) { bw = cur.w[k]; best = +k; }
      if (tx) lines.push({ tx: tx, size: best });
      cur = null;
    }
    (items || []).forEach(function (it) {
      var s = it && typeof it.str === "string" ? it.str : "", tr = it && it.transform, size = fontSize(tr);
      var x = tr ? +tr[4] || 0 : 0, y = tr ? +tr[5] || 0 : 0;
      if (s.replace(/\s+/g, "")) {
        if (cur && cur.n && Math.abs(y - cur.y) > Math.max(2, Math.max(size, cur.size0) * 0.5)) close();
        if (!cur) cur = { tx: "", w: {}, y: y, end: null, n: 0, size0: size };
        if (cur.n && cur.end != null && x > cur.end + Math.max(1, size * 0.15) && !/\s$/.test(cur.tx) && !/^\s/.test(s)) cur.tx += " ";
        cur.tx += s; cur.n++; cur.y = y;
        cur.w[size] = (cur.w[size] || 0) + s.replace(/\s+/g, "").length;
        cur.end = x + (+it.width || 0);
      } else if (cur && s) cur.tx += " ";
      if (it && it.hasEOL) close();
    });
    close();
    return lines;
  }
  // The body font size: the size that carries the most characters across the document.
  function bodySize(pages) {
    var w = {}, best = 0, bw = -1;
    (pages || []).forEach(function (pg) { pg.lines.forEach(function (l) { if (l.size) w[l.size] = (w[l.size] || 0) + l.tx.length; }); });
    for (var k in w) if (w[k] > bw) { bw = w[k]; best = +k; }
    return best;
  }
  // A heading: clearly larger than the body (15% and at least 1 pt), short, has letters, does not end like a sentence.
  function isHeadingBySize(line, body) {
    if (!body || !line.size) return false;
    var tx = line.tx;
    return line.size >= body * 1.15 && line.size - body >= 1 && words(tx) <= 14 && tx.length <= 120 && /[A-Za-z]{2}/.test(tx) && !/[.;,]$/.test(tx);
  }
  // pages [{ p, lines: [{ tx, size }] }] -> the same pages with head flags from font size.
  // OCR lines carry no font size, so they use the notes rules (short ALL CAPS or colon line).
  function markHeadings(pages) {
    var body = bodySize(pages);
    return pages.map(function (pg) {
      return { p: pg.p, ocr: !!pg.ocr, lines: pg.lines.map(function (l) {
        if (!l.ocr) return { tx: l.tx, head: isHeadingBySize(l, body) };
        var h = isNoteHeading(l.tx);
        return { tx: h ? l.tx.replace(/^#{1,6}\s+/, "").replace(/:$/, "") : l.tx, head: h };
      }) };
    });
  }

  /* ---------- pasted notes ---------- */
  function isNoteHeading(tx) {
    if (/^#{1,6}\s+\S/.test(tx)) return true;
    if (tx.length > 60 || words(tx) > 8 || !/[A-Za-z]{2}/.test(tx) || /[.?!;,]$/.test(tx)) return false;
    var letters = tx.replace(/[^A-Za-z]/g, "");
    if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
    return /:$/.test(tx) && words(tx) <= 6;
  }
  // Pasted notes are one page (p = 1). A form feed (\f) starts a new page, so text copied page by page keeps them.
  function notesToPages(text) {
    var pages = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\f");
    return pages.map(function (pt, i) {
      var lines = [];
      pt.split("\n").forEach(function (raw) {
        var tx = squash(fixText(raw));
        if (!tx) { lines.push({ tx: "", head: false, gap: true }); return; }
        var head = isNoteHeading(tx);
        lines.push({ tx: head ? tx.replace(/^#{1,6}\s+/, "").replace(/:$/, "") : tx, head: head });
      });
      return { p: i + 1, lines: lines };
    });
  }

  /* ---------- cleaning ---------- */
  // Drop running headers and footers (a line among the first or last two of a page that repeats, digits aside, on at
  // least half the pages, minimum 3) and bare page numbers ("12", "Page 3 of 40").
  function stripRepeats(pages) {
    var key = function (tx) { return tx.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim(); };
    var edge = function (pg, i) { var n = pg.lines.length; return i < 2 || i >= n - 2; };
    var cnt = {};
    pages.forEach(function (pg) {
      var seen = {};
      pg.lines.forEach(function (l, i) { if (!edge(pg, i) || !l.tx) return; var k = key(l.tx); if (!seen[k]) { seen[k] = 1; cnt[k] = (cnt[k] || 0) + 1; } });
    });
    var min = Math.max(3, Math.ceil(pages.length / 2));
    return pages.map(function (pg) {
      return { p: pg.p, ocr: !!pg.ocr, lines: pg.lines.filter(function (l, i) {
        if (!l.tx) return true;
        if (/^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i.test(l.tx.trim())) return false;
        return !(edge(pg, i) && pages.length >= 3 && cnt[key(l.tx)] >= min);
      }) };
    });
  }

  /* ---------- sentences ---------- */
  var ABBR = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|Prof|Fig|Figs|approx|No|Nos|St|al|cf|Inc|Ltd|Jr|Sr|viz|resp|Vol|Eq|Ref|Tab|Ch|pp|Sec|Dept|Hosp|Univ)\.$/i;
  var MAX_SENT = 500;
  function hardWrap(s) {
    if (s.length <= MAX_SENT) return [s];
    var out = [], parts = s.split(/;\s+/);
    parts.forEach(function (p, i) {
      p = p + (i < parts.length - 1 ? ";" : "");
      while (p.length > MAX_SENT) {
        var cut = p.lastIndexOf(" ", MAX_SENT);
        if (cut < MAX_SENT / 2) cut = MAX_SENT;
        out.push(p.slice(0, cut).trim()); p = p.slice(cut).trim();
      }
      if (p) out.push(p);
    });
    return out;
  }
  /* Text -> sentences with their start offsets. Splits after . ? ! (and closing quotes or brackets) followed by space
     and a capital, digit or bracket; not after a known abbreviation or a single initial, never inside "1.5". */
  function splitSentencesAt(text) {
    var out = [], re = /[.?!]+["'\u201D\u2019)\]]*\s+/g, start = 0, m;
    while ((m = re.exec(text))) {
      var end = m.index + m[0].length, before = text.slice(start, m.index + 1), next = text.charAt(end);
      if (!/[A-Z0-9(\["'\u201C\u2018]/.test(next)) continue;
      if (ABBR.test(before) || /(?:^|\s)[A-Z]\.$/.test(before)) continue;
      var s = text.slice(start, end).trim();
      if (s) out.push({ tx: s, at: start });
      start = end;
    }
    var last = text.slice(start).trim();
    if (last) out.push({ tx: last, at: start });
    return out;
  }
  function splitSentences(text) { var out = []; splitSentencesAt(squash(text)).forEach(function (s) { out = out.concat(hardWrap(s.tx)); }); return out; }

  var BULLET = /^(?:[-*\u2022\u25AA\u25CF\u2023\u2043]|\d{1,2}[.)]|[a-z][.)])\s+/;
  /* pages [{ p, lines: [{ tx, head, gap? }] }] -> { sents: [{ n, p, h, tx, s }], sections: [{ id, title }] }.
     Body lines join into paragraphs (a line ending in a hyphen joins the next word); a paragraph breaks at a blank
     line, a bullet or a heading. With lineBreaks (notes) every line is its own paragraph unless it continues the one
     before (starts in lower case, or the line before ends in a comma, bracket, slash or hyphen). */
  function buildDoc(pages, opts) {
    opts = opts || {};
    var sents = [], sections = [], sec = null, para = [], ocrP = {};
    (pages || []).forEach(function (pg) { if (pg.ocr) ocrP[pg.p] = 1; });
    function newSection(title) {
      if (sec && !sec.used) { sec.title = (sec.title ? sec.title + ": " : "") + title; sec.title = sec.title.slice(0, 120); return; }
      sec = { id: "sec-" + sections.length, title: title, used: false };
      sections.push(sec);
    }
    function flush() {
      if (!para.length) return;
      var text = "", marks = [];
      para.forEach(function (seg) {
        if (text && /[A-Za-z]-$/.test(text) && /^[a-z]/.test(seg.tx)) text = text.slice(0, -1);
        else if (text) text += " ";
        marks.push({ at: text.length, p: seg.p });
        text += seg.tx;
      });
      para = [];
      if (!sec) newSection(opts.title || "");
      splitSentencesAt(text).forEach(function (s) {
        var p = marks[0].p;
        for (var i = 0; i < marks.length && marks[i].at <= s.at; i++) p = marks[i].p;
        hardWrap(s.tx).forEach(function (tx) {
          if (!/[A-Za-z0-9]/.test(tx.replace(/\[removed\]/g, ""))) return;   // nothing left after prepScrub
          var sn = { n: sents.length + 1, p: p, h: sec.title, tx: tx, s: sec.id };
          if (ocrP[p]) sn.o = 1;   // read by on-device OCR (kept on the phone; chunkPayload sends n, p, h, tx only)
          sents.push(sn);
          sec.used = true;
        });
      });
    }
    (pages || []).forEach(function (pg) {
      pg.lines.forEach(function (l) {
        if (l.gap || !l.tx) { flush(); return; }
        if (l.head) { flush(); newSection(l.tx); return; }
        var prev = para.length ? para[para.length - 1].tx : "";
        if (BULLET.test(l.tx) || (prev && opts.lineBreaks && !/^[a-z]/.test(l.tx) && !/[,(\/-]$/.test(prev))) flush();
        para.push({ tx: BULLET.test(l.tx) ? l.tx.replace(BULLET, "") : l.tx, p: pg.p });
      });
      if (opts.lineBreaks) flush();
    });
    flush();
    return { ocrPages: Object.keys(ocrP).map(Number).sort(function (a, b) { return a - b; }), sents: sents, sections: sections.filter(function (s) { return s.used; }).map(function (s) { return { id: s.id, title: s.title || opts.title || "General" }; }) };
  }
  // Notes keep their line structure (a line ending a sentence ends a paragraph); PDFs join wrapped lines.
  function docFromNotes(text, title) { return buildDoc(notesToPages(text), { title: title, lineBreaks: true }); }
  function docFromPdfPages(pages, title) { return buildDoc(markHeadings(stripRepeats(pages)), { title: title }); }
  function docText(doc) { return doc.sents.map(function (s) { return s.tx; }).join("\n"); }

  /* ---------- scanned pages (Phase 3b): the text layer, or on-device OCR ---------- */
  /* A page is read by OCR when its text layer gives under 200 characters or more than 10% non-words (LayerC 12).
     OCR runs on the phone only (Apple Vision on iOS, ML Kit on Android, through native-bridge.js SMD_NATIVE.ocr) and
     never costs AI tokens. The web build has no OCR (LayerC 2): such a page keeps whatever text layer it has, or is
     skipped. At most OCR_PAGE_CAP pages a deck are OCR'd, each within OCR_PAGE_MS. */
  var OCR_PAGE_CAP = 20, OCR_PAGE_MS = 30000, NONWORD_MAX = 0.1, FC = String.fromCharCode;
  var LETTERS = "A-Za-z0-9" + FC(0xC0) + "-" + FC(0x24F) + FC(0x370) + "-" + FC(0x3FF);
  var HAS_ALNUM = new RegExp("[" + LETTERS + "]");
  // A word: letters (Latin, accented, Greek), digits, degree, plus-minus and micro signs, and the joiners medical
  // text uses (B12, PML-RARA, t(15;17), 1.5, 45mg/m2, 90%).
  var WORD = new RegExp("^[" + LETTERS + FC(0xB0, 0xB1, 0xB5) + ".,;:()\\[\\]/%+'&=<>*-]+$");
  var EDGE = /^[("'\[{<]+|[)"'\]}>.,;:!?*]+$/g;
  // Share of tokens that are not words. Tokens of plain ASCII punctuation only (bullets, dashes) are not counted.
  function nonWordRatio(text) {
    var toks = String(text == null ? "" : text).split(/\s+/), n = 0, bad = 0;
    toks.forEach(function (t) {
      if (!t || /^[!-\/:-@\[-`{-~]+$/.test(t)) return;
      n++;
      var c = t.replace(EDGE, "");
      if (!c || !HAS_ALNUM.test(c) || !WORD.test(c)) bad++;
    });
    return n ? bad / n : 0;
  }
  function textChars(lines) { var c = 0; (lines || []).forEach(function (l) { c += String(l.tx || "").replace(/\s+/g, "").length; }); return c; }
  /* What to do with one page from its text-layer lines: { use: "text" | "ocr" | "skip", why }.
     why: "" (good text layer), "little-text", "garbled", "no-text" (nothing to read without OCR). */
  function pageDecision(lines, canOcr) {
    var chars = textChars(lines), garbled = chars > 0 && nonWordRatio((lines || []).map(function (l) { return l.tx; }).join(" ")) > NONWORD_MAX;
    if (chars >= SCANNED_CHARS && !garbled) return { use: "text", why: "" };
    var why = garbled ? "garbled" : chars ? "little-text" : "no-text";
    if (canOcr) return { use: "ocr", why: why };
    if (garbled) return { use: "skip", why: "garbled" };
    return chars ? { use: "text", why: why } : { use: "skip", why: "no-text" };
  }
  // SMD_NATIVE.ocr result { text, lines } -> page lines { tx, size: 0, ocr: true }.
  function ocrToLines(res) {
    var raw = res && res.lines && res.lines.length ? res.lines : String((res && res.text) || "").split(/\r?\n/);
    var out = [];
    raw.forEach(function (l) { var tx = squash(fixText(l)); if (tx) out.push({ tx: tx, size: 0, ocr: true }); });
    return out;
  }
  // OCR wins when the text layer was garbled or OCR read more.
  function pickOcr(textLines, ocrLines, why) { return ocrLines.length && (why === "garbled" || textChars(ocrLines) > textChars(textLines)); }
  function withTimeout(p, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error("ocr-slow")); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  /* readPages(doc, pageList, onPage?, opts?) -> { pages: [{ p, lines, ocr? }], ocrPages, skipped: [{ p, why }], scanned }.
     doc is a pdf.js document (getPage -> getTextContent). opts.render(page) -> Promise(image data URL) and
     opts.ocr(dataUrl) -> Promise({ text, lines }) turn OCR on; without both, no page is OCR'd. onPage(done, total,
     phase) reports progress, phase "text" then "ocr". skipped why: "no-text" | "garbled" | "ocr-cap" | "ocr-failed".
     scanned lists every page whose text layer was not good enough. */
  function readPages(doc, pageList, onPage, opts) {
    opts = opts || {};
    var canOcr = !!(opts.ocr && opts.render), cap = opts.ocrCap || OCR_PAGE_CAP, ms = opts.ocrMs || OCR_PAGE_MS;
    var got = {}, i = 0, k = 0, ocrList = [], skipped = [], ocrPages = [], scanned = [];
    function textPass() {
      if (i >= pageList.length) return Promise.resolve();
      var p = pageList[i++];
      return doc.getPage(p).then(function (page) {
        return page.getTextContent().then(function (tc) {
          var lines = itemsToLines(tc.items), d = pageDecision(lines, canOcr);
          got[p] = { page: page, lines: lines, d: d, use: null };
          if (d.why) scanned.push(p);
          if (d.use === "ocr") { if (ocrList.length < cap) ocrList.push(p); else { var d2 = pageDecision(lines, false); got[p].d = d2.use === "skip" ? { use: "skip", why: "ocr-cap" } : d2; } }
          if (onPage) onPage(i, pageList.length, "text");
          return textPass();
        });
      });
    }
    function fallback(p, why) { var d = pageDecision(got[p].lines, false); got[p].d = d.use === "skip" ? { use: "skip", why: why } : d; }
    function ocrPass() {
      if (k >= ocrList.length) return Promise.resolve();
      var p = ocrList[k++], g = got[p];
      return Promise.resolve().then(function () { return opts.render(g.page); }).then(function (img) { return withTimeout(opts.ocr(img), ms); }).then(function (res) {
        var ol = ocrToLines(res);
        if (pickOcr(g.lines, ol, g.d.why)) { g.lines = ol; g.ocr = true; ocrPages.push(p); g.d = { use: "text", why: "" }; }
        else fallback(p, "ocr-failed");
      }, function () { fallback(p, "ocr-failed"); }).then(function () { if (onPage) onPage(k, ocrList.length, "ocr"); return ocrPass(); });
    }
    return textPass().then(ocrPass).then(function () {
      var pages = [];
      pageList.forEach(function (p) {
        var g = got[p];
        if (g.d.use === "skip") { skipped.push({ p: p, why: g.d.why }); return; }
        if (g.lines.length) pages.push(g.ocr ? { p: p, lines: g.lines, ocr: true } : { p: p, lines: g.lines });
      });
      return { pages: pages, ocrPages: ocrPages, skipped: skipped, scanned: scanned };
    });
  }

  /* ---------- pages and caps ---------- */
  function defaultPages(total) { return total <= 1 ? "1" : "1-" + Math.min(total, PAGE_CAP); }
  // "1-20, 25" -> { pages: [1..20, 25] } or { error } in plain words.
  function parsePages(spec, total, cap) {
    cap = cap || PAGE_CAP;
    var out = {}, bad = null, parts = String(spec || "").replace(/\s+/g, "").split(",");
    parts.forEach(function (part) {
      if (!part || bad) return;
      var m = part.match(/^(\d{1,4})(?:-(\d{1,4}))?$/);
      if (!m) { bad = "Write pages like 1-20, 25."; return; }
      var a = +m[1], b = m[2] ? +m[2] : a;
      if (a < 1 || b < a) { bad = "Write pages like 1-20, 25."; return; }
      if (a > total) { bad = "This PDF has " + total + " pages."; return; }
      for (var i = a; i <= Math.min(b, total); i++) out[i] = 1;
    });
    if (bad) return { error: bad };
    var pages = Object.keys(out).map(Number).sort(function (x, y) { return x - y; });
    if (!pages.length) return { error: "Pick at least one page." };
    if (pages.length > cap) return { error: "Pick " + cap + " pages or fewer. You picked " + pages.length + "." };
    return { pages: pages };
  }
  // pages -> [first, last] for the manifest.
  function pageSpan(pages) { return pages && pages.length ? [pages[0], pages[pages.length - 1]] : null; }
  // The deck-level checks before anything is sent: enough text, not too much, not too many pages.
  function capCheck(doc, pageCount) {
    var chars = 0;
    doc.sents.forEach(function (s) { chars += s.tx.length + 1; });
    if (pageCount > PAGE_CAP) return { error: "Pick " + PAGE_CAP + " pages or fewer." };
    if (chars > CHARS_CAP) return { error: "This source has too much text for one deck. Pick fewer pages or paste less." };
    if (chars < MIN_CHARS || doc.sents.length < 3) return { error: "There is too little text to make questions. Add at least a paragraph." };
    return { ok: true, chars: chars };
  }

  /* ---------- chunks (the facts op takes one chunk of at most 6,000 tokens) ---------- */
  function estTokens(s) { return Math.ceil(String(s).length / 4) + 4; }
  // Consecutive sentences of one section, up to maxTok estimated tokens each.
  function chunkSentences(sents, maxTok) {
    maxTok = maxTok || CHUNK_TOK;
    var chunks = [], cur = null;
    (sents || []).forEach(function (s) {
      var t = estTokens(s.tx + s.h);   // the server counts text and heading at chars / 4 (6,000 max)
      if (!cur || cur.sec !== s.s || (cur.tok + t > maxTok && cur.sents.length)) { cur = { i: chunks.length, sec: s.s, tok: 0, sents: [] }; chunks.push(cur); }
      cur.sents.push(s); cur.tok += t;
    });
    return chunks;
  }
  // Facts start with the first chunk of each section, then the second of each, and so on (6.0, lazy first 10).
  function chunkOrder(chunks) {
    var by = {}, secs = [], out = [];
    (chunks || []).forEach(function (c) { if (!by[c.sec]) { by[c.sec] = []; secs.push(c.sec); } by[c.sec].push(c.i); });
    for (var r = 0, more = true; more; r++) {
      more = false;
      secs.forEach(function (s) { if (r < by[s].length) { out.push(by[s][r]); more = true; } });
    }
    return out;
  }
  // What the facts op receives: { i, sents: [{ n, p, h, tx }] } (the local section id stays on the phone).
  function chunkPayload(c) { return { i: c.i, sents: c.sents.map(function (s) { return { n: s.n, p: s.p, h: s.h, tx: s.tx }; }) }; }

  /* ---------- prepScrub (8.5): same rules as the server; the phone uses it to warn, then to clean ---------- */
  var SCRUB = [
    ["email", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
    ["name", /\b(?:patient|pt)(?:'s)?\.?\s*name\b[^\n]*|\bname\s+of\s+(?:the\s+)?patient\b[^\n]*/gi],
    ["id", /\b(?:MRN|UHID|CR\s*No|IP\s*No|IPD\s*No|OP\s*No|OPD\s*No|Reg(?:istration)?\.?\s*No)\b\.?\s*[:#-]?\s*(?=[A-Z0-9\/-]*\d)[A-Z0-9][A-Z0-9\/-]*/gi],
    ["id", /\b(?:bed|ward)\s*(?:no\.?|number)?\s*[:#-]?\s*[A-Z]?\d+[A-Z0-9\/-]*\b/gi],
    ["aadhaar", /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g],
    ["phone", /(?:\+91[ -]?)?\b0?[6-9]\d{4}[ -]?\d{5}\b|\+91[ -]?\d{10}\b|\b\d{3}[ -]\d{3}[ -]\d{4}\b|\b0\d{2,4}[ -]\d{3,4}[ -]?\d{4}\b/g]
  ];
  // Three year-like groups ("2019 2020 2021") are not an Aadhaar number.
  function yearsOnly(m) { var g = m.replace(/\D/g, "").match(/\d{4}/g) || []; return g.length === 3 && g.every(function (x) { return /^(19|20)\d\d$/.test(x); }); }
  function scrubWith(text, onHit) {
    var s = String(text == null ? "" : text);
    SCRUB.forEach(function (r) {
      s = s.replace(r[1], function (m) {
        if (r[0] === "aadhaar" && yearsOnly(m)) return m;
        onHit(r[0]);
        return "[removed]";
      });
    });
    return s;
  }
  function scrubFind(text) {
    var f = { email: 0, phone: 0, aadhaar: 0, id: 0, name: 0, total: 0 };
    scrubWith(text, function (k) { f[k]++; f.total++; });
    return f;
  }
  function prepScrub(text) { return scrubWith(text, function () {}); }
  function scrubSummary(f) {
    var out = [], one = function (n, a, b) { if (n) out.push(n + " " + (n === 1 ? a : b)); };
    one(f.name, "patient name", "patient names"); one(f.phone, "phone number", "phone numbers"); one(f.email, "email address", "email addresses");
    one(f.aadhaar, "Aadhaar-like number", "Aadhaar-like numbers"); one(f.id, "hospital ID or bed number", "hospital IDs or bed numbers");
    return out.join(", ");
  }

  var PURE = {
    PAGE_CAP: PAGE_CAP, CHARS_CAP: CHARS_CAP, MIN_CHARS: MIN_CHARS, CHUNK_TOK: CHUNK_TOK, SCANNED_CHARS: SCANNED_CHARS,
    fixText: fixText, fontSize: fontSize, itemsToLines: itemsToLines, bodySize: bodySize, isHeadingBySize: isHeadingBySize, markHeadings: markHeadings,
    isNoteHeading: isNoteHeading, notesToPages: notesToPages, stripRepeats: stripRepeats, splitSentences: splitSentences, buildDoc: buildDoc,
    docFromNotes: docFromNotes, docFromPdfPages: docFromPdfPages, docText: docText, defaultPages: defaultPages, parsePages: parsePages, pageSpan: pageSpan,
    capCheck: capCheck, estTokens: estTokens, chunkSentences: chunkSentences, chunkOrder: chunkOrder, chunkPayload: chunkPayload,
    scrubFind: scrubFind, prepScrub: prepScrub, scrubSummary: scrubSummary,
    OCR_PAGE_CAP: OCR_PAGE_CAP, OCR_PAGE_MS: OCR_PAGE_MS, nonWordRatio: nonWordRatio, textChars: textChars, pageDecision: pageDecision, ocrToLines: ocrToLines,
    pickOcr: pickOcr, readPages: readPages
  };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser: pdf.js ================= */
  var PDFJS = "/vendor/pdfjs/pdf.min.js", PDFJS_W = "/vendor/pdfjs/pdf.worker.min.js", libP = null;
  function loadPdfJs() {
    if (G.pdfjsLib) { try { G.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_W; } catch (e) {} return Promise.resolve(G.pdfjsLib); }
    if (libP) return libP;
    libP = new Promise(function (res, rej) {
      var s = G.document.createElement("script");
      s.src = PDFJS;
      s.onload = function () { var lib = G.pdfjsLib; if (!lib) { libP = null; return rej(new Error("pdf-load")); } try { lib.GlobalWorkerOptions.workerSrc = PDFJS_W; } catch (e) {} res(lib); };
      s.onerror = function () { libP = null; rej(new Error("pdf-load")); };
      G.document.head.appendChild(s);
    });
    return libP;
  }
  function readFile(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (res, rej) { var fr = new G.FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { rej(fr.error); }; fr.readAsArrayBuffer(file); });
  }
  // file -> { doc, pages: total, name }. The file is read in memory only; it is never copied or sent.
  function openPdf(file) {
    var lib;
    return loadPdfJs().then(function (l) { lib = l; return readFile(file); }).then(function (buf) {
      return lib.getDocument({ data: new Uint8Array(buf) }).promise;
    }).then(function (doc) { return { doc: doc, pages: doc.numPages, name: String(file.name || "Document.pdf") }; });
  }
  // One page -> a JPEG data URL for OCR, about 2,000 px on the long side, on white (a transparent canvas would
  // encode as black). The canvas is released at once.
  function renderPage(page) {
    var vp1 = page.getViewport({ scale: 1 }), scale = Math.min(3, Math.max(1, 2000 / Math.max(vp1.width, vp1.height)));
    var vp = page.getViewport({ scale: scale }), cv = G.document.createElement("canvas"), cx = cv.getContext("2d");
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
    return page.render({ canvasContext: cx, viewport: vp }).promise.then(function () { var u = cv.toDataURL("image/jpeg", 0.85); cv.width = 0; cv.height = 0; return u; });
  }
  // On-device OCR through native-bridge.js; null on the web build (no SMD_NATIVE there).
  function nativeOcr() {
    var N = G.SMD_NATIVE;
    return N && typeof N.ocr === "function" ? function (img) { return N.ocr(img, { languageCorrection: true }); } : null;
  }
  function canOcr() { return !!nativeOcr(); }
  // The chosen pages of an open PDF, with OCR for scanned pages when the app runs on a phone.
  function readPdfPages(doc, pageList, onPage) {
    var ocr = nativeOcr();
    return readPages(doc, pageList, onPage, ocr ? { ocr: ocr, render: renderPage } : {});
  }

  var API = {};
  for (var k in PURE) API[k] = PURE[k];
  API.loadPdfJs = loadPdfJs; API.openPdf = openPdf; API.readPdfPages = readPdfPages; API.renderPage = renderPage; API.canOcr = canOcr; API._pure = PURE;
  G.PREP_SRC = API;
})(typeof window !== "undefined" ? window : this);
