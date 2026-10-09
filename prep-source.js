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
   Caps: 60 pages, 300,000 characters per deck; the pages are chosen on the page picker (sel* helpers, gridWindow and
   renderThumb below; prep-create.js draws it), never taken silently. prepScrub finds and removes emails, phone numbers, Aadhaar-like
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
  var PUNCT = new RegExp("^[!-/:-@\\[-" + FC(96) + "{-~]+$");   // ASCII punctuation only (FC(96) is the backtick)
  // Bullet and dash glyphs on their own (built from char codes so no dash character sits in this file).
  var MARKS = new RegExp("^[" + FC(0x2022, 0x25AA, 0x25CF, 0x25E6, 0x2023, 0x2043, 0x2013, 0x2014, 0xB7, 0x25A0) + "]+$");
  var EDGE = /^[("'\[{<]+|[)"'\]}>.,;:!?*]+$/g;
  // Share of tokens that are not words. Tokens of plain ASCII punctuation only (bullets, dashes) are not counted.
  function nonWordRatio(text) {
    var toks = String(text == null ? "" : text).split(/\s+/), n = 0, bad = 0;
    toks.forEach(function (t) {
      if (!t || PUNCT.test(t) || MARKS.test(t)) return;
      n++;
      var c = t.replace(EDGE, "");
      if (!c || !HAS_ALNUM.test(c) || !WORD.test(c)) bad++;
    });
    return n ? bad / n : 0;
  }
  // Characters on the page's lines (lines are already squashed: single spaces, no edges).
  function textChars(lines) { var c = 0; (lines || []).forEach(function (l) { c += String(l.tx || "").length; }); return c; }
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

  /* ---------- the page picker (owner 2026-10-09): never a silent "first 60 pages" ----------
     A selection is a sorted array of page numbers. Every change goes through these, so the 60-page cap holds in one
     place: a change that would pass the cap is refused whole ({ sel unchanged, error }) and says so in plain words. */
  function capMsg(cap, want) { return "You can pick up to " + cap + " pages for one deck" + (want ? "; that would make " + want + "." : ".") + " Make another deck for the rest."; }
  function selNorm(list, total) { var o = {}; (list || []).forEach(function (p) { p = +p; if (p >= 1 && p <= total && p === Math.floor(p)) o[p] = 1; }); return Object.keys(o).map(Number).sort(function (a, b) { return a - b; }); }
  // Small PDFs start with every page picked; a long one starts with none (the student chooses the chapter).
  function selInitial(total, cap) { cap = cap || PAGE_CAP; var out = []; if (total <= cap) for (var i = 1; i <= total; i++) out.push(i); return out; }
  function selToggle(sel, p, total, cap) {
    cap = cap || PAGE_CAP;
    var i = sel.indexOf(p);
    if (i >= 0) return { sel: sel.slice(0, i).concat(sel.slice(i + 1)) };
    if (p < 1 || p > total) return { sel: sel };
    if (sel.length >= cap) return { sel: sel, error: capMsg(cap, sel.length + 1) };
    return { sel: selNorm(sel.concat([p]), total) };
  }
  // Add every page from a to b (either order) to the selection.
  function selRange(sel, a, b, total, cap) {
    cap = cap || PAGE_CAP;
    var lo = Math.max(1, Math.min(a, b)), hi = Math.min(total, Math.max(a, b)), add = [];
    for (var p = lo; p <= hi; p++) if (sel.indexOf(p) < 0) add.push(p);
    if (sel.length + add.length > cap) return { sel: sel, error: capMsg(cap, sel.length + add.length) };
    return { sel: selNorm(sel.concat(add), total) };
  }
  // A typed range ("120-160, 175") replaces the selection, with the same words as parsePages.
  function selFromSpec(spec, total, cap) {
    cap = cap || PAGE_CAP;
    var r = parsePages(spec, total, 100000);
    if (r.error) return { error: r.error };
    if (r.pages.length > cap) return { error: capMsg(cap, r.pages.length) };
    return { sel: r.pages };
  }
  // [1,2,3,7,9,10] -> "1-3, 7, 9-10"
  function selSpec(sel) {
    var out = [], s = null, prev = null;
    (sel || []).forEach(function (p) { if (s != null && p === prev + 1) { prev = p; return; } if (s != null) out.push(s === prev ? String(s) : s + "-" + prev); s = prev = p; });
    if (s != null) out.push(s === prev ? String(s) : s + "-" + prev);
    return out.join(", ");
  }
  /* Virtual grid: which pages to draw for a scroll position. top = the grid's offset inside the scroller, rowH = one
     row's height with its gap. -> { from, to } page numbers (1-based, inclusive), with `buf` rows either side. */
  function gridWindow(scrollTop, viewH, top, rowH, cols, total, buf) {
    buf = buf == null ? 2 : buf;
    var rows = Math.ceil(total / cols), y0 = Math.max(0, scrollTop - top), r0 = Math.max(0, Math.floor(y0 / rowH) - buf), r1 = Math.min(rows - 1, Math.floor((y0 + viewH) / rowH) + buf);
    if (r1 < r0) return { from: 1, to: 0 };
    return { from: r0 * cols + 1, to: Math.min(total, (r1 + 1) * cols) };
  }
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

  /* ---------- images in a PDF (image questions) ----------
     The phone finds the pictures on the chosen pages from pdf.js's operator list: each image drawn on a page, where it
     sits (the current transform maps the unit square onto the page) and its own pixel size. pickImages keeps the ones
     worth a question; the browser part below renders each one's area of the page and encodes it. Nothing is sent here. */
  var IMG_MIN = 200, IMG_CAP = 20, IMG_MAX_PX = 1280, IMG_MIN_PAGE = 0.12, IMG_MAX_ASPECT = 4;
  function mul(m, n) { return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]; }
  /* imageBoxes(fnArray, argsArray, OPS) -> [{ id, w, h, box: [x0, y0, x1, y1] }] in PDF user space. Follows save, restore,
     transform and form XObjects; image masks (stencils, usually glyphs or icons) are not pictures. */
  function imageBoxes(fns, args, OPS) {
    var ctm = [1, 0, 0, 1, 0, 0], stack = [], out = [];
    for (var i = 0; i < (fns || []).length; i++) {
      var f = fns[i], a = (args && args[i]) || [];
      if (f === OPS.save) stack.push(ctm.slice());
      else if (f === OPS.restore) ctm = stack.length ? stack.pop() : ctm;
      else if (f === OPS.transform) ctm = mul(ctm, a);
      else if (f === OPS.paintFormXObjectBegin) { stack.push(ctm.slice()); if (a[0] && a[0].length === 6) ctm = mul(ctm, a[0]); }
      else if (f === OPS.paintFormXObjectEnd) ctm = stack.length ? stack.pop() : ctm;
      else if (f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject || f === OPS.paintJpegXObject) {
        var inl = f === OPS.paintInlineImageXObject, d = inl ? a[0] || {} : null;
        var w = inl ? +d.width || 0 : +a[1] || 0, h = inl ? +d.height || 0 : +a[2] || 0;
        var xs = [], ys = [];
        [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (c) { xs.push(ctm[0] * c[0] + ctm[2] * c[1] + ctm[4]); ys.push(ctm[1] * c[0] + ctm[3] * c[1] + ctm[5]); });
        out.push({ id: inl ? "inline-" + i : String(a[0]), w: w, h: h, box: [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)] });
      }
    }
    return out;
  }
  /* Owner bug 2026-10-09: a scanned page of notes (one picture the size of the page) was cut out whole and became the
     "image" of a question ("Based on the table provided in the image..."). A question image must be a real figure: a
     radiograph, a photo, a micrograph, a tracing or a diagram, never a page, a table or a block of text. So:
     - an image covering 55% or more of its page is a page scan, never a candidate itself (scanPages + figureRegions below
       look for a figure inside it instead, and find none on a page of text);
     - an image with the page's own text over it (a text layer: an OCR'd scan, a slide with text on a picture) is out
       when that text is more than 40 characters or covers a fifth of it (a few labels on a diagram stay);
     - after it is cut, its pixels must read as a picture or a diagram (classifyPixels), not text in lines, not blank. */
  var SCAN_SHARE = 0.55, TXT_CHARS = 40, TXT_COVER = 0.2;
  function boxArea(b) { return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]); }
  function pageShare(x, view) { return boxArea(x.box) / (boxArea([Math.min(view[0], view[2]), Math.min(view[1], view[3]), Math.max(view[0], view[2]), Math.max(view[1], view[3])]) || 1); }
  function isPageScan(x, view) { return pageShare(x, view) >= SCAN_SHARE; }
  /* textBoxes(items) -> [{ box, n }] from pdf.js getTextContent() items: where each run of text sits, in PDF user space. */
  function textBoxes(items) {
    var out = [];
    (items || []).forEach(function (it) {
      var str = String(it && it.str || "").replace(/\s+/g, ""), m = it && it.transform;
      if (!str || !m || m.length < 6) return;
      var hgt = Math.abs(it.height) || Math.hypot(m[2], m[3]) || Math.abs(m[3]) || 0, wid = Math.abs(it.width) || 0;
      if (!hgt) return;
      out.push({ box: [m[4], m[5], m[4] + (wid || hgt * 0.5 * str.length), m[5] + hgt], n: str.length });
    });
    return out;
  }
  /* textInBox(texts, box) -> { chars, cover }: the characters whose run's centre lies in the box, and the share of the box
     those runs cover. */
  function textInBox(texts, box) {
    var chars = 0, area = 0, A = boxArea(box) || 1;
    (texts || []).forEach(function (t) {
      var cx = (t.box[0] + t.box[2]) / 2, cy = (t.box[1] + t.box[3]) / 2;
      if (cx < box[0] || cx > box[2] || cy < box[1] || cy > box[3]) return;
      chars += t.n;
      area += boxArea([Math.max(box[0], t.box[0]), Math.max(box[1], t.box[1]), Math.min(box[2], t.box[2]), Math.min(box[3], t.box[3])]);
    });
    return { chars: chars, cover: Math.min(1, area / A) };
  }
  function textHeavy(texts, box) { var t = textInBox(texts, box); return t.chars > TXT_CHARS || t.cover > TXT_COVER; }
  /* pickImages(pages) where pages = [{ p, view: [x0, y0, x1, y1], imgs: imageBoxes(), text?: textBoxes() }] ->
     [{ p, id, w, h, box, k }].
     Kept: at least 200 x 200 pixels of its own; at least 12% of the page's width and of its height on the page (smaller
     ones are icons and bullets); no more than 4:1 either way (rules and banners); not drawn on two or more pages (a logo
     or a running header, by its object id, or by the same size at the same place); not a page scan (55% of the page or
     more); not under more than a few words of the page's text. In page order, top to bottom, the first 20. k is the
     image's key in this document. */
  function pickImages(pages, cap) {
    cap = cap || IMG_CAP;
    var byId = {}, byPos = {}, pos = function (x) { return [x.w, x.h].concat(x.box.map(function (v) { return Math.round(v / 4); })).join(","); };
    (pages || []).forEach(function (pg) {
      var seenId = {}, seenPos = {};
      pg.imgs.forEach(function (x) {
        if (!seenId[x.id]) { seenId[x.id] = 1; byId[x.id] = (byId[x.id] || 0) + 1; }
        var k = pos(x); if (!seenPos[k]) { seenPos[k] = 1; byPos[k] = (byPos[k] || 0) + 1; }
      });
    });
    var out = [];
    (pages || []).forEach(function (pg) {
      var vw = Math.abs(pg.view[2] - pg.view[0]) || 1, vh = Math.abs(pg.view[3] - pg.view[1]) || 1, here = {};
      pg.imgs.filter(function (x) {
        var bw = x.box[2] - x.box[0], bh = x.box[3] - x.box[1];
        if (x.w < IMG_MIN || x.h < IMG_MIN) return false;
        if (bw < vw * IMG_MIN_PAGE || bh < vh * IMG_MIN_PAGE) return false;
        if (bw / bh > IMG_MAX_ASPECT || bh / bw > IMG_MAX_ASPECT) return false;
        if (isPageScan(x, pg.view)) return false;
        if (pg.text && textHeavy(pg.text, x.box)) return false;
        if (byId[x.id] > 1 || byPos[pos(x)] > 1 || here[x.id]) return false;
        here[x.id] = 1;
        return true;
      }).sort(function (a, b) { return b.box[3] - a.box[3] || a.box[0] - b.box[0]; }).forEach(function (x) {
        out.push({ p: pg.p, id: x.id, w: x.w, h: x.h, box: x.box, k: pg.p + ":" + x.id });
      });
    });
    return out.slice(0, cap);
  }
  /* scanPages(pages) -> [{ p, id, w, h, box }]: the pages drawn as one big picture (a scan or a phone photo of a page),
     the largest such picture on each. figureRegions looks inside these for a real figure. */
  function scanPages(pages) {
    var out = [];
    (pages || []).forEach(function (pg) {
      var best = null;
      (pg.imgs || []).forEach(function (x) { if (x.w >= IMG_MIN && x.h >= IMG_MIN && isPageScan(x, pg.view) && (!best || boxArea(x.box) > boxArea(best.box))) best = x; });
      if (best) out.push({ p: pg.p, id: best.id, w: best.w, h: best.h, box: best.box });
    });
    return out;
  }

  /* ---------- pixels: is this a figure or a page of text? ----------
     All on a grey image (0 black .. 255 white), w x h, a few hundred pixels across. Paper is the bright end (bg, the
     95th percentile); ink is anything 50 or more darker than the paper.
     - text and tables print in lines: the rows with ink (2% of the row or more, so a table's column rules do not join
       its rows) form thin bands with blank rows between them: 4 or more holding most of the inked rows, or 8 or more
       anywhere (a page with a dark box or a ruled table in it) (textBands);
     - a radiograph, CT, photo or micrograph is mostly not paper (ink 35% or more) and is not one flat colour (the most
       common shade under 70%; a coloured box of text is mostly its fill);
     - a diagram is line work on paper without the rhythm of text lines.
     classifyPixels -> { kind: "picture" | "diagram" | "text" | "blank", ink, bands, cover, top }. */
  function toGray(rgba, w, h) {
    var g = new Uint8Array(w * h);
    for (var i = 0, j = 0; i < g.length; i++, j += 4) {
      var a = rgba[j + 3] / 255;   // transparent reads as white paper
      g[i] = Math.round((0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) * a + 255 * (1 - a));
    }
    return g;
  }
  function histo(g, x0, y0, x1, y1, w) {
    var h = new Uint32Array(256), n = 0;
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { h[g[y * w + x]]++; n++; }
    return { h: h, n: n };
  }
  function pct(H, q) { var t = H.n * q, c = 0; for (var v = 0; v < 256; v++) { c += H.h[v]; if (c >= t) return v; } return 255; }
  function topBin(H) { var best = 0; for (var v = 0; v < 256; v += 16) { var c = 0; for (var k = v; k < v + 16; k++) c += H.h[k]; if (c > best) best = c; } return H.n ? best / H.n : 1; }
  function textBands(rowInk, H) {
    var bands = 0, inked = 0, banded = 0, run = 0, runInk = 0;
    var lo = Math.max(2, Math.round(H * 0.004)), hi = Math.max(lo + 1, Math.round(H * 0.09));
    var end = function () {
      if (!run) return;
      inked += run;
      if (run >= lo && run <= hi && runInk / run < 0.4) { bands++; banded += run; }
      run = 0; runInk = 0;
    };
    for (var r = 0; r < rowInk.length; r++) { if (rowInk[r] > 0.02) { run++; runInk += rowInk[r]; } else end(); }
    end();
    return { bands: bands, cover: inked ? banded / inked : 0 };
  }
  function classifyRect(g, w, x0, y0, x1, y1, bgIn) {
    var H = histo(g, x0, y0, x1, y1, w), bg = bgIn == null ? pct(H, 0.95) : bgIn, thr = bg - 50, ink = 0, rows = [], rw = x1 - x0;
    for (var y = y0; y < y1; y++) {
      var c = 0;
      for (var x = x0; x < x1; x++) if (g[y * w + x] < thr) c++;
      rows.push(c / (rw || 1)); ink += c;
    }
    var inkF = H.n ? ink / H.n : 0, tb = textBands(rows, y1 - y0), top = topBin(H), out = { ink: inkF, bands: tb.bands, cover: tb.cover, top: top, bg: bg };
    if (bg < 100) out.kind = top < 0.85 ? "picture" : "blank";   // a dark image (a film on black): no paper to read text on
    else if (inkF < 0.01) out.kind = "blank";
    else if (((tb.bands >= 4 && tb.cover >= 0.55) || tb.bands >= 8) && inkF < 0.4) out.kind = "text";
    else if (inkF >= 0.35) out.kind = top < 0.7 ? "picture" : "text";   // one flat fill: a coloured box of text
    else out.kind = inkF >= 0.015 ? "diagram" : "blank";
    return out;
  }
  function classifyPixels(g, w, h) { return classifyRect(g, w, 0, 0, w, h); }
  /* figureRegions(g, w, h) -> [{ x, y, w, h }] in pixels: the picture-like areas of a page image. The page is cut in
     blocks about 1/48 of its long side; a block is dense when half its pixels are ink against the page's paper. Touching
     dense blocks (8 neighbours, one block of slack) make one region; a region is kept when it is 6% to 98% of the page,
     at most 4:1, at least 45% dense, and its pixels read as a picture (classifyRect). The largest first, at most 3. */
  function figureRegions(g, w, h) {
    var bg = pct(histo(g, 0, 0, w, h, w), 0.95), thr = bg - 50, B = Math.max(6, Math.round(Math.max(w, h) / 48));
    var cols = Math.ceil(w / B), rows = Math.ceil(h / B), dense = new Uint8Array(cols * rows);
    for (var by = 0; by < rows; by++) for (var bx = 0; bx < cols; bx++) {
      var c = 0, n = 0;
      for (var y = by * B; y < Math.min(h, (by + 1) * B); y++) for (var x = bx * B; x < Math.min(w, (bx + 1) * B); x++) { n++; if (g[y * w + x] < thr) c++; }
      dense[by * cols + bx] = n && c / n >= 0.5 ? 1 : 0;
    }
    var seen = new Uint8Array(cols * rows), out = [];
    for (var i = 0; i < dense.length; i++) {
      if (!dense[i] || seen[i]) continue;
      var q = [i], k = 0, x0 = cols, y0 = rows, x1 = -1, y1 = -1, cnt = 0;
      seen[i] = 1;
      while (k < q.length) {
        var cur = q[k++], cx = cur % cols, cy = (cur - cx) / cols;
        cnt++; x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
          var nx = cx + dx, ny = cy + dy, ni = ny * cols + nx;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen[ni] || !dense[ni]) continue;
          seen[ni] = 1; q.push(ni);
        }
      }
      var bwB = x1 - x0 + 1, bhB = y1 - y0 + 1, share = (bwB * bhB) / (cols * rows), fill = cnt / (bwB * bhB);
      if (share < 0.06 || share > 0.98 || fill < 0.45 || bwB / bhB > 4 || bhB / bwB > 4) continue;
      var r = { x: x0 * B, y: y0 * B, w: Math.min(w, (x1 + 1) * B) - x0 * B, h: Math.min(h, (y1 + 1) * B) - y0 * B };
      var k2 = classifyRect(g, w, r.x, r.y, r.x + r.w, r.y + r.h, bg);
      if (k2.kind === "picture") { r.kind = k2.kind; out.push(r); }
    }
    return out.sort(function (a, b) { return b.w * b.h - a.w * a.h; }).slice(0, 3);
  }
  // A figure the student may use: a picture or a diagram (a crop of an embedded image); a scan region must be a picture.
  function figureOk(kind, fromScan) { return kind === "picture" || (!fromScan && kind === "diagram"); }

  /* nearSents(sents, p, maxChars) -> the numbered sentences sent with an image on page p: a caption first ("Figure 2",
     "Fig.", "X-ray", "shows"), then the rest of the page in order, then the pages either side when the page has fewer
     than 3 sentences; at most 12 sentences and about 1,500 characters. */
  var CAPTION = /^(?:fig(?:ure)?\.?\s*\d|image|plate|photo|x-?ray|radiograph|ct|mri|ecg|slide)|\b(?:shown|shows|showing|arrow|arrows|labelled)\b/i;
  function nearSents(sents, p, maxChars) {
    maxChars = maxChars || 1500;
    var on = (sents || []).filter(function (s) { return s.p === p; });
    if (on.length < 3) on = on.concat((sents || []).filter(function (s) { return s.p === p - 1 || s.p === p + 1; }));
    var cap = on.filter(function (s) { return CAPTION.test(s.tx); }), rest = on.filter(function (s) { return !CAPTION.test(s.tx); });
    var out = [], used = 0;
    cap.concat(rest).forEach(function (s) { if (out.length >= 12 || used + s.tx.length > maxChars) return; out.push(s); used += s.tx.length; });
    return out.sort(function (a, b) { return a.n - b.n; }).map(function (s) { return { n: s.n, p: s.p, h: s.h, tx: s.tx }; });
  }
  /* The render scale for one image: its long side at its own resolution, at most 1280 px, from the box's size in PDF
     units. Clamped to 0.5 to 6 so a tiny box never asks for a huge canvas. */
  function cropScale(x) { var bl = Math.max(x.box[2] - x.box[0], x.box[3] - x.box[1]) || 1; return Math.max(0.5, Math.min(6, Math.min(IMG_MAX_PX, Math.max(x.w, x.h)) / bl)); }

  var PURE = {
    IMG_MIN: IMG_MIN, IMG_CAP: IMG_CAP, IMG_MAX_PX: IMG_MAX_PX, imageBoxes: imageBoxes, pickImages: pickImages, nearSents: nearSents, cropScale: cropScale,
    SCAN_SHARE: SCAN_SHARE, isPageScan: isPageScan, pageShare: pageShare, textBoxes: textBoxes, textInBox: textInBox, scanPages: scanPages,
    toGray: toGray, classifyPixels: classifyPixels, figureRegions: figureRegions, figureOk: figureOk,
    PAGE_CAP: PAGE_CAP, CHARS_CAP: CHARS_CAP, MIN_CHARS: MIN_CHARS, CHUNK_TOK: CHUNK_TOK, SCANNED_CHARS: SCANNED_CHARS,
    fixText: fixText, fontSize: fontSize, itemsToLines: itemsToLines, bodySize: bodySize, isHeadingBySize: isHeadingBySize, markHeadings: markHeadings,
    isNoteHeading: isNoteHeading, notesToPages: notesToPages, stripRepeats: stripRepeats, splitSentences: splitSentences, buildDoc: buildDoc,
    docFromNotes: docFromNotes, docFromPdfPages: docFromPdfPages, docText: docText, defaultPages: defaultPages, parsePages: parsePages, pageSpan: pageSpan,
    selInitial: selInitial, selToggle: selToggle, selRange: selRange, selFromSpec: selFromSpec, selSpec: selSpec, gridWindow: gridWindow,
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
  /* A page thumbnail for the page picker: rendered on demand (only the rows on screen), w CSS px wide at the screen's
     pixel ratio (at most 2), JPEG on white; the canvas and the page's render resources are released at once. */
  function renderThumb(doc, p, w) {
    return doc.getPage(p).then(function (page) {
      var vp1 = page.getViewport({ scale: 1 }), dpr = Math.min(2, (G.devicePixelRatio || 1)), sc = Math.max(0.05, (w * dpr) / vp1.width);
      var vp = page.getViewport({ scale: sc }), cv = G.document.createElement("canvas"), cx = cv.getContext("2d");
      cv.width = Math.max(1, Math.round(vp.width)); cv.height = Math.max(1, Math.round(vp.height));
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
      return page.render({ canvasContext: cx, viewport: vp }).promise.then(function () {
        var u = cv.toDataURL("image/jpeg", 0.7); cv.width = 0; cv.height = 0;
        try { page.cleanup(); } catch (e) {}
        return u;
      });
    });
  }
  // Height over width of page 1 (the grid sizes every cell from it); 1.414 (A4) when it cannot be read.
  function pageAspect(doc) {
    return doc.getPage(1).then(function (page) { var v = page.getViewport({ scale: 1 }); return v.width ? Math.max(0.5, Math.min(2, v.height / v.width)) : 1.414; }, function () { return 1.414; });
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

  /* extractImages(doc, pageList, onStep?) -> Promise([{ p, k, w, h, data (data: URL), mime }]). Reads each page's operator
     list, picks the images (pickImages), renders each one's area of the page at its own size (at most 1280 px on the
     long side, on white) and encodes it: WebP where the browser can, else JPEG. Rendering the area keeps arrows and
     labels drawn over the picture. A page that fails is skipped. */
  function encode(cv) {
    var w = cv.toDataURL("image/webp", 0.82);
    if (/^data:image\/webp/.test(w)) return { data: w, mime: "image/webp" };
    return { data: cv.toDataURL("image/jpeg", 0.84), mime: "image/jpeg" };
  }
  // The grey pixels of a canvas, scaled down to at most max px on the long side (enough to see lines of text).
  function grayOf(cv, max) {
    var k = Math.min(1, (max || 480) / Math.max(cv.width, cv.height)), w = Math.max(1, Math.round(cv.width * k)), h = Math.max(1, Math.round(cv.height * k));
    var c2 = G.document.createElement("canvas"); c2.width = w; c2.height = h;
    var x = c2.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(cv, 0, 0, w, h);
    var g = toGray(x.getImageData(0, 0, w, h).data, w, h); c2.width = 0; c2.height = 0;
    return { g: g, w: w, h: h };
  }
  // renderBox, then classify the cut: { e (encoded), kind }. The canvas is released either way.
  function renderBoxChecked(page, x) {
    var sc = cropScale(x), vp = page.getViewport({ scale: sc }), r = vp.convertToViewportRectangle(x.box);
    var left = Math.floor(Math.min(r[0], r[2])), top = Math.floor(Math.min(r[1], r[3])), cw = Math.max(1, Math.ceil(Math.abs(r[2] - r[0]))), ch = Math.max(1, Math.ceil(Math.abs(r[3] - r[1])));
    var cv = G.document.createElement("canvas"), cx = cv.getContext("2d");
    cv.width = cw; cv.height = ch;
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, cw, ch);
    return page.render({ canvasContext: cx, viewport: vp, transform: [1, 0, 0, 1, -left, -top] }).promise.then(function () {
      var px = grayOf(cv, 480), c = classifyPixels(px.g, px.w, px.h), e = figureOk(c.kind, !!x.scan) ? encode(cv) : null;
      if (e) { e.w = cw; e.h = ch; }
      cv.width = 0; cv.height = 0;
      return { e: e, kind: c.kind };
    });
  }
  /* A page scan: the page rendered about 720 px on the long side, its figure regions (figureRegions) mapped back to
     PDF space as candidates; a region under the page's own text layer (an OCR'd scan) is out like any other image. */
  var SCAN_CAP = 40;
  function scanFigures(page, sp, text) {
    var vp1 = page.getViewport({ scale: 1 }), sc = Math.min(2, 720 / Math.max(vp1.width, vp1.height)), vp = page.getViewport({ scale: sc });
    var cv = G.document.createElement("canvas"), cx = cv.getContext("2d");
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
    return page.render({ canvasContext: cx, viewport: vp }).promise.then(function () {
      var px = grayOf(cv, 720), k = cv.width / px.w, regs = figureRegions(px.g, px.w, px.h);
      cv.width = 0; cv.height = 0;
      return regs.map(function (r, j) {
        var a = vp.convertToPdfPoint(r.x * k, r.y * k), b = vp.convertToPdfPoint((r.x + r.w) * k, (r.y + r.h) * k);
        var box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
        var fw = (box[2] - box[0]) / ((sp.box[2] - sp.box[0]) || 1), fh = (box[3] - box[1]) / ((sp.box[3] - sp.box[1]) || 1);
        return { p: sp.p, id: sp.id + "#r" + j, w: Math.max(1, Math.round(sp.w * fw)), h: Math.max(1, Math.round(sp.h * fh)), box: box, k: sp.p + ":" + sp.id + "#r" + j, scan: true };
      }).filter(function (x) { return !(text && textHeavy(text, x.box)); });
    });
  }
  /* extractImages(doc, pageList, onStep?) -> Promise([{ p, k, w, h, data (data: URL), mime }]). Reads each page's operator
     list and text, picks the images (pickImages) and the figures inside page scans (scanFigures), renders each one's area
     of the page at its own size (at most 1280 px on the long side, on white), keeps it only when its pixels read as a
     figure (classifyPixels), and encodes it: WebP where the browser can, else JPEG. Rendering the area keeps arrows and
     labels drawn over the picture. A page that fails is skipped. */
  function extractImages(doc, pageList, onStep) {
    var pages = [], got = {}, i = 0;
    function scan() {
      if (i >= pageList.length) return Promise.resolve();
      var p = pageList[i++];
      return doc.getPage(p).then(function (page) {
        return Promise.all([page.getOperatorList(), page.getTextContent().then(null, function () { return { items: [] }; })]).then(function (r) {
          got[p] = page;
          pages.push({ p: p, view: page.view, imgs: imageBoxes(r[0].fnArray, r[0].argsArray, G.pdfjsLib.OPS), text: textBoxes(r[1].items) });
        });
      }).then(null, function () {}).then(function () { if (onStep) onStep(i, pageList.length, "scan"); return scan(); });
    }
    return scan().then(function () {
      var picks = pickImages(pages, IMG_CAP * 2), scans = scanPages(pages).slice(0, SCAN_CAP), textOf = {};
      pages.forEach(function (pg) { textOf[pg.p] = pg.text; });
      var s = 0;
      function regions() {
        if (s >= scans.length) return Promise.resolve();
        var sp = scans[s++];
        return scanFigures(got[sp.p], sp, textOf[sp.p]).then(function (list) { picks = picks.concat(list); }, function () {}).then(regions);
      }
      return regions().then(function () {
        picks.sort(function (a, b) { return a.p - b.p || b.box[3] - a.box[3] || a.box[0] - b.box[0]; });
        var out = [], k = 0;
        function next() {
          if (k >= picks.length || out.length >= IMG_CAP) return Promise.resolve(out);
          var x = picks[k++];
          return renderBoxChecked(got[x.p], x).then(function (r) { if (r.e) out.push({ p: x.p, k: x.k, w: r.e.w, h: r.e.h, data: r.e.data, mime: r.e.mime }); }, function () {})
            .then(function () { if (onStep) onStep(k, picks.length, "cut"); return next(); });
        }
        return next();
      });
    });
  }

  var API = {};
  for (var k in PURE) API[k] = PURE[k];
  API.loadPdfJs = loadPdfJs; API.openPdf = openPdf; API.readPdfPages = readPdfPages; API.renderPage = renderPage; API.canOcr = canOcr; API.extractImages = extractImages; API.renderThumb = renderThumb; API.pageAspect = pageAspect; API._pure = PURE;
  G.PREP_SRC = API;
})(typeof window !== "undefined" ? window : this);
