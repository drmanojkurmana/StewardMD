/* StewardMD - ResearchMD: turn a thesis into a journal paper.
   Client only. The server (pdf-uploads, pdf_extract job, ai-draft task
   "thesis_to_paper", journals/match) lives on the research-server branch;
   here we drive it through SMD.api and verify every number against the
   extracted thesis text before it is shown. ES5 IIFE, dual export. */
(function (G) {
  "use strict";

  var NAME = "research-screen-thesis";
  var VERSION = "rmd1";
  var D = G && G.document;
  var SMD = G && (G.SMD_RESEARCH = G.SMD_RESEARCH || {});
  var THESIS_KEY = "smd_rmd_thesis_v1";
  var MAX_BYTES = 40 * 1024 * 1024;
  var POLL_MS = 1500;
  var POLL_TRIES = 40;

  var DEFAULT_JOURNAL = {
    name: "General Indian medical journal format",
    wordLimit: 3000,
    abstractFormat: "Structured abstract (Background, Methods, Results, Conclusion), up to 250 words",
    referenceStyle: "vancouver"
  };

  var PAPER_TYPES = [
    { key: "obs", label: "Original article (observational study)", checklist: "strobe", checklistName: "STROBE", gloss: "the reporting checklist for observational studies", eg: "A cohort, case-control or cross-sectional study from your thesis data." },
    { key: "rct", label: "Randomized controlled trial (RCT)", checklist: "consort", checklistName: "CONSORT", gloss: "the reporting checklist for randomized trials", eg: "A trial that randomly allocated people to groups." },
    { key: "case", label: "Case series or case report", checklist: "care", checklistName: "CARE", gloss: "the reporting checklist for case reports", eg: "One patient or a small series of unusual cases." },
    { key: "sr", label: "Systematic review", checklist: "prisma2020", checklistName: "PRISMA", gloss: "the reporting checklist for systematic reviews", eg: "A structured search and synthesis of many studies." }
  ];

  var SECTION_ORDER = [
    { id: "abstract", heading: "Abstract" },
    { id: "introduction", heading: "Introduction" },
    { id: "methods", heading: "Methods" },
    { id: "results", heading: "Results" },
    { id: "discussion", heading: "Discussion" }
  ];

  /* ---------- on-device DOCX & PDF extraction ---------- */

  var _pdfLibPromise = null;
  var PDFJS_LOCAL = "/vendor/pdfjs/pdf.min.js";
  var PDFJS_LOCAL_W = "/vendor/pdfjs/pdf.worker.min.js";
  var PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDFJS_CDN_W = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  function decodeUtf8(u8) {
    if (G && G.TextDecoder) {
      try { return new G.TextDecoder("utf-8", { fatal: false }).decode(u8); } catch (e) {}
    }
    var out = "";
    for (var i = 0; i < u8.length; i += 8192) {
      out += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + 8192, u8.length)));
    }
    try { return decodeURIComponent(escape(out)); } catch (e) { return out; }
  }

  function decodeXmlEntities(s) {
    return String(s || "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
      .replace(/&amp;/g, "&");
  }

  function readFileAsArrayBuffer(file) {
    if (file && typeof file.arrayBuffer === "function") {
      return file.arrayBuffer();
    }
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error("No file provided.")); return; }
      if (typeof FileReader === "undefined") {
        reject(new Error("File reading is not supported on this device."));
        return;
      }
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error("Could not read file from device storage.")); };
      fr.readAsArrayBuffer(file);
    });
  }

  function readZipEntries(buf) {
    var ab;
    if (buf && buf.buffer instanceof ArrayBuffer) {
      ab = (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength)
        ? buf.buffer
        : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } else if (buf instanceof ArrayBuffer) {
      ab = buf;
    } else {
      ab = new ArrayBuffer(0);
    }
    var u8 = new Uint8Array(ab);
    if (u8.length >= 4 && u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0) {
      return Promise.reject(new Error("This file is an older binary Word (.doc) file or password-protected. Save an unprotected copy as .docx or PDF and upload again."));
    }
    var dv = new DataView(ab);
    var eocd = -1;
    var minAt = Math.max(0, u8.length - 22 - 65536);
    for (var i = u8.length - 22; i >= minAt; i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) {
      return Promise.reject(new Error("This file does not look like a valid Word (.docx) document."));
    }
    var count = dv.getUint16(eocd + 10, true);
    var cd = dv.getUint32(eocd + 16, true);
    var entries = {};
    var p = cd;
    for (var e = 0; e < count; e++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var compSize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commentLen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = decodeUtf8(u8.subarray(p + 46, p + 46 + nameLen));
      var meta = { method: method, offset: lho, size: compSize };
      entries[name] = meta;
      var altName = name.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
      if (altName !== name) entries[altName] = meta;
      p += 46 + nameLen + extraLen + commentLen;
    }
    function readEntry(name) {
      var en = entries[name];
      if (!en) return Promise.resolve(null);
      if (en.offset < 0 || en.offset + 30 > u8.length) {
        return Promise.reject(new Error("Corrupted Word (.docx) document structure."));
      }
      var nl = dv.getUint16(en.offset + 26, true);
      var el = dv.getUint16(en.offset + 28, true);
      var start = en.offset + 30 + nl + el;
      if (start + en.size > u8.length) {
        return Promise.reject(new Error("Corrupted Word (.docx) document structure."));
      }
      var data = u8.subarray(start, start + en.size);
      if (en.method === 0) return Promise.resolve(data);
      if (!G.DecompressionStream) {
        return Promise.reject(new Error("This device does not support on-device Word decompression (requires iOS 16.4+ or modern Android). Export your thesis as PDF and upload again."));
      }
      if (en.method !== 8) {
        return Promise.reject(new Error("This Word (.docx) file uses an unsupported compression format (" + en.method + "). In Word, save as standard .docx or PDF and upload again."));
      }
      var stream = new Blob([data]).stream().pipeThrough(new G.DecompressionStream("deflate-raw"));
      return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }
    return Promise.resolve({ entries: entries, readEntry: readEntry });
  }

  function localNameOf(node) {
    if (!node) return "";
    return node.localName || String(node.nodeName || "").split(":").pop();
  }

  function extractDocxParaDom(paraNode) {
    var parts = [];
    var hasPageBreak = false;
    function walk(node) {
      if (!node || node.nodeType !== 1) return;
      var ln = localNameOf(node);
      if (ln === "del" || ln === "instrText" || ln === "fldSimple" || ln === "moveFrom") return;
      if (ln === "lastRenderedPageBreak") { hasPageBreak = true; return; }
      if (ln === "br") {
        var btype = node.getAttribute("w:type") || node.getAttribute("type") || "";
        if (btype === "page") { hasPageBreak = true; return; }
        parts.push("\n");
        return;
      }
      if (ln === "cr") { parts.push("\n"); return; }
      if (ln === "tab") { parts.push(" "); return; }
      if (ln === "t" || ln === "delText") { parts.push(node.textContent || ""); return; }
      for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
    }
    walk(paraNode);
    return { text: parts.join("").replace(/[ \t]+/g, " ").replace(/^\s+|\s+$/g, ""), pageBreak: hasPageBreak };
  }

  function extractDocxXmlBlocks(xmlText) {
    var blocks = [];
    if (G && G.DOMParser) {
      try {
        var doc = new G.DOMParser().parseFromString(xmlText, "application/xml");
        if (doc && !doc.getElementsByTagName("parsererror").length) {
          var body = null;
          var root = doc.documentElement;
          for (var c = root && root.firstChild; c; c = c.nextSibling) {
            if (localNameOf(c) === "body") { body = c; break; }
          }
          var top = body || root;
          function walkContainer(container) {
            for (var n = container && container.firstChild; n; n = n.nextSibling) {
              if (n.nodeType !== 1) continue;
              var ln = localNameOf(n);
              if (ln === "p") {
                var p = extractDocxParaDom(n);
                if (p.pageBreak) blocks.push({ pageBreak: true });
                if (p.text) blocks.push({ text: p.text });
              } else if (ln === "tbl") {
                for (var r = n.firstChild; r; r = r.nextSibling) {
                  if (localNameOf(r) !== "tr") continue;
                  var cells = [];
                  for (var cell = r.firstChild; cell; cell = cell.nextSibling) {
                    if (localNameOf(cell) !== "tc") continue;
                    var cellParts = [];
                    for (var cp = cell.firstChild; cp; cp = cp.nextSibling) {
                      if (localNameOf(cp) === "p") {
                        var pr = extractDocxParaDom(cp);
                        if (pr.text) cellParts.push(pr.text);
                      }
                    }
                    var ct = cellParts.join(" ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
                    if (ct) cells.push(ct);
                  }
                  if (cells.length) blocks.push({ text: cells.join("  ") });
                }
              } else if (ln === "sdt" || ln === "sdtContent" || ln === "footnote" || ln === "endnote") {
                walkContainer(n);
              }
            }
          }
          walkContainer(top);
          return blocks;
        }
      } catch (e) {}
    }
    // Pure-JS XML fallback (works cleanly in Node unit tests without DOMParser)
    var cleaned = String(xmlText || "")
      .replace(/<w:del\b[\s\S]*?<\/w:del>/gi, "")
      .replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/gi, "");
    var pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi, pm;
    while ((pm = pRe.exec(cleaned)) !== null) {
      var inner = pm[1];
      if (/<w:br\b[^>]*type=["']page["']|<w:lastRenderedPageBreak\b/i.test(inner)) {
        blocks.push({ pageBreak: true });
      }
      var stripped = inner
        .replace(/<w:tab\b[^>]*\/?>/gi, " ")
        .replace(/<w:(?:br|cr)\b[^>]*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "");
      var txt = decodeXmlEntities(stripped).replace(/[ \t]+/g, " ").replace(/^\s+|\s+$/g, "");
      if (txt) blocks.push({ text: txt });
    }
    return blocks;
  }

  function paginateBlocks(blocks, wordsPerPage) {
    var hasBreaks = false, i;
    for (i = 0; i < blocks.length; i++) {
      if (blocks[i].pageBreak) { hasBreaks = true; break; }
    }
    var pages = [], cur = [], curWords = 0, limit = wordsPerPage || 350;
    function flush() {
      var joined = cur.join("\n");
      if (joined.replace(/\s+/g, "").length > 0) {
        pages.push({ n: pages.length + 1, text: joined });
      }
      cur = [];
      curWords = 0;
    }
    for (i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.pageBreak) {
        if (cur.length) flush();
        continue;
      }
      var w = countWords(b.text);
      if (!hasBreaks && cur.length > 0 && curWords + w > limit) flush();
      cur.push(b.text);
      curWords += w;
    }
    flush();
    return pages;
  }

  function parseDocx(buf) {
    return readZipEntries(buf).then(function (zip) {
      return Promise.all([
        zip.readEntry("word/document.xml"),
        zip.readEntry("word/footnotes.xml"),
        zip.readEntry("word/endnotes.xml")
      ]).then(function (xmls) {
        if (!xmls[0]) {
          throw new Error("Could not find document text inside this .docx file.");
        }
        var blocks = extractDocxXmlBlocks(decodeUtf8(xmls[0]));
        if (xmls[1]) blocks = blocks.concat(extractDocxXmlBlocks(decodeUtf8(xmls[1])));
        if (xmls[2]) blocks = blocks.concat(extractDocxXmlBlocks(decodeUtf8(xmls[2])));
        var pages = paginateBlocks(blocks, 350);
        if (!pages.length) {
          throw new Error("No readable text was found inside this Word document (it may contain only images). Export a selectable-text PDF or copy the text.");
        }
        return pages;
      });
    });
  }

  function loadPdfJs() {
    if (_pdfLibPromise) return _pdfLibPromise;
    if (G && G.pdfjsLib) {
      try { G.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_LOCAL_W; } catch (e) {}
      _pdfLibPromise = Promise.resolve(G.pdfjsLib);
      return _pdfLibPromise;
    }
    if (!D) return Promise.reject(new Error("pdf_unavailable"));
    _pdfLibPromise = new Promise(function (resolve, reject) {
      function tryLoad(src, worker, fallback) {
        var s = D.createElement("script");
        s.src = src;
        s.onload = function () {
          var lib = G && G.pdfjsLib;
          if (!lib) { if (fallback) fallback(); else { _pdfLibPromise = null; reject(new Error("pdf_load")); } return; }
          try { lib.GlobalWorkerOptions.workerSrc = worker; } catch (e) {}
          resolve(lib);
        };
        s.onerror = function () {
          if (fallback) fallback();
          else { _pdfLibPromise = null; reject(new Error("pdf_load")); }
        };
        D.head.appendChild(s);
      }
      tryLoad(PDFJS_LOCAL, PDFJS_LOCAL_W, function () { tryLoad(PDFJS_CDN, PDFJS_CDN_W, null); });
    });
    return _pdfLibPromise;
  }

  function joinPdfTextItems(items) {
    var lines = [], curLine = [], lastY = null;
    for (var i = 0; i < (items || []).length; i++) {
      var it = items[i] || {};
      var str = String(it.str || "");
      var y = (it.transform && it.transform.length >= 6) ? it.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) {
        if (curLine.length) {
          lines.push(curLine.join(" ").replace(/[ \t]+/g, " ").replace(/^\s+|\s+$/g, ""));
          curLine = [];
        }
      }
      if (str.replace(/\s+/g, "")) curLine.push(str);
      if (it.hasEOL && curLine.length) {
        lines.push(curLine.join(" ").replace(/[ \t]+/g, " ").replace(/^\s+|\s+$/g, ""));
        curLine = [];
        lastY = null;
      } else if (y !== null) {
        lastY = y;
      }
    }
    if (curLine.length) lines.push(curLine.join(" ").replace(/[ \t]+/g, " ").replace(/^\s+|\s+$/g, ""));
    return lines.filter(Boolean).join("\n");
  }

  function isNativeShell() {
    var C = G && G.Capacitor;
    if (!C) return false;
    if (typeof C.isNativePlatform === "function") return !!C.isNativePlatform();
    return !!(C.platform && C.platform !== "web");
  }

  function readPdfLocal(file, onProgress) {
    if (!file || typeof file.arrayBuffer !== "function") return Promise.resolve(null);
    return Promise.all([loadPdfJs(), file.arrayBuffer()]).then(function (pair) {
      var pdfjs = pair[0], u8 = new Uint8Array(pair[1]);
      var openOpts = isNativeShell() ? { data: u8, disableWorker: true } : { data: u8 };
      return pdfjs.getDocument(openOpts).promise.catch(function (err) {
        if (err && err.name === "PasswordException") throw err;
        return pdfjs.getDocument({ data: u8, disableWorker: true }).promise;
      }).then(function (pdf) {
        var total = pdf.numPages || 0;
        if (!total) return null;
        var pages = [], chars = 0, idx = 1;
        function nextPage() {
          if (idx > total) {
            if (chars < 20) return { pages: [], emptyText: true };
            return { pages: pages, emptyText: false };
          }
          if (onProgress && (idx === 1 || idx % 10 === 0 || idx === total)) {
            onProgress(idx, total);
          }
          var pNo = idx++;
          return pdf.getPage(pNo).then(function (pg) {
            return pg.getTextContent();
          }).then(function (tc) {
            var txt = joinPdfTextItems((tc && tc.items) || []);
            chars += txt.replace(/\s+/g, "").length;
            pages.push({ n: pNo, text: txt });
            return nextPage();
          });
        }
        return nextPage();
      });
    });
  }

  /* ---------- pure helpers (unit tested) ---------- */

  function splitSentences(text) {
    var out = [], cur = "", i, ch, next, prev, decimal;
    text = String(text || "");
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      cur += ch;
      if (ch === "." || ch === "!" || ch === "?") {
        next = text.charAt(i + 1);
        prev = text.charAt(i - 1);
        decimal = ch === "." && prev >= "0" && prev <= "9" && next >= "0" && next <= "9";
        if (!decimal && (next === "" || /\s/.test(next))) { out.push(cur); cur = ""; }
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  function numTokens(text) {
    var re = /(?:\d+(?:\.\d+)?|\.\d+)/g, out = [], m;
    while ((m = re.exec(text))) out.push({ tok: m[0], idx: m.index });
    return out;
  }

  function isReportingConstant(text, idx, tok) {
    if (tok === "95" && text.slice(idx, idx + 6) === "95% CI") return true;
    if ((tok === ".001" || tok === "0.001") && /p\s*<\s*$/.test(text.slice(Math.max(0, idx - 8), idx))) return true;
    return false;
  }

  function tableFor(text, idx) {
    var head = text.slice(0, idx), re = /Table\s+(\d+)/gi, m, last = null;
    while ((m = re.exec(head))) last = m[1];
    return last ? Number(last) : null;
  }

  function findNumber(pageTexts, tok) {
    var p, t, idx, before, after, nextAfter, bOk, aOk;
    for (p = 0; p < (pageTexts || []).length; p++) {
      t = pageTexts[p].text;
      idx = t.indexOf(tok);
      while (idx >= 0) {
        before = idx > 0 ? t.charAt(idx - 1) : "";
        after = t.charAt(idx + tok.length);
        nextAfter = t.charAt(idx + tok.length + 1);
        bOk = !(before >= "0" && before <= "9") && before !== ".";
        aOk = !(after >= "0" && after <= "9") && (after !== "." || !(nextAfter >= "0" && nextAfter <= "9"));
        if (bOk && aOk) return { page: pageTexts[p].n, table: tableFor(t, idx) };
        idx = t.indexOf(tok, idx + 1);
      }
    }
    return null;
  }

  function buildPageTexts(pages) {
    var out = [], i, pg, words, parts, w;
    for (i = 0; i < (pages || []).length; i++) {
      pg = pages[i];
      words = pg.words || [];
      parts = [];
      for (w = 0; w < words.length; w++) parts.push(words[w].t);
      out.push({ n: pg.n != null ? pg.n : i + 1, text: parts.join(" ") });
    }
    return out;
  }

  /* Every number must appear verbatim in the thesis. A number that is not
     found is removed and its sentence flagged "check this number". Kept
     numbers carry a locator (page, table). Reporting constants (95% CI,
     p < .001) are not thesis data and are left alone. */
  function verifyNumbers(text, pageTexts) {
    var sentences = splitSentences(String(text || ""));
    var flags = [], locators = [], seen = {}, outParts = [];
    var s, sent, lead, body, toks, flagged, newBody, removals, k, t, loc, r, rm;
    for (s = 0; s < sentences.length; s++) {
      sent = sentences[s];
      lead = sent.match(/^\s*/)[0];
      body = sent.slice(lead.length);
      toks = numTokens(body);
      flagged = false;
      newBody = body;
      removals = [];
      for (k = 0; k < toks.length; k++) {
        t = toks[k];
        if (isReportingConstant(body, t.idx, t.tok)) continue;
        loc = findNumber(pageTexts || [], t.tok);
        if (loc) {
          if (!seen[t.tok]) { seen[t.tok] = true; locators.push({ number: t.tok, page: loc.page, table: loc.table }); }
        } else {
          flagged = true;
          removals.push(t);
          flags.push({ sentence: body.replace(/\s+$/, "").replace(/[.!?]$/, ""), number: t.tok });
        }
      }
      if (flagged) {
        removals.sort(function (a, b) { return b.idx - a.idx; });
        for (r = 0; r < removals.length; r++) {
          rm = removals[r];
          newBody = newBody.slice(0, rm.idx) + newBody.slice(rm.idx + rm.tok.length);
        }
        newBody = newBody.replace(/\s{2,}/g, " ").replace(/\s+([,;.)])/g, "$1");
        newBody = newBody.replace(/[.!?]\s*$/, "") + " [check this number].";
      }
      outParts.push(lead + newBody);
    }
    return { text: outParts.join(""), flags: flags, locators: locators };
  }

  function countWords(t) {
    t = String(t || "").replace(/^\s+|\s+$/g, "");
    return t ? t.split(/\s+/).length : 0;
  }

  /* Trim whole sentences from the end of the main text (never the abstract)
     until it fits the journal word limit. Deterministic, no recomputation. */
  function enforceWordLimit(sections, limit) {
    var secs = [], i, total = 0, li, sentences, trimmed = false;
    for (i = 0; i < (sections || []).length; i++) {
      secs.push({ id: sections[i].id, heading: sections[i].heading, text: sections[i].text });
    }
    if (!isFinite(limit) || limit <= 0) return { sections: secs, words: 0, trimmed: false };
    function mainTotal() {
      var sum = 0, j;
      for (j = 0; j < secs.length; j++) if (secs[j].id !== "abstract") sum += countWords(secs[j].text);
      return sum;
    }
    total = mainTotal();
    while (total > limit) {
      li = -1;
      for (i = 0; i < secs.length; i++) if (secs[i].id !== "abstract" && countWords(secs[i].text) > 0) li = i;
      if (li < 0) break;
      sentences = splitSentences(secs[li].text);
      if (sentences.length > 1) {
        sentences.pop();
        secs[li].text = sentences.join("").replace(/\s+$/, "");
      } else {
        secs[li].text = "";
      }
      trimmed = true;
      total = mainTotal();
    }
    return { sections: secs, words: total, trimmed: trimmed };
  }

  function suggestPaperType(text) {
    var t = String(text || "").toLowerCase();
    if (t.indexOf("systematic review") >= 0 || t.indexOf("meta-analysis") >= 0 || t.indexOf("meta analysis") >= 0) {
      return { key: "sr", checklist: "prisma2020", checklistName: "PRISMA", why: "Your thesis mentions a systematic review or meta-analysis." };
    }
    if (t.indexOf("randomized") >= 0 || t.indexOf("randomised") >= 0 || t.indexOf(" rct ") >= 0) {
      return { key: "rct", checklist: "consort", checklistName: "CONSORT", why: "Your thesis describes a randomized controlled trial." };
    }
    if (t.indexOf("case report") >= 0 || t.indexOf("case series") >= 0) {
      return { key: "case", checklist: "care", checklistName: "CARE", why: "Your thesis is a case report or case series." };
    }
    return { key: "obs", checklist: "strobe", checklistName: "STROBE", why: "Your thesis looks like an observational study (cohort, case-control or cross-sectional)." };
  }

  function referenceFlags(refs) {
    var out = [], i, r;
    for (i = 0; i < (refs || []).length; i++) {
      r = refs[i] || {};
      out.push({ ref: r, needCheck: !r.doi && !r.pmid });
    }
    return out;
  }

  function formatReference(ref, style, idx) {
    ref = ref || {};
    var authors = ref.authors;
    if (Object.prototype.toString.call(authors) === "[object Array]") authors = authors.join(", ");
    authors = authors || "";
    var title = ref.title || "", journal = ref.journal || "", year = ref.year || "";
    var vol = ref.volume || "", issue = ref.issue || "", pages = ref.pages || "";
    var doi = ref.doi || "", pmid = ref.pmid || "", s;
    if (style === "apa") {
      s = authors + " (" + (year || "n.d.") + "). " + title + ". " + journal + ".";
    } else {
      s = (idx != null ? (idx + 1) + ". " : "") + authors + " " + title + ". " + journal + ". " +
        (year ? year + ";" : "") + vol + (issue ? "(" + issue + ")" : "") + (pages ? ":" + pages : "") + ".";
    }
    if (doi) s += " doi: " + doi + ".";
    if (pmid) s += " PMID: " + pmid + ".";
    return s.replace(/\s{2,}/g, " ").replace(/\s+\./g, ".").replace(/\.\./g, ".").replace(/^\s+|\s+$/g, "");
  }

  function suggestTables(tables, max) {
    var list = (tables || []).slice(), out = [], i;
    list.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    for (i = 0; i < list.length && out.length < (max || 3); i++) out.push(list[i].id);
    return out;
  }

  function canRunAi(project) {
    var r = (project && project.role) || "owner";
    return r === "owner" || r === "editor" || r === "analyst";
  }

  /* Viewers cannot run AI; PHI consent is handled via a calm consent sheet
     rather than hard-blocking the thesis upload. */
  function aiGate(project) {
    if (!canRunAi(project)) return { allowed: false, reason: "role" };
    return { allowed: true, reason: "" };
  }

  /* ---------- client-side thesis PHI masking + soft finding scan (ES5) ---------- */

  var V_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
  ];
  var V_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
  ];

  function verhoeffValid(d12) {
    if (!/^\d{12}$/.test(d12)) return false;
    var c = 0, i;
    for (i = 0; i < 12; i++) c = V_D[c][V_P[i % 8][Number(d12.charAt(11 - i))]];
    return c === 0;
  }

  function nhsMod11Valid(d10) {
    if (!/^\d{10}$/.test(d10)) return false;
    var sum = 0, i, r, chk;
    for (i = 0; i < 9; i++) sum += Number(d10.charAt(i)) * (10 - i);
    r = 11 - (sum % 11);
    chk = r === 11 ? 0 : r;
    if (chk === 10) return false;
    return chk === Number(d10.charAt(9));
  }

  function maskThesisHardIds(text) {
    var out = String(text || "");
    var count = 0;

    out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, function () {
      count += 1;
      return "[email]";
    });
    out = out.replace(/\b(?:dob|date\s+of\s+birth|d\.?o\.?b\.?)\s*[:=-]?\s*(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})\b/gi, function () {
      count += 1;
      return "[DOB]";
    });
    out = out.replace(/\b\d{2}-\d{4}-\d{4}-\d{4}\b/g, function () {
      count += 1;
      return "[ID]";
    });
    out = out.replace(/(^|[^A-Za-z0-9])((?:uhid|mrn|ip\s*(?:no|num|number|#)?|op\s*(?:no|num|number|#)?|cr\s*(?:no|num|number|#)?|hospital\s*(?:no|num|number|id))\s*[:#=-]?\s*[A-Za-z0-9-]*\d[A-Za-z0-9-]{2,})\b/gi, function (_, pre) {
      count += 1;
      return pre + "[ID]";
    });
    out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, function () {
      count += 1;
      return "[ID]";
    });
    out = out.replace(/\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g, function (m) {
      if (verhoeffValid(m.replace(/[\s-]/g, ""))) {
        count += 1;
        return "[ID]";
      }
      return m;
    });
    out = out.replace(/(?:\+?91[\s-]?)?[6-9]\d{9}\b|\b(?:\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, function () {
      count += 1;
      return "[phone]";
    });
    out = out.replace(/\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/g, function (m) {
      if (nhsMod11Valid(m.replace(/[\s-]/g, ""))) {
        count += 1;
        return "[ID]";
      }
      return m;
    });

    return { text: out, maskedCount: count };
  }

  function shortMaskedPreview(text, start, end, placeholder) {
    var raw = String(text || "");
    var pad = 14;
    var left = Math.max(0, start - pad);
    var right = Math.min(raw.length, end + pad);
    var before = raw.slice(left, start).replace(/\s+/g, " ").replace(/^\s+/, "");
    var after = raw.slice(end, right).replace(/\s+/g, " ").replace(/\s+$/, "");
    return (left > 0 ? "..." : "") + before + (placeholder || "[detail]") + after + (right < raw.length ? "..." : "");
  }

  var THESIS_SOFT_RULES = [
    {
      cat: "patient_name",
      placeholder: "[name]",
      re: /\bpatient\s*(?:name)?\s*[:=-]\s*([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20}){0,2})\b/g,
      group: 1
    },
    {
      cat: "patient_name",
      placeholder: "[name]",
      re: /\b(?:patient|patients|case|admitted|diagnosed|mr\.?|mrs\.?|ms\.?|shri|smt|kumari)\b[^.!?\n]{0,40}\b([A-Z][a-z]{1,18}\s+[A-Z][a-z]{1,18}(?:\s+[A-Z][a-z]{1,18})?)/g,
      group: 1
    },
    {
      cat: "address",
      placeholder: "[address]",
      re: /\b(?:resident\s+of|address\s*[:=-]|r\/o|s\/o|d\/o|w\/o)\s+[^\n.]{3,60}/gi,
      group: 0
    },
    {
      cat: "admission_date",
      placeholder: "[date]",
      re: /\b(?:admitted\s+on|date\s+of\s+admission|discharged\s+on|date\s+of\s+discharge|doa|dod)\s*[:=-]?\s*(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})\b/gi,
      group: 0
    }
  ];

  function scanThesisPages(pages) {
    var outPages = [];
    var maskedCount = 0;
    var softPages = [];
    var softSeen = {};
    var findings = [];
    var catSeen = {};
    var categories = [];
    var i, r, m, pg, num, masked, txt, hitStart, hitLen;

    for (i = 0; i < (pages || []).length; i++) {
      pg = pages[i] || {};
      num = Number(pg.n || (i + 1));
      masked = maskThesisHardIds(pg.text || "");
      maskedCount += masked.maskedCount;
      txt = masked.text;
      outPages.push({ n: num, text: txt });

      for (r = 0; r < THESIS_SOFT_RULES.length; r++) {
        var rule = THESIS_SOFT_RULES[r];
        rule.re.lastIndex = 0;
        while ((m = rule.re.exec(txt)) !== null) {
          var sub = rule.group ? m[rule.group] : m[0];
          if (sub) {
            hitStart = rule.group ? (m.index + m[0].lastIndexOf(sub)) : m.index;
            hitLen = sub.length;
            if (!softSeen[num]) {
              softSeen[num] = true;
              softPages.push(num);
            }
            if (!catSeen[rule.cat]) {
              catSeen[rule.cat] = true;
              categories.push(rule.cat);
            }
            if (findings.length < 12) {
              findings.push({
                page: num,
                category: rule.cat,
                preview: shortMaskedPreview(txt, hitStart, hitStart + hitLen, rule.placeholder)
              });
            }
          }
          if (m[0].length === 0) rule.re.lastIndex += 1;
        }
      }
    }
    softPages.sort(function (a, b) { return a - b; });
    return {
      pages: outPages,
      maskedCount: maskedCount,
      softPages: softPages,
      findings: findings,
      categories: categories
    };
  }

  /* ---------- state ---------- */

  function loadThesis(pid) {
    try {
      if (typeof localStorage === "undefined") return {};
      var all = JSON.parse(localStorage.getItem(THESIS_KEY) || "{}");
      return all[pid] || {};
    } catch (e) { return {}; }
  }

  function saveThesis(pid, patch) {
    try {
      if (typeof localStorage === "undefined") return;
      var all = JSON.parse(localStorage.getItem(THESIS_KEY) || "{}");
      var cur = all[pid] || {}, k;
      for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) cur[k] = patch[k];
      all[pid] = cur;
      localStorage.setItem(THESIS_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  function activeProject() {
    return SMD && SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
  }
  function pidOf(proj) { return proj ? (proj.serverId || proj.id) : ""; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function allThesisText() {
    var parts = [], i;
    for (i = 0; i < (ts.pages || []).length; i++) parts.push(ts.pages[i].text);
    return parts.join("\n");
  }
  function journalOf() { return ts.journal || DEFAULT_JOURNAL; }
  function styleName(style) {
    if (style === "apa") return "APA style (author and year)";
    if (style === "vancouver") return "Vancouver style (numbered in order of appearance)";
    return style || "Vancouver style (numbered in order of appearance)";
  }

  var ts = {};
  var tpid = "";
  var draftAi = null;
  var pollTimer = null;

  /* ---------- shared chrome ---------- */

  function nextBtn(screen, label) {
    return '<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-thesis-next="' + screen + '">' + esc(label || "Next") + '</button>';
  }

  function closeConsentSheet() {
    if (!D) return;
    var existing = D.getElementById("rmdThesisConsentSheet");
    if (existing) {
      if (existing.open && typeof existing.close === "function") {
        try { existing.close(); } catch (e) {}
      }
      if (existing.parentNode) existing.parentNode.removeChild(existing);
    }
  }

  function openConsentSheet(info, handlers) {
    if (!D || !D.body) return;
    info = info || {};
    handlers = handlers || {};
    var pages = info.softPages || info.pages || [];
    var maskedCount = Number(info.maskedCount || 0);
    var findings = info.findings || [];
    if (!pages.length) return;

    closeConsentSheet();

    var mount = D.getElementById("researchMD") || D.body;
    var dlg = D.createElement("dialog");
    dlg.id = "rmdThesisConsentSheet";
    dlg.className = "rmd-thesis-consent-dialog";
    dlg.setAttribute("aria-labelledby", "rmdThesisConsentTitle");
    dlg.setAttribute("aria-describedby", "rmdThesisConsentDesc");

    var pageList = pages.join(", ");
    var maskedSummary = maskedCount === 1
      ? "1 phone number or ID number hidden automatically."
      : maskedCount + " phone numbers and ID numbers hidden automatically.";

    var h = [];
    h.push('<div class="rmd-thesis-consent-card">');
    h.push('<h3 id="rmdThesisConsentTitle">Check for patient details</h3>');
    h.push('<p id="rmdThesisConsentDesc">We looked for patient details on these pages: ' + esc(pageList) + '. We hid phone numbers and ID numbers automatically. Names in a reference list or an author line are fine. Please confirm there are no patient names left.</p>');
    h.push('<p class="rmd-thesis-consent-count" id="rmdThesisConsentMasked">' + esc(maskedSummary) + '</p>');
    if (findings.length) {
      h.push('<ul class="rmd-thesis-consent-list">');
      for (var i = 0; i < findings.length && i < 5; i++) {
        var f = findings[i] || {};
        h.push('<li><strong>Page ' + esc(f.page) + ':</strong> ' + esc(f.preview || "[detail]") + '</li>');
      }
      h.push('</ul>');
    }
    h.push('<div class="rmd-thesis-consent-actions">');
    h.push('<button type="button" class="rmd-btn" id="rmdThesisConsentReupload" autofocus>Upload a different file</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary" id="rmdThesisConsentConfirm">I confirm, continue</button>');
    h.push('</div>');
    h.push('</div>');
    dlg.innerHTML = h.join("");
    mount.appendChild(dlg);

    var confirmBtn = dlg.querySelector("#rmdThesisConsentConfirm");
    var reuploadBtn = dlg.querySelector("#rmdThesisConsentReupload");

    dlg.addEventListener("cancel", function () {
      closeConsentSheet();
      if (handlers.onCancel) handlers.onCancel();
    });
    if (confirmBtn) confirmBtn.onclick = function () {
      var consent = {
        confirmed: true,
        timestamp: new Date().toISOString(),
        pages: pages.slice(),
        maskedCount: maskedCount
      };
      saveThesis(tpid, {
        phiConsent: consent,
        phi: { softPages: pages.slice(), maskedCount: maskedCount, findings: findings.slice() }
      });
      ts = loadThesis(tpid);
      closeConsentSheet();
      if (handlers.onConfirm) handlers.onConfirm(consent);
    };
    if (reuploadBtn) reuploadBtn.onclick = function () {
      saveThesis(tpid, { pages: null, phi: null, phiConsent: null, artifactId: null, jobId: null, draft: null });
      ts = loadThesis(tpid);
      closeConsentSheet();
      if (handlers.onReupload) handlers.onReupload();
    };

    if (typeof dlg.showModal === "function") {
      try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); }
    } else {
      dlg.setAttribute("open", "");
    }
  }

  function needPagesHtml(container) {
    container.innerHTML = '<div class="rmd-p2-screen rmd-thesis-screen"><div class="rmd-card">' +
      '<h2>Upload your thesis first</h2>' +
      '<p class="rmd-screen-subtitle">We read your thesis before we can shape it into a paper.</p>' +
      '<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-thesis-next="thesis">Go to upload</button>' +
      '</div></div>';
    bindNext(container);
  }

  function bindNext(container) {
    var btns = container.querySelectorAll("[data-rmd-thesis-next]"), i;
    for (i = 0; i < btns.length; i++) {
      btns[i].onclick = function () { SMD.navigate(this.getAttribute("data-rmd-thesis-next")); };
    }
  }

  /* ---------- screen: upload ---------- */

  function renderUpload(container) {
    var proj = activeProject();
    if (!proj) { container.innerHTML = SMD.p2.errHtml("Open a project first."); return; }
    tpid = pidOf(proj);
    ts = loadThesis(tpid);
    injectCSS();
    var h = ['<div class="rmd-p2-screen rmd-thesis-screen">'];
    if (ts.pages && ts.pages.length) {
      h.push('<div class="rmd-card">');
      h.push('<h2>Thesis read</h2>');
      h.push('<p class="rmd-screen-subtitle">' + esc(ts.filename || "Your thesis") + ' was read: ' + ts.pages.length + ' page(s). The text stays on this device and on our server; it is only sent to an AI provider when you ask MaiK to draft.</p>');
      if (ts.phi && ts.phi.softPages && ts.phi.softPages.length && !(ts.phiConsent && ts.phiConsent.confirmed)) {
        h.push('<p class="rmd-thesis-meta" id="rmdThesisConsentHint">We flagged pages ' + esc(ts.phi.softPages.join(", ")) + ' for a quick patient-details check before AI drafting.</p>');
      }
      h.push('<div class="rmd-card-actions"><button type="button" class="rmd-btn" id="rmdThesisReupload">Upload a different file</button>');
      if (ts.phi && ts.phi.softPages && ts.phi.softPages.length && !(ts.phiConsent && ts.phiConsent.confirmed)) {
        h.push('<button type="button" class="rmd-btn" id="rmdThesisOpenConsent">Check for patient details</button>');
      }
      h.push(nextBtn("thesis-type", "Next: pick the paper type") + '</div>');
      h.push('</div>');
    } else {
      h.push('<div class="rmd-card">');
      h.push('<h2>Upload your thesis</h2>');
      h.push('<p class="rmd-screen-subtitle">PDF or Word (.docx), up to 40 MB. Text and tables are read directly on your device; scanned PDFs use our OCR server.</p>');
      h.push('<div class="rmd-field"><label for="rmdThesisFile">Thesis file</label>');
      h.push('<input type="file" id="rmdThesisFile" accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-word.document.12,application/docx,application/msword"></div>');
      h.push('<p class="rmd-thesis-meta">Supports PDF and Word (.docx) thesis files directly, including results tables.</p>');
      h.push('<div id="rmdThesisMsg"></div>');
      h.push('</div>');
    }
    h.push('</div>');
    container.innerHTML = h.join("");
    bindNext(container);
    var fileEl = container.querySelector("#rmdThesisFile");
    if (fileEl) fileEl.onchange = function () { if (this.files && this.files[0]) handleFile(this.files[0], container); };
    var re = container.querySelector("#rmdThesisReupload");
    if (re) re.onclick = function () {
      saveThesis(tpid, { pages: null, phi: null, phiConsent: null, artifactId: null, jobId: null, draft: null });
      ts = loadThesis(tpid);
      renderUpload(container);
    };
    var openConsent = container.querySelector("#rmdThesisOpenConsent");
    if (openConsent) openConsent.onclick = function () {
      openConsentSheet(ts.phi, {
        onConfirm: function () { renderUpload(container); },
        onReupload: function () { renderUpload(container); }
      });
    };
  }

  function setMsg(container, html) {
    var box = container.querySelector("#rmdThesisMsg");
    if (box) box.innerHTML = html;
  }

  function uploadPdfServer(file, container) {
    var proj = activeProject();
    if (!proj || !proj.serverId) {
      setMsg(container, '<div class="rmd-banner rmd-banner-warn">This PDF has no selectable text (scanned pages) and requires a synced account project for server OCR. Save this project to your account first, or upload a selectable-text PDF or Word (.docx) file.</div>');
      return;
    }
    if (file.size > 26214400) {
      setMsg(container, '<div class="rmd-banner rmd-banner-warn">This scanned PDF has no selectable text and exceeds the 25 MB server OCR limit. Export a selectable-text PDF, upload a .docx file, or split this PDF under 25 MB.</div>');
      return;
    }
    setMsg(container, SMD.p2.loadingHtml("Uploading your thesis"));
    var form = new FormData();
    form.append("file", file);
    SMD.api.upload("/v1/projects/" + tpid + "/pdf-uploads", form).then(function (res) {
      var art = (res && res.artifact) || {};
      saveThesis(tpid, { artifactId: art.id, jobId: art.jobId, filename: art.filename || file.name, phi: null });
      ts = loadThesis(tpid);
      pollJob(art.jobId, 0, container);
    }).catch(function (err) {
      var msg;
      if (err && (err.code === "ceiling_bytes" || err.status === 413)) {
        msg = "The server reads scanned PDFs up to 25 MB. Export a selectable-text PDF, upload a .docx file, or upload a smaller PDF.";
      } else if (err && err.code === "file_type") {
        msg = "That file is not a valid PDF. Export your thesis as a PDF or upload a Word (.docx) file.";
      } else if (err && (err.code === "storage_unavailable" || err.code === "queue_unavailable")) {
        msg = "Server OCR is unavailable right now. Upload a selectable-text PDF or Word (.docx) file, which is read right on your device.";
      } else if (err && err.code === "project_not_found") {
        msg = "Save this project to your account first for scanned-PDF upload, or upload a selectable-text PDF or .docx.";
      } else {
        msg = SMD.p2.friendlyError(err).message;
      }
      setMsg(container, '<div class="rmd-banner rmd-banner-warn">' + esc(msg) + '</div>');
    });
  }

  function saveExtractedPages(pages, filename, container, extra) {
    var scanRes = scanThesisPages(pages);
    var phiInfo = scanRes.softPages.length
      ? { softPages: scanRes.softPages, maskedCount: scanRes.maskedCount, findings: scanRes.findings }
      : (scanRes.maskedCount ? { softPages: [], maskedCount: scanRes.maskedCount, findings: [] } : null);
    var patch = {
      pages: scanRes.pages,
      filename: filename,
      phi: phiInfo,
      phiConsent: null
    };
    if (extra) {
      if ("artifactId" in extra) patch.artifactId = extra.artifactId;
      if ("jobId" in extra) patch.jobId = extra.jobId;
    }
    saveThesis(tpid, patch);
    ts = loadThesis(tpid);
    renderUpload(container);
    if (scanRes.softPages.length) {
      openConsentSheet(phiInfo, {
        onConfirm: function () { renderUpload(container); },
        onReupload: function () { renderUpload(container); }
      });
    }
  }

  function handleFile(file, container) {
    if (!file) return;
    var name = (file.name || "").replace(/^\s+|\s+$/g, "").toLowerCase();
    var mime = (file.type || "").replace(/^\s+|\s+$/g, "").toLowerCase();
    if (file.size > MAX_BYTES) {
      setMsg(container, '<div class="rmd-banner rmd-banner-warn">This file is larger than 40 MB. Split it or export a smaller file.</div>');
      return;
    }
    var isDocxFile = /\.docx$/i.test(name) ||
      mime.indexOf("wordprocessingml") >= 0 ||
      mime === "application/docx" ||
      mime === "application/x-docx" ||
      mime === "application/vnd.ms-word.document.12";
    var isLegacyDoc = (/\.doc$/i.test(name) || mime === "application/msword") && !isDocxFile;
    if (isLegacyDoc) {
      setMsg(container, '<div class="rmd-banner rmd-banner-warn">Older Word (.doc) files are binary format. In Word, use File, then Save As Word Document (.docx) or PDF, and upload again.</div>');
      return;
    }
    if (isDocxFile) {
      setMsg(container, (SMD.p2 && SMD.p2.loadingHtml) ? SMD.p2.loadingHtml("Reading your Word (.docx) thesis") : "Reading your Word (.docx) thesis");
      readFileAsArrayBuffer(file).then(parseDocx).then(function (pages) {
        saveExtractedPages(pages, file.name, container, { artifactId: null, jobId: null });
      }).catch(function (err) {
        var msg = (err && err.message) ? err.message : "Could not read this Word (.docx) document. Export it as PDF and upload again.";
        setMsg(container, '<div class="rmd-banner rmd-banner-warn">' + esc(msg) + '</div>');
      });
      return;
    }
    // Try on-device PDF extraction first for real PDFs (works up to 40 MB and >60 pages, 0 tokens).
    // Tiny fixtures (< 100 bytes) or scanned image-only PDFs automatically fall back to server OCR.
    if (file.size >= 100 && (typeof file.arrayBuffer === "function" || typeof FileReader !== "undefined")) {
      setMsg(container, (SMD.p2 && SMD.p2.loadingHtml) ? SMD.p2.loadingHtml("Reading your thesis") : "Reading your thesis");
      readPdfLocal(file, function (cur, tot) {
        setMsg(container, (SMD.p2 && SMD.p2.loadingHtml) ? SMD.p2.loadingHtml("Reading page " + cur + " of " + tot) : "Reading page " + cur + " of " + tot);
      }).then(function (res) {
        if (res && res.pages && res.pages.length) {
          saveExtractedPages(res.pages, file.name, container, { artifactId: null, jobId: null });
          return;
        }
        uploadPdfServer(file, container);
      }).catch(function (err) {
        if (err && err.name === "PasswordException") {
          setMsg(container, '<div class="rmd-banner rmd-banner-warn">This PDF is password-protected. Save an unlocked copy (or export as Word .docx) and upload again.</div>');
          return;
        }
        uploadPdfServer(file, container);
      });
      return;
    }
    uploadPdfServer(file, container);
  }

  function pollJob(jobId, tries, container) {
    if (!jobId) { loadResult(container); return; }
    if (tries > POLL_TRIES) {
      setMsg(container, '<div class="rmd-banner rmd-banner-warn">Reading is taking longer than usual. Go back and try again.</div>');
      return;
    }
    SMD.api.request("GET", "/v1/jobs/" + jobId).then(function (job) {
      job = job || {};
      if (job.status === "succeeded") { loadResult(container); return; }
      if (job.status === "failed" || job.status === "cancelled") {
        if (job.errorCode === "phi_blocked" || job.errorCode === "consent_needed") {
          var pages = job.errorPages || job.phiPages || (job.error && job.error.pages) || [];
          var maskedCount = Number(job.maskedCount || (job.error && job.error.maskedCount) || 0);
          var findings = job.findings || (job.error && job.error.findings) || [];
          var phiInfo = { softPages: pages, maskedCount: maskedCount, findings: findings };
          saveThesis(tpid, { phi: phiInfo, phiConsent: null });
          ts = loadThesis(tpid);
          renderUpload(container);
          openConsentSheet(phiInfo, {
            onConfirm: function () {
              if (ts.artifactId) loadResult(container);
              else renderUpload(container);
            },
            onReupload: function () { renderUpload(container); }
          });
          return;
        }
        setMsg(container, '<div class="rmd-banner rmd-banner-warn">We could not read this PDF. Try again, or export a fresh PDF.</div>');
        return;
      }
      pollTimer = G.setTimeout(function () { pollJob(jobId, tries + 1, container); }, POLL_MS);
    }).catch(function () {
      pollTimer = G.setTimeout(function () { pollJob(jobId, tries + 1, container); }, POLL_MS);
    });
  }

  function loadResult(container) {
    if (!ts.artifactId) { renderUpload(container); return; }
    SMD.api.request("GET", "/v1/artifacts/" + ts.artifactId + "/result").then(function (res) {
      var pages = buildPageTexts((res && res.pages) || []);
      saveExtractedPages(pages, ts.filename || "Your thesis", container);
    }).catch(function () {
      pollTimer = G.setTimeout(function () { loadResult(container); }, POLL_MS);
    });
  }

  /* ---------- screen: paper type ---------- */

  function renderType(container) {
    var proj = activeProject();
    if (!proj) { container.innerHTML = SMD.p2.errHtml("Open a project first."); return; }
    tpid = pidOf(proj);
    ts = loadThesis(tpid);
    injectCSS();
    if (!ts.pages || !ts.pages.length) { needPagesHtml(container); return; }
    var sug = suggestPaperType(allThesisText());
    var chosen = ts.paperType || sug.key;
    var h = ['<div class="rmd-p2-screen rmd-thesis-screen"><div class="rmd-card">'];
    h.push('<h2>Pick the paper type</h2>');
    h.push('<p class="rmd-screen-subtitle">Suggested: ' + esc(labelFor(chosen)) + '. ' + esc(sug.why) + '</p>');
    var i, pt;
    for (i = 0; i < PAPER_TYPES.length; i++) {
      pt = PAPER_TYPES[i];
      h.push('<button type="button" class="rmd-start-choice" data-rmd-type="' + pt.key + '" aria-pressed="' + (pt.key === chosen ? "true" : "false") + '">');
      h.push(esc(pt.label) + (pt.key === sug.key ? ' <span class="rmd-badge-pill">Suggested</span>' : ''));
      h.push('<span>Reporting checklist: ' + esc(pt.checklistName) + ' (' + esc(pt.gloss) + '). ' + esc(pt.eg) + '</span>');
      h.push('</button>');
    }
    h.push('<div class="rmd-card-actions">' + nextBtn("thesis-journal", "Next: pick the journal") + '</div>');
    h.push('</div></div>');
    container.innerHTML = h.join("");
    bindNext(container);
    var btns = container.querySelectorAll("[data-rmd-type]");
    for (i = 0; i < btns.length; i++) {
      btns[i].onclick = function () {
        var key = this.getAttribute("data-rmd-type"), j, gid = "";
        for (j = 0; j < PAPER_TYPES.length; j++) if (PAPER_TYPES[j].key === key) gid = PAPER_TYPES[j].checklist;
        saveThesis(tpid, { paperType: key, checklist: gid });
        if (SMD.setPreferredChecklist) SMD.setPreferredChecklist(tpid, gid);
        ts = loadThesis(tpid);
        renderType(container);
      };
    }
  }

  function labelFor(key) {
    var i;
    for (i = 0; i < PAPER_TYPES.length; i++) if (PAPER_TYPES[i].key === key) return PAPER_TYPES[i].label;
    return "Original article (observational study)";
  }

  /* ---------- screen: journal ---------- */

  var journalSeq = 0;
  var JOURNAL_CHIPS = [
    { key: "indian", label: "Indian" },
    { key: "international", label: "International" },
    { key: "open", label: "Open access" },
    { key: "pubmed", label: "PubMed indexed" },
    { key: "nofee", label: "No fee" }
  ];

  function checkValue(v) {
    return v == null || v === "" ? "Check the author guidelines" : String(v);
  }

  function fmtInt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function safeHttpUrl(u) {
    u = String(u == null ? "" : u);
    return /^https?:\/\//i.test(u) ? u : "";
  }

  function copyJournal(j) {
    var out = {}, k;
    for (k in j) if (Object.prototype.hasOwnProperty.call(j, k)) out[k] = j[k];
    return out;
  }

  function normJournal(j) {
    j = j || {};
    var limits = j.wordLimits || {};
    var wl = j.wordLimit;
    if (wl == null) wl = limits.main;
    var af = j.abstractFormat;
    if ((af == null || af === "") && limits.abstract != null) af = "Structured abstract, up to " + limits.abstract + " words";
    var numeric = Number(wl);
    return {
      id: j.id == null ? "" : String(j.id),
      name: j.name ? String(j.name) : "Journal",
      shortName: j.shortName ? String(j.shortName) : "",
      publisher: j.publisher ? String(j.publisher) : "",
      specialty: j.specialty ? String(j.specialty) : "",
      isIndian: typeof j.isIndian === "boolean" ? j.isIndian : null,
      openAccess: typeof j.openAccess === "boolean" ? j.openAccess : null,
      indexedPubMed: typeof j.indexedPubMed === "boolean" ? j.indexedPubMed : null,
      noFee: typeof j.noFee === "boolean" ? j.noFee : null,
      wordLimit: isFinite(numeric) && numeric > 0 ? numeric : null,
      abstractFormat: af == null || af === "" ? null : String(af),
      referenceStyle: j.referenceStyle == null || j.referenceStyle === "" ? null : String(j.referenceStyle),
      apcNote: j.apcNote == null || j.apcNote === "" ? null : String(j.apcNote),
      url: safeHttpUrl(j.url || j.authorInstructionsUrl),
      _best: false,
      matchScore: null
    };
  }

  function journalKey(j) {
    return j.id ? "id:" + j.id : "name:" + j.name.toLowerCase();
  }

  function matchKeywords(title, paperLabel) {
    var out = [], seen = {}, parts = String(title || "").split(/[^A-Za-z0-9]+/), i, w;
    for (i = 0; i < parts.length; i++) {
      w = parts[i];
      if (w.length < 4 || seen[w.toLowerCase()]) continue;
      seen[w.toLowerCase()] = true;
      out.push(w.length > 80 ? w.slice(0, 80) : w);
    }
    out.push(paperLabel);
    return out.slice(0, 20);
  }

  function designForPaperType(t) {
    if (t === "rct") return "rct";
    if (t === "sr") return "systematic_review";
    if (t === "case") return "case_report";
    return "observational";
  }

  function journalFromCatalogue(j) {
    return {
      id: j.id,
      name: j.name,
      shortName: j.shortName,
      wordLimit: j.wordLimit == null ? DEFAULT_JOURNAL.wordLimit : j.wordLimit,
      abstractFormat: j.abstractFormat || DEFAULT_JOURNAL.abstractFormat,
      referenceStyle: j.referenceStyle || "vancouver",
      publisher: j.publisher,
      guidelinesUrl: j.url,
      feeNote: j.apcNote
    };
  }

  function selectedJournalKey() {
    var sel = journalOf();
    if (sel.custom || sel.id === "custom") return "custom";
    if (!sel.id && (!sel.name || sel.name === DEFAULT_JOURNAL.name)) return "default";
    return sel.id;
  }

  function setSelectedMark(el, on) {
    var pill;
    if (!el) return;
    el.setAttribute("aria-pressed", on ? "true" : "false");
    pill = el.querySelector(".rmd-journal-selected");
    if (pill) {
      if (on) pill.removeAttribute("hidden");
      else pill.setAttribute("hidden", "");
    }
  }

  function updateJournalSelection(container) {
    var key = selectedJournalKey(), sel = journalOf();
    var picks = container.querySelectorAll("[data-rmd-journal-id]"), i, on, item, summary;
    setSelectedMark(container.querySelector('[data-rmd-journal="default"]'), key === "default");
    setSelectedMark(container.querySelector('[data-rmd-journal="other"]'), key === "custom");
    for (i = 0; i < picks.length; i++) {
      on = key === picks[i].getAttribute("data-rmd-journal-id");
      setSelectedMark(picks[i], on);
      item = picks[i].parentNode;
      if (item) item.setAttribute("data-selected", on ? "true" : "false");
    }
    summary = container.querySelector("#rmdJournalOtherSummary");
    if (summary) {
      if (key === "custom") {
        summary.textContent = sel.name + ". Word limit: " + fmtInt(sel.wordLimit) + " words. " + styleName(sel.referenceStyle) + ".";
      } else {
        summary.textContent = "Type the name, word limit, abstract format and reference style.";
      }
    }
  }

  function setJournalCustomOpen(container, open) {
    var form = container.querySelector("#rmdJournalCustom");
    var btn = container.querySelector('[data-rmd-journal="other"]');
    if (!form) return;
    if (open) form.removeAttribute("hidden");
    else form.setAttribute("hidden", "");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      var name = container.querySelector("#rmdJournalCustomName");
      if (name) name.focus();
    }
  }

  function journalPasses(j, q, chips) {
    if (q) {
      var hay = (j.name + " " + j.shortName + " " + j.specialty).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    if (chips.indian && j.isIndian !== true) return false;
    if (chips.international && j.isIndian !== false) return false;
    if (chips.open && j.openAccess !== true) return false;
    if (chips.pubmed && j.indexedPubMed !== true) return false;
    if (chips.nofee && j.noFee !== true) return false;
    return true;
  }

  function journalView(state) {
    var items = state.items || [], matches = state.matches || [], byId = {}, used = {}, out = [], i, j, key, cat;
    for (i = 0; i < items.length; i++) byId[journalKey(items[i])] = items[i];
    for (i = 0; i < matches.length; i++) {
      j = matches[i];
      key = journalKey(j);
      if (used[key]) continue;
      cat = byId[key];
      if (cat) {
        j = copyJournal(cat);
        j.matchScore = matches[i].matchScore;
      } else {
        j = copyJournal(j);
      }
      j._best = true;
      used[key] = true;
      out.push(j);
    }
    for (i = 0; i < items.length; i++) {
      key = journalKey(items[i]);
      if (used[key]) continue;
      used[key] = true;
      j = copyJournal(items[i]);
      j._best = false;
      out.push(j);
    }
    return out;
  }

  function journalRowHtml(j) {
    var pressed = selectedJournalKey() === j.id;
    var meta = [j.publisher || "Check the author guidelines"];
    var words = j.wordLimit == null ? "Check the author guidelines" : fmtInt(j.wordLimit) + " words";
    var abs = checkValue(j.abstractFormat);
    var refs = j.referenceStyle ? styleName(j.referenceStyle) : "Check the author guidelines";
    var fee = checkValue(j.apcNote);
    var h = [];
    if (j.specialty) meta.push(j.specialty);
    h.push('<li class="rmd-journal-item" data-selected="' + (pressed ? "true" : "false") + '">');
    h.push('<button type="button" class="rmd-journal-pick" data-rmd-journal-id="' + esc(j.id) + '" aria-pressed="' + (pressed ? "true" : "false") + '">');
    h.push('<span class="rmd-journal-head"><span class="rmd-journal-name">' + esc(j.name) + '</span><span class="rmd-journal-selected"' + (pressed ? "" : " hidden") + '>Selected</span></span>');
    h.push('<span class="rmd-journal-meta">' + esc(meta.join(", ")) + '</span>');
    h.push('<span class="rmd-journal-specs">');
    h.push('<span><b>Word limit:</b> ' + esc(words) + '</span>');
    h.push('<span><b>Abstract:</b> ' + esc(abs) + '</span>');
    h.push('<span><b>References:</b> ' + esc(refs) + '</span>');
    h.push('</span>');
    h.push('<span class="rmd-journal-fee"><b>Fee:</b> ' + esc(fee) + '</span>');
    h.push('</button>');
    if (j.url) {
      h.push('<a class="rmd-journal-link" href="' + esc(j.url) + '" target="_blank" rel="noopener noreferrer">Author guidelines</a>');
    } else {
      h.push('<span class="rmd-journal-link rmd-journal-link-missing">Author guidelines: Check the author guidelines</span>');
    }
    h.push('</li>');
    return h.join("");
  }

  function renderJournalResults(container, state) {
    var box = container.querySelector("#rmdJournalResults");
    var filters = container.querySelector("#rmdJournalFilters");
    if (!box) return;
    if (state.failed) {
      if (filters) filters.setAttribute("hidden", "");
      box.innerHTML = '<div class="rmd-banner rmd-banner-warn" role="status"><p class="rmd-journal-fallback-text">The journal list could not load. Check the connection, or use the general Indian format or Other journal.</p><button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" id="rmdJournalRetry">Try again</button></div>';
      var retry = box.querySelector("#rmdJournalRetry");
      if (retry) retry.onclick = function () { renderJournal(container); };
      return;
    }
    if (filters) filters.removeAttribute("hidden");
    if (state.loading) {
      box.innerHTML = '<p class="rmd-thesis-meta" role="status">Looking up journals...</p>';
      return;
    }
    var view = journalView(state), best = [], rest = [], i, j, h = [];
    var q = String(state.q || "").replace(/^\s+|\s+$/g, "").toLowerCase();
    for (i = 0; i < view.length; i++) {
      j = view[i];
      if (!journalPasses(j, q, state.chips)) continue;
      if (j._best) best.push(j);
      else rest.push(j);
    }
    if (!best.length && !rest.length) {
      box.innerHTML = '<p class="rmd-journal-empty" role="status">No journal matches that search. Try a shorter word, or clear a filter.</p>';
      return;
    }
    if (best.length) {
      h.push('<h3 class="rmd-journal-group">Best match for your study</h3>');
      h.push('<ul class="rmd-journal-list" role="list">');
      for (i = 0; i < best.length; i++) h.push(journalRowHtml(best[i]));
      h.push('</ul>');
    }
    if (rest.length) {
      h.push('<h3 class="rmd-journal-group">' + (best.length ? "All journals" : "Journals") + '</h3>');
      h.push('<ul class="rmd-journal-list" role="list">');
      for (i = 0; i < rest.length; i++) h.push(journalRowHtml(rest[i]));
      h.push('</ul>');
    }
    box.innerHTML = h.join("");
    var picks = box.querySelectorAll("[data-rmd-journal-id]");
    for (i = 0; i < picks.length; i++) {
      picks[i].onclick = function () {
        var id = this.getAttribute("data-rmd-journal-id"), list = journalView(state), k;
        for (k = 0; k < list.length; k++) {
          if (list[k].id === id) {
            saveThesis(tpid, { journal: journalFromCatalogue(list[k]) });
            ts = loadThesis(tpid);
            setJournalCustomOpen(container, false);
            updateJournalSelection(container);
            return;
          }
        }
      };
    }
  }

  function renderJournal(container) {
    var proj = activeProject();
    if (!proj) { container.innerHTML = SMD.p2.errHtml("Open a project first."); return; }
    tpid = pidOf(proj);
    ts = loadThesis(tpid);
    injectCSS();
    if (!ts.pages || !ts.pages.length) { needPagesHtml(container); return; }
    var seq = ++journalSeq;
    var sel = journalOf();
    var custom = selectedJournalKey() === "custom";
    var state = { q: "", chips: {}, items: [], matches: [], loading: true, failed: false };
    var h = ['<div class="rmd-p2-screen rmd-thesis-screen"><div class="rmd-card">'];
    h.push('<h2>Pick the target journal</h2>');
    h.push('<p class="rmd-screen-subtitle">We shape the draft to the journal word limit, abstract format and reference style.</p>');
    h.push('<button type="button" class="rmd-start-choice rmd-journal-option" data-rmd-journal="default" aria-pressed="' + (!custom && selectedJournalKey() === "default" ? "true" : "false") + '">');
    h.push('<span class="rmd-journal-head"><span class="rmd-journal-name">' + esc(DEFAULT_JOURNAL.name) + '</span><span class="rmd-journal-selected"' + (!custom && selectedJournalKey() === "default" ? "" : " hidden") + '>Selected</span></span>');
    h.push('<span class="rmd-journal-option-note">Word limit: ' + fmtInt(DEFAULT_JOURNAL.wordLimit) + ' words. Abstract: structured (Background, Methods, Results, Conclusion). References: ' + esc(styleName("vancouver")) + '.</span>');
    h.push('</button>');
    h.push('<div class="rmd-journal-picker" id="rmdJournalPicker">');
    h.push('<search class="rmd-journal-filters" id="rmdJournalFilters">');
    h.push('<div class="rmd-field"><label for="rmdJournalSearch">Search journals</label>');
    h.push('<input type="search" id="rmdJournalSearch" placeholder="Name, short name or specialty" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="search"></div>');
    h.push('<div class="rmd-journal-chips" role="group" aria-label="Filter journals">');
    var c;
    for (c = 0; c < JOURNAL_CHIPS.length; c++) {
      h.push('<button type="button" class="rmd-journal-chip" data-rmd-jchip="' + JOURNAL_CHIPS[c].key + '" aria-pressed="false">' + esc(JOURNAL_CHIPS[c].label) + '</button>');
    }
    h.push('</div>');
    h.push('</search>');
    h.push('<div id="rmdJournalResults"></div>');
    h.push('</div>');
    h.push('<button type="button" class="rmd-start-choice rmd-journal-option" data-rmd-journal="other" aria-pressed="' + (custom ? "true" : "false") + '" aria-expanded="' + (custom ? "true" : "false") + '" aria-controls="rmdJournalCustom">');
    h.push('<span class="rmd-journal-head"><span class="rmd-journal-name">Other journal</span><span class="rmd-journal-selected"' + (custom ? "" : " hidden") + '>Selected</span></span>');
    h.push('<span class="rmd-journal-option-note" id="rmdJournalOtherSummary"></span>');
    h.push('</button>');
    h.push('<div class="rmd-journal-custom" id="rmdJournalCustom"' + (custom ? "" : " hidden") + '>');
    h.push('<h3>Other journal details</h3>');
    h.push('<form id="rmdJournalCustomForm" novalidate>');
    h.push('<div class="rmd-field"><label for="rmdJournalCustomName">Journal name</label>');
    h.push('<input type="text" id="rmdJournalCustomName" value="' + esc(custom ? sel.name : "") + '" autocomplete="off" enterkeyhint="next"></div>');
    h.push('<div class="rmd-field"><label for="rmdJournalCustomWords">Word limit (words)</label>');
    h.push('<input type="number" id="rmdJournalCustomWords" min="100" max="100000" step="1" inputmode="numeric" value="' + esc(String(custom ? sel.wordLimit : sel.wordLimit || DEFAULT_JOURNAL.wordLimit)) + '" enterkeyhint="next"></div>');
    h.push('<div class="rmd-field"><label for="rmdJournalCustomAbstract">Abstract format</label>');
    h.push('<input type="text" id="rmdJournalCustomAbstract" value="' + esc(custom ? sel.abstractFormat : sel.abstractFormat || DEFAULT_JOURNAL.abstractFormat) + '" autocomplete="off" enterkeyhint="next"></div>');
    h.push('<div class="rmd-field"><label for="rmdJournalCustomRefs">Reference style</label>');
    h.push('<input type="text" id="rmdJournalCustomRefs" value="' + esc(custom ? (sel.referenceStyle || "") : (sel.referenceStyle || "vancouver")) + '" autocomplete="off" enterkeyhint="next"></div>');
    h.push('<p class="rmd-journal-error" id="rmdJournalCustomError" role="alert" hidden></p>');
    h.push('<div class="rmd-card-actions"><button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-journal="cancel">Cancel</button>');
    h.push('<button type="submit" class="rmd-btn rmd-btn-primary">Save this journal</button></div>');
    h.push('</form>');
    h.push('</div>');
    h.push('<div class="rmd-card-actions">' + nextBtn("thesis-draft", "Next: shape the draft") + '</div>');
    h.push('</div></div>');
    container.innerHTML = h.join("");
    bindNext(container);

    var def = container.querySelector('[data-rmd-journal="default"]');
    if (def) def.onclick = function () {
      saveThesis(tpid, { journal: copyJournal(DEFAULT_JOURNAL) });
      ts = loadThesis(tpid);
      setJournalCustomOpen(container, false);
      updateJournalSelection(container);
    };

    var other = container.querySelector('[data-rmd-journal="other"]');
    if (other) other.onclick = function () {
      var form = container.querySelector("#rmdJournalCustom");
      setJournalCustomOpen(container, form ? form.hasAttribute("hidden") : true);
    };

    var cancel = container.querySelector('[data-rmd-journal="cancel"]');
    if (cancel) cancel.onclick = function () {
      setJournalCustomOpen(container, false);
      if (other) other.focus();
    };

    var search = container.querySelector("#rmdJournalSearch");
    if (search) search.oninput = function () {
      state.q = this.value;
      renderJournalResults(container, state);
    };

    var chips = container.querySelectorAll("[data-rmd-jchip]");
    for (c = 0; c < chips.length; c++) {
      chips[c].onclick = function () {
        var key = this.getAttribute("data-rmd-jchip");
        state.chips[key] = !state.chips[key];
        this.setAttribute("aria-pressed", state.chips[key] ? "true" : "false");
        renderJournalResults(container, state);
      };
    }

    var form = container.querySelector("#rmdJournalCustomForm");
    if (form) form.onsubmit = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      var nameEl = container.querySelector("#rmdJournalCustomName");
      var wordsEl = container.querySelector("#rmdJournalCustomWords");
      var absEl = container.querySelector("#rmdJournalCustomAbstract");
      var refsEl = container.querySelector("#rmdJournalCustomRefs");
      var errEl = container.querySelector("#rmdJournalCustomError");
      var name = nameEl ? String(nameEl.value || "").replace(/^\s+|\s+$/g, "") : "";
      var words = wordsEl ? Number(wordsEl.value) : 0;
      var abs = absEl ? String(absEl.value || "").replace(/^\s+|\s+$/g, "") : "";
      var refs = refsEl ? String(refsEl.value || "").replace(/^\s+|\s+$/g, "") : "";
      var bad = null, focusEl = null;
      if (!name) { bad = "Enter the journal name."; focusEl = nameEl; }
      else if (!isFinite(words) || words < 100 || words > 100000) { bad = "Enter a word limit between 100 and 100,000."; focusEl = wordsEl; }
      else if (!abs) { bad = "Enter the abstract format."; focusEl = absEl; }
      else if (!refs) { bad = "Enter the reference style."; focusEl = refsEl; }
      if (bad) {
        if (errEl) { errEl.textContent = bad; errEl.removeAttribute("hidden"); }
        if (focusEl) {
          focusEl.setAttribute("aria-invalid", "true");
          focusEl.setAttribute("aria-describedby", "rmdJournalCustomError");
          focusEl.focus();
        }
        return;
      }
      if (errEl) { errEl.textContent = ""; errEl.setAttribute("hidden", ""); }
      saveThesis(tpid, { journal: { id: "custom", custom: true, name: name, wordLimit: words, abstractFormat: abs, referenceStyle: refs } });
      ts = loadThesis(tpid);
      setJournalCustomOpen(container, false);
      updateJournalSelection(container);
      if (other) other.focus();
    };

    if (form) {
      var fields = form.querySelectorAll("input");
      for (var f = 0; f < fields.length; f++) {
        fields[f].oninput = function () {
          this.removeAttribute("aria-invalid");
          this.removeAttribute("aria-describedby");
          var errEl = container.querySelector("#rmdJournalCustomError");
          if (errEl && !errEl.hasAttribute("hidden")) {
            errEl.textContent = "";
            errEl.setAttribute("hidden", "");
          }
        };
      }
    }

    updateJournalSelection(container);
    renderJournalResults(container, state);

    if (!SMD.api || !SMD.api.request) {
      state.loading = false;
      state.failed = true;
      renderJournalResults(container, state);
      return;
    }
    SMD.api.request("GET", "/v1/journals?catalogue=1").then(function (res) {
      if (seq !== journalSeq) return;
      var list = res && res.journals ? res.journals : (res && res.length ? res : []);
      var norm = [], i;
      for (i = 0; i < list.length; i++) norm.push(normJournal(list[i]));
      state.items = norm;
      state.loading = false;
      renderJournalResults(container, state);
    }).catch(function () {
      if (seq !== journalSeq) return;
      state.loading = false;
      state.failed = true;
      renderJournalResults(container, state);
    });
    SMD.api.request("POST", "/v1/journals/match", {
      keywords: matchKeywords(proj.title || "", labelFor(ts.paperType || "obs")),
      design: designForPaperType(ts.paperType || "obs")
    }).then(function (res) {
      if (seq !== journalSeq) return;
      var list = res && res.matches ? res.matches : [];
      var norm = [], i, m;
      for (i = 0; i < list.length; i++) {
        m = list[i] || {};
        var j = normJournal(m.journal || m);
        j.matchScore = typeof m.score === "number" ? m.score : null;
        norm.push(j);
      }
      state.matches = norm;
      renderJournalResults(container, state);
    }).catch(function () {});
  }

  /* ---------- screen: draft ---------- */

  function renderDraft(container) {
    var proj = activeProject();
    if (!proj) { container.innerHTML = SMD.p2.errHtml("Open a project first."); return; }
    tpid = pidOf(proj);
    ts = loadThesis(tpid);
    injectCSS();
    var gate = aiGate(proj);
    if (!ts.pages || !ts.pages.length) { needPagesHtml(container); return; }
    var jr = journalOf();
    var mayAi = gate.allowed;
    var h = ['<div class="rmd-p2-screen rmd-thesis-screen">'];
    h.push('<div class="rmd-card">');
    h.push('<h2>Shape the draft</h2>');
    h.push('<p class="rmd-screen-subtitle">Target: ' + esc(jr.name) + '. Word limit: ' + jr.wordLimit + ' words. ' + esc(jr.abstractFormat) + '. MaiK keeps your wording and never invents a number; every number is checked against your thesis.</p>');
    if (mayAi) {
      var st = draftAi || (draftAi = SMD.ai.state());
      h.push(SMD.ai.barHtml(st, { task: "thesis_to_paper", label: "paper draft", cost: 3 }));
      h.push('<div id="rmdDraftNote">' + SMD.ai.noteHtml(st, "draft") + '</div>');
    } else {
      h.push('<p class="rmd-thesis-meta">Only the project owner, editor or analyst can ask MaiK. You can still edit and save the draft yourself.</p>');
    }
    h.push('<div id="rmdDraftBody"></div>');
    h.push('<div class="rmd-card-actions"><button type="button" class="rmd-btn" id="rmdDraftToggle">' + (ts.editMode ? "Done editing" : "Edit draft") + '</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary" id="rmdDraftSave">Save to the manuscript</button>');
    h.push(nextBtn("thesis-tables", "Next: tables") + '</div>');
    h.push('</div></div>');
    container.innerHTML = h.join("");
    bindNext(container);
    renderDraftBody(container);
    if (mayAi) {
      var st2 = draftAi;
      SMD.ai.bind(container, st2, {
        pid: tpid,
        task: "thesis_to_paper",
        request: function () {
          ts = loadThesis(tpid);
          var inp = {
            pages: ts.pages || [],
            filename: ts.filename || "",
            paperType: labelFor(ts.paperType || "obs"),
            checklist: ts.checklist || "strobe",
            journalId: journalOf().id || "",
            wordLimit: journalOf().wordLimit
          };
          if (ts.phiConsent && ts.phiConsent.confirmed) inp.phiConsent = ts.phiConsent;
          var body = { task: "thesis_to_paper", input: inp };
          return SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(tpid) + "/ai-draft", body).catch(function (err) {
            if (err && (err.code === "consent_needed" || err.code === "phi_blocked" || err.status === 409)) {
              var b = err.body || {};
              var pPages = b.pages || [];
              if (!pPages.length && ts.phi && ts.phi.softPages) pPages = ts.phi.softPages.slice();
              var mCount = typeof b.maskedCount === "number" ? b.maskedCount : ((ts.phi && ts.phi.maskedCount) || 0);
              var fList = b.findings || (ts.phi && ts.phi.findings) || [];
              var phiInfo = { softPages: pPages, maskedCount: mCount, findings: fList };
              saveThesis(tpid, { phi: phiInfo, phiConsent: null });
              ts = loadThesis(tpid);
              err._handledByConsent = true;
              err._phiConsentInfo = phiInfo;
            }
            throw err;
          });
        },
        onConsentNeeded: function (err) {
          var phiInfo = (err && err._phiConsentInfo) || (ts && ts.phi) || { softPages: [1], maskedCount: 0, findings: [] };
          openConsentSheet(phiInfo, {
            onConfirm: function () {
              var askBtn = container.querySelector('[data-rmd-ai="ask"]');
              if (askBtn) askBtn.click();
            },
            onReupload: function () {
              if (SMD.navigate) SMD.navigate("thesis");
            }
          });
        },
        apply: function (draft) { return applyDraft(draft); },
        render: function () { renderDraft(container); }
      });
    }
    var tog = container.querySelector("#rmdDraftToggle");
    if (tog) tog.onclick = function () {
      saveThesis(tpid, { editMode: !ts.editMode });
      ts = loadThesis(tpid);
      renderDraft(container);
    };
    var save = container.querySelector("#rmdDraftSave");
    if (save) save.onclick = function () { saveDraft(container); };
  }

  function applyDraft(draft) {
    draft = draft || {};
    var sections = draft.sections || [], pageTexts = ts.pages || [];
    var allFlags = [], allLocators = [], seen = {}, i, sec, v, k, loc;
    var built = [];
    for (i = 0; i < SECTION_ORDER.length; i++) {
      sec = null;
      for (k = 0; k < sections.length; k++) if (sections[k].id === SECTION_ORDER[i].id) sec = sections[k];
      var text = sec ? sec.text : "";
      v = verifyNumbers(text, pageTexts);
      for (k = 0; k < v.flags.length; k++) allFlags.push(v.flags[k]);
      for (k = 0; k < v.locators.length; k++) {
        loc = v.locators[k];
        if (!seen[loc.number]) { seen[loc.number] = true; allLocators.push(loc); }
      }
      built.push({ id: SECTION_ORDER[i].id, heading: SECTION_ORDER[i].heading, text: v.text });
    }
    var enf = enforceWordLimit(built, journalOf().wordLimit);
    var tables = draft.tables || draft.suggestedTables || [];
    var refs = draft.references || [];
    saveThesis(tpid, {
      draft: { sections: enf.sections, flags: allFlags, locators: allLocators, tables: tables, references: refs, trimmed: enf.trimmed, words: enf.words },
      tablePicks: suggestTables(tables, 3),
      editMode: false
    });
    ts = loadThesis(tpid);
    return ["draft"];
  }

  function renderDraftBody(container) {
    var box = container.querySelector("#rmdDraftBody");
    if (!box) return;
    var draft = ts.draft;
    var editMode = ts.editMode || !draft;
    var h = [], i, sec;
    if (draft && draft.flags && draft.flags.length) {
      h.push('<div class="rmd-banner rmd-banner-warn">' + draft.flags.length + ' sentence(s) need a number check. A number that was not found verbatim in your thesis was removed and marked.</div>');
    }
    if (draft && draft.trimmed) {
      h.push('<p class="rmd-thesis-meta">The draft was over the word limit, so the last sentences of the main text were trimmed. Check the ending.</p>');
    }
    var secs = (draft && draft.sections) || SECTION_ORDER;
    for (i = 0; i < secs.length; i++) {
      sec = secs[i];
      h.push('<div class="rmd-thesis-section">');
      h.push('<div class="rmd-field"><label>' + esc(sec.heading || sec.id) + ' <span class="rmd-thesis-meta">' + countWords(sec.text) + ' words</span></label>');
      if (editMode) {
        h.push('<textarea class="rmd-thesis-edit" data-rmd-section="' + esc(sec.id) + '" rows="5">' + esc(sec.text || "") + '</textarea>');
      } else {
        h.push('<div class="rmd-thesis-section-text">' + sectionHtml(sec.text || "", (draft && draft.locators) || []) + '</div>');
      }
      h.push('</div></div>');
    }
    if (draft) {
      h.push('<p class="rmd-thesis-meta">Main text: ' + (draft.words || 0) + ' of ' + journalOf().wordLimit + ' words.</p>');
    }
    box.innerHTML = h.join("");
    var areas = box.querySelectorAll("[data-rmd-section]");
    for (i = 0; i < areas.length; i++) {
      areas[i].oninput = function () {
        var id = this.getAttribute("data-rmd-section"), j, d = ts.draft;
        if (!d) {
          d = { sections: [], flags: [], locators: [], tables: [], references: [], words: 0 };
          for (j = 0; j < SECTION_ORDER.length; j++) d.sections.push({ id: SECTION_ORDER[j].id, heading: SECTION_ORDER[j].heading, text: "" });
        }
        for (j = 0; j < d.sections.length; j++) if (d.sections[j].id === id) d.sections[j].text = this.value;
        saveThesis(tpid, { draft: d });
        ts = loadThesis(tpid);
      };
    }
    var nums = box.querySelectorAll(".rmd-thesis-num");
    for (i = 0; i < nums.length; i++) nums[i].onclick = function () { openThesisPop(this); };
  }

  /* One pass over the plain text: numbers are tokenised before any HTML exists
   so a digit inside an attribute can never be rewritten. Markdown is parsed
   on the raw text and every literal fragment is escaped on output. */
  function locateNumber(text, from, number) {
    var idx = text.indexOf(number, from);
    while (idx >= 0) {
      var before = idx > 0 ? text.charAt(idx - 1) : "";
      var end = idx + number.length;
      var after = end < text.length ? text.charAt(end) : "";
      var after2 = end + 1 < text.length ? text.charAt(end + 1) : "";
      /* A letter right before means the digit is part of a word (HbA1c, T2DM), not a reported number;
       * a letter after is still fine (120mg). */
      var okBefore = !before || !/[0-9.A-Za-z]/.test(before);
      var okAfter = !after || !/[0-9.]/.test(after) || (after === "." && !/[0-9]/.test(after2));
      if (okBefore && okAfter) return idx;
      idx = text.indexOf(number, idx + 1);
    }
    return -1;
  }

  function emitPlain(text, locators, out) {
    var i = 0, best, bestIdx, idx, l;
    while (i < text.length) {
      best = null;
      bestIdx = -1;
      for (l = 0; l < locators.length; l++) {
        idx = locateNumber(text, i, String(locators[l].number));
        if (idx < 0) continue;
        if (best === null || idx < bestIdx ||
            (idx === bestIdx && String(locators[l].number).length > String(best.number).length)) {
          best = locators[l];
          bestIdx = idx;
        }
      }
      if (best === null) {
        out.push({ t: "text", v: text.slice(i) });
        return;
      }
      if (bestIdx > i) out.push({ t: "text", v: text.slice(i, bestIdx) });
      out.push({ t: "num", v: String(best.number), page: best.page, table: best.table });
      i = bestIdx + String(best.number).length;
    }
  }

  function parseInline(text, locators, out) {
    var i = 0, buf = "", end, e2, rest;
    function flush() {
      if (!buf) return;
      emitPlain(buf, locators, out);
      buf = "";
    }
    while (i < text.length) {
      rest = text.slice(i);
      if (rest.indexOf("[check this number]") === 0) {
        flush();
        out.push({ t: "flag" });
        i += "[check this number]".length;
        continue;
      }
      if (rest.indexOf("**") === 0) {
        end = text.indexOf("**", i + 2);
        if (end > i + 2) {
          flush();
          out.push({ t: "open", tag: "strong" });
          parseInline(text.slice(i + 2, end), locators, out);
          out.push({ t: "close", tag: "strong" });
          i = end + 2;
          continue;
        }
      }
      if (text.charAt(i) === "*") {
        e2 = text.indexOf("*", i + 1);
        if (e2 > i + 1) {
          flush();
          out.push({ t: "open", tag: "em" });
          parseInline(text.slice(i + 1, e2), locators, out);
          out.push({ t: "close", tag: "em" });
          i = e2 + 1;
          continue;
        }
      }
      buf += text.charAt(i);
      i++;
    }
    flush();
  }

  function tokensHtml(tokens) {
    var h = [], i, t;
    for (i = 0; i < tokens.length; i++) {
      t = tokens[i];
      if (t.t === "text") h.push(esc(t.v));
      else if (t.t === "flag") h.push('<span class="rmd-thesis-flag">[check this number]</span>');
      else if (t.t === "num") {
        h.push('<span class="rmd-thesis-num" data-page="' + esc(t.page) + '" data-table="' +
          esc(t.table != null ? t.table : "") + '" tabindex="0" role="button">' + esc(t.v) + '</span>');
      } else if (t.t === "open") h.push("<" + t.tag + ">");
      else if (t.t === "close") h.push("</" + t.tag + ">");
    }
    return h.join("");
  }

  function sectionHtml(text, locators) {
    var sorted = (locators || []).slice().sort(function (a, b) {
      return String(b.number).length - String(a.number).length;
    });
    var tokens = [];
    parseInline(String(text == null ? "" : text), sorted, tokens);
    return tokensHtml(tokens);
  }

  function openThesisPop(el) {
    var page = el.getAttribute("data-page"), table = el.getAttribute("data-table");
    var line = "From your thesis, page " + page + (table ? ", Table " + table : "") + ".";
    var old = D.querySelector(".rmd-thesis-pop");
    if (old) old.parentNode.removeChild(old);
    var pop = D.createElement("div");
    // smd-books-keep: the page/table locator is a source attribution, not a textbook citation;
    // the app-wide book scrubber (emoji-icons.js) would otherwise strip "page 54" from it.
    pop.className = "rmd-thesis-pop smd-books-keep";
    pop.innerHTML = '<div class="rmd-thesis-pop-text">' + esc(line) + '</div><button type="button" class="rmd-btn rmd-thesis-pop-close">Close</button>';
    D.body.appendChild(pop);
    function close() { if (pop.parentNode) pop.parentNode.removeChild(pop); D.removeEventListener("click", onDoc, true); }
    function onDoc(ev) { if (!pop.contains(ev.target)) close(); }
    pop.querySelector(".rmd-thesis-pop-close").onclick = close;
    G.setTimeout(function () { D.addEventListener("click", onDoc, true); }, 0);
  }

  function saveDraft(container) {
    var draft = ts.draft;
    if (!draft || !draft.sections || !draft.sections.length) {
      SMD.p2.flashNotice(container, "Write or draft the paper first.", "error");
      return;
    }
    var pid = tpid;
    SMD.api.request("GET", "/v1/projects/" + pid + "/manuscript").then(function (res) {
      return (res && res.manuscript && res.manuscript.version) || 1;
    }).catch(function () { return 1; }).then(function (version) {
      var chain = Promise.resolve(), i;
      for (i = 0; i < draft.sections.length; i++) {
        (function (sec) {
          chain = chain.then(function () {
            return SMD.api.request("PUT", "/v1/projects/" + pid + "/manuscript/sections/" + sec.id, { version: version, heading: sec.heading, text: sec.text });
          });
        })(draft.sections[i]);
      }
      return chain;
    }).then(function () {
      SMD.p2.flashNotice(container, "Saved to the manuscript.", "info");
      SMD.navigate("thesis-tables");
    }).catch(function () {
      SMD.p2.flashNotice(container, "Saved on this device.", "info");
      SMD.navigate("thesis-tables");
    });
  }

  /* ---------- screen: tables ---------- */

  function renderTables(container) {
    var proj = activeProject();
    if (!proj) { container.innerHTML = SMD.p2.errHtml("Open a project first."); return; }
    tpid = pidOf(proj);
    ts = loadThesis(tpid);
    injectCSS();
    var tables = (ts.draft && ts.draft.tables) || [];
    var picks = ts.tablePicks || [];
    var h = ['<div class="rmd-p2-screen rmd-thesis-screen"><div class="rmd-card">'];
    h.push('<h2>Keep the 3 most important tables</h2>');
    if (!tables.length) {
      h.push('<p class="rmd-screen-subtitle">No tables were found in the draft. You can add tables later in the manuscript screen.</p>');
    } else {
      h.push('<p class="rmd-screen-subtitle">MaiK suggests three. Tick the ones to keep (up to 3).</p>');
      var i, t, checked;
      for (i = 0; i < tables.length; i++) {
        t = tables[i];
        checked = picks.indexOf(t.id) >= 0;
        h.push('<label class="rmd-thesis-table-row">');
        h.push('<input type="checkbox" data-rmd-table="' + esc(t.id) + '"' + (checked ? " checked" : "") + '>');
        h.push('<span><strong>' + esc(t.caption || t.id) + '</strong>');
        if (t.reason) h.push('<span class="rmd-thesis-meta">Why MaiK suggests it: ' + esc(t.reason) + '</span>');
        h.push('</span></label>');
      }
    }
    h.push('<div class="rmd-card-actions">' + nextBtn("thesis-refs", "Next: references") + '</div>');
    h.push('</div></div>');
    container.innerHTML = h.join("");
    bindNext(container);
    var boxes = container.querySelectorAll("[data-rmd-table]");
    for (var b = 0; b < boxes.length; b++) {
      boxes[b].onchange = function () {
        var id = this.getAttribute("data-rmd-table");
        var cur = (ts.tablePicks || []).slice();
        if (this.checked) {
          if (cur.length >= 3) { this.checked = false; SMD.p2.flashNotice(container, "Keep at most 3 tables. Untick one first.", "error"); return; }
          if (cur.indexOf(id) < 0) cur.push(id);
        } else {
          cur = cur.filter(function (x) { return x !== id; });
        }
        saveThesis(tpid, { tablePicks: cur });
        ts = loadThesis(tpid);
      };
    }
  }

  /* ---------- screen: references ---------- */

  function renderRefs(container) {
    var proj = activeProject();
    if (!proj) { container.innerHTML = SMD.p2.errHtml("Open a project first."); return; }
    tpid = pidOf(proj);
    ts = loadThesis(tpid);
    injectCSS();
    var refs = (ts.draft && ts.draft.references) || [];
    var flags = referenceFlags(refs);
    var style = journalOf().referenceStyle;
    var h = ['<div class="rmd-p2-screen rmd-thesis-screen"><div class="rmd-card">'];
    h.push('<h2>Check the references</h2>');
    if (!refs.length) {
      h.push('<p class="rmd-screen-subtitle">No references were found in the draft. Add them in the manuscript screen.</p>');
    } else {
      h.push('<p class="rmd-screen-subtitle">Formatted for your journal: ' + esc(styleName(style)) + '. A reference without a DOI or PMID is marked so you can check it.</p>');
      h.push('<div class="rmd-thesis-refs">');
      var i, f;
      for (i = 0; i < flags.length; i++) {
        f = flags[i];
        h.push('<div class="rmd-thesis-ref">' + esc(formatReference(f.ref, style, i)));
        if (f.needCheck) h.push(' <span class="rmd-thesis-check">[check this reference]</span><span class="rmd-thesis-meta"> No DOI or PMID found. Add one so the journal can locate it.</span>');
        h.push('</div>');
      }
      h.push('</div>');
    }
    h.push('<div class="rmd-card-actions">' + nextBtn("checklist", "Next: reporting checklist") + '</div>');
    h.push('</div></div>');
    container.innerHTML = h.join("");
    bindNext(container);
  }

  /* ---------- css ---------- */

  var cssDone = false;
  function injectCSS() {
    if (cssDone || !D) return;
    cssDone = true;
    var s = D.createElement("style");
    s.textContent = [
      "#researchMD .rmd-thesis-meta { font: 400 12.5px var(--rmd-f); color: var(--rmd-mut); display: block; margin-top: 2px; }",
      "#researchMD .rmd-thesis-section { margin-bottom: 14px; }",
      "#researchMD .rmd-thesis-section-text { font: 400 14px/1.65 var(--rmd-f); color: var(--rmd-ink); white-space: pre-wrap; overflow-wrap: anywhere; }",
      "#researchMD .rmd-thesis-edit { width: 100%; box-sizing: border-box; font: 400 14px/1.6 var(--rmd-f); }",
      "#researchMD .rmd-thesis-num { border-bottom: 2px dotted var(--rmd-acc); font-weight: 600; cursor: pointer; }",
      "#researchMD .rmd-thesis-flag { color: var(--rmd-warn); font-weight: 600; }",
      "#researchMD .rmd-thesis-table-row { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--rmd-line); border-radius: 8px; margin-bottom: 8px; background: var(--rmd-panel); font: 400 14px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-thesis-table-row input { margin-top: 3px; }",
      "#researchMD .rmd-thesis-ref { padding: 8px 0; border-bottom: 1px solid var(--rmd-line); font: 400 13px/1.5 var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-thesis-check { color: var(--rmd-warn); font-weight: 600; }",
      "#researchMD .rmd-journal-option .rmd-journal-head { font: 600 15px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-journal-option .rmd-journal-name { font: inherit; color: inherit; }",
      "#researchMD .rmd-journal-option .rmd-journal-option-note { font: 400 13px/1.5 var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-journal-option[aria-pressed=\"true\"] { border-color: var(--rmd-acc); background: var(--rmd-acc-soft); }",
      "#researchMD .rmd-journal-option:active { background: var(--rmd-fill); }",
      "#researchMD .rmd-journal-picker[hidden], #researchMD .rmd-journal-custom[hidden], #researchMD .rmd-journal-selected[hidden], #researchMD .rmd-journal-error[hidden] { display: none; }",
      "#researchMD .rmd-journal-picker { display: flex; flex-direction: column; gap: 10px; }",
      "#researchMD .rmd-journal-filters { display: flex; flex-direction: column; gap: 10px; }",
      "#researchMD .rmd-journal-filters[hidden] { display: none; }",
      "#researchMD #rmdJournalSearch { font-size: 16px; min-height: 44px; }",
      "#researchMD .rmd-journal-chips { display: flex; flex-wrap: wrap; gap: 8px; }",
      "#researchMD .rmd-journal-chip { border: 1px solid var(--rmd-line); background: var(--rmd-panel); color: var(--rmd-ink); border-radius: 999px; padding: 0 14px; min-height: 44px; font: 600 13px var(--rmd-f); cursor: pointer; touch-action: manipulation; }",
      "#researchMD .rmd-journal-chip[aria-pressed=\"true\"] { border-color: var(--rmd-acc); background: var(--rmd-acc-soft); color: var(--rmd-acc); }",
      "#researchMD .rmd-journal-group { margin: 4px 0 0; font: 600 12.5px var(--rmd-f); color: var(--rmd-mut); letter-spacing: 0; }",
      "#researchMD .rmd-journal-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }",
      "#researchMD .rmd-journal-item { display: flex; flex-direction: column; border: 1px solid var(--rmd-line); border-radius: 12px; background: var(--rmd-panel); overflow: hidden; }",
      "#researchMD .rmd-journal-item[data-selected=\"true\"] { border-color: var(--rmd-acc); }",
      "#researchMD .rmd-journal-pick { display: flex; flex-direction: column; gap: 4px; width: 100%; box-sizing: border-box; text-align: left; border: 0; background: transparent; padding: 14px 16px; color: var(--rmd-ink); cursor: pointer; touch-action: manipulation; }",
      "#researchMD .rmd-journal-pick:active { background: var(--rmd-fill); }",
      "#researchMD .rmd-journal-pick[aria-pressed=\"true\"] { background: var(--rmd-acc-soft); }",
      "#researchMD .rmd-journal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }",
      "#researchMD .rmd-journal-name { font: 600 15px var(--rmd-f); color: var(--rmd-ink); overflow-wrap: anywhere; }",
      "#researchMD .rmd-journal-selected { flex: 0 0 auto; border-radius: 999px; background: var(--rmd-acc-soft); color: var(--rmd-acc); font: 600 11.5px var(--rmd-f); padding: 2px 8px; white-space: nowrap; }",
      "#researchMD .rmd-journal-meta { font: 400 12.5px var(--rmd-f); color: var(--rmd-mut); overflow-wrap: anywhere; }",
      "#researchMD .rmd-journal-specs { display: flex; flex-direction: column; gap: 1px; font: 400 12.5px/1.45 var(--rmd-f); color: var(--rmd-mut); overflow-wrap: anywhere; }",
      "#researchMD .rmd-journal-specs b, #researchMD .rmd-journal-fee b { color: var(--rmd-ink); font-weight: 600; }",
      "#researchMD .rmd-journal-fee { font: 400 12.5px/1.45 var(--rmd-f); color: var(--rmd-mut); overflow-wrap: anywhere; }",
      "#researchMD .rmd-journal-link { display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px; border-top: 1px solid var(--rmd-line); font: 600 13px var(--rmd-f); color: var(--rmd-acc); text-decoration: none; touch-action: manipulation; }",
      "#researchMD .rmd-journal-link:active { background: var(--rmd-fill); }",
      "#researchMD .rmd-journal-link-missing { color: var(--rmd-mut); font-weight: 400; }",
      "#researchMD .rmd-journal-custom { display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--rmd-line); border-radius: 12px; padding: 14px 16px; background: var(--rmd-fill); }",
      "#researchMD .rmd-journal-custom h3 { margin: 0; font: 600 14px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-journal-custom input { font-size: 16px; min-height: 44px; }",
      "#researchMD .rmd-journal-custom .rmd-btn { min-height: 44px; }",
      "#researchMD .rmd-journal-error { margin: 0; color: var(--rmd-bad); font: 500 13px var(--rmd-f); }",
      "#researchMD .rmd-journal-empty { margin: 4px 0; font: 400 13.5px var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-journal-fallback-text { margin: 0 0 8px; }",
      "#researchMD .rmd-journal-fallback-text:last-child { margin: 0; }",
      "#researchMD .rmd-journal-pick:focus-visible, #researchMD .rmd-journal-chip:focus-visible, #researchMD .rmd-journal-link:focus-visible { outline: 3px solid var(--rmd-acc); outline-offset: 2px; }",
      "@media (hover: hover) { #researchMD .rmd-journal-pick:hover, #researchMD .rmd-journal-chip:hover, #researchMD .rmd-journal-link:hover { background: var(--rmd-fill); } }",
      ".rmd-thesis-pop { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); max-width: 320px; background: var(--rmd-panel, #fffdf9); border: 1px solid var(--rmd-line, #e5ddce); border-radius: 12px; padding: 12px 14px; box-shadow: 0 8px 28px rgba(17,28,68,0.18); font: 400 13px/1.5 var(--rmd-f, system-ui, sans-serif); color: var(--rmd-ink, #111c44); z-index: 10060; }",
      ".rmd-thesis-pop-text { margin-bottom: 8px; }",
      ".rmd-thesis-pop-close { width: 100%; }",
      "dialog.rmd-thesis-consent-dialog { border: 1px solid var(--rmd-line, #e5ddce); border-radius: 14px; background: var(--rmd-panel, #fffdf9); color: var(--rmd-ink, #111c44); padding: 0; width: min(440px, calc(100vw - 32px)); max-width: calc(100vw - 32px); max-height: calc(100dvh - 48px); margin: auto; box-shadow: 0 18px 42px rgba(7,19,24,0.28); overscroll-behavior: contain; font: 400 14px/1.5 var(--rmd-f, system-ui, sans-serif); }",
      "dialog.rmd-thesis-consent-dialog[open] { display: flex; flex-direction: column; }",
      "dialog.rmd-thesis-consent-dialog::backdrop { background: rgba(7,19,24,0.52); overscroll-behavior: contain; }",
      ".rmd-thesis-consent-card { padding: 20px; overflow-y: auto; }",
      ".rmd-thesis-consent-card h3 { margin: 0 0 8px; font: 700 18px/1.3 var(--rmd-f, system-ui, sans-serif); color: var(--rmd-ink, #111c44); }",
      ".rmd-thesis-consent-card p { margin: 0 0 12px; color: var(--rmd-ink, #111c44); }",
      ".rmd-thesis-consent-count { font-weight: 600; color: var(--rmd-mut, #5c657c); }",
      ".rmd-thesis-consent-list { margin: 0 0 16px; padding: 10px 12px 10px 26px; background: var(--rmd-bg, #f7f4ec); border: 1px solid var(--rmd-line, #e5ddce); border-radius: 10px; font-size: 13px; color: var(--rmd-mut, #5c657c); }",
      ".rmd-thesis-consent-list li { margin-bottom: 6px; overflow-wrap: anywhere; }",
      ".rmd-thesis-consent-list li:last-child { margin-bottom: 0; }",
      ".rmd-thesis-consent-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; margin-top: 8px; }",
      ".rmd-thesis-consent-actions .rmd-btn { min-height: 44px; flex: 1 1 160px; touch-action: manipulation; }",
      "@media (prefers-reduced-motion: reduce) { dialog.rmd-thesis-consent-dialog { transition: none; } }"
    ].join("\n");
    D.head.appendChild(s);
  }

  /* ---------- registration + export ---------- */

  if (SMD) {
    SMD.screens = SMD.screens || {};
    SMD.screens.thesis = { render: renderUpload };
    SMD.screens["thesis-type"] = { render: renderType };
    SMD.screens["thesis-journal"] = { render: renderJournal };
    SMD.screens["thesis-draft"] = { render: renderDraft };
    SMD.screens["thesis-tables"] = { render: renderTables };
    SMD.screens["thesis-refs"] = { render: renderRefs };
  }

  var API = {
    name: NAME,
    version: VERSION,
    splitSentences: splitSentences,
    buildPageTexts: buildPageTexts,
    verifyNumbers: verifyNumbers,
    enforceWordLimit: enforceWordLimit,
    suggestPaperType: suggestPaperType,
    referenceFlags: referenceFlags,
    formatReference: formatReference,
    suggestTables: suggestTables,
    canRunAi: canRunAi,
    aiGate: aiGate,
    scanThesisPages: scanThesisPages,
    countWords: countWords,
    parseDocx: parseDocx,
    readZipEntries: readZipEntries,
    extractDocxXmlBlocks: extractDocxXmlBlocks,
    paginateBlocks: paginateBlocks,
    handleFile: handleFile,
    sectionHtml: sectionHtml,
    PAPER_TYPES: PAPER_TYPES,
    DEFAULT_JOURNAL: DEFAULT_JOURNAL
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.SMD_RESEARCH_THESIS = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));