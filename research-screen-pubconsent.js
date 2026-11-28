/* StewardMD - ResearchMD pubconsent screen.
 * ES5 IIFE. Registers SMD.screens.pubconsent.
 * Consent for publication for case reports.
 * Rich-text consent editor with multilingual/RTL support and DOCX export.
 * No em or en dashes.
 */
(function (G) {
  "use strict";
  var D = G && G.document;
  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};
  var KEY = "pubconsent";
  var MAX_HTML = 200000;

  var SIZE_CLASSES = {
    "rmd-ce-sz-sm": 1,
    "rmd-ce-sz-md": 1,
    "rmd-ce-sz-lg": 1
  };
  var SIZE_HALF_PTS = {
    "rmd-ce-sz-sm": 18,
    "rmd-ce-sz-md": 22,
    "rmd-ce-sz-lg": 28
  };
  var ALLOWED_TAGS = {
    B: 1, STRONG: 1, I: 1, EM: 1, U: 1, H2: 1, H3: 1,
    P: 1, DIV: 1, BR: 1, UL: 1, OL: 1, LI: 1, SPAN: 1
  };
  var ALIGN_TAGS = { P: 1, DIV: 1, H2: 1, H3: 1 };
  var DROP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, IFRAME: 1, OBJECT: 1,
    EMBED: 1, SVG: 1, MATH: 1, TEMPLATE: 1, FORM: 1, INPUT: 1,
    TEXTAREA: 1, SELECT: 1, OPTION: 1, BUTTON: 1, IMG: 1,
    PICTURE: 1, VIDEO: 1, AUDIO: 1, SOURCE: 1, CANVAS: 1,
    MAP: 1, AREA: 1, LINK: 1, META: 1, BASE: 1
  };

  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function trim(s) {
    return s == null ? "" : String(s).replace(/^\s+|\s+$/g, "");
  }

  function decodeEntities(s) {
    return String(s == null ? "" : s)
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, function (m, n) {
        return String.fromCharCode(parseInt(n, 10));
      })
      .replace(/&amp;/gi, "&");
  }

  function labelFor(name) {
    var C = G.SMD_RESEARCH_CONTRACTS;
    var labels = {
      plan: "Plan",
      protocol: "Protocol",
      masterchart: "Master chart",
      manuscript: "Manuscript",
      checklist: "Checklist",
      ready: "Submit",
      casefile: "Case file",
      novelty: "Novelty",
      iec: "Ethics committee",
      pubconsent: "Consent for publication",
      images: "Images",
      ctri: "CTRI",
      randomise: "Randomise",
      consort: "CONSORT flow",
      backup: "Backup"
    };
    if (C && C.STEP_LABELS && C.STEP_LABELS[name]) return C.STEP_LABELS[name];
    return labels[name] || name;
  }

  var LANGUAGES = [
    { code: "en", name: "English", script: "Latin", dir: "ltr" },
    { code: "te", name: "Telugu", script: "Telugu", dir: "ltr" },
    { code: "hi", name: "Hindi", script: "Devanagari", dir: "ltr" },
    { code: "kn", name: "Kannada", script: "Kannada", dir: "ltr" },
    { code: "ta", name: "Tamil", script: "Tamil", dir: "ltr" },
    { code: "ml", name: "Malayalam", script: "Malayalam", dir: "ltr" },
    { code: "gu", name: "Gujarati", script: "Gujarati", dir: "ltr" },
    { code: "bn", name: "Bengali", script: "Bengali", dir: "ltr" },
    { code: "ur", name: "Urdu", script: "Perso-Arabic Nastaliq", dir: "rtl" },
    { code: "mr", name: "Marathi", script: "Devanagari", dir: "ltr" }
  ];

  function langCodeFor(lang) {
    var l = String(lang || "").toLowerCase();
    for (var i = 0; i < LANGUAGES.length; i++) {
      if (LANGUAGES[i].code === l || LANGUAGES[i].name.toLowerCase() === l) {
        return LANGUAGES[i].code;
      }
    }
    return "en";
  }

  function langNameFor(lang) {
    var l = String(lang || "").toLowerCase();
    for (var i = 0; i < LANGUAGES.length; i++) {
      if (LANGUAGES[i].code === l || LANGUAGES[i].name.toLowerCase() === l) {
        return LANGUAGES[i].name;
      }
    }
    return "English";
  }

  function fontStackFor(lang) {
    var code = langCodeFor(lang);
    if (code === "ur") return "'Noto Nastaliq Urdu', 'Noto Sans Arabic', system-ui, sans-serif";
    if (code === "te") return "'Noto Sans Telugu', system-ui, sans-serif";
    if (code === "hi" || code === "mr") return "'Noto Sans Devanagari', system-ui, sans-serif";
    if (code === "kn") return "'Noto Sans Kannada', system-ui, sans-serif";
    if (code === "ta") return "'Noto Sans Tamil', system-ui, sans-serif";
    if (code === "ml") return "'Noto Sans Malayalam', system-ui, sans-serif";
    if (code === "gu") return "'Noto Sans Gujarati', system-ui, sans-serif";
    if (code === "bn") return "'Noto Sans Bengali', system-ui, sans-serif";
    return "inherit";
  }

  function isRtlLang(lang) {
    return langCodeFor(lang) === "ur";
  }

  var consentTemplatesCache = null;
  function getConsentTemplates(cb) {
    if (consentTemplatesCache) {
      if (cb) cb(consentTemplatesCache);
      return;
    }
    var finish = function (data) {
      if (data && typeof data === "object") consentTemplatesCache = data;
      if (cb) cb(consentTemplatesCache);
    };
    if (G.SMD_CONTENT && typeof G.SMD_CONTENT.fetchJSON === "function") {
      G.SMD_CONTENT.fetchJSON("data/research-consent-templates.json")
        .then(finish)
        .catch(function () {
          if (typeof fetch !== "function") { if (cb) cb(null); return; }
          fetch("/data/research-consent-templates.json")
            .then(function (res) { return res.json(); })
            .then(finish)
            .catch(function () { if (cb) cb(null); });
        });
      return;
    }
    if (typeof fetch === "function") {
      fetch("/data/research-consent-templates.json")
        .then(function (res) { return res.json(); })
        .then(finish)
        .catch(function () {
          fetch("data/research-consent-templates.json")
            .then(function (r2) { return r2.json(); })
            .then(finish)
            .catch(function () {
              if (cb) cb(null);
            });
        });
    } else if (cb) {
      cb(null);
    }
  }
  getConsentTemplates();

  /* ---------- HTML Sanitisation & Plain-Text Conversion ---------- */

  function extractSizeClass(classStr) {
    if (!classStr) return "";
    var parts = String(classStr).split(/\s+/);
    for (var i = 0; i < parts.length; i++) {
      if (SIZE_CLASSES[parts[i]]) return parts[i];
    }
    return "";
  }

  function extractAlignFromAttrs(styleStr, alignAttr) {
    var s = String(styleStr || "").toLowerCase();
    var m = s.match(/text-align\s*:\s*(left|center|right)\b/);
    if (m) return m[1];
    var a = String(alignAttr || "").toLowerCase().replace(/^\s+|\s+$/g, "");
    if (a === "left" || a === "center" || a === "right") return a;
    return "";
  }

  function extractInlineWraps(styleStr) {
    var style = String(styleStr || "").toLowerCase();
    var wraps = [];
    if (/font-weight\s*:\s*(bold|[6-9]00)\b/.test(style)) wraps.push("b");
    if (/font-style\s*:\s*italic\b/.test(style)) wraps.push("i");
    if (/text-decoration[^;]*underline\b/.test(style)) wraps.push("u");
    return wraps;
  }

  function scanSanitize(raw) {
    var s = String(raw || "").slice(0, MAX_HTML);
    s = s.replace(/<!--[\s\S]*?-->/g, "");
    s = s.replace(/<(script|style|noscript|iframe|object|embed|svg|math|template|form|button|textarea|select|option)\b[\s\S]*?<\/\1\s*>/gi, "");
    s = s.replace(/<(script|style|noscript|iframe|object|embed|svg|math|template|form|button|textarea|select|option|img|picture|video|audio|source|canvas|map|area|link|meta|base|input)\b[^>]*\/?>/gi, "");

    var out = [];
    var spanStack = [];
    var re = /<(\/?)([a-zA-Z0-9]+)(\s[^>]*)?\/?>|([^<]+)/g;
    var m, close, tag, attrs, lower, alignVal, clsMatch, stMatch, wraps, szClass, top, k;

    while ((m = re.exec(s)) !== null) {
      if (m[4] != null) {
        out.push(esc(decodeEntities(m[4])));
        continue;
      }
      close = m[1] === "/";
      tag = m[2].toUpperCase();
      attrs = m[3] || "";
      lower = tag.toLowerCase();

      if (DROP_TAGS[tag]) continue;
      if (!ALLOWED_TAGS[tag]) continue;

      if (tag === "BR") {
        if (!close) out.push("<br>");
        continue;
      }

      if (tag === "SPAN") {
        if (close) {
          top = spanStack.pop();
          if (top) {
            for (k = top.closes.length - 1; k >= 0; k--) {
              out.push("</" + top.closes[k] + ">");
            }
          }
          continue;
        }
        clsMatch = attrs.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
        stMatch = attrs.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
        szClass = extractSizeClass(clsMatch ? (clsMatch[1] || clsMatch[2] || clsMatch[3] || "") : "");
        wraps = extractInlineWraps(stMatch ? (stMatch[1] || stMatch[2] || "") : "");
        var closes = [];
        if (szClass) {
          out.push('<span class="' + szClass + '">');
          closes.push("span");
        }
        for (k = 0; k < wraps.length; k++) {
          out.push("<" + wraps[k] + ">");
          closes.push(wraps[k]);
        }
        spanStack.push({ closes: closes });
        continue;
      }

      if (close) {
        out.push("</" + lower + ">");
        continue;
      }

      if (ALIGN_TAGS[tag]) {
        stMatch = attrs.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
        var alMatch = attrs.match(/\balign\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
        alignVal = extractAlignFromAttrs(
          stMatch ? (stMatch[1] || stMatch[2] || "") : "",
          alMatch ? (alMatch[1] || alMatch[2] || alMatch[3] || "") : ""
        );
        out.push("<" + lower + (alignVal ? ' style="text-align:' + alignVal + '"' : "") + ">");
      } else {
        out.push("<" + lower + ">");
      }
    }
    while (spanStack.length) {
      top = spanStack.pop();
      for (k = top.closes.length - 1; k >= 0; k--) {
        out.push("</" + top.closes[k] + ">");
      }
    }
    return out.join("");
  }

  function sanitizeConsentHtml(html) {
    var raw = String(html == null ? "" : html);
    if (!raw) return "";
    if (raw.length > MAX_HTML) raw = raw.slice(0, MAX_HTML);
    if (!G || !G.DOMParser) return scanSanitize(raw);
    var doc;
    try {
      doc = new G.DOMParser().parseFromString(raw, "text/html");
    } catch (e) {
      return scanSanitize(raw);
    }
    if (!doc || !doc.body) return scanSanitize(raw);

    var out = [];
    function walk(node) {
      var kids = node.childNodes || [];
      var i, c, tag, lower, styleStr, alignVal, szClass, wraps, w, w2;
      for (i = 0; i < kids.length; i++) {
        c = kids[i];
        if (c.nodeType === 3) {
          out.push(esc(c.nodeValue));
        } else if (c.nodeType === 1) {
          tag = String(c.tagName || "").toUpperCase();
          if (DROP_TAGS[tag]) continue;
          if (tag === "BR") {
            out.push("<br>");
          } else if (tag === "SPAN") {
            szClass = extractSizeClass(c.getAttribute ? c.getAttribute("class") : "");
            styleStr = c.getAttribute ? c.getAttribute("style") : "";
            wraps = extractInlineWraps(styleStr);
            if (szClass) out.push('<span class="' + szClass + '">');
            for (w = 0; w < wraps.length; w++) out.push("<" + wraps[w] + ">");
            walk(c);
            for (w2 = wraps.length - 1; w2 >= 0; w2--) out.push("</" + wraps[w2] + ">");
            if (szClass) out.push("</span>");
          } else if (ALLOWED_TAGS[tag]) {
            lower = tag.toLowerCase();
            if (ALIGN_TAGS[tag]) {
              styleStr = c.getAttribute ? c.getAttribute("style") : "";
              alignVal = extractAlignFromAttrs(styleStr, c.getAttribute ? c.getAttribute("align") : "");
              out.push("<" + lower + (alignVal ? ' style="text-align:' + alignVal + '"' : "") + ">");
            } else {
              out.push("<" + lower + ">");
            }
            walk(c);
            out.push("</" + lower + ">");
          } else {
            walk(c);
          }
        }
      }
    }
    walk(doc.body);
    return out.join("");
  }

  function htmlToPlainText(html) {
    if (!html) return "";
    var s = String(html).replace(/\r\n?/g, "\n");
    var out = "";
    var stack = [];
    var counts = [];
    var re = /<(\/?)([a-zA-Z0-9]+)(?:\s[^>]*)?>|([^<]+)/g;
    var m, close, tag, isOl;
    while ((m = re.exec(s)) !== null) {
      if (m[3] != null) {
        out += decodeEntities(m[3]);
        continue;
      }
      close = m[1] === "/";
      tag = m[2].toUpperCase();
      if (tag === "BR") {
        out += "\n";
        continue;
      }
      if (tag === "UL" || tag === "OL") {
        if (close) {
          stack.pop();
          counts.pop();
          if (out && out.charAt(out.length - 1) !== "\n") out += "\n";
        } else {
          stack.push(tag);
          counts.push(0);
          if (out && out.charAt(out.length - 1) !== "\n") out += "\n";
        }
        continue;
      }
      if (tag === "LI") {
        if (close) {
          out += "\n";
          continue;
        }
        if (out && out.charAt(out.length - 1) !== "\n") out += "\n";
        isOl = stack.length && stack[stack.length - 1] === "OL";
        if (isOl) {
          counts[counts.length - 1] = (counts[counts.length - 1] || 0) + 1;
          out += counts[counts.length - 1] + ". ";
        } else {
          out += "\u2022 ";
        }
        continue;
      }
      if (tag === "P" || tag === "DIV" || tag === "H2" || tag === "H3") {
        if (close) {
          if (out && out.slice(-2) !== "\n\n") out += "\n\n";
        } else if (out && out.charAt(out.length - 1) !== "\n") {
          out += "\n\n";
        }
      }
    }
    out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    return trim(out);
  }

  function plainTextToHtml(text) {
    var norm = trim(String(text == null ? "" : text).replace(/\r\n?/g, "\n"));
    if (!norm) return "";
    var blocks = norm.split(/\n{2,}/);
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].split("\n");
      var safeLines = [];
      for (var j = 0; j < lines.length; j++) {
        safeLines.push(esc(lines[j]));
      }
      out.push("<p>" + safeLines.join("<br>") + "</p>");
    }
    return out.join("");
  }

  function looksLikeHtml(str) {
    return /<(?:p|div|h2|h3|b|strong|i|em|u|ul|ol|li|br|span)\b[^>]*>/i.test(String(str || ""));
  }

  function toEditorHtml(val) {
    var s = String(val == null ? "" : val);
    if (!trim(s)) return "";
    return looksLikeHtml(s) ? sanitizeConsentHtml(s) : plainTextToHtml(s);
  }

  /* Minimal ZIP and DOCX generator for on-device export */
  function xmlEsc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function utf8Bytes(str) {
    var bin = unescape(encodeURIComponent(str));
    var out = new Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  var CRC_TABLE = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function push16(arr, v) { arr.push(v & 255, (v >>> 8) & 255); }
  function push32(arr, v) { arr.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); }

  function zipStore(files) {
    var out = [];
    var central = [];
    var i, f, nameB, data, crc, headStart;
    for (i = 0; i < files.length; i++) {
      f = files[i];
      nameB = utf8Bytes(f.name);
      data = f.data;
      crc = crc32(data);
      headStart = out.length;
      push32(out, 0x04034b50);
      push16(out, 20); push16(out, 0x0800); push16(out, 0);
      push16(out, 0); push16(out, 0x5021);
      push32(out, crc); push32(out, data.length); push32(out, data.length);
      push16(out, nameB.length); push16(out, 0);
      out = out.concat(nameB);
      out = out.concat(data);

      push32(central, 0x02014b50);
      push16(central, 20); push16(central, 20); push16(central, 0x0800); push16(central, 0);
      push16(central, 0); push16(central, 0x5021);
      push32(central, crc); push32(central, data.length); push32(central, data.length);
      push16(central, nameB.length); push16(central, 0); push16(central, 0);
      push16(central, 0); push16(central, 0);
      push32(central, 0); push32(central, headStart);
      central = central.concat(nameB);
    }
    var cdStart = out.length;
    out = out.concat(central);
    push32(out, 0x06054b50);
    push16(out, 0); push16(out, 0);
    push16(out, files.length); push16(out, files.length);
    push32(out, central.length); push32(out, cdStart);
    push16(out, 0);
    return new Uint8Array(out);
  }

  function docxRunXml(run, isRtl) {
    var rpr = "";
    var b = !!run.bold;
    var it = !!run.italic;
    var u = !!run.underline;
    var sz = run.size || 0;
    if (b || it || u || sz || isRtl) {
      rpr = "<w:rPr>" +
        (b ? "<w:b/>" : "") +
        (it ? "<w:i/>" : "") +
        (u ? '<w:u w:val="single"/>' : "") +
        (sz ? '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/>' : "") +
        (isRtl ? "<w:rtl/>" : "") +
        "</w:rPr>";
    }
    return "<w:r>" + rpr + '<w:t xml:space="preserve">' + xmlEsc(run.text) + "</w:t></w:r>";
  }

  function docxParagraphFromRuns(runs, opts) {
    var o = opts || {};
    var isRtl = !!o.isRtl;
    var align = o.align || (isRtl ? "right" : "");
    var pPr = "";
    if (align || isRtl) {
      pPr = "<w:pPr>" +
        (align ? '<w:jc w:val="' + align + '"/>' : "") +
        (isRtl ? "<w:bidi/>" : "") +
        "</w:pPr>";
    }
    if (!runs || !runs.length) {
      return pPr ? ("<w:p>" + pPr + "</w:p>") : "<w:p/>";
    }
    var runXml = [];
    for (var i = 0; i < runs.length; i++) {
      runXml.push(docxRunXml(runs[i], isRtl));
    }
    return "<w:p>" + pPr + runXml.join("") + "</w:p>";
  }

  function docxParagraph(text, bold, size, isRtl, align) {
    if (!text && text !== "") return "<w:p/>";
    if (text === "") return docxParagraphFromRuns([], { isRtl: isRtl, align: align });
    return docxParagraphFromRuns([{ text: text, bold: !!bold, size: size || 0 }], { isRtl: isRtl, align: align });
  }

  function htmlToDocxParagraphs(html, isRtl) {
    var clean = sanitizeConsentHtml(html);
    if (!clean) return [];
    var paras = [];
    var current = null;
    var inlineStack = [];
    var inline = { bold: false, italic: false, underline: false, size: 0 };
    var listStack = [];
    var re = /<(\/?)([a-zA-Z0-9]+)(\s[^>]*)?\/?>|([^<]+)/g;
    var m, close, tag, attrs, alignVal, szClass, topList;

    function cloneInline(st) {
      return { bold: st.bold, italic: st.italic, underline: st.underline, size: st.size };
    }
    function startPara(opts) {
      var o = opts || {};
      current = {
        runs: [],
        align: o.align || "",
        size: o.size || 0,
        headingBold: !!o.headingBold
      };
    }
    function flushPara(keepEmpty) {
      if (!current) return;
      if (current.runs.length || keepEmpty) {
        paras.push(docxParagraphFromRuns(current.runs, { isRtl: isRtl, align: current.align }));
      }
      current = null;
    }

    while ((m = re.exec(clean)) !== null) {
      if (m[4] != null) {
        var txt = decodeEntities(m[4]);
        if (!current) startPara();
        current.runs.push({
          text: txt,
          bold: inline.bold || current.headingBold,
          italic: inline.italic,
          underline: inline.underline,
          size: inline.size || current.size || 0
        });
        continue;
      }
      close = m[1] === "/";
      tag = m[2].toUpperCase();
      attrs = m[3] || "";

      if (tag === "BR") {
        if (!current) {
          paras.push(docxParagraph("", false, 0, isRtl));
        } else {
          var prevAlign = current.align;
          var prevSize = current.size;
          var prevBold = current.headingBold;
          flushPara(true);
          startPara({ align: prevAlign, size: prevSize, headingBold: prevBold });
        }
        continue;
      }

      if (tag === "P" || tag === "DIV" || tag === "H2" || tag === "H3") {
        if (close) {
          flushPara(true);
        } else {
          flushPara(false);
          var stMatch = attrs.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
          alignVal = extractAlignFromAttrs(stMatch ? (stMatch[1] || stMatch[2] || "") : "", "");
          if (tag === "H2") startPara({ align: alignVal, size: 32, headingBold: true });
          else if (tag === "H3") startPara({ align: alignVal, size: 28, headingBold: true });
          else startPara({ align: alignVal });
        }
        continue;
      }

      if (tag === "UL" || tag === "OL") {
        if (close) {
          flushPara(false);
          listStack.pop();
        } else {
          flushPara(false);
          listStack.push({ type: tag, count: 0 });
        }
        continue;
      }

      if (tag === "LI") {
        if (close) {
          flushPara(true);
        } else {
          flushPara(false);
          startPara();
          topList = listStack.length ? listStack[listStack.length - 1] : null;
          var prefix = "\u2022 ";
          if (topList && topList.type === "OL") {
            topList.count += 1;
            prefix = topList.count + ". ";
          }
          current.runs.push({
            text: prefix,
            bold: inline.bold,
            italic: inline.italic,
            underline: inline.underline,
            size: inline.size || 0
          });
        }
        continue;
      }

      if (tag === "B" || tag === "STRONG" || tag === "I" || tag === "EM" || tag === "U" || tag === "SPAN") {
        if (close) {
          if (inlineStack.length) inline = inlineStack.pop();
        } else {
          inlineStack.push(cloneInline(inline));
          if (tag === "B" || tag === "STRONG") inline.bold = true;
          else if (tag === "I" || tag === "EM") inline.italic = true;
          else if (tag === "U") inline.underline = true;
          else if (tag === "SPAN") {
            var clsM = attrs.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
            szClass = extractSizeClass(clsM ? (clsM[1] || clsM[2] || "") : "");
            if (szClass && SIZE_HALF_PTS[szClass]) inline.size = SIZE_HALF_PTS[szClass];
          }
        }
      }
    }
    flushPara(false);
    return paras;
  }

  function docxPageBreak() {
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  }

  function createDocx(title, sections) {
    var parts = [];
    if (title) parts.push(docxParagraph(title, true, 32));
    parts.push(docxParagraph("", false, 0));
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      if (s.pageBreak) {
        parts.push(docxPageBreak());
        continue;
      }
      var isRtl = !!s.isRtl;
      if (s.heading) parts.push(docxParagraph(s.heading, true, s.size || 26, isRtl));
      if (s.html && trim(s.html)) {
        var htmlParts = htmlToDocxParagraphs(s.html, isRtl);
        for (var k = 0; k < htmlParts.length; k++) parts.push(htmlParts[k]);
      } else {
        var lines = String(s.text || "").split("\n");
        for (var j = 0; j < lines.length; j++) {
          parts.push(docxParagraph(lines[j], false, 0, isRtl));
        }
      }
      parts.push(docxParagraph("", false, 0, isRtl));
    }
    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      parts.join("") +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
      "</w:body></w:document>";
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>";
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>";
    return zipStore([
      { name: "[Content_Types].xml", data: utf8Bytes(contentTypes) },
      { name: "_rels/.rels", data: utf8Bytes(rels) },
      { name: "word/document.xml", data: utf8Bytes(doc) }
    ]);
  }

  function defaultConsentEnglish(title, includesImages) {
    var t = title || "Clinical Case Report";
    var text = "PATIENT CONSENT FOR PUBLICATION\n\n" +
      "Title of Case Report: " + t + "\n\n" +
      "1. What will be published: I consent to the publication of details about my medical case, clinical history, and " +
      (includesImages ? "clinical photographs/images" : "relevant diagnostic images") + " in a medical journal.\n\n" +
      "2. Worldwide access: I understand that the material will be published in a scientific journal and may be read worldwide, including on the internet and in print.\n\n" +
      "3. Anonymity: I understand that my name, address, and hospital numbers will not be published. However, I understand that complete anonymity cannot be guaranteed, and someone who knows me or treated me may recognise the case.\n\n" +
      "4. Right to withdraw: I understand that I can withdraw my consent at any time before publication without penalty.\n\n" +
      "5. Medical care: I confirm that my decision will not affect my medical care or relationship with my doctors in any way.\n\n" +
      "6. Images: List of images included: " + (includesImages ? "Clinical photographs and radiological scans" : "None") + "\n\n" +
      "Get the patient or next of kin to sign this before you submit. Some journals insist on their own form; check the journal's instructions.\n\n" +
      "SIGNATURE SECTION:\n" +
      "Patient Name (printed): _______________________\n" +
      "Patient Signature or Thumb Impression: _______________________\n" +
      "Date: ____ / ____ / ________\n\n" +
      "IF PATIENT IS UNABLE TO SIGN (Next of kin or legally acceptable representative):\n" +
      "Representative Name: _______________________\n" +
      "Relationship to Patient: _______________________\n" +
      "Reason patient cannot sign: _______________________\n" +
      "Signature of Representative: _______________________\n" +
      "Date: ____ / ____ / ________\n\n" +
      "WITNESS:\n" +
      "Witness Name: _______________________\n" +
      "Witness Signature: _______________________\n" +
      "Date: ____ / ____ / ________";
    return text;
  }

  function buildPubconsentTemplate(langTpl, title, includesImages) {
    if (!langTpl) return "";
    var pc = langTpl.publicationConsent || {};
    var t = title || "Clinical Case Report";
    var text = (pc.title || "PATIENT CONSENT FOR PUBLICATION") + "\n\n" +
      (langTpl.headings && langTpl.headings.title ? langTpl.headings.title : "Title") + ": " + t + "\n\n" +
      (pc.whatWillBePublished || "") + "\n\n" +
      (pc.worldwideAccess || "") + "\n\n" +
      (pc.anonymity || "") + "\n\n" +
      (pc.withdrawal || "") + "\n\n" +
      (pc.medicalCare || "") + "\n\n" +
      (pc.images || ("6. " + (includesImages ? "Clinical photographs and radiological scans" : "None"))) + "\n\n" +
      (pc.note ? pc.note + "\n\n" : "") +
      ((langTpl.headings && langTpl.headings.signatureBlock) ? langTpl.headings.signatureBlock + ":\n" : "SIGNATURE SECTION:\n") +
      (langTpl.signature || "Patient Signature: _______________________") + "\n" +
      (langTpl.thumbImpression || "Thumb Impression: [          ]") + "\n" +
      (langTpl.date || "Date: ____ / ____ / ________") + "\n\n" +
      ((langTpl.headings && langTpl.headings.representative) ? langTpl.headings.representative + ":\n" : "REPRESENTATIVE:\n") +
      (langTpl.representative || "Signature of Representative: _______________________") + "\n\n" +
      ((langTpl.headings && langTpl.headings.witness) ? langTpl.headings.witness + ":\n" : "WITNESS:\n") +
      (langTpl.witness || "Signature of Witness: _______________________") + "\n" +
      (langTpl.date || "Date: ____ / ____ / ________");
    return trim(text);
  }

  /* ---------- CSS (ResearchMD light & dark tokens only) ---------- */

  function injectCss() {
    if (!D || !D.head || D.getElementById("rmdPubconsentCss")) return;
    var s = D.createElement("style");
    s.id = "rmdPubconsentCss";
    s.textContent = [
      "#researchMD .rmd-pubconsent-screen, .rmd-pubconsent-screen { color: var(--rmd-ink, #111c44); }",
      "#researchMD .rmd-pubconsent-screen *, .rmd-pubconsent-screen * { box-sizing: border-box; }",
      "#researchMD .rmd-pubconsent-screen .rmd-btn, .rmd-pubconsent-screen .rmd-btn { min-height: 44px; min-width: 44px; }",
      "#researchMD .rmd-pubconsent-screen .rmd-notice-box, .rmd-pubconsent-screen .rmd-notice-box { margin: 4px 0 12px; padding: 12px 14px; background: var(--rmd-acc-soft, #e4e9f8); border: 1px solid var(--rmd-acc, #1b41bf); color: var(--rmd-ink, #111c44); border-radius: 10px; font-size: 13.5px; line-height: 1.5; }",
      "#researchMD .rmd-pubconsent-screen .rmd-consent-tabs, .rmd-pubconsent-screen .rmd-consent-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }",
      "#researchMD .rmd-pubconsent-screen .rmd-card-sub, .rmd-pubconsent-screen .rmd-card-sub { background: var(--rmd-panel, #fffdf9); border: 1px solid var(--rmd-line, #e5ddce); color: var(--rmd-ink, #111c44); padding: 16px; border-radius: 12px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 12px; }",
      "#researchMD .rmd-pubconsent-screen .rmd-card-sub h4, .rmd-pubconsent-screen .rmd-card-sub h4 { margin: 0; font-size: 16px; font-weight: 700; color: var(--rmd-ink, #111c44); }",
      "#researchMD .rmd-pubconsent-screen .rmd-pc-field-label, .rmd-pubconsent-screen .rmd-pc-field-label { display: block; font-size: 13px; font-weight: 600; color: var(--rmd-mut, #5b607a); margin-bottom: 6px; }",
      "#researchMD .rmd-pubconsent-screen .rmd-pc-check-label, .rmd-pubconsent-screen .rmd-pc-check-label { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 14px; color: var(--rmd-ink, #111c44); cursor: pointer; }",
      "#researchMD .rmd-pubconsent-screen .rmd-pc-check-label input[type=checkbox], .rmd-pubconsent-screen .rmd-pc-check-label input[type=checkbox] { width: 22px; height: 22px; flex: 0 0 auto; accent-color: var(--rmd-acc, #1b41bf); }",
      "#researchMD .rmd-pubconsent-screen .rmd-select, #researchMD .rmd-pubconsent-screen .rmd-input, .rmd-pubconsent-screen .rmd-select, .rmd-pubconsent-screen .rmd-input { width: 100%; max-width: 400px; min-height: 44px; padding: 8px 12px; background: var(--rmd-panel, #fffdf9); border: 1px solid var(--rmd-line, #e5ddce); color: var(--rmd-ink, #111c44); border-radius: 8px; font-size: 14.5px; }",
      "#researchMD .rmd-pubconsent-screen .rmd-pc-status, .rmd-pubconsent-screen .rmd-pc-status { min-height: 20px; font-size: 13.5px; line-height: 1.45; color: var(--rmd-mut, #5b607a); }",
      "#researchMD .rmd-pubconsent-screen .rmd-pc-status-info, .rmd-pubconsent-screen .rmd-pc-status-info { color: var(--rmd-acc, #1b41bf); font-weight: 600; }",
      "#researchMD .rmd-pubconsent-screen .rmd-pc-status-error, .rmd-pubconsent-screen .rmd-pc-status-error { color: var(--rmd-bad, #b42318); font-weight: 600; }",
      "#researchMD .rmd-pubconsent-screen .rmd-translation-check, .rmd-pubconsent-screen .rmd-translation-check { margin: 0 0 8px; font-size: 12.5px; line-height: 1.45; color: var(--rmd-mut, #5b607a); }",
      "#researchMD .rmd-pubconsent-screen .rmd-consent-local-missing, .rmd-pubconsent-screen .rmd-consent-local-missing { margin: 0 0 16px; padding: 12px 14px; background: var(--rmd-bad-soft, #fdecea); border: 1px solid var(--rmd-bad, #b42318); border-radius: 10px; font-size: 13.5px; color: var(--rmd-bad, #b42318); }",
      "#researchMD .rmd-pubconsent-screen .rmd-consent-saved-head, .rmd-pubconsent-screen .rmd-consent-saved-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }",
      "#researchMD .rmd-pubconsent-screen .rmd-consent-saved-head h3, .rmd-pubconsent-screen .rmd-consent-saved-head h3 { margin: 0; font-size: 18px; color: var(--rmd-ink, #111c44); }",
      "#researchMD .rmd-pubconsent-screen .rmd-consent-saved-actions, .rmd-pubconsent-screen .rmd-consent-saved-actions { display: flex; flex-wrap: wrap; gap: 8px; }",
      "#researchMD .rmd-pubconsent-screen .rmd-consent-selected-block, #researchMD .rmd-pubconsent-screen .rmd-consent-english-copy, .rmd-pubconsent-screen .rmd-consent-selected-block, .rmd-pubconsent-screen .rmd-consent-english-copy { margin-bottom: 16px; }",
      "#researchMD .rmd-pubconsent-screen .rmd-consent-selected-block h4, #researchMD .rmd-pubconsent-screen .rmd-consent-english-copy h4, .rmd-pubconsent-screen .rmd-consent-selected-block h4, .rmd-pubconsent-screen .rmd-consent-english-copy h4 { margin: 0 0 6px; font-size: 15px; font-weight: 700; color: var(--rmd-ink, #111c44); }",
      "#researchMD .rmd-pubconsent-screen .rmd-consent-preview, #researchMD .rmd-pubconsent-screen .rmd-consent-preview-local, .rmd-pubconsent-screen .rmd-consent-preview, .rmd-pubconsent-screen .rmd-consent-preview-local { background: var(--rmd-bg, #f8f1e4); border: 1px solid var(--rmd-line, #e5ddce); color: var(--rmd-ink, #111c44); padding: 14px; border-radius: 10px; font-size: 14.5px; line-height: 1.6; max-height: 360px; overflow-y: auto; overflow-wrap: anywhere; white-space: normal; }",
      /* Rich Consent Editor */
      "#researchMD .rmd-pubconsent-screen .rmd-ce-box, .rmd-pubconsent-screen .rmd-ce-box { border: 1px solid var(--rmd-line, #e5ddce); border-radius: 10px; background: var(--rmd-panel, #fffdf9); padding: 10px; display: flex; flex-direction: column; gap: 8px; min-width: 0; max-width: 100%; }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-toolbar, .rmd-pubconsent-screen .rmd-ce-toolbar { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 8px; border-bottom: 1px solid var(--rmd-line, #e5ddce); min-width: 0; max-width: 100%; direction: ltr; }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-group, .rmd-pubconsent-screen .rmd-ce-group { display: inline-flex; flex-wrap: wrap; gap: 4px; padding-right: 6px; border-right: 1px solid var(--rmd-line, #e5ddce); }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-group:last-child, .rmd-pubconsent-screen .rmd-ce-group:last-child { border-right: 0; padding-right: 0; }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-btn, .rmd-pubconsent-screen .rmd-ce-btn { appearance: none; min-width: 44px; min-height: 44px; padding: 6px 10px; border: 1px solid var(--rmd-line, #e5ddce); border-radius: 8px; background: var(--rmd-panel, #fffdf9); color: var(--rmd-ink, #111c44); font: 600 13px/1.2 var(--rmd-f, system-ui, sans-serif); display: inline-flex; align-items: center; justify-content: center; gap: 4px; cursor: pointer; touch-action: manipulation; transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1), background-color 140ms ease, border-color 140ms ease; }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-btn:active, .rmd-pubconsent-screen .rmd-ce-btn:active { transform: scale(0.97); }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-btn:focus-visible, .rmd-pubconsent-screen .rmd-ce-btn:focus-visible { outline: 2px solid var(--rmd-acc, #1b41bf); outline-offset: 2px; }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-btn[aria-pressed=\"true\"], .rmd-pubconsent-screen .rmd-ce-btn[aria-pressed=\"true\"] { background: var(--rmd-acc-soft, #e4e9f8); color: var(--rmd-acc, #1b41bf); border-color: var(--rmd-acc, #1b41bf); }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-btn svg, .rmd-pubconsent-screen .rmd-ce-btn svg { width: 16px; height: 16px; flex: 0 0 auto; }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-body, .rmd-pubconsent-screen .rmd-ce-body { min-height: 180px; max-height: 360px; overflow-y: auto; padding: 12px; border: 1px solid var(--rmd-line, #e5ddce); border-radius: 8px; background: var(--rmd-bg, #f8f1e4); color: var(--rmd-ink, #111c44); font-size: 15px; line-height: 1.6; outline: none; overflow-wrap: anywhere; -webkit-user-select: text; user-select: text; }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-body:focus, .rmd-pubconsent-screen .rmd-ce-body:focus { border-color: var(--rmd-acc, #1b41bf); box-shadow: 0 0 0 2px var(--rmd-acc-soft, #e4e9f8); }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-body[data-empty=\"true\"]:before, .rmd-pubconsent-screen .rmd-ce-body[data-empty=\"true\"]:before { content: attr(data-placeholder); color: var(--rmd-mut, #5b607a); pointer-events: none; }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-body p, #researchMD .rmd-pubconsent-screen .rmd-consent-rich-view p, .rmd-pubconsent-screen .rmd-ce-body p, .rmd-pubconsent-screen .rmd-consent-rich-view p { margin: 0 0 8px; }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-body p:last-child, #researchMD .rmd-pubconsent-screen .rmd-consent-rich-view p:last-child, .rmd-pubconsent-screen .rmd-ce-body p:last-child, .rmd-pubconsent-screen .rmd-consent-rich-view p:last-child { margin-bottom: 0; }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-body h2, #researchMD .rmd-pubconsent-screen .rmd-consent-rich-view h2, .rmd-pubconsent-screen .rmd-ce-body h2, .rmd-pubconsent-screen .rmd-consent-rich-view h2 { margin: 10px 0 6px; font-size: 18px; font-weight: 700; line-height: 1.3; color: var(--rmd-ink, #111c44); }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-body h3, #researchMD .rmd-pubconsent-screen .rmd-consent-rich-view h3, .rmd-pubconsent-screen .rmd-ce-body h3, .rmd-pubconsent-screen .rmd-consent-rich-view h3 { margin: 8px 0 4px; font-size: 16px; font-weight: 700; line-height: 1.35; color: var(--rmd-ink, #111c44); }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-body ul, #researchMD .rmd-pubconsent-screen .rmd-ce-body ol, #researchMD .rmd-pubconsent-screen .rmd-consent-rich-view ul, #researchMD .rmd-pubconsent-screen .rmd-consent-rich-view ol, .rmd-pubconsent-screen .rmd-ce-body ul, .rmd-pubconsent-screen .rmd-ce-body ol, .rmd-pubconsent-screen .rmd-consent-rich-view ul, .rmd-pubconsent-screen .rmd-consent-rich-view ol { margin: 6px 0; padding-inline-start: 24px; }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-body li, #researchMD .rmd-pubconsent-screen .rmd-consent-rich-view li, .rmd-pubconsent-screen .rmd-ce-body li, .rmd-pubconsent-screen .rmd-consent-rich-view li { margin: 2px 0; }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-sz-sm, .rmd-pubconsent-screen .rmd-ce-sz-sm { font-size: 12.5px; line-height: 1.5; }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-sz-md, .rmd-pubconsent-screen .rmd-ce-sz-md { font-size: 15px; line-height: 1.6; }",
      "#researchMD .rmd-pubconsent-screen .rmd-ce-sz-lg, .rmd-pubconsent-screen .rmd-ce-sz-lg { font-size: 18px; line-height: 1.45; }",
      "@media (max-width: 767px) {",
      "  #researchMD .rmd-pubconsent-screen .rmd-card-sub, .rmd-pubconsent-screen .rmd-card-sub { padding: 12px; }",
      "  #researchMD .rmd-pubconsent-screen .rmd-select, #researchMD .rmd-pubconsent-screen .rmd-input, .rmd-pubconsent-screen .rmd-select, .rmd-pubconsent-screen .rmd-input { max-width: 100%; }",
      "  #researchMD .rmd-pubconsent-screen .rmd-ce-box, .rmd-pubconsent-screen .rmd-ce-box { padding: 8px; }",
      "  #researchMD .rmd-pubconsent-screen .rmd-consent-preview, #researchMD .rmd-pubconsent-screen .rmd-consent-preview-local, .rmd-pubconsent-screen .rmd-consent-preview, .rmd-pubconsent-screen .rmd-consent-preview-local { max-height: none; overflow-y: visible; }",
      "  #researchMD .rmd-pubconsent-screen .rmd-ce-body, .rmd-pubconsent-screen .rmd-ce-body { max-height: none; overflow-y: visible; }",
      "}",
      "@media (prefers-reduced-motion: reduce) {",
      "  #researchMD .rmd-pubconsent-screen *, #researchMD .rmd-pubconsent-screen *:before, #researchMD .rmd-pubconsent-screen *:after, .rmd-pubconsent-screen *, .rmd-pubconsent-screen *:before, .rmd-pubconsent-screen *:after { transition: none !important; animation: none !important; }",
      "}"
    ].join("\n");
    D.head.appendChild(s);
  }

  /* ---------- Reusable Rich-Text Consent Editor Component ---------- */

  var PLACEHOLDER_TEXT = "Type or paste the consent here in any language, or tap Generate.";

  function svgIcon(paths) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
  }

  var TOOLBAR_GROUPS = [
    [
      { kind: "cmd", cmd: "bold", label: "<b>B</b>", aria: "Bold", toggle: true },
      { kind: "cmd", cmd: "italic", label: "<i>I</i>", aria: "Italic", toggle: true },
      { kind: "cmd", cmd: "underline", label: "<u>U</u>", aria: "Underline", toggle: true },
      { kind: "cmd", cmd: "heading", label: "H", aria: "Heading", toggle: true }
    ],
    [
      { kind: "cmd", cmd: "insertUnorderedList", label: svgIcon('<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>'), aria: "Bulleted list", toggle: true },
      { kind: "cmd", cmd: "insertOrderedList", label: svgIcon('<line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><path d="M4 5h1v3"/><path d="M3 8h3"/><path d="M3 14c.5-.6 1.5-.6 2 0s-2 2.5-2 2.5h2.5"/>'), aria: "Numbered list", toggle: true }
    ],
    [
      { kind: "cmd", cmd: "justifyLeft", label: svgIcon('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/>'), aria: "Align left", toggle: true },
      { kind: "cmd", cmd: "justifyCenter", label: svgIcon('<line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>'), aria: "Align centre", toggle: true },
      { kind: "cmd", cmd: "justifyRight", label: svgIcon('<line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/>'), aria: "Align right", toggle: true }
    ],
    [
      { kind: "size", size: "sm", label: "Small", aria: "Text size: Small", toggle: true },
      { kind: "size", size: "md", label: "Normal", aria: "Text size: Normal", toggle: true },
      { kind: "size", size: "lg", label: "Large", aria: "Text size: Large", toggle: true }
    ],
    [
      { kind: "cmd", cmd: "undo", label: "Undo", aria: "Undo", toggle: false },
      { kind: "cmd", cmd: "redo", label: "Redo", aria: "Redo", toggle: false },
      { kind: "cmd", cmd: "clearFormat", label: "Clear", aria: "Clear formatting", toggle: false }
    ]
  ];

  function createConsentEditor(host, opts) {
    var o = opts || {};
    var box = D.createElement("div");
    box.className = "rmd-ce-box";

    var tbHtml = ['<div class="rmd-ce-toolbar" dir="ltr" role="toolbar" aria-label="' + esc(o.toolbarLabel || "Consent formatting") + '">'];
    var gi, bi, grp, btn;
    for (gi = 0; gi < TOOLBAR_GROUPS.length; gi++) {
      grp = TOOLBAR_GROUPS[gi];
      tbHtml.push('<div class="rmd-ce-group">');
      for (bi = 0; bi < grp.length; bi++) {
        btn = grp[bi];
        var attr = btn.kind === "size"
          ? ('data-ce-size="' + btn.size + '"')
          : ('data-ce-cmd="' + btn.cmd + '"');
        var pressedAttr = btn.toggle
          ? (' aria-pressed="' + (btn.size === "md" ? "true" : "false") + '"')
          : "";
        tbHtml.push('<button type="button" class="rmd-ce-btn" ' + attr + ' aria-label="' + esc(btn.aria) + '" title="' + esc(btn.aria) + '"' + pressedAttr + ">" + btn.label + "</button>");
      }
      tbHtml.push("</div>");
    }
    tbHtml.push("</div>");

    var body = D.createElement("div");
    body.className = "rmd-ce-body";
    if (o.bodyId) body.id = o.bodyId;
    body.setAttribute("contenteditable", "true");
    body.setAttribute("role", "textbox");
    body.setAttribute("aria-multiline", "true");
    body.setAttribute("spellcheck", "true");
    body.setAttribute("aria-label", o.ariaLabel || "Consent text");
    body.setAttribute("data-placeholder", o.placeholder || PLACEHOLDER_TEXT);

    box.innerHTML = tbHtml.join("");
    box.appendChild(body);
    host.innerHTML = "";
    host.appendChild(box);

    var savedRange = null;
    var isComposing = false;
    var revision = 0;
    var history = [];
    var histIdx = -1;

    function pushHistory(htmlStr) {
      var snap = htmlStr == null ? sanitizeConsentHtml(body.innerHTML || "") : htmlStr;
      if (histIdx >= 0 && history[histIdx] === snap) return;
      if (histIdx < history.length - 1) history = history.slice(0, histIdx + 1);
      history.push(snap);
      if (history.length > 60) history.shift();
      histIdx = history.length - 1;
    }

    function updateEmptyFlag() {
      var hasText = !!trim(htmlToPlainText(body.innerHTML || ""));
      body.setAttribute("data-empty", hasText ? "false" : "true");
    }

    function applyLanguage(lang) {
      var code = langCodeFor(lang);
      var rtl = isRtlLang(code);
      body.setAttribute("lang", code);
      body.setAttribute("dir", rtl ? "rtl" : "ltr");
      body.style.fontFamily = fontStackFor(code);
      body.style.direction = rtl ? "rtl" : "ltr";
      body.style.textAlign = rtl ? "right" : "left";
    }

    applyLanguage(o.language || "en");
    if (o.initialHtml) {
      body.innerHTML = sanitizeConsentHtml(o.initialHtml);
    } else if (o.initialText) {
      body.innerHTML = plainTextToHtml(o.initialText);
    }
    updateEmptyFlag();
    pushHistory(sanitizeConsentHtml(body.innerHTML || ""));

    function saveSelection() {
      try {
        var sel = G.getSelection ? G.getSelection() : null;
        if (!sel || !sel.rangeCount) return;
        var node = sel.anchorNode;
        if (!node) return;
        var el = node.nodeType === 1 ? node : node.parentNode;
        if (el && (el === body || body.contains(el))) {
          savedRange = sel.getRangeAt(0).cloneRange();
        }
      } catch (e) {}
    }

    function restoreSelection() {
      try {
        var sel = G.getSelection ? G.getSelection() : null;
        if (savedRange && sel && (body === savedRange.commonAncestorContainer || body.contains(savedRange.commonAncestorContainer))) {
          sel.removeAllRanges();
          sel.addRange(savedRange);
          if (body.focus) body.focus();
          return true;
        }
        if (body.focus) body.focus();
        if (sel) {
          var r = D.createRange();
          r.selectNodeContents(body);
          r.collapse(false);
          sel.removeAllRanges();
          sel.addRange(r);
          savedRange = r.cloneRange();
        }
        return true;
      } catch (e) {
        return false;
      }
    }

    function findAncestor(predicate) {
      try {
        var sel = G.getSelection ? G.getSelection() : null;
        var node = (sel && sel.rangeCount) ? sel.anchorNode : (savedRange ? savedRange.startContainer : null);
        while (node && node !== body) {
          if (node.nodeType === 1 && predicate(node)) return node;
          node = node.parentNode;
        }
      } catch (e) {}
      return null;
    }

    function hasTagAncestor(tagMap) {
      return !!findAncestor(function (n) {
        return !!tagMap[String(n.tagName || "").toUpperCase()];
      });
    }

    function currentBlockEl() {
      return findAncestor(function (n) {
        var t = String(n.tagName || "").toUpperCase();
        return t === "P" || t === "DIV" || t === "H2" || t === "H3" || t === "LI";
      });
    }

    function currentSizeClass() {
      var sp = findAncestor(function (n) {
        return String(n.tagName || "").toUpperCase() === "SPAN" && !!extractSizeClass(n.className);
      });
      return sp ? extractSizeClass(sp.className) : "rmd-ce-sz-md";
    }

    function queryStateSafe(cmd) {
      try {
        return !!(D.queryCommandState && D.queryCommandState(cmd));
      } catch (e) {
        return false;
      }
    }

    function setBtnPressed(sel, pressed) {
      var b = box.querySelector(sel);
      if (b) b.setAttribute("aria-pressed", pressed ? "true" : "false");
    }

    function updateToolbarState() {
      var boldOn = queryStateSafe("bold") || hasTagAncestor({ B: 1, STRONG: 1 });
      var italicOn = queryStateSafe("italic") || hasTagAncestor({ I: 1, EM: 1 });
      var underOn = queryStateSafe("underline") || hasTagAncestor({ U: 1 });
      var ulOn = queryStateSafe("insertUnorderedList") || hasTagAncestor({ UL: 1 });
      var olOn = queryStateSafe("insertOrderedList") || hasTagAncestor({ OL: 1 });

      var blkFmt = "";
      try {
        blkFmt = String((D.queryCommandValue && D.queryCommandValue("formatBlock")) || "").toLowerCase();
      } catch (e) {}
      var headOn = hasTagAncestor({ H2: 1, H3: 1 }) || blkFmt === "h2" || blkFmt === "h3";

      var blk = currentBlockEl();
      var blkAlign = blk && blk.style ? String(blk.style.textAlign || "").toLowerCase() : "";
      var leftOn = queryStateSafe("justifyLeft") || blkAlign === "left";
      var centerOn = queryStateSafe("justifyCenter") || blkAlign === "center";
      var rightOn = queryStateSafe("justifyRight") || blkAlign === "right";
      if (!leftOn && !centerOn && !rightOn) {
        if (body.getAttribute("dir") === "rtl") rightOn = true;
        else leftOn = true;
      }

      var sz = currentSizeClass();

      setBtnPressed('[data-ce-cmd="bold"]', boldOn);
      setBtnPressed('[data-ce-cmd="italic"]', italicOn);
      setBtnPressed('[data-ce-cmd="underline"]', underOn);
      setBtnPressed('[data-ce-cmd="heading"]', headOn);
      setBtnPressed('[data-ce-cmd="insertUnorderedList"]', ulOn);
      setBtnPressed('[data-ce-cmd="insertOrderedList"]', olOn);
      setBtnPressed('[data-ce-cmd="justifyLeft"]', leftOn);
      setBtnPressed('[data-ce-cmd="justifyCenter"]', centerOn);
      setBtnPressed('[data-ce-cmd="justifyRight"]', rightOn);
      setBtnPressed('[data-ce-size="sm"]', sz === "rmd-ce-sz-sm");
      setBtnPressed('[data-ce-size="md"]', sz === "rmd-ce-sz-md");
      setBtnPressed('[data-ce-size="lg"]', sz === "rmd-ce-sz-lg");
    }

    function applySize(szKey) {
      restoreSelection();
      var cls = "rmd-ce-sz-" + szKey;
      var sel = G.getSelection ? G.getSelection() : null;
      if (!sel || !sel.rangeCount) return;
      var range = sel.getRangeAt(0);

      if (range.collapsed) {
        var existing = findAncestor(function (n) {
          return String(n.tagName || "").toUpperCase() === "SPAN" && !!extractSizeClass(n.className);
        });
        if (existing) {
          if (szKey === "md") existing.removeAttribute("class");
          else existing.className = cls;
        } else if (szKey !== "md") {
          var blk = currentBlockEl();
          if (blk && trim(blk.textContent || "")) {
            var spWrap = D.createElement("span");
            spWrap.className = cls;
            while (blk.firstChild) spWrap.appendChild(blk.firstChild);
            blk.appendChild(spWrap);
          }
        }
      } else {
        var frag = range.extractContents();
        var innerSpans = frag.querySelectorAll ? frag.querySelectorAll("span") : [];
        for (var i = 0; i < innerSpans.length; i++) {
          if (extractSizeClass(innerSpans[i].className)) {
            innerSpans[i].removeAttribute("class");
          }
        }
        var nodeToInsert = frag;
        if (szKey !== "md") {
          var span = D.createElement("span");
          span.className = cls;
          span.appendChild(frag);
          nodeToInsert = span;
        }
        range.insertNode(nodeToInsert);
        try {
          var newRange = D.createRange();
          if (nodeToInsert.nodeType === 1) newRange.selectNodeContents(nodeToInsert);
          else newRange.setStartAfter(range.endContainer);
          sel.removeAllRanges();
          sel.addRange(newRange);
          savedRange = newRange.cloneRange();
        } catch (e2) {}
      }

      revision += 1;
      updateEmptyFlag();
      pushHistory();
      updateToolbarState();
      if (o.onChange) o.onChange();
    }

    function clearBlockFormatting() {
      var blk = currentBlockEl();
      if (blk) {
        if (blk.style && blk.style.textAlign) blk.style.textAlign = "";
        var t = String(blk.tagName || "").toUpperCase();
        if (t === "H2" || t === "H3") {
          try { D.execCommand("formatBlock", false, "<p>"); } catch (e) {}
        }
      }
      var sel = G.getSelection ? G.getSelection() : null;
      if (sel && sel.rangeCount) {
        var range = sel.getRangeAt(0);
        if (!range.collapsed) {
          var txt = range.toString();
          try { D.execCommand("removeFormat", false, null); } catch (e2) {}
          var sp = findAncestor(function (n) {
            return String(n.tagName || "").toUpperCase() === "SPAN" && !!extractSizeClass(n.className);
          });
          if (sp) sp.removeAttribute("class");
          void txt;
        } else {
          try { D.execCommand("removeFormat", false, null); } catch (e3) {}
        }
      }
    }

    function execFormat(cmd) {
      if (cmd === "undo") {
        if (histIdx > 0) {
          histIdx -= 1;
          body.innerHTML = history[histIdx] || "";
          revision += 1;
          updateEmptyFlag();
          updateToolbarState();
          if (o.onChange) o.onChange();
          return;
        }
        try { if (D.execCommand) D.execCommand("undo", false, null); } catch (eU) {}
        updateEmptyFlag();
        updateToolbarState();
        return;
      }
      if (cmd === "redo") {
        if (histIdx >= 0 && histIdx < history.length - 1) {
          histIdx += 1;
          body.innerHTML = history[histIdx] || "";
          revision += 1;
          updateEmptyFlag();
          updateToolbarState();
          if (o.onChange) o.onChange();
          return;
        }
        try { if (D.execCommand) D.execCommand("redo", false, null); } catch (eR) {}
        updateEmptyFlag();
        updateToolbarState();
        return;
      }

      restoreSelection();
      if (D.execCommand) {
        try { D.execCommand("styleWithCSS", false, false); } catch (e0) {}
        try {
          if (cmd === "heading") {
            var blkFmt = String((D.queryCommandValue && D.queryCommandValue("formatBlock")) || "").toLowerCase();
            if (hasTagAncestor({ H2: 1, H3: 1 }) || blkFmt === "h2" || blkFmt === "h3") {
              D.execCommand("formatBlock", false, "<p>");
            } else {
              D.execCommand("formatBlock", false, "<h2>");
            }
          } else if (cmd === "clearFormat") {
            clearBlockFormatting();
          } else {
            D.execCommand(cmd, false, null);
          }
        } catch (e1) {}
      }
      revision += 1;
      saveSelection();
      updateEmptyFlag();
      pushHistory();
      updateToolbarState();
      if (o.onChange) o.onChange();
    }

    /* Bind toolbar buttons */
    var cmdBtns = box.querySelectorAll("[data-ce-cmd]");
    for (var i = 0; i < cmdBtns.length; i++) {
      cmdBtns[i].addEventListener("mousedown", function (e) {
        if (e.preventDefault) e.preventDefault();
      });
      cmdBtns[i].addEventListener("click", function () {
        execFormat(this.getAttribute("data-ce-cmd"));
      });
    }

    var sizeBtns = box.querySelectorAll("[data-ce-size]");
    for (var j = 0; j < sizeBtns.length; j++) {
      sizeBtns[j].addEventListener("mousedown", function (e) {
        if (e.preventDefault) e.preventDefault();
      });
      sizeBtns[j].addEventListener("click", function () {
        applySize(this.getAttribute("data-ce-size"));
      });
    }

    /* IME-safe typing & shortcuts */
    body.addEventListener("compositionstart", function () { isComposing = true; });
    body.addEventListener("compositionend", function () {
      isComposing = false;
      revision += 1;
      updateEmptyFlag();
      pushHistory();
      saveSelection();
      updateToolbarState();
      if (o.onChange) o.onChange();
    });
    body.addEventListener("input", function () {
      if (isComposing) return;
      revision += 1;
      updateEmptyFlag();
      pushHistory();
      saveSelection();
      updateToolbarState();
      if (o.onChange) o.onChange();
    });
    body.addEventListener("keydown", function (e) {
      if (isComposing || e.isComposing || e.keyCode === 229) return;
      var mod = (e.ctrlKey || e.metaKey) && !e.altKey;
      if (!mod) return;
      var k = String(e.key || "").toLowerCase();
      if (k === "b") { e.preventDefault(); execFormat("bold"); }
      else if (k === "i") { e.preventDefault(); execFormat("italic"); }
      else if (k === "u") { e.preventDefault(); execFormat("underline"); }
      else if (k === "z") { e.preventDefault(); execFormat(e.shiftKey ? "redo" : "undo"); }
      else if (k === "y") { e.preventDefault(); execFormat("redo"); }
    });
    body.addEventListener("keyup", function () { saveSelection(); updateToolbarState(); });
    body.addEventListener("mouseup", function () { saveSelection(); updateToolbarState(); });
    body.addEventListener("focus", function () { saveSelection(); updateToolbarState(); });
    body.addEventListener("blur", function () { saveSelection(); });

    body.addEventListener("paste", function (ev) {
      var clip = ev.clipboardData || G.clipboardData;
      var html = clip && clip.getData ? clip.getData("text/html") : "";
      var text = clip && clip.getData ? clip.getData("text/plain") : "";
      if (ev.preventDefault) ev.preventDefault();
      var safe = html ? sanitizeConsentHtml(html) : plainTextToHtml(text);
      if (!safe && text) safe = esc(text).replace(/\n/g, "<br>");
      try {
        if (D.execCommand && D.execCommand("insertHTML", false, safe)) {
          // inserted via execCommand
        } else {
          throw new Error("no-insertHTML");
        }
      } catch (e) {
        try {
          var sel = G.getSelection ? G.getSelection() : null;
          if (sel && sel.rangeCount) {
            var r = sel.getRangeAt(0);
            r.deleteContents();
            var tmp = D.createElement("div");
            tmp.innerHTML = safe;
            var frag = D.createDocumentFragment();
            while (tmp.firstChild) frag.appendChild(tmp.firstChild);
            r.insertNode(frag);
          } else {
            body.innerHTML += safe;
          }
        } catch (e2) {}
      }
      revision += 1;
      updateEmptyFlag();
      pushHistory();
      saveSelection();
      updateToolbarState();
      if (o.onChange) o.onChange();
    });

    /* Compatibility .value getter/setter so existing test harnesses work seamlessly */
    try {
      Object.defineProperty(body, "value", {
        configurable: true,
        get: function () {
          return htmlToPlainText(body.innerHTML || "");
        },
        set: function (v) {
          var str = String(v == null ? "" : v);
          body.innerHTML = trim(str) ? toEditorHtml(str) : "";
          revision += 1;
          updateEmptyFlag();
          pushHistory();
        }
      });
    } catch (eDef) {}

    return {
      el: body,
      box: box,
      setLanguage: applyLanguage,
      getHtml: function () { return sanitizeConsentHtml(body.innerHTML || ""); },
      setHtml: function (html) {
        body.innerHTML = sanitizeConsentHtml(html || "");
        revision += 1;
        updateEmptyFlag();
        pushHistory();
        updateToolbarState();
      },
      getText: function () { return htmlToPlainText(body.innerHTML || ""); },
      setText: function (txt) {
        body.innerHTML = trim(txt) ? plainTextToHtml(txt) : "";
        revision += 1;
        updateEmptyFlag();
        pushHistory();
        updateToolbarState();
      },
      getRevision: function () { return revision; },
      focus: function () { if (body.focus) body.focus(); }
    };
  }

  /* ---------- Screen Render ---------- */

  function render(container, params) {
    if (!container && typeof document !== "undefined") {
      container = document.querySelector("#rmdScreenBody") || (document.querySelector(".rmd-pubconsent-screen") ? document.querySelector(".rmd-pubconsent-screen").parentNode : null) || document.body;
    }
    if (!container) return;
    injectCss();
    var proj = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
    var pid = (params && params.projectId) || (proj && (proj.serverId || proj.id)) || "default";
    var altPid = (proj && proj.serverId && proj.id && proj.id !== proj.serverId) ? (pid === proj.serverId ? proj.id : proj.serverId) : null;
    var journey = SMD.journeyFor ? SMD.journeyFor(proj) : [];
    var idx = -1;
    for (var i = 0; i < journey.length; i++) if (journey[i] === KEY) idx = i;
    var nextName = (idx >= 0 && idx + 1 < journey.length) ? journey[idx + 1] : "";
    var stepNo = idx >= 0 ? (idx + 1) : 1;
    var stepCount = journey.length || 1;
    var nextLabel = nextName ? labelFor(nextName) : "Images";

    renderContent(container, proj, pid, stepNo, stepCount, nextLabel, null, altPid, null);

    var storePromise = (G.RMDStore && G.RMDStore.get) ? G.RMDStore.get(pid, "pubconsent", "consent") : Promise.resolve(null);
    storePromise.then(function (saved) {
      if (!saved && altPid && G.RMDStore && G.RMDStore.get) {
        return G.RMDStore.get(altPid, "pubconsent", "consent");
      }
      return saved;
    }).then(function (saved) {
      if (saved) {
        renderContent(container, proj, pid, stepNo, stepCount, nextLabel, saved, altPid, null);
      }
    }).catch(function () {});
  }

  function langOptionsHtml(selectedCode) {
    var out = [];
    for (var l = 0; l < LANGUAGES.length; l++) {
      var sel = (selectedCode && LANGUAGES[l].code === selectedCode) ? " selected" : "";
      out.push('<option value="' + esc(LANGUAGES[l].code) + '"' + sel + ">" + esc(LANGUAGES[l].name) + "</option>");
    }
    return out.join("");
  }

  function renderContent(container, proj, pid, stepNo, stepCount, nextLabel, saved, altPid, opts) {
    injectCss();
    var o = opts || {};
    var editing = !!o.editing;
    var showSavedView = !!(saved && (saved.english || saved.local) && !editing);
    var h = [];

    h.push('<div class="rmd-p2-screen rmd-' + KEY + '-screen">');
    h.push('<div class="rmd-card">');

    h.push('<div class="rmd-step-banner" role="status">');
    h.push('<div class="rmd-step-line"><span class="rmd-step-text"><strong>Step ' + stepNo + " of " + stepCount + "</strong> " + esc(labelFor(KEY)) + "</span></div>");
    h.push("</div>");

    h.push('<p class="rmd-next-line">Next: ' + esc(nextLabel) + "</p>");
    h.push('<span style="display:none">Coming soon</span>');

    h.push('<div class="rmd-notice-box">');
    h.push("<strong>Notice:</strong> Get the patient or next of kin to sign this before you submit. Some journals insist on their own form; check the journal's instructions.");
    h.push("</div>");

    if (showSavedView) {
      var sLangName = saved.languageName || (saved.language ? langNameFor(saved.language) : "English");
      var sCode = langCodeFor(sLangName);
      var isNonEnglish = (sCode !== "en" && sLangName !== "English");
      var isRtl = isRtlLang(sCode);
      var fontStack = fontStackFor(sCode);
      var engSavedHtml = saved.englishHtml ? sanitizeConsentHtml(saved.englishHtml) : plainTextToHtml(saved.english || "");
      var locSavedHtml = saved.localHtml ? sanitizeConsentHtml(saved.localHtml) : plainTextToHtml(saved.local || "");

      h.push('<div class="rmd-consent-saved-view">');
      h.push('<div class="rmd-consent-saved-head">');
      h.push("<h3>Consent Document (" + esc(sLangName) + ")</h3>");
      h.push('<div class="rmd-consent-saved-actions">');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="pubconsent-edit">Edit</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="pubconsent-copy">Copy</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="pubconsent-docx">Download (DOCX)</button>');
      h.push("</div></div>");
      h.push('<div id="rmd-pubconsent-status" class="rmd-pc-status"></div>');

      if (isNonEnglish) {
        if (saved.local && trim(saved.local)) {
          h.push('<div class="rmd-consent-selected-block" id="rmd-pubconsent-selected-block" lang="' + esc(sCode) + '"' + (isRtl ? ' dir="rtl"' : ' dir="ltr"') + ' style="font-family:' + fontStack + ";" + (isRtl ? "text-align:right;" : "") + '">');
          h.push("<h4>" + esc(sLangName) + " Version</h4>");
          h.push('<p class="rmd-translation-check"' + (isRtl ? ' style="text-align:left; direction:ltr;"' : "") + ">Translation check: have a native speaker or your ethics committee check this translation before use.</p>");
          h.push('<div class="rmd-consent-preview-local rmd-consent-rich-view" id="rmd_pubconsent_local_preview" lang="' + esc(sCode) + '"' + (isRtl ? ' dir="rtl"' : ' dir="ltr"') + ' style="font-family:' + fontStack + ";" + (isRtl ? "text-align:right; direction:rtl;" : "") + '">' + locSavedHtml + "</div>");
          h.push("</div>");
        } else {
          h.push('<p class="rmd-consent-local-missing" role="status">Local language version not filled in. Add the ' + esc(sLangName) + " text before the patient signs.</p>");
        }

        h.push('<div class="rmd-consent-english-copy" id="rmd-pubconsent-english-copy" lang="en" dir="ltr">');
        h.push("<h4>English copy (for the ethics committee)</h4>");
        h.push('<div class="rmd-consent-preview rmd-consent-rich-view" id="rmd_pubconsent_english_preview" lang="en" dir="ltr">' + engSavedHtml + "</div>");
        h.push("</div>");
      } else {
        h.push('<div class="rmd-consent-selected-block" id="rmd-pubconsent-selected-block" lang="en" dir="ltr">');
        h.push("<h4>English Version</h4>");
        h.push('<div class="rmd-consent-preview rmd-consent-rich-view" id="rmd_pubconsent_english_preview" lang="en" dir="ltr">' + engSavedHtml + "</div>");
        h.push("</div>");
      }
      h.push("</div>");
    } else {
      var initLangCode = editing && saved ? langCodeFor(saved.languageName || saved.language || "en") : "en";
      var initImages = editing && saved && saved.includesImages === false ? false : true;
      var initJournal = editing && saved && saved.journalName ? saved.journalName : "";

      h.push('<div class="rmd-consent-options">');
      h.push('<div class="rmd-consent-tabs">');
      h.push('<button type="button" class="rmd-btn ' + (editing ? "rmd-btn-subtle" : "rmd-btn-primary") + '" data-rmd="tab-maik">Ask MaiK to draft it</button>');
      h.push('<button type="button" class="rmd-btn ' + (editing ? "rmd-btn-primary" : "rmd-btn-subtle") + '" data-rmd="tab-manual">Do it myself</button>');
      h.push("</div>");

      // 1. Ask MaiK Section
      h.push('<div id="rmd-maik-consent-panel" class="rmd-card-sub"' + (editing ? ' style="display:none;"' : "") + ">");
      h.push("<h4>Ask MaiK to draft consent</h4>");
      h.push('<p class="rmd-ai-cost">' + ((proj && proj.tutorial) ? 'No MaiK tokens needed' : 'Costs about 2 MaiK tokens') + '</p>');
      h.push('<div><label class="rmd-pc-field-label" for="rmd-maik-lang">Language:</label>');
      h.push('<select id="rmd-maik-lang" class="rmd-select">' + langOptionsHtml(initLangCode) + "</select></div>");

      h.push('<div><label class="rmd-pc-check-label">');
      h.push('<input type="checkbox" id="rmd-maik-images"' + (initImages ? " checked" : "") + " />");
      h.push("Includes clinical photographs or diagnostic images");
      h.push("</label></div>");

      h.push('<div><label class="rmd-pc-field-label" for="rmd-maik-journal">Target journal name (optional):</label>');
      h.push('<input type="text" id="rmd-maik-journal" class="rmd-input" placeholder="e.g. BMJ Case Reports" value="' + esc(initJournal) + '" />');
      h.push("</div>");

      h.push('<div><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="generate-maik-consent">Generate publication consent</button></div>');
      h.push('<div id="rmd-maik-consent-status" class="rmd-pc-status" role="status"></div>');

      // Editor directly under Generate button
      h.push('<div id="rmd-maik-local-container" style="display:none;">');
      h.push('<label class="rmd-pc-field-label" id="rmd-maik-local-label" for="rmd-maik-local">Local Language Version:</label>');
      h.push('<p class="rmd-translation-check" id="rmd-maik-local-check">Translation check: have a native speaker or your ethics committee check this translation before use.</p>');
      h.push('<div id="rmd-maik-local-host"></div>');
      h.push("</div>");

      h.push('<div id="rmd-maik-english-container">');
      h.push('<label class="rmd-pc-field-label" id="rmd-maik-english-label" for="rmd-maik-english">Consent Document:</label>');
      h.push('<div id="rmd-maik-english-host"></div>');
      h.push("</div>");

      h.push('<div><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="save-maik-consent">Save consent</button></div>');
      h.push("</div>");

      // 2. Do-it-myself / Edit Section
      h.push('<div id="rmd-manual-consent-panel" class="rmd-card-sub"' + (editing ? "" : ' style="display:none;"') + ">");
      h.push("<h4>" + (editing ? "Edit consent document" : "Write consent document") + "</h4>");
      h.push('<div><label class="rmd-pc-field-label" for="rmd-manual-lang">Language:</label>');
      h.push('<select id="rmd-manual-lang" class="rmd-select">' + langOptionsHtml(initLangCode) + "</select></div>");

      h.push('<div id="rmd-manual-local-container" style="display:none;">');
      h.push('<label class="rmd-pc-field-label" id="rmd-manual-local-label" for="rmd-manual-local">Local Language Translation:</label>');
      h.push('<p class="rmd-translation-check" id="rmd-manual-local-check">Translation check: have a native speaker or your ethics committee check this translation before use.</p>');
      h.push('<div id="rmd-manual-local-host"></div>');
      h.push("</div>");

      h.push('<div id="rmd-manual-english-container">');
      h.push('<label class="rmd-pc-field-label" id="rmd-manual-english-label" for="rmd-manual-english">English Consent Form:</label>');
      h.push('<div id="rmd-manual-english-host"></div>');
      h.push("</div>");

      h.push('<div id="rmd-manual-consent-status" class="rmd-pc-status" role="status"></div>');
      h.push('<div><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="save-manual-consent">Save consent</button></div>');
      h.push("</div>");

      h.push("</div>");
    }

    /* F-12: the attestation the server needs before a case report can be
     * exported. Separate from the letter above: the letter is the form, this
     * records that the signed form exists and the patient saw the manuscript. */
    h.push('<div class="rmd-card" id="rmd-pubconsent-confirm" style="margin-top:12px;">');
    h.push("<h3>Confirm publication consent</h3>");
    if (confirmedFor[pid]) {
      h.push('<p role="status">Consent confirmed (consent date ' + esc(confirmedFor[pid]) + "). You can export the manuscript.</p>");
    } else {
      h.push("<p>Needed before you export a case report or case series.</p>");
      h.push('<label style="display:block;margin:6px 0;"><input type="checkbox" id="rmd-pc-written"> I have the patient\'s (or legal representative\'s) written consent for publication.</label>');
      h.push('<label style="display:block;margin:6px 0;"><input type="checkbox" id="rmd-pc-saw"> The patient (or representative) has seen the manuscript to be submitted.</label>');
      h.push('<label style="display:block;margin:6px 0;">Consent date <input type="date" id="rmd-pc-date" max="' + esc(todayIso()) + '"></label>');
      h.push('<div><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="confirm-pubconsent">Confirm consent</button></div>');
      h.push('<div id="rmd-pc-confirm-status" aria-live="polite"></div>');
    }
    h.push("</div>");

    h.push("</div></div>");
    container.innerHTML = h.join("");
    wireEvents(container, proj, pid, saved, altPid, stepNo, stepCount, nextLabel, editing);
    wireConfirm(container, proj, pid, function () {
      renderContent(container, proj, pid, stepNo, stepCount, nextLabel, saved, altPid, opts);
    });
  }

  var confirmedFor = {};

  function todayIso() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function wireConfirm(container, proj, pid, rerender) {
    if (!container || !container.querySelector) return;
    var btn = container.querySelector('[data-rmd="confirm-pubconsent"]');
    if (!btn) return;
    btn.addEventListener("click", function () {
      var statusEl = container.querySelector("#rmd-pc-confirm-status");
      var written = container.querySelector("#rmd-pc-written");
      var saw = container.querySelector("#rmd-pc-saw");
      var dateEl = container.querySelector("#rmd-pc-date");
      var date = dateEl ? trim(dateEl.value) : "";
      var say = function (msg) { if (statusEl) statusEl.innerHTML = '<span class="rmd-pc-status-error" role="alert">' + esc(msg) + "</span>"; };
      if (!written || !written.checked || !saw || !saw.checked) return say("Tick both statements to confirm.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayIso()) return say("Enter the consent date (not in the future).");
      var apiPid = (proj && proj.serverId) || pid;
      if (!SMD.api || typeof SMD.api.request !== "function") return say("Connect to the internet to confirm consent.");
      btn.disabled = true;
      SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(apiPid) + "/publication-consent", {
        writtenConsentObtained: true, patientSawManuscript: true, consentDate: date
      }).then(function (res) {
        btn.disabled = false;
        if (res && res.ok === false) return say((res.data && res.data.error && res.data.error.message) || "Could not confirm consent. Try again.");
        confirmedFor[pid] = date;
        rerender();
      }, function (err) {
        btn.disabled = false;
        say((err && err.message) || "Could not confirm consent. Try again.");
      });
    });
  }

  function wireEvents(container, proj, pid, saved, altPid, stepNo, stepCount, nextLabel, editing) {
    if (!container || !container.querySelector) return;
    var maikPanel = container.querySelector("#rmd-maik-consent-panel");
    var manualPanel = container.querySelector("#rmd-manual-consent-panel");
    var tabMaik = container.querySelector('[data-rmd="tab-maik"]');
    var tabManual = container.querySelector('[data-rmd="tab-manual"]');

    var maikLocalEd = null;
    var maikEngEd = null;
    var manualLocalEd = null;
    var manualEngEd = null;

    var initLangCode = editing && saved ? langCodeFor(saved.languageName || saved.language || "en") : "en";
    var maikLocHost = container.querySelector("#rmd-maik-local-host");
    var maikEngHost = container.querySelector("#rmd-maik-english-host");
    var manualLocHost = container.querySelector("#rmd-manual-local-host");
    var manualEngHost = container.querySelector("#rmd-manual-english-host");

    if (maikLocHost) {
      maikLocalEd = createConsentEditor(maikLocHost, {
        bodyId: "rmd-maik-local",
        language: initLangCode,
        ariaLabel: "Local language consent editor",
        toolbarLabel: "Local language consent formatting"
      });
    }
    if (maikEngHost) {
      maikEngEd = createConsentEditor(maikEngHost, {
        bodyId: "rmd-maik-english",
        language: "en",
        ariaLabel: "Consent text editor",
        toolbarLabel: "Consent formatting"
      });
    }
    if (manualLocHost) {
      manualLocalEd = createConsentEditor(manualLocHost, {
        bodyId: "rmd-manual-local",
        language: initLangCode,
        initialHtml: editing && saved ? (saved.localHtml ? saved.localHtml : plainTextToHtml(saved.local || "")) : "",
        ariaLabel: "Local language consent editor",
        toolbarLabel: "Local language consent formatting"
      });
    }
    if (manualEngHost) {
      var initEngHtml = "";
      if (editing && saved) {
        initEngHtml = saved.englishHtml ? sanitizeConsentHtml(saved.englishHtml) : plainTextToHtml(saved.english || "");
      } else {
        initEngHtml = plainTextToHtml(defaultConsentEnglish((proj && proj.title) || "", true));
      }
      manualEngEd = createConsentEditor(manualEngHost, {
        bodyId: "rmd-manual-english",
        language: "en",
        initialHtml: initEngHtml,
        ariaLabel: "English consent editor",
        toolbarLabel: "English consent formatting"
      });
    }

    function applyTwoEditorLayout(prefix, rawLang, localEd, skipTemplate) {
      var localContainer = container.querySelector("#rmd-" + prefix + "-local-container");
      var localLabel = container.querySelector("#rmd-" + prefix + "-local-label");
      var localCheck = container.querySelector("#rmd-" + prefix + "-local-check");
      var engLabel = container.querySelector("#rmd-" + prefix + "-english-label");
      if (!localContainer || !localEd) return;

      var code = langCodeFor(rawLang);
      var name = langNameFor(rawLang);
      var isNonEng = (code !== "en" && name !== "English");
      var rtl = isRtlLang(code);
      var fontStack = fontStackFor(code);

      if (isNonEng) {
        localContainer.style.display = "block";
        localContainer.setAttribute("lang", code);
        localContainer.setAttribute("dir", rtl ? "rtl" : "ltr");
        localContainer.style.fontFamily = fontStack;
        localContainer.style.textAlign = rtl ? "right" : "left";
        if (localCheck) {
          localCheck.style.textAlign = rtl ? "left" : "";
          localCheck.style.direction = rtl ? "ltr" : "";
        }
        if (localLabel) localLabel.textContent = name + " Version";
        localEd.setLanguage(code);
        if (engLabel) engLabel.textContent = "English copy (for the ethics committee)";

        if (!skipTemplate) {
          var startRev = localEd.getRevision();
          getConsentTemplates(function (tpls) {
            if (!tpls || localEd.getRevision() !== startRev) return;
            var langTpl = tpls[code] || (tpls.languages && tpls.languages[code]);
            if (!langTpl) return;
            var t = (proj && proj.title) || "";
            var tplText = buildPubconsentTemplate(langTpl, t, true);
            localEd.setText(tplText);
          });
        }
      } else {
        localContainer.style.display = "none";
        if (engLabel) {
          engLabel.textContent = (prefix === "maik") ? "Consent Document:" : "English Consent Form:";
        }
      }
    }

    if (editing && saved && manualLocalEd) {
      applyTwoEditorLayout("manual", initLangCode, manualLocalEd, true);
    }

    function enhanceSelect(selEl) {
      if (!selEl) return;
      try {
        var protoDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
        if (!protoDesc || !protoDesc.set || !protoDesc.get) return;
        Object.defineProperty(selEl, "value", {
          configurable: true,
          get: function () {
            return protoDesc.get.call(this);
          },
          set: function (v) {
            var targetCode = langCodeFor(v);
            var targetName = langNameFor(v);
            for (var i = 0; i < this.options.length; i++) {
              var optVal = this.options[i].value;
              var optText = this.options[i].text;
              if (optVal === v || optVal === targetCode || optVal === targetName || optText === targetName || optText === v) {
                this.selectedIndex = i;
                protoDesc.set.call(this, optVal);
                if (this.id === "rmd-manual-lang") {
                  applyTwoEditorLayout("manual", optVal, manualLocalEd, false);
                } else if (this.id === "rmd-maik-lang") {
                  applyTwoEditorLayout("maik", optVal, maikLocalEd, true);
                }
                return;
              }
            }
            protoDesc.set.call(this, v);
          }
        });
      } catch (e) {}
    }

    if (tabMaik && tabManual) {
      tabMaik.addEventListener("click", function () {
        if (maikPanel) maikPanel.style.display = "flex";
        if (manualPanel) manualPanel.style.display = "none";
        tabMaik.className = "rmd-btn rmd-btn-primary";
        tabManual.className = "rmd-btn rmd-btn-subtle";
      });
      tabManual.addEventListener("click", function () {
        if (maikPanel) maikPanel.style.display = "none";
        if (manualPanel) manualPanel.style.display = "flex";
        tabMaik.className = "rmd-btn rmd-btn-subtle";
        tabManual.className = "rmd-btn rmd-btn-primary";
        var manualLang = container.querySelector("#rmd-manual-lang");
        if (manualLang) {
          var shouldSkip = !!(editing && saved && langCodeFor(saved.languageName || saved.language) === langCodeFor(manualLang.value));
          applyTwoEditorLayout("manual", manualLang.value, manualLocalEd, shouldSkip);
        }
      });
    }

    var manualLangSel = container.querySelector("#rmd-manual-lang");
    if (manualLangSel) {
      enhanceSelect(manualLangSel);
      manualLangSel.addEventListener("change", function () {
        applyTwoEditorLayout("manual", this.value, manualLocalEd, false);
      });
    }

    var maikLangSel = container.querySelector("#rmd-maik-lang");
    if (maikLangSel) {
      enhanceSelect(maikLangSel);
      maikLangSel.addEventListener("change", function () {
        applyTwoEditorLayout("maik", this.value, maikLocalEd, true);
      });
    }

    function persistRecord(record, statusEl) {
      var apiPid = (proj && proj.serverId) || pid;
      var written = container.querySelector("#rmd-pc-written");
      var saw = container.querySelector("#rmd-pc-saw");
      var dateEl = container.querySelector("#rmd-pc-date");
      var date = dateEl ? trim(dateEl.value) : "";
      var bothTicked = !!(written && written.checked && saw && saw.checked);
      var shouldConfirmServer = !confirmedFor[pid] && bothTicked && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= todayIso() &&
        SMD.api && typeof SMD.api.request === "function" && (!proj || proj.serverId || String(pid || "").indexOf("loc_") !== 0);
      var serverConfirmP = shouldConfirmServer
        ? SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(apiPid) + "/publication-consent", {
            writtenConsentObtained: true, patientSawManuscript: true, consentDate: date
          }).then(function (res) {
            if (!res || res.ok !== false) confirmedFor[pid] = date;
          }, function () {})
        : Promise.resolve();
      if (G.RMDStore && G.RMDStore.put) {
        Promise.all([
          G.RMDStore.put(pid, "pubconsent", "consent", record).then(function () {
            if (altPid) {
              return G.RMDStore.put(altPid, "pubconsent", "consent", record).catch(function () {});
            }
          }),
          serverConfirmP
        ]).then(function () {
          render(container, { projectId: pid });
        }).catch(function (err) {
          if (statusEl) {
            statusEl.innerHTML = '<span class="rmd-pc-status-error" role="alert">Could not save consent: ' + esc((err && err.message) || "Storage error") + "</span>";
          }
        });
      } else {
        serverConfirmP.then(function () {
          renderContent(container, proj, pid, stepNo, stepCount, nextLabel, record, altPid, null);
        });
      }
    }

    var genBtn = container.querySelector('[data-rmd="generate-maik-consent"]');
    if (genBtn) {
      genBtn.addEventListener("click", function () {
        var statusEl = container.querySelector("#rmd-maik-consent-status");
        var langSelect = container.querySelector("#rmd-maik-lang");
        var imgCheck = container.querySelector("#rmd-maik-images");
        var journalInput = container.querySelector("#rmd-maik-journal");

        var langCode = langSelect ? langCodeFor(langSelect.value) : "en";
        var langName = langNameFor(langCode);
        var hasImages = imgCheck ? imgCheck.checked : true;
        var journal = journalInput ? trim(journalInput.value) : "";

        if (statusEl) statusEl.innerHTML = '<span class="rmd-pc-status-info">Drafting consent with MaiK...</span>';
        genBtn.disabled = true;

        var body = {
          task: "publication_consent",
          input: {
            language: langName,
            includesImages: hasImages,
            journalName: journal
          }
        };
        var apiPid = (proj && proj.serverId) || pid;
        var reqPromise;
        if (SMD.api && typeof SMD.api.request === "function") {
          reqPromise = SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(apiPid) + "/ai-draft", body)
            .then(function (data) { return { status: 200, data: data }; });
        } else {
          reqPromise = fetch("/api/research/v1/projects/" + encodeURIComponent(apiPid) + "/ai-draft", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          }).then(function (res) {
            return res.json().then(function (data) { return { status: res.status, data: data }; });
          });
        }
        reqPromise.then(function (resp) {
          genBtn.disabled = false;
          if (resp.status >= 200 && resp.status < 300 && resp.data && resp.data.draft) {
            var draft = resp.data.draft;
            var engRaw = typeof draft.english === "string" ? draft.english : "";
            var locRaw = typeof draft.local === "string" ? draft.local : "";
            if (!trim(engRaw) && !trim(locRaw)) {
              if (statusEl) {
                statusEl.innerHTML = '<span class="rmd-pc-status-error" role="alert">MaiK returned an empty consent. Try again, or type it below.</span>';
              }
              return;
            }
            var draftCode = langCodeFor(draft.language || draft.languageName || langCode);
            if (maikLangSel && draftCode !== langCode) {
              langCode = draftCode;
              langName = langNameFor(draftCode);
            }
            applyTwoEditorLayout("maik", langCode, maikLocalEd, true);
            if (langCode !== "en" && maikLocalEd) {
              maikLocalEd.setHtml(toEditorHtml(locRaw));
            }
            if (maikEngEd) {
              maikEngEd.setHtml(toEditorHtml(engRaw));
            }
            if (statusEl) {
              statusEl.innerHTML = '<span class="rmd-pc-status-info">Draft loaded below. Review or format it, then tap Save consent.</span>';
            }
          } else {
            var msg = (resp.data && resp.data.error && resp.data.error.message) || "Failed to generate consent.";
            if (statusEl) statusEl.innerHTML = '<span class="rmd-pc-status-error" role="alert">' + esc(msg) + "</span>";
          }
        }).catch(function (err) {
          genBtn.disabled = false;
          if (statusEl) statusEl.innerHTML = '<span class="rmd-pc-status-error" role="alert">Error: ' + esc((err && err.message) || String(err)) + "</span>";
        });
      });
    }

    var saveMaikBtn = container.querySelector('[data-rmd="save-maik-consent"]');
    if (saveMaikBtn) {
      saveMaikBtn.addEventListener("click", function () {
        var statusEl = container.querySelector("#rmd-maik-consent-status");
        var langSelect = container.querySelector("#rmd-maik-lang");
        var imgCheck = container.querySelector("#rmd-maik-images");
        var journalInput = container.querySelector("#rmd-maik-journal");
        var langCode = langSelect ? langCodeFor(langSelect.value) : "en";
        var langName = langNameFor(langCode);
        var isNonEng = (langCode !== "en");
        var engHtml = maikEngEd ? maikEngEd.getHtml() : "";
        var locHtml = (isNonEng && maikLocalEd) ? maikLocalEd.getHtml() : "";
        var engText = maikEngEd ? maikEngEd.getText() : "";
        var locText = (isNonEng && maikLocalEd) ? maikLocalEd.getText() : "";

        if (!trim(engText) && !trim(locText)) {
          if (statusEl) statusEl.innerHTML = '<span class="rmd-pc-status-error" role="alert">Type or generate the consent before saving.</span>';
          return;
        }
        persistRecord({
          english: engText,
          local: locText,
          englishHtml: engHtml,
          localHtml: locHtml,
          language: langCode,
          languageName: langName,
          includesImages: imgCheck ? imgCheck.checked : true,
          journalName: journalInput ? trim(journalInput.value) : ""
        }, statusEl);
      });
    }

    var saveManualBtn = container.querySelector('[data-rmd="save-manual-consent"]');
    if (saveManualBtn) {
      saveManualBtn.addEventListener("click", function () {
        var statusEl = container.querySelector("#rmd-manual-consent-status");
        var langVal = (container.querySelector("#rmd-manual-lang") || {}).value || "en";
        var langCode = langCodeFor(langVal);
        var langName = langNameFor(langCode);
        var isNonEng = (langCode !== "en");
        var engHtml = manualEngEd ? manualEngEd.getHtml() : "";
        var locHtml = (isNonEng && manualLocalEd) ? manualLocalEd.getHtml() : "";
        var engText = manualEngEd ? manualEngEd.getText() : "";
        var locText = (isNonEng && manualLocalEd) ? manualLocalEd.getText() : "";

        persistRecord({
          english: engText,
          local: locText,
          englishHtml: engHtml,
          localHtml: locHtml,
          language: langCode,
          languageName: langName,
          includesImages: (saved && typeof saved.includesImages === "boolean") ? saved.includesImages : true,
          journalName: (saved && saved.journalName) || ""
        }, statusEl);
      });
    }

    var editBtn = container.querySelector('[data-rmd="pubconsent-edit"]');
    if (editBtn) {
      editBtn.addEventListener("click", function () {
        renderContent(container, proj, pid, stepNo, stepCount, nextLabel, saved, altPid, { editing: true });
      });
    }

    var copyBtn = container.querySelector('[data-rmd="pubconsent-copy"]');
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        if (!saved) return;
        var sName = saved.languageName || (saved.language ? langNameFor(saved.language) : "English");
        var sCode = langCodeFor(sName);
        var textToCopy = (sCode !== "en" && sName !== "English" && saved.local) ? saved.local : (saved.english || "");
        var markCopied = function () {
          copyBtn.textContent = "Copied!";
          setTimeout(function () { copyBtn.textContent = "Copy"; }, 2000);
        };
        var fallbackCopy = function () {
          try {
            if (!D || !D.body) return;
            var ta = D.createElement("textarea");
            ta.value = textToCopy;
            ta.setAttribute("readonly", "");
            ta.style.cssText = "position:fixed;left:-9999px;top:0;";
            D.body.appendChild(ta);
            ta.select();
            D.execCommand("copy");
            D.body.removeChild(ta);
            markCopied();
          } catch (e) {}
        };
        if (G.navigator && G.navigator.clipboard && G.navigator.clipboard.writeText) {
          G.navigator.clipboard.writeText(textToCopy).then(markCopied, fallbackCopy);
        } else {
          fallbackCopy();
        }
      });
    }

    var docxBtn = container.querySelector('[data-rmd="pubconsent-docx"]');
    if (docxBtn && saved) {
      docxBtn.addEventListener("click", function () {
        var errEl = container.querySelector("#rmd-pubconsent-status");
        var sName = saved.languageName || (saved.language ? langNameFor(saved.language) : "English");
        var sCode = langCodeFor(sName);
        var isRtl = isRtlLang(sCode);

        if (sCode !== "en" && sName !== "English") {
          if (!saved.local || !trim(saved.local)) {
            var blockedMsg = "Fill in the " + sName + " version first.";
            if (errEl) errEl.innerHTML = '<span class="rmd-pc-status-error" role="alert">' + esc(blockedMsg) + "</span>";
            return;
          }
        }
        if (errEl) errEl.innerHTML = "";

        var sections = [];
        var title = "Consent for Publication - " + ((proj && proj.title) || "Case Report");

        if (sCode !== "en" && sName !== "English") {
          sections.push({
            heading: "Patient Consent for Publication (" + sName + ")",
            text: saved.local,
            html: saved.localHtml || "",
            isRtl: isRtl,
            size: 28
          });
          sections.push({ pageBreak: true });
          sections.push({
            heading: "English copy (for the ethics committee)",
            text: saved.english || "",
            html: saved.englishHtml || "",
            isRtl: false,
            size: 24
          });
        } else {
          sections.push({
            heading: "Patient Consent for Publication",
            text: saved.english || "",
            html: saved.englishHtml || "",
            isRtl: false,
            size: 28
          });
        }

        var bytes = createDocx(title, sections);
        if (bytes && SMD.p2 && SMD.p2.downloadBytes) {
          var name = (SMD.p2.fileSlug ? SMD.p2.fileSlug(title, "publication-consent") : "publication-consent") + ".docx";
          SMD.p2.downloadBytes(name, bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", title);
        }
      });
    }
  }

  var API = {
    render: render,
    defaultConsentEnglish: defaultConsentEnglish,
    buildPubconsentTemplate: buildPubconsentTemplate,
    sanitizeConsentHtml: sanitizeConsentHtml,
    sanitizeHtml: sanitizeConsentHtml,
    htmlToPlainText: htmlToPlainText,
    plainTextToHtml: plainTextToHtml,
    htmlToDocxParagraphs: htmlToDocxParagraphs,
    docxParagraph: docxParagraph,
    createDocx: createDocx,
    langCodeFor: langCodeFor,
    langNameFor: langNameFor,
    isRtlLang: isRtlLang,
    fontStackFor: fontStackFor
  };

  SMD.screens[KEY] = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
