/* PrepNucleus list formatting: a safe render-only parser for run-together enumerations. ES5.
 *
 * Stored bank text is never rewritten (owner rule); this module only decides how a stem, an option or an
 * explanation is DRAWN. parse() returns null unless it is confident: the run holds >= 2 consecutive labels in
 * order (a,b,c... / 1,2,3... / i,ii,iii...), every item body is non-empty, and abbreviation lookalikes
 * (Vitamin B., Fig. 2., T1., e.g., doses) are rejected. Anything unsure falls back to the original text.
 *
 * window.PREP_LISTFMT. Pure helpers load under node for tests.
 */
(function (G) {
  "use strict";

  function escH(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function trim(s) { return String(s).replace(/^\s+|\s+$/g, ""); }

  var ROMAN_SEQ = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];
  function romanVal(s) { s = String(s).toLowerCase(); for (var i = 0; i < ROMAN_SEQ.length; i++) if (ROMAN_SEQ[i] === s) return i + 1; return 0; }
  /* Words a label-looking token may belong to: "Vitamin B.", "Fig. 2.", "e.g. ", "Type A." are not lists. */
  var DENY_PRE = { fig: 1, figure: 1, table: 1, vitamin: 1, vitamins: 1, type: 1, stage: 1, grade: 1, group: 1, lead: 1, no: 1, vs: 1, dr: 1, mr: 1, mrs: 1, st: 1, e: 1, ie: 1, eg: 1 };

  function wordBefore(t, at) {
    var m = /[A-Za-z]+\.?$/.exec(t.slice(0, at));
    return m ? m[0].replace(/\.$/, "").toLowerCase() : "";
  }

  /* One scanner per label style. Each returns matches: {at, end, key, disp}. */
  var STYLES = {
    /* a. b. c. (glued joints like "cancerc." still match: the dot belongs to the label) */
    alphaDot: {
      ol: "a", seq: "alpha",
      scan: function (t) {
        var out = [], re = /([A-Za-z])\.\s+/g, m;
        while ((m = re.exec(t))) {
          var at = m.index, lab = m[1].toLowerCase();
          if (DENY_PRE[wordBefore(t, at)]) continue;
          out.push({ at: at, end: at + m[0].length, key: lab, disp: lab + ")" });
        }
        return out;
      },
      first: "a", next: function (k) { return String.fromCharCode(k.charCodeAt(0) + 1); }
    },
    /* (a) (b) (c) */
    alphaParen: {
      ol: "a", seq: "alpha",
      scan: function (t) {
        var out = [], re = /\(([A-Za-z])\)\s*/g, m;
        while ((m = re.exec(t))) {
          var lab = m[1].toLowerCase();
          out.push({ at: m.index, end: m.index + m[0].length, key: lab, disp: "(" + lab + ")" });
        }
        return out;
      },
      first: "a", next: function (k) { return String.fromCharCode(k.charCodeAt(0) + 1); }
    },
    /* a) b) c) */
    alphaClose: {
      ol: "a", seq: "alpha",
      scan: function (t) {
        var out = [], re = /(^|[\s(:;])([A-Za-z])\)\s+/g, m;
        while ((m = re.exec(t))) {
          var at = m.index + m[1].length, lab = m[2].toLowerCase();
          if (DENY_PRE[wordBefore(t, at)]) continue;
          out.push({ at: at, end: at + m[0].length - m[1].length, key: lab, disp: lab + ")" });
        }
        return out;
      },
      first: "a", next: function (k) { return String.fromCharCode(k.charCodeAt(0) + 1); }
    },
    /* 1. 2. 3. (decimals like 1.5 never match: the dot needs whitespace after it) */
    numDot: {
      ol: "1", seq: "num",
      scan: function (t) {
        var out = [], re = /(\d{1,2})\.\s+/g, m;
        while ((m = re.exec(t))) {
          var at = m.index;
          /* A digit glued to a letter (T1., N2.) is staging, not a list. */
          if (/[A-Za-z]/.test(t.charAt(at - 1))) continue;
          out.push({ at: at, end: at + m[0].length, key: String(parseInt(m[1], 10)), disp: m[1].replace(/^0+/, "") + ")" });
        }
        return out;
      },
      first: "1", next: function (k) { return String(parseInt(k, 10) + 1); }
    },
    /* A. B. C. */
    upperDot: {
      ol: "A", seq: "upper",
      scan: function (t) {
        var out = [], re = /(^|[\s(:;)\]])([A-Z])\.\s+/g, m;
        while ((m = re.exec(t))) {
          var at = m.index + m[1].length;
          if (DENY_PRE[wordBefore(t, at)]) continue;
          out.push({ at: at, end: at + m[0].length - m[1].length, key: m[2], disp: m[2] + ")" });
        }
        return out;
      },
      first: "A", next: function (k) { return String.fromCharCode(k.charCodeAt(0) + 1); }
    },
    /* i) ii) iii) */
    roman: {
      ol: "i", seq: "roman",
      scan: function (t) {
        var out = [], re = /(^|[\s(:;])((?:viii|vii|iii|ii|iv|ix|vi|v|i))\s*\)\s+/gi, m;
        while ((m = re.exec(t))) {
          var at = m.index + m[1].length, lab = m[2].toLowerCase();
          out.push({ at: at, end: at + m[0].length - m[1].length, key: lab, disp: lab + ")" });
        }
        return out;
      },
      first: "i", next: function (k) { var i = ROMAN_SEQ.indexOf(k); return i >= 0 ? ROMAN_SEQ[i + 1] : null; }
    }
  };

  /* A confident run of one style: consecutive labels from the first element, non-empty bodies. */
  function runOf(style, t) {
    var st = STYLES[style], ms = st.scan(t), i, s;
    var starts = [];
    for (i = 0; i < ms.length; i++) if (ms[i].key === st.first) starts.push(i);
    /* Every start is tried in order: a phantom first label ("atresia. He has ... a. Real1 b. Real2") must not
       hide the genuine run behind it. */
    for (s = 0; s < starts.length; s++) {
      var items = [], want = st.first;
      for (i = starts[s]; i < ms.length; i++) {
        if (ms[i].key !== want) break;
        var bodyEnd = i + 1 < ms.length ? ms[i + 1].at : t.length;
        var body = trim(t.slice(ms[i].end, bodyEnd));
        if (!body) break;
        /* Item bodies under 4 characters are almost always phantom labels ("DNA. The b. ..." gives "The"); short
           all-caps abbreviations (UIP, LCH, COP) are the real exception. */
        if (body.length < 4 && !/^[A-Z0-9][A-Z0-9 \-\/]{0,29}$/.test(body)) break;
        if (body.length > 400) break;
        if (/^[.,;:)\]]+$/.test(body)) break;
        items.push({ label: ms[i].key, disp: ms[i].disp, text: body, at: ms[i].at, end: ms[i].end });
        want = st.next(want);
        if (!want || items.length >= 12) break;
      }
      if (items.length < 2) continue;
      /* A run whose first label is glued to a word ("atresia. He has ... thumb. Renal ..." gives a, b) is
         ambiguous with sentence punctuation: it needs at least 3 labels, which prose never forms by accident. */
      if (/[A-Za-z0-9]/.test(t.charAt(items[0].at - 1)) && items.length < 3) continue;
      return { style: style, ol: st.ol, seq: st.seq, items: items, lead: trim(t.slice(0, items[0].at)) };
    }
    return null;
  }

  function bodiesOverlap(a, b) { return a.at < b.end && b.at < a.end; }

  /* parse(text) -> null | {lead, items, ol} | {lead, match:{cols:[{head, items}]}}. */
  function parse(text) {
    var t = String(text == null ? "" : text);
    if (!/\S/.test(t) || t.length > 4000) return null;
    var names = ["alphaDot", "alphaParen", "alphaClose", "numDot", "upperDot", "roman"], runs = [], i;
    for (i = 0; i < names.length; i++) { var r = runOf(names[i], t); if (r) runs.push(r); }
    if (!runs.length) return null;
    if (runs.length === 1) return { lead: runs[0].lead, items: runs[0].items, ol: runs[0].ol, match: null };
    /* Two confident runs: a match-the-following table only when the stem says so or the runs interleave
       (Column I / Column II pairs); otherwise the earliest run wins and the other stays plain text. */
    var saysMatch = /match|column/i.test(t);
    var a = runs[0], b = runs[1];
    function interleave(x, y) {
      var turn = x.items[0].at < y.items[0].at ? 0 : 1, seq = [x.items, y.items];
      var merged = x.items.concat(y.items).sort(function (p, q) { return p.at - q.at; });
      for (var n = 0; n < merged.length; n++) {
        var which = seq[0].indexOf(merged[n]) >= 0 ? 0 : 1;
        if (which !== turn) return false;
        turn = 1 - turn;
      }
      return true;
    }
    if ((saysMatch || interleave(a, b)) && !bodiesOverlap(a.items[0], b.items[0])) {
      var first = a.items[0].at < b.items[0].at ? a : b, second = first === a ? b : a;
      /* Re-cut bodies at every label of either run so "1. Scaphocephaly a. Metopic 2. ..." splits cleanly.
         Standalone "Column A" / "List II" header lines carry no item content: they leave the bodies. */
      function dehead(s) { return trim(String(s).replace(/^[ \t]*(column|list)[ \t]+[a-z0-9ivx]+[ \t]*$/gim, "")); }
      function recut(run, other) {
        var marks = run.items.concat(other.items).sort(function (p, q) { return p.at - q.at; });
        return run.items.map(function (it) {
          var nx = null, n;
          for (n = 0; n < marks.length; n++) if (marks[n].at > it.at && (!nx || marks[n].at < nx.at)) nx = marks[n];
          var body = dehead(t.slice(it.end, nx ? nx.at : t.length));
          return body ? { label: it.label, disp: it.disp, text: body } : null;
        }).filter(Boolean);
      }
      var c1 = recut(first, second), c2 = recut(second, first);
      if (c1.length >= 2 && c2.length >= 2) {
        var heads = saysMatch && /column/i.test(t) ? ["Column I", "Column II"] : ["A", "B"];
        var lead = dehead(t.slice(0, Math.min(a.items[0].at, b.items[0].at)));
        return { lead: lead, items: null, ol: null,
          match: { cols: [{ head: heads[0], items: c1 }, { head: heads[1], items: c2 }] } };
      }
    }
    var win = a.items[0].at <= b.items[0].at ? a : b;
    return { lead: win.lead, items: win.items, ol: win.ol, match: null };
  }

  function listHtml(items) {
    return '<ol class="pn-lf">' + items.map(function (it) {
      return '<li><span class="pn-lf-m" aria-hidden="true">' + escH(it.disp) + '</span><span>' + escH(it.text) + "</span></li>";
    }).join("") + "</ol>";
  }
  function matchHtml(m) {
    var n = Math.max(m.cols[0].items.length, m.cols[1].items.length), rows = "", i;
    for (i = 0; i < n; i++) {
      var c = m.cols[0].items[i], d = m.cols[1].items[i];
      rows += "<tr>" + (c ? '<td><span class="pn-lf-m" aria-hidden="true">' + escH(c.disp) + "</span> " + escH(c.text) + "</td>" : "<td></td>") +
        (d ? '<td><span class="pn-lf-m" aria-hidden="true">' + escH(d.disp) + "</span> " + escH(d.text) + "</td>" : "<td></td>") + "</tr>";
    }
    return '<div class="pn-xt" role="region" tabindex="0" aria-label="Matched columns table"><table class="pn-lf-t"><thead><tr><th scope="col">' +
      escH(m.cols[0].head) + '</th><th scope="col">' + escH(m.cols[1].head) + "</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
  }

  /* stem(text): neat lead + list/table, or the escaped original when unsure. */
  function stem(text) {
    var p = parse(text);
    if (!p) return escH(text);
    var lead = p.lead ? '<p class="pn-lf-lead">' + escH(p.lead) + "</p>" : "";
    return lead + (p.match ? matchHtml(p.match) : listHtml(p.items));
  }

  var SEQ_SEP = /[,;>\-–]/;
  function seqTokens(o) {
    var s = String(o), parts;
    if (/[,;>]/.test(s)) parts = s.split(/[,;>]/);
    /* A bare dash chain ("b-d-a-c") only counts with 3+ tokens, so dose ranges ("10-20") stay untouched. */
    else if (/[-–]/.test(s)) { parts = s.split(/[-–]/); if (parts.length < 3) return null; }
    else return null;
    var toks = parts.map(function (x) { return trim(x).replace(/^\(+|\)+$/g, ""); }).filter(Boolean);
    if (toks.length < 2) return null;
    for (var i = 0; i < toks.length; i++) if (!/^[A-Za-z0-9]{1,4}$/.test(toks[i])) return null;
    return toks;
  }
  /* opt(text): sequence options ("a,d,b,c,f,e", "D>B>C>A", "(i), (ii), (iii), (iv)") become spaced chips
     with an accessible order; pair options ("a-2, b-1", "1-E, 2-C") align each pair. Else escaped text. */
  function opt(text) {
    var s = String(text == null ? "" : text);
    var pairs = trim(s).split(/\s*[,;]\s*/);
    var isPair = pairs.length >= 2;
    var i, pm;
    for (i = 0; i < pairs.length; i++) if (!/^[A-Za-z0-9]{1,3}\s*[–-]\s*[A-Za-z0-9]{1,3}$/.test(pairs[i])) { isPair = false; break; }
    if (isPair) {
      var bits = pairs.map(function (p) {
        pm = /^\s*([A-Za-z0-9]{1,3})\s*[–-]\s*([A-Za-z0-9]{1,3})\s*$/.exec(p);
        return { a: pm[1], b: pm[2] };
      });
      var aria = bits.map(function (x) { return x.a + " pairs with " + x.b; }).join(", ");
      return '<span class="pn-pairs" aria-label="' + escH(aria) + '">' + bits.map(function (x, k) {
        return (k ? '<span class="pn-pair-s" aria-hidden="true">, </span>' : "") + '<span class="pn-pair">' + escH(x.a) + '<span class="pn-pair-s" aria-hidden="true"> – </span>' + escH(x.b) + "</span>";
      }).join("") + "</span>";
    }
    var toks = SEQ_SEP.test(s) ? seqTokens(s) : null;
    if (toks) {
      var order = toks.join(", ");
      return '<span class="pn-seq" aria-label="Order: ' + escH(order) + '">' + toks.map(function (x, k) {
        return (k ? '<span class="pn-seq-s" aria-hidden="true"> › </span>' : "") + '<span class="pn-seq-t">' + escH(x) + "</span>";
      }).join("") + "</span>";
    }
    return escH(s);
  }

  /* exp(text): pasted-table explanations become label/value rows when safe; enumerated runs become lists. */
  function exp(text) {
    var t = String(text == null ? "" : text);
    var p = parse(t);
    if (p) {
      var lead = p.lead ? '<p class="pn-lf-lead">' + escH(p.lead) + "</p>" : "";
      return lead + (p.match ? matchHtml(p.match) : listHtml(p.items));
    }
    var re = /(\d+(?:\s*[–-]\s*\d+)?\s*%)/g, m, vals = [];
    while ((m = re.exec(t))) vals.push({ at: m.index, end: m.index + m[0].length, v: m[1] });
    if (vals.length >= 3) {
      var rows = [], ok = true, k;
      for (k = 0; k < vals.length; k++) {
        var lab = trim(t.slice(k ? vals[k - 1].end : 0, vals[k].at)).replace(/^[\s,;:\-]+/, "");
        if (!lab || lab.length > 160) { ok = false; break; }
        rows.push({ label: lab, value: vals[k].v });
      }
      var tail = trim(t.slice(vals[vals.length - 1].end));
      if (tail && tail.length > 60) ok = false;
      /* The rows must cover most of the text: stray percents in prose stay untouched. */
      var covered = 0, c;
      for (c = 0; c < rows.length; c++) covered += rows[c].label.length + rows[c].value.length;
      if (covered < t.length * 0.5) ok = false;
      if (ok) {
        /* A header glued to the first label ("Breast cancer Incidence Sporadic breast cancer") splits off as lead,
           aligned to the sibling rows' width ("Familial breast cancer"). */
        var lead = "";
        if (rows.length > 1) {
          var w1 = rows[1].label.split(/\s+/).length, w0 = rows[0].label.split(/\s+/);
          if (w0.length > w1 + 2 && w1 >= 1) {
            var keep = Math.max(2, w1);
            lead = trim(w0.slice(0, w0.length - keep).join(" "));
            rows[0].label = trim(w0.slice(w0.length - keep).join(" "));
          }
        }
        return (lead ? '<p class="pn-lf-lead">' + escH(lead) + "</p>" : "") +
          '<div class="pn-xt" role="region" tabindex="0" aria-label="Values table"><table class="pn-lf-t pn-lf-v"><tbody>' +
          rows.map(function (r) { return '<tr><th scope="row">' + escH(r.label) + "</th><td>" + escH(r.value) + "</td></tr>"; }).join("") +
          "</tbody></table></div>" + (tail ? '<p class="pn-lf-tail">' + escH(tail) + "</p>" : "");
      }
    }
    return null;
  }

  var PURE = { parse: parse, stem: stem, opt: opt, exp: exp, esc: escH };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }
  G.PREP_LISTFMT = PURE;
})(typeof window !== "undefined" ? window : this);
