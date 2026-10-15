/* PrepNucleus explanation formatting: a safe render-only formatter for stored MCQ explanations. ES5.
 *
 * Stored bank text is never rewritten (owner rule); this module only decides how an explanation is DRAWN.
 * It builds on prep-listfmt.js (lists and pasted-table explanations stay with its parser and renderer):
 * the caller tries PREP_LISTFMT.exp first and falls through to EXPFMT.exp for everything else. Anything this
 * module is unsure about falls back to the original text in clean paragraphs: it never splits mid-word and
 * never drops text (the visible text of its output equals the input apart from whitespace and list markers).
 *
 * What it does, in order: pulls trailing REF:/Reference: lines into reference chips; lifts a leading answer
 * sentence ("Ans. ...", "Answer ...", "ANSWTER: (A) ...") into a strong key line; renders the safe minimal
 * Markdown subset new items use (bold, bullets, numbered steps, ## headings, pipe tables, line breaks);
 * turns legacy MedMCQA "*" runs and semicolon runs into lists; splits the rest into one paragraph per
 * sentence; and emboldens, inside every block, the item's own option phrases, drug names from the app's
 * drug lexicon (passed in, never bundled) and numeric thresholds with units. Everything is escaped first:
 * no raw HTML, no links, no attributes from the text.
 *
 * window.PREP_EXPFMT. Pure helpers load under node for tests.
 */
(function (G) {
  "use strict";

  function escH(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function trim(s) { return String(s).replace(/^\s+|\s+$/g, ""); }
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  /* ---- drug names: the app passes its own list (drug-lexicon.js generics + brands). ---- */
  var DRUG_STOP = { acid: 1, acids: 1, salt: 1, salts: 1, water: 1, air: 1, ion: 1, ions: 1, cation: 1,
    anion: 1, base: 1, bases: 1, solution: 1, oil: 1, powder: 1, vaccine: 0 };
  function drugNames(lex) {
    var names = [];
    if (!lex) return names;
    if (Object.prototype.toString.call(lex) === "[object Array]") names = lex.slice();
    else {
      if (lex.generics && lex.generics.length) names = names.concat(lex.generics);
      if (lex.brands) for (var b in lex.brands) if (Object.prototype.hasOwnProperty.call(lex.brands, b)) names.push(b);
    }
    var seen = {}, out = [], i, n;
    for (i = 0; i < names.length; i++) {
      n = trim(String(names[i]).toLowerCase()).replace(/\s+/g, " ");
      if (!n || n.length < 4 || seen[n]) continue;
      seen[n] = 1;
      if (n.indexOf(" ") < 0 && DRUG_STOP[n]) continue;
      out.push(n);
    }
    out.sort(function (a, b) { return b.length - a.length; });
    return out;
  }
  function drugRx(names) {
    if (!names || !names.length) return null;
    var keep = [], seen = {}, i, n;
    for (i = 0; i < names.length; i++) {
      n = trim(String(names[i]).toLowerCase()).replace(/\s+/g, " ");
      if (!n || n.length < 4 || seen[n]) continue;
      seen[n] = 1;
      if (n.indexOf(" ") < 0 && DRUG_STOP[n]) continue;
      keep.push(n);
    }
    if (!keep.length) return null;
    keep.sort(function (a, b) { return b.length - a.length; });
    return new RegExp("\\b(" + keep.map(escRe).join("|") + ")\\b", "gi");
  }

  /* Numeric thresholds with units: "65-75 %", "7cms", "5 mg", "120 mmHg", "< 7" stays untouched (no unit). */
  var NUMRX = /\b\d+(?:\.\d+)?(?:\s*[-\u2013]\s*\d+(?:\.\d+)?)?\s*(%|percent|mg|mcg|\u00b5g|g|kg|ml|mmhg|mmol\/l|mg\/dl|ng\/ml|pg\/ml|iu|u\/l|units?|cm|cms|mm|hours?|hrs?|days?|weeks?|months?|years?|yrs?|mins?|tablets?|drops?)\b/gi;

  function phraseRx(phrases) {
    var keep = [], i, p;
    for (i = 0; i < (phrases || []).length; i++) {
      p = trim(String(phrases[i])).replace(/\s+/g, " ");
      if (p.length < 5) continue;
      keep.push(escH(p));
    }
    if (!keep.length) return null;
    keep.sort(function (a, b) { return b.length - a.length; });
    return new RegExp("\\b(" + keep.map(escRe).join("|") + ")\\b", "gi");
  }

  /* Wrap rx matches in <strong>, never inside an existing <strong> span (no nesting). */
  function emphOutside(s, rx) {
    if (!rx) return s;
    var parts = String(s).split(/(<strong>[\s\S]*?<\/strong>)/g), i;
    for (i = 0; i < parts.length; i += 2) {
      rx.lastIndex = 0;
      parts[i] = parts[i].replace(rx, function (m) { return "<strong>" + m + "</strong>"; });
    }
    return parts.join("");
  }

  var BOLDRX = /\*\*(?=\S)([^*]*?\S)\*\*/g;
  /* inline(text, ctx): escaped HTML with **bold** kept and option phrases, drugs and numbers emboldened. */
  function inline(text, ctx) {
    var e = escH(text);
    BOLDRX.lastIndex = 0;
    var parts = e.split(/(\*\*(?=\S)[^*]*?\S\*\*)/g), i, s;
    for (i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        parts[i] = "<strong>" + parts[i].replace(/^\*\*|\*\*$/g, "") + "</strong>";
        continue;
      }
      s = parts[i];
      if (ctx) {
        if (!ctx._prx && ctx.o) ctx._prx = phraseRx(ctx.o);
        s = emphOutside(s, ctx._prx);
        s = emphOutside(s, ctx.drugRx || null);
        NUMRX.lastIndex = 0;
        s = emphOutside(s, NUMRX);
      }
      parts[i] = s;
    }
    return parts.join("");
  }

  /* ---- sentence splitting (abbreviations never break a sentence). ---- */
  var ABBR = /\b(e\.g|i\.e|etc|vs|dr|mr|mrs|st|fig|figs|no|nos|spp|al|lt|approx|est|sr|jr|br|min|mins|sec|secs|hr|hrs|wk|wks|mo|mos|yr|yrs|p|pp|ed|eds|ch|vol)\.$/i;
  function sentences(t) {
    var texts = [], marks = [];
    var prot = String(t)
      .replace(/\b[A-Z]\./g, function (m) { marks.push(m); return "@@XFM-S" + (marks.length - 1) + "@@"; })
      .replace(/\b\d{1,2}\./g, function (m) { marks.push(m); return "@@XFM-S" + (marks.length - 1) + "@@"; });
    function unmark(s) { return s.replace(/@@XFM-S(\d+)@@/g, function (m, k) { return marks[+k]; }); }
    var re = /([\.\!\?])(\)?"?'?\s+)(?=[A-Z0-9"'\(\[])/g, m;
    /* An abbreviation before the break cancels the split. */
    var parts = [], last = 0;
    while ((m = re.exec(prot))) {
      var h = prot.slice(last, m.index + 1).replace(/@@XFM-S\d+@@/g, "X.").replace(/\s+$/g, "");
      if (!/X\.$/.test(h) && !ABBR.test(h)) { parts.push(prot.slice(last, m.index + m[0].length)); last = m.index + m[0].length; }
    }
    parts.push(prot.slice(last));
    for (var i = 0; i < parts.length; i++) {
      var s = trim(unmark(parts[i]));
      if (s) texts.push(s);
    }
    return texts;
  }

  var ANSRX = /^\s*(ans\w*\.?|answer(?:\s+is)?)\s*:?/i;
  function takeAnswer(t) {
    if (!ANSRX.test(t)) return null;
        /* Find the first sentence end after the answer marker itself. */
    var mark = ANSRX.exec(t)[0].length, tail = t.slice(mark), re = /[\.\!\?](\s+|$)/g, e = null, m;
    while ((m = re.exec(tail))) {
      if (!/\b(e\.g|i\.e|etc|vs|fig)\.$/i.test(tail.slice(0, m.index + 1).replace(/\s+$/g, ""))) { e = m; break; }
    }
    var ans = e ? t.slice(0, mark + e.index + 1) : t;
    if (trim(ans).length < 6) return null;
    return { ans: trim(ans), rest: trim(e ? t.slice(mark + e.index + 1) : "") };
  }

  var REFRE = /(?:^|[\s.?!:;)\]])(REF\s*:)\s*/gi;
  var REFGLUE = /([a-z0-9)\]])(REF\s*:)\s*/gi;
  function takeRefs(t, chips) {
    var body = String(t), m, found = [];
    REFRE.lastIndex = 0;
    while ((m = REFRE.exec(body))) found.push({ at: m.index + m[0].indexOf(m[1]), end: m.index + m[0].length });
    REFGLUE.lastIndex = 0;
    while ((m = REFGLUE.exec(body))) {
      var at = m.index + 1, end = m.index + m[0].length;
      if (!found.some(function (f) { return Math.abs(f.at - at) < 5; })) found.push({ at: at, end: end });
    }
    if (!found.length) return body;
    /* Cut from the last REF: backwards so indices stay valid; keep the chip only when it is short and
       terminated (a book line, not the rest of the explanation). */
    for (var i = found.length - 1; i >= 0; i--) {
      var after = body.slice(found[i].end);
      var e = /[\.\!\?](\s+|$)/.exec(after);
      /* A trailing reference ("Ref: Dutta 6/e p58") has no terminator: take the tail when short. */
      var chip = e ? trim(after.slice(0, e.index + 1)) : trim(after);
      if (!e && (chip.length < 4 || chip.length > 140)) chip = "";
      if (e && chip && chip.length >= 4 && chip.length <= 140) {
        /* Glued continuations ("p. 58-59HCG is ...") are not a new sentence: leave the REF in place
           rather than labelling explanation text as a reference. */
        var rest = after.slice(e.index + 1);
        if (trim(rest) && !/^\s*["\u201c'(\[]*[A-Z]/.test(rest)) chip = "";
        if (chip && /\b[A-Z]\.$/.test(chip)) {
          var e2 = /[\.\!\?](\s+|$)/.exec(rest);
          var ext = e2 ? trim(after.slice(0, (after.length - rest.length) + e2.index + 1)) : "";
          chip = (ext && ext.length <= 140) ? ext : "";
        }
      }
      if (chip) {
        chips.push(chip);
        var hold = "@@XFM-C" + (chips.length - 1) + "@@";
        body = body.slice(0, found[i].at) + hold + after.slice(chip.length);
      }
    }
    return body;
  }

  var REFLINERX = /^\s*(refs?\.?|references?|source)\s*:\s*(.+?)\s*$/i;
  /* Reference lines become inline chips ("@@XFM-C<n>@@") so the chip renders where the line stood:
     moving references to the end would reorder the text. */
  function takeRefLines(lines, chips) {
    var kept = [], i, m;
    for (i = 0; i < lines.length; i++) {
      m = REFLINERX.exec(lines[i]);
      if (m && trim(m[2]).length >= 2 && m[2].length <= 200) {
        chips.push(trim(m[2]));
        kept.push("@@XFM-C" + (chips.length - 1) + "@@");
      }
      else kept.push(lines[i]);
    }
    return kept;
  }

  var STARRE = /(^|\s)\*(?!\*)(?=[^\s\*])/g;
  function legacyStars(t) {
    STARRE.lastIndex = 0;
    var hits = String(t).match(STARRE);
    if (hits && hits.length >= 2) return String(t).replace(STARRE, "\n- ").replace(/^\s+/, "");
    return String(t).replace(/^\*(?!\*)\s*/, "");
  }

  function hasMd(t) {
    var lines = String(t).split("\n"), i;
    for (i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (/^\s*#{1,6}\s+\S/.test(l) || /^\s*[-*\u2022]\s+\S/.test(l) || /^\s*\d{1,2}[.)]\s+\S/.test(l)) return true;
      if (l.charAt(0) === "|" && i + 1 < lines.length && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(trim(lines[i + 1]))) return true;
    }
    return /\*\*(?=\S)[^*]*?\S\*\*/.test(t);
  }

  function cellsOf(l) { return trim(l).replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) { return trim(c); }); }
  function mdHtml(t, ctx) {
    var lines = String(t).replace(/\r\n?/g, "\n").split("\n"), out = [], para = [], list = null, i = 0, m;
    function flushP() { if (para.length) { out.push("<p>" + inline(para.join(" "), ctx) + "</p>"); para = []; } }
    function flushL() {
      if (!list) return;
      out.push("<" + list.t + (list.start > 1 ? ' start="' + list.start + '"' : "") + ">" +
        list.items.map(function (x) { return "<li>" + inline(x, ctx) + "</li>"; }).join("") + "</" + list.t + ">");
      list = null;
    }
    while (i < lines.length) {
      var l = lines[i], tl = trim(l);
      if (!tl) { flushP(); flushL(); i++; continue; }
      if ((m = /^#{1,6}\s+(.+?)\s*#*$/.exec(tl))) { flushP(); flushL(); out.push('<h4 class="pn-xh">' + inline(m[1], ctx) + "</h4>"); i++; continue; }
      if (tl.charAt(0) === "|" && i + 1 < lines.length && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(trim(lines[i + 1]))) {
        flushP(); flushL();
        var head = cellsOf(tl), rows = [];
        i += 2;
        while (i < lines.length && trim(lines[i]).charAt(0) === "|") rows.push(cellsOf(lines[i++]));
        var w = head.length;
        out.push('<div class="pn-xt" role="region" tabindex="0" aria-label="Table: ' + escH(head.join(", ").replace(/\*/g, "")) + '"><table><thead><tr>' +
          head.map(function (c) { return '<th scope="col">' + inline(c, ctx) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          rows.map(function (r) {
            var cs = [];
            for (var k = 0; k < w; k++) cs.push(k ? "<td>" + inline(r[k] || "", ctx) + "</td>" : '<th scope="row">' + inline(r[k] || "", ctx) + "</th>");
            return "<tr>" + cs.join("") + "</tr>";
          }).join("") + "</tbody></table></div>");
        continue;
      }
      var b = /^[-*\u2022]\s+(.*)$/.exec(tl), n = /^(\d{1,2})[.)]\s+(.*)$/.exec(tl);
      if (b || n) {
        flushP();
        var ty = b ? "ul" : "ol";
        if (!list || list.t !== ty) { flushL(); list = { t: ty, items: [], start: n ? +n[1] : 1 }; }
        list.items.push(b ? b[1] : n[2]);
        i++; continue;
      }
      flushL(); para.push(tl); i++;
    }
    flushP(); flushL();
    return out.join("");
  }

  /* A semicolon run of parallel items ("a; b; c"): >= 3 short segments covering most of the text. */
  function semiList(t) {
    if (/\n/.test(t)) return null;
    var segs = String(t).split(";"), i;
    if (segs.length < 3) return null;
    var keep = [];
    for (i = 0; i < segs.length; i++) {
      var s = trim(segs[i]);
      if (s.length < 2 || s.length > 160) return null;
      if (i < segs.length - 1 && /[\.\!\?]\s+[A-Z0-9]/.test(s)) return null;
      keep.push(s);
    }
    var covered = 0;
    for (i = 0; i < keep.length; i++) covered += keep[i].length;
    if (covered < t.length * 0.7) return null;
    return keep;
  }

  function fillChips(html, chips) {
    return String(html).replace(/@@XFM-C(\d+)@@/g, function (m, k) {
      return chips[+k] == null ? "" : '<span class="pn-xchip">' + escH(chips[+k]) + "</span>";
    });
  }

  /* exp(text, ctx): the stored explanation as HTML. Never null for non-blank input; "" for blank. */
  function exp(text, ctx) {
    var t = String(text == null ? "" : text).replace(/\r\n?/g, "\n").replace(/@@XFM-[SC]\d+@@/g, "");
    if (!trim(t)) return "";
    /* Very long blobs (pasted tables belong to PREP_LISTFMT): plain paragraphs, still escaped. */
    if (t.length > 8000) return "<p>" + escH(t.replace(/\s+/g, " ").replace(/^ | $/g, "")) + "</p>";
    var chips = [];
    t = takeRefLines(t.split("\n"), chips).join("\n");
    t = takeRefs(t, chips);
    var tookAns = takeAnswer(t), ans = null;
    if (tookAns) { ans = tookAns.ans; t = tookAns.rest; }
    var body = "";
    if (!trim(t)) body = "";
    else if (hasMd(t)) body = mdHtml(t, ctx);
    else {
      var leg = legacyStars(t);
      if (leg !== t && /\n- /.test(leg)) {
        body = mdHtml(leg, ctx);
      } else {
        var semi = semiList(trim(t).replace(/\n+/g, " "));
        if (semi) body = "<ul>" + semi.map(function (s) { return "<li>" + inline(s, ctx) + "</li>"; }).join("") + "</ul>";
        else {
          var ss = sentences(t), i, ps = [];
          for (i = 0; i < ss.length; i++) ps.push("<p>" + inline(ss[i], ctx) + "</p>");
          body = ps.join("");
        }
      }
    }
    var html = (ans ? '<p class="pn-xkey"><strong>' + inline(ans, null) + "</strong></p>" : "") + body;
    return fillChips(html, chips);
  }

  /* kindOf(text, ctx): which path exp() takes (for counts and tests). */
  function kindOf(text, ctx) {
    var t = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
    if (!trim(t)) return "empty";
    t = takeRefLines(t.split("\n"), []).join("\n");
    t = takeRefs(t, []);
    var tookAns = takeAnswer(t);
    if (tookAns) t = tookAns.rest;
    if (!trim(t)) return tookAns ? "answer" : "empty";
    if (hasMd(t)) return "md";
    var leg = legacyStars(t);
    if (leg !== t && /\n- /.test(leg)) return "legacy";
    if (semiList(trim(t).replace(/\n+/g, " "))) return "semi";
    if (tookAns) return "answer";
    var probe = inline(t, ctx);
    if (/<strong>/.test(probe)) return "rich";
    return "plain";
  }

  function visible(html) {
    return String(html).replace(/<\/(p|li|ul|ol|h[1-6]|tr|table|div|br)>/g, " ").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").replace(/^ | $/g, "");
  }

  var PURE = { exp: exp, inline: inline, kindOf: kindOf, visible: visible, esc: escH,
    drugNames: drugNames, drugRx: drugRx, sentences: sentences };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }
  G.PREP_EXPFMT = PURE;
})(typeof window !== "undefined" ? window : this);
