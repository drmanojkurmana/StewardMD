/* StewardMD - on-device master chart statistics (window.SMD_RESEARCH_STATS).
 * Pure: no DOM, no Date, no Math.random, no I/O. ES5 only (var/function).
 * Dual export: browser global SMD_RESEARCH_STATS and CommonJS module.exports.
 * No network and no model calls. Bad input throws "research: ...".
 *
 * Numeric helpers (normal quantile, gamma, beta, t quantile) follow the same
 * approximations as research-engine.js. Shapiro-Wilk is Royston AS R94.
 * Two-sample and signed-rank exact p-values follow the R 4.6 permutation
 * distribution on average ranks. Asymptotic rank tests use the normal
 * approximation with the continuity correction. 2 by 2 chi-square uses Yates.
 * Odds ratios use the Woolf logit interval (0.5 on every cell only when a
 * cell is 0). Risk ratios use the Katz log interval. Logistic regression is
 * IRLS binomial logit with Wald intervals.
 */
(function (G) {
  "use strict";

  var BIG = 10000000;
  var Z975_P = 0.975;
  var PM = " \u00b1 ";

  function bad(msg) { throw new Error("research: " + msg); }

  function isFin(n) { return typeof n === "number" && isFinite(n); }

  function isArray(x) {
    return Object.prototype.toString.call(x) === "[object Array]";
  }

  function trim(s) {
    return String(s).replace(/^\s+|\s+$/g, "");
  }

  /* Horner evaluation of c[0]*x^n + ... + c[n]. */
  function polyHorner(c, x) {
    var s = c[0], i;
    for (i = 1; i < c.length; i++) s = s * x + c[i];
    return s;
  }

  /* Low-to-high polynomial: cc[0] + cc[1]*x + ... (AS 181.2). */
  function polyLow(cc, x) {
    var nord = cc.length, ret = cc[0], p, j;
    if (nord > 1) {
      p = x * cc[nord - 1];
      for (j = nord - 2; j > 0; j--) p = (p + cc[j]) * x;
      ret = ret + p;
    }
    return ret;
  }

  /* Inverse standard-normal CDF (Acklam; absolute error under 1.2e-9). */
  function normalQuantile(p) {
    var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
      138.3577518672690, -30.66479806614716, 2.506628277459239];
    var b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
      66.80131188771972, -13.28068155288572];
    var c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
      -2.549732539343734, 4.374664141464968, 2.938163982698783];
    var d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996,
      3.754408661907416];
    var b1 = [b[0], b[1], b[2], b[3], b[4], 1];
    var d1 = [d[0], d[1], d[2], d[3], 1];
    var plow = 0.02425, phigh = 1 - 0.02425, q, r;
    if (!(p > 0 && p < 1)) bad("probability must be between 0 and 1");
    if (p < plow) {
      q = Math.sqrt(-2 * Math.log(p));
      return polyHorner(c, q) / polyHorner(d1, q);
    }
    if (p > phigh) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -polyHorner(c, q) / polyHorner(d1, q);
    }
    q = p - 0.5; r = q * q;
    return polyHorner(a, r) * q / polyHorner(b1, r);
  }

  function gammln(x) {
    var cof = [76.18009172947146, -86.50532032961677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, tmp = x + 5.5, ser = 1.000000000190015, j;
    tmp -= (x + 0.5) * Math.log(tmp);
    for (j = 0; j < 6; j++) { y += 1; ser += cof[j] / y; }
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  function gammaP(a, x) {
    var ITMAX = 300, EPS = 3e-12, ap, del, sum, n;
    if (!(a > 0)) bad("gamma shape must be positive");
    if (x <= 0) return 0;
    if (x >= a + 1) return 1 - gammaQ(a, x);
    ap = a; del = 1 / a; sum = del;
    for (n = 1; n <= ITMAX; n++) {
      ap += 1; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * EPS) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gammln(a));
  }

  function gammaQ(a, x) {
    var ITMAX = 300, EPS = 3e-12, FPMIN = 1e-300;
    var gln, b, c, d, h, i, an, del;
    if (!(a > 0)) bad("gamma shape must be positive");
    if (x <= 0) return 1;
    if (x < a + 1) return 1 - gammaP(a, x);
    gln = gammln(a); b = x + 1 - a; c = 1 / FPMIN; d = 1 / b; h = d;
    for (i = 1; i <= ITMAX; i++) {
      an = -i * (i - a); b += 2; d = an * d + b;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return Math.exp(-x + a * Math.log(x) - gln) * h;
  }

  function chiSqUpper(q, df) {
    if (!(q >= 0) || !(df >= 1)) bad("bad chi-square inputs");
    if (q === 0) return 1;
    return gammaQ(df / 2, q / 2);
  }

  function betacf(a, b, x) {
    var MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
    var qab = a + b, qap = a + 1, qam = a - 1, c = 1, d, h, m, m2, aa, del;
    d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d; h = d;
    for (m = 1; m <= MAXIT; m++) {
      m2 = 2 * m;
      aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  function betai(a, b, x) {
    var bt;
    if (!(a > 0) || !(b > 0)) bad("bad beta parameters");
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    bt = Math.exp(gammln(a + b) - gammln(a) - gammln(b) +
      a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }

  function invBetai(a, b, p) {
    var lo = 0, hi = 1, mid, i;
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    for (i = 0; i < 200; i++) {
      mid = (lo + hi) / 2;
      if (betai(a, b, mid) < p) lo = mid; else hi = mid;
      if (hi - lo < 1e-14) break;
    }
    return (lo + hi) / 2;
  }

  function tQuantile(p, df) {
    var x;
    if (!(p > 0 && p < 1)) bad("probability must be between 0 and 1");
    if (!isFin(df) || !(df >= 1)) bad("df must be >= 1");
    if (p === 0.5) return 0;
    if (df === 1) return Math.tan(Math.PI * (p - 0.5));
    if (df > 10000) return normalQuantile(p);
    if (p > 0.5) {
      x = invBetai(df / 2, 0.5, 2 * (1 - p));
      return Math.sqrt(df * (1 - x) / x);
    }
    x = invBetai(df / 2, 0.5, 2 * p);
    return -Math.sqrt(df * (1 - x) / x);
  }

  function tTail(t, df) {
    if (t < 0) t = -t;
    if (t === 0) return 1;
    return betai(df / 2, 0.5, df / (df + t * t));
  }

  function fTail(F, df1, df2) {
    if (!(F > 0)) return 1;
    return betai(df2 / 2, df1 / 2, df2 / (df2 + df1 * F));
  }

  function normalUpper(z) {
    var q;
    if (z === 0) return 0.5;
    q = 0.5 * gammaQ(0.5, (z * z) / 2);
    if (z > 0) return q;
    return 1 - q;
  }

  function atanh(r) {
    if (r >= 1) return Infinity;
    if (r <= -1) return -Infinity;
    return 0.5 * Math.log((1 + r) / (1 - r));
  }

  function tanh(z) {
    var e;
    if (z > 20) return 1;
    if (z < -20) return -1;
    e = Math.exp(2 * z);
    return (e - 1) / (e + 1);
  }

  function fisherZInterval(r, n) {
    var z, se, crit, lo, hi;
    if (!(n > 3) || !isFin(r) || r <= -1 || r >= 1) {
      return { ciLower: null, ciUpper: null };
    }
    z = atanh(r);
    se = 1 / Math.sqrt(n - 3);
    crit = normalQuantile(Z975_P);
    lo = tanh(z - crit * se);
    hi = tanh(z + crit * se);
    return { ciLower: lo, ciUpper: hi };
  }

  /* ---- big integers, base 1e7, for exact rank sums past 2^53 ---- */

  function biAddInto(dst, src) {
    var carry = 0, i = 0, s, sb;
    if (dst === src) src = dst.slice();
    while (i < src.length || carry) {
      sb = i < src.length ? src[i] : 0;
      s = (i < dst.length ? dst[i] : 0) + sb + carry;
      if (s >= BIG) { carry = 1; s -= BIG; }
      else carry = 0;
      dst[i] = s;
      i++;
    }
  }

  function biTop(a) {
    var i = a.length - 1;
    while (i > 0 && a[i] === 0) i--;
    if (i === 0) return { v: a[0], e: 0 };
    return { v: a[i] * BIG + a[i - 1], e: i - 1 };
  }

  function biRatio(num, den) {
    var A = biTop(num), B = biTop(den);
    if (!(B.v > 0)) return 0;
    return (A.v / B.v) * Math.pow(BIG, A.e - B.e);
  }

  function biSumWhere(row, pred) {
    var acc = [0], s;
    for (s = 0; s < row.length; s++) {
      if (row[s] && pred(s)) biAddInto(acc, row[s]);
    }
    return acc;
  }

  /* Distribution of the sum of a size-nx subset of integer scores. */
  function subsetSumRow(scores, nx) {
    var dp = [], k, item, r, src, s, dest, N;
    N = scores.length;
    dp[0] = [];
    dp[0][0] = [1];
    for (k = 1; k <= nx; k++) dp[k] = [];
    for (item = 0; item < N; item++) {
      r = scores[item];
      for (k = nx; k >= 1; k--) {
        src = dp[k - 1];
        for (s = 0; s < src.length; s++) {
          if (!src[s]) continue;
          dest = s + r;
          if (!dp[k][dest]) dp[k][dest] = [0];
          biAddInto(dp[k][dest], src[s]);
        }
      }
    }
    return dp[nx];
  }

  function twoSidedSubsetP(row, observed) {
    var lower = biSumWhere(row, function (s) { return s <= observed; });
    var upper = biSumWhere(row, function (s) { return s >= observed; });
    var total = biSumWhere(row, function () { return true; });
    var pLo = 2 * biRatio(lower, total);
    var pHi = 2 * biRatio(upper, total);
    var p = pLo < pHi ? pLo : pHi;
    if (p > 1) p = 1;
    if (p < 0) p = 0;
    return p;
  }

  /* Signed-rank subset sums: each score is in or out. Counts fit in a double for n < 50. */
  function signSubsetP(scores, observedScaled, observedRaw, meanRaw) {
    var cur = [1], i, r, s, dest, total = 0, lower = 0, upper = 0, p;
    for (i = 0; i < scores.length; i++) {
      r = scores[i];
      for (s = cur.length - 1; s >= 0; s--) {
        if (!cur[s]) continue;
        dest = s + r;
        while (cur.length <= dest) cur.push(0);
        cur[dest] += cur[s];
      }
    }
    for (s = 0; s < cur.length; s++) {
      if (!cur[s]) continue;
      total += cur[s];
      if (s <= observedScaled) lower += cur[s];
      if (s >= observedScaled) upper += cur[s];
    }
    if (!(total > 0)) return 1;
    if (observedRaw > meanRaw) p = 2 * upper / total;
    else p = 2 * lower / total;
    if (p > 1) p = 1;
    return p;
  }

  /* ---- parsing and column typing ---- */

  function isMissingToken(v) {
    var s, u;
    if (v === null || v === undefined) return true;
    s = trim(v);
    if (s === "") return true;
    u = s.toLowerCase();
    return u === "na" || u === "n/a" || u === "-" || u === "." || u === "nil";
  }

  function parseNumber(v) {
    var s;
    if (isMissingToken(v)) return null;
    s = trim(v);
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    if (!/^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
    var n = Number(s);
    if (!isFinite(n)) return null;
    return n;
  }

  function sortLevels(levels) {
    var a = levels.slice();
    a.sort(function (x, y) {
      var nx = parseNumber(x), ny = parseNumber(y);
      var sx, sy;
      if (nx !== null && ny !== null && String(x).indexOf(",") < 0 && String(y).indexOf(",") < 0) {
        if (nx < ny) return -1;
        if (nx > ny) return 1;
      }
      sx = String(x).toLowerCase();
      sy = String(y).toLowerCase();
      if (sx < sy) return -1;
      if (sx > sy) return 1;
      if (String(x) < String(y)) return -1;
      if (String(x) > String(y)) return 1;
      return 0;
    });
    return a;
  }

  function nameTokens(name) {
    var s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, " ");
    s = trim(s);
    if (!s) return [];
    return s.split(/\s+/);
  }

  function hasPhrase(tokens, phrase) {
    var i, j, ok;
    for (i = 0; i + phrase.length <= tokens.length; i++) {
      ok = true;
      for (j = 0; j < phrase.length; j++) {
        if (tokens[i + j] !== phrase[j]) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  function phiHeader(tokens) {
    var phrases = [
      ["patient", "name"],
      ["date", "of", "birth"],
      ["hospital", "no"],
      ["hospital", "number"],
      ["ip", "no"],
      ["op", "no"],
      ["aadhaar"],
      ["adhaar"],
      ["abha"],
      ["uhid"],
      ["mrn"],
      ["phone"],
      ["mobile"],
      ["contact"],
      ["address"],
      ["email"],
      ["e", "mail"],
      ["dob"],
      ["name"]
    ];
    var i;
    for (i = 0; i < phrases.length; i++) {
      if (hasPhrase(tokens, phrases[i])) return phrases[i].join(" ");
    }
    return "";
  }

  function idHeader(tokens) {
    var i;
    if (hasPhrase(tokens, ["s", "no"])) return true;
    if (hasPhrase(tokens, ["ip", "no"])) return true;
    if (hasPhrase(tokens, ["serial"])) return true;
    for (i = 0; i < tokens.length; i++) {
      if (tokens[i] === "id" || tokens[i] === "uhid" || tokens[i] === "sl" ||
          tokens[i] === "serial" || tokens[i] === "reg" || tokens[i] === "sno") return true;
    }
    return false;
  }

  function looksDate(s) {
    var t = trim(s);
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return true;
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(t)) return true;
    if (/^\d{1,2}[ \-](jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[ \-,]\s*\d{4}$/i.test(t)) return true;
    return false;
  }

  function looksEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trim(s));
  }

  function looksMobile(s) {
    var t = trim(s).replace(/[\s\-()]/g, "");
    if (t.indexOf("+91") === 0) t = t.substring(3);
    else if (t.indexOf("0091") === 0) t = t.substring(4);
    else if (t.length === 12 && t.indexOf("91") === 0) t = t.substring(2);
    else if (t.length === 11 && t.charAt(0) === "0") t = t.substring(1);
    return /^[6-9]\d{9}$/.test(t);
  }

  function looksAadhaar(s) {
    var t = trim(s).replace(/[\s\-]/g, "");
    return /^\d{12}$/.test(t);
  }

  function knownBinaryPair(levels) {
    var a = String(levels[0]).toLowerCase();
    var b = String(levels[1]).toLowerCase();
    var key = a + "|" + b;
    var pairs = {
      "yes|no": 1, "no|yes": 1,
      "y|n": 1, "n|y": 1,
      "1|0": 1, "0|1": 1,
      "m|f": 1, "f|m": 1,
      "male|female": 1, "female|male": 1,
      "present|absent": 1, "absent|present": 1,
      "true|false": 1, "false|true": 1,
      "positive|negative": 1, "negative|positive": 1
    };
    return !!pairs[key];
  }

  function detectDelim(text) {
    var i = 0, n = text.length, inQ = false, c;
    var commas = 0, semis = 0, tabs = 0, best = ",", bestN;
    while (i < n) {
      c = text.charAt(i);
      if (inQ) {
        if (c === '"') {
          if (i + 1 < n && text.charAt(i + 1) === '"') { i += 2; continue; }
          inQ = false;
        }
        i++;
        continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === "\n" || c === "\r") break;
      if (c === ",") commas++;
      else if (c === ";") semis++;
      else if (c === "\t") tabs++;
      i++;
    }
    bestN = commas;
    if (semis > bestN) { best = ";"; bestN = semis; }
    if (tabs > bestN) best = "\t";
    return best;
  }

  function rowBlank(row) {
    var i;
    for (i = 0; i < row.length; i++) if (row[i] !== "") return false;
    return true;
  }

  function parseCsv(text) {
    var delim, i, n, c, inQ, field, row, records, columns, rows, r, rec;
    if (typeof text !== "string") bad("csv text must be a string");
    if (text.charCodeAt(0) === 0xFEFF) text = text.substring(1);
    if (text === "") bad("csv is empty");
    delim = detectDelim(text);
    i = 0;
    n = text.length;
    inQ = false;
    field = "";
    row = [];
    records = [];
    while (i < n) {
      c = text.charAt(i);
      if (inQ) {
        if (c === '"') {
          if (i + 1 < n && text.charAt(i + 1) === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQ = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === delim) {
        row.push(field);
        field = "";
        i++;
        continue;
      }
      if (c === "\n" || c === "\r") {
        if (c === "\r" && i + 1 < n && text.charAt(i + 1) === "\n") i++;
        row.push(field);
        field = "";
        records.push(row);
        row = [];
        i++;
        continue;
      }
      field += c;
      i++;
    }
    if (inQ) bad("csv has an unterminated quote");
    if (field.length || row.length) {
      row.push(field);
      records.push(row);
    }
    while (records.length && rowBlank(records[records.length - 1])) records.pop();
    if (!records.length) bad("csv is empty");
    columns = records[0];
    if (!columns.length) bad("csv header is empty");
    rows = [];
    for (r = 1; r < records.length; r++) {
      rec = records[r];
      if (rec.length > columns.length) bad("row has more columns than the header");
      while (rec.length < columns.length) rec.push("");
      rows.push(rec);
    }
    return { columns: columns, rows: rows };
  }

  function inferColumn(name, values) {
    var tokens, headerPhi, present, levels, seen, i, v, label, numOk, dateOk;
    var emailN, phoneN, aadhaarN, uniq, type, phi, reason, numericFrac;
    if (!isArray(values)) bad("inferColumn needs a values array");
    tokens = nameTokens(name);
    headerPhi = phiHeader(tokens);
    present = [];
    for (i = 0; i < values.length; i++) {
      if (!isMissingToken(values[i])) present.push(trim(values[i]));
    }
    seen = {};
    levels = [];
    numOk = 0;
    dateOk = 0;
    emailN = 0;
    phoneN = 0;
    aadhaarN = 0;
    for (i = 0; i < present.length; i++) {
      v = present[i];
      if (!seen[v]) { seen[v] = 1; levels.push(v); }
      else seen[v]++;
      if (parseNumber(v) !== null) numOk++;
      if (looksDate(v)) dateOk++;
      if (looksEmail(v)) emailN++;
      if (looksMobile(v)) phoneN++;
      if (looksAadhaar(v)) aadhaarN++;
    }
    uniq = levels.length;
    numericFrac = present.length ? numOk / present.length : 0;
    type = "text";
    if (present.length && idHeader(tokens) && uniq === present.length) type = "id";
    else if (present.length && dateOk / present.length >= 0.8) type = "date";
    else if (uniq === 2 && (knownBinaryPair(levels) || numericFrac < 0.9)) type = "binary";
    else if (present.length && numericFrac >= 0.9) type = "numeric";
    else if (uniq > 0 && uniq <= 20) type = "categorical";
    else type = "text";
    if (type === "binary" || type === "categorical") levels = sortLevels(levels);
    else levels = [];
    if (levels.length > 20) levels = levels.slice(0, 20);
    phi = false;
    reason = "";
    if (headerPhi) {
      phi = true;
      reason = "header matches " + headerPhi;
    } else if (present.length) {
      if (phoneN / present.length >= 0.5) {
        phi = true;
        reason = "values look like phone numbers";
      } else if (aadhaarN / present.length >= 0.5) {
        phi = true;
        reason = "values look like Aadhaar numbers";
      } else if (emailN / present.length >= 0.5) {
        phi = true;
        reason = "values look like email addresses";
      }
    }
    return {
      type: type,
      levels: levels,
      missing: values.length - present.length,
      phi: phi,
      phiReason: reason
    };
  }

  /* ---- summaries ---- */

  function meanOf(xs) {
    var s = 0, i;
    for (i = 0; i < xs.length; i++) s += xs[i];
    return s / xs.length;
  }

  function sdOf(xs) {
    var m, i, d, v = 0;
    if (xs.length < 2) return null;
    m = meanOf(xs);
    for (i = 0; i < xs.length; i++) { d = xs[i] - m; v += d * d; }
    return Math.sqrt(v / (xs.length - 1));
  }

  function quantile7(sorted, p) {
    var n = sorted.length, h, lo, hi;
    if (!n) return null;
    if (n === 1) return sorted[0];
    h = (n - 1) * p;
    lo = Math.floor(h);
    hi = Math.ceil(h);
    return sorted[lo] * (1 - (h - lo)) + sorted[hi] * (h - lo);
  }

  function shapiroCoef(n) {
    var nn2 = Math.floor(n / 2);
    var a = [], i, an, an25, summ2, ssumm2, rsn, a1, a2, fac, i1;
    var c1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056];
    var c2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];
    for (i = 0; i <= nn2; i++) a.push(0);
    if (n === 3) {
      a[1] = 0.70710678;
      return a;
    }
    an = n;
    an25 = an + 0.25;
    summ2 = 0;
    for (i = 1; i <= nn2; i++) {
      a[i] = normalQuantile((i - 0.375) / an25);
      summ2 += a[i] * a[i];
    }
    summ2 *= 2;
    ssumm2 = Math.sqrt(summ2);
    rsn = 1 / Math.sqrt(an);
    a1 = polyLow(c1, rsn) - a[1] / ssumm2;
    if (n > 5) {
      i1 = 3;
      a2 = -a[2] / ssumm2 + polyLow(c2, rsn);
      fac = Math.sqrt((summ2 - 2 * a[1] * a[1] - 2 * a[2] * a[2]) /
        (1 - 2 * a1 * a1 - 2 * a2 * a2));
      a[2] = a2;
    } else {
      i1 = 2;
      fac = Math.sqrt((summ2 - 2 * a[1] * a[1]) / (1 - 2 * a1 * a1));
    }
    a[1] = a1;
    for (i = i1; i <= nn2; i++) a[i] = a[i] / -fac;
    return a;
  }

  function shapiroP(W, n) {
    var w1, y, gamma, m, s, xx, z;
    var g = [-2.273, 0.459];
    var c3 = [0.544, -0.39978, 0.025054, -6.714e-4];
    var c4 = [1.3822, -0.77857, 0.062767, -0.0020322];
    var c5 = [-1.5861, -0.31082, -0.083751, 0.0038915];
    var c6 = [-0.4803, -0.082676, 0.0030302];
    var pi6 = 1.90985931710274;
    var stqr = 1.04719755119660;
    if (n === 3) {
      y = pi6 * (Math.asin(Math.sqrt(W < 0 ? 0 : (W > 1 ? 1 : W))) - stqr);
      if (y < 0) y = 0;
      return y;
    }
    w1 = 1 - W;
    if (!(w1 > 0)) return 1;
    y = Math.log(w1);
    if (n <= 11) {
      gamma = polyLow(g, n);
      if (y >= gamma) return 1e-99;
      y = -Math.log(gamma - y);
      m = polyLow(c3, n);
      s = Math.exp(polyLow(c4, n));
    } else {
      xx = Math.log(n);
      m = polyLow(c5, xx);
      s = Math.exp(polyLow(c6, xx));
    }
    if (!(s > 0)) return null;
    z = (y - m) / s;
    return normalUpper(z);
  }

  function shapiroWilk(xs) {
    var n = xs.length, sorted, range, a, nn2, wts, i, sx, sa, ssa, ssx, sax, asa, xsx, W, p;
    if (n < 3 || n > 5000) return null;
    sorted = xs.slice().sort(function (a0, b0) { return a0 - b0; });
    range = sorted[n - 1] - sorted[0];
    if (!(range > 1e-19)) return null;
    a = shapiroCoef(n);
    nn2 = Math.floor(n / 2);
    wts = [];
    for (i = 0; i < n; i++) wts.push(0);
    for (i = 1; i <= nn2; i++) {
      wts[i - 1] = -a[i];
      wts[n - i] = a[i];
    }
    sx = 0;
    sa = 0;
    for (i = 0; i < n; i++) {
      sx += sorted[i] / range;
      sa += wts[i];
    }
    sx /= n;
    sa /= n;
    ssa = 0;
    ssx = 0;
    sax = 0;
    for (i = 0; i < n; i++) {
      asa = wts[i] - sa;
      xsx = sorted[i] / range - sx;
      ssa += asa * asa;
      ssx += xsx * xsx;
      sax += asa * xsx;
    }
    if (!(ssa > 0) || !(ssx > 0)) return null;
    W = (sax * sax) / (ssa * ssx);
    if (W > 1) W = 1;
    if (W < 0) W = 0;
    p = shapiroP(W, n);
    if (p === null || !isFin(p)) return null;
    if (p < 0) p = 0;
    if (p > 1) p = 1;
    return { test: "Shapiro-Wilk", W: W, p: p, normal: p >= 0.05 };
  }

  function numericValues(values) {
    var xs = [], miss = 0, i, n;
    if (!isArray(values)) bad("describe needs a values array");
    for (i = 0; i < values.length; i++) {
      if (isMissingToken(values[i])) { miss++; continue; }
      n = parseNumber(values[i]);
      if (n === null) miss++;
      else xs.push(n);
    }
    return { xs: xs, missing: miss };
  }

  function describe(values, type) {
    var parsed, xs, sorted, sw, i, v, seen, order, counts, nLevel, out, info;
    if (!isArray(values)) bad("describe needs a values array");
    if (type !== "numeric" && type !== "binary" && type !== "categorical") {
      bad("describe type must be numeric, binary, or categorical");
    }
    if (type === "numeric") {
      parsed = numericValues(values);
      xs = parsed.xs;
      sorted = xs.slice().sort(function (a, b) { return a - b; });
      sw = xs.length >= 3 && xs.length <= 5000 ? shapiroWilk(xs) : null;
      return {
        n: xs.length,
        missing: parsed.missing,
        mean: xs.length ? meanOf(xs) : null,
        sd: sdOf(xs),
        median: xs.length ? quantile7(sorted, 0.5) : null,
        q1: xs.length ? quantile7(sorted, 0.25) : null,
        q3: xs.length ? quantile7(sorted, 0.75) : null,
        min: xs.length ? sorted[0] : null,
        max: xs.length ? sorted[sorted.length - 1] : null,
        normality: sw
      };
    }
    seen = {};
    order = [];
    nLevel = 0;
    out = 0;
    for (i = 0; i < values.length; i++) {
      if (isMissingToken(values[i])) { out++; continue; }
      v = trim(values[i]);
      if (!seen[v]) { seen[v] = 0; order.push(v); }
      seen[v]++;
      nLevel++;
    }
    order = sortLevels(order);
    counts = [];
    for (i = 0; i < order.length; i++) {
      counts.push({
        level: order[i],
        n: seen[order[i]],
        pct: nLevel ? (100 * seen[order[i]] / nLevel) : 0
      });
    }
    info = { n: nLevel, missing: out, counts: counts };
    return info;
  }

  /* ---- ranks and classical tests ---- */

  function averageRanks(values) {
    var n = values.length, idx = [], ranks = [], s, e, i, avg;
    for (i = 0; i < n; i++) { idx.push(i); ranks.push(0); }
    idx.sort(function (a, b) {
      if (values[a] < values[b]) return -1;
      if (values[a] > values[b]) return 1;
      return a - b;
    });
    s = 0;
    while (s < n) {
      e = s;
      while (e + 1 < n && values[idx[e + 1]] === values[idx[s]]) e++;
      avg = (s + 1 + e + 1) / 2;
      for (i = s; i <= e; i++) ranks[idx[i]] = avg;
      s = e + 1;
    }
    return ranks;
  }

  function tieCubeSum(ranks) {
    var copy = ranks.slice().sort(function (a, b) { return a - b; });
    var i = 0, j, t, sum = 0;
    while (i < copy.length) {
      j = i;
      while (j + 1 < copy.length && copy[j + 1] === copy[i]) j++;
      t = j - i + 1;
      sum += t * t * t - t;
      i = j + 1;
    }
    return sum;
  }

  function welchTest(a, b) {
    var n1 = a.length, n2 = b.length, m1, m2, s1, s2, v1, v2, se, t, df, crit, md;
    if (n1 < 2 || n2 < 2) bad("Welch t test needs at least 2 observations in each group");
    m1 = meanOf(a);
    m2 = meanOf(b);
    s1 = sdOf(a);
    s2 = sdOf(b);
    v1 = (s1 * s1) / n1;
    v2 = (s2 * s2) / n2;
    se = Math.sqrt(v1 + v2);
    md = m1 - m2;
    if (!(se > 0)) {
      return {
        statistic: md === 0 ? 0 : (md > 0 ? Infinity : -Infinity),
        df: null,
        p: md === 0 ? 1 : 0,
        estimate: md,
        ciLower: null,
        ciUpper: null,
        means: [m1, m2]
      };
    }
    t = md / se;
    df = (v1 + v2) * (v1 + v2) / ((v1 * v1) / (n1 - 1) + (v2 * v2) / (n2 - 1));
    crit = tQuantile(Z975_P, df);
    return {
      statistic: t,
      df: df,
      p: tTail(t, df),
      estimate: md,
      ciLower: md - crit * se,
      ciUpper: md + crit * se,
      means: [m1, m2]
    };
  }

  function pairedTTest(d) {
    var n = d.length, m, s, se, t, crit;
    if (n < 2) bad("paired t test needs at least 2 complete pairs");
    m = meanOf(d);
    s = sdOf(d);
    se = s / Math.sqrt(n);
    if (!(se > 0)) {
      return {
        statistic: m === 0 ? 0 : (m > 0 ? Infinity : -Infinity),
        df: n - 1,
        p: m === 0 ? 1 : 0,
        estimate: m,
        ciLower: null,
        ciUpper: null
      };
    }
    t = m / se;
    crit = tQuantile(Z975_P, n - 1);
    return {
      statistic: t,
      df: n - 1,
      p: tTail(t, n - 1),
      estimate: m,
      ciLower: m - crit * se,
      ciUpper: m + crit * se
    };
  }

  function anovaTest(groups) {
    var k = groups.length, i, j, N = 0, grand = 0, mean, ni, ssb = 0, ssw = 0, d, msb, msw, F, df1, df2;
    var means = [];
    if (k < 2) bad("ANOVA needs at least 2 groups");
    for (i = 0; i < k; i++) {
      if (groups[i].length < 1) bad("ANOVA group is empty");
      N += groups[i].length;
      means.push(meanOf(groups[i]));
      grand += meanOf(groups[i]) * groups[i].length;
    }
    if (N <= k) bad("ANOVA needs residual degrees of freedom");
    grand /= N;
    for (i = 0; i < k; i++) {
      ni = groups[i].length;
      ssb += ni * (means[i] - grand) * (means[i] - grand);
      for (j = 0; j < ni; j++) {
        d = groups[i][j] - means[i];
        ssw += d * d;
      }
    }
    df1 = k - 1;
    df2 = N - k;
    msb = ssb / df1;
    msw = ssw / df2;
    if (!(msw > 0)) {
      F = msb === 0 ? 0 : Infinity;
      return { statistic: F, df: [df1, df2], p: F === 0 ? 1 : 0 };
    }
    F = msb / msw;
    return { statistic: F, df: [df1, df2], p: fTail(F, df1, df2) };
  }

  function kruskalTest(groups) {
    var all = [], own = [], i, j, ranks, N, Ri, ni, H, corr, tie, df;
    for (i = 0; i < groups.length; i++) {
      own.push(all.length);
      for (j = 0; j < groups[i].length; j++) all.push(groups[i][j]);
    }
    N = all.length;
    if (N < 2) bad("Kruskal-Wallis needs observations");
    ranks = averageRanks(all);
    H = 0;
    for (i = 0; i < groups.length; i++) {
      ni = groups[i].length;
      Ri = 0;
      for (j = 0; j < ni; j++) Ri += ranks[own[i] + j];
      H += (Ri * Ri) / ni;
    }
    H = (12 / (N * (N + 1))) * H - 3 * (N + 1);
    tie = tieCubeSum(ranks);
    corr = 1 - tie / (N * N * N - N);
    if (corr > 0 && corr < 1) H = H / corr;
    df = groups.length - 1;
    if (H < 0) H = 0;
    return { statistic: H, df: df, p: chiSqUpper(H, df) };
  }

  function mannWhitney(x, y) {
    var both = [], i, ranks, nx, ny, N, rankSum, U, mean, sigma, tie, z, corr, scores, row, observed;
    nx = x.length;
    ny = y.length;
    if (!nx || !ny) bad("Mann-Whitney needs observations in each group");
    for (i = 0; i < nx; i++) both.push(x[i]);
    for (i = 0; i < ny; i++) both.push(y[i]);
    ranks = averageRanks(both);
    rankSum = 0;
    for (i = 0; i < nx; i++) rankSum += ranks[i];
    U = rankSum - nx * (nx + 1) / 2;
    if (nx < 50 && ny < 50) {
      scores = [];
      for (i = 0; i < ranks.length; i++) scores.push(Math.round(ranks[i] * 2));
      observed = 0;
      for (i = 0; i < nx; i++) observed += scores[i];
      row = subsetSumRow(scores, nx);
      return { statistic: U, df: null, p: twoSidedSubsetP(row, observed) };
    }
    N = nx + ny;
    mean = nx * ny / 2;
    tie = tieCubeSum(ranks);
    sigma = Math.sqrt((nx * ny / 12) * ((N + 1) - tie / (N * (N - 1))));
    if (!(sigma > 0)) return { statistic: U, df: null, p: U === mean ? 1 : 0 };
    z = U - mean;
    corr = z > 0 ? 0.5 : (z < 0 ? -0.5 : 0);
    z = (z - corr) / sigma;
    return { statistic: U, df: null, p: chiSqUpper(z * z, 1) };
  }

  function wilcoxonSigned(d) {
    var n = d.length, ranks, i, V, zRanks, scores, observed, mean, k, NTIES, vari, sigma, z, corr, absx;
    if (n < 1) bad("Wilcoxon signed-rank needs observations");
    absx = [];
    for (i = 0; i < n; i++) absx.push(d[i] < 0 ? -d[i] : d[i]);
    ranks = averageRanks(absx);
    V = 0;
    zRanks = [];
    k = 0;
    for (i = 0; i < n; i++) {
      if (d[i] > 0) V += ranks[i];
      if (d[i] !== 0) zRanks.push(ranks[i]);
      else k++;
    }
    if (n < 50) {
      if (!zRanks.length) return { statistic: 0, df: null, p: 1 };
      scores = [];
      observed = Math.round(V * 2);
      mean = 0;
      for (i = 0; i < zRanks.length; i++) {
        scores.push(Math.round(zRanks[i] * 2));
        mean += zRanks[i];
      }
      mean = mean / 2;
      return { statistic: V, df: null, p: signSubsetP(scores, observed, V, mean) };
    }
    mean = n * (n + 1) / 4;
    vari = n * (n + 1) * (2 * n + 1) / 24;
    NTIES = tieCubeSum(ranks);
    vari -= NTIES / 48;
    if (k) {
      mean -= k * (k + 1) / 4;
      vari -= k * (k + 1) * (k + 1) / 16;
    }
    sigma = Math.sqrt(vari);
    if (!(sigma > 0)) return { statistic: V, df: null, p: V === mean ? 1 : 0 };
    z = V - mean;
    corr = z > 0 ? 0.5 : (z < 0 ? -0.5 : 0);
    z = (z - corr) / sigma;
    return { statistic: V, df: null, p: chiSqUpper(z * z, 1) };
  }



  function pearsonR(x, y) {
    var n = x.length, i, mx = 0, my = 0, sxx = 0, syy = 0, sxy = 0, dx, dy;
    if (n < 3) bad("correlation needs at least 3 complete pairs");
    for (i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
    mx /= n;
    my /= n;
    for (i = 0; i < n; i++) {
      dx = x[i] - mx;
      dy = y[i] - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    if (!(sxx > 0) || !(syy > 0)) bad("correlation is undefined when a variable has no variation");
    return sxy / Math.sqrt(sxx * syy);
  }

  function corrTest(r, n) {
    var df = n - 2, t, p, ci;
    if (r >= 1 || r <= -1) {
      return { statistic: r, df: df, p: r === 1 || r === -1 ? 0 : 1, ciLower: null, ciUpper: null };
    }
    t = r * Math.sqrt(df / (1 - r * r));
    p = tTail(t, df);
    ci = fisherZInterval(r, n);
    return { statistic: r, df: df, p: p, ciLower: ci.ciLower, ciUpper: ci.ciUpper };
  }

  function logChoose(n, k) {
    if (k < 0 || k > n) return -Infinity;
    return gammln(n + 1) - gammln(k + 1) - gammln(n - k + 1);
  }

  function fisherExactP(table) {
    var a = table[0][0], b = table[0][1], c = table[1][0], d = table[1][1];
    var r1 = a + b, c1 = a + c, c2 = b + d, N = r1 + c + d;
    var lo = r1 - c2; if (lo < 0) lo = 0;
    var hi = r1 < c1 ? r1 : c1;
    var logs = [], k, lp, maxLp = -Infinity, pObs = null, i, sum = 0, tot = 0, e;
    for (k = lo; k <= hi; k++) {
      lp = logChoose(c1, k) + logChoose(c2, r1 - k) - logChoose(N, r1);
      logs.push(lp);
      if (k === a) pObs = lp;
      if (lp > maxLp) maxLp = lp;
    }
    if (pObs === null) bad("Fisher table is outside its margins");
    for (i = 0; i < logs.length; i++) {
      e = Math.exp(logs[i] - maxLp);
      tot += e;
      if (logs[i] <= pObs + Math.log(1 + 1e-7)) sum += e;
    }
    return tot > 0 ? sum / tot : 1;
  }

  function woolfAndKatz(a, b, c, d) {
    var z, se, ser, or, rr, use;
    use = (a === 0 || b === 0 || c === 0 || d === 0);
    if (use) { a += 0.5; b += 0.5; c += 0.5; d += 0.5; }
    if (!(a > 0 && b > 0 && c > 0 && d > 0)) bad("odds ratio is undefined");
    or = (a * d) / (b * c);
    se = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
    rr = (a / (a + b)) / (c / (c + d));
    ser = Math.sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d));
    z = normalQuantile(Z975_P);
    return {
      or: or,
      orLo: Math.exp(Math.log(or) - z * se),
      orHi: Math.exp(Math.log(or) + z * se),
      rr: rr,
      rrLo: rr > 0 ? Math.exp(Math.log(rr) - z * ser) : 0,
      rrHi: rr > 0 ? Math.exp(Math.log(rr) + z * ser) : null
    };
  }

  function chiSquare(counts) {
    var r = counts.length, c = counts[0].length, i, j, N = 0, rowS = [], colS = [], E, stat, yates, diff, df;
    for (i = 0; i < r; i++) {
      rowS.push(0);
      for (j = 0; j < c; j++) {
        if (!colS[j]) colS[j] = 0;
        rowS[i] += counts[i][j];
        colS[j] += counts[i][j];
        N += counts[i][j];
      }
    }
    if (!(N > 0)) bad("chi-square table is empty");
    E = [];
    yates = 0;
    if (r === 2 && c === 2) {
      diff = Math.abs(counts[0][0] - rowS[0] * colS[0] / N);
      yates = diff < 0.5 ? diff : 0.5;
    }
    stat = 0;
    for (i = 0; i < r; i++) {
      E[i] = [];
      for (j = 0; j < c; j++) {
        E[i][j] = rowS[i] * colS[j] / N;
        if (!(E[i][j] > 0)) bad("chi-square expected count is zero");
        diff = Math.abs(counts[i][j] - E[i][j]) - yates;
        if (diff < 0) diff = 0;
        stat += (diff * diff) / E[i][j];
      }
    }
    df = (r - 1) * (c - 1);
    return { statistic: stat, df: df, p: chiSqUpper(stat, df), expected: E };
  }

  function mcnemarTest(b, c) {
    var stat, or, se, z, lo, hi;
    if (b + c === 0) {
      return { statistic: 0, df: 1, p: 1, estimate: null, ciLower: null, ciUpper: null };
    }
    stat = (Math.abs(b - c) - 1);
    stat = (stat * stat) / (b + c);
    if (b === 0 || c === 0) { b += 0.5; c += 0.5; }
    or = b / c;
    se = Math.sqrt(1 / b + 1 / c);
    z = normalQuantile(Z975_P);
    lo = Math.exp(Math.log(or) - z * se);
    hi = Math.exp(Math.log(or) + z * se);
    return { statistic: stat, df: 1, p: chiSqUpper(stat, 1), estimate: or, ciLower: lo, ciUpper: hi };
  }

  /* ---- test choice ---- */

  var TEST_TEXT = {
    welch_t: ["Welch t test", "(both groups were normally distributed, so we compared means)"],
    mann_whitney: ["Mann-Whitney U test", "(the outcome was not normally distributed in both groups, so we compared medians)"],
    anova: ["One-way ANOVA", "(the groups were normally distributed, so we compared means)"],
    kruskal: ["Kruskal-Wallis test", "(the groups were not all normally distributed, so we compared ranks)"],
    chi_square: ["Chi-square test", "(the outcome was categorical and the expected counts were large enough for a chi-square test)"],
    fisher: ["Fisher exact test", "(an expected count was under 5, so we used an exact test)"],
    paired_t: ["Paired t test", "(the paired differences were normally distributed, so we compared the mean difference)"],
    wilcoxon: ["Wilcoxon signed-rank test", "(the paired differences were not normally distributed, so we compared the ranks of the differences)"],
    mcnemar: ["McNemar test", "(the outcome was paired and binary, so we compared discordant pairs)"],
    pearson: ["Pearson correlation", "(both variables were normally distributed, so we used a linear correlation)"],
    spearman: ["Spearman rank correlation", "(a variable was not normally distributed, so we used a rank correlation)"],
    km_logrank: ["Kaplan-Meier with log-rank test (compares time to the event between groups)", "(the outcome was the time until an event, with some patients not yet having it, so we compared survival curves)"]
  };

  function allNormal(normal) {
    var i;
    if (normal === true) return true;
    if (isArray(normal)) {
      if (!normal.length) return false;
      for (i = 0; i < normal.length; i++) if (!normal[i]) return false;
      return true;
    }
    return false;
  }

  function chooseTest(opts) {
    var outcomeType, groups, paired, normal, smallExpected, key;
    if (!opts || typeof opts !== "object") bad("chooseTest needs an options object");
    outcomeType = opts.outcomeType;
    if (outcomeType === "survival") return { test: "km_logrank", label: TEST_TEXT.km_logrank[0], why: TEST_TEXT.km_logrank[1] };
    if (outcomeType !== "numeric" && outcomeType !== "binary" && outcomeType !== "categorical") {
      bad("chooseTest needs an outcome type of numeric, binary, categorical, or survival");
    }
    groups = opts.groups;
    if (groups === null || groups === undefined || groups === "") groups = 0;
    if (isArray(groups)) groups = groups.length;
    if (typeof groups !== "number" || !isFinite(groups)) bad("groups must be a count");
    paired = !!opts.paired;
    normal = allNormal(opts.normal);
    smallExpected = !!opts.smallExpected;
    if (paired && outcomeType === "numeric") key = normal ? "paired_t" : "wilcoxon";
    else if (paired && (outcomeType === "binary" || outcomeType === "categorical")) key = "mcnemar";
    else if (outcomeType === "numeric" && groups === 0) key = normal ? "pearson" : "spearman";
    else if (outcomeType === "numeric" && groups === 2) key = normal ? "welch_t" : "mann_whitney";
    else if (outcomeType === "numeric" && groups > 2) key = normal ? "anova" : "kruskal";
    else if (outcomeType === "binary" || outcomeType === "categorical") key = smallExpected ? "fisher" : "chi_square";
    else bad("chooseTest cannot pick a test for these inputs");
    return { test: key, label: TEST_TEXT[key][0], why: TEST_TEXT[key][1] };
  }

  function isPositiveLevel(level) {
    var u = String(level).toLowerCase();
    var pos = {
      "1": 1, "yes": 1, "y": 1, "true": 1, "present": 1, "positive": 1,
      "pos": 1, "male": 1, "m": 1, "case": 1, "event": 1, "abnormal": 1
    };
    return !!pos[u];
  }

  function eventLevel(levels) {
    var i, hits = [];
    for (i = 0; i < levels.length; i++) if (isPositiveLevel(levels[i])) hits.push(levels[i]);
    if (hits.length === 1) return hits[0];
    return levels[levels.length - 1];
  }

  function indexOfLevel(levels, level) {
    var i;
    for (i = 0; i < levels.length; i++) if (levels[i] === level) return i;
    return -1;
  }

  function uniqueLabels(labels) {
    var seen = {}, out = [], i;
    for (i = 0; i < labels.length; i++) {
      if (!seen[labels[i]]) { seen[labels[i]] = 1; out.push(labels[i]); }
    }
    return sortLevels(out);
  }

  function looksContinuous(values) {
    var parsed = numericValues(values), xs = parsed.xs, seen = {}, u = 0, i, key;
    if (!xs.length) return false;
    if (xs.length !== values.length - parsed.missing && parsed.missing !== values.length - xs.length) {
      /* numericValues already dropped non-numbers; continuous only if almost all parse */
    }
    if (xs.length / (xs.length + 0) < 1 && parsed.missing > xs.length * 0.1) return false;
    for (i = 0; i < xs.length; i++) {
      key = String(xs[i]);
      if (!seen[key]) { seen[key] = 1; u++; }
    }
    if (u >= 10) return true;
    if (u > 5 && xs.length && u / xs.length > 0.5) return true;
    return false;
  }

  function groupNormFlags(buckets) {
    var flags = [], i, sw;
    for (i = 0; i < buckets.length; i++) {
      sw = buckets[i].length >= 3 && buckets[i].length <= 5000 ? shapiroWilk(buckets[i]) : null;
      flags.push(!!(sw && sw.normal));
    }
    return flags;
  }

  function describeGroup(name, xs, type) {
    return { group: name, describe: describe(xs, type) };
  }

  function blankEffect() {
    return { measure: null, estimate: null, ciLower: null, ciUpper: null };
  }

  function pack(choice, statName, stat, df, p, byGroup, effect, dropped) {
    return {
      test: choice.test,
      label: choice.label,
      why: choice.why,
      statistic: stat,
      statisticName: statName,
      df: df,
      p: p,
      byGroup: byGroup,
      effect: effect,
      dropped: dropped
    };
  }

  function compare(outcomeValues, groupValues, opts) {
    var outcomeType, paired, i, ox, gx, dropped, pairsX, pairsG, labels, buckets, flags, choice;
    var a, b, d, sw, res, byGroup, cont, rx, ry, ranks, rho, corr, names;
    if (!isArray(outcomeValues) || !isArray(groupValues)) bad("compare needs two arrays");
    if (outcomeValues.length !== groupValues.length) bad("compare arrays must have the same length");
    if (!opts || typeof opts !== "object") bad("compare needs an options object");
    outcomeType = opts.outcomeType;
    if (outcomeType !== "numeric" && outcomeType !== "binary" && outcomeType !== "categorical") {
      bad("compare needs an outcome type of numeric, binary, or categorical");
    }
    paired = !!opts.paired;
    dropped = 0;
    if (paired) {
      pairsX = [];
      pairsG = [];
      for (i = 0; i < outcomeValues.length; i++) {
        if (isMissingToken(outcomeValues[i]) || isMissingToken(groupValues[i])) { dropped++; continue; }
        if (outcomeType === "numeric") {
          ox = parseNumber(outcomeValues[i]);
          gx = parseNumber(groupValues[i]);
          if (ox === null || gx === null) { dropped++; continue; }
          pairsX.push(ox);
          pairsG.push(gx);
        } else {
          pairsX.push(trim(outcomeValues[i]));
          pairsG.push(trim(groupValues[i]));
        }
      }
      if (outcomeType === "numeric") {
        d = [];
        for (i = 0; i < pairsX.length; i++) d.push(pairsX[i] - pairsG[i]);
        sw = d.length >= 3 && d.length <= 5000 ? shapiroWilk(d) : null;
        choice = chooseTest({ outcomeType: "numeric", groups: 2, paired: true, normal: !!(sw && sw.normal) });
        byGroup = [
          describeGroup("1", pairsX, "numeric"),
          describeGroup("2", pairsG, "numeric")
        ];
        if (choice.test === "paired_t") {
          res = pairedTTest(d);
          return pack(choice, "t", res.statistic, res.df, res.p, byGroup, {
            measure: "MD", estimate: res.estimate, ciLower: res.ciLower, ciUpper: res.ciUpper
          }, dropped);
        }
        res = wilcoxonSigned(d);
        return pack(choice, "V", res.statistic, null, res.p, byGroup, blankEffect(), dropped);
      }
      return comparePairedBinary(pairsX, pairsG, dropped);
    }

    if (outcomeType === "numeric" && looksContinuous(groupValues) && looksContinuous(outcomeValues)) {
      return compareCorrelation(outcomeValues, groupValues);
    }

    labels = [];
    buckets = [];
    names = [];
    dropped = 0;
    var index = {};
    for (i = 0; i < outcomeValues.length; i++) {
      if (isMissingToken(outcomeValues[i]) || isMissingToken(groupValues[i])) { dropped++; continue; }
      gx = trim(groupValues[i]);
      if (outcomeType === "numeric") {
        ox = parseNumber(outcomeValues[i]);
        if (ox === null) { dropped++; continue; }
      } else ox = trim(outcomeValues[i]);
      if (!index.hasOwnProperty(gx)) {
        index[gx] = names.length;
        names.push(gx);
        buckets.push([]);
      }
      buckets[index[gx]].push(ox);
    }
    labels = sortLevels(names);
    var ordered = [];
    for (i = 0; i < labels.length; i++) ordered.push(buckets[index[labels[i]]]);
    if (labels.length < 2) bad("compare needs at least two groups");
    byGroup = [];
    for (i = 0; i < labels.length; i++) byGroup.push(describeGroup(labels[i], ordered[i], outcomeType));

    if (outcomeType === "numeric") {
      flags = groupNormFlags(ordered);
      choice = chooseTest({ outcomeType: "numeric", groups: labels.length, paired: false, normal: flags });
      if (choice.test === "welch_t") {
        res = welchTest(ordered[0], ordered[1]);
        return pack(choice, "t", res.statistic, res.df, res.p, byGroup, {
          measure: "MD", estimate: res.estimate, ciLower: res.ciLower, ciUpper: res.ciUpper
        }, dropped);
      }
      if (choice.test === "mann_whitney") {
        res = mannWhitney(ordered[0], ordered[1]);
        return pack(choice, "U", res.statistic, null, res.p, byGroup, blankEffect(), dropped);
      }
      if (choice.test === "anova") {
        res = anovaTest(ordered);
        return pack(choice, "F", res.statistic, res.df, res.p, byGroup, blankEffect(), dropped);
      }
      res = kruskalTest(ordered);
      return pack(choice, "H", res.statistic, res.df, res.p, byGroup, blankEffect(), dropped);
    }
    return compareCategorical(labels, ordered, byGroup, dropped);
  }

  function compareCorrelation(outcomeValues, groupValues) {
    var xs = [], ys = [], i, ox, gx, dropped = 0, dx, dy, swx, swy, choice, r, ranks, rho, res, byGroup;
    for (i = 0; i < outcomeValues.length; i++) {
      if (isMissingToken(outcomeValues[i]) || isMissingToken(groupValues[i])) { dropped++; continue; }
      ox = parseNumber(outcomeValues[i]);
      gx = parseNumber(groupValues[i]);
      if (ox === null || gx === null) { dropped++; continue; }
      xs.push(ox);
      ys.push(gx);
    }
    swx = xs.length >= 3 && xs.length <= 5000 ? shapiroWilk(xs) : null;
    swy = ys.length >= 3 && ys.length <= 5000 ? shapiroWilk(ys) : null;
    choice = chooseTest({
      outcomeType: "numeric",
      groups: 0,
      paired: false,
      normal: [!!(swx && swx.normal), !!(swy && swy.normal)]
    });
    byGroup = [describeGroup("1", xs, "numeric"), describeGroup("2", ys, "numeric")];
    if (choice.test === "pearson") {
      r = pearsonR(xs, ys);
      res = corrTest(r, xs.length);
      return pack(choice, "r", res.statistic, res.df, res.p, byGroup, {
        measure: "r", estimate: res.statistic, ciLower: res.ciLower, ciUpper: res.ciUpper
      }, dropped);
    }
    ranks = [averageRanks(xs), averageRanks(ys)];
    rho = pearsonR(ranks[0], ranks[1]);
    res = corrTest(rho, xs.length);
    return pack(choice, "rho", res.statistic, res.df, res.p, byGroup, {
      measure: "rho", estimate: res.statistic, ciLower: res.ciLower, ciUpper: res.ciUpper
    }, dropped);
  }

  function comparePairedBinary(xs, ys, dropped) {
    var tab = crosstab(xs, ys), b, c, res, choice, byGroup, levels;
    if (tab.rowLevels.length !== 2 || tab.colLevels.length !== 2) {
      bad("McNemar test needs two levels on each measurement");
    }
    b = tab.counts[0][1];
    c = tab.counts[1][0];
    res = mcnemarTest(b, c);
    choice = chooseTest({ outcomeType: "binary", groups: 2, paired: true, normal: false });
    levels = tab.rowLevels;
    byGroup = [
      describeGroup("1", xs, levels.length === 2 ? "binary" : "categorical"),
      describeGroup("2", ys, "binary")
    ];
    return pack(choice, "chi2", res.statistic, res.df, res.p, byGroup, {
      measure: "OR",
      estimate: res.estimate,
      ciLower: res.ciLower,
      ciUpper: res.ciUpper
    }, dropped);
  }

  function compareCategorical(labels, ordered, byGroup, dropped) {
    var colSeen = {}, cols = [], i, j, r, c, counts, choice, small, chi, wk, effect, a, b, d, ev, evIdx, other;
    for (i = 0; i < ordered.length; i++) {
      for (j = 0; j < ordered[i].length; j++) {
        if (!colSeen[ordered[i][j]]) { colSeen[ordered[i][j]] = 1; cols.push(ordered[i][j]); }
      }
    }
    cols = sortLevels(cols);
    counts = [];
    for (r = 0; r < labels.length; r++) {
      counts[r] = [];
      for (c = 0; c < cols.length; c++) counts[r][c] = 0;
      for (j = 0; j < ordered[r].length; j++) {
        c = indexOfLevel(cols, ordered[r][j]);
        counts[r][c]++;
      }
    }
    small = false;
    if (labels.length === 2 && cols.length === 2) {
      chi = chiSquare(counts);
      for (r = 0; r < 2; r++) for (c = 0; c < 2; c++) if (chi.expected[r][c] < 5) small = true;
    }
    choice = chooseTest({
      outcomeType: cols.length === 2 ? "binary" : "categorical",
      groups: labels.length,
      paired: false,
      normal: false,
      smallExpected: small
    });
    effect = blankEffect();
    if (choice.test === "fisher") {
      ev = eventLevel(cols);
      evIdx = indexOfLevel(cols, ev);
      other = evIdx === 0 ? 1 : 0;
      a = counts[0][evIdx];
      b = counts[0][other];
      c = counts[1][evIdx];
      d = counts[1][other];
      wk = woolfAndKatz(a, b, c, d);
      effect = {
        measure: "OR",
        estimate: wk.or,
        ciLower: wk.orLo,
        ciUpper: wk.orHi,
        rr: wk.rr,
        rrCiLower: wk.rrLo,
        rrCiUpper: wk.rrHi
      };
      return pack(choice, null, null, null, fisherExactP(counts), byGroup, effect, dropped);
    }
    chi = chiSquare(counts);
    if (labels.length === 2 && cols.length === 2) {
      ev = eventLevel(cols);
      evIdx = indexOfLevel(cols, ev);
      other = evIdx === 0 ? 1 : 0;
      a = counts[0][evIdx];
      b = counts[0][other];
      c = counts[1][evIdx];
      d = counts[1][other];
      wk = woolfAndKatz(a, b, c, d);
      effect = {
        measure: "OR",
        estimate: wk.or,
        ciLower: wk.orLo,
        ciUpper: wk.orHi,
        rr: wk.rr,
        rrCiLower: wk.rrLo,
        rrCiUpper: wk.rrHi
      };
    }
    return pack(choice, "chi2", chi.statistic, chi.df, chi.p, byGroup, effect, dropped);
  }

  function crosstab(aValues, bValues) {
    var i, ax, bx, rowNames = [], colNames = [], ri = {}, ci = {}, counts = [], r, c, N, rowS, colS, expected;
    if (!isArray(aValues) || !isArray(bValues)) bad("crosstab needs two arrays");
    if (aValues.length !== bValues.length) bad("crosstab arrays must have the same length");
    var pairsA = [], pairsB = [];
    for (i = 0; i < aValues.length; i++) {
      if (isMissingToken(aValues[i]) || isMissingToken(bValues[i])) continue;
      pairsA.push(trim(aValues[i]));
      pairsB.push(trim(bValues[i]));
    }
    rowNames = uniqueLabels(pairsA);
    colNames = uniqueLabels(pairsB);
    for (r = 0; r < rowNames.length; r++) {
      ri[rowNames[r]] = r;
      counts[r] = [];
      for (c = 0; c < colNames.length; c++) counts[r][c] = 0;
    }
    for (c = 0; c < colNames.length; c++) ci[colNames[c]] = c;
    for (i = 0; i < pairsA.length; i++) counts[ri[pairsA[i]]][ci[pairsB[i]]]++;
    N = pairsA.length;
    rowS = [];
    colS = [];
    for (c = 0; c < colNames.length; c++) colS[c] = 0;
    for (r = 0; r < rowNames.length; r++) {
      rowS[r] = 0;
      for (c = 0; c < colNames.length; c++) {
        rowS[r] += counts[r][c];
        colS[c] += counts[r][c];
      }
    }
    expected = [];
    for (r = 0; r < rowNames.length; r++) {
      expected[r] = [];
      for (c = 0; c < colNames.length; c++) {
        expected[r][c] = N ? (rowS[r] * colS[c] / N) : 0;
      }
    }
    return { rowLevels: rowNames, colLevels: colNames, counts: counts, expected: expected };
  }

  /* ---- display ---- */

  function roundAway(x, digits) {
    var sign = x < 0 ? -1 : 1;
    var p = Math.pow(10, digits);
    var v = Math.abs(x) * p;
    var n = Math.floor(v + 1e-8);
    if (v + 1e-8 - n >= 0.5) n += 1;
    if (n === 0) sign = 1;
    return sign * n / p;
  }

  function fmtNum(x, digits) {
    var sign, p, v, n, ip, fp, fs;
    if (!isFin(x)) return "";
    sign = x < 0 ? "-" : "";
    p = Math.pow(10, digits);
    v = Math.abs(x) * p;
    n = Math.floor(v + 1e-8);
    if (v + 1e-8 - n >= 0.5) n += 1;
    if (n === 0) sign = "";
    ip = Math.floor(n / p);
    fp = n - ip * p;
    if (digits === 0) return sign + String(ip);
    fs = String(fp);
    while (fs.length < digits) fs = "0" + fs;
    return sign + String(ip) + "." + fs;
  }

  function fmtMean(desc) {
    if (!desc || !desc.n) return "";
    if (desc.n < 2 || desc.sd === null) return fmtNum(desc.mean, 1);
    return fmtNum(desc.mean, 1) + PM + fmtNum(desc.sd, 1);
  }

  function fmtMedian(desc) {
    if (!desc || !desc.n) return "";
    if (desc.n < 2) return fmtNum(desc.median, 1);
    return fmtNum(desc.median, 1) + " (" + fmtNum(desc.q1, 1) + " to " + fmtNum(desc.q3, 1) + ")";
  }

  function fmtCount(n, pct) {
    return String(n) + " (" + fmtNum(pct, 1) + "%)";
  }

  function formatP(p) {
    if (!isFin(p) || p < 0 || p > 1) bad("p must be between 0 and 1");
    if (p < 0.001) return "p < 0.001";
    if (p < 0.1) return "p = " + fmtNum(p, 3);
    return "p = " + fmtNum(p, 2);
  }

  function columnValues(rows, columns, name) {
    var idx = -1, i, out = [];
    for (i = 0; i < columns.length; i++) if (columns[i] === name) { idx = i; break; }
    if (idx < 0) bad("unknown column " + name);
    for (i = 0; i < rows.length; i++) {
      if (!isArray(rows[i])) bad("each row must be an array");
      out.push(rows[i][idx]);
    }
    return out;
  }

  function resolveTypes(columns, types) {
    var map = {}, i;
    if (!types) return map;
    if (isArray(types)) {
      for (i = 0; i < columns.length && i < types.length; i++) map[columns[i]] = types[i];
      return map;
    }
    if (typeof types === "object") return types;
    bad("types must be a map or an array");
    return map;
  }

  function table1(rows, columns, groupColumn, variables, types) {
    var typeMap, groupsVals, i, j, gLabels, gCounts, seen, overallMask, varName, type, vals;
    var useMean, overallDesc, groupDesc, cells, result, rowOut, level, counts, gi, lv, n, pct, found;
    if (!isArray(rows) || !isArray(columns) || !isArray(variables)) bad("table1 needs rows, columns, and variables");
    typeMap = resolveTypes(columns, types);
    groupsVals = columnValues(rows, columns, groupColumn);
    seen = {};
    gLabels = [];
    for (i = 0; i < groupsVals.length; i++) {
      if (isMissingToken(groupsVals[i])) continue;
      if (!seen[trim(groupsVals[i])]) { seen[trim(groupsVals[i])] = 1; gLabels.push(trim(groupsVals[i])); }
    }
    gLabels = sortLevels(gLabels);
    if (gLabels.length < 1) bad("table1 group column has no values");
    gCounts = [];
    for (i = 0; i < gLabels.length; i++) gCounts.push({ name: gLabels[i], n: 0 });
    for (i = 0; i < groupsVals.length; i++) {
      if (isMissingToken(groupsVals[i])) continue;
      for (j = 0; j < gLabels.length; j++) if (gLabels[j] === trim(groupsVals[i])) gCounts[j].n++;
    }
    rowOut = [];
    for (j = 0; j < variables.length; j++) {
      varName = variables[j];
      vals = columnValues(rows, columns, varName);
      type = typeMap[varName];
      if (!type) type = inferColumn(varName, vals).type;
      if (type === "numeric") {
        overallMask = [];
        for (i = 0; i < vals.length; i++) {
          if (!isMissingToken(groupsVals[i])) overallMask.push(vals[i]);
          else overallMask.push("");
        }
        overallDesc = describe(overallMask, "numeric");
        useMean = !!(overallDesc.normality && overallDesc.normality.normal);
        cells = [];
        groupDesc = [];
        for (gi = 0; gi < gLabels.length; gi++) {
          var bucket = [];
          for (i = 0; i < vals.length; i++) {
            if (!isMissingToken(groupsVals[i]) && trim(groupsVals[i]) === gLabels[gi]) bucket.push(vals[i]);
          }
          groupDesc.push(describe(bucket, "numeric"));
          cells.push(useMean ? fmtMean(groupDesc[gi]) : fmtMedian(groupDesc[gi]));
        }
        result = null;
        if (gLabels.length >= 2) {
          result = compare(vals, groupsVals, { outcomeType: "numeric", paired: false });
        }
        rowOut.push({
          variable: varName,
          type: "numeric",
          label: useMean ? "mean \u00b1 SD" : "median (IQR)",
          overall: useMean ? fmtMean(overallDesc) : fmtMedian(overallDesc),
          cells: cells,
          p: result ? formatP(result.p) : "",
          test: result ? result.label : ""
        });
      } else if (type === "binary" || type === "categorical") {
        var perGroup = [];
        var overallVals = [];
        for (gi = 0; gi < gLabels.length; gi++) perGroup.push([]);
        for (i = 0; i < vals.length; i++) {
          if (isMissingToken(groupsVals[i])) continue;
          overallVals.push(vals[i]);
          for (gi = 0; gi < gLabels.length; gi++) {
            if (trim(groupsVals[i]) === gLabels[gi]) perGroup[gi].push(vals[i]);
          }
        }
        var oDesc = describe(overallVals, type === "binary" ? "binary" : "categorical");
        var gDesc = [];
        for (gi = 0; gi < gLabels.length; gi++) gDesc.push(describe(perGroup[gi], type === "binary" ? "binary" : "categorical"));
        result = null;
        if (gLabels.length >= 2) result = compare(vals, groupsVals, { outcomeType: type, paired: false });
        var levelNames = oDesc.counts.length ? [] : [];
        for (i = 0; i < oDesc.counts.length; i++) levelNames.push(oDesc.counts[i].level);
        for (gi = 0; gi < gDesc.length; gi++) {
          for (i = 0; i < gDesc[gi].counts.length; i++) {
            found = false;
            for (lv = 0; lv < levelNames.length; lv++) if (levelNames[lv] === gDesc[gi].counts[i].level) found = true;
            if (!found) levelNames.push(gDesc[gi].counts[i].level);
          }
        }
        levelNames = sortLevels(levelNames);
        for (lv = 0; lv < levelNames.length; lv++) {
          level = levelNames[lv];
          cells = [];
          n = 0;
          pct = 0;
          for (i = 0; i < oDesc.counts.length; i++) if (oDesc.counts[i].level === level) { n = oDesc.counts[i].n; pct = oDesc.counts[i].pct; }
          var overallCell = oDesc.n ? fmtCount(n, pct) : "0";
          for (gi = 0; gi < gLabels.length; gi++) {
            n = 0;
            pct = 0;
            counts = gDesc[gi].counts;
            for (i = 0; i < counts.length; i++) if (counts[i].level === level) { n = counts[i].n; pct = counts[i].pct; }
            cells.push(gDesc[gi].n ? fmtCount(n, gDesc[gi].n ? (100 * n / gDesc[gi].n) : 0) : "0");
          }
          rowOut.push({
            variable: varName,
            type: type,
            label: level,
            overall: overallCell,
            cells: cells,
            p: result ? formatP(result.p) : "",
            test: result ? result.label : ""
          });
        }
      } else {
        var nOverall = 0;
        cells = [];
        for (gi = 0; gi < gLabels.length; gi++) cells.push(0);
        for (i = 0; i < vals.length; i++) {
          if (isMissingToken(groupsVals[i]) || isMissingToken(vals[i])) continue;
          nOverall++;
          for (gi = 0; gi < gLabels.length; gi++) if (trim(groupsVals[i]) === gLabels[gi]) cells[gi]++;
        }
        for (gi = 0; gi < cells.length; gi++) cells[gi] = String(cells[gi]);
        rowOut.push({
          variable: varName,
          type: type,
          label: "",
          overall: String(nOverall),
          cells: cells,
          p: "",
          test: ""
        });
      }
    }
    return { groups: gCounts, rows: rowOut };
  }

  /* ---- logistic regression, IRLS binomial logit ---- */

  function expit(eta) {
    var e;
    if (eta >= 0) {
      e = Math.exp(-eta);
      return 1 / (1 + e);
    }
    e = Math.exp(eta);
    return e / (1 + e);
  }

  function logit(mu) {
    var m = mu;
    if (m < 1e-12) m = 1e-12;
    if (m > 1 - 1e-12) m = 1 - 1e-12;
    return Math.log(m / (1 - m));
  }

  function binomDev(y, mu) {
    var d = 0, i, yi, m, t;
    for (i = 0; i < y.length; i++) {
      yi = y[i];
      m = mu[i];
      if (m < 1e-15) m = 1e-15;
      if (m > 1 - 1e-15) m = 1 - 1e-15;
      t = 0;
      if (yi > 0) t += yi * Math.log(yi / m);
      if (yi < 1) t += (1 - yi) * Math.log((1 - yi) / (1 - m));
      d += 2 * t;
    }
    return d;
  }

  function solveLinear(A, b) {
    var p = b.length, M = [], i, j, k, max, maxR, tmp, pivot, f, x;
    for (i = 0; i < p; i++) {
      M[i] = [];
      for (j = 0; j < p; j++) M[i][j] = A[i][j];
      M[i][p] = b[i];
    }
    for (k = 0; k < p; k++) {
      max = Math.abs(M[k][k]);
      maxR = k;
      for (i = k + 1; i < p; i++) {
        if (Math.abs(M[i][k]) > max) { max = Math.abs(M[i][k]); maxR = i; }
      }
      if (!(max > 1e-12)) return null;
      if (maxR !== k) { tmp = M[k]; M[k] = M[maxR]; M[maxR] = tmp; }
      pivot = M[k][k];
      for (j = k; j <= p; j++) M[k][j] /= pivot;
      for (i = 0; i < p; i++) {
        if (i === k) continue;
        f = M[i][k];
        if (f === 0) continue;
        for (j = k; j <= p; j++) M[i][j] -= f * M[k][j];
      }
    }
    x = [];
    for (i = 0; i < p; i++) x.push(M[i][p]);
    return x;
  }

  /* Covariance of a binomial logit fit from the QR of sqrt(weight) * X. */
  function qrCovariance(X, wgt) {
    var n = X.length, p = X[0].length, i, j, k, t, dot, norm;
    var V = [], R = [], Q = [], invR = [], cov = [];
    for (j = 0; j < p; j++) {
      V[j] = [];
      for (i = 0; i < n; i++) V[j][i] = X[i][j] * Math.sqrt(wgt[i]);
    }
    for (i = 0; i < p; i++) {
      R[i] = [];
      for (j = 0; j < p; j++) R[i][j] = 0;
    }
    for (j = 0; j < p; j++) {
      for (k = 0; k < j; k++) {
        dot = 0;
        for (i = 0; i < n; i++) dot += Q[k][i] * V[j][i];
        R[k][j] = dot;
        for (i = 0; i < n; i++) V[j][i] -= dot * Q[k][i];
      }
      norm = 0;
      for (i = 0; i < n; i++) norm += V[j][i] * V[j][i];
      norm = Math.sqrt(norm);
      if (!(norm > 1e-14)) return null;
      R[j][j] = norm;
      Q[j] = [];
      for (i = 0; i < n; i++) Q[j][i] = V[j][i] / norm;
    }
    for (i = 0; i < p; i++) {
      invR[i] = [];
      for (j = 0; j < p; j++) invR[i][j] = 0;
    }
    for (j = p - 1; j >= 0; j--) {
      invR[j][j] = 1 / R[j][j];
      for (k = j + 1; k < p; k++) {
        dot = 0;
        for (t = j + 1; t <= k; t++) dot += R[j][t] * invR[t][k];
        invR[j][k] = -dot / R[j][j];
      }
    }
    for (j = 0; j < p; j++) {
      cov[j] = [];
      for (k = 0; k < p; k++) {
        dot = 0;
        for (t = 0; t < p; t++) dot += invR[j][t] * invR[k][t];
        cov[j][k] = dot;
      }
    }
    return cov;
  }

  function invertMatrix(A) {
    var p = A.length, inv = [], j, i, e, col;
    for (i = 0; i < p; i++) inv[i] = [];
    for (j = 0; j < p; j++) {
      e = [];
      for (i = 0; i < p; i++) e.push(i === j ? 1 : 0);
      col = solveLinear(A, e);
      if (!col) return null;
      for (i = 0; i < p; i++) inv[i][j] = col[i];
    }
    return inv;
  }

  function logistic(rows, columns, outcome, predictors, types) {
    var typeMap, yRaw, i, j, k, predVals, designNames, levels, ref, lv, used, y, X, p, n;
    var events = 0, eta, mu, dev, devOld, iter, conv, w, z, xtwx, xtwz, beta, a, b;
    var sep, inv, se, crit, coefs, name, or, lo, hi, zp, warn, nPred, yi, xv;
    if (!isArray(rows) || !isArray(columns) || !isArray(predictors)) bad("logistic needs rows, columns, and predictors");
    if (!predictors.length) bad("logistic needs at least one predictor");
    typeMap = resolveTypes(columns, types);
    yRaw = columnValues(rows, columns, outcome);
    predVals = [];
    for (j = 0; j < predictors.length; j++) predVals.push(columnValues(rows, columns, predictors[j]));
    designNames = ["Intercept"];
    var levelInfo = [];
    for (j = 0; j < predictors.length; j++) {
      var t = typeMap[predictors[j]];
      if (!t) t = inferColumn(predictors[j], predVals[j]).type;
      if (t === "binary" || t === "categorical") {
        levels = inferColumn(predictors[j], predVals[j]).levels;
        if (!levels.length) {
          var tmpSeen = {}, tmp = [];
          for (i = 0; i < predVals[j].length; i++) {
            if (isMissingToken(predVals[j][i])) continue;
            if (!tmpSeen[trim(predVals[j][i])]) { tmpSeen[trim(predVals[j][i])] = 1; tmp.push(trim(predVals[j][i])); }
          }
          levels = sortLevels(tmp);
        }
        if (levels.length < 2) bad("predictor " + predictors[j] + " has fewer than 2 levels");
        ref = levels[0];
        var dummies = [];
        for (lv = 1; lv < levels.length; lv++) {
          dummies.push(levels[lv]);
          designNames.push(predictors[j] + ": " + levels[lv] + " vs " + ref);
        }
        levelInfo.push({ kind: "cat", levels: levels, ref: ref, dummies: dummies });
      } else if (t === "numeric") {
        designNames.push(predictors[j]);
        levelInfo.push({ kind: "num" });
      } else bad("predictor " + predictors[j] + " must be numeric, binary, or categorical");
    }
    var outcomeType = typeMap[outcome];
    if (!outcomeType) outcomeType = inferColumn(outcome, yRaw).type;
    var outcomeLevels = [];
    var oSeen = {};
    for (i = 0; i < yRaw.length; i++) {
      if (isMissingToken(yRaw[i])) continue;
      if (!oSeen[trim(yRaw[i])]) { oSeen[trim(yRaw[i])] = 1; outcomeLevels.push(trim(yRaw[i])); }
    }
    outcomeLevels = sortLevels(outcomeLevels);
    if (outcomeLevels.length !== 2) bad("logistic outcome must have exactly 2 levels");
    var ev = eventLevel(outcomeLevels);
    used = [];
    y = [];
    X = [];
    for (i = 0; i < rows.length; i++) {
      if (isMissingToken(yRaw[i])) continue;
      var skip = false;
      var rowx = [1];
      for (j = 0; j < predictors.length; j++) {
        if (isMissingToken(predVals[j][i])) { skip = true; break; }
        if (levelInfo[j].kind === "num") {
          xv = parseNumber(predVals[j][i]);
          if (xv === null) { skip = true; break; }
          rowx.push(xv);
        } else {
          var lab = trim(predVals[j][i]);
          for (k = 0; k < levelInfo[j].dummies.length; k++) rowx.push(lab === levelInfo[j].dummies[k] ? 1 : 0);
        }
      }
      if (skip) continue;
      yi = trim(yRaw[i]) === ev ? 1 : 0;
      y.push(yi);
      X.push(rowx);
      if (yi === 1) events++;
    }
    n = y.length;
    p = designNames.length;
    if (n < p) bad("not enough complete rows for logistic regression");
    if (events === 0 || events === n) bad("logistic outcome has no variation");
    nPred = predictors.length;
    mu = [];
    eta = [];
    for (i = 0; i < n; i++) {
      mu.push((y[i] + 0.5) / 2);
      eta.push(logit(mu[i]));
    }
    devOld = 0;
    conv = false;
    sep = false;
    beta = null;
    iter = 0;
    for (iter = 1; iter <= 50; iter++) {
      w = [];
      z = [];
      for (i = 0; i < n; i++) {
        var m = mu[i];
        if (m < 1e-12) m = 1e-12;
        if (m > 1 - 1e-12) m = 1 - 1e-12;
        var ww = m * (1 - m);
        w.push(ww);
        z.push(eta[i] + (y[i] - mu[i]) / ww);
      }
      xtwx = [];
      xtwz = [];
      for (a = 0; a < p; a++) {
        xtwx[a] = [];
        xtwz[a] = 0;
        for (b = 0; b < p; b++) xtwx[a][b] = 0;
      }
      for (i = 0; i < n; i++) {
        for (a = 0; a < p; a++) {
          xtwz[a] += X[i][a] * w[i] * z[i];
          for (b = 0; b < p; b++) xtwx[a][b] += X[i][a] * w[i] * X[i][b];
        }
      }
      beta = solveLinear(xtwx, xtwz);
      if (!beta) {
        return {
          n: n,
          events: events,
          converged: false,
          iterations: iter,
          warning: "A predictor has no variation, so the model is not identified.",
          coefficients: nullCoefs(designNames)
        };
      }
      sep = false;
      for (a = 0; a < p; a++) {
        if (!isFin(beta[a]) || Math.abs(beta[a]) > 40) sep = true;
      }
      for (i = 0; i < n; i++) {
        eta[i] = 0;
        for (a = 0; a < p; a++) eta[i] += X[i][a] * beta[a];
        if (!isFin(eta[i]) || eta[i] > 40 || eta[i] < -40) sep = true;
        mu[i] = expit(isFin(eta[i]) ? eta[i] : 0);
        if (mu[i] < 1e-12 || mu[i] > 1 - 1e-12) sep = true;
      }
      if (sep) {
        return {
          n: n,
          events: events,
          converged: false,
          iterations: iter,
          warning: "The outcome is perfectly separated by a predictor, so the odds ratios are not finite.",
          coefficients: nullCoefs(designNames)
        };
      }
      dev = binomDev(y, mu);
      if (Math.abs(dev - devOld) / (0.1 + Math.abs(dev)) < 1e-8) {
        conv = true;
        break;
      }
      devOld = dev;
    }
    warn = "";
    if (!conv) warn = "The model did not converge; treat the odds ratios with caution.";
    else if (events / nPred < 10) {
      warn = "Too few events for this many risk factors (fewer than 10 events per factor); treat the result with caution.";
    }
    /* Wald covariance uses the weights that produced the last beta, as glm does. */
    inv = qrCovariance(X, w);
    crit = normalQuantile(Z975_P);
    coefs = [];
    for (a = 0; a < p; a++) {
      name = designNames[a];
      se = inv && inv[a][a] > 0 ? Math.sqrt(inv[a][a]) : null;
      if (se === null || !isFin(beta[a])) {
        coefs.push({ name: name, or: null, ciLower: null, ciUpper: null, p: null });
      } else {
        zp = beta[a] / se;
        or = Math.exp(beta[a]);
        lo = Math.exp(beta[a] - crit * se);
        hi = Math.exp(beta[a] + crit * se);
        coefs.push({ name: name, or: or, ciLower: lo, ciUpper: hi, p: chiSqUpper(zp * zp, 1) });
      }
    }
    return {
      n: n,
      events: events,
      converged: conv,
      iterations: iter,
      warning: warn,
      coefficients: coefs
    };
  }

  function nullCoefs(names) {
    var out = [], i;
    for (i = 0; i < names.length; i++) {
      out.push({ name: names[i], or: null, ciLower: null, ciUpper: null, p: null });
    }
    return out;
  }

  function resultsSentence(result, opts) {
    var outcome, labels, i, parts, g1, g2, d1, d2, eff, tail, statBit;
    if (!result || typeof result !== "object") bad("resultsSentence needs a compare result");
    opts = opts || {};
    outcome = opts.outcome ? String(opts.outcome) : "the outcome";
    labels = opts.groupLabels;
    if (!isArray(labels)) labels = [];
    function gname(i0, fallback) {
      if (labels[i0]) return String(labels[i0]);
      if (result.byGroup && result.byGroup[i0]) return String(result.byGroup[i0].group);
      return fallback;
    }
    function pbit() { return formatP(result.p); }
    eff = result.effect || blankEffect();
    if (result.test === "welch_t" || result.test === "paired_t") {
      d1 = result.byGroup[0].describe;
      d2 = result.byGroup[1].describe;
      g1 = gname(0, "group A");
      g2 = gname(1, "group B");
      tail = "mean difference " + fmtNum(eff.estimate, 1) + ", 95% CI " +
        fmtNum(eff.ciLower, 1) + " to " + fmtNum(eff.ciUpper, 1) + "; " +
        result.label + ", " + pbit();
      return "Mean " + outcome + " was " + fmtMean(d1) + " in " + g1 + " and " +
        fmtMean(d2) + " in " + g2 + " (" + tail + ").";
    }
    if (result.test === "mann_whitney" || result.test === "wilcoxon") {
      d1 = result.byGroup[0].describe;
      d2 = result.byGroup[1].describe;
      g1 = gname(0, "group A");
      g2 = gname(1, "group B");
      return "Median " + outcome + " was " + fmtMedian(d1) + " in " + g1 + " and " +
        fmtMedian(d2) + " in " + g2 + " (" + result.label + ", " + pbit() + ").";
    }
    if (result.test === "anova" || result.test === "kruskal") {
      statBit = result.statisticName + " = " + fmtNum(result.statistic, 2);
      return result.label + " compared " + outcome + " across " + result.byGroup.length +
        " groups (" + statBit + ", " + pbit() + ").";
    }
    if (result.test === "pearson" || result.test === "spearman") {
      var left = labels[0] ? String(labels[0]) : outcome;
      var right = labels[1] ? String(labels[1]) : "the second measurement";
      var sym = result.test === "pearson" ? "r" : "rho";
      tail = sym + " = " + fmtNum(eff.estimate, 2);
      if (isFin(eff.ciLower) && isFin(eff.ciUpper)) {
        tail += ", 95% CI " + fmtNum(eff.ciLower, 2) + " to " + fmtNum(eff.ciUpper, 2);
      }
      tail += "; " + result.label + ", " + pbit();
      return result.label + " between " + left + " and " + right + " was " + tail + ".";
    }
    if (result.test === "chi_square" || result.test === "fisher" || result.test === "mcnemar") {
      if (eff && eff.measure === "OR" && isFin(eff.estimate)) {
        tail = "odds ratio " + fmtNum(eff.estimate, 2) + ", 95% CI " +
          fmtNum(eff.ciLower, 2) + " to " + fmtNum(eff.ciUpper, 2) + "; " +
          result.label + ", " + pbit();
        return "The odds of " + outcome + " differed between the groups (" + tail + ").";
      }
      statBit = isFin(result.statistic) ? (result.statisticName + " = " + fmtNum(result.statistic, 2) + ", ") : "";
      return result.label + " compared " + outcome + " across the groups (" + statBit + pbit() + ").";
    }
    bad("resultsSentence does not recognise this test");
    return "";
  }

  /* ---------- Survival and matched analysis (plan v2 items 4 and 6) ----------
   * Every function here returns { ok, warnings, ... } and never throws on bad data.
   * Kaplan-Meier and the log-rank test follow R survival::survfit and survdiff
   * (rho = 0); Cox follows coxph (Efron ties by default, Newton-Raphson with
   * step-halving, 20 iterations, convergence on the relative log-likelihood
   * change below 1e-9). Reference values: docs/research/stats-reference.R. */

  var EVENT_YES = { "1": 1, "yes": 1, "y": 1, "true": 1, "dead": 1, "died": 1, "event": 1 };
  var EVENT_NO = { "0": 1, "no": 1, "n": 1, "false": 1, "alive": 1, "censored": 1 };
  var PH_REMINDER = "Hazard ratios assume the effect stays the same over time. If the survival curves cross, ask your statistician before reporting.";

  function coerceEvent(v) {
    var u;
    if (v === true) return 1;
    if (v === false) return 0;
    if (v === null || v === undefined) return null;
    u = String(v).replace(/^\s+|\s+$/g, "").toLowerCase();
    if (EVENT_YES[u]) return 1;
    if (EVENT_NO[u]) return 0;
    return null;
  }

  function coerceTime(v) {
    var n = typeof v === "number" ? (isFinite(v) ? v : null) : parseNumber(v);
    if (n === null || n < 0) return null;
    return n;
  }

  function excludedMsg(n) {
    return n + " rows were left out because the time or event value was missing or invalid.";
  }

  /* Clean survival rows: [{ t, e, g }] plus the excluded count. */
  function survRows(times, events, groups) {
    var rows = [], nEx = 0, i, t, e, g;
    if (!isArray(times) || !isArray(events) || times.length !== events.length) return null;
    if (groups != null && (!isArray(groups) || groups.length !== times.length)) return null;
    for (i = 0; i < times.length; i++) {
      t = coerceTime(times[i]);
      e = coerceEvent(events[i]);
      g = groups == null ? "All" : (isMissingToken(groups[i]) ? null : trim(groups[i]));
      if (t === null || e === null || g === null) { nEx++; continue; }
      rows.push({ t: t, e: e, g: g });
    }
    return { rows: rows, nExcluded: nEx };
  }

  function groupNames(rows) {
    var seen = {}, out = [], i;
    for (i = 0; i < rows.length; i++) {
      if (!seen.hasOwnProperty(rows[i].g)) { seen[rows[i].g] = 1; out.push(rows[i].g); }
    }
    return sortLevels(out);
  }

  function kmCurve(rows, z, confType) {
    var sorted = rows.slice().sort(function (a, b) { return a.t - b.t; });
    var steps = [], n = sorted.length, s = 1, v = 0, i = 0, t, d, c, atRisk, se, lo, hi, xx, k;
    while (i < sorted.length) {
      t = sorted[i].t; d = 0; c = 0; atRisk = n;
      while (i < sorted.length && sorted[i].t === t) {
        if (sorted[i].e === 1) d++; else c++;
        i++;
      }
      if (d > 0) {
        s = s * (1 - d / atRisk);
        v = atRisk > d ? v + d / (atRisk * (atRisk - d)) : Infinity;
      }
      se = isFin(v) ? Math.sqrt(v) : null;
      lo = null; hi = null;
      if (se !== null && s > 0) {
        if (confType === "log-log") {
          if (s < 1) {
            k = Math.log(s);
            xx = [Math.pow(s, Math.exp(z * se / k)), Math.pow(s, Math.exp(-z * se / k))];
            lo = Math.min(xx[0], xx[1]); hi = Math.max(xx[0], xx[1]);
          }
        } else if (confType === "plain") {
          lo = Math.max(0, s - z * se * s); hi = Math.min(1, s + z * se * s);
        } else {
          lo = s * Math.exp(-z * se); hi = Math.min(1, s * Math.exp(z * se));
        }
      }
      steps.push({ t: t, atRisk: atRisk, events: d, censored: c, survival: s, seLogS: se, ciLower: lo, ciUpper: hi });
      n -= d + c;
    }
    return steps;
  }

  /* R quantile.survfit rule: first time the curve is at or below 0.5; when it
   * equals 0.5 (within tolerance) the midpoint to the next drop. */
  function curveMedian(steps, field) {
    var tol = 1.490116e-8, i, j, val;
    for (i = 0; i < steps.length; i++) {
      val = steps[i][field];
      if (val === null || val === undefined) continue;
      if (Math.abs(val - 0.5) < tol) {
        for (j = i + 1; j < steps.length; j++) {
          if (steps[j][field] !== null && steps[j][field] < val - tol) return (steps[i].t + steps[j].t) / 2;
        }
        return steps[i].t;
      }
      if (val < 0.5) return steps[i].t;
    }
    return null;
  }

  function kaplanMeier(times, events, groups, opts) {
    var o = opts || {}, warnings = [], prep, names, out = [], gi, rows, steps, i, nEv, conf, confType, z;
    prep = survRows(times, events, groups);
    if (!prep) return { ok: false, warnings: ["Times, events and groups must be lists of the same length."] };
    confType = o.confType === "log-log" || o.confType === "plain" ? o.confType : "log";
    conf = isFin(o.confLevel) && o.confLevel > 0 && o.confLevel < 1 ? o.confLevel : 0.95;
    z = normalQuantile(1 - (1 - conf) / 2);
    if (prep.nExcluded) warnings.push(excludedMsg(prep.nExcluded));
    if (!prep.rows.length) return { ok: false, warnings: warnings.concat(["No usable rows."]), nExcluded: prep.nExcluded };
    names = groupNames(prep.rows);
    for (gi = 0; gi < names.length; gi++) {
      rows = [];
      for (i = 0; i < prep.rows.length; i++) if (prep.rows[i].g === names[gi]) rows.push(prep.rows[i]);
      steps = kmCurve(rows, z, confType);
      nEv = 0;
      for (i = 0; i < rows.length; i++) nEv += rows[i].e;
      if (rows.length < 5) warnings.push("Group " + names[gi] + " has only " + rows.length + " patients; treat these numbers as unreliable.");
      if (!nEv) warnings.push("No one in group " + names[gi] + " had the event, so median survival is not reached.");
      out.push({
        name: names[gi], n: rows.length, nEvents: nEv, steps: steps,
        median: { value: curveMedian(steps, "survival"), lower: curveMedian(steps, "ciLower"), upper: curveMedian(steps, "ciUpper") }
      });
    }
    return { ok: true, warnings: warnings, nExcluded: prep.nExcluded, confType: confType, groups: out };
  }

  /* Solve A x = b (Gauss-Jordan with partial pivoting). Null when singular. */
  function solveLinear(A, b) {
    var n = A.length, M = [], i, j, k, p, tmp, f;
    for (i = 0; i < n; i++) M.push(A[i].slice().concat([b[i]]));
    for (i = 0; i < n; i++) {
      p = i;
      for (k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
      if (!(Math.abs(M[p][i]) > 1e-12)) return null;
      tmp = M[i]; M[i] = M[p]; M[p] = tmp;
      for (k = 0; k < n; k++) {
        if (k === i) continue;
        f = M[k][i] / M[i][i];
        for (j = i; j <= n; j++) M[k][j] -= f * M[i][j];
      }
    }
    var x = [];
    for (i = 0; i < n; i++) x.push(M[i][n] / M[i][i]);
    return x;
  }

  function invertMatrix(A) {
    var n = A.length, inv = [], i, j, e, col;
    for (i = 0; i < n; i++) inv.push([]);
    for (j = 0; j < n; j++) {
      e = [];
      for (i = 0; i < n; i++) e.push(i === j ? 1 : 0);
      col = solveLinear(A, e);
      if (!col) return null;
      for (i = 0; i < n; i++) inv[i][j] = col[i];
    }
    return inv;
  }

  function logRank(times, events, groups) {
    var prep = survRows(times, events, groups), warnings = [], names, G, obs = [], exp = [], V = [], ns = [],
      tlist = [], seen = {}, i, j, k, t, nt, dt, ng, dg, totalEv = 0, diff, chi2, df, sol;
    if (!prep) return { ok: false, warnings: ["Times, events and groups must be lists of the same length."] };
    if (prep.nExcluded) warnings.push(excludedMsg(prep.nExcluded));
    names = groupNames(prep.rows);
    G = names.length;
    if (G < 2) return { ok: false, warnings: warnings.concat(["The log-rank test needs at least two groups."]) };
    for (i = 0; i < G; i++) { obs.push(0); exp.push(0); ns.push(0); V.push([]); for (j = 0; j < G; j++) V[i].push(0); }
    for (i = 0; i < prep.rows.length; i++) {
      ns[names.indexOf(prep.rows[i].g)]++;
      if (prep.rows[i].e) { totalEv++; if (!seen[prep.rows[i].t]) { seen[prep.rows[i].t] = 1; tlist.push(prep.rows[i].t); } }
    }
    if (!totalEv) return { ok: false, warnings: warnings.concat(["No events yet, so the groups cannot be compared."]) };
    tlist.sort(function (a, b) { return a - b; });
    for (k = 0; k < tlist.length; k++) {
      t = tlist[k]; nt = 0; dt = 0; ng = []; dg = [];
      for (j = 0; j < G; j++) { ng.push(0); dg.push(0); }
      for (i = 0; i < prep.rows.length; i++) {
        if (prep.rows[i].t >= t) {
          j = names.indexOf(prep.rows[i].g);
          ng[j]++; nt++;
          if (prep.rows[i].t === t && prep.rows[i].e) { dg[j]++; dt++; }
        }
      }
      for (j = 0; j < G; j++) {
        obs[j] += dg[j];
        exp[j] += ng[j] * dt / nt;
        if (nt > 1) {
          for (i = 0; i < G; i++) {
            V[j][i] += dt * (nt - dt) / (nt - 1) * (ng[j] / nt) * ((i === j ? 1 : 0) - ng[i] / nt);
          }
        }
      }
    }
    df = G - 1;
    diff = []; var Vs = [];
    for (i = 0; i < df; i++) { diff.push(obs[i] - exp[i]); Vs.push(V[i].slice(0, df)); }
    sol = solveLinear(Vs, diff);
    if (!sol) return { ok: false, warnings: warnings.concat(["The groups cannot be compared with these data."]) };
    chi2 = 0;
    for (i = 0; i < df; i++) chi2 += diff[i] * sol[i];
    var table = [];
    for (j = 0; j < G; j++) {
      table.push({ group: names[j], n: ns[j], observed: obs[j], expected: exp[j] });
      if (ns[j] < 5) warnings.push("Group " + names[j] + " has only " + ns[j] + " patients; treat these numbers as unreliable.");
    }
    return { ok: true, warnings: warnings, chi2: chi2, df: df, p: chiSqUpper(Math.max(0, chi2), df), table: table };
  }

  /* Cox partial log-likelihood, score and information at beta. */
  function coxEval(X, time, ev, beta, efron) {
    var n = X.length, p = beta.length, eta = [], r = [], i, j, k, l, a, b, loglik = 0,
      U = [], I = [], order = [], idx, t, risk0, risk1, risk2, d0, d1, d2, dset, nd, frac, den, av;
    for (j = 0; j < p; j++) { U.push(0); I.push([]); for (k = 0; k < p; k++) I[j].push(0); }
    for (i = 0; i < n; i++) {
      a = 0;
      for (j = 0; j < p; j++) a += X[i][j] * beta[j];
      eta.push(a); r.push(Math.exp(a)); order.push(i);
    }
    order.sort(function (x, y) { return time[x] - time[y]; });
    /* walk distinct event times; risk set = time >= t */
    idx = 0;
    while (idx < n) {
      t = time[order[idx]];
      dset = [];
      for (k = idx; k < n && time[order[k]] === t; k++) if (ev[order[k]]) dset.push(order[k]);
      var nextIdx = k;
      if (dset.length) {
        risk0 = 0; risk1 = []; risk2 = [];
        d0 = 0; d1 = []; d2 = [];
        for (j = 0; j < p; j++) { risk1.push(0); d1.push(0); risk2.push([]); d2.push([]); for (k = 0; k < p; k++) { risk2[j].push(0); d2[j].push(0); } }
        for (k = idx; k < n; k++) {
          i = order[k];
          risk0 += r[i];
          for (j = 0; j < p; j++) {
            risk1[j] += r[i] * X[i][j];
            for (l = 0; l < p; l++) risk2[j][l] += r[i] * X[i][j] * X[i][l];
          }
        }
        for (b = 0; b < dset.length; b++) {
          i = dset[b];
          loglik += eta[i];
          d0 += r[i];
          for (j = 0; j < p; j++) {
            U[j] += X[i][j];
            d1[j] += r[i] * X[i][j];
            for (l = 0; l < p; l++) d2[j][l] += r[i] * X[i][j] * X[i][l];
          }
        }
        nd = dset.length;
        for (b = 0; b < nd; b++) {
          frac = efron ? b / nd : 0;
          den = risk0 - frac * d0;
          loglik -= Math.log(den);
          av = [];
          for (j = 0; j < p; j++) { av.push((risk1[j] - frac * d1[j]) / den); U[j] -= av[j]; }
          for (j = 0; j < p; j++) {
            for (l = 0; l < p; l++) I[j][l] += (risk2[j][l] - frac * d2[j][l]) / den - av[j] * av[l];
          }
        }
      }
      idx = nextIdx;
    }
    return { loglik: loglik, U: U, I: I };
  }

  function cox(rows, opts) {
    var o = opts || {}, warnings = [], preds, ties, maxIter, eps, conf, z, i, j, k, row, t, e, ok, cols = [],
      terms = [], X = [], T = [], E = [], nEx = 0, levelsFor = {}, means = [], p, beta, fit, fit0, newBeta,
      step, it, converged = false, halves, nEv = 0, history = [], inv, coefs = [], lr, tmpVals;
    if (!isArray(rows) || !o.time || !o.event || !isArray(o.predictors) || !o.predictors.length) {
      return { ok: false, warnings: ["Pick a time column, an event column and at least one factor."] };
    }
    preds = o.predictors;
    ties = o.ties === "breslow" ? "breslow" : "efron";
    maxIter = isFin(o.maxIter) && o.maxIter > 0 ? Math.floor(o.maxIter) : 20;
    eps = isFin(o.eps) && o.eps > 0 ? o.eps : 1e-9;
    conf = isFin(o.confLevel) && o.confLevel > 0 && o.confLevel < 1 ? o.confLevel : 0.95;
    z = normalQuantile(1 - (1 - conf) / 2);
    /* complete cases */
    var clean = [];
    for (i = 0; i < rows.length; i++) {
      row = rows[i] || {};
      t = coerceTime(row[o.time]);
      e = coerceEvent(row[o.event]);
      ok = t !== null && e !== null;
      var vals = [];
      for (j = 0; ok && j < preds.length; j++) {
        if (preds[j].type === "categorical") {
          if (isMissingToken(row[preds[j].name])) ok = false; else vals.push(trim(row[preds[j].name]));
        } else {
          tmpVals = typeof row[preds[j].name] === "number" ? row[preds[j].name] : parseNumber(row[preds[j].name]);
          if (tmpVals === null || !isFin(tmpVals)) ok = false; else vals.push(tmpVals);
        }
      }
      if (!ok) { nEx++; continue; }
      clean.push({ t: t, e: e, v: vals });
    }
    if (nEx) warnings.push(excludedMsg(nEx));
    if (!clean.length) return { ok: false, warnings: warnings.concat(["No complete rows to analyse."]), nExcluded: nEx };
    /* design columns */
    for (j = 0; j < preds.length; j++) {
      if (preds[j].type === "categorical") {
        var lv = [], seenL = {};
        for (i = 0; i < clean.length; i++) if (!seenL[clean[i].v[j]]) { seenL[clean[i].v[j]] = 1; lv.push(clean[i].v[j]); }
        lv.sort();
        var ref = preds[j].reference != null && seenL[String(preds[j].reference)] ? String(preds[j].reference) : lv[0];
        levelsFor[preds[j].name] = { levels: lv, reference: ref };
        for (k = 0; k < lv.length; k++) {
          if (lv[k] === ref) continue;
          cols.push({ pred: j, level: lv[k] });
          terms.push({ term: preds[j].name + lv[k], predictor: preds[j].name, level: lv[k] });
        }
      } else {
        cols.push({ pred: j, level: null });
        terms.push({ term: preds[j].name, predictor: preds[j].name, level: null });
      }
    }
    p = cols.length;
    if (!p) return { ok: false, warnings: warnings.concat(["Each factor needs at least two different values."]) };
    for (i = 0; i < clean.length; i++) {
      var xr = [];
      for (k = 0; k < p; k++) xr.push(cols[k].level === null ? clean[i].v[cols[k].pred] : (clean[i].v[cols[k].pred] === cols[k].level ? 1 : 0));
      X.push(xr); T.push(clean[i].t); E.push(clean[i].e); nEv += clean[i].e;
    }
    if (!nEv) return { ok: false, warnings: warnings.concat(["No events yet, so the groups cannot be compared."]), n: clean.length, nEvents: 0, nExcluded: nEx };
    for (k = 0; k < p; k++) {
      var m = 0;
      for (i = 0; i < X.length; i++) m += X[i][k];
      m /= X.length;
      means.push(m);
      for (i = 0; i < X.length; i++) X[i][k] -= m;
    }
    if (nEv / p < 10) warnings.push("Too few events for this many factors; use fewer factors.");
    beta = [];
    for (k = 0; k < p; k++) beta.push(0);
    fit0 = coxEval(X, T, E, beta, ties === "efron");
    fit = fit0;
    history.push(beta.slice());
    for (it = 1; it <= maxIter; it++) {
      step = solveLinear(fit.I, fit.U);
      if (!step) break;
      newBeta = [];
      for (k = 0; k < p; k++) newBeta.push(beta[k] + step[k]);
      var nf = coxEval(X, T, E, newBeta, ties === "efron");
      halves = 0;
      while ((!isFin(nf.loglik) || nf.loglik < fit.loglik) && halves < 10) {
        for (k = 0; k < p; k++) { step[k] /= 2; newBeta[k] = beta[k] + step[k]; }
        nf = coxEval(X, T, E, newBeta, ties === "efron");
        halves++;
      }
      if (!isFin(nf.loglik)) break;
      var rel = Math.abs(1 - fit.loglik / nf.loglik);
      beta = newBeta; var prevLik = fit.loglik; fit = nf;
      history.push(beta.slice());
      if (rel < eps) { converged = true; break; }
      if (Math.abs(fit.loglik - prevLik) < 1e-12) { converged = true; break; }
    }
    var iterations = Math.min(it, maxIter);
    if (!converged) {
      return { ok: false, warnings: warnings.concat(["The model did not settle on an answer. Do not report a hazard ratio; ask your statistician."]),
        n: clean.length, nEvents: nEv, nExcluded: nEx, converged: false, iterations: iterations };
    }
    inv = invertMatrix(fit.I);
    var anySep = false;
    for (k = 0; k < p; k++) {
      var grew = history.length >= 4;
      for (j = history.length - 3; grew && j < history.length; j++) {
        if (!(Math.abs(history[j][k]) > Math.abs(history[j - 1][k]))) grew = false;
      }
      var sep = Math.abs(beta[k]) > 15 || (grew && Math.abs(fit.loglik - prevLik) < 1e-6 && Math.abs(beta[k]) > 5);
      var se = inv && inv[k][k] > 0 ? Math.sqrt(inv[k][k]) : null;
      if (se === null) sep = true;
      if (sep) anySep = true;
      var zz = se ? beta[k] / se : null;
      coefs.push({
        term: terms[k].term, predictor: terms[k].predictor, level: terms[k].level,
        beta: beta[k], se: se, hr: sep ? null : Math.exp(beta[k]),
        ciLower: sep ? null : Math.exp(beta[k] - z * se), ciUpper: sep ? null : Math.exp(beta[k] + z * se),
        z: sep ? null : zz, p: sep ? null : 2 * normalUpper(Math.abs(zz)), estimable: !sep
      });
    }
    if (anySep) warnings.push("One group had no events (or only events), so its hazard ratio cannot be estimated.");
    lr = 2 * (fit.loglik - fit0.loglik);
    warnings.push(PH_REMINDER);
    return {
      ok: true, warnings: warnings, n: clean.length, nEvents: nEv, nExcluded: nEx, converged: true,
      iterations: iterations, ties: ties, logLik: fit.loglik, logLikNull: fit0.loglik,
      lrTest: { chi2: lr, df: p, p: chiSqUpper(Math.max(0, lr), p) },
      levels: levelsFor, coefficients: coefs
    };
  }

  function binomLowerTail(k, n) {
    var s = 0, i;
    for (i = 0; i <= k; i++) s += Math.exp(logChoose(n, i) - n * Math.LN2);
    return s;
  }

  function matchedOr(input, opts) {
    var b = 0, c = 0, i, ce, co, warnings = [], conf, alpha, pL, pU, orv, lo, hi, p, nEx = 0;
    conf = opts && isFin(opts.confLevel) && opts.confLevel > 0 && opts.confLevel < 1 ? opts.confLevel : 0.95;
    alpha = 1 - conf;
    if (isArray(input)) {
      for (i = 0; i < input.length; i++) {
        ce = coerceEvent(input[i] && input[i].caseExposed);
        co = coerceEvent(input[i] && input[i].controlExposed);
        if (ce === null || co === null) { nEx++; continue; }
        if (ce === 1 && co === 0) b++;
        else if (ce === 0 && co === 1) c++;
      }
      if (nEx) warnings.push(nEx + " pairs were left out because an exposure value was missing or invalid.");
    } else if (input && isFin(input.b) && isFin(input.c) && input.b >= 0 && input.c >= 0 &&
      Math.floor(input.b) === input.b && Math.floor(input.c) === input.c) {
      b = input.b; c = input.c;
    } else {
      return { ok: false, warnings: ["Give the pairs, or the two discordant counts b and c."] };
    }
    if (b + c === 0) return { ok: false, warnings: warnings.concat(["No pairs differ in exposure, so the matched odds ratio cannot be calculated."]), b: b, c: c };
    if (b + c < 10) warnings.push("Very few pairs differ; the interval is wide.");
    pL = b === 0 ? 0 : invBetai(b, c + 1, alpha / 2);
    pU = c === 0 ? 1 : invBetai(b + 1, c, 1 - alpha / 2);
    orv = c === 0 ? Infinity : b / c;
    lo = pL / (1 - pL);
    hi = pU >= 1 ? Infinity : pU / (1 - pU);
    if (c === 0) warnings.push("The odds ratio is very large; report only the lower limit.");
    p = Math.min(1, 2 * binomLowerTail(Math.min(b, c), b + c));
    return { ok: true, warnings: warnings, b: b, c: c, or: orv, ciLower: lo, ciUpper: hi, p: p, method: "exact conditional" };
  }


  var STATS = {
    parseCsv: parseCsv,
    inferColumn: inferColumn,
    describe: describe,
    chooseTest: chooseTest,
    compare: compare,
    crosstab: crosstab,
    table1: table1,
    logistic: logistic,
    formatP: formatP,
    resultsSentence: resultsSentence,
    kaplanMeier: kaplanMeier,
    logRank: logRank,
    cox: cox,
    matchedOr: matchedOr,
    _rank: { mannWhitney: mannWhitney, wilcoxonSigned: wilcoxonSigned } /* exposed for the R parity tests */
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = STATS; }
  if (G) { G.SMD_RESEARCH_STATS = STATS; }

})(typeof window !== "undefined" ? window : undefined);
