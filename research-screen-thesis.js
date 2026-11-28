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
    { key: "cohort", label: "Cohort study", checklist: "strobe", checklistName: "STROBE", gloss: "the reporting checklist for cohort studies", eg: "Follows defined patient groups over time for outcomes." },
    { key: "case_control", label: "Case-control study", checklist: "strobe", checklistName: "STROBE", gloss: "the reporting checklist for case-control studies", eg: "Compares patients with an outcome against matched controls." },
    { key: "cross_sectional", label: "Cross-sectional study", checklist: "strobe", checklistName: "STROBE", gloss: "the reporting checklist for cross-sectional studies", eg: "Measures prevalence or associations at a single time point." },
    { key: "diagnostic", label: "Diagnostic accuracy study", checklist: "stard2015", checklistName: "STARD", gloss: "the reporting checklist for diagnostic accuracy studies", eg: "Evaluates sensitivity and specificity against a reference standard." },
    { key: "case", label: "Case series or case report", checklist: "care", checklistName: "CARE", gloss: "the reporting checklist for case reports", eg: "One patient or a small series of unusual cases." },
    { key: "sr", label: "Systematic review or meta-analysis", checklist: "prisma2020", checklistName: "PRISMA", gloss: "the reporting checklist for systematic reviews", eg: "A structured search and synthesis of many prior studies." },
    { key: "qualitative", label: "Qualitative study", checklist: "srqr", checklistName: "SRQR", gloss: "the reporting checklist for qualitative studies", eg: "Thematic or content analysis of interviews or focus groups." }
  ];

  var SECTION_ORDER = [
    { id: "abstract", heading: "Abstract" },
    { id: "introduction", heading: "Introduction" },
    { id: "methods", heading: "Methods" },
    { id: "results", heading: "Results" },
    { id: "discussion", heading: "Discussion" },
    { id: "conclusion", heading: "Conclusion" }
  ];

  /* ---------- on-device DOCX & PDF extraction ---------- */

  function onDeviceOcrOn() {
    var OD = G && G.SMD_RMD_ONDEVICE_PDF;
    if (OD && typeof OD.isEnabled === "function") return OD.isEnabled();
    try {
      if (typeof location !== "undefined" && location.search) {
        var m = location.search.match(/[?&]rmd_ondevice_ocr=([^&]+)/);
        if (m != null) return m[1] === "1" || m[1] === "on" || m[1] === "true";
      }
    } catch (e) {}
    try {
      if (typeof localStorage !== "undefined") return localStorage.getItem("smd_rmd_ondevice_ocr") !== "0";
    } catch (e) {}
    return true;
  }

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

  function docxHeadingFromStyle(val) {
    var s = String(val || "").replace(/^\s+|\s+$/g, "");
    if (!s) return null;
    var m = s.match(/^(?:heading|titre|h)\s*([1-6])$/i);
    if (m) return Math.min(3, Math.max(1, parseInt(m[1], 10)));
    if (/^title$/i.test(s)) return 1;
    if (/^subtitle$/i.test(s)) return 2;
    return null;
  }

  function extractDocxParaDom(paraNode) {
    var parts = [];
    var hasPageBreak = false;
    var headingLevel = null;
    var paraBold = false;
    var boldChars = 0;
    var totalChars = 0;
    function hasBoldRPr(rPrNode) {
      if (!rPrNode) return false;
      for (var k = rPrNode.firstChild; k; k = k.nextSibling) {
        if (k.nodeType === 1 && localNameOf(k) === "b") {
          var v = k.getAttribute("w:val") || k.getAttribute("val") || "";
          return v !== "0" && v !== "false";
        }
      }
      return false;
    }
    function walk(node, inBold) {
      if (!node || node.nodeType !== 1) return;
      var ln = localNameOf(node);
      if (ln === "del" || ln === "instrText" || ln === "fldSimple" || ln === "moveFrom") return;
      if (ln === "pPr") {
        for (var p = node.firstChild; p; p = p.nextSibling) {
          if (p.nodeType !== 1) continue;
          var pln = localNameOf(p);
          if (pln === "pStyle") {
            var hl = docxHeadingFromStyle(p.getAttribute("w:val") || p.getAttribute("val"));
            if (hl != null) headingLevel = hl;
          } else if (pln === "outlineLvl" && headingLevel == null) {
            var ov = parseInt(p.getAttribute("w:val") || p.getAttribute("val"), 10);
            if (isFinite(ov) && ov >= 0 && ov <= 5) headingLevel = Math.min(3, ov + 1);
          } else if (pln === "rPr") {
            if (hasBoldRPr(p)) paraBold = true;
          }
        }
        return;
      }
      if (ln === "r") {
        var runBold = paraBold;
        for (var rc = node.firstChild; rc; rc = rc.nextSibling) {
          if (rc.nodeType === 1 && localNameOf(rc) === "rPr") {
            if (hasBoldRPr(rc)) runBold = true;
            break;
          }
        }
        for (var rn = node.firstChild; rn; rn = rn.nextSibling) {
          if (rn.nodeType === 1 && localNameOf(rn) !== "rPr") walk(rn, runBold);
        }
        return;
      }
      if (ln === "lastRenderedPageBreak") { hasPageBreak = true; return; }
      if (ln === "br") {
        var btype = node.getAttribute("w:type") || node.getAttribute("type") || "";
        if (btype === "page") { hasPageBreak = true; return; }
        parts.push("\n");
        return;
      }
      if (ln === "cr") { parts.push("\n"); return; }
      if (ln === "tab") { parts.push(" "); return; }
      if (ln === "t" || ln === "delText") {
        var tv = node.textContent || "";
        var nonWs = tv.replace(/\s+/g, "").length;
        totalChars += nonWs;
        if (inBold) boldChars += nonWs;
        parts.push(tv);
        return;
      }
      for (var c = node.firstChild; c; c = c.nextSibling) walk(c, inBold);
    }
    walk(paraNode, false);
    var txt = parts.join("").replace(/[ \t]+/g, " ").replace(/^\s+|\s+$/g, "");
    var isBold = paraBold || (totalChars > 0 && boldChars * 2 >= totalChars);
    return { text: txt, pageBreak: hasPageBreak, headingLevel: headingLevel, bold: isBold };
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
                if (p.text) blocks.push({ text: p.text, headingLevel: p.headingLevel, bold: p.bold });
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
                  if (cells.length) blocks.push({ text: cells.join("  "), inTable: true });
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
      var styleM = inner.match(/<w:pStyle\b[^>]*w:val=["']([^"']+)["']/i);
      var hLevel = styleM ? docxHeadingFromStyle(styleM[1]) : null;
      if (hLevel == null) {
        var olM = inner.match(/<w:outlineLvl\b[^>]*w:val=["'](\d+)["']/i);
        if (olM) hLevel = Math.min(3, parseInt(olM[1], 10) + 1);
      }
      var hasBold = /<w:b\b(?![^>]*w:val=["'](?:0|false)["'])/i.test(inner);
      var stripped = inner
        .replace(/<w:tab\b[^>]*\/?>/gi, " ")
        .replace(/<w:(?:br|cr)\b[^>]*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "");
      var txt = decodeXmlEntities(stripped).replace(/[ \t]+/g, " ").replace(/^\s+|\s+$/g, "");
      if (txt) blocks.push({ text: txt, headingLevel: hLevel, bold: hasBold });
    }
    return blocks;
  }

  function blockToLines(b) {
    var subLines = String(b.text || "").split(/\n+/);
    var out = [], i, tx;
    var sz = b.headingLevel === 1 ? 18 : (b.headingLevel === 2 ? 14 : (b.headingLevel === 3 ? 13 : 11));
    for (i = 0; i < subLines.length; i++) {
      tx = subLines[i].replace(/[ \t]+/g, " ").replace(/^\s+|\s+$/g, "");
      if (!tx) continue;
      var lineObj = {
        tx: tx,
        size: sz,
        bold: !!b.bold,
        caps: /[A-Za-z].*[A-Za-z]/.test(tx) && !/[a-z]/.test(tx)
      };
      if (b.headingLevel != null) lineObj.headingLevel = b.headingLevel;
      if (b.inTable) lineObj.inTable = true;
      out.push(lineObj);
    }
    return out;
  }

  function paginateBlocks(blocks, wordsPerPage) {
    var hasBreaks = false, i;
    for (i = 0; i < blocks.length; i++) {
      if (blocks[i].pageBreak) { hasBreaks = true; break; }
    }
    var pages = [], pageLines = [], cur = [], curLines = [], curWords = 0, limit = wordsPerPage || 350;
    function flush() {
      var joined = cur.join("\n");
      if (joined.replace(/\s+/g, "").length > 0) {
        var pn = pages.length + 1;
        pages.push({ n: pn, text: joined });
        pageLines.push({ n: pn, lines: curLines });
      }
      cur = [];
      curLines = [];
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
      var bl = blockToLines(b);
      for (var li = 0; li < bl.length; li++) curLines.push(bl[li]);
      curWords += w;
    }
    flush();
    try {
      Object.defineProperty(pages, "_pageLines", { value: pageLines, enumerable: false, configurable: true });
    } catch (e) {}
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
    var OD = G && G.SMD_RMD_ONDEVICE_PDF;
    if (OD && typeof OD.loadPdfJs === "function") return OD.loadPdfJs();
    if (G && G.pdfjsLib) return Promise.resolve(G.pdfjsLib);
    return Promise.reject(new Error("pdf_unavailable"));
  }

  function joinPdfTextItemsWithLines(items) {
    var lines = [], lineObjs = [], curLine = [], curChars = 0, curSizeWeighted = 0, curMaxSize = 0, lastY = null;
    function flushLine() {
      if (!curLine.length) return;
      var tx = curLine.join(" ").replace(/[ \t]+/g, " ").replace(/^\s+|\s+$/g, "");
      if (tx) {
        lines.push(tx);
        var avgSz = curChars > 0 ? Math.round((curSizeWeighted / curChars) * 10) / 10 : curMaxSize;
        lineObjs.push({
          tx: tx,
          size: avgSz || curMaxSize || 11,
          caps: /[A-Za-z].*[A-Za-z]/.test(tx) && !/[a-z]/.test(tx)
        });
      }
      curLine = [];
      curChars = 0;
      curSizeWeighted = 0;
      curMaxSize = 0;
    }
    for (var i = 0; i < (items || []).length; i++) {
      var it = items[i] || {};
      var str = String(it.str || "");
      var y = (it.transform && it.transform.length >= 6) ? it.transform[5] : null;
      var sz = (it.transform && it.transform.length >= 4)
        ? Math.round(Math.hypot(Number(it.transform[0]) || 0, Number(it.transform[1]) || 0) * 10) / 10
        : 0;
      if (!sz && it.height) sz = Math.round(Number(it.height) * 10) / 10;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) {
        flushLine();
      }
      var nonWs = str.replace(/\s+/g, "").length;
      if (nonWs) {
        curLine.push(str);
        curChars += nonWs;
        curSizeWeighted += (sz || 11) * nonWs;
        if (sz > curMaxSize) curMaxSize = sz;
      }
      if (it.hasEOL) {
        flushLine();
        lastY = null;
      } else if (y !== null) {
        lastY = y;
      }
    }
    flushLine();
    return { text: lines.join("\n"), lines: lineObjs };
  }

  function joinPdfTextItems(items) {
    return joinPdfTextItemsWithLines(items).text;
  }

  function isNativeShell() {
    var C = G && G.Capacitor;
    if (!C) return false;
    if (typeof C.isNativePlatform === "function") return !!C.isNativePlatform();
    return !!(C.platform && C.platform !== "web");
  }

  /* The Rust PDF reader (vendor/rust-pdf, loaded by the on-device reader): every page's lines in one go, as
     { pages: [{ n, text }], pageLines: [{ n, lines }] } in the shape below, or null (pdf.js reads it as before). */
  var RUST_MAX_PAGES = 3000;
  function rustPagesText(u8) {
    var OD = G && G.SMD_RMD_ONDEVICE_PDF;
    if (!OD || typeof OD.loadRust !== "function") return Promise.resolve(null);
    return OD.loadRust().then(function (R) {
      if (!R || (typeof R.isEnabled === "function" && !R.isEnabled())) return null;
      var want = [];
      for (var i = 1; i <= RUST_MAX_PAGES; i++) want.push(i);
      return R.lines(u8, want);
    }).then(function (res) { return rustToThesisPages(res); }, function () { return null; });
  }
  function rustToThesisPages(res) {
    if (!res || !Array.isArray(res.pages) || !res.total || res.total > RUST_MAX_PAGES || res.pages.length !== res.total) return null;
    var pages = [], pageLines = [], chars = 0;
    res.pages.forEach(function (p) {
      var lines = [];
      var txList = [];
      var rawLines = p.lines || [];
      for (var i = 0; i < rawLines.length; i++) {
        var l = rawLines[i] || {};
        var tx = String(l.tx || "").replace(/[ \t]+/g, " ").replace(/^\s+|\s+$/g, "");
        if (!tx) continue;
        txList.push(tx);
        var obj = {
          tx: tx,
          size: typeof l.size === "number" ? l.size : 0
        };
        /* Use Rust bold/italic/caps flags when present; works cleanly if absent. */
        if (typeof l.bold === "boolean") obj.bold = l.bold;
        if (typeof l.italic === "boolean") obj.italic = l.italic;
        if (typeof l.caps === "boolean") obj.caps = l.caps;
        lines.push(obj);
      }
      var txt = txList.join("\n");
      chars += txt.replace(/\s+/g, "").length;
      pages.push({ n: p.n, text: txt });
      pageLines.push({ n: p.n, lines: lines });
    });
    return { pages: pages, pageLines: pageLines, chars: chars };
  }

  function readPdfLocal(file, onProgress) {
    if (!file || typeof file.arrayBuffer !== "function") return Promise.resolve(null);
    return file.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf);
      return rustPagesText(u8).then(function (rp) {
        if (!rp) return readPdfLocalJs(u8, onProgress);
        if (onProgress) onProgress(rp.pages.length, rp.pages.length);
        if (rp.chars < 20) return { pages: [], emptyText: true, bytes: u8 };
        return { pages: rp.pages, pageLines: rp.pageLines, emptyText: false };
      });
    });
  }

  function readPdfLocalJs(u8, onProgress) {
    return loadPdfJs().then(function (pdfjs) {
      var openOpts = isNativeShell() ? { data: u8, disableWorker: true } : { data: u8 };
      return pdfjs.getDocument(openOpts).promise.catch(function (err) {
        if (err && err.name === "PasswordException") throw err;
        return pdfjs.getDocument({ data: u8, disableWorker: true }).promise;
      }).then(function (pdf) {
        var total = pdf.numPages || 0;
        if (!total) return null;
        var pages = [], pageLines = [], chars = 0, idx = 1;
        function nextPage() {
          if (idx > total) {
            if (pdf && typeof pdf.destroy === "function") { try { pdf.destroy(); } catch (e) {} }
            if (chars < 20) return { pages: [], emptyText: true, bytes: u8 };
            return { pages: pages, pageLines: pageLines, emptyText: false };
          }
          if (onProgress && (idx === 1 || idx % 10 === 0 || idx === total)) {
            onProgress(idx, total);
          }
          var pNo = idx++;
          return pdf.getPage(pNo).then(function (pg) {
            return pg.getTextContent();
          }).then(function (tc) {
            var res = joinPdfTextItemsWithLines((tc && tc.items) || []);
            chars += res.text.replace(/\s+/g, "").length;
            pages.push({ n: pNo, text: res.text });
            pageLines.push({ n: pNo, lines: res.lines });
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

  function pageTableOffsets(pt) {
    if (pt._tableOffsets) return pt._tableOffsets;
    var list = [], re = /Table\s+(\d+)/gi, m;
    while ((m = re.exec(pt.text || ""))) list.push({ idx: m.index, num: Number(m[1]) });
    pt._tableOffsets = list;
    return list;
  }

  function tableFor(pt, idx) {
    if (typeof pt === "string") {
      var head = pt.slice(0, idx), re = /Table\s+(\d+)/gi, m, last = null;
      while ((m = re.exec(head))) last = m[1];
      return last ? Number(last) : null;
    }
    var offs = pageTableOffsets(pt), lo = 0, hi = offs.length - 1, mid, found = null;
    while (lo <= hi) {
      mid = (lo + hi) >>> 1;
      if (offs[mid].idx < idx) { found = offs[mid].num; lo = mid + 1; }
      else hi = mid - 1;
    }
    return found;
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
        if (bOk && aOk) return { page: pageTexts[p].n, table: tableFor(pageTexts[p], idx) };
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
    var flags = [], locators = [], seen = {}, tokCache = Object.create(null), outParts = [];
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
        loc = Object.prototype.hasOwnProperty.call(tokCache, t.tok)
          ? tokCache[t.tok]
          : (tokCache[t.tok] = findNumber(pageTexts || [], t.tok));
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

  /* Trim whole sentences from the end of the main text (never the abstract, and
     preserving Conclusion unless everything else is exhausted) until it fits the
     journal word limit. Deterministic, no recomputation. */
  function trimToWordBudget(text, maxWords) {
    var sentences = splitSentences(String(text || ""));
    while (countWords(sentences.join("")) > maxWords) {
      if (sentences.length > 1) sentences.pop();
      else return "";
    }
    return sentences.join("").replace(/\s+$/, "");
  }

  function enforceWordLimit(sections, limit, abstractLimit) {
    var secs = [], i, total = 0, li, sentences, trimmed = false;
    var absLimit = isFinite(abstractLimit) && abstractLimit > 0 ? abstractLimit : 0;
    for (i = 0; i < (sections || []).length; i++) {
      var curText = sections[i].text || "";
      if (sections[i].id === "abstract" && absLimit > 0 && countWords(curText) > absLimit) {
        curText = trimToWordBudget(curText, absLimit);
        trimmed = true;
      }
      secs.push({ id: sections[i].id, heading: sections[i].heading, text: curText });
    }
    if (!isFinite(limit) || limit <= 0) return { sections: secs, words: 0, trimmed: trimmed };
    function mainTotal() {
      var sum = 0, j;
      for (j = 0; j < secs.length; j++) if (secs[j].id !== "abstract") sum += countWords(secs[j].text);
      return sum;
    }
    function pickTrimTarget() {
      var priority = ["discussion", "introduction", "results", "methods"];
      var p, j;
      for (p = 0; p < priority.length; p++) {
        for (j = 0; j < secs.length; j++) {
          if (secs[j].id === priority[p] && countWords(secs[j].text) > 40) return j;
        }
      }
      for (j = secs.length - 1; j >= 0; j--) {
        if (secs[j].id !== "abstract" && secs[j].id !== "conclusion" && countWords(secs[j].text) > 0) return j;
      }
      for (j = secs.length - 1; j >= 0; j--) {
        if (secs[j].id !== "abstract" && countWords(secs[j].text) > 0) return j;
      }
      return -1;
    }
    total = mainTotal();
    while (total > limit) {
      li = pickTrimTarget();
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

  function normalizePagesInput(input) {
    if (Object.prototype.toString.call(input) === "[object Array]") {
      var out = [], i;
      for (i = 0; i < input.length; i++) {
        var pg = input[i] || {};
        out.push({ n: pg.n != null ? pg.n : (i + 1), text: String(pg.text || "") });
      }
      return out;
    }
    var raw = String(input || "");
    if (!raw) return [];
    var parts = raw.split("\f");
    if (parts.length > 1) {
      var fp = [];
      for (var k = 0; k < parts.length; k++) fp.push({ n: k + 1, text: parts[k] });
      return fp;
    }
    return [{ n: null, text: raw }];
  }

  function isTocOrFrontListPage(txt) {
    var head = String(txt || "").slice(0, 360);
    if (/\b(table\s+of\s+contents|list\s+of\s+tables|list\s+of\s+figures)\b/i.test(head)) return true;
    var dots = String(txt || "").match(/\.{4,}\s*\d+/g);
    return !!(dots && dots.length >= 3);
  }

  function extractQuoteForRule(pages, patterns, negPattern) {
    var p, s, clean, low, r;
    for (p = 0; p < pages.length; p++) {
      if (isTocOrFrontListPage(pages[p].text)) continue;
      if (/^\s*(references|bibliography|acknowledgements|dankwoord|curriculum\s+vitae)\b/im.test(String(pages[p].text || "").slice(0, 240))) continue;
      var sents = String(pages[p].text || "").replace(/\s+/g, " ").split(/([.!?]\s+)/);
      for (s = 0; s < sents.length; s += 2) {
        clean = (sents[s] + (sents[s + 1] || "")).replace(/^\s+|\s+$/g, "");
        if (clean.length < 22 || /\.{4,}/.test(clean)) continue;
        low = clean.toLowerCase();
        if (negPattern && negPattern.test(low)) continue;
        for (r = 0; r < patterns.length; r++) {
          if (patterns[r].global) patterns[r].lastIndex = 0;
          if (patterns[r].test(low)) {
            if (clean.length > 180) clean = clean.slice(0, 177).replace(/\s+\S*$/, "") + "...";
            return { quote: clean, page: pages[p].n };
          }
        }
      }
    }
    return { quote: "", page: null };
  }

  function suggestPaperType(input) {
    var pages = normalizePagesInput(input);
    var rules = [
      {
        key: "sr", checklist: "prisma2020", checklistName: "PRISMA",
        pats: [/\bsystematic\s+review(?:\s+and\s+meta[- ]analysis)?\b/g, /\bmeta[- ]analysis\b/g, /\bmeta\s+analysis\b/g, /\bprisma\b/g, /\brisk\s+of\s+bias\s+tool\b/g],
        neg: /\b(i\s+systematically\s+reviewed|systematic\s+review\s+(?:also\s+)?identified|literature\s+review)\b/,
        baseWhy: "Your thesis describes a systematic review or meta-analysis."
      },
      {
        key: "rct", checklist: "consort", checklistName: "CONSORT",
        pats: [/\brandomi[sz]ed\s+(?:controlled|intrapatient|clinical|placebo|double[- ]blind|single[- ]blind|open[- ]label|multicentre|multicenter)?\s*(?:controlled\s+)?trial\b/g, /\brandomly\s+(?:allocated|assigned|divided)\b/g, /\bintrapatient\s+(?:concurrent\s+)?controlled\b/g, /\brandomi[sz]ation\b/g, /\bplacebo[- ]controlled\b/g, /\bconsort\b/g],
        neg: /\b(inform\s+the\s+design\s+of\s+a\s+randomi[sz]ed|future\s+randomi[sz]ed|preliminary\s+randomi[sz]ed)\b/,
        baseWhy: "Your thesis describes a randomized controlled trial."
      },
      {
        key: "diagnostic", checklist: "stard2015", checklistName: "STARD",
        pats: [/\bdiagnostic\s+accuracy\b/g, /\breference\s+standard\b/g, /\bsensitivity\b.{0,35}\bspecificity\b/g, /\broc\s+curve\b/g, /\bstard\b/g],
        neg: null,
        baseWhy: "Your thesis evaluates diagnostic accuracy against a reference standard."
      },
      {
        key: "cohort", checklist: "strobe", checklistName: "STROBE",
        pats: [/\bprospective\s+cohort\b/g, /\bretrospective\s+cohort\b/g, /\bcohort\s+study\b/g, /\bunselected[^.]{0,40}\bcohort\b/g, /\bfollowed\s+up\s+(?:for|every|until|passively)\b/g, /\bkaplan[- ]meier\b/g, /\bnear\s+consecutive\s+patients\b.{0,50}\benrolled\b/g, /\bcohort\s+of\s+patients\b/g],
        neg: null,
        baseWhy: "Your thesis follows an observational cohort of patients over time."
      },
      {
        key: "case_control", checklist: "strobe", checklistName: "STROBE",
        pats: [/\bcase[- ]control\s+study\b/g, /\bmatched\s+controls?\b/g, /\bcases?\s+and\s+(?:matched\s+)?controls?\b/g],
        neg: null,
        baseWhy: "Your thesis compares cases with matched controls."
      },
      {
        key: "cross_sectional", checklist: "strobe", checklistName: "STROBE",
        pats: [/\bcross[- ]sectional\s+(?:study|survey|analysis|evaluation)\b/g, /\bpoint\s+prevalence\b/g],
        neg: null,
        baseWhy: "Your thesis examines a cross-sectional sample or prevalence at one time point."
      },
      {
        key: "qualitative", checklist: "srqr", checklistName: "SRQR",
        pats: [/\bqualitative\s+(?:study|research|analysis)\b/g, /\bthematic\s+analysis\b/g, /\bsemi[- ]structured\s+interviews?\b/g, /\bfocus\s+groups?\b/g],
        neg: null,
        baseWhy: "Your thesis uses qualitative methods such as interviews or thematic analysis."
      },
      {
        key: "case", checklist: "care", checklistName: "CARE",
        pats: [/\bcase\s+series\b/g, /\bcase\s+report\b/g],
        neg: null,
        baseWhy: "Your thesis is a case report or case series."
      }
    ];
    var scores = {}, p, k, r, m, pgText, head, zoneWeight, best = null, bestScore = 0;
    var usablePages = [];
    for (p = 0; p < pages.length; p++) {
      if (!isTocOrFrontListPage(pages[p].text)) usablePages.push(pages[p]);
    }
    if (!usablePages.length) usablePages = pages;
    for (r = 0; r < rules.length; r++) scores[rules[r].key] = 0;
    for (p = 0; p < usablePages.length; p++) {
      pgText = String(usablePages[p].text || "");
      if (!pgText) continue;
      if (/^\s*(references|bibliography|acknowledgements|dankwoord|curriculum\s+vitae)\b/im.test(pgText.slice(0, 260))) continue;
      head = pgText.slice(0, 400).toLowerCase();
      zoneWeight = p < 4 ? 6 : ((p < 14 || /\b(summary|abstract|aims|methods|study\s+design|patients)\b/.test(head)) ? 3 : 1);
      if (/\bchapter\s*2\b/.test(head) && /\bliterature|systematic\s+review\b/.test(head)) zoneWeight = 0.4;
      var lowPg = pgText.toLowerCase();
      for (r = 0; r < rules.length; r++) {
        var rule = rules[r], pts = 0;
        for (k = 0; k < rule.pats.length; k++) {
          var rx = new RegExp(rule.pats[k].source, "gi");
          m = lowPg.match(rx);
          if (m) pts += m.length;
        }
        if (pts > 0 && rule.neg && rule.neg.test(lowPg)) {
          pts = Math.max(0, pts - 3);
        }
        scores[rule.key] += pts * zoneWeight;
      }
    }
    /* Empirical thesis title/summary beat literature citations or an isolated Ch2 review. */
    var titleArea = usablePages.slice(0, Math.min(6, usablePages.length)).map(function (x) { return x.text; }).join(" ").toLowerCase();
    var hasEmpiricalAim = /\b(?:enrolled\s+in\s+the\s+study|consecutive\s+patients|patients\s+were\s+followed|randomi[sz]ed\s+(?:controlled|intrapatient)|prevalence\s+of)\b/.test(titleArea);
    if (scores.sr > 0 && (scores.rct >= 6 || scores.cohort >= 4 || scores.cross_sectional >= 4 || hasEmpiricalAim)) {
      if (!/\bsystematic\s+review\b|\bmeta[- ]analysis\b/.test(titleArea.slice(0, 1800))) scores.sr *= 0.08;
    }
    for (r = 0; r < rules.length; r++) {
      if (scores[rules[r].key] > bestScore) {
        bestScore = scores[rules[r].key];
        best = rules[r];
      }
    }
    if (best && bestScore > 0) {
      var qInfo = extractQuoteForRule(usablePages, best.pats, best.neg);
      var why = best.baseWhy;
      if (qInfo.quote) {
        why = (qInfo.page != null ? ("Thesis page " + qInfo.page + " states: ") : "Thesis excerpt: ") + '"' + qInfo.quote + '"';
      }
      return { key: best.key, checklist: best.checklist, checklistName: best.checklistName, why: why, quote: qInfo.quote, page: qInfo.page };
    }
    var obsQ = extractQuoteForRule(usablePages, [/\bobservation|\bprevalence|\bcohort|\bpatients?\b/i], null);
    var obsWhy = "Your thesis looks like an observational study (cohort, case-control or cross-sectional).";
    if (obsQ.quote) {
      obsWhy = (obsQ.page != null ? ("Thesis page " + obsQ.page + " states: ") : "Thesis excerpt: ") + '"' + obsQ.quote + '"';
    }
    return { key: "obs", checklist: "strobe", checklistName: "STROBE", why: obsWhy, quote: obsQ.quote, page: obsQ.page };
  }

  function classifyThesisPage(text, idx, prevZone) {
    var head = String(text || "").slice(0, 420);
    if (isTocOrFrontListPage(text)) return "appendix";
    var yearSemicolonHits = (String(text || "").match(/\b(?:19|20)\d{2}\s*;\s*\d+/g) || []).length;
    if (/^\s*(references|bibliography|works\s+cited)\b/im.test(head) || (idx > 10 && yearSemicolonHits >= 3)) return "references";
    if (/^\s*(appendix|appendices|acknowledgements?|dankwoord|curriculum\s+vitae|list\s+of\s+publications|abbreviations|table\s+of\s+contents)\b/im.test(head)) return "appendix";
    if (idx < 10 && /\b(abstract|summary|executive\s+summary|samenvatting)\b/im.test(head)) return "abstract";
    if (idx < 8 && prevZone === "front") return "front";
    if (/\b(conclusion|conclusions|future\s+directions|clinical\s+implications)\b/im.test(head)) return "conclusion";
    if (/\b(general\s+discussion|discussion|limitations?\s+and\s+strengths)\b/im.test(head)) return "discussion";
    if (/\b(methods?|patients?\s+and\s+methods?|materials?\s+and\s+methods?|methodology|study\s+design|statistical\s+analysis)\b/im.test(head)) return "methods";
    if (/\b(results?|findings|outcomes|baseline\s+characteristics)\b/im.test(head)) return "results";
    if (/\b(introduction|background|aims?|objectives?|literature\s+review|systematic\s+review)\b/im.test(head)) return "introduction";
    return prevZone || (idx < 5 ? "front" : "results");
  }

  function segmentThesisChapters(pages) {
    var buckets = { front: [], abstract: [], introduction: [], methods: [], results: [], discussion: [], conclusion: [], references: [], appendix: [] };
    var list = normalizePagesInput(pages);
    var prev = "front", i, p, zone;
    for (i = 0; i < list.length; i++) {
      p = list[i];
      if (!String(p.text || "").replace(/\s+/g, "")) continue;
      zone = classifyThesisPage(p.text, i, prev);
      if (zone !== "appendix") buckets[zone].push(p);
      else buckets.appendix.push(p);
      /* On multi-paper PhD theses, study chapters repeat methods/results/discussion cues */
      if (zone !== "references" && zone !== "appendix") {
        if (/\b(patients?\s+and\s+methods?|statistical\s+analysis|eligibility)\b/i.test(p.text) && zone !== "methods") buckets.methods.push(p);
        if (/\b(results|p\s*[<>=]\s*0\.\d|95%\s*ci|mean\s+\(|median\s+\[)\b/i.test(p.text) && zone !== "results") buckets.results.push(p);
        if (/\b(discussion|limitations?|in\s+conclusion)\b/i.test(p.text) && zone !== "discussion") buckets.discussion.push(p);
      }
      prev = zone;
    }
    var prose = [];
    for (i = 0; i < list.length; i++) {
      zone = classifyThesisPage(list[i].text, i, "results");
      if (zone !== "references" && zone !== "appendix" && String(list[i].text || "").trim()) prose.push(list[i]);
    }
    if (!prose.length) prose = list;
    var n = prose.length;
    if (!buckets.abstract.length) buckets.abstract = buckets.front.length ? buckets.front.slice(0, 8) : prose.slice(0, Math.min(6, n));
    if (!buckets.introduction.length) buckets.introduction = prose.slice(0, Math.max(1, Math.ceil(n * 0.28)));
    if (!buckets.methods.length) buckets.methods = prose.slice(Math.floor(n * 0.2), Math.max(1, Math.ceil(n * 0.55)));
    if (!buckets.results.length) buckets.results = prose.slice(Math.floor(n * 0.35), Math.max(1, Math.ceil(n * 0.8)));
    if (!buckets.discussion.length) buckets.discussion = prose.slice(Math.floor(n * 0.6), n);
    if (!buckets.conclusion.length) {
      var tail = buckets.discussion.slice(-Math.min(6, buckets.discussion.length));
      var headSum = buckets.abstract.slice(0, Math.min(4, buckets.abstract.length));
      buckets.conclusion = headSum.concat(tail);
    }
    return buckets;
  }

  /* ---------- chapter tree from Rust lines / DOCX headings / pdf.js ---------- */

  function pageLinesFromPages(pages) {
    var list = normalizePagesInput(pages);
    var out = [], i, lines, j, tx;
    for (i = 0; i < list.length; i++) {
      lines = String(list[i].text || "").split(/\n+/);
      var lObjs = [];
      for (j = 0; j < lines.length; j++) {
        tx = lines[j].replace(/[ \t]+/g, " ").replace(/^\s+|\s+$/g, "");
        if (!tx) continue;
        lObjs.push({
          tx: tx,
          size: 11,
          caps: /[A-Za-z].*[A-Za-z]/.test(tx) && !/[a-z]/.test(tx)
        });
      }
      out.push({ n: list[i].n, lines: lObjs });
    }
    return out;
  }

  function computeBodyFontSize(pageLines) {
    var weights = {}, i, j, l, sz, len, hasSize = false;
    for (i = 0; i < pageLines.length; i++) {
      var lines = (pageLines[i] && pageLines[i].lines) || [];
      for (j = 0; j < lines.length; j++) {
        l = lines[j];
        if (!l || !l.size || l.size <= 0) continue;
        hasSize = true;
        len = String(l.tx || "").length;
        if (len < 15 && pageLines.length > 3) continue;
        sz = String(Math.round(l.size * 2) / 2);
        weights[sz] = (weights[sz] || 0) + len;
      }
    }
    if (!hasSize) return 11;
    var bestSz = 11, bestW = -1, k;
    for (k in weights) {
      if (Object.prototype.hasOwnProperty.call(weights, k) && weights[k] > bestW) {
        bestW = weights[k];
        bestSz = Number(k);
      }
    }
    if (bestW <= 0) {
      for (i = 0; i < pageLines.length; i++) {
        var lines2 = (pageLines[i] && pageLines[i].lines) || [];
        for (j = 0; j < lines2.length; j++) {
          l = lines2[j];
          if (!l || !l.size || l.size <= 0) continue;
          sz = String(Math.round(l.size * 2) / 2);
          weights[sz] = (weights[sz] || 0) + Math.max(1, String(l.tx || "").length);
        }
      }
      for (k in weights) {
        if (Object.prototype.hasOwnProperty.call(weights, k) && weights[k] > bestW) {
          bestW = weights[k];
          bestSz = Number(k);
        }
      }
    }
    return bestSz || 11;
  }

  function normHeadingText(tx) {
    return String(tx || "")
      .replace(/^\s*(?:chapter|section|part)\s+(?:\d+|[ivxlcdm]+)\s*[:.\-\u2013\u2014]?\s*/i, "")
      .replace(/^\s*(?:\d+(?:\.\d+)*|[ivxlcdm]+)[.):\-\s]+/i, "")
      .replace(/\s+/g, " ")
      .replace(/[:.\s]+$/, "")
      .toLowerCase();
  }

  function classifyHeadingRole(title, pageIdx, totalPages) {
    var raw = String(title || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    var low = normHeadingText(raw);
    if (!low) return { kind: "other", role: "other", isFrontMatter: false, condenseReview: false };

    if (/^(?:certificates?|bonafide\s+certificate|declaration|acknowledgements?|acknowledgments?|dankwoord|table\s+of\s+contents|contents|list\s+of\s+tables|list\s+of\s+figures|list\s+of\s+abbreviations|abbreviations|definitions\s*\/\s*abbreviations|dedication|preface|promotoren|curriculum\s+vitae|publications?\s+containing|presentation\s+to\s+learned|list\s+of\s+publications|summary\s+in\s+dutch|nederlandse\s+samenvatting)\b/i.test(low) ||
        /\b(?:submitted\s+in\s+fulfilment|degree\s+of\s+doctor|proefschrift|university\s+repository)\b/i.test(raw)) {
      return { kind: "front_matter", role: "excluded", isFrontMatter: true, condenseReview: false };
    }
    if (/^(?:annexures?|appendices|appendix\b|proforma|consent\s+forms?|patient\s+information\s+sheets?|master\s+chart|case\s+report\s+form)/i.test(low)) {
      return { kind: "annexure", role: "excluded", isFrontMatter: false, condenseReview: false };
    }
    if (/^(?:references|bibliography|list\s+of\s+references|works\s+cited)\b/i.test(low)) {
      return { kind: "references", role: "references", isFrontMatter: false, condenseReview: false };
    }
    if (/^(?:review\s+of\s+literature|literature\s+review)\b/i.test(low) ||
        (/\bsystematic\s+review\b/i.test(low) && pageIdx < Math.max(25, Math.floor(totalPages * 0.45)))) {
      return { kind: "review", role: "introduction", isFrontMatter: false, condenseReview: true };
    }
    if (/^(?:summary\s+and\s+conclusions?|conclusions?|future\s+directions?)\b/i.test(low)) {
      return { kind: "conclusion", role: "conclusion", isFrontMatter: false, condenseReview: false };
    }
    if (/^(?:abstract|executive\s+summary|structured\s+abstract)\b/i.test(low) ||
        (/^summary\b/i.test(low) && pageIdx <= Math.max(6, Math.floor(totalPages * 0.12)))) {
      return { kind: "abstract", role: "abstract", isFrontMatter: false, condenseReview: false };
    }
    if (/^summary\b/i.test(low)) {
      return { kind: "conclusion", role: "conclusion", isFrontMatter: false, condenseReview: false };
    }
    if (/^(?:introduction|background|aims?\s+and\s+objectives?|aim\s*(?:&|and)\s*objectives?|aim\s+of\s+(?:the\s+study|this\s+thesis)|aims|objectives)\b/i.test(low)) {
      return { kind: "introduction", role: "introduction", isFrontMatter: false, condenseReview: false };
    }
    if (/^(?:materials?\s+and\s+methods?|patients?\s+and\s+methods?|subjects?\s+and\s+methods?|methodology|methods?|study\s+design|study\s+protocol|study\s+population|statistical\s+analysis|ethical\s+considerations)\b/i.test(low)) {
      return { kind: "methods", role: "methods", isFrontMatter: false, condenseReview: false };
    }
    if (/^(?:observations?\s+and\s+results?|observations?|results?|findings|recruitment\b|baseline\s+characteristics|follow\s+up|predicting\b|outcomes?)\b/i.test(low)) {
      return { kind: "results", role: "results", isFrontMatter: false, condenseReview: false };
    }
    if (/^(?:general\s+discussion|discussion)\b/i.test(low)) {
      return { kind: "discussion", role: "discussion", isFrontMatter: false, condenseReview: false };
    }
    /* Secondary keyword fallback inside multi-word chapter titles */
    if (/\b(?:materials?\s+and\s+methods?|methodology|methods?)\b/i.test(low)) {
      return { kind: "methods", role: "methods", isFrontMatter: false, condenseReview: false };
    }
    if (/\b(?:observations?\s+and\s+results?|results|recruitment|baseline|follow\s+up|outcomes?)\b/i.test(low)) {
      return { kind: "results", role: "results", isFrontMatter: false, condenseReview: false };
    }
    if (/\b(?:discussion)\b/i.test(low)) {
      return { kind: "discussion", role: "discussion", isFrontMatter: false, condenseReview: false };
    }
    if (/\b(?:conclusions?)\b/i.test(low)) {
      return { kind: "conclusion", role: "conclusion", isFrontMatter: false, condenseReview: false };
    }
    if (/\b(?:introduction|aims?|objectives?)\b/i.test(low)) {
      return { kind: "introduction", role: "introduction", isFrontMatter: false, condenseReview: false };
    }
    return { kind: "chapter", role: "other", isFrontMatter: false, condenseReview: false };
  }

  function isKnownThesisHeadingLine(tx) {
    var s = String(tx || "").replace(/^\s+|\s+$/g, "");
    if (!s || s.length > 96) return false;
    var low = normHeadingText(s);
    return /^(?:introduction|aims?\s*(?:&|and)\s*objectives?|aim\s+of\s+(?:the\s+study|this\s+thesis)|aims|objectives|review\s+of\s+literature|literature\s+review|materials?\s*(?:&|and)\s*methods?|patients?\s*(?:&|and)\s*methods?|subjects?\s*(?:&|and)\s*methods?|methodology|methods|observations?\s*(?:&|and)\s*results?|observations|results|discussion|general\s+discussion|summary|summary\s+and\s+conclusions?|conclusions?|bibliography|references|list\s+of\s+references|works\s+cited|annexures?|appendices|appendix(?:\s+\d+)?|proforma|consent(?:\s+form)?|master\s+chart|abstract|certificate|bonafide\s+certificate|declaration|acknowledgements?|acknowledgments?|table\s+of\s+contents|contents|list\s+of\s+tables|list\s+of\s+figures|list\s+of\s+abbreviations|abbreviations|curriculum\s+vitae)\b/i.test(low);
  }

  function detectThesisHeadings(pageLines, pages) {
    var pl = (pageLines && pageLines.length) ? pageLines : pageLinesFromPages(pages || []);
    if (!pl.length) return { bodySize: 11, headings: [] };
    var bodySize = computeBodyFontSize(pl);
    var totalPages = pl.length;

    /* Detect running headers/footers repeated across >= 4 pages */
    var edgeCounts = {}, i, j, l, lines, normFirst, normLast;
    if (totalPages >= 8) {
      for (i = 0; i < pl.length; i++) {
        lines = (pl[i] && pl[i].lines) || [];
        if (lines.length) {
          normFirst = String(lines[0].tx || "").replace(/\d+/g, "#").replace(/\s+/g, " ").toLowerCase();
          if (normFirst && normFirst.length < 90) edgeCounts[normFirst] = (edgeCounts[normFirst] || 0) + 1;
          if (lines.length > 1) {
            normLast = String(lines[lines.length - 1].tx || "").replace(/\d+/g, "#").replace(/\s+/g, " ").toLowerCase();
            if (normLast && normLast.length < 90) edgeCounts[normLast] = (edgeCounts[normLast] || 0) + 1;
          }
        }
      }
    }

    var rawCandidates = [];
    for (i = 0; i < pl.length; i++) {
      var pg = pl[i] || {};
      var pNo = pg.n != null ? pg.n : (i + 1);
      lines = pg.lines || [];
      var pageTxt = "";
      for (j = 0; j < lines.length; j++) pageTxt += (j ? "\n" : "") + (lines[j].tx || "");
      var isTocPage = isTocOrFrontListPage(pageTxt);
      var firstNonEmptyLine = true;

      for (j = 0; j < lines.length; j++) {
        l = lines[j] || {};
        var tx = String(l.tx || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
        if (!tx) continue;
        if (tx.length > 110) { firstNonEmptyLine = false; continue; }
        /* Skip pure numbers, page numbers, table/figure captions, TOC dot-leader rows */
        if (/^(?:\d+|[ivxlcdm]+|page\s+\d+(?:\s+of\s+\d+)?|\d+\s*\|\s*page)$/i.test(tx)) { firstNonEmptyLine = false; continue; }
        if (/^(?:table|figure|fig\.?)\s+\d+(?:[.\-]\d+)?[a-z]?(?:\s*[:.\-]|$)/i.test(tx)) { firstNonEmptyLine = false; continue; }
        if (/\.{3,}\s*\d+\s*$/.test(tx)) { firstNonEmptyLine = false; continue; }
        var sz = typeof l.size === "number" && l.size > 0 ? l.size : bodySize;
        var ratio = sz / bodySize;
        var isMuchLarger = ratio >= 1.35;
        var isLarger = ratio >= 1.12;
        var isBold = l.bold === true;
        var isCaps = l.caps === true || (/[A-Za-z].*[A-Za-z]/.test(tx) && !/[a-z]/.test(tx));
        var isChapterPrefix = /^(?:Chapter|CHAPTER|Section|SECTION|Part|PART)\s+(?:\d+|[IVXLCDM]+)(?:\s*[:.\-\u2013\u2014]|\s+[A-Z0-9]|\s*$)/.test(tx) && !/^Chapter\s+\d+,/i.test(tx);
        var isSubNum = /^\d+\.\d+(?:\.\d+)?\s+[A-Za-z]/.test(tx);
        var isTopNum = /^(?:\d+|[IVXLCDM]+)\.\s+[A-Za-z]/.test(tx);
        var isNumbered = isSubNum || isTopNum;
        var isKnown = isKnownThesisHeadingLine(tx);
        var wc = tx.split(/\s+/).length;

        var edgeKey = tx.replace(/\d+/g, "#").toLowerCase();
        if (totalPages >= 8 && edgeCounts[edgeKey] >= 4 && (j === 0 || j === lines.length - 1) &&
            !isChapterPrefix && !isMuchLarger) {
          firstNonEmptyLine = false;
          continue;
        }
        /* Inside a TOC page, only allow the TOC heading itself on line 0/1 */
        if (isTocPage && !firstNonEmptyLine) continue;
        firstNonEmptyLine = false;

        /* Reject table header cells smaller than body font, and long sentence lines ending in '.' */
        if (sz < bodySize * 0.98 && !isChapterPrefix && !isKnown && l.headingLevel == null) continue;
        if (/\.\s*$/.test(tx) && wc >= 9 && !isChapterPrefix && !isKnown && l.headingLevel == null) continue;
        /* Reject citation-like lines */
        if (/\b(?:19|20)\d{2}\s*[;:]\s*\d+|doi\s*:|pmid\s*:/i.test(tx) && l.headingLevel == null) continue;

        var accepted = false;
        if (l.headingLevel != null) accepted = true;
        else if (isChapterPrefix && wc <= 14) accepted = true;
        else if (isMuchLarger && wc <= 14) accepted = true;
        else if (isLarger && (isBold || isCaps || isNumbered || isKnown || (wc <= 10 && !/[,;]$/.test(tx)))) accepted = true;
        else if (isBold && (isNumbered || isKnown || (ratio >= 0.98 && wc <= 8 && !/[.,:;]$/.test(tx)))) accepted = true;
        else if (isCaps && (isKnown || isNumbered) && wc <= 10) accepted = true;
        else if (isKnown && wc <= 8 && ratio >= 0.98) accepted = true;

        if (!accepted) continue;

        rawCandidates.push({
          page: pNo,
          pageIdx: i,
          lineIdx: j,
          tx: tx,
          size: Math.round(sz * 10) / 10,
          bold: isBold,
          caps: isCaps,
          headingLevel: l.headingLevel != null ? l.headingLevel : null,
          isChapterPrefix: isChapterPrefix,
          isSubNum: isSubNum,
          isTopNum: isTopNum,
          isKnown: isKnown
        });
      }
    }

    /* Merge wrapped multi-line headings on the same page (e.g. "CHAPTER 1" + "Introduction and aims",
       or 2-4 wrapped title lines at the same size/level) */
    var merged = [];
    for (i = 0; i < rawCandidates.length; i++) {
      var cur = rawCandidates[i];
      var prev = merged.length ? merged[merged.length - 1] : null;
      var samePageAdjacent = prev && prev.page === cur.page && (cur.lineIdx - prev.endLineIdx) <= 2;
      var chapterPlusTitle = prev && prev.isChapterPrefix && !cur.isChapterPrefix && !cur.isSubNum &&
        prev.tx.split(/\s+/).length <= 3 && cur.size >= bodySize * 1.3;
      var prevTitleSz = prev ? (prev._titleSize || prev.size) : 0;
      var prevDangling = prev && /\b(?:and|or|of|in|for|the|to|with|a|an)$/i.test(prev.tx);
      var sameSizeWrap = prev && Math.abs(prevTitleSz - cur.size) <= 0.3 &&
        prev.headingLevel === cur.headingLevel &&
        !cur.isChapterPrefix && !cur.isSubNum && !cur.isTopNum &&
        (!isKnownThesisHeadingLine(cur.tx) || prevDangling || /^\(/.test(cur.tx)) &&
        (prev._fromChapterPlusTitle || prevDangling || /^\(/.test(cur.tx) || !(isKnownThesisHeadingLine(prev.tx) && prev.tx.split(/\s+/).length <= 4));

      if (samePageAdjacent && (chapterPlusTitle || sameSizeWrap)) {
        prev.tx = chapterPlusTitle ? (prev.tx + ": " + cur.tx) : (prev.tx + " " + cur.tx);
        prev.endLineIdx = cur.lineIdx;
        if (chapterPlusTitle) { prev._titleSize = cur.size; prev._fromChapterPlusTitle = true; }
        if (cur.isKnown) prev.isKnown = true;
        continue;
      }
      cur.endLineIdx = cur.lineIdx;
      merged.push(cur);
    }

    /* Assign hierarchical level (1 = chapter, 2 = section, 3 = subsection) */
    var topSize = 0;
    for (i = 0; i < merged.length; i++) {
      if (merged[i].isChapterPrefix || (merged[i].isKnown && !merged[i].isSubNum)) {
        if (merged[i].size > topSize) topSize = merged[i].size;
      }
    }
    if (!topSize) {
      for (i = 0; i < merged.length; i++) if (merged[i].size > topSize) topSize = merged[i].size;
    }

    var headings = [];
    for (i = 0; i < merged.length; i++) {
      var h = merged[i];
      var lvl = 2;
      if (h.headingLevel != null) {
        lvl = h.headingLevel;
      } else if (h.isChapterPrefix) {
        lvl = 1;
      } else if (h.isSubNum) {
        var dotMatch = h.tx.match(/^(\d+(?:\.\d+)+)/);
        var dots = dotMatch ? dotMatch[1].split(".").length : 2;
        lvl = Math.min(3, dots);
      } else if (h.size >= topSize * 0.80 && h.size > bodySize * 1.35) {
        lvl = 1;
      } else if (h.size >= topSize * 0.92 && h.size > bodySize * 1.15) {
        lvl = 1;
      } else if (h.isKnown && (h.size >= bodySize * 1.1 || h.caps || h.isTopNum) && (!topSize || topSize <= bodySize * 1.25)) {
        lvl = 1;
      } else if (h.size <= bodySize * 1.22 && topSize >= bodySize * 1.5) {
        lvl = h.size <= bodySize * 1.08 ? 3 : 2;
      }
      var info = classifyHeadingRole(h.tx, h.pageIdx, totalPages);
      headings.push({
        title: h.tx,
        level: lvl,
        page: h.page,
        pageIdx: h.pageIdx,
        lineIdx: h.lineIdx,
        size: h.size,
        bold: h.bold,
        caps: h.caps,
        kind: info.kind,
        role: info.role,
        isFrontMatter: info.isFrontMatter,
        condenseReview: info.condenseReview
      });
    }

    return { bodySize: bodySize, headings: headings };
  }

  function sliceChapterPages(pages, node) {
    var list = normalizePagesInput(pages);
    if (!list.length || !node) return [];
    var sp = node.startPageIdx != null ? node.startPageIdx : 0;
    var sl = node.startLineIdx != null ? node.startLineIdx : 0;
    var ep = node.endPageIdx != null ? node.endPageIdx : (list.length - 1);
    var el = node.endLineIdx;
    var out = [], i, pg, lines, from, to, txt;
    for (i = sp; i <= ep && i < list.length; i++) {
      pg = list[i];
      lines = String(pg.text || "").split(/\n+/);
      from = (i === sp) ? Math.max(0, sl) : 0;
      to = (i === ep && el != null) ? Math.min(lines.length, el) : lines.length;
      txt = lines.slice(from, to).join("\n").replace(/^\s+|\s+$/g, "");
      if (txt) out.push({ n: pg.n, text: txt });
    }
    return out;
  }

  function buildChapterTree(pageLines, pages) {
    var pl = (pageLines && pageLines.length) ? pageLines : pageLinesFromPages(pages || []);
    var pgList = normalizePagesInput(pages && pages.length ? pages : pl.map(function (p) {
      return { n: p.n, text: (p.lines || []).map(function (l) { return l.tx || ""; }).filter(Boolean).join("\n") };
    }));
    var det = detectThesisHeadings(pl, pgList);
    var headings = det.headings;
    var totalPages = pgList.length;
    var chapters = [];

    if (!headings.length) {
      /* Graceful fallback when no typographic/numbered headings exist (e.g. OCR scans or 1-page note) */
      var seg = segmentThesisChapters(pgList);
      var order = [
        { key: "abstract", title: "Summary / Abstract", kind: "abstract", role: "abstract" },
        { key: "introduction", title: "Introduction", kind: "introduction", role: "introduction" },
        { key: "methods", title: "Methods", kind: "methods", role: "methods" },
        { key: "results", title: "Results", kind: "results", role: "results" },
        { key: "discussion", title: "Discussion", kind: "discussion", role: "discussion" },
        { key: "conclusion", title: "Conclusion", kind: "conclusion", role: "conclusion" },
        { key: "references", title: "References", kind: "references", role: "references" },
        { key: "appendix", title: "Front matter / Appendices", kind: "annexure", role: "excluded" }
      ];
      for (var oi = 0; oi < order.length; oi++) {
        var o = order[oi];
        var bucket = seg[o.key] || [];
        if (!bucket.length) continue;
        var firstP = bucket[0].n != null ? bucket[0].n : 1;
        var lastP = bucket[bucket.length - 1].n != null ? bucket[bucket.length - 1].n : firstP;
        chapters.push({
          id: "ch_" + (chapters.length + 1),
          title: o.title,
          level: 1,
          startPage: firstP,
          endPage: lastP,
          startPageIdx: Math.max(0, firstP - 1),
          startLineIdx: 0,
          endPageIdx: Math.max(0, lastP - 1),
          endLineIdx: null,
          kind: o.kind,
          role: o.role,
          isFrontMatter: false,
          condenseReview: false,
          children: []
        });
      }
      /* Cover/title pages before TOC or Chapter 1 are front matter, not study results */
    var firstBodyIdx = -1;
    for (hi = 0; hi < chapters.length; hi++) {
      if (chapters[hi].kind === "introduction" || chapters[hi].kind === "methods" || chapters[hi].kind === "review" ||
          /^(?:chapter|section)\s+1\b/i.test(chapters[hi].title || "")) {
        firstBodyIdx = hi;
        break;
      }
    }
    if (firstBodyIdx > 0) {
      for (hi = 0; hi < firstBodyIdx; hi++) {
        if (chapters[hi].kind === "chapter" && chapters[hi].startPageIdx <= 5 && chapters[hi].endPageIdx <= 6) {
          chapters[hi].kind = "front_matter";
          chapters[hi].role = "excluded";
          chapters[hi].isFrontMatter = true;
        }
      }
    }

    return { bodySize: det.bodySize, totalPages: totalPages, chapters: chapters };
    }

    /* Promote level-2 headings before the first level-1 heading if no level-1 heading exists at all */
    var hasTop = false, hi;
    for (hi = 0; hi < headings.length; hi++) if (headings[hi].level === 1) { hasTop = true; break; }
    if (!hasTop) {
      for (hi = 0; hi < headings.length; hi++) if (headings[hi].level === 2) headings[hi].level = 1;
    }

    var firstH = headings[0];
    if (firstH && firstH.pageIdx > 0) {
      chapters.push({
        id: "ch_front_0",
        title: "Title and front matter",
        level: 1,
        startPage: pgList[0].n,
        endPage: pgList[Math.max(0, firstH.pageIdx - 1)].n,
        startPageIdx: 0,
        startLineIdx: 0,
        endPageIdx: firstH.lineIdx > 0 ? firstH.pageIdx : Math.max(0, firstH.pageIdx - 1),
        endLineIdx: firstH.lineIdx > 0 ? firstH.lineIdx : null,
        kind: "front_matter",
        role: "excluded",
        isFrontMatter: true,
        condenseReview: false,
        children: []
      });
    }

    var curTop = null;
    for (hi = 0; hi < headings.length; hi++) {
      var hd = headings[hi];
      var nextHd = hi + 1 < headings.length ? headings[hi + 1] : null;
      var endPgIdx = totalPages - 1;
      var endLine = null;
      if (nextHd) {
        if (nextHd.lineIdx > 0) {
          endPgIdx = nextHd.pageIdx;
          endLine = nextHd.lineIdx;
        } else {
          endPgIdx = Math.max(hd.pageIdx, nextHd.pageIdx - 1);
          endLine = null;
        }
      }
      if (hd.level === 1 || !curTop) {
        /* Compute top-level end bound extending until the next level-1 heading */
        var nextTop = null;
        for (var nj = hi + 1; nj < headings.length; nj++) {
          if (headings[nj].level === 1) { nextTop = headings[nj]; break; }
        }
        var topEndPgIdx = totalPages - 1;
        var topEndLine = null;
        if (nextTop) {
          if (nextTop.lineIdx > 0) {
            topEndPgIdx = nextTop.pageIdx;
            topEndLine = nextTop.lineIdx;
          } else {
            topEndPgIdx = Math.max(hd.pageIdx, nextTop.pageIdx - 1);
            topEndLine = null;
          }
        }
        curTop = {
          id: "ch_" + (chapters.length + 1),
          title: hd.title,
          level: 1,
          startPage: hd.page,
          endPage: pgList[topEndPgIdx] ? pgList[topEndPgIdx].n : hd.page,
          startPageIdx: hd.pageIdx,
          startLineIdx: hd.lineIdx,
          endPageIdx: topEndPgIdx,
          endLineIdx: topEndLine,
          kind: hd.kind,
          role: hd.role,
          isFrontMatter: hd.isFrontMatter,
          condenseReview: hd.condenseReview,
          children: []
        };
        chapters.push(curTop);
      } else {
        curTop.children.push({
          id: curTop.id + "_s" + (curTop.children.length + 1),
          title: hd.title,
          level: hd.level,
          startPage: hd.page,
          endPage: pgList[endPgIdx] ? pgList[endPgIdx].n : hd.page,
          startPageIdx: hd.pageIdx,
          startLineIdx: hd.lineIdx,
          endPageIdx: endPgIdx,
          endLineIdx: endLine,
          kind: hd.kind,
          role: hd.role,
          isFrontMatter: hd.isFrontMatter,
          condenseReview: hd.condenseReview
        });
      }
    }

    /* Cover/title pages before TOC or Chapter 1 are front matter, not study results */
    var firstBodyIdx = -1;
    for (hi = 0; hi < chapters.length; hi++) {
      if (chapters[hi].kind === "introduction" || chapters[hi].kind === "methods" || chapters[hi].kind === "review" ||
          /^(?:chapter|section)\s+1\b/i.test(chapters[hi].title || "")) {
        firstBodyIdx = hi;
        break;
      }
    }
    if (firstBodyIdx > 0) {
      for (hi = 0; hi < firstBodyIdx; hi++) {
        if (chapters[hi].kind === "chapter" && chapters[hi].startPageIdx <= 5 && chapters[hi].endPageIdx <= 6) {
          chapters[hi].kind = "front_matter";
          chapters[hi].role = "excluded";
          chapters[hi].isFrontMatter = true;
        }
      }
    }

    return { bodySize: det.bodySize, totalPages: totalPages, chapters: chapters };
  }

  function journalHeadingsFor(journal, paperType) {
    if (journal && Array.isArray(journal.requiredHeadings) && journal.requiredHeadings.length) {
      return journal.requiredHeadings.map(function (h) {
        return typeof h === "string" ? { id: h.toLowerCase().replace(/[^a-z0-9]+/g, "_"), heading: h } : h;
      });
    }
    if (paperType === "case") {
      return [
        { id: "abstract", heading: "Abstract" },
        { id: "introduction", heading: "Introduction" },
        { id: "methods", heading: "Case Presentation" },
        { id: "results", heading: "Results / Course" },
        { id: "discussion", heading: "Discussion" },
        { id: "conclusion", heading: "Conclusion" },
        { id: "references", heading: "References" }
      ];
    }
    return [
      { id: "abstract", heading: "Abstract" },
      { id: "introduction", heading: "Introduction" },
      { id: "methods", heading: "Methods" },
      { id: "results", heading: "Results" },
      { id: "discussion", heading: "Discussion" },
      { id: "conclusion", heading: "Conclusion" },
      { id: "references", heading: "References" }
    ];
  }

  function mapChaptersToJournal(tree, pages, journal, paperType, overrides) {
    tree = tree || buildChapterTree(null, pages || []);
    overrides = overrides || {};
    var headings = journalHeadingsFor(journal, paperType);
    var chapters = tree.chapters || [];
    var items = [];
    var excluded = [];
    var bySection = {
      abstract: { pages: [], reviewPages: [], tables: [] },
      introduction: { pages: [], reviewPages: [], tables: [] },
      methods: { pages: [], reviewPages: [], tables: [] },
      results: { pages: [], reviewPages: [], tables: [] },
      discussion: { pages: [], reviewPages: [], tables: [] },
      conclusion: { pages: [], reviewPages: [], tables: [] },
      references: { pages: [], reviewPages: [], tables: [] }
    };

    function addPagesTo(secId, chPages, isReview) {
      var bucket = bySection[secId];
      if (!bucket || !chPages || !chPages.length) return;
      for (var k = 0; k < chPages.length; k++) {
        bucket.pages.push(chPages[k]);
        if (isReview) bucket.reviewPages.push(chPages[k]);
      }
    }

    for (var i = 0; i < chapters.length; i++) {
      var ch = chapters[i];
      var children = ch.children || [];
      var childImrad = {};
      var distinctRoles = 0;
      for (var ci = 0; ci < children.length; ci++) {
        var r = children[ci].role;
        if ((r === "methods" || r === "results" || r === "discussion") && !childImrad[r]) {
          childImrad[r] = true;
          distinctRoles++;
        }
      }
      var hasMultiChildren = distinctRoles >= 2 && (ch.kind === "chapter" || (/^(?:chapter|section)\s+\d+/i.test(ch.title || "") && ch.kind !== "review" && ch.kind !== "references" && ch.kind !== "annexure"));
      var defaultTarget = ch.role || "excluded";
      if (hasMultiChildren) defaultTarget = "auto";
      else if (defaultTarget === "other") defaultTarget = "results";

      var chosen = Object.prototype.hasOwnProperty.call(overrides, ch.id) ? overrides[ch.id] : defaultTarget;
      var chPages = sliceChapterPages(pages, ch);
      var item = {
        id: ch.id,
        title: ch.title,
        startPage: ch.startPage,
        endPage: ch.endPage,
        kind: ch.kind,
        isFrontMatter: !!ch.isFrontMatter,
        condenseReview: !!ch.condenseReview,
        canAutoSplit: hasMultiChildren,
        defaultTarget: defaultTarget,
        target: chosen
      };
      items.push(item);

      if (chosen === "excluded") {
        excluded.push({
          id: ch.id,
          title: ch.title,
          startPage: ch.startPage,
          endPage: ch.endPage,
          reason: ch.isFrontMatter ? "Front matter" : (ch.kind === "annexure" ? "Annexure / appendix" : "Excluded by user")
        });
        continue;
      }

      if (chosen === "auto" && hasMultiChildren) {
        /* Route subheadings inside a multi-study chapter (e.g. Ch 3 Intro/Methods/Results/Discussion) */
        var firstChild = children[0];
        if (firstChild && (firstChild.startPageIdx > ch.startPageIdx || firstChild.startLineIdx > ch.startLineIdx)) {
          var headOnly = sliceChapterPages(pages, {
            startPageIdx: ch.startPageIdx,
            startLineIdx: ch.startLineIdx,
            endPageIdx: firstChild.startPageIdx,
            endLineIdx: firstChild.startLineIdx
          });
          addPagesTo("introduction", headOnly, false);
        }
        for (var j = 0; j < children.length; j++) {
          var sub = children[j];
          if (sub.role === "excluded" || sub.kind === "annexure") {
            excluded.push({ id: sub.id, title: ch.title + " - " + sub.title, startPage: sub.startPage, endPage: sub.endPage, reason: "Annexure / appendix" });
            continue;
          }
          var subTarget = (sub.role && sub.role !== "other") ? sub.role : "results";
          addPagesTo(subTarget, sliceChapterPages(pages, sub), !!sub.condenseReview);
        }
      } else {
        addPagesTo(chosen, chPages, !!ch.condenseReview);
        /* If Discussion contains an explicit Conclusion subheading (e.g. 9.5 Conclusions), also feed Conclusion */
        if (chosen === "discussion") {
          for (var dk = 0; dk < children.length; dk++) {
            if (children[dk].role === "conclusion") {
              addPagesTo("conclusion", sliceChapterPages(pages, children[dk]), false);
            }
          }
        }
      }
    }

    if (bySection.results.pages.length) {
      bySection.results.tables = extractThesisTables(bySection.results.pages);
    }

    return {
      headings: headings,
      items: items,
      excluded: excluded,
      bySection: bySection,
      overrides: overrides
    };
  }

  function runBoundedPool(tasks, concurrency) {
    var list = Array.isArray(tasks) ? tasks : [];
    var limit = Math.max(1, Number(concurrency) || 3);
    if (!list.length) return Promise.resolve([]);
    var results = new Array(list.length);
    var nextIdx = 0;
    function worker() {
      if (nextIdx >= list.length) return Promise.resolve();
      var i = nextIdx++;
      return Promise.resolve().then(function () { return list[i](); }).then(function (val) {
        results[i] = { ok: true, value: val };
      }, function (err) {
        results[i] = { ok: false, error: err };
        if (err && err._handledByConsent) throw err;
      }).then(worker);
    }
    var workers = [];
    var n = Math.min(limit, list.length);
    for (var w = 0; w < n; w++) workers.push(worker());
    return Promise.all(workers).then(function () { return results; });
  }

  function condenseLongBucket(pages, totalTargetChars) {
    var list = normalizePagesInput(pages);
    if (!list.length) return [];
    var perPageMax = Math.max(260, Math.floor(totalTargetChars / list.length));
    var out = [], i, raw, sents, picked, len, s, hasSignal;
    for (i = 0; i < list.length; i++) {
      raw = String(list[i].text || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
      if (!raw) continue;
      if (raw.length <= perPageMax) { out.push({ n: list[i].n, text: raw }); continue; }
      sents = splitSentences(raw);
      picked = [];
      len = 0;
      for (s = 0; s < sents.length; s++) {
        hasSignal = s === 0 || s === sents.length - 1 || /\d/.test(sents[s]) || /\b(table|method|cohort|random|result|conclu|significant|p\s*<|ci|mean|median|patients?)\b/i.test(sents[s]);
        if (hasSignal && len + sents[s].length <= perPageMax) {
          picked.push(sents[s]);
          len += sents[s].length + 1;
        }
      }
      if (!picked.length) picked.push(raw.slice(0, perPageMax));
      out.push({ n: list[i].n, text: picked.join(" ") });
    }
    return out;
  }

  function chunkPagesByChars(pages, maxChars, maxChunks) {
    var cap = maxChars || 13500;
    var limit = maxChunks || 3;
    var list = normalizePagesInput(pages);
    var totalChars = 0, i;
    for (i = 0; i < list.length; i++) totalChars += String(list[i].text || "").length + 12;
    if (totalChars > cap * limit) {
      list = condenseLongBucket(list, cap * limit);
    }
    var chunks = [], cur = [], curChars = 0;
    for (i = 0; i < list.length; i++) {
      var pText = String(list[i].text || "");
      if (!pText.replace(/\s+/g, "")) continue;
      if (pText.length > cap - 100) pText = pText.slice(0, cap - 100);
      var pieceLen = pText.length + 14;
      if (cur.length && curChars + pieceLen > cap) {
        chunks.push(cur);
        if (chunks.length >= limit) break;
        cur = [];
        curChars = 0;
      }
      cur.push({ n: list[i].n, text: pText });
      curChars += pieceLen;
    }
    if (cur.length && chunks.length < limit) chunks.push(cur);
    return chunks;
  }

  function extractThesisTables(pages) {
    var list = normalizePagesInput(pages);
    var seen = {}, out = [], p, text, m, re = /(?:^|\n)\s*(Table\s+\d+(?:[.\-]\d+)?[A-Za-z]?)\s*([:.\-])?\s*([^\n]{0,120})/gi;
    for (p = 0; p < list.length; p++) {
      text = String(list[p].text || "");
      if (isTocOrFrontListPage(text)) continue;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        var tid = m[1].replace(/\s+/g, " ");
        var sep = m[2] || "";
        var cap = String(m[3] || "").replace(/^\s+|\s+$/g, "");
        if (/\.{4,}\s*\d+$/.test(cap)) continue;
        if (!sep && /^(?:shows?|showed|presents?|presented|summarizes?|summarized|lists?|reports?|reported|compares?|is|was|are|were|for|of|in|on|and|the|with|as|that|to)\b/.test(cap)) {
          continue;
        }
        var lowId = tid.toLowerCase();
        if (seen[lowId]) continue;
        seen[lowId] = true;
        var fullCap = cap ? (tid + ": " + cap) : tid;
        var win = text.slice(Math.max(0, m.index - 40), Math.min(text.length, m.index + 240));
        var numHits = (win.match(/\d+/g) || []).length;
        out.push({
          id: tid,
          caption: fullCap,
          page: list[p].n,
          score: Math.min(10, 2 + numHits),
          reason: "Found on thesis page " + (list[p].n != null ? list[p].n : (p + 1)) + " with study figures."
        });
        if (out.length >= 40) return out;
      }
    }
    return out;
  }

  function refIsCitedInText(ref, citedLow) {
    if (!citedLow) return true;
    if (ref.doi && citedLow.indexOf(String(ref.doi).toLowerCase()) >= 0) return true;
    if (ref.pmid && citedLow.indexOf(String(ref.pmid).toLowerCase()) >= 0) return true;
    var yr = String(ref.year || "");
    var authRaw = String(ref.authors || "").replace(/^\s*(?:\[\d+\]|\d+[.)])\s*/, "");
    var surname = (authRaw.match(/^([A-Za-z][A-Za-z\-']{1,30})/) || [])[1] || "";
    if (surname && surname.length >= 3 && yr) {
      var sLow = surname.toLowerCase();
      var idx = citedLow.indexOf(sLow);
      while (idx >= 0) {
        var win = citedLow.slice(Math.max(0, idx - 6), Math.min(citedLow.length, idx + sLow.length + 32));
        if (win.indexOf(yr) >= 0) return true;
        idx = citedLow.indexOf(sLow, idx + sLow.length);
      }
    }
    if (ref.numMarker && yr) {
      var nStr = String(ref.numMarker);
      var nNum = Number(nStr);
      var grpRe = /[\[\(](\d+(?:\s*[-,\u2013]\s*\d+)*)[\]\)]/g, gm;
      while ((gm = grpRe.exec(citedLow)) !== null) {
        var parts = gm[1].split(/\s*,\s*/);
        for (var pi = 0; pi < parts.length; pi++) {
          var rng = parts[pi].match(/^(\d+)\s*[-\u2013]\s*(\d+)$/);
          if (rng) {
            var lo = Number(rng[1]), hi = Number(rng[2]);
            if (isFinite(nNum) && hi >= lo && (hi - lo) <= 30 && nNum >= lo && nNum <= hi) return true;
          } else if (parts[pi].replace(/\s+/g, "") === nStr) {
            return true;
          }
        }
      }
      var supRe = /[.;!?](\d{1,3}(?:\s*[,\-\u2013]\s*\d{1,3})*)(?=\s|$)/g, sm;
      while ((sm = supRe.exec(citedLow)) !== null) {
        var sparts = sm[1].split(/\s*,\s*/);
        for (var si = 0; si < sparts.length; si++) {
          var srng = sparts[si].match(/^(\d+)\s*[-\u2013]\s*(\d+)$/);
          if (srng) {
            var slo = Number(srng[1]), shi = Number(srng[2]);
            if (isFinite(nNum) && shi >= slo && (shi - slo) <= 30 && nNum >= slo && nNum <= shi) return true;
          } else if (sparts[si].replace(/\s+/g, "") === nStr) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function extractThesisReferences(pages, opts) {
    opts = opts || {};
    var list = normalizePagesInput(pages);
    var refPages = (opts.refPages && opts.refPages.length) ? normalizePagesInput(opts.refPages) : null;
    if (!refPages) {
      var buckets = segmentThesisChapters(list);
      refPages = buckets.references.slice();
    }
    var p;
    if (!refPages.length) {
      for (p = Math.floor(list.length * 0.5); p < list.length; p++) {
        var t = String(list[p].text || "");
        if ((t.match(/\b(?:19|20)\d{2}\s*[;,]/g) || []).length >= 2) refPages.push(list[p]);
      }
    }
    var citedLow = opts.citedText ? String(opts.citedText).toLowerCase() : "";
    var rawCap = citedLow ? 500 : (opts.all ? 500 : 30);
    var out = [], seen = {}, lines, li, cur = "";
    function pushRef(raw) {
      var s = raw.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
      if (s.length < 24 || s.length > 700 || !/\b(19|20)\d{2}\b/.test(s)) return;
      if (/submitted\s+in\s+fulfilment|table\s+of\s+contents|doctor\s+of\s+philosophy/i.test(s)) return;
      if (!/[;:,]\s*\d+|doi:|pmid/i.test(s) && !/^\s*(?:\[\d+\]|\d+[.)])\s+/.test(s)) return;
      var numM = s.match(/^\s*\[?(\d{1,3})\]?[.)]\s+/);
      var k = s.slice(0, 60).toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      var AUTO = G && G.SMD_RESEARCH_THESIS_AUTO;
      if (AUTO && typeof AUTO.parseStructuredBibEntry === "function") {
        out.push(AUTO.parseStructuredBibEntry(s, numM ? numM[1] : ""));
        return;
      }
      var cleanBody = s.replace(/^\s*\[?\d{1,3}\]?[.)]\s+/, "");
      var doiM = cleanBody.match(/\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)\b/);
      var pmidM = cleanBody.match(/PMID\s*:?\s*(\d{5,9})/i);
      out.push({
        authors: cleanBody.split(/[.(]/)[0] || "",
        title: cleanBody,
        journal: "",
        year: (cleanBody.match(/\b((?:19|20)\d{2})\b/) || [])[1] || "",
        doi: doiM ? doiM[1].replace(/[.,;)]$/, "") : "",
        pmid: pmidM ? pmidM[1] : "",
        numMarker: numM ? numM[1] : "",
        raw: cleanBody
      });
    }
    for (p = 0; p < refPages.length && out.length < rawCap; p++) {
      lines = String(refPages[p].text || "").split(/\n+/);
      for (li = 0; li < lines.length && out.length < rawCap; li++) {
        var line = lines[li].replace(/^\s+|\s+$/g, "");
        if (!line || /^(References|Bibliography|List of references|\d+)$/i.test(line)) continue;
        var curIsOnlyNum = /^\s*\[?\d{1,3}\]?[.)]\s*$/.test(cur);
        if (/^(?:\[?\d+\]?[.)]\s*$|\[\d+\]\s+|\d+[.)]\s+|[A-Z][a-zA-Z\-']+,?\s+[A-Z]{1,3}\b)/.test(line) && cur && !curIsOnlyNum) {
          pushRef(cur);
          cur = line;
        } else {
          cur = cur ? (cur + " " + line) : line;
        }
      }
      if (cur) { pushRef(cur); cur = ""; }
    }
    if (opts.all) return out;
    if (citedLow && out.length) {
      var citedOnly = [];
      for (var ci = 0; ci < out.length; ci++) {
        if (refIsCitedInText(out[ci], citedLow)) citedOnly.push(out[ci]);
      }
      if (citedOnly.length) return citedOnly.slice(0, 40);
      return out.slice(0, 30);
    }
    return out.slice(0, 30);
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

  var memThesis = {};

  function loadThesis(pid) {
    var stored = {};
    try {
      if (typeof localStorage !== "undefined") {
        var all = JSON.parse(localStorage.getItem(THESIS_KEY) || "{}");
        stored = all[pid] || {};
      }
    } catch (e) { stored = {}; }
    if (memThesis[pid] && (!stored.pages || !stored.pages.length) && memThesis[pid].pages) {
      return memThesis[pid];
    }
    return stored;
  }

  function syncProjectJournal(pid, j) {
    if (!pid || !j || !SMD || !SMD.store) return;
    var jid = j.id ? String(j.id) : (j.custom ? "custom" : "default");
    var jname = String(j.shortName || j.name || "");
    if (typeof SMD.store.updateProject === "function") {
      SMD.store.updateProject(pid, { targetJournal: jid, targetJournalName: jname });
      return;
    }
    if (typeof SMD.store.getProject === "function") {
      var p = SMD.store.getProject(pid);
      if (p) { p.targetJournal = jid; p.targetJournalName = jname; }
    }
  }

  function saveThesis(pid, patch) {
    var base = loadThesis(pid);
    var cur = {}, k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) cur[k] = base[k];
    for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) cur[k] = patch[k];
    memThesis[pid] = cur;
    try {
      if (typeof localStorage !== "undefined") {
        var all = JSON.parse(localStorage.getItem(THESIS_KEY) || "{}");
        all[pid] = cur;
        try {
          localStorage.setItem(THESIS_KEY, JSON.stringify(all));
        } catch (qErr) {
          /* Evict heavy raw pages from older thesis entries if storage quota is full */
          var keys = Object.keys(all);
          for (var i = 0; i < keys.length; i++) {
            if (keys[i] !== pid && all[keys[i]] && all[keys[i]].pages) delete all[keys[i]].pages;
          }
          localStorage.setItem(THESIS_KEY, JSON.stringify(all));
        }
      }
    } catch (e) {}
    if (patch && patch.journal) syncProjectJournal(pid, patch.journal);
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

  function isTutorialProject(proj) {
    return !!(proj && proj.tutorial);
  }

  function cleanThesisTitle(filename, pages) {
    var f = String(filename || "").replace(/\.(pdf|docx?)$/i, "").replace(/[_\-]+/g, " ").replace(/\s{2,}/g, " ").replace(/^\s+|\s+$/g, "");
    if (f && f.length >= 6 && !/^thesis$/i.test(f)) return f.slice(0, 110);
    if (pages && pages.length && pages[0] && pages[0].text) {
      var lines = String(pages[0].text).split(/\n+/);
      for (var i = 0; i < Math.min(lines.length, 6); i++) {
        var s = lines[i].replace(/^\s+|\s+$/g, "");
        if (s.length >= 12 && s.length <= 120 && !/^(university|repository|chapter|abstract|table of contents)/i.test(s)) return s;
      }
    }
    return "Thesis to Journal Article";
  }

  function tutorialOwnGateHtml(curTs, heading) {
    var h = ['<div class="rmd-p2-screen rmd-thesis-screen"><div class="rmd-card rmd-thesis-real-gate">'];
    h.push('<h2>' + esc(heading || "Your own thesis is ready") + '</h2>');
    h.push('<p class="rmd-screen-subtitle">' + esc(curTs.filename || "Your uploaded thesis") + (curTs.pages && curTs.pages.length ? (' (' + curTs.pages.length + ' page(s))') : '') + '.</p>');
    h.push('<p class="rmd-thesis-meta" id="rmdThesisTutNote">Tutorial drafts are practice only. Start a real project so Ask MaiK drafts from your thesis.</p>');
    h.push('<div id="rmdThesisRealErr"></div>');
    h.push('<div class="rmd-card-actions">');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary" id="rmdThesisStartReal">Start a real project with this thesis</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle" id="rmdThesisReupload">Upload a different file</button>');
    h.push('</div></div></div>');
    return h.join("");
  }

  function startRealProjectFromThesis(container, sourceTutPid) {
    var btn = container.querySelector("#rmdThesisStartReal");
    var errBox = container.querySelector("#rmdThesisRealErr");
    var srcState = loadThesis(sourceTutPid);
    if (!SMD.api || !SMD.api.request || !SMD.store || !SMD.store.adoptServerProject) {
      if (errBox) errBox.innerHTML = '<div class="rmd-banner rmd-banner-warn">Sign in to start a real project. Your thesis text stays loaded on this device.</div>';
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = "Creating project..."; }
    if (errBox) errBox.innerHTML = "";
    var title = cleanThesisTitle(srcState.filename, srcState.pages);
    SMD.api.request("POST", "/v1/projects", {
      title: title,
      discipline: "medicine",
      specialty: "",
      studyType: "Thesis to Journal Article",
      researchQuestion: ""
    }).then(function (res) {
      var sp = (res && res.project) ? res.project : res;
      if (!sp || !sp.id) throw { message: "Could not create the real project on the server." };
      var created = SMD.store.adoptServerProject(sp);
      var newPid = (created && (created.serverId || created.id)) || sp.id;
      saveThesis(newPid, {
        pages: srcState.pages || null,
        filename: srcState.filename || "",
        phi: srcState.phi || null,
        phiConsent: srcState.phiConsent || null,
        ownUpload: true,
        isTutorialSample: false,
        paperType: null,
        checklist: null,
        journal: null,
        draft: null
      });
      saveThesis(sourceTutPid, { pages: null, filename: null, phi: null, phiConsent: null, ownUpload: false, isTutorialSample: false, draft: null });
      tpid = newPid;
      ts = loadThesis(newPid);
      if (SMD.tutorial && SMD.tutorial.clearCoachMessage) SMD.tutorial.clearCoachMessage();
      if (SMD.navigate) SMD.navigate("thesis-type", { projectId: created.id });
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = "Start a real project with this thesis"; }
      var msg = (SMD.p2 && SMD.p2.friendlyError) ? SMD.p2.friendlyError(err).message : ((err && err.message) || "Could not create a real project right now.");
      if (errBox) errBox.innerHTML = '<div class="rmd-banner rmd-banner-error" role="alert"><strong>' + esc(msg) + '</strong><span class="rmd-banner-sub">Your thesis text is still loaded here. Try again when ready.</span></div>';
    });
  }

  function bindTutorialOwnGate(container) {
    var startReal = container.querySelector("#rmdThesisStartReal");
    if (startReal) startReal.onclick = function () { startRealProjectFromThesis(container, tpid); };
    var re = container.querySelector("#rmdThesisReupload");
    if (re) re.onclick = function () {
      saveThesis(tpid, { pages: null, phi: null, phiConsent: null, artifactId: null, jobId: null, draft: null, ownUpload: false, isTutorialSample: false });
      ts = loadThesis(tpid);
      if (SMD.navigate) SMD.navigate("thesis");
      else renderUpload(container);
    };
  }

  function renderUpload(container) {
    var proj = activeProject();
    if (!proj) { container.innerHTML = SMD.p2.errHtml("Open a project first."); return; }
    tpid = pidOf(proj);
    ts = loadThesis(tpid);
    injectCSS();
    if (ts.pages && ts.pages.length && isTutorialProject(proj) && ts.ownUpload) {
      container.innerHTML = tutorialOwnGateHtml(ts, "Your own thesis is ready");
      bindTutorialOwnGate(container);
      return;
    }
    var h = ['<div class="rmd-p2-screen rmd-thesis-screen">'];
    if (ts.pages && ts.pages.length) {
      var AUTO = G && G.SMD_RESEARCH_THESIS_AUTO;
      var estCost = null;
      if (AUTO && typeof AUTO.estimateAutoCost === "function") {
        var estTree = ensureChapterTree();
        var estMap = mapChaptersToJournal(estTree, ts.pages, journalOf(), ts.paperType, ts.chapterMap || {});
        estCost = AUTO.estimateAutoCost(ts.pages, estMap, journalOf());
      }
      var hasAutoSaved = !!(ts.auto && ts.auto.steps && Object.keys(ts.auto.steps).length);
      var makeBtnLabel = (ts.auto && ts.auto.status === "stopped")
        ? "Continue journal paper"
        : (hasAutoSaved && (ts.auto.status === "review" || ts.auto.status === "approved")
          ? "Review journal paper"
          : "Make my journal paper");
      h.push('<div class="rmd-card">');
      h.push('<h2>Thesis read</h2>');
      h.push('<p class="rmd-screen-subtitle">' + esc(ts.filename || "Your thesis") + ' was read: ' + ts.pages.length + ' page(s). The text stays on this device and on our server; it is only sent to an AI provider when you ask MaiK to draft.</p>');
      if (!isTutorialProject(proj) && estCost) {
        h.push('<p class="rmd-thesis-meta" id="rmdThesisAutoEstimate">Estimated MaiK cost: about ' + esc(String(estCost.estimatedMaikTokens)) + ' MaiK tokens (' + esc(String(estCost.aiCalls)) + ' AI step' + (estCost.aiCalls === 1 ? '' : 's') + '). Charged only for steps that run and succeed.</p>');
      }
      if (ts.phi && ts.phi.softPages && ts.phi.softPages.length && !(ts.phiConsent && ts.phiConsent.confirmed)) {
        h.push('<p class="rmd-thesis-meta" id="rmdThesisConsentHint">We flagged pages ' + esc(ts.phi.softPages.join(", ")) + ' for a quick patient-details check before AI drafting.</p>');
      }
      h.push('<div class="rmd-card-actions">');
      if (!isTutorialProject(proj) && AUTO) {
        h.push('<button type="button" class="rmd-btn rmd-btn-primary" id="rmdMakeJournalPaper" data-rmd-thesis-auto="start">' + esc(makeBtnLabel) + '</button>');
      }
      h.push('<button type="button" class="rmd-btn' + ((!isTutorialProject(proj) && AUTO) ? '' : ' rmd-btn-primary') + '" data-rmd-thesis-next="thesis-type">' + ((!isTutorialProject(proj) && AUTO) ? 'Edit step by step' : 'Next: pick the paper type') + '</button>');
      if (ts.phi && ts.phi.softPages && ts.phi.softPages.length && !(ts.phiConsent && ts.phiConsent.confirmed)) {
        h.push('<button type="button" class="rmd-btn" id="rmdThesisOpenConsent">Check for patient details</button>');
      }
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle" id="rmdThesisReupload">Upload a different file</button>');
      h.push('</div>');
      h.push('</div>');
    } else {
      h.push('<div class="rmd-card">');
      h.push('<h2>Upload your thesis</h2>');
      h.push('<p class="rmd-screen-subtitle">' + (onDeviceOcrOn()
        ? 'Text and scanned pages are read on your phone.'
        : 'PDF or Word (.docx), up to 40 MB. Text and tables are read directly on your device; scanned PDFs use our OCR server.') + '</p>');
      h.push('<div class="rmd-field"><label for="rmdThesisFile">Thesis file</label>');
      h.push('<input type="file" id="rmdThesisFile" accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-word.document.12,application/docx,application/msword"></div>');
      h.push('<p class="rmd-thesis-meta">Supports PDF and Word (.docx) thesis files directly, including results tables.</p>');
      if (onDeviceOcrOn()) {
        var privLine = (G && G.SMD_RMD_JOBS && G.SMD_RMD_JOBS.DEVICE_PRIVACY_LINE) || "Runs on this device. Your PDFs and patient data are read here and never uploaded. Works offline.";
        h.push('<p class="rmd-thesis-meta">' + esc(privLine) + '</p>');
      }
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
      saveThesis(tpid, { pages: null, phi: null, phiConsent: null, artifactId: null, jobId: null, draft: null, ownUpload: false, isTutorialSample: false });
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
    var makeAuto = container.querySelector("#rmdMakeJournalPaper");
    if (makeAuto) makeAuto.onclick = function () {
      var curAuto = ts.auto || {};
      var alreadyReview = curAuto.status === "review" || curAuto.status === "approved";
      if (alreadyReview) {
        if (SMD.navigate) SMD.navigate("thesis-auto", {});
        return;
      }
      if (ts.phi && ts.phi.softPages && ts.phi.softPages.length && !(ts.phiConsent && ts.phiConsent.confirmed)) {
        openConsentSheet(ts.phi, {
          onConfirm: function () {
            if (SMD.navigate) SMD.navigate("thesis-auto", { autoStart: true });
          },
          onReupload: function () { renderUpload(container); }
        });
        return;
      }
      if (SMD.navigate) SMD.navigate("thesis-auto", { autoStart: true });
    };
  }

  function setMsg(container, html) {
    var box = container.querySelector("#rmdThesisMsg");
    if (box) box.innerHTML = html;
  }

  function uploadPdfServer(file, container, fallbackMeta) {
    var proj = activeProject();
    if (isTutorialProject(proj)) {
      saveThesis(tpid, { filename: file ? file.name : "Your thesis", ownUpload: true, isTutorialSample: false });
      ts = loadThesis(tpid);
      setMsg(container, '<div class="rmd-banner rmd-banner-warn">Tutorial drafts are practice only, and scanned-PDF server OCR needs a real project. Start a real project to read and draft from this thesis.</div><div class="rmd-card-actions" style="margin-top:8px;"><button type="button" class="rmd-btn rmd-btn-primary" id="rmdThesisStartReal">Start a real project with this thesis</button></div><div id="rmdThesisRealErr"></div>');
      bindTutorialOwnGate(container);
      return Promise.resolve(null);
    }
    if (!proj || !proj.serverId) {
      setMsg(container, '<div class="rmd-banner rmd-banner-warn">This PDF has no selectable text (scanned pages) and requires a synced account project for server OCR. Save this project to your account first, or upload a selectable-text PDF or Word (.docx) file.</div>');
      return Promise.resolve(null);
    }
    if (file.size > 26214400) {
      setMsg(container, '<div class="rmd-banner rmd-banner-warn">This scanned PDF has no selectable text and exceeds the 25 MB server OCR limit. Export a selectable-text PDF, upload a .docx file, or split this PDF under 25 MB.</div>');
      return Promise.resolve(null);
    }
    setMsg(container, SMD.p2.loadingHtml("Uploading your thesis"));
    var form = new FormData();
    form.append("file", file);
    if (fallbackMeta) {
      form.append("fallback", JSON.stringify(fallbackMeta));
    }
    return SMD.api.upload("/v1/projects/" + tpid + "/pdf-uploads", form).then(function (res) {
      var art = (res && res.artifact) || {};
      saveThesis(tpid, { artifactId: art.id, jobId: art.jobId, filename: art.filename || file.name, phi: null });
      ts = loadThesis(tpid);
      pollJob(art.jobId, 0, container);
      return art;
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
    var proj = activeProject();
    var own = (extra && typeof extra.ownUpload === "boolean") ? extra.ownUpload : true;
    var pLines = (extra && extra.pageLines) || (pages && pages._pageLines) || null;
    var tree = buildChapterTree(pLines, scanRes.pages);
    var patch = {
      pages: scanRes.pages,
      chapterTree: tree,
      chapterMap: {},
      sectionStatus: null,
      filename: filename,
      phi: phiInfo,
      phiConsent: null,
      ownUpload: own,
      isTutorialSample: !!(extra && extra.isTutorialSample),
      paperType: null,
      checklist: null,
      draft: null
    };
    if (extra) {
      if ("artifactId" in extra) patch.artifactId = extra.artifactId;
      if ("jobId" in extra) patch.jobId = extra.jobId;
    }
    saveThesis(tpid, patch);
    ts = loadThesis(tpid);
    renderUpload(container);
    if (scanRes.softPages.length && !(isTutorialProject(proj) && own)) {
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
        saveExtractedPages(pages, file.name, container, { artifactId: null, jobId: null, pageLines: pages && pages._pageLines });
      }).catch(function (err) {
        var msg = (err && err.message) ? err.message : "Could not read this Word (.docx) document. Export it as PDF and upload again.";
        setMsg(container, '<div class="rmd-banner rmd-banner-warn">' + esc(msg) + '</div>');
      });
      return;
    }
    // Try on-device PDF extraction first for real PDFs (works up to 40 MB and >60 pages, 0 tokens).
    // Tiny fixtures (< 100 bytes) or scanned image-only PDFs automatically fall back to server OCR.
    if (file.size >= 100 && (typeof file.arrayBuffer === "function" || typeof FileReader !== "undefined")) {
      var loadHtml = (SMD.p2 && SMD.p2.loadingHtml) ? SMD.p2.loadingHtml : function (t) { return t; };
      setMsg(container, loadHtml("Reading your thesis"));
      readPdfLocal(file, function (cur, tot) {
        setMsg(container, loadHtml("Reading page " + cur + " of " + tot));
      }).then(function (res) {
        if (res && res.pages && res.pages.length) {
          saveExtractedPages(res.pages, file.name, container, { artifactId: null, jobId: null, pageLines: res.pageLines });
          return;
        }
        var OD = G && G.SMD_RMD_ONDEVICE_PDF;
        var CP = G && G.SMD_RMD_CHECKPOINT;
        var JR = G && G.SMD_RMD_JOBS;
        function makeErr(code, msg) {
          var e = new Error(msg || code);
          e.code = code;
          return e;
        }
        function mergeCheckpoint(key, patch) {
          if (JR && typeof JR.updateCheckpoint === "function") {
            return JR.updateCheckpoint(CP, key, patch);
          }
          if (!CP || !key || typeof CP.get !== "function" || typeof CP.put !== "function") {
            return Promise.resolve();
          }
          return Promise.resolve().then(function () { return CP.get(key); }).then(function (cur) {
            var next = {};
            if (cur && typeof cur === "object") {
              for (var k in cur) {
                if (Object.prototype.hasOwnProperty.call(cur, k)) next[k] = cur[k];
              }
            }
            for (var p in patch) {
              if (Object.prototype.hasOwnProperty.call(patch, p)) next[p] = patch[p];
            }
            return CP.put(key, next);
          }).catch(function () {});
        }
        function handleFallbackError(err) {
          if (err && (err.name === "PasswordException" || err.code === "password")) {
            setMsg(container, '<div class="rmd-banner rmd-banner-warn">This PDF is password-protected. Save an unlocked copy (or export as Word .docx) and upload again.</div>');
            return;
          }
          if (err && (err.code === "aborted" || err.code === "cancelled" || err.rmdState === "data_problem" || err.rmdState === "offline")) {
            setMsg(container, '<div class="rmd-banner rmd-banner-warn">' + esc((err && err.message) || "Could not read this PDF on device.") + '</div>');
            return;
          }
          setMsg(container, '<div class="rmd-banner rmd-banner-warn">' + esc((err && err.message) || "Could not read this PDF.") + '</div>');
        }
        if (onDeviceOcrOn()) {
          setMsg(container, loadHtml("Reading scanned PDF on your phone"));
          var bytesP = (res && res.bytes)
            ? Promise.resolve(res.bytes)
            : readFileAsArrayBuffer(file).then(function (ab) { return new Uint8Array(ab); });
          return bytesP.then(function (u8) {
            return (OD && typeof OD.sha256 === "function" ? OD.sha256(u8) : Promise.resolve(null)).then(function (hash) {
              var ckKey = hash ? ("pdf:" + tpid + ":" + hash) : ("pdf:" + tpid + ":thesis");
              var canNativeOcr = !!(OD && typeof OD.hasNativeOcr === "function" && OD.hasNativeOcr() && typeof OD.extract === "function");
              function runOne(resumeCtx) {
                if (!canNativeOcr) {
                  return Promise.reject(makeErr("ocr-unavailable", "On-device OCR is unavailable on this device."));
                }
                var resume = (resumeCtx && resumeCtx.checkpoint) || null;
                return OD.extract(u8, {
                  sha256: hash,
                  resume: resume,
                  signal: resumeCtx && resumeCtx.signal,
                  /* A background page job paused by the phone is not the phone being slow. */
                  onNativeState: function (ns) {
                    if (resumeCtx && resumeCtx.holdClock) resumeCtx.holdClock(!!ns && ns.state === "paused");
                  },
                  onProgress: function (cur, tot) {
                    if (resumeCtx && resumeCtx.touchPage) resumeCtx.touchPage();
                    setMsg(container, loadHtml("Reading scanned page " + cur + " of " + tot + " on your phone"));
                  },
                  onPage: function (partial) {
                    if (CP && partial && (partial.sha256 || ckKey)) {
                      var key = partial.sha256 ? ("pdf:" + tpid + ":" + partial.sha256) : ckKey;
                      var patch = {
                        pages: partial.pages,
                        ocr: partial.ocr,
                        sha256: partial.sha256,
                        engine: partial.engine,
                        ocrEngine: partial.ocrEngine,
                        partial: partial.partial,
                        nextPage: partial.nextPage,
                        engineVersion: partial.engineVersion,
                        running: true,
                        finished: false
                      };
                      return mergeCheckpoint(key, patch);
                    }
                  }
                });
              }

              if (!JR || typeof JR.runWithFallback !== "function") {
                var resumeP = (CP && ckKey) ? CP.get(ckKey).catch(function () { return null; }) : Promise.resolve(null);
                return resumeP.then(function (saved) {
                  return runOne({ checkpoint: saved });
                }).then(function (result) {
                  var clearP = (CP && result && result.sha256)
                    ? CP.remove("pdf:" + tpid + ":" + result.sha256).catch(function () {})
                    : Promise.resolve();
                  return clearP.then(function () {
                    saveExtractedPages(result.pages, file.name, container, { artifactId: null, jobId: null });
                  });
                });
              }

              return JR.runWithFallback("pdf", runOne, function (cpIgnored, fallbackMeta) {
                return uploadPdfServer(file, container, fallbackMeta);
              }, {
                jobKey: ckKey,
                projectId: tpid,
                targetId: "thesis",
                engine: "ondevice:pdf",
                onStatus: function (info) {
                  if (info && info.state === "retrying" && info.message) {
                    setMsg(container, loadHtml(info.message));
                  }
                }
              }).then(function (out) {
                if (out && out.ok && out.source === "device") {
                  var result = out.result;
                  var clearP = (CP && result && result.sha256)
                    ? CP.remove("pdf:" + tpid + ":" + result.sha256).catch(function () {})
                    : Promise.resolve();
                  return clearP.then(function () {
                    saveExtractedPages(result.pages, file.name, container, { artifactId: null, jobId: null });
                  });
                }
                if (out && out.source !== "cloud" && out.message) {
                  setMsg(container, '<div class="rmd-banner">' + esc(out.message) + '</div>');
                }
              });
            });
          }).catch(handleFallbackError);
        }
        return uploadPdfServer(file, container);
      }).catch(function (err) {
        if (err && (err.name === "PasswordException" || err.code === "password")) {
          setMsg(container, '<div class="rmd-banner rmd-banner-warn">This PDF is password-protected. Save an unlocked copy (or export as Word .docx) and upload again.</div>');
          return;
        }
        if (onDeviceOcrOn()) {
          var JR2 = G && G.SMD_RMD_JOBS;
          if (JR2 && typeof JR2.runWithFallback === "function") {
            return JR2.runWithFallback("pdf", function () {
              var failErr = new Error((err && err.message) || "Failed to open PDF on this device");
              failErr.code = (err && err.code) || "pdf-open-failed";
              return Promise.reject(failErr);
            }, function (cpIgnored, fallbackMeta) {
              return uploadPdfServer(file, container, fallbackMeta);
            }, {
              jobKey: "pdf:" + tpid + ":thesis",
              projectId: tpid,
              targetId: "thesis",
              engine: "ondevice:pdf",
              onStatus: function (info) {
                if (info && info.state === "retrying" && info.message) {
                  setMsg(container, loadHtml(info.message));
                }
              }
            }).then(function (out) {
              if (out && out.source !== "cloud" && out.message) {
                setMsg(container, '<div class="rmd-banner">' + esc(out.message) + '</div>');
              }
            }).catch(function (fErr) {
              setMsg(container, '<div class="rmd-banner rmd-banner-warn">' + esc((fErr && fErr.message) || "Could not read this PDF.") + '</div>');
            });
          }
          setMsg(container, '<div class="rmd-banner rmd-banner-warn">' + esc((err && err.message) || "Could not read this PDF on device.") + '</div>');
          return;
        }
        return uploadPdfServer(file, container);
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
    if (isTutorialProject(proj) && ts.ownUpload) {
      container.innerHTML = tutorialOwnGateHtml(ts, "Start a real project to classify your thesis");
      bindTutorialOwnGate(container);
      return;
    }
    if (!ts.pages || !ts.pages.length) { needPagesHtml(container); return; }
    var sug = suggestPaperType(ts.pages && ts.pages.length ? ts.pages : allThesisText());
    var chosen = ts.paperType || sug.key;
    if (!ts.paperType) {
      saveThesis(tpid, { paperType: chosen, checklist: sug.checklist });
      if (SMD.setPreferredChecklist) SMD.setPreferredChecklist(tpid, sug.checklist);
      ts = loadThesis(tpid);
    }
    var h = ['<div class="rmd-p2-screen rmd-thesis-screen"><div class="rmd-card">'];
    h.push('<h2>Pick the paper type</h2>');
    h.push('<p class="rmd-screen-subtitle smd-books-keep">Suggested: <strong>' + esc(labelFor(sug.key)) + '</strong> (' + esc(sug.checklistName) + ').' + (sug.quote ? ' You can change it below.' : (' ' + esc(sug.why))) + '</p>');
    if (sug.quote) {
      h.push('<blockquote class="rmd-thesis-quote smd-books-keep" id="rmdThesisTypeQuote">' +
        (sug.page != null ? ('<strong>Page ' + esc(sug.page) + ':</strong> ') : '') +
        '"' + esc(sug.quote) + '"</blockquote>');
    }
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
      abstractLimit: isFinite(Number(j.abstractWordLimit != null ? j.abstractWordLimit : limits.abstract)) && Number(j.abstractWordLimit != null ? j.abstractWordLimit : limits.abstract) > 0 ? Number(j.abstractWordLimit != null ? j.abstractWordLimit : limits.abstract) : null,
      abstractFormat: af == null || af === "" ? null : String(af),
      referenceStyle: j.referenceStyle == null || j.referenceStyle === "" ? null : String(j.referenceStyle),
      maxReferences: isFinite(Number(j.maxReferences)) && Number(j.maxReferences) > 0 ? Number(j.maxReferences) : null,
      maxTables: isFinite(Number(j.maxTables)) && Number(j.maxTables) > 0 ? Number(j.maxTables) : null,
      maxFigures: isFinite(Number(j.maxFigures)) && Number(j.maxFigures) > 0 ? Number(j.maxFigures) : null,
      articleTypes: Array.isArray(j.articleTypes) ? j.articleTypes.slice() : [],
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
    if (t === "cohort") return "cohort";
    if (t === "case_control") return "case_control";
    if (t === "cross_sectional") return "cross_sectional";
    if (t === "diagnostic") return "diagnostic";
    if (t === "qualitative") return "qualitative";
    return "observational";
  }

  function abstractLimitOf(j) {
    if (j && isFinite(j.abstractLimit) && j.abstractLimit > 0) return j.abstractLimit;
    var af = j && j.abstractFormat ? String(j.abstractFormat) : "";
    var m = af.match(/(\d{2,4})\s*words?/i);
    if (m) {
      var n = parseInt(m[1], 10);
      if (isFinite(n) && n >= 50 && n <= 1000) return n;
    }
    return 250;
  }

  function journalFromCatalogue(j) {
    return {
      id: j.id,
      name: j.name,
      shortName: j.shortName,
      specialty: j.specialty || "",
      wordLimit: j.wordLimit == null ? DEFAULT_JOURNAL.wordLimit : j.wordLimit,
      abstractLimit: j.abstractLimit != null ? j.abstractLimit : abstractLimitOf(j),
      abstractFormat: j.abstractFormat || DEFAULT_JOURNAL.abstractFormat,
      referenceStyle: j.referenceStyle || "vancouver",
      maxReferences: j.maxReferences || 35,
      maxTables: j.maxTables || 4,
      maxFigures: j.maxFigures || 4,
      lineNumbers: typeof j.lineNumbers === "boolean" ? j.lineNumbers : true,
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

  function normJournalName(name) {
    return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/^\s+|\s+$/g, "");
  }

  function journalView(state) {
    var items = state.items || [], matches = state.matches || [], byId = {}, byName = {}, used = {}, usedNames = {}, out = [], i, j, key, nkey, cat;
    for (i = 0; i < items.length; i++) {
      byId[journalKey(items[i])] = items[i];
      nkey = normJournalName(items[i].name);
      if (nkey && !byName[nkey]) byName[nkey] = items[i];
    }
    for (i = 0; i < matches.length; i++) {
      j = matches[i];
      key = journalKey(j);
      nkey = normJournalName(j.name);
      cat = byId[key] || (nkey ? byName[nkey] : null);
      if (used[key] || (cat && used[journalKey(cat)]) || (nkey && usedNames[nkey])) continue;
      if (cat) {
        j = copyJournal(cat);
        j.matchScore = matches[i].matchScore;
        used[journalKey(cat)] = true;
      } else {
        j = copyJournal(j);
      }
      j._best = true;
      used[key] = true;
      if (nkey) usedNames[nkey] = true;
      out.push(j);
    }
    for (i = 0; i < items.length; i++) {
      key = journalKey(items[i]);
      nkey = normJournalName(items[i].name);
      if (used[key] || (nkey && usedNames[nkey])) continue;
      used[key] = true;
      if (nkey) usedNames[nkey] = true;
      j = copyJournal(items[i]);
      j._best = false;
      out.push(j);
    }
    return out;
  }

  function journalRowHtml(j) {
    var pressed = selectedJournalKey() === j.id;
    var meta = [];
    if (j.publisher) meta.push(j.publisher);
    if (j.specialty) meta.push(j.specialty);
    var missingCount = (j.wordLimit == null ? 1 : 0) + (!j.abstractFormat ? 1 : 0) + (!j.referenceStyle ? 1 : 0) + (!j.apcNote ? 1 : 0);
    var specs = [];
    if (j.wordLimit != null) specs.push('<span><b>Word limit:</b> ' + esc(fmtInt(j.wordLimit) + " words") + '</span>');
    else if (missingCount === 1) specs.push('<span><b>Word limit:</b> Check the author guidelines</span>');
    if (j.abstractFormat) specs.push('<span><b>Abstract:</b> ' + esc(j.abstractFormat) + '</span>');
    else if (missingCount === 1) specs.push('<span><b>Abstract:</b> Check the author guidelines</span>');
    if (j.referenceStyle) specs.push('<span><b>References:</b> ' + esc(styleName(j.referenceStyle)) + '</span>');
    else if (missingCount === 1) specs.push('<span><b>References:</b> Check the author guidelines</span>');
    var h = [];
    h.push('<li class="rmd-journal-item" data-selected="' + (pressed ? "true" : "false") + '">');
    h.push('<button type="button" class="rmd-journal-pick" data-rmd-journal-id="' + esc(j.id) + '" aria-pressed="' + (pressed ? "true" : "false") + '">');
    h.push('<span class="rmd-journal-head"><span class="rmd-journal-name">' + esc(j.name) + '</span><span class="rmd-journal-selected"' + (pressed ? "" : " hidden") + '>Selected</span></span>');
    if (meta.length) h.push('<span class="rmd-journal-meta">' + esc(meta.join(", ")) + '</span>');
    if (specs.length) h.push('<span class="rmd-journal-specs">' + specs.join("") + '</span>');
    if (j.apcNote) {
      h.push('<span class="rmd-journal-fee"><b>Fee:</b> ' + esc(j.apcNote) + '</span>');
    } else if (missingCount === 1) {
      h.push('<span class="rmd-journal-fee"><b>Fee:</b> Check the author guidelines</span>');
    }
    if (missingCount > 1 && !j.url && !specs.length) {
      h.push('<span class="rmd-journal-meta">Requirements: Check the author guidelines</span>');
    }
    h.push('</button>');
    if (j.url) {
      h.push('<a class="rmd-journal-link" href="' + esc(j.url) + '" target="_blank" rel="noopener noreferrer">Author guidelines</a>');
    } else if (missingCount > 1 && specs.length) {
      h.push('<span class="rmd-journal-link rmd-journal-link-missing">Author guidelines: Check the author guidelines</span>');
    } else if (missingCount <= 1) {
      h.push('<span class="rmd-journal-link rmd-journal-link-missing">Author guidelines: not on file</span>');
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
    if (isTutorialProject(proj) && ts.ownUpload) {
      container.innerHTML = tutorialOwnGateHtml(ts, "Start a real project to choose your target journal");
      bindTutorialOwnGate(container);
      return;
    }
    if (!ts.pages || !ts.pages.length) { needPagesHtml(container); return; }
    if (!proj.targetJournal && ts && ts.journal) syncProjectJournal(tpid, ts.journal);
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

  function totalThesisChars(pages) {
    var sum = 0, i;
    for (i = 0; i < (pages || []).length; i++) sum += String((pages[i] && pages[i].text) || "").length;
    return sum;
  }

  function extractSingleSectionText(res, sectionId) {
    var d = (res && res.draft !== undefined) ? res.draft : res;
    if (!d) return "";
    if (typeof d.text === "string" && d.text.replace(/^\s+|\s+$/g, "")) return d.text.replace(/^\s+|\s+$/g, "");
    var secs = d.sections || [], i;
    for (i = 0; i < secs.length; i++) {
      if (secs[i] && secs[i].id === sectionId && typeof secs[i].text === "string" && secs[i].text.replace(/^\s+|\s+$/g, "")) {
        return secs[i].text.replace(/^\s+|\s+$/g, "");
      }
    }
    for (i = 0; i < secs.length; i++) {
      var rawSec = (secs[i] && typeof secs[i].text === "string") ? secs[i].text.replace(/^\s+|\s+$/g, "") : "";
      if (rawSec) {
        var cleanSec = rawSec.replace(/^\s*#{1,4}\s*(?:Abstract|Introduction|Methods|Results|Discussion|Conclusion)\s*[:\-.]*\s*/i, "");
        if (cleanSec) return cleanSec;
      }
    }
    return "";
  }

  function setLiveDraftProgress(container, st, text, pct) {
    st.progressText = text;
    st.progressPct = pct;
    var pEl = container.querySelector(".rmd-ai-progress");
    if (pEl) pEl.textContent = text;
    var bar = container.querySelector(".rmd-ai-pbar > span");
    if (bar) bar.style.width = Math.max(4, Math.min(100, Math.round(pct || 0))) + "%";
  }

  function handleThesisAiError(err) {
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
  }

  function callThesisAi(reqSection, pages, budget, extraMeta) {
    var jr = journalOf();
    var inp = {
      pages: pages || [],
      filename: ts.filename || "",
      paperType: labelFor(ts.paperType || "obs"),
      checklist: ts.checklist || "strobe",
      journalId: jr.id || "",
      wordLimit: budget
    };
    if (reqSection) inp.section = reqSection;
    if (extraMeta && extraMeta.abstractLimit) inp.abstractLimit = extraMeta.abstractLimit;
    if (ts.phiConsent && ts.phiConsent.confirmed) inp.phiConsent = ts.phiConsent;
    return SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(tpid) + "/ai-draft", {
      task: "thesis_to_paper",
      input: inp
    }).catch(handleThesisAiError);
  }

  function ensureChapterTree() {
    if (ts.chapterTree && Array.isArray(ts.chapterTree.chapters) && ts.chapterTree.chapters.length) {
      return ts.chapterTree;
    }
    var pLines = (ts.pages && ts.pages._pageLines) || null;
    var tree = buildChapterTree(pLines, ts.pages || []);
    saveThesis(tpid, { chapterTree: tree });
    ts = loadThesis(tpid);
    return tree;
  }

  function draftOneSectionStep(step, onSubProgress) {
    var totalCostInr = 0;
    var totalAiCalls = 0;
    function prependHint(chunkPages, hint) {
      if (!hint || !chunkPages.length) return chunkPages;
      var out = [{ n: chunkPages[0].n, text: hint + String(chunkPages[0].text || "") }];
      for (var k = 1; k < chunkPages.length; k++) out.push(chunkPages[k]);
      return out;
    }
    function cleanSectionOutput(txt) {
      return String(txt || "")
        .replace(/^\s*#{1,4}\s*(?:Abstract|Introduction|Methods|Results|Discussion|Conclusion)\s*[:\-.]*\s*/i, "")
        .replace(/^\s+|\s+$/g, "");
    }
    function isHardQuotaErr(err) {
      var c = err && (err.code || (err.body && err.body.error && err.body.error.code));
      return err && (err._handledByConsent || err.status === 429 || err.status === 402 ||
        c === "project_ai_cap" || c === "user_ai_cap" || c === "insufficient_credits");
    }
    function trackedCall(reqSec, payloadPages, chunkBudget) {
      return callThesisAi(reqSec, payloadPages, chunkBudget).then(function (res) {
        totalAiCalls += 1;
        totalCostInr += Number((res && res.costInr) || 0);
        return res;
      });
    }
    function runOneChunk(reqSec, fallbackSec, hint, chunkPages, chunkBudget, allowFallback) {
      var payloadPages = prependHint(chunkPages, hint);
      return trackedCall(reqSec, payloadPages, chunkBudget).catch(function (err) {
        if (isHardQuotaErr(err)) throw err;
        var isBadSec = err && (err.status === 400 || err.code === "invalid_body");
        if (allowFallback && isBadSec && fallbackSec) {
          return trackedCall(fallbackSec, payloadPages, chunkBudget);
        }
        return trackedCall(reqSec, payloadPages, chunkBudget);
      }).then(function (res) {
        var txt = cleanSectionOutput(extractSingleSectionText(res, step.id));
        if (!txt) {
          return trackedCall(reqSec, payloadPages, chunkBudget);
        }
        return res;
      });
    }

    var pages = step.pages || [];
    if (!pages.length) {
      return Promise.resolve({ id: step.id, text: "", tables: [], references: [], model: "", aiCalls: 0, costInr: 0, skipped: true });
    }
    var chars = totalThesisChars(pages);
    if (chars <= 13000) {
      return runOneChunk(step.reqSection, step.fallbackSection, step.hint, pages, step.budget, true).then(function (res) {
        var d = (res && res.draft) ? res.draft : res;
        return {
          id: step.id,
          text: cleanSectionOutput(extractSingleSectionText(res, step.id)),
          tables: (d && (d.tables || d.suggestedTables)) || [],
          references: (d && d.references) || [],
          model: (res && res.model) || "",
          aiCalls: totalAiCalls,
          costInr: totalCostInr
        };
      });
    }

    /* Long chapters: split into <= 13,000-char sub-chunks (up to 4), condense in bounded parallel, then merge */
    var chunks = chunkPagesByChars(pages, 13000, 4);
    if (chunks.length <= 1) {
      var single = chunks[0] || pages.slice(0, 6);
      return runOneChunk(step.reqSection, step.fallbackSection, step.hint, single, step.budget, true).then(function (res) {
        var d = (res && res.draft) ? res.draft : res;
        return {
          id: step.id,
          text: cleanSectionOutput(extractSingleSectionText(res, step.id)),
          tables: (d && (d.tables || d.suggestedTables)) || [],
          references: (d && d.references) || [],
          model: (res && res.model) || "",
          aiCalls: totalAiCalls,
          costInr: totalCostInr
        };
      });
    }

    var subTasks = [];
    var subBudget = Math.max(220, Math.min(700, Math.round(step.budget * 0.9)));
    for (var ci = 0; ci < chunks.length; ci++) {
      (function (chunkPages, idx, total) {
        subTasks.push(function () {
          if (onSubProgress) onSubProgress(idx + 1, total);
          var subHint = "PART " + (idx + 1) + " OF " + total + " FOR " + step.heading.toUpperCase() +
            ": Extract and condense the key points for " + step.heading +
            ". Keep the author's wording, preserve in-text citation markers (such as [1] or (Author, Year)), and copy all exact numbers, statistics and table names verbatim.\n\n";
          return runOneChunk(step.reqSection, step.fallbackSection, subHint, chunkPages, subBudget, true);
        });
      })(chunks[ci], ci, chunks.length);
    }

    return runBoundedPool(subTasks, 3).then(function (subResults) {
      var notes = [], subTables = [], subRefs = [], lastMod = "";
      for (var si = 0; si < subResults.length; si++) {
        var sr = subResults[si];
        if (!sr || !sr.ok) {
          if (sr && sr.error && isHardQuotaErr(sr.error)) throw sr.error;
          continue;
        }
        var res = sr.value;
        if (res && res.model) lastMod = res.model;
        var d = (res && res.draft) ? res.draft : res;
        if (d) {
          if (Array.isArray(d.tables || d.suggestedTables)) subTables = subTables.concat(d.tables || d.suggestedTables);
          if (Array.isArray(d.references)) subRefs = subRefs.concat(d.references);
        }
        var txt = cleanSectionOutput(extractSingleSectionText(res, step.id));
        if (txt) notes.push({ n: chunks[si][0] ? chunks[si][0].n : 1, text: txt });
      }
      if (!notes.length) {
        throw new Error("All sub-chunks failed for " + step.heading);
      }
      if (notes.length === 1 && countWords(notes[0].text) <= step.budget) {
        return { id: step.id, text: notes[0].text, tables: subTables, references: subRefs, model: lastMod, aiCalls: totalAiCalls, costInr: totalCostInr };
      }
      function joinNotesFallback(notesArr, budget) {
        var raw = [];
        for (var ni = 0; ni < notesArr.length; ni++) {
          if (notesArr[ni] && notesArr[ni].text) raw.push(notesArr[ni].text);
        }
        var joined = raw.join("\n\n").replace(/^\s+|\s+$/g, "");
        if (!joined) return "";
        var words = joined.split(/\s+/);
        if (words.length <= budget) return joined;
        var cut = words.slice(0, budget).join(" ");
        var endDot = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
        return (endDot > cut.length * 0.5 ? cut.slice(0, endDot + 1) : (cut + "."))
          .replace(/^\s+|\s+$/g, "");
      }
      var mergeHint = step.hint + "MERGE INSTRUCTION: Combine these " + notes.length +
        " part summaries into one cohesive " + step.heading + " section strictly within " + step.budget +
        " words. Respond with compact valid JSON {\"text\":\"...\"} and copy every exact number verbatim.\n\n";
      return runOneChunk(step.reqSection, step.fallbackSection, mergeHint, notes, step.budget, true).then(function (mRes) {
        var md = (mRes && mRes.draft) ? mRes.draft : mRes;
        if (md) {
          if (Array.isArray(md.tables || md.suggestedTables)) subTables = subTables.concat(md.tables || md.suggestedTables);
          if (Array.isArray(md.references)) subRefs = subRefs.concat(md.references);
        }
        var mergedTxt = cleanSectionOutput(extractSingleSectionText(mRes, step.id));
        if (!mergedTxt) mergedTxt = joinNotesFallback(notes, step.budget);
        return {
          id: step.id,
          text: mergedTxt,
          tables: subTables,
          references: subRefs,
          model: (mRes && mRes.model) || lastMod,
          aiCalls: totalAiCalls,
          costInr: totalCostInr
        };
      }, function (mErr) {
        if (isHardQuotaErr(mErr)) throw mErr;
        return {
          id: step.id,
          text: joinNotesFallback(notes, step.budget),
          tables: subTables,
          references: subRefs,
          model: lastMod,
          aiCalls: totalAiCalls,
          costInr: totalCostInr
        };
      });
    });
  }

  function buildSectionPlan(allPages, jr, mapping) {
    var mainLimit = jr.wordLimit || 3000;
    var buckets = mapping.bySection;
    var introBucket = buckets.introduction || { pages: [], reviewPages: [] };
    var methodsBucket = buckets.methods || { pages: [] };
    var resultsBucket = buckets.results || { pages: [], tables: [] };
    var discBucket = buckets.discussion || { pages: [] };
    var concBucket = buckets.conclusion || { pages: [] };

    /* If thesis had no conclusion chapter at all (not explicitly excluded), use tail of discussion + front summary */
    var concExcludedByUser = (mapping.excluded || []).some(function (x) {
      return /conclu|summary/i.test(x.title || "") && x.reason === "Excluded by user";
    });
    var concPages = concBucket.pages.slice();
    if (!concPages.length && !concExcludedByUser) {
      var tail = discBucket.pages.slice(-Math.min(6, discBucket.pages.length));
      var headSum = (buckets.abstract && buckets.abstract.pages || []).slice(0, Math.min(4, (buckets.abstract && buckets.abstract.pages || []).length));
      concPages = headSum.concat(tail);
    }

    var introHint = "SECTION INSTRUCTION: Condense the thesis introduction and aims into a crisp background and rationale, keeping the author's wording and exact citation markers (e.g. [1]).\n\n";
    if (introBucket.reviewPages && introBucket.reviewPages.length) {
      introHint = "SECTION INSTRUCTION: Condense the Review of Literature into the 3 to 5 most relevant points with their exact citation markers (e.g. [1]), combined with the thesis introduction and aims.\n\n";
    }
    var resTables = (resultsBucket.tables && resultsBucket.tables.length) ? resultsBucket.tables : extractThesisTables(resultsBucket.pages);
    var resHint = "SECTION INSTRUCTION: Report key participant numbers, primary and secondary outcomes and statistics copied verbatim from the thesis.\n\n";
    if (resTables.length) {
      var tIds = [];
      for (var ti = 0; ti < resTables.length && ti < 8; ti++) tIds.push(resTables[ti].id);
      resHint = "SECTION INSTRUCTION: Report key participant numbers, primary and secondary outcomes and statistics copied verbatim from the thesis, referencing thesis tables (" + tIds.join(", ") + ") where applicable.\n\n";
    }

    return [
      { id: "introduction", heading: "Introduction", reqSection: "introduction", pages: introBucket.pages, budget: Math.max(250, Math.round(mainLimit * 0.18)), hint: introHint },
      { id: "methods", heading: "Methods", reqSection: "methods", pages: methodsBucket.pages, budget: Math.max(300, Math.round(mainLimit * 0.25)), hint: "SECTION INSTRUCTION: Summarize study design, setting, participants, interventions or exposures, outcomes and statistical methods with exact figures and citation markers from the thesis.\n\n" },
      { id: "results", heading: "Results", reqSection: "results", pages: resultsBucket.pages, budget: Math.max(350, Math.round(mainLimit * 0.30)), hint: resHint },
      { id: "discussion", heading: "Discussion", reqSection: "discussion", pages: discBucket.pages, budget: Math.max(250, Math.round(mainLimit * 0.20)), hint: "SECTION INSTRUCTION: Synthesize main findings, comparison with prior studies (preserving citation markers like [1]), strengths and limitations from the thesis.\n\n" },
      { id: "conclusion", heading: "Conclusion", reqSection: "conclusion", fallbackSection: "discussion", pages: concPages, budget: Math.max(80, Math.min(180, Math.round(mainLimit * 0.08))), hint: "CONCLUSION SECTION ONLY: Write 2 to 4 concise clinical sentences stating the primary conclusion and practical implication strictly from these thesis conclusion pages.\n\n" }
    ];
  }

  function orchestrateThesisDraft(container, st, projIgnored, opts) {
    opts = opts || {};
    ts = loadThesis(tpid);
    var jr = journalOf();
    var mainLimit = jr.wordLimit || 3000;
    var absLimit = abstractLimitOf(jr);
    var allPages = ts.pages || [];
    var chars = totalThesisChars(allPages);
    var overrides = ts.chapterMap || {};
    var hasOverrides = Object.keys(overrides).length > 0;

    /* Fast path for short fixtures / tutorial sample (<= 13,500 chars) without manual chapter overrides */
    if (chars <= 13500 && !hasOverrides) {
      return callThesisAi(null, allPages, mainLimit, { abstractLimit: absLimit }).then(function (res) {
        if (res && res.draft) {
          res.draft._aiCalls = 1;
          res.draft._costInr = Number(res.costInr || 0);
        }
        return res;
      });
    }

    var tree = ensureChapterTree();
    var mapping = mapChaptersToJournal(tree, allPages, jr, ts.paperType, overrides);
    var plan = buildSectionPlan(allPages, jr, mapping);
    var resultsMap = {}, serverTables = [], serverRefs = [], missingSecs = [], lastModel = "";
    var totalAiCalls = 0, totalCostInr = 0, hardErr = null, stoppedByUser = false;
    var sectionStatus = {};
    var prevStatus = (opts.resume && ts.sectionStatus) || {};
    var prevSecs = (opts.resume && ts.draft && Array.isArray(ts.draft.sections)) ? ts.draft.sections : [];
    var prevTextById = {};
    for (var ps = 0; ps < prevSecs.length; ps++) {
      if (prevSecs[ps] && prevSecs[ps].id) prevTextById[prevSecs[ps].id] = prevSecs[ps].text || "";
    }
    for (var s0 = 0; s0 < SECTION_ORDER.length; s0++) {
      var sId0 = SECTION_ORDER[s0].id;
      var psRec = prevStatus[sId0];
      if (opts.resume && psRec && psRec.status === "done" && countWords(prevTextById[sId0]) > 0) {
        resultsMap[sId0] = prevTextById[sId0];
        sectionStatus[sId0] = {
          status: "done",
          heading: SECTION_ORDER[s0].heading,
          words: countWords(prevTextById[sId0]),
          aiCalls: Number(psRec.aiCalls || 0),
          costInr: Number(psRec.costInr || 0)
        };
      } else {
        sectionStatus[sId0] = { status: "queued", heading: SECTION_ORDER[s0].heading, words: 0 };
      }
    }

    function mergeTables(resTables) {
      var list = (resTables || []).slice();
      for (var ti = 0; ti < list.length; ti++) serverTables.push(list[ti]);
    }

    function mergeRefs(resRefs) {
      var list = (resRefs || []).slice();
      for (var ri = 0; ri < list.length; ri++) serverRefs.push(list[ri]);
    }

    function updateProgressivePreview() {
      var preview = [], draftedNow = [], s;
      for (s = 0; s < SECTION_ORDER.length; s++) {
        var sid = SECTION_ORDER[s].id;
        var raw = resultsMap[sid] || "";
        var ver = raw ? verifyNumbers(raw, allPages).text : "";
        preview.push({ id: sid, heading: SECTION_ORDER[s].heading, text: ver });
        if (countWords(ver) > 0) draftedNow.push(sid);
      }
      var doneCount = 0;
      for (var k in sectionStatus) {
        if (Object.prototype.hasOwnProperty.call(sectionStatus, k) &&
            (sectionStatus[k].status === "done" || sectionStatus[k].status === "failed" || sectionStatus[k].status === "skipped")) {
          doneCount++;
        }
      }
      setLiveDraftProgress(container, st,
        "Drafted " + doneCount + " of 6 sections (parallel)",
        Math.round((doneCount / 6) * 90));
      saveThesis(tpid, {
        sectionStatus: sectionStatus,
        draft: {
          sections: preview,
          aiDraftedIds: draftedNow,
          flags: [],
          locators: [],
          tables: extractThesisTables(mapping.bySection.results.pages.length ? mapping.bySection.results.pages : allPages),
          references: extractThesisReferences(allPages, { refPages: mapping.bySection.references.pages }),
          excludedChapters: mapping.excluded,
          words: 0,
          trimmed: false
        }
      });
      ts = loadThesis(tpid);
      if (opts.onProgress) opts.onProgress({ sectionStatus: sectionStatus, doneCount: doneCount, aiCalls: totalAiCalls, costInr: totalCostInr });
      renderSectionProgress(container);
      renderDraftBody(container);
    }

    setLiveDraftProgress(container, st, "Drafting sections in parallel (3 at a time)...", 8);
    saveThesis(tpid, { sectionStatus: sectionStatus });
    ts = loadThesis(tpid);
    renderSectionProgress(container);

    var mainTasks = [];
    for (var idx = 0; idx < plan.length; idx++) {
      (function (step) {
        mainTasks.push(function () {
          if (hardErr) return null;
          if (opts.resume && resultsMap[step.id] && sectionStatus[step.id] && sectionStatus[step.id].status === "done") {
            return null;
          }
          if (opts.shouldStop && opts.shouldStop()) {
            stoppedByUser = true;
            sectionStatus[step.id] = { status: "stopped", heading: step.heading, words: 0 };
            updateProgressivePreview();
            return null;
          }
          if (!step.pages || !step.pages.length) {
            sectionStatus[step.id] = { status: "skipped", heading: step.heading, words: 0 };
            updateProgressivePreview();
            return null;
          }
          sectionStatus[step.id] = { status: "running", heading: step.heading, words: 0 };
          saveThesis(tpid, { sectionStatus: sectionStatus });
          ts = loadThesis(tpid);
          if (opts.onProgress) opts.onProgress({ sectionStatus: sectionStatus, aiCalls: totalAiCalls, costInr: totalCostInr });
          renderSectionProgress(container);

          return draftOneSectionStep(step, function (part, totalParts) {
            sectionStatus[step.id] = { status: "running", heading: step.heading, detail: "part " + part + "/" + totalParts, words: 0 };
            if (opts.onProgress) opts.onProgress({ sectionStatus: sectionStatus, aiCalls: totalAiCalls, costInr: totalCostInr });
            renderSectionProgress(container);
          }).then(function (out) {
            if (out.model) lastModel = out.model;
            totalAiCalls += Number(out.aiCalls || 0);
            totalCostInr += Number(out.costInr || 0);
            mergeTables(out.tables);
            mergeRefs(out.references);
            if (out.text) {
              resultsMap[step.id] = out.text;
              sectionStatus[step.id] = { status: "done", heading: step.heading, words: countWords(out.text), aiCalls: out.aiCalls || 0, costInr: out.costInr || 0 };
            } else {
              missingSecs.push(step.heading);
              sectionStatus[step.id] = { status: "failed", heading: step.heading, words: 0, aiCalls: 0, costInr: 0 };
            }
            updateProgressivePreview();
            return out;
          }).catch(function (err) {
            var c = err && (err.code || (err.body && err.body.error && err.body.error.code));
            if (err && (err._handledByConsent || err.status === 429 || err.status === 402 || c === "project_ai_cap" || c === "user_ai_cap" || c === "insufficient_credits")) {
              hardErr = err;
              throw err;
            }
            missingSecs.push(step.heading);
            sectionStatus[step.id] = { status: "failed", heading: step.heading, words: 0, aiCalls: 0, costInr: 0 };
            updateProgressivePreview();
            return null;
          });
        });
      })(plan[idx]);
    }

    return runBoundedPool(mainTasks, 3).then(function () {
      if (hardErr) throw hardErr;
      if (opts.resume && resultsMap.abstract && sectionStatus.abstract && sectionStatus.abstract.status === "done") {
        return null;
      }
      if (stoppedByUser || (opts.shouldStop && opts.shouldStop())) {
        stoppedByUser = true;
        sectionStatus.abstract = { status: "stopped", heading: "Abstract", words: 0 };
        updateProgressivePreview();
        return null;
      }
      sectionStatus.abstract = { status: "running", heading: "Abstract", words: 0 };
      saveThesis(tpid, { sectionStatus: sectionStatus });
      ts = loadThesis(tpid);
      if (opts.onProgress) opts.onProgress({ sectionStatus: sectionStatus, aiCalls: totalAiCalls, costInr: totalCostInr });
      renderSectionProgress(container);
      setLiveDraftProgress(container, st, "Drafting Abstract (structured summary)", 88);

      var frontPages = (mapping.bySection.abstract && mapping.bySection.abstract.pages) || [];
      var frontChunks = chunkPagesByChars(frontPages, 6500, 1);
      var absPages = (frontChunks[0] || []).slice();
      var summarySnip = [];
      if (resultsMap.methods) summarySnip.push("Drafted Methods summary: " + resultsMap.methods.slice(0, 1600));
      if (resultsMap.results) summarySnip.push("Drafted Results summary: " + resultsMap.results.slice(0, 2200));
      if (resultsMap.conclusion) summarySnip.push("Drafted Conclusion summary: " + resultsMap.conclusion.slice(0, 800));
      if (summarySnip.length) {
        absPages.push({ n: 1, text: summarySnip.join("\n\n") });
      }
      if (!absPages.length) absPages = allPages.slice(0, 4);
      var absStep = {
        id: "abstract",
        heading: "Abstract",
        reqSection: "abstract",
        pages: absPages,
        budget: absLimit,
        hint: "STRUCTURED ABSTRACT ONLY (" + absLimit + " words max): Use exact headings Background:, Methods:, Results:, Conclusion: and copy numbers verbatim from the thesis.\n\n"
      };
      return draftOneSectionStep(absStep).then(function (out) {
        if (out.model) lastModel = out.model;
        totalAiCalls += Number(out.aiCalls || 0);
        totalCostInr += Number(out.costInr || 0);
        if (out.text) {
          resultsMap.abstract = out.text;
          sectionStatus.abstract = { status: "done", heading: "Abstract", words: countWords(out.text), aiCalls: out.aiCalls || 0, costInr: out.costInr || 0 };
        } else {
          missingSecs.push("Abstract");
          sectionStatus.abstract = { status: "failed", heading: "Abstract", words: 0, aiCalls: 0, costInr: 0 };
        }
      }).catch(function (err) {
        var c = err && (err.code || (err.body && err.body.error && err.body.error.code));
        if (err && (err._handledByConsent || err.status === 429 || err.status === 402 || c === "project_ai_cap" || c === "user_ai_cap" || c === "insufficient_credits")) {
          throw err;
        }
        missingSecs.push("Abstract");
        sectionStatus.abstract = { status: "failed", heading: "Abstract", words: 0, aiCalls: 0, costInr: 0 };
      });
    }).then(function () {
      var resSourcePages = mapping.bySection.results.pages.length ? mapping.bySection.results.pages : allPages;
      var detTables = extractThesisTables(resSourcePages);
      if (!detTables.length) detTables = extractThesisTables(allPages);
      var combinedTables = detTables.length ? detTables : serverTables;
      var citedMainText = [
        resultsMap.introduction || "",
        resultsMap.methods || "",
        resultsMap.results || "",
        resultsMap.discussion || "",
        resultsMap.conclusion || ""
      ].join("\n\n");
      var detRefs = extractThesisReferences(allPages, {
        refPages: mapping.bySection.references.pages,
        citedText: citedMainText
      });
      var combinedRefs = detRefs.length ? detRefs : serverRefs;
      var outSecs = [];
      for (var j = 0; j < SECTION_ORDER.length; j++) {
        var sid = SECTION_ORDER[j].id;
        outSecs.push({ id: sid, heading: SECTION_ORDER[j].heading, text: resultsMap[sid] || "" });
      }
      return {
        draft: {
          sections: outSecs,
          tables: combinedTables,
          references: combinedRefs,
          excludedChapters: mapping.excluded,
          _sectionStatus: sectionStatus,
          _missingSections: missingSecs,
          _aiCalls: totalAiCalls,
          _costInr: totalCostInr,
          _stopped: stoppedByUser
        },
        model: lastModel,
        costInr: totalCostInr,
        stopped: stoppedByUser
      };
    });
  }

  function retrySingleSection(container, sectionId) {
    ts = loadThesis(tpid);
    var jr = journalOf();
    var allPages = ts.pages || [];
    if (!allPages.length) return Promise.resolve(false);
    var tree = ensureChapterTree();
    var mapping = mapChaptersToJournal(tree, allPages, jr, ts.paperType, ts.chapterMap || {});
    var step = null;
    if (sectionId === "abstract") {
      var absLimit = abstractLimitOf(jr);
      var frontChunks = chunkPagesByChars((mapping.bySection.abstract && mapping.bySection.abstract.pages) || [], 6500, 1);
      var absPages = (frontChunks[0] || []).slice();
      var existing = (ts.draft && ts.draft.sections) || [];
      var secTextById = {};
      for (var ei = 0; ei < existing.length; ei++) secTextById[existing[ei].id] = existing[ei].text || "";
      var snip = [];
      if (secTextById.methods) snip.push("Drafted Methods summary: " + secTextById.methods.slice(0, 1600));
      if (secTextById.results) snip.push("Drafted Results summary: " + secTextById.results.slice(0, 2200));
      if (secTextById.conclusion) snip.push("Drafted Conclusion summary: " + secTextById.conclusion.slice(0, 800));
      if (snip.length) absPages.push({ n: 1, text: snip.join("\n\n") });
      if (!absPages.length) absPages = allPages.slice(0, 4);
      step = {
        id: "abstract",
        heading: "Abstract",
        reqSection: "abstract",
        pages: absPages,
        budget: absLimit,
        hint: "STRUCTURED ABSTRACT ONLY (" + absLimit + " words max): Use exact headings Background:, Methods:, Results:, Conclusion: and copy numbers verbatim from the thesis.\n\n"
      };
    } else {
      var plan = buildSectionPlan(allPages, jr, mapping);
      for (var pi = 0; pi < plan.length; pi++) {
        if (plan[pi].id === sectionId) { step = plan[pi]; break; }
      }
    }
    if (!step) return Promise.resolve(false);

    var sectionStatus = ts.sectionStatus || {};
    sectionStatus[sectionId] = { status: "running", heading: step.heading, words: 0 };
    saveThesis(tpid, { sectionStatus: sectionStatus });
    ts = loadThesis(tpid);
    renderSectionProgress(container);

    return draftOneSectionStep(step).then(function (out) {
      ts = loadThesis(tpid);
      var curDraft = ts.draft || { sections: [], aiDraftedIds: [], flags: [], locators: [], tables: [], references: [], words: 0 };
      var curSecs = (curDraft.sections && curDraft.sections.length) ? curDraft.sections.slice() : SECTION_ORDER.map(function (s) {
        return { id: s.id, heading: s.heading, text: "" };
      });
      var replaced = false;
      for (var i = 0; i < curSecs.length; i++) {
        if (curSecs[i].id === sectionId) {
          curSecs[i] = { id: sectionId, heading: step.heading, text: out.text || "" };
          replaced = true;
          break;
        }
      }
      if (!replaced) curSecs.push({ id: sectionId, heading: step.heading, text: out.text || "" });
      var nextStatus = ts.sectionStatus || {};
      if (out.text) {
        nextStatus[sectionId] = { status: "done", heading: step.heading, words: countWords(out.text) };
      } else {
        nextStatus[sectionId] = { status: "failed", heading: step.heading, words: 0 };
      }
      saveThesis(tpid, { sectionStatus: nextStatus });
      ts = loadThesis(tpid);
      if (draftAi) draftAi.error = null;
      applyDraft({
        sections: curSecs,
        tables: curDraft.tables,
        references: curDraft.references,
        excludedChapters: mapping.excluded,
        _sectionStatus: nextStatus
      }, draftAi);
      renderDraft(container);
      return !!out.text;
    }).catch(function (err) {
      if (err && err._handledByConsent) {
        openConsentSheet(err._phiConsentInfo || (ts && ts.phi) || { softPages: [1], maskedCount: 0, findings: [] }, {
          onConfirm: function () { retrySingleSection(container, sectionId); },
          onReupload: function () { if (SMD.navigate) SMD.navigate("thesis"); }
        });
        return false;
      }
      var nextStatus = ts.sectionStatus || {};
      nextStatus[sectionId] = { status: "failed", heading: step.heading, words: 0 };
      saveThesis(tpid, { sectionStatus: nextStatus });
      ts = loadThesis(tpid);
      renderDraft(container);
      return false;
    });
  }

  function renderChapterMapBox(container) {
    var box = container.querySelector("#rmdChapterMap");
    if (!box) return;
    var tree = ensureChapterTree();
    if (!tree || !tree.chapters || !tree.chapters.length) {
      box.innerHTML = "";
      return;
    }
    var jr = journalOf();
    var mapping = mapChaptersToJournal(tree, ts.pages || [], jr, ts.paperType, ts.chapterMap || {});
    var items = mapping.items || [];
    var frontItems = [], mainItems = [], i;
    for (i = 0; i < items.length; i++) {
      if (items[i].isFrontMatter && items[i].target === "excluded") frontItems.push(items[i]);
      else mainItems.push(items[i]);
    }
    var mappedCount = 0;
    for (i = 0; i < items.length; i++) if (items[i].target !== "excluded") mappedCount++;
    var excludedCount = mapping.excluded.length;
    var isOpen = ts.chapterMapOpen === true;

    var h = [];
    h.push('<div class="rmd-chapter-map-head">');
    h.push('<div class="rmd-chapter-map-summary"><strong>Thesis chapters</strong>');
    h.push('<span class="rmd-thesis-meta">' + mappedCount + ' chapter(s) mapped to ' + esc(jr.shortName || jr.name) + (excludedCount ? (', ' + excludedCount + ' excluded') : '') + '.</span></div>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-chapter-toggle" id="rmdChapterMapToggle" aria-expanded="' + (isOpen ? "true" : "false") + '" aria-controls="rmdChapterMapList">' + (isOpen ? "Hide chapters" : "Adjust mapping") + '</button>');
    h.push('</div>');

    if (mapping.excluded.length) {
      var exNames = [];
      for (i = 0; i < mapping.excluded.length && i < 6; i++) {
        exNames.push(mapping.excluded[i].title + " (p. " + mapping.excluded[i].startPage + (mapping.excluded[i].endPage !== mapping.excluded[i].startPage ? ("-" + mapping.excluded[i].endPage) : "") + ")");
      }
      if (mapping.excluded.length > 6) exNames.push("+" + (mapping.excluded.length - 6) + " more");
      h.push('<p class="rmd-thesis-meta" id="rmdExcludedSummary">Excluded: ' + esc(exNames.join("; ")) + '.</p>');
    }

    h.push('<div class="rmd-chapter-list" id="rmdChapterMapList"' + (isOpen ? '' : ' hidden') + '>');
    var displayItems = mainItems.length ? mainItems : items;
    if (frontItems.length && mainItems.length) {
      var fStart = frontItems[0].startPage;
      var fEnd = frontItems[frontItems.length - 1].endPage;
      h.push('<div class="rmd-chapter-row rmd-chapter-row-muted">');
      h.push('<div class="rmd-chapter-info"><span class="rmd-chapter-title">Front matter (' + frontItems.length + ' parts)</span><span class="rmd-thesis-meta">Pages ' + esc(fStart + " to " + fEnd) + ' - skipped automatically</span></div>');
      h.push('<span class="rmd-chapter-pill">Excluded</span>');
      h.push('</div>');
    }
    var opts = [
      { v: "introduction", l: "Introduction" },
      { v: "methods", l: "Methods" },
      { v: "results", l: "Results" },
      { v: "discussion", l: "Discussion" },
      { v: "conclusion", l: "Conclusion" },
      { v: "references", l: "References" },
      { v: "excluded", l: "Exclude" }
    ];
    for (i = 0; i < displayItems.length; i++) {
      var it = displayItems[i];
      var pgSpan = it.startPage === it.endPage ? ("Page " + it.startPage) : ("Pages " + it.startPage + " to " + it.endPage);
      h.push('<div class="rmd-chapter-row">');
      h.push('<div class="rmd-chapter-info">');
      h.push('<label class="rmd-chapter-title" for="rmdChSel_' + esc(it.id) + '">' + esc(it.title) + '</label>');
      h.push('<span class="rmd-thesis-meta">' + esc(pgSpan) + (it.condenseReview ? ' - condensed to 3-5 points' : '') + '</span>');
      h.push('</div>');
      h.push('<select class="rmd-chapter-select" id="rmdChSel_' + esc(it.id) + '" data-rmd-chapter-id="' + esc(it.id) + '">');
      if (it.canAutoSplit) {
        h.push('<option value="auto"' + (it.target === "auto" ? " selected" : "") + '>Auto (by subheadings)</option>');
      }
      for (var oi = 0; oi < opts.length; oi++) {
        h.push('<option value="' + opts[oi].v + '"' + (it.target === opts[oi].v ? " selected" : "") + '>' + esc(opts[oi].l) + '</option>');
      }
      h.push('</select>');
      h.push('</div>');
    }
    h.push('</div>');
    box.innerHTML = h.join("");

    var tog = box.querySelector("#rmdChapterMapToggle");
    if (tog) tog.onclick = function () {
      saveThesis(tpid, { chapterMapOpen: !ts.chapterMapOpen });
      ts = loadThesis(tpid);
      renderChapterMapBox(container);
    };
    var sels = box.querySelectorAll("[data-rmd-chapter-id]");
    for (i = 0; i < sels.length; i++) {
      sels[i].onchange = function () {
        var cid = this.getAttribute("data-rmd-chapter-id");
        var nextMap = {}, k;
        var prev = ts.chapterMap || {};
        for (k in prev) if (Object.prototype.hasOwnProperty.call(prev, k)) nextMap[k] = prev[k];
        nextMap[cid] = this.value;
        saveThesis(tpid, { chapterMap: nextMap });
        ts = loadThesis(tpid);
        renderChapterMapBox(container);
      };
    }
  }

  function renderSectionProgress(container) {
    var box = container.querySelector("#rmdDraftProgressList");
    if (!box) return;
    var statusMap = ts.sectionStatus;
    if (!statusMap) { box.innerHTML = ""; return; }
    var h = ['<ul class="rmd-section-progress" role="list">'];
    var hasAny = false;
    for (var i = 0; i < SECTION_ORDER.length; i++) {
      var sid = SECTION_ORDER[i].id;
      var st = statusMap[sid];
      if (!st) continue;
      hasAny = true;
      var label = st.status === "done"
        ? ("Done (" + (st.words || 0) + " words)")
        : (st.status === "running"
          ? ("Drafting" + (st.detail ? (" " + st.detail) : "") + "...")
          : (st.status === "failed" ? "Failed" : (st.status === "skipped" ? "Skipped" : "Queued")));
      h.push('<li class="rmd-sec-prog-item" data-sec-status="' + esc(st.status) + '">');
      h.push('<span class="rmd-sec-prog-name">' + esc(st.heading || SECTION_ORDER[i].heading) + '</span>');
      h.push('<span class="rmd-sec-prog-state">' + esc(label) + '</span>');
      if (st.status === "failed") {
        h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-sec-retry" data-rmd-retry-section="' + esc(sid) + '" aria-label="Retry ' + esc(st.heading || SECTION_ORDER[i].heading) + '">Retry</button>');
      }
      h.push('</li>');
    }
    h.push('</ul>');
    box.innerHTML = hasAny ? h.join("") : "";
    var retries = box.querySelectorAll("[data-rmd-retry-section]");
    for (var r = 0; r < retries.length; r++) {
      retries[r].onclick = function () {
        var sid = this.getAttribute("data-rmd-retry-section");
        this.disabled = true;
        this.textContent = "Retrying...";
        retrySingleSection(container, sid);
      };
    }
  }

  function renderDraft(container) {
    var proj = activeProject();
    if (!proj) { container.innerHTML = SMD.p2.errHtml("Open a project first."); return; }
    tpid = pidOf(proj);
    ts = loadThesis(tpid);
    injectCSS();
    if (isTutorialProject(proj) && ts.ownUpload) {
      container.innerHTML = tutorialOwnGateHtml(ts, "Start a real project to draft from your thesis");
      bindTutorialOwnGate(container);
      return;
    }
    var gate = aiGate(proj);
    if (!ts.pages || !ts.pages.length) { needPagesHtml(container); return; }
    var jr = journalOf();
    var mayAi = gate.allowed;
    var h = ['<div class="rmd-p2-screen rmd-thesis-screen">'];
    h.push('<div class="rmd-card">');
    h.push('<h2>Shape the draft</h2>');
    h.push('<p class="rmd-screen-subtitle">Target: ' + esc(jr.name) + '. Word limit: ' + jr.wordLimit + ' words. ' + esc(jr.abstractFormat) + '. MaiK keeps your wording and never invents a number; every number is checked against your thesis.</p>');
    h.push('<div class="rmd-chapter-map smd-books-keep" id="rmdChapterMap"></div>');
    if (mayAi) {
      var st = draftAi || (draftAi = SMD.ai.state());
      h.push(SMD.ai.barHtml(st, { task: "thesis_to_paper", label: "paper draft", cost: 3 }));
    } else {
      h.push('<p class="rmd-thesis-meta">Only the project owner, editor or analyst can ask MaiK. You can still edit and save the draft yourself.</p>');
    }
    h.push('<div id="rmdDraftProgressList"></div>');
    h.push('<div id="rmdDraftBody"></div>');
    h.push('<div class="rmd-card-actions"><button type="button" class="rmd-btn" id="rmdDraftToggle">' + (ts.editMode ? "Done editing" : "Edit draft") + '</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary" id="rmdDraftSave">Save to the manuscript</button>');
    h.push(nextBtn("thesis-tables", "Next: tables") + '</div>');
    h.push('</div></div>');
    container.innerHTML = h.join("");
    bindNext(container);
    renderChapterMapBox(container);
    renderSectionProgress(container);
    renderDraftBody(container);
    if (mayAi) {
      var st2 = draftAi;
      SMD.ai.bind(container, st2, {
        pid: tpid,
        task: "thesis_to_paper",
        emptyMessage: "MaiK returned an empty draft with 0 words. Check your connection and try again.",
        request: function () {
          return orchestrateThesisDraft(container, st2, proj);
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
        apply: function (draft) { return applyDraft(draft, st2); },
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

  function applyDraft(draft, aiState) {
    draft = draft || {};
    var sections = draft.sections || [], pageTexts = ts.pages || [];
    var allFlags = [], allLocators = [], seen = {}, i, sec, v, k, loc;
    var built = [], aiDraftedIds = [], emptyHeadings = [];
    for (i = 0; i < SECTION_ORDER.length; i++) {
      sec = null;
      for (k = 0; k < sections.length; k++) if (sections[k] && sections[k].id === SECTION_ORDER[i].id) sec = sections[k];
      var text = sec && typeof sec.text === "string" ? sec.text : "";
      v = verifyNumbers(text, pageTexts);
      for (k = 0; k < v.flags.length; k++) allFlags.push(v.flags[k]);
      for (k = 0; k < v.locators.length; k++) {
        loc = v.locators[k];
        if (!seen[loc.number]) { seen[loc.number] = true; allLocators.push(loc); }
      }
      built.push({ id: SECTION_ORDER[i].id, heading: SECTION_ORDER[i].heading, text: v.text });
    }
    var jr = journalOf();
    var enf = enforceWordLimit(built, jr.wordLimit, abstractLimitOf(jr));
    for (i = 0; i < enf.sections.length; i++) {
      if (countWords(enf.sections[i].text) > 0) aiDraftedIds.push(enf.sections[i].id);
      else emptyHeadings.push(enf.sections[i].heading || enf.sections[i].id);
    }
    if (!aiDraftedIds.length) {
      if (aiState && aiState.drafted) delete aiState.drafted.draft;
      saveThesis(tpid, {
        draft: null,
        editMode: true
      });
      ts = loadThesis(tpid);
      return [];
    }
    if (emptyHeadings.length && aiState) {
      aiState.error = {
        code: "empty_draft",
        message: "MaiK returned 0 words for: " + emptyHeadings.join(", ") + ". Check your connection and try again."
      };
    }
    var detTables = extractThesisTables(pageTexts);
    var tables = (draft.tables && draft.tables.length) ? draft.tables : ((draft.suggestedTables && draft.suggestedTables.length) ? draft.suggestedTables : detTables);
    if (detTables.length > (tables || []).length) tables = detTables;
    var detRefs = extractThesisReferences(pageTexts);
    var refs = (draft.references && draft.references.length) ? draft.references : detRefs;
    var patchObj = {
      draft: {
        sections: enf.sections,
        aiDraftedIds: aiDraftedIds,
        flags: allFlags,
        locators: allLocators,
        tables: tables,
        references: refs,
        excludedChapters: draft.excludedChapters || (ts.draft && ts.draft.excludedChapters) || [],
        trimmed: enf.trimmed,
        words: enf.words
      },
      tablePicks: suggestTables(tables, 3),
      editMode: false
    };
    if (draft._sectionStatus) patchObj.sectionStatus = draft._sectionStatus;
    saveThesis(tpid, patchObj);
    ts = loadThesis(tpid);
    return ["draft"];
  }

  function renderDraftBody(container) {
    var box = container.querySelector("#rmdDraftBody");
    if (!box) return;
    var draft = ts.draft;
    var editMode = ts.editMode || !draft;
    var aiMap = {}, aIdx;
    var draftedIds = (draft && draft.aiDraftedIds) || [];
    for (aIdx = 0; aIdx < draftedIds.length; aIdx++) aiMap[draftedIds[aIdx]] = true;
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
      var wc = countWords(sec.text);
      var showPill = wc > 0 && aiMap[sec.id];
      h.push('<div class="rmd-thesis-section">');
      h.push('<div class="rmd-field"><label>' + esc(sec.heading || sec.id) + ' <span class="rmd-thesis-meta">' + wc + ' words</span>' +
        (showPill ? ' <span class="rmd-ai-note" data-rmd-ai-note="' + esc(sec.id) + '">Drafted by MaiK, check it</span>' : '') +
        '</label>');
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
          d = { sections: [], aiDraftedIds: [], flags: [], locators: [], tables: [], references: [], words: 0 };
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

  var saveBusy = false;
  var pendingSavePromise = null;

  function mirrorDraftLocal(pid, sections) {
    try {
      if (typeof localStorage === "undefined") return;
      var key = "smd_rmd_manuscript_local_v1";
      var all = JSON.parse(localStorage.getItem(key) || "{}");
      var entry = all[pid] || { sections: {}, order: [], headings: {} };
      entry.sections = entry.sections || {};
      entry.headings = entry.headings || {};
      var order = [];
      for (var i = 0; i < sections.length; i++) {
        var s = sections[i];
        entry.sections[s.id] = s.text || "";
        entry.headings[s.id] = s.heading || s.id;
        order.push(s.id);
      }
      entry.order = order;
      all[pid] = entry;
      localStorage.setItem(key, JSON.stringify(all));
    } catch (e) {}
  }

  function isDomMounted(el) {
    if (!el) return false;
    if (typeof el.isConnected === "boolean") return el.isConnected;
    if (D && D.body && typeof D.body.contains === "function") return D.body.contains(el);
    return true;
  }

  function saveDraft(container) {
    if (saveBusy) return pendingSavePromise;
    var draft = ts.draft;
    if (!draft || !draft.sections || !draft.sections.length) {
      SMD.p2.flashNotice(container, "Write or draft the paper first.", "error");
      return Promise.resolve(false);
    }
    var wasMounted = isDomMounted(container);
    var pid = tpid;
    var btn = container ? container.querySelector("#rmdDraftSave") : null;
    saveBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
    mirrorDraftLocal(pid, draft.sections);
    var p = SMD.api.request("GET", "/v1/projects/" + pid + "/manuscript").then(function (res) {
      return (res && res.manuscript && res.manuscript.version) || 1;
    }).catch(function () { return 1; }).then(function (version) {
      var secs = draft.sections;
      var chain = Promise.resolve();
      for (var i = 0; i < secs.length; i++) {
        (function (sec) {
          chain = chain.then(function () {
            return SMD.api.request("PUT", "/v1/projects/" + pid + "/manuscript/sections/" + sec.id, { version: version, heading: sec.heading, text: sec.text });
          });
        })(secs[i]);
      }
      return chain;
    }).then(function () {
      saveBusy = false;
      pendingSavePromise = null;
      if (btn) { btn.disabled = false; btn.textContent = "Save to the manuscript"; }
      /* Never hijack navigation if the user moved away while PUTs were in-flight. */
      var stillOnDraft = btn ? isDomMounted(btn) : (!wasMounted || isDomMounted(container));
      if (stillOnDraft) {
        SMD.p2.flashNotice(container, "Saved to the manuscript.", "info");
        SMD.navigate("thesis-tables");
      }
      return true;
    }).catch(function () {
      saveBusy = false;
      pendingSavePromise = null;
      if (btn) { btn.disabled = false; btn.textContent = "Save to the manuscript"; }
      var stillOnDraftErr = btn ? isDomMounted(btn) : (!wasMounted || isDomMounted(container));
      if (stillOnDraftErr) {
        SMD.p2.flashNotice(container, "Saved on this device.", "info");
        SMD.navigate("thesis-tables");
      }
      return false;
    });
    pendingSavePromise = p;
    return p;
  }

  /* ---------- screen: tables ---------- */

  function renderTables(container) {
    var proj = activeProject();
    if (!proj) { container.innerHTML = SMD.p2.errHtml("Open a project first."); return; }
    tpid = pidOf(proj);
    ts = loadThesis(tpid);
    injectCSS();
    if (isTutorialProject(proj) && ts.ownUpload) {
      container.innerHTML = tutorialOwnGateHtml(ts, "Start a real project to select tables from your thesis");
      bindTutorialOwnGate(container);
      return;
    }
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
    if (isTutorialProject(proj) && ts.ownUpload) {
      container.innerHTML = tutorialOwnGateHtml(ts, "Start a real project to format thesis references");
      bindTutorialOwnGate(container);
      return;
    }
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
    h.push('<div class="rmd-card-actions">' + nextBtn("manuscript", "Next: manuscript") + '</div>');
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
      "#researchMD .rmd-thesis-quote { margin: 4px 0 12px; padding: 10px 12px; border: 1px solid var(--rmd-line); background: var(--rmd-fill); border-radius: 8px; font: 400 13px/1.5 var(--rmd-f); color: var(--rmd-ink); overflow-wrap: anywhere; }",
      "#researchMD .rmd-thesis-real-gate .rmd-card-actions { margin-top: 8px; }",
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
      "@media (prefers-reduced-motion: reduce) { dialog.rmd-thesis-consent-dialog { transition: none; } }",
      "#researchMD .rmd-chapter-map { margin: 8px 0 12px; padding: 12px 14px; border: 1px solid var(--rmd-line); border-radius: 10px; background: var(--rmd-fill); }",
      "#researchMD .rmd-chapter-map-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }",
      "#researchMD .rmd-chapter-map-summary { flex: 1 1 180px; font: 600 13.5px/1.4 var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-chapter-toggle { min-height: 44px; flex: 0 0 auto; }",
      "#researchMD .rmd-chapter-list { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-chapter-list[hidden] { display: none; }",
      "#researchMD .rmd-chapter-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border: 1px solid var(--rmd-line); border-radius: 8px; background: var(--rmd-panel); flex-wrap: wrap; }",
      "#researchMD .rmd-chapter-row-muted { opacity: 0.85; }",
      "#researchMD .rmd-chapter-info { flex: 1 1 170px; min-width: 0; }",
      "#researchMD .rmd-chapter-title { display: block; font: 600 13px/1.35 var(--rmd-f); color: var(--rmd-ink); overflow-wrap: anywhere; }",
      "#researchMD .rmd-chapter-select { min-height: 44px; max-width: 100%; font: 500 13px var(--rmd-f); padding: 6px 10px; border: 1px solid var(--rmd-line); border-radius: 8px; background: var(--rmd-panel); color: var(--rmd-ink); }",
      "#researchMD .rmd-chapter-pill { font: 600 12px var(--rmd-f); color: var(--rmd-mut); padding: 4px 8px; border-radius: 999px; border: 1px solid var(--rmd-line); }",
      "#researchMD .rmd-section-progress { list-style: none; margin: 10px 0 14px; padding: 0; display: flex; flex-direction: column; gap: 6px; }",
      "#researchMD .rmd-sec-prog-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border: 1px solid var(--rmd-line); border-radius: 8px; background: var(--rmd-panel); font: 400 13px/1.4 var(--rmd-f); }",
      "#researchMD .rmd-sec-prog-name { font-weight: 600; color: var(--rmd-ink); }",
      "#researchMD .rmd-sec-prog-state { margin-left: auto; color: var(--rmd-mut); font-variant-numeric: tabular-nums; }",
      "#researchMD .rmd-sec-prog-item[data-sec-status=\"done\"] .rmd-sec-prog-state { color: var(--rmd-ok); font-weight: 600; }",
      "#researchMD .rmd-sec-prog-item[data-sec-status=\"failed\"] .rmd-sec-prog-state { color: var(--rmd-bad); font-weight: 600; }",
      "#researchMD .rmd-sec-retry { min-height: 44px; padding: 6px 12px; }",
      "#researchMD { --rmd-ok: #136d45; --rmd-ok-soft: #e6f5ec; }",
      "body.dark #researchMD, body.v3-dark #researchMD { --rmd-ok: #42cdb5; --rmd-ok-soft: #103239; }",
      "#researchMD .rmd-auto-wrap { display: flex; flex-direction: column; gap: 14px; max-width: 100%; }",
      "#researchMD .rmd-auto-progress-box { padding: 12px 14px; border: 1px solid var(--rmd-line); border-radius: 12px; background: var(--rmd-panel); display: flex; flex-direction: column; gap: 10px; }",
      "#researchMD .rmd-auto-prog-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }",
      "#researchMD .rmd-auto-bar-track { width: 100%; height: 8px; border-radius: 999px; background: var(--rmd-fill); overflow: hidden; }",
      "#researchMD .rmd-auto-bar-fill { height: 100%; border-radius: 999px; background: var(--rmd-acc); transition: width 0.25s ease; }",
      "#researchMD .rmd-auto-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }",
      "#researchMD .rmd-auto-step { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border: 1px solid var(--rmd-line); border-radius: 10px; background: var(--rmd-panel); min-width: 0; }",
      "#researchMD .rmd-auto-step[data-step-status=\"running\"] { border-color: var(--rmd-acc); background: var(--rmd-acc-soft); }",
      "#researchMD .rmd-auto-step[data-step-status=\"done\"] { border-color: var(--rmd-line); }",
      "#researchMD .rmd-auto-step[data-step-status=\"failed\"] { border-color: var(--rmd-bad); background: var(--rmd-bad-soft); }",
      "#researchMD .rmd-auto-step-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 200px; }",
      "#researchMD .rmd-auto-step-title { font: 600 13.5px/1.35 var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-auto-step-detail { font: 400 12.5px/1.35 var(--rmd-f); color: var(--rmd-mut); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }",
      "#researchMD .rmd-auto-step-ctrl { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }",
      "#researchMD .rmd-auto-pill { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; font: 600 12px/1.2 var(--rmd-f); border: 1px solid var(--rmd-line); background: var(--rmd-fill); color: var(--rmd-mut); font-variant-numeric: tabular-nums; }",
      "#researchMD .rmd-auto-pill.is-done { background: var(--rmd-ok-soft); color: var(--rmd-ok); border-color: var(--rmd-ok); }",
      "#researchMD .rmd-auto-pill.is-warn { background: var(--rmd-warn-soft); color: var(--rmd-warn); border-color: var(--rmd-warn); }",
      "#researchMD .rmd-auto-pill.is-bad { background: var(--rmd-bad-soft); color: var(--rmd-bad); border-color: var(--rmd-bad); }",
      "#researchMD .rmd-auto-pill.is-run { background: var(--rmd-acc-soft); color: var(--rmd-acc); border-color: var(--rmd-acc); }",
      "#researchMD .rmd-auto-cost { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; padding: 10px 12px; border: 1px solid var(--rmd-line); border-radius: 10px; background: var(--rmd-fill); }",
      "#researchMD .rmd-auto-stat-k { display: block; font: 500 11.5px/1.3 var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-auto-stat-v { display: block; font: 600 14px/1.35 var(--rmd-f); color: var(--rmd-ink); font-variant-numeric: tabular-nums; }",
      "#researchMD .rmd-auto-jgrid { display: grid; grid-template-columns: 1fr; gap: 8px; }",
      "@media (min-width: 720px) { #researchMD .rmd-auto-jgrid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }",
      "#researchMD .rmd-auto-jcard { text-align: left; width: 100%; min-height: 44px; padding: 12px; border: 1px solid var(--rmd-line); border-radius: 10px; background: var(--rmd-panel); color: var(--rmd-ink); cursor: pointer; display: flex; flex-direction: column; gap: 6px; min-width: 0; }",
      "#researchMD .rmd-auto-jcard[aria-pressed=\"true\"] { border-color: var(--rmd-acc); background: var(--rmd-acc-soft); }",
      "#researchMD .rmd-auto-checkcard { padding: 12px 14px; border: 1px solid var(--rmd-line); border-radius: 10px; background: var(--rmd-panel); display: flex; flex-direction: column; gap: 10px; }",
      "#researchMD .rmd-auto-checkcard[data-readiness=\"green\"] { border-color: var(--rmd-ok); }",
      "#researchMD .rmd-auto-checkcard[data-readiness=\"amber\"] { border-color: var(--rmd-warn); }",
      "#researchMD .rmd-auto-checkhead { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }",
      "#researchMD .rmd-auto-confirm-row { display: flex; align-items: center; gap: 10px; min-height: 47px; padding: 8px 12px; border: 1px solid var(--rmd-line); border-radius: 8px; background: var(--rmd-fill); cursor: pointer; font: 500 13.5px/1.35 var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-auto-confirm-row input[type=\"checkbox\"] { width: 20px; height: 20px; flex-shrink: 0; }",
      "#researchMD .rmd-auto-grid2 { display: grid; grid-template-columns: 1fr; gap: 10px; }",
      "@media (min-width: 640px) { #researchMD .rmd-auto-grid2 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }",
      "#researchMD .rmd-auto-export-grid { display: flex; flex-wrap: wrap; gap: 8px; }",
      "#researchMD .rmd-auto-wrap .rmd-btn, #researchMD .rmd-auto-wrap summary.rmd-btn, #researchMD .rmd-auto-wrap .rmd-auto-jcard { min-height: 47px; padding: 10px 14px; display: inline-flex; align-items: center; justify-content: center; }",
      "#researchMD .rmd-auto-wrap .rmd-auto-jcard { display: flex; justify-content: flex-start; align-items: stretch; }",
      "#researchMD .rmd-auto-export-grid .rmd-btn { min-height: 47px; }",
      "#researchMD .rmd-auto-reflist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; }",
      "#researchMD .rmd-auto-refitem { padding: 8px 10px; border: 1px solid var(--rmd-line); border-radius: 8px; font: 400 12.5px/1.4 var(--rmd-f); color: var(--rmd-ink); display: flex; flex-direction: column; gap: 4px; }",
      "#researchMD .rmd-auto-preview-pre { white-space: pre-wrap; word-break: break-word; font: 400 12.5px/1.45 var(--rmd-f); color: var(--rmd-ink); background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 8px; padding: 10px; max-height: 260px; overflow-y: auto; margin: 0; }",
      "@media (prefers-reduced-motion: reduce) { #researchMD .rmd-auto-bar-fill { transition: none; } }"
    ].join("\n");
    D.head.appendChild(s);
  }

  /* ---------- screen: one-tap thesis-to-journal orchestration ---------- */

  var autoRunToken = 0;
  var autoStopFlag = false;

  function TA() {
    return (G && G.SMD_RESEARCH_THESIS_AUTO) || null;
  }

  function autoUserProfile() {
    var u = (G.SMD_AUTH && G.SMD_AUTH.currentUser) || {};
    var prof = { displayName: u.displayName || u.name || "", email: u.email || "", affiliation: "" };
    try {
      var raw = G.localStorage && G.localStorage.getItem("smd_profile_v1");
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed) {
          if (!prof.displayName && parsed.name) prof.displayName = parsed.name;
          if (!prof.affiliation && (parsed.institution || parsed.affiliation)) prof.affiliation = parsed.institution || parsed.affiliation;
          if (!prof.email && parsed.email) prof.email = parsed.email;
        }
      }
    } catch (e) {}
    return prof;
  }

  function defaultAutoSteps() {
    var ta = TA();
    var order = (ta && ta.STEP_ORDER) || [];
    var out = {};
    for (var i = 0; i < order.length; i++) {
      out[order[i].id] = { status: "pending", detail: "", durationMs: 0, aiCalls: 0, costInr: 0, maikTokens: 0 };
    }
    return out;
  }

  function ensureAutoState() {
    ts = loadThesis(tpid);
    var ta = TA();
    var a = ts.auto ? JSON.parse(JSON.stringify(ts.auto)) : null;
    if (!a || typeof a !== "object") {
      a = {
        status: "idle",
        activeStep: "",
        steps: defaultAutoSteps(),
        stopRequested: false,
        actualAiCalls: 0,
        actualCostInr: 0,
        actualMaikTokens: 0,
        estimated: null,
        specialty: "",
        topJournals: [],
        selectedJournalId: "",
        tablesData: null,
        refsData: null,
        titlePage: null,
        keywords: [],
        declarations: null,
        checklistPrefill: null,
        formatCheck: null,
        coverLetterText: "",
        lastModel: "",
        confirmations: { titlePage: false, ethics: false, declarations: false, references: false },
        approved: false,
        approvedAt: "",
        lastError: null
      };
    }
    var def = defaultAutoSteps();
    a.steps = a.steps || {};
    for (var k in def) {
      if (Object.prototype.hasOwnProperty.call(def, k) && !a.steps[k]) {
        a.steps[k] = def[k];
      }
    }
    if (!a.confirmations) a.confirmations = { titlePage: false, ethics: false, declarations: false, references: false };
    if (!a.estimated && ta && Array.isArray(ts.pages) && ts.pages.length) {
      var tree = ensureChapterTree();
      var jr = journalOf();
      var map = mapChaptersToJournal(tree, ts.pages || [], jr, ts.paperType, ts.chapterMap || {});
      a.estimated = ta.estimateAutoCost(ts.pages, map, jr);
    }
    return a;
  }

  function recalcAutoTotals(a) {
    var ta = TA();
    var perInr = (ta && ta.MT_PER_INR) || 2000;
    var calls = 0, inr = 0;
    for (var k in a.steps) {
      if (!Object.prototype.hasOwnProperty.call(a.steps, k)) continue;
      var s = a.steps[k];
      if (s && s.aiCalls > 0) calls += Number(s.aiCalls);
      if (s && s.costInr > 0) inr += Number(s.costInr);
    }
    a.actualAiCalls = calls;
    a.actualCostInr = Math.round(inr * 10000) / 10000;
    a.actualMaikTokens = Math.round(inr * perInr);
    return a;
  }

  function saveAutoState(a) {
    recalcAutoTotals(a);
    saveThesis(tpid, { auto: a });
    ts = loadThesis(tpid);
    return a;
  }

  function selectedAutoJournal(a) {
    var list = (a && a.topJournals) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === a.selectedJournalId) return list[i];
    }
    return list[0] || journalOf();
  }

  function syncManuscriptToServer(sections, opts) {
    opts = opts || {};
    var pid = tpid;
    mirrorDraftLocal(pid, sections || []);
    if (!SMD || !SMD.api) {
      return Promise.resolve({ synced: false, localOnly: true, approved: !!opts.approve });
    }
    var version = 1;
    return SMD.api.request("GET", "/v1/projects/" + pid + "/manuscript").then(function (res) {
      version = (res && res.manuscript && res.manuscript.version) || 1;
      var chain = Promise.resolve();
      var list = Array.isArray(sections) ? sections : [];
      for (var i = 0; i < list.length; i++) {
        (function (sec) {
          chain = chain.then(function () {
            return SMD.api.request("PUT", "/v1/projects/" + pid + "/manuscript/sections/" + sec.id, {
              version: version,
              heading: sec.heading || sec.id,
              text: sec.text || ""
            }).then(function (putRes) {
              if (putRes && putRes.manuscript && putRes.manuscript.version) version = putRes.manuscript.version;
              else if (putRes && putRes.version) version = putRes.version;
              else version += 1;
            });
          });
        })(list[i]);
      }
      return chain;
    }).then(function () {
      if (!opts.approve) return { synced: true, version: version };
      return SMD.api.request("POST", "/v1/projects/" + pid + "/manuscript/approval/approve", {
        version: version,
        decision: "approved"
      }).then(function () {
        return { synced: true, version: version, approved: true };
      });
    }).catch(function () {
      return { synced: false, version: version, localOnly: true };
    });
  }

  function isQuotaCapError(err) {
    var c = err && (err.code || (err.body && err.body.error && err.body.error.code));
    return !!(err && (err.status === 429 || err.status === 402 ||
      c === "project_ai_cap" || c === "user_ai_cap" || c === "insufficient_credits"));
  }

  function renderAutoChecklistRows(a) {
    var items = [];
    var tp = a.titlePage || {};
    var decl = a.declarations || {};
    var refsData = a.refsData || {};
    var cl = a.checklistPrefill || {};
    var fmt = a.formatCheck || {};
    var conf = a.confirmations || {};

    var tpReady = !!conf.titlePage && !tp.hasPlaceholders &&
      (tp.authors || []).length > 0 &&
      String((tp.authors[0] && tp.authors[0].name) || "").indexOf("[Confirm") < 0 &&
      String((tp.correspondingAuthor && tp.correspondingAuthor.email) || "").indexOf("[Confirm") < 0;

    var iecNum = decl.ethics && decl.ethics.iecNumber ? String(decl.ethics.iecNumber).replace(/^\s+|\s+$/g, "") : "";
    var ethReady = !!conf.ethics && !!iecNum;
    var declReady = !!conf.declarations;

    var unv = (refsData.unverifiedIndices || []).length;
    var refCount = (refsData.references || []).length;
    var refReady = refCount === 0 ? true : (unv === 0 ? true : !!conf.references);

    var fmtReady = (fmt.failCount || 0) === 0;

    items.push({ id: "title_page", label: "Author list and title page", ready: tpReady, note: tpReady ? "Confirmed" : "Confirm author names, affiliation and email" });
    items.push({ id: "ethics", label: "IEC / IRB ethics approval number", ready: ethReady, note: ethReady ? ("IEC: " + iecNum) : "Enter and confirm ethics committee number" });
    items.push({ id: "declarations", label: "Funding, conflicts, consent and CRediT", ready: declReady, note: declReady ? "Confirmed" : "Review statements and check confirm" });
    items.push({ id: "references", label: "References verified (" + (refsData.verifiedCount || 0) + "/" + (refsData.totalCount || refCount) + ")", ready: refReady, note: unv > 0 ? (conf.references ? (unv + " manually checked") : (unv + " unverified reference(s) need confirmation")) : "All cited references verified online" });
    items.push({ id: "format", label: "Format checks and reporting checklist (" + (cl.covered || 0) + "/" + (cl.total || 0) + ")", ready: fmtReady, note: fmtReady ? ((fmt.passCount || 0) + " passed, " + (fmt.warnCount || 0) + " advisory") : ((fmt.failCount || 0) + " format issue(s) to check") });
    return items;
  }

  function renderAutoScreenHtml(a, proj) {
    var ta = TA();
    var order = (ta && ta.STEP_ORDER) || [];
    var doneCount = 0;
    for (var i = 0; i < order.length; i++) {
      var stObj = a.steps[order[i].id];
      if (stObj && stObj.status === "done") doneCount++;
    }
    var pct = order.length ? Math.round((doneCount / order.length) * 100) : 0;
    var isRunning = a.status === "running";
    var isStopped = a.status === "stopped" || a.status === "error";
    var isReview = a.status === "review" || a.status === "approved";
    var jr = selectedAutoJournal(a);
    var est = a.estimated || { aiCalls: 0, estimatedMaikTokens: 0, estimatedCostInr: 0 };
    var secElapsed = 0;
    for (i = 0; i < order.length; i++) secElapsed += Number((a.steps[order[i].id] && a.steps[order[i].id].durationMs) || 0);

    var h = [];
    h.push('<div class="rmd-panel rmd-auto-wrap">');

    /* Header & primary status */
    h.push('<div class="rmd-card">');
    h.push('<div class="rmd-card-head">');
    h.push('<div><h2 class="rmd-h2">' + esc(a.approved ? "Approved Submission Package" : (isReview ? "Review and Approve Paper" : "Make My Journal Paper")) + '</h2>');
    h.push('<p class="rmd-muted">' + esc((ts && ts.filename) || (proj && proj.title) || "Thesis") + ' -> ' + esc(jr.shortName || jr.name || "Target Journal") + '</p></div>');
    if (a.approved) {
      h.push('<span class="rmd-auto-pill is-done" id="rmdAutoStatusBadge">Approved final</span>');
    } else if (isReview) {
      h.push('<span class="rmd-auto-pill is-warn" id="rmdAutoStatusBadge">Awaiting approval</span>');
    } else if (isRunning) {
      h.push('<span class="rmd-auto-pill is-run" id="rmdAutoStatusBadge">Running step ' + (doneCount + 1) + ' of ' + order.length + '</span>');
    } else if (isStopped) {
      h.push('<span class="rmd-auto-pill is-warn" id="rmdAutoStatusBadge">Paused (' + doneCount + '/' + order.length + ')</span>');
    } else {
      h.push('<span class="rmd-auto-pill" id="rmdAutoStatusBadge">Ready to run</span>');
    }
    h.push('</div>');

    if (a.lastError) {
      h.push('<div class="rmd-banner rmd-banner-warn" id="rmdAutoErrBanner" role="status">' + esc(a.lastError) + '</div>');
    }

    /* Progress bar + MaiK token ledger */
    h.push('<div class="rmd-auto-progress-box">');
    h.push('<div class="rmd-auto-prog-top">');
    h.push('<span class="rmd-thesis-meta" id="rmdAutoProgSummary">' + doneCount + ' of ' + order.length + ' steps completed (' + pct + '%)</span>');
    h.push('<div class="rmd-card-actions" style="margin:0;">');
    if (isRunning) {
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle" id="rmdAutoStopBtn">Stop</button>');
    } else if (isStopped || a.status === "idle") {
      h.push('<button type="button" class="rmd-btn rmd-btn-primary" id="rmdAutoContinueBtn">' + (doneCount > 0 ? "Continue paper" : "Start making paper") + '</button>');
    } else if (isReview && !a.approved) {
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle" id="rmdAutoBackThesis">' + "Back to thesis upload" + '</button>');
    }
    h.push('</div></div>');
    h.push('<div class="rmd-auto-bar-track" role="progressbar" aria-label="Thesis to journal paper progress" aria-valuemin="0" aria-valuemax="' + order.length + '" aria-valuenow="' + doneCount + '" aria-valuetext="' + doneCount + ' of ' + order.length + ' steps completed">');
    h.push('<div class="rmd-auto-bar-fill" style="width:' + pct + '%;"></div></div>');
    h.push('<div class="rmd-auto-cost" id="rmdAutoCostSummary">');
    h.push('<div><span class="rmd-auto-stat-k">Estimated tokens</span><span class="rmd-auto-stat-v">~' + fmtInt(est.estimatedMaikTokens || 0) + ' MT (' + (est.aiCalls || 0) + ' AI)</span></div>');
    h.push('<div><span class="rmd-auto-stat-k">Used so far (succeeded only)</span><span class="rmd-auto-stat-v">' + fmtInt(a.actualMaikTokens || 0) + ' MT (' + (a.actualAiCalls || 0) + ' AI)</span></div>');
    h.push('<div><span class="rmd-auto-stat-k">Elapsed time</span><span class="rmd-auto-stat-v">' + (Math.round(secElapsed / 100) / 10) + 's</span></div>');
    h.push('</div></div>');

    /* 12-Step list (auto-expanded while running/paused/failed; collapsible once in Review so approval checklist fits cleanly) */
    var stepsOpen = !isReview;
    h.push('<details id="rmdAutoStepsDetails"' + (stepsOpen ? ' open' : '') + '>');
    h.push('<summary class="rmd-btn rmd-btn-subtle">' + (isReview ? ('12 steps completed (' + doneCount + '/' + order.length + ') - show or re-run') : ('Steps (' + doneCount + '/' + order.length + ')')) + '</summary>');
    h.push('<ol class="rmd-auto-steps smd-books-keep" id="rmdAutoStepsList" style="margin-top:8px;">');
    for (i = 0; i < order.length; i++) {
      var defStep = order[i];
      var sState = a.steps[defStep.id] || { status: "pending", detail: "" };
      var pillCls = sState.status === "done" ? "is-done" : (sState.status === "running" ? "is-run" : (sState.status === "failed" ? "is-bad" : (sState.status === "stopped" ? "is-warn" : "")));
      var stLabel = sState.status === "done" ? "Done" : (sState.status === "running" ? "Running" : (sState.status === "failed" ? "Failed" : (sState.status === "stopped" ? "Paused" : "Pending")));
      h.push('<li class="rmd-auto-step" data-auto-step="' + esc(defStep.id) + '" data-step-status="' + esc(sState.status) + '">');
      h.push('<div class="rmd-auto-step-main">');
      h.push('<span class="rmd-auto-step-title">' + (i + 1) + '. ' + esc(defStep.label) + '</span>');
      h.push('<span class="rmd-auto-step-detail">' + esc(sState.detail || (defStep.ai ? "Uses MaiK AI section drafting" : "Automatic local + verified check")) + '</span>');
      h.push('</div>');
      h.push('<div class="rmd-auto-step-ctrl">');
      h.push('<span class="rmd-auto-pill ' + pillCls + '">' + esc(stLabel) + '</span>');
      if (!isRunning && (sState.status === "done" || sState.status === "failed" || sState.status === "stopped")) {
        h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-sec-retry" data-rmd-auto-rerun="' + esc(defStep.id) + '">Re-run</button>');
      }
      h.push('</div></li>');
    }
    h.push('</ol></details>');
    h.push('</div>');

    /* Review & Approve section (shown once steps complete or in review/approved state) */
    if (isReview) {
      /* 1. Top 3 Matched Journals */
      var jList = a.topJournals || [];
      if (jList.length) {
        h.push('<div class="rmd-card" id="rmdAutoJournalsCard">');
        h.push('<h3 class="rmd-h3">Target Journal (' + esc(a.specialty || "General Medicine") + ')</h3>');
        h.push('<p class="rmd-muted">Preselected the best match. Switch journal below to re-format tables, references, and limits with zero extra AI tokens.</p>');
        h.push('<div class="rmd-auto-jgrid">');
        for (i = 0; i < jList.length; i++) {
          var jItem = jList[i];
          var isSel = (jr.id === jItem.id);
          h.push('<button type="button" class="rmd-auto-jcard" data-rmd-auto-journal="' + esc(jItem.id) + '" aria-pressed="' + (isSel ? "true" : "false") + '">');
          h.push('<div class="rmd-auto-checkhead"><strong>' + esc(jItem.name) + '</strong>' + (i === 0 ? '<span class="rmd-auto-pill is-done">Best match</span>' : '') + '</div>');
          h.push('<span class="rmd-thesis-meta">' + fmtInt(jItem.wordLimit || 3000) + ' words max | ' + fmtInt(jItem.abstractLimit || 250) + 'w abstract | ' + (jItem.maxReferences || 35) + ' refs (' + esc(String(jItem.referenceStyle || "vancouver").toUpperCase()) + ') | ' + (jItem.maxTables || 4) + ' tables</span>');
          h.push('<span class="rmd-thesis-meta">' + esc(jItem.fitReason || jItem.specialty || "") + '</span>');
          h.push('</button>');
        }
        h.push('</div></div>');
      }

      /* 2. Green vs Amber Submission Checklist */
      var readyRows = renderAutoChecklistRows(a);
      var allGreen = true;
      for (i = 0; i < readyRows.length; i++) if (!readyRows[i].ready) allGreen = false;
      h.push('<div class="rmd-card" id="rmdAutoReadinessCard">');
      h.push('<div class="rmd-card-head"><h3 class="rmd-h3">Submission Readiness</h3>');
      h.push('<span class="rmd-auto-pill ' + (allGreen ? "is-done" : "is-warn") + '">' + (allGreen ? "All items ready" : "Confirm amber items below") + '</span></div>');
      h.push('<ul class="rmd-auto-steps" id="rmdAutoReadySummary">');
      for (i = 0; i < readyRows.length; i++) {
        var rr = readyRows[i];
        h.push('<li class="rmd-auto-step" data-ready-item="' + esc(rr.id) + '" data-ready-state="' + (rr.ready ? "green" : "amber") + '">');
        h.push('<div class="rmd-auto-step-main"><span class="rmd-auto-step-title">' + esc(rr.label) + '</span><span class="rmd-auto-step-detail">' + esc(rr.note) + '</span></div>');
        h.push('<span class="rmd-auto-pill ' + (rr.ready ? "is-done" : "is-warn") + '">' + (rr.ready ? "Green: Ready" : "Amber: Confirm") + '</span>');
        h.push('</li>');
      }
      h.push('</ul></div>');

      /* 3. Editable Confirmable Details: Title Page & Authors + Ethics & Declarations */
      var tp = a.titlePage || { authors: [{ name: "" }, { name: "" }], affiliations: [""], correspondingAuthor: {}, wordCounts: {} };
      var decl = a.declarations || { ethics: {}, consent: {}, funding: {}, conflicts: {}, dataAvailability: {}, aiDisclosure: {}, credit: {} };
      var conf = a.confirmations || {};

      h.push('<div class="rmd-auto-checkcard" data-readiness="' + (readyRows[0].ready ? "green" : "amber") + '" id="rmdAutoTitleCard">');
      h.push('<div class="rmd-auto-checkhead"><h3 class="rmd-h3">1. Title Page & Authors</h3><span class="rmd-auto-pill ' + (readyRows[0].ready ? "is-done" : "is-warn") + '">' + (readyRows[0].ready ? "Confirmed" : "Confirm details") + '</span></div>');
      h.push('<div class="rmd-field"><label for="rmdAutoTitleIn">Manuscript title</label><input type="text" id="rmdAutoTitleIn" value="' + esc(tp.title || "") + '"></div>');
      h.push('<div class="rmd-auto-grid2">');
      h.push('<div class="rmd-field"><label for="rmdAutoShortTitleIn">Running / short title</label><input type="text" id="rmdAutoShortTitleIn" value="' + esc(tp.shortTitle || "") + '"></div>');
      h.push('<div class="rmd-field"><label for="rmdAutoAuth1In">First / corresponding author</label><input type="text" id="rmdAutoAuth1In" value="' + esc((tp.authors && tp.authors[0] && tp.authors[0].name) || "") + '"></div>');
      h.push('<div class="rmd-field"><label for="rmdAutoAuth2In">Co-author / guide</label><input type="text" id="rmdAutoAuth2In" value="' + esc((tp.authors && tp.authors[1] && tp.authors[1].name) || "") + '"></div>');
      h.push('<div class="rmd-field"><label for="rmdAutoEmailIn">Corresponding email</label><input type="email" id="rmdAutoEmailIn" value="' + esc((tp.correspondingAuthor && tp.correspondingAuthor.email) || "") + '"></div>');
      h.push('</div>');
      h.push('<div class="rmd-field"><label for="rmdAutoAffilIn">Department & Institution</label><input type="text" id="rmdAutoAffilIn" value="' + esc((tp.correspondingAuthor && tp.correspondingAuthor.affiliation) || "") + '"></div>');
      h.push('<label class="rmd-auto-confirm-row" for="rmdConfirmTitleCb"><input type="checkbox" id="rmdConfirmTitleCb" data-rmd-auto-confirm="titlePage"' + (conf.titlePage ? " checked" : "") + '><span>I confirm the author list, order, affiliations, and title page</span></label>');
      h.push('</div>');

      h.push('<div class="rmd-auto-checkcard" data-readiness="' + ((readyRows[1].ready && readyRows[2].ready) ? "green" : "amber") + '" id="rmdAutoDeclCard">');
      h.push('<div class="rmd-auto-checkhead"><h3 class="rmd-h3">2. Ethics (IEC) & Declarations</h3><span class="rmd-auto-pill ' + ((readyRows[1].ready && readyRows[2].ready) ? "is-done" : "is-warn") + '">' + ((readyRows[1].ready && readyRows[2].ready) ? "Confirmed" : "Confirm IEC & statements") + '</span></div>');
      h.push('<div class="rmd-auto-grid2">');
      h.push('<div class="rmd-field"><label for="rmdAutoIecIn">IEC / IRB approval number</label><input type="text" id="rmdAutoIecIn" placeholder="e.g. IEC/2024/112" value="' + esc((decl.ethics && decl.ethics.iecNumber) || "") + '"></div>');
      h.push('<div class="rmd-field"><label for="rmdAutoRegIn">Trial registration (optional CTRI/NCT)</label><input type="text" id="rmdAutoRegIn" value="' + esc(decl.registration || "") + '"></div>');
      h.push('</div>');
      h.push('<div class="rmd-field"><label for="rmdAutoFundingIn">Funding statement</label><input type="text" id="rmdAutoFundingIn" value="' + esc((decl.funding && decl.funding.text) || "") + '"></div>');
      h.push('<div class="rmd-field"><label for="rmdAutoConflictsIn">Conflict of interest statement</label><input type="text" id="rmdAutoConflictsIn" value="' + esc((decl.conflicts && decl.conflicts.text) || "") + '"></div>');
      h.push('<div class="rmd-field"><label for="rmdAutoCreditIn">CRediT author contributions</label><input type="text" id="rmdAutoCreditIn" value="' + esc((decl.credit && decl.credit.text) || "") + '"></div>');
      h.push('<p class="rmd-thesis-meta"><strong>AI use disclosure:</strong> ' + esc(String((decl.aiDisclosure && decl.aiDisclosure.text) || "").replace(/^AI\s+use\s+disclosure\s*:\s*/i, "")) + '</p>');
      h.push('<label class="rmd-auto-confirm-row" for="rmdConfirmEthicsCb"><input type="checkbox" id="rmdConfirmEthicsCb" data-rmd-auto-confirm="ethics"' + (conf.ethics ? " checked" : "") + '><span>I confirm ethics approval and participant consent</span></label>');
      h.push('<label class="rmd-auto-confirm-row" for="rmdConfirmDeclCb"><input type="checkbox" id="rmdConfirmDeclCb" data-rmd-auto-confirm="declarations"' + (conf.declarations ? " checked" : "") + '><span>I confirm funding, conflicts, data availability, and CRediT roles</span></label>');
      h.push('</div>');

      /* 4. References + Keywords + Tables + Checklist + Format Check Summary */
      var refsData = a.refsData || { references: [] };
      var rList = refsData.references || [];
      h.push('<div class="rmd-auto-checkcard" data-readiness="' + (readyRows[3].ready ? "green" : "amber") + '" id="rmdAutoRefsCard">');
      h.push('<div class="rmd-auto-checkhead"><h3 class="rmd-h3">3. Verified References (' + esc(String(jr.referenceStyle || "vancouver").toUpperCase()) + ')</h3><span class="rmd-auto-pill ' + (readyRows[3].ready ? "is-done" : "is-warn") + '">' + (refsData.verifiedCount || 0) + '/' + rList.length + ' verified</span></div>');
      h.push('<p class="rmd-thesis-meta">' + rList.length + ' cited reference(s) kept from ' + (refsData.totalBibliography || 0) + ' thesis bibliography entries. Limit: ' + (refsData.maxReferences || jr.maxReferences || 35) + '.</p>');
      if (rList.length) {
        h.push('<ul class="rmd-auto-reflist">');
        for (i = 0; i < rList.length; i++) {
          var rf = rList[i];
          h.push('<li class="rmd-auto-refitem"><div>' + esc(rf.formatted || rf.title || "") + '</div><div><span class="rmd-auto-pill ' + (rf.verified ? "is-done" : "is-warn") + '">' + esc(rf.verified ? ("Verified: " + (rf.verificationSource || "Online")) : "Unverified - check manually") + '</span></div></li>');
        }
        h.push('</ul>');
      }
      if ((refsData.unverifiedIndices || []).length) {
        h.push('<label class="rmd-auto-confirm-row" for="rmdConfirmRefsCb"><input type="checkbox" id="rmdConfirmRefsCb" data-rmd-auto-confirm="references"' + (conf.references ? " checked" : "") + '><span>I manually verified the flagged unverified references</span></label>');
      }
      h.push('</div>');

      var tData = a.tablesData || { kept: [] };
      var clData = a.checklistPrefill || { items: [] };
      var fCheck = a.formatCheck || { checks: [] };
      h.push('<div class="rmd-card" id="rmdAutoPreviewCard">');
      h.push('<h3 class="rmd-h3">4. Manuscript, Tables, Keywords & Format Check</h3>');
      var kwNames = (a.keywords || []).map(function (k) { return k && (k.meshVerified ? (k.term + " [MeSH]") : k.term); }).filter(Boolean);
      h.push('<p class="rmd-thesis-meta"><strong>Keywords:</strong> ' + esc(kwNames.join("; ") || "None") + '</p>');
      h.push('<p class="rmd-thesis-meta"><strong>Tables condensed:</strong> ' + ((tData.kept && tData.kept.length) || 0) + ' kept (dropped ' + (tData.droppedCount || 0) + ', limit ' + (tData.limit || jr.maxTables || 4) + ').</p>');
      h.push('<p class="rmd-thesis-meta"><strong>Checklist (' + esc(clData.guidelineName || "Reporting") + '):</strong> ' + (clData.covered || 0) + ' of ' + (clData.total || 0) + ' items covered.</p>');
      if (fCheck.checks && fCheck.checks.length) {
        h.push('<ul class="rmd-auto-steps" style="margin-top:8px;">');
        for (i = 0; i < fCheck.checks.length; i++) {
          var fc = fCheck.checks[i];
          var fcCls = fc.status === "pass" ? "is-done" : (fc.status === "fail" ? "is-bad" : "is-warn");
          h.push('<li class="rmd-auto-step"><div class="rmd-auto-step-main"><span class="rmd-auto-step-title">' + esc(fc.label) + '</span><span class="rmd-auto-step-detail">' + esc(fc.detail) + '</span></div><span class="rmd-auto-pill ' + fcCls + '">' + esc(String(fc.status || "").toUpperCase()) + '</span></li>');
        }
        h.push('</ul>');
      }
      h.push('<details style="margin-top:10px;"><summary class="rmd-btn rmd-btn-subtle">Preview Cover Letter & Draft Abstract</summary>');
      var absSec = (ts.draft && ts.draft.sections && ts.draft.sections[0]) ? ts.draft.sections[0].text : "";
      h.push('<div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;"><p class="rmd-thesis-meta"><strong>Abstract:</strong></p><pre class="rmd-auto-preview-pre">' + esc(absSec) + '</pre><p class="rmd-thesis-meta"><strong>Cover letter:</strong></p><pre class="rmd-auto-preview-pre">' + esc(a.coverLetterText || "") + '</pre></div></details>');
      h.push('</div>');

      /* 5. Approve + Export Package */
      h.push('<div class="rmd-card" id="rmdAutoActionsCard">');
      h.push('<h3 class="rmd-h3">Approve & Export Submission Package</h3>');
      h.push('<p class="rmd-muted">' + (a.approved ? ("Marked final on " + esc(a.approvedAt || "") + ". All files ready for journal portal upload.") : "Nothing is marked final until you click Approve below. You can still download a draft preview or export the full zip package after approval.") + '</p>');
      h.push('<div class="rmd-card-actions" style="margin-bottom:10px;">');
      if (!a.approved) {
        h.push('<button type="button" class="rmd-btn rmd-btn-primary" id="rmdAutoApproveBtn">Approve and mark final</button>');
      } else {
        h.push('<button type="button" class="rmd-btn rmd-btn-primary" id="rmdAutoApproveBtn" disabled>Approved as final</button>');
      }
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle" id="rmdAutoOpenManuscript">Open in Manuscript editor</button>');
      h.push('</div>');
      h.push('<div class="rmd-auto-export-grid">');
      h.push('<button type="button" class="rmd-btn rmd-btn-primary" id="rmdAutoExportPackBtn">Export full package (.zip)</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-auto-export="manuscript">Manuscript .docx</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-auto-export="title_page">Title page .docx</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-auto-export="tables">Tables .docx</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-auto-export="cover_letter">Cover letter .docx</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-auto-export="checklist_docx">Checklist .docx</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-auto-export="checklist_pdf">Checklist .pdf</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-auto-export="references_ris">References .ris</button>');
      h.push('</div></div>');
    }

    h.push('</div>');
    return h.join("");
  }

  function runSingleAutoStep(container, stepId, a, opts) {
    opts = opts || {};
    var ta = TA();
    var proj = activeProject() || { id: tpid, title: "" };
    var t0 = Date.now();
    a.activeStep = stepId;
    a.lastError = null;
    a.steps[stepId] = {
      status: "running",
      detail: a.steps[stepId] && a.steps[stepId].detail ? a.steps[stepId].detail : "Running...",
      durationMs: 0,
      aiCalls: (stepId === "draft" && a.steps[stepId]) ? (a.steps[stepId].aiCalls || 0) : 0,
      costInr: (stepId === "draft" && a.steps[stepId]) ? (a.steps[stepId].costInr || 0) : 0,
      maikTokens: (stepId === "draft" && a.steps[stepId]) ? (a.steps[stepId].maikTokens || 0) : 0
    };
    saveAutoState(a);
    paintAutoScreen(container, a, proj);

    function finishStep(detail, extraCalls, extraInr) {
      var prevCalls = Number((a.steps[stepId] && a.steps[stepId].aiCalls) || 0);
      var prevInr = Number((a.steps[stepId] && a.steps[stepId].costInr) || 0);
      var newCalls = prevCalls + Number(extraCalls || 0);
      var newInr = prevInr + Number(extraInr || 0);
      var perInr = (ta && ta.MT_PER_INR) || 2000;
      a.steps[stepId] = {
        status: "done",
        detail: detail || "Done",
        durationMs: Date.now() - t0,
        aiCalls: newCalls,
        costInr: Math.round(newInr * 10000) / 10000,
        maikTokens: Math.round(newInr * perInr)
      };
      a.activeStep = "";
      saveAutoState(a);
      paintAutoScreen(container, a, proj);
      return a;
    }

    var allPages = ts.pages || [];

    if (stepId === "chapters") {
      var tree = ensureChapterTree();
      var chLen = (tree && tree.chapters && tree.chapters.length) || 0;
      return Promise.resolve(finishStep(chLen + " chapters detected across " + allPages.length + " pages"));
    }

    if (stepId === "study_type") {
      var sug = suggestPaperType(allPages);
      var pt = (sug && sug.key) || ts.paperType || "obs";
      var clId = ta.checklistIdForPaperType(pt);
      saveThesis(tpid, { paperType: pt, checklist: clId });
      ts = loadThesis(tpid);
      return Promise.resolve(finishStep(labelFor(pt) + (sug && sug.reason ? (": " + sug.reason) : "")));
    }

    if (stepId === "journals") {
      var catP = (SMD && SMD.api)
        ? SMD.api.request("GET", "/v1/journals?catalogue=1").catch(function () { return null; })
        : Promise.resolve(null);
      return catP.then(function (catRes) {
        var catalogue = (catRes && Array.isArray(catRes.journals) && catRes.journals.length) ? catRes.journals : ta.FALLBACK_JOURNALS;
        var ranked = ta.rankTargetJournals(catalogue, [], {
          paperType: ts.paperType || "obs",
          pages: allPages,
          title: proj.title || ts.filename || ""
        });
        a.specialty = ranked.specialty;
        a.topJournals = ranked.top3;
        var chosen = ranked.best;
        if (a.selectedJournalId) {
          for (var ji = 0; ji < ranked.top3.length; ji++) {
            if (ranked.top3[ji].id === a.selectedJournalId) { chosen = ranked.top3[ji]; break; }
          }
        }
        a.selectedJournalId = chosen.id;
        saveThesis(tpid, { journal: copyJournal(chosen) });
        syncProjectJournal(tpid, chosen);
        ts = loadThesis(tpid);
        var treeJ = ensureChapterTree();
        var mapJ = mapChaptersToJournal(treeJ, allPages, chosen, ts.paperType, ts.chapterMap || {});
        a.estimated = ta.estimateAutoCost(allPages, mapJ, chosen);
        return finishStep("Preselected " + (chosen.shortName || chosen.name) + " (" + chosen.wordLimit + "w, " + chosen.fitReason + ")");
      });
    }

    if (stepId === "draft") {
      var stShim = { busy: false, error: null, drafted: {}, notice: null };
      var useResume = !opts.freshDraft;
      if (opts.freshDraft) {
        saveThesis(tpid, { sectionStatus: null });
        ts = loadThesis(tpid);
      }
      return orchestrateThesisDraft(container, stShim, proj, {
        resume: useResume,
        shouldStop: function () { return !!autoStopFlag; },
        onProgress: function (info) {
          if (info && info.aiCalls != null) {
            a.steps.draft.detail = "Drafting sections (" + (info.doneCount || 0) + "/6)...";
          }
        }
      }).then(function (res) {
        var runCalls = (res && res.draft && res.draft._aiCalls) || 0;
        var runInr = Number((res && res.draft && res.draft._costInr) || (res && res.costInr) || 0);
        if (res && res.model) a.lastModel = res.model;
        if (res && res.stopped) {
          var prevCallsS = Number((a.steps.draft && a.steps.draft.aiCalls) || 0) + runCalls;
          var prevInrS = Number((a.steps.draft && a.steps.draft.costInr) || 0) + runInr;
          a.steps.draft = {
            status: "stopped",
            detail: "Paused by user; partial sections saved",
            durationMs: Date.now() - t0,
            aiCalls: prevCallsS,
            costInr: Math.round(prevInrS * 10000) / 10000,
            maikTokens: Math.round(prevInrS * ((ta && ta.MT_PER_INR) || 2000))
          };
          a.status = "stopped";
          saveAutoState(a);
          paintAutoScreen(container, a, proj);
          return null;
        }
        var draftResSecs = (res && res.draft && res.draft.sections) || [];
        var nonEmptySecs = 0;
        for (var ds = 0; ds < draftResSecs.length; ds++) {
          if (draftResSecs[ds] && countWords(draftResSecs[ds].text) > 0) nonEmptySecs++;
        }
        if (nonEmptySecs === 0) {
          if (res && res._error) throw res._error;
          throw new Error("Could not draft manuscript sections (no AI response). No failed call was charged.");
        }
        applyDraft(res.draft, stShim);
        ts = loadThesis(tpid);
        a.approved = false;
        a.approvedAt = "";
        var secsNow = (ts.draft && ts.draft.sections) || [];
        mirrorDraftLocal(tpid, secsNow);
        if (res && res.draft && res.draft._missingSections && res.draft._missingSections.length) {
          var prevCallsP = Number((a.steps.draft && a.steps.draft.aiCalls) || 0) + runCalls;
          var prevInrP = Number((a.steps.draft && a.steps.draft.costInr) || 0) + runInr;
          a.steps.draft = {
            status: "failed",
            detail: "Some sections failed (" + res.draft._missingSections.join(", ") + "); succeeded calls recorded",
            durationMs: Date.now() - t0,
            aiCalls: prevCallsP,
            costInr: Math.round(prevInrP * 10000) / 10000,
            maikTokens: Math.round(prevInrP * ((ta && ta.MT_PER_INR) || 2000))
          };
          a.status = "error";
          a.lastError = "Some sections failed: " + res.draft._missingSections.join(", ") + ". Failed calls were not charged.";
          saveAutoState(a);
          paintAutoScreen(container, a, proj);
          throw new Error(a.lastError);
        }
        return finishStep(((ts.draft && ts.draft.words) || 0) + " words across " + ((ts.draft && ts.draft.aiDraftedIds && ts.draft.aiDraftedIds.length) || 0) + " sections", runCalls, runInr);
      }).catch(function (err) {
        if (err && err._handledByConsent) {
          a.steps.draft.status = "stopped";
          a.steps.draft.durationMs = Date.now() - t0;
          a.steps.draft.detail = "Confirm patient-details check to continue";
          a.status = "stopped";
          a.lastError = "Please confirm there are no patient details in your thesis to continue AI drafting.";
          saveAutoState(a);
          paintAutoScreen(container, a, proj);
          openConsentSheet(err._phiConsentInfo || (ts && ts.phi) || { softPages: [1], maskedCount: 0, findings: [] }, {
            onConfirm: function () { runAutoChain(container, 3, { preserveEdits: true }); },
            onReupload: function () { if (SMD && SMD.navigate) SMD.navigate("thesis"); }
          });
          throw err;
        }
        var isCap = isQuotaCapError(err);
        a.steps.draft.status = isCap ? "stopped" : "failed";
        a.steps.draft.durationMs = Date.now() - t0;
        a.steps.draft.detail = isCap ? "Paused at MaiK quota/cap (progress saved)" : ((err && err.message) || "Draft failed (not charged)");
        a.status = isCap ? "stopped" : "error";
        a.lastError = isCap
          ? "Paused at MaiK daily cap or low credit balance. Your saved sections remain intact; Continue later."
          : ((err && err.message) || "Could not complete drafting. No failed call was charged.");
        saveAutoState(a);
        paintAutoScreen(container, a, proj);
        throw err;
      });
    }

    if (stepId === "tables") {
      var jrT = selectedAutoJournal(a);
      var secsT = (ts.draft && ts.draft.sections) || [];
      var treeT = ensureChapterTree();
      var mapT = mapChaptersToJournal(treeT, allPages, jrT, ts.paperType, ts.chapterMap || {});
      var resSrc = (mapT.bySection && mapT.bySection.results && mapT.bySection.results.pages && mapT.bySection.results.pages.length)
        ? mapT.bySection.results.pages
        : allPages;
      var rawTables = extractThesisTables(resSrc);
      if (!rawTables.length) rawTables = extractThesisTables(allPages);
      var condensed = ta.condenseTables(rawTables, allPages, jrT, secsT);
      a.tablesData = {
        kept: condensed.kept,
        droppedCount: condensed.droppedCount,
        totalFound: condensed.totalFound,
        limit: condensed.limit,
        renameMap: condensed.renameMap
      };
      var draftCopyT = ts.draft ? JSON.parse(JSON.stringify(ts.draft)) : { sections: secsT };
      draftCopyT.sections = condensed.sections;
      draftCopyT.tables = condensed.kept;
      saveThesis(tpid, { draft: draftCopyT, tablePicks: condensed.kept.map(function (t) { return t.id; }) });
      ts = loadThesis(tpid);
      return Promise.resolve(finishStep(condensed.kept.length + " of " + condensed.totalFound + " table(s) kept (limit " + condensed.limit + ")"));
    }

    if (stepId === "references") {
      var jrR = selectedAutoJournal(a);
      var secsR = (ts.draft && ts.draft.sections) || [];
      var treeR = ensureChapterTree();
      var mapR = mapChaptersToJournal(treeR, allPages, jrR, ts.paperType, ts.chapterMap || {});
      var allBib = extractThesisReferences(allPages, {
        refPages: (mapR.bySection && mapR.bySection.references && mapR.bySection.references.pages) || []
      });
      var built = ta.buildJournalReferences(allBib, secsR, jrR);
      var fetchFn = (G && typeof G.fetch === "function") ? G.fetch.bind(G) : null;
      return ta.verifyReferencesOnline(built.references, fetchFn, { journal: jrR }).then(function (ver) {
        a.refsData = {
          references: ver.references,
          totalBibliography: built.totalBibliography,
          citedCount: built.citedCount,
          maxReferences: built.maxReferences,
          overLimit: built.overLimit,
          verifiedCount: ver.verifiedCount,
          totalCount: ver.totalCount,
          unverifiedIndices: ver.unverifiedIndices
        };
        var draftCopyR = ts.draft ? JSON.parse(JSON.stringify(ts.draft)) : { sections: built.sections };
        draftCopyR.sections = built.sections;
        draftCopyR.references = ver.references;
        saveThesis(tpid, { draft: draftCopyR });
        mirrorDraftLocal(tpid, built.sections);
        ts = loadThesis(tpid);
        return finishStep(ver.verifiedCount + " of " + ver.totalCount + " cited reference(s) verified (" + String(jrR.referenceStyle || "vancouver").toUpperCase() + ")");
      });
    }

    if (stepId === "title_page") {
      var jrTP = selectedAutoJournal(a);
      var secsTP = (ts.draft && ts.draft.sections) || [];
      var prevTP = a.titlePage;
      var tpNew = ta.buildTitlePage({
        pages: allPages,
        sections: secsTP,
        user: autoUserProfile(),
        project: proj,
        journal: jrTP,
        tablesCount: (a.tablesData && a.tablesData.kept && a.tablesData.kept.length) || 0,
        referencesCount: (a.refsData && a.refsData.totalCount) || 0
      });
      if (prevTP && opts.preserveEdits) {
        if (prevTP.title) tpNew.title = prevTP.title;
        if (prevTP.shortTitle) tpNew.shortTitle = prevTP.shortTitle;
        if (prevTP.authors && prevTP.authors.length) tpNew.authors = prevTP.authors;
        if (prevTP.correspondingAuthor) tpNew.correspondingAuthor = prevTP.correspondingAuthor;
        if (prevTP.affiliations) tpNew.affiliations = prevTP.affiliations;
      }
      a.titlePage = tpNew;
      return Promise.resolve(finishStep(tpNew.hasPlaceholders ? "Built with [Confirm ...] placeholders" : "Title page populated from thesis + profile"));
    }

    if (stepId === "abstract_keywords") {
      var jrAK = selectedAutoJournal(a);
      var secsAK = (ts.draft && ts.draft.sections) || [];
      var absText = "";
      for (var ai = 0; ai < secsAK.length; ai++) {
        if (secsAK[ai] && secsAK[ai].id === "abstract") { absText = String(secsAK[ai].text || ""); break; }
      }
      var cands = ta.extractKeywordCandidates((a.titlePage && a.titlePage.title) || proj.title || "", absText, secsAK);
      var fetchKw = (G && typeof G.fetch === "function") ? G.fetch.bind(G) : null;
      return ta.verifyKeywordsMesh(cands, fetchKw).then(function (kwRes) {
        a.keywords = kwRes || [];
        var meshHit = 0;
        for (var ki = 0; ki < a.keywords.length; ki++) if (a.keywords[ki].meshVerified) meshHit++;
        return finishStep("Abstract " + countWords(absText) + "/" + (jrAK.abstractLimit || 250) + "w; " + a.keywords.length + " keywords (" + meshHit + " MeSH)");
      });
    }

    if (stepId === "declarations") {
      var prevDecl = a.declarations;
      var declNew = ta.buildDeclarationsAndCredit({
        pages: allPages,
        titlePage: a.titlePage || {},
        aiProvenance: {
          aiUsed: (a.actualAiCalls || 0) > 0,
          draftAi: true,
          models: a.lastModel ? [a.lastModel] : ["MaiK"],
          scope: "condensed uploaded thesis chapters into target journal manuscript",
          verifiedByAuthor: !!a.approved
        }
      });
      if (prevDecl && opts.preserveEdits) {
        if (prevDecl.ethics && prevDecl.ethics.iecNumber) declNew.ethics = prevDecl.ethics;
        if (prevDecl.funding && prevDecl.funding.text) declNew.funding = prevDecl.funding;
        if (prevDecl.conflicts && prevDecl.conflicts.text) declNew.conflicts = prevDecl.conflicts;
        if (prevDecl.credit && prevDecl.credit.text) declNew.credit = prevDecl.credit;
        if (prevDecl.registration) declNew.registration = prevDecl.registration;
      }
      a.declarations = declNew;
      var iecMsg = (declNew.ethics && declNew.ethics.iecNumber) ? ("IEC " + declNew.ethics.iecNumber) : "Confirm IEC & funding";
      return Promise.resolve(finishStep(iecMsg + "; CRediT + AI disclosure prepared"));
    }

    if (stepId === "checklist") {
      var clIdStep = ta.checklistIdForPaperType(ts.paperType || "obs");
      var clFetch = (SMD && SMD.api)
        ? SMD.api.request("GET", "/v1/checklists/" + encodeURIComponent(clIdStep)).catch(function () { return null; })
        : Promise.resolve(null);
      return clFetch.then(function (clRes) {
        var def = (clRes && (clRes.checklist || clRes)) || null;
        var secsC = (ts.draft && ts.draft.sections) || [];
        a.checklistPrefill = ta.prefillChecklist(def, ts.paperType || "obs", secsC, a.declarations || {}, a.titlePage || {});
        return finishStep(a.checklistPrefill.guidelineName + ": " + a.checklistPrefill.covered + "/" + a.checklistPrefill.total + " items covered");
      });
    }

    if (stepId === "format_check") {
      var jrFC = selectedAutoJournal(a);
      var secsFC = (ts.draft && ts.draft.sections) || [];
      a.formatCheck = ta.runFormatCheck({
        journal: jrFC,
        sections: secsFC,
        references: (a.refsData && a.refsData.references) || [],
        tables: (a.tablesData && a.tablesData.kept) || [],
        keywords: a.keywords || [],
        declarations: a.declarations || {},
        checklistPrefill: a.checklistPrefill || {},
        titlePage: a.titlePage || {}
      });
      return finishStep(a.formatCheck.passCount + " pass, " + a.formatCheck.warnCount + " warn, " + a.formatCheck.failCount + " fail");
    }

    if (stepId === "cover_letter") {
      var jrCL = selectedAutoJournal(a);
      var secsCL = (ts.draft && ts.draft.sections) || [];
      a.coverLetterText = ta.buildCoverLetter({
        titlePage: a.titlePage || {},
        journal: jrCL,
        declarations: a.declarations || {},
        sections: secsCL,
        paperTypeLabel: labelFor(ts.paperType || "obs")
      });
      return syncManuscriptToServer(secsCL, { approve: false }).then(function () {
        return finishStep("Cover letter drafted for " + (jrCL.shortName || jrCL.name));
      });
    }

    return Promise.resolve(a);
  }

  function runAutoChain(container, startIdx, opts) {
    opts = opts || {};
    var ta = TA();
    if (!ta) return Promise.resolve();
    var order = ta.STEP_ORDER || [];
    var myTok = ++autoRunToken;
    autoStopFlag = false;
    var a = ensureAutoState();
    a.status = "running";
    a.lastError = null;
    saveAutoState(a);
    paintAutoScreen(container, a, activeProject());

    var chain = Promise.resolve();
    for (var i = startIdx; i < order.length; i++) {
      (function (idx, sDef) {
        chain = chain.then(function () {
          if (myTok !== autoRunToken) return null;
          a = ensureAutoState();
          if (autoStopFlag) {
            a.status = "stopped";
            saveAutoState(a);
            paintAutoScreen(container, a, activeProject());
            return null;
          }
          if (opts.onlyIds && opts.onlyIds.indexOf(sDef.id) < 0) return null;
          if (!opts.forceAll && a.steps[sDef.id] && a.steps[sDef.id].status === "done" && idx !== startIdx) {
            return null;
          }
          if (sDef.id === "draft" && a.steps.draft && a.steps.draft.status === "done" && !opts.freshDraft) {
            return null;
          }
          return runSingleAutoStep(container, sDef.id, a, opts);
        });
      })(i, order[i]);
    }

    return chain.then(function () {
      if (myTok !== autoRunToken) return;
      a = ensureAutoState();
      if (autoStopFlag || a.status === "stopped") {
        a.status = "stopped";
        saveAutoState(a);
        paintAutoScreen(container, a, activeProject());
        return;
      }
      var allDone = true;
      for (var k = 0; k < order.length; k++) {
        if (!a.steps[order[k].id] || a.steps[order[k].id].status !== "done") { allDone = false; break; }
      }
      a.status = allDone ? (a.approved ? "approved" : "review") : "stopped";
      saveAutoState(a);
      paintAutoScreen(container, a, activeProject());
    }).catch(function () {
      if (myTok !== autoRunToken) return;
      a = ensureAutoState();
      if (a.status === "running") {
        a.status = "error";
        saveAutoState(a);
      }
      paintAutoScreen(container, a, activeProject());
    });
  }

  function exportAutoFile(container, kind) {
    var ta = TA();
    var a = ensureAutoState();
    var jr = selectedAutoJournal(a);
    var secs = (ts.draft && ts.draft.sections) || [];
    var refs = (a.refsData && a.refsData.references) || [];
    var tables = (a.tablesData && a.tablesData.kept) || [];
    var tp = a.titlePage || {};
    var decl = a.declarations || {};
    var cl = a.checklistPrefill || {};
    var slug = (SMD && SMD.p2 && SMD.p2.fileSlug) ? SMD.p2.fileSlug(tp.title || ts.filename || "manuscript", "manuscript") : "manuscript";
    var pack = ta.buildSubmissionPackageFiles({
      title: tp.title || ts.filename,
      journal: jr,
      sections: secs,
      references: refs,
      tables: tables,
      titlePage: tp,
      declarations: decl,
      checklistPrefill: cl,
      coverLetterText: a.coverLetterText,
      approved: !!a.approved,
      approvedAt: a.approvedAt || "",
      aiProvenance: {
        aiUsed: (a.actualAiCalls || 0) > 0,
        models: a.lastModel ? [a.lastModel] : ["MaiK"],
        scope: "thesis-to-journal conversion",
        verifiedByAuthor: !!a.approved
      }
    });

    var dl = SMD && SMD.p2 && SMD.p2.downloadBytes;
    if (!dl) return;
    if (kind === "zip") {
      dl(slug + "-submission-package.zip", new Uint8Array(pack.zipBytes), "application/zip", (tp.title || "Submission package"));
      if (SMD.p2.flashNotice) SMD.p2.flashNotice(container, "Exported full submission package (.zip).", "info");
      return;
    }
    var mapIdx = {
      title_page: 0,
      manuscript: 1,
      tables: 2,
      cover_letter: 3,
      checklist_docx: 4,
      checklist_pdf: 5,
      references_ris: 6
    };
    var entry = pack.files[mapIdx[kind]];
    if (!entry) return;
    dl(slug + "-" + entry.name, new Uint8Array(entry.data), entry.mime, entry.name);
  }

  function paintAutoScreen(container, a, proj) {
    if (!container) return;
    container.innerHTML = renderAutoScreenHtml(a, proj);
    bindAutoScreenEvents(container);
  }

  function syncInlineFieldsToAuto(container, a) {
    if (!a.titlePage) a.titlePage = { authors: [{ name: "" }, { name: "" }], affiliations: [""], correspondingAuthor: {} };
    var tp = a.titlePage;
    var vTitle = container.querySelector("#rmdAutoTitleIn");
    var vShort = container.querySelector("#rmdAutoShortTitleIn");
    var vA1 = container.querySelector("#rmdAutoAuth1In");
    var vA2 = container.querySelector("#rmdAutoAuth2In");
    var vEmail = container.querySelector("#rmdAutoEmailIn");
    var vAff = container.querySelector("#rmdAutoAffilIn");
    if (vTitle) tp.title = vTitle.value;
    if (vShort) tp.shortTitle = vShort.value;
    if (vA1) {
      if (!tp.authors[0]) tp.authors[0] = { affiliationNum: 1, isCorresponding: true };
      tp.authors[0].name = vA1.value;
      if (tp.correspondingAuthor) tp.correspondingAuthor.name = vA1.value;
    }
    if (vA2) {
      if (!tp.authors[1]) tp.authors[1] = { affiliationNum: 1, isCorresponding: false };
      tp.authors[1].name = vA2.value;
    }
    if (vEmail && tp.correspondingAuthor) tp.correspondingAuthor.email = vEmail.value;
    if (vAff) {
      if (tp.correspondingAuthor) tp.correspondingAuthor.affiliation = vAff.value;
      tp.affiliations = ["1. " + vAff.value];
    }
    var allText = [tp.title, tp.shortTitle, tp.authors[0] && tp.authors[0].name, tp.authors[1] && tp.authors[1].name, tp.correspondingAuthor && tp.correspondingAuthor.email, tp.correspondingAuthor && tp.correspondingAuthor.affiliation].join(" ");
    tp.hasPlaceholders = allText.indexOf("[Confirm") >= 0;

    if (!a.declarations) a.declarations = { ethics: {}, consent: {}, funding: {}, conflicts: {}, credit: {} };
    var decl = a.declarations;
    var vIec = container.querySelector("#rmdAutoIecIn");
    var vReg = container.querySelector("#rmdAutoRegIn");
    var vFund = container.querySelector("#rmdAutoFundingIn");
    var vConf = container.querySelector("#rmdAutoConflictsIn");
    var vCred = container.querySelector("#rmdAutoCreditIn");
    if (vIec) {
      decl.ethics = decl.ethics || {};
      decl.ethics.iecNumber = vIec.value.replace(/^\s+|\s+$/g, "");
      if (decl.ethics.iecNumber) decl.ethics.text = "Ethical approval was obtained (reference: " + decl.ethics.iecNumber + ").";
    }
    if (vReg) decl.registration = vReg.value.replace(/^\s+|\s+$/g, "");
    if (vFund && decl.funding) decl.funding.text = vFund.value;
    if (vConf && decl.conflicts) decl.conflicts.text = vConf.value;
    if (vCred && decl.credit) decl.credit.text = vCred.value;
  }

  function refreshAutoReadyDom(container, a) {
    var rows = renderAutoChecklistRows(a);
    var cards = {
      title_page: "#rmdAutoTitleCard",
      ethics: "#rmdAutoDeclCard",
      declarations: "#rmdAutoDeclCard",
      references: "#rmdAutoRefsCard"
    };
    var summary = container.querySelector("#rmdAutoReadySummary");
    if (summary) {
      for (var i = 0; i < rows.length; i++) {
        var li = summary.querySelector('[data-ready-item="' + rows[i].id + '"]');
        if (li) {
          li.setAttribute("data-ready-state", rows[i].ready ? "green" : "amber");
          var pill = li.querySelector(".rmd-auto-pill");
          var note = li.querySelector(".rmd-auto-step-detail");
          if (pill) {
            pill.className = "rmd-auto-pill " + (rows[i].ready ? "is-done" : "is-warn");
            pill.textContent = rows[i].ready ? "Green: Ready" : "Amber: Confirm";
          }
          if (note) note.textContent = rows[i].note;
        }
      }
    }
    for (var k in cards) {
      if (!Object.prototype.hasOwnProperty.call(cards, k)) continue;
      var card = container.querySelector(cards[k]);
      if (card) {
        var ok = (k === "ethics" || k === "declarations") ? (rows[1].ready && rows[2].ready) : (k === "title_page" ? rows[0].ready : rows[3].ready);
        card.setAttribute("data-readiness", ok ? "green" : "amber");
      }
    }
  }

  function bindAutoScreenEvents(container) {
    var stopBtn = container.querySelector("#rmdAutoStopBtn");
    if (stopBtn) stopBtn.onclick = function () {
      autoStopFlag = true;
      stopBtn.disabled = true;
      stopBtn.textContent = "Stopping...";
    };

    var contBtn = container.querySelector("#rmdAutoContinueBtn");
    if (contBtn) contBtn.onclick = function () {
      var ta = TA();
      var order = (ta && ta.STEP_ORDER) || [];
      var a = ensureAutoState();
      var startAt = 0;
      for (var i = 0; i < order.length; i++) {
        if (!a.steps[order[i].id] || a.steps[order[i].id].status !== "done") { startAt = i; break; }
      }
      runAutoChain(container, startAt, { preserveEdits: true });
    };

    var backBtn = container.querySelector("#rmdAutoBackThesis");
    if (backBtn) backBtn.onclick = function () {
      if (SMD && SMD.navigate) SMD.navigate("thesis");
    };

    var reruns = container.querySelectorAll("[data-rmd-auto-rerun]");
    for (var r = 0; r < reruns.length; r++) {
      reruns[r].onclick = function () {
        var sid = this.getAttribute("data-rmd-auto-rerun");
        var ta = TA();
        var order = (ta && ta.STEP_ORDER) || [];
        var idx = 0;
        for (var k = 0; k < order.length; k++) if (order[k].id === sid) { idx = k; break; }
        var opts = { preserveEdits: true };
        if (sid === "draft") {
          opts.freshDraft = true;
          opts.onlyIds = ["draft", "tables", "references", "title_page", "abstract_keywords", "declarations", "checklist", "format_check", "cover_letter"];
          opts.forceAll = true;
        } else if (sid === "journals") {
          opts.onlyIds = ["journals", "tables", "references", "title_page", "abstract_keywords", "checklist", "format_check", "cover_letter"];
          opts.forceAll = true;
        } else {
          opts.onlyIds = [sid];
          opts.forceAll = true;
        }
        runAutoChain(container, idx, opts);
      };
    }

    var jCards = container.querySelectorAll("[data-rmd-auto-journal]");
    for (var j = 0; j < jCards.length; j++) {
      jCards[j].onclick = function () {
        var jid = this.getAttribute("data-rmd-auto-journal");
        var a = ensureAutoState();
        a.selectedJournalId = jid;
        a.approved = false;
        a.approvedAt = "";
        var chosen = selectedAutoJournal(a);
        saveThesis(tpid, { journal: copyJournal(chosen) });
        syncProjectJournal(tpid, chosen);
        saveAutoState(a);
        runAutoChain(container, 4, {
          onlyIds: ["tables", "references", "title_page", "abstract_keywords", "checklist", "format_check", "cover_letter"],
          forceAll: true,
          preserveEdits: true
        });
      };
    }

    var textInputs = container.querySelectorAll("#rmdAutoTitleCard input[type], #rmdAutoDeclCard input[type]");
    for (var t = 0; t < textInputs.length; t++) {
      if (textInputs[t].type === "checkbox") continue;
      textInputs[t].oninput = function () {
        var a = ensureAutoState();
        syncInlineFieldsToAuto(container, a);
        saveAutoState(a);
        refreshAutoReadyDom(container, a);
      };
    }

    var confirms = container.querySelectorAll("[data-rmd-auto-confirm]");
    for (var c = 0; c < confirms.length; c++) {
      confirms[c].onchange = function () {
        var key = this.getAttribute("data-rmd-auto-confirm");
        var a = ensureAutoState();
        syncInlineFieldsToAuto(container, a);
        a.confirmations[key] = !!this.checked;
        saveAutoState(a);
        refreshAutoReadyDom(container, a);
      };
    }

    var appBtn = container.querySelector("#rmdAutoApproveBtn");
    if (appBtn) appBtn.onclick = function () {
      var a = ensureAutoState();
      syncInlineFieldsToAuto(container, a);
      var ta = TA();
      if (ta && a.declarations && a.declarations.aiDisclosure) {
        a.declarations.aiDisclosure.text = ta.buildAiDisclosure({
          aiUsed: (a.actualAiCalls || 0) > 0,
          models: a.lastModel ? [a.lastModel] : ["MaiK"],
          scope: "condensed thesis chapters into target journal manuscript",
          verifiedByAuthor: true
        });
      }
      a.coverLetterText = ta.buildCoverLetter({
        titlePage: a.titlePage || {},
        journal: selectedAutoJournal(a),
        declarations: a.declarations || {},
        sections: (ts.draft && ts.draft.sections) || [],
        paperTypeLabel: labelFor(ts.paperType || "obs")
      });
      appBtn.disabled = true;
      appBtn.textContent = "Approving...";
      var secs = (ts.draft && ts.draft.sections) || [];
      syncManuscriptToServer(secs, { approve: true }).then(function () {
        a.approved = true;
        a.approvedAt = new Date().toISOString();
        a.status = "approved";
        saveAutoState(a);
        paintAutoScreen(container, a, activeProject());
        if (SMD && SMD.p2 && SMD.p2.flashNotice) {
          SMD.p2.flashNotice(container, "Marked final and ready to export submission package.", "info");
        }
      });
    };

    var openMs = container.querySelector("#rmdAutoOpenManuscript");
    if (openMs) openMs.onclick = function () {
      if (SMD && SMD.navigate) SMD.navigate("manuscript");
    };

    var zipBtn = container.querySelector("#rmdAutoExportPackBtn");
    if (zipBtn) zipBtn.onclick = function () {
      exportAutoFile(container, "zip");
    };

    var indBtns = container.querySelectorAll("[data-rmd-auto-export]");
    for (var b = 0; b < indBtns.length; b++) {
      indBtns[b].onclick = function () {
        exportAutoFile(container, this.getAttribute("data-rmd-auto-export"));
      };
    }
  }

  function renderThesisAuto(container, params) {
    var proj = activeProject();
    if (!proj) { container.innerHTML = SMD.p2.errHtml("Open a project first."); return; }
    tpid = pidOf(proj);
    ts = loadThesis(tpid);
    injectCSS();
    if (!ts || !ts.pages || !ts.pages.length) {
      container.innerHTML = '<div class="rmd-panel"><div class="rmd-card"><h2 class="rmd-h2">Make My Journal Paper</h2><p class="rmd-muted">Upload your thesis PDF or Word (.docx) first, then tap Make my journal paper.</p><div class="rmd-card-actions"><button type="button" class="rmd-btn rmd-btn-primary" id="rmdAutoUploadFirst">Go to upload</button></div></div></div>';
      var upBtn = container.querySelector("#rmdAutoUploadFirst");
      if (upBtn) upBtn.onclick = function () { if (SMD && SMD.navigate) SMD.navigate("thesis"); };
      return;
    }
    var a = ensureAutoState();
    saveAutoState(a);
    paintAutoScreen(container, a, proj);
    if (params && params.autoStart && a.status !== "review" && a.status !== "approved") {
      var ta = TA();
      var order = (ta && ta.STEP_ORDER) || [];
      var startAt = 0;
      for (var i = 0; i < order.length; i++) {
        if (!a.steps[order[i].id] || a.steps[order[i].id].status !== "done") { startAt = i; break; }
      }
      runAutoChain(container, startAt, { preserveEdits: true });
    }
  }

  /* ---------- registration + export ---------- */

  if (SMD) {
    SMD.screens = SMD.screens || {};
    SMD.screens.thesis = { render: renderUpload };
    SMD.screens["thesis-auto"] = { render: renderThesisAuto };
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
    abstractLimitOf: abstractLimitOf,
    suggestPaperType: suggestPaperType,
    segmentThesisChapters: segmentThesisChapters,
    detectThesisHeadings: detectThesisHeadings,
    buildChapterTree: buildChapterTree,
    sliceChapterPages: sliceChapterPages,
    journalHeadingsFor: journalHeadingsFor,
    mapChaptersToJournal: mapChaptersToJournal,
    runBoundedPool: runBoundedPool,
    chunkPagesByChars: chunkPagesByChars,
    extractThesisTables: extractThesisTables,
    extractThesisReferences: extractThesisReferences,
    referenceFlags: referenceFlags,
    formatReference: formatReference,
    suggestTables: suggestTables,
    canRunAi: canRunAi,
    aiGate: aiGate,
    scanThesisPages: scanThesisPages,
    countWords: countWords,
    parseDocx: parseDocx,
    readZipEntries: readZipEntries,
    rustToThesisPages: rustToThesisPages,
    extractDocxXmlBlocks: extractDocxXmlBlocks,
    paginateBlocks: paginateBlocks,
    handleFile: handleFile,
    sectionHtml: sectionHtml,
    journalView: journalView,
    journalRowHtml: journalRowHtml,
    normJournal: normJournal,
    pendingSave: function () { return pendingSavePromise || Promise.resolve(true); },
    PAPER_TYPES: PAPER_TYPES,
    DEFAULT_JOURNAL: DEFAULT_JOURNAL
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.SMD_RESEARCH_THESIS = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));