/* StewardMD - ResearchMD on-device reader for SPSS (.sav, .zsav) and Stata
 * (.dta) data files (window.SMD_RESEARCH_STATFILE).
 *
 * Pure: no DOM, no network, no I/O. ES5 only (var/function). Dual export:
 * browser global SMD_RESEARCH_STATFILE and CommonJS module.exports.
 * The file bytes never leave the phone: the master chart screen hands this
 * module an ArrayBuffer and gets a table back.
 *
 *   read(buffer, opts) -> {
 *     format: "sav" | "dta", version, fileLabel, encoding,
 *     variables: [{ name, label, kind: "number" | "string" | "date" |
 *                   "datetime" | "time", format, valueLabels: { code: text },
 *                   missing: { values: [], range: [lo, hi] | null } }],
 *     columns: [name], data: [[value per column] per row],
 *     notes: { missingBlanked, labelledColumns, labelSets }
 *   }
 *   Values in data are numbers, strings, ISO date strings ("2024-03-15",
 *   "2024-03-15 08:30:00", "08:30:00") or null for anything missing
 *   (system missing, SPSS user-missing codes, Stata . and .a to .z).
 *
 *   toTable(result, { applyLabels }) -> { columns, rows } of strings, the
 *   shape the master chart screen already uses for CSV and Excel uploads.
 *   A numeric column gets its value labels written in only when every
 *   observed value has a label, so a scale labelled only at its ends stays
 *   numeric.
 *
 * Supported: SPSS .sav uncompressed and bytecode compressed, .zsav (zlib
 * blocks, needs an inflate function: fflate.unzlibSync in the app, node zlib
 * in tests), very long strings, long variable names, long string value labels
 * and missing values. Stata .dta releases 111 to 115 (old binary) and 117,
 * 118, 119 (tagged), including strL text. Bad input throws "statfile: ...".
 *
 * Checked in CI against pyreadstat (scripts/research-statfile-parity.py).
 */
(function (G) {
  "use strict";

  var SPSS_EPOCH_MS = Date.UTC(1582, 9, 14);
  var STATA_EPOCH_MS = Date.UTC(1960, 0, 1);
  var DAY_MS = 86400000;
  var MAX_CELLS = 20000000;

  function fail(msg) { throw new Error("statfile: " + msg); }

  /* ---------- small helpers ---------- */

  function toU8(buf) {
    if (buf instanceof Uint8Array) return buf;
    if (buf && buf.buffer && typeof buf.byteLength === "number") {
      return new Uint8Array(buf.buffer, buf.byteOffset || 0, buf.byteLength);
    }
    if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
    fail("expected an ArrayBuffer or Uint8Array");
  }

  function makeDecoder(label) {
    var tries = [label, "windows-1252", "latin1"];
    for (var i = 0; i < tries.length; i++) {
      if (!tries[i]) continue;
      try {
        var td = new TextDecoder(tries[i]);
        return { label: tries[i], decode: function (u8) { return td.decode(u8); } };
      } catch (e) { /* try the next one */ }
    }
    return {
      label: "latin1",
      decode: function (u8) {
        var s = "";
        for (var j = 0; j < u8.length; j++) s += String.fromCharCode(u8[j]);
        return s;
      }
    };
  }

  /* Stata 13 and earlier have no encoding field. Stata itself writes
   * Windows-1252, but many other programs write UTF-8 there. Text that is
   * valid UTF-8 is read as UTF-8 (plain English reads the same either way);
   * anything else as Windows-1252. */
  function makeGuessDecoder() {
    var cp = makeDecoder("windows-1252");
    var strict = null;
    try { strict = new TextDecoder("utf-8", { fatal: true }); } catch (e) { strict = null; }
    if (!strict) return cp;
    return {
      label: "utf-8 or windows-1252",
      decode: function (u8) {
        for (var i = 0; i < u8.length; i++) {
          if (u8[i] > 127) {
            try { return strict.decode(u8); } catch (e) { return cp.decode(u8); }
          }
        }
        return cp.decode(u8);
      }
    };
  }

  function rtrim(s) { return s.replace(/[\s\u0000]+$/, ""); }
  function cut0(u8) {
    for (var i = 0; i < u8.length; i++) if (u8[i] === 0) return u8.subarray(0, i);
    return u8;
  }
  function ascii(u8) {
    var s = "";
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return s;
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function isoDate(ms) {
    var d = new Date(ms);
    var y = d.getUTCFullYear();
    var ys = y < 0 ? "-" + ("000" + (-y)).slice(-4) : ("000" + y).slice(-4);
    return ys + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }
  function isoTimeOfDay(ms) {
    var d = new Date(ms);
    var s = pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()) + ":" + pad2(d.getUTCSeconds());
    var milli = d.getUTCMilliseconds();
    if (milli) s += "." + ("00" + milli).slice(-3);
    return s;
  }
  function isoDateTime(ms) { return isoDate(ms) + " " + isoTimeOfDay(ms); }
  function hms(seconds) {
    var neg = seconds < 0;
    var t = Math.abs(seconds);
    var whole = Math.floor(t + 1e-9);
    var frac = Math.round((t - whole) * 1000);
    if (frac === 1000) { whole += 1; frac = 0; }
    var h = Math.floor(whole / 3600);
    var m = Math.floor((whole % 3600) / 60);
    var s = whole % 60;
    var out = (neg ? "-" : "") + pad2(h) + ":" + pad2(m) + ":" + pad2(s);
    if (frac) out += "." + ("00" + frac).slice(-3);
    return out;
  }

  function Reader(u8, little) {
    this.u8 = u8;
    this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.le = little;
    this.p = 0;
  }
  Reader.prototype.need = function (n) {
    if (this.p + n > this.u8.length) fail("the file ends early; it may be damaged or not finished downloading");
  };
  Reader.prototype.i32 = function () { this.need(4); var v = this.dv.getInt32(this.p, this.le); this.p += 4; return v; };
  Reader.prototype.u32 = function () { this.need(4); var v = this.dv.getUint32(this.p, this.le); this.p += 4; return v; };
  Reader.prototype.i16 = function () { this.need(2); var v = this.dv.getInt16(this.p, this.le); this.p += 2; return v; };
  Reader.prototype.u16 = function () { this.need(2); var v = this.dv.getUint16(this.p, this.le); this.p += 2; return v; };
  Reader.prototype.u8v = function () { this.need(1); return this.u8[this.p++]; };
  Reader.prototype.f64 = function () { this.need(8); var v = this.dv.getFloat64(this.p, this.le); this.p += 8; return v; };
  Reader.prototype.u64 = function () {
    this.need(8);
    var lo = this.dv.getUint32(this.p + (this.le ? 0 : 4), this.le);
    var hi = this.dv.getUint32(this.p + (this.le ? 4 : 0), this.le);
    this.p += 8;
    if (hi > 0x1fffff) fail("a size in the file is too large");
    return hi * 4294967296 + lo;
  };
  Reader.prototype.bytes = function (n) {
    this.need(n);
    var b = this.u8.subarray(this.p, this.p + n);
    this.p += n;
    return b;
  };
  Reader.prototype.skip = function (n) { this.need(n); this.p += n; };

  /* ======================================================================
   * SPSS .sav / .zsav
   * ==================================================================== */

  var SAV_DATE_FMT = { 20: 1, 23: 1, 24: 1, 28: 1, 29: 1, 30: 1, 38: 1, 39: 1 };
  var SAV_DATETIME_FMT = { 22: 1, 41: 1 };
  var SAV_TIME_FMT = { 21: 1, 25: 1, 40: 1 };
  var SAV_FMT_NAMES = {
    1: "A", 2: "AHEX", 3: "COMMA", 4: "DOLLAR", 5: "F", 6: "IB", 7: "PIBHEX", 8: "P",
    9: "PIB", 10: "PK", 11: "RB", 12: "RBHEX", 15: "Z", 16: "N", 17: "E", 20: "DATE",
    21: "TIME", 22: "DATETIME", 23: "ADATE", 24: "JDATE", 25: "DTIME", 26: "WKDAY",
    27: "MONTH", 28: "MOYR", 29: "QYR", 30: "WKYR", 31: "PCT", 32: "DOT", 33: "CCA",
    34: "CCB", 35: "CCC", 36: "CCD", 37: "CCE", 38: "EDATE", 39: "SDATE", 40: "MTIME",
    41: "YMDHMS"
  };
  var CODEPAGES = {
    65001: "utf-8", 1252: "windows-1252", 1250: "windows-1250", 1251: "windows-1251",
    1253: "windows-1253", 1254: "windows-1254", 1255: "windows-1255", 1256: "windows-1256",
    1257: "windows-1257", 1258: "windows-1258", 28591: "iso-8859-1", 20127: "utf-8",
    932: "shift_jis", 936: "gbk", 949: "euc-kr", 950: "big5", 874: "windows-874"
  };

  function savFormatString(fmt) {
    var type = (fmt >> 16) & 0xff, width = (fmt >> 8) & 0xff, dec = fmt & 0xff;
    var name = SAV_FMT_NAMES[type] || ("F");
    return name + width + (dec ? "." + dec : "");
  }

  function readSav(u8, opts) {
    var magic = ascii(u8.subarray(0, 4));
    if (magic !== "$FL2" && magic !== "$FL3") fail("this is not an SPSS .sav file");
    var dvh = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (u8.length < 176) fail("the file ends early; it may be damaged or not finished downloading");
    var lay = dvh.getInt32(64, true);
    var little = (lay === 2 || lay === 3);
    if (!little) {
      lay = dvh.getInt32(64, false);
      if (lay !== 2 && lay !== 3) fail("could not work out the byte order of this SPSS file");
    }
    var r = new Reader(u8, little);
    r.p = 64 + 4;
    var nominal = r.i32();
    var compression = r.i32();
    r.i32(); /* weight index */
    var ncases = r.i32();
    var bias = r.f64();
    var headBytes = r.bytes(9 + 8 + 64);
    r.skip(3);
    var rawFileLabel = headBytes.subarray(17, 81);

    var slots = [];          /* one entry per 8-byte slot */
    var vars = [];           /* real variables (not continuation slots) */
    var valueLabelSets = []; /* { labels: [[rawValueBytes, labelBytes]], slotIdx: [] } */
    var codepage = 0, encName = "";
    var longNames = "", veryLong = "", longLabelsRec = null, longMissRec = null;
    var sysmis = -1.7976931348623157e308, highest = 1.7976931348623157e308, lowest = -1.7976931348623155e308;
    var docs = [];

    for (;;) {
      var rt = r.i32();
      if (rt === 2) {
        var type = r.i32();
        var hasLabel = r.i32();
        var nMiss = r.i32();
        var printFmt = r.i32();
        r.i32(); /* write format */
        var nameBytes = r.bytes(8);
        var lab = null;
        if (hasLabel) {
          var ll = r.i32();
          if (ll < 0 || ll > 1048576) fail("a variable label has an impossible length");
          lab = r.bytes(ll);
          r.skip((4 - (ll % 4)) % 4);
        }
        var miss = [];
        var nm = Math.abs(nMiss);
        for (var mi = 0; mi < nm; mi++) miss.push(r.bytes(8));
        if (type === -1) { slots.push({ cont: true }); continue; }
        var v = {
          slot: slots.length, type: type, shortName: rtrim(ascii(nameBytes)),
          rawLabel: lab, nMiss: nMiss, rawMiss: miss, printFmt: printFmt
        };
        slots.push({ v: v });
        vars.push(v);
      } else if (rt === 3) {
        var cnt = r.i32();
        if (cnt < 0 || cnt > 10000000) fail("a value label set has an impossible size");
        var labs = [];
        for (var li = 0; li < cnt; li++) {
          var val = r.bytes(8);
          var lenb = r.u8v();
          var lb = r.bytes(lenb);
          r.skip((8 - ((lenb + 1) % 8)) % 8);
          labs.push([val, lb]);
        }
        var rt4 = r.i32();
        if (rt4 !== 4) fail("value labels are not followed by their variable list");
        var nv = r.i32();
        var idx = [];
        for (var vi = 0; vi < nv; vi++) idx.push(r.i32() - 1);
        valueLabelSets.push({ labels: labs, slotIdx: idx });
      } else if (rt === 6) {
        var nl = r.i32();
        for (var di = 0; di < nl; di++) docs.push(r.bytes(80));
      } else if (rt === 7) {
        var sub = r.i32();
        var size = r.i32();
        var count = r.i32();
        var len = size * count;
        if (len < 0) fail("an extension record has an impossible size");
        var start = r.p;
        if (sub === 3 && size === 4 && count >= 8) {
          r.p = start + 28;
          codepage = r.i32();
        } else if (sub === 4 && size === 8 && count >= 3) {
          r.p = start;
          sysmis = r.f64(); highest = r.f64(); lowest = r.f64();
        } else if (sub === 13) {
          longNames = ascii(u8.subarray(start, start + len));
        } else if (sub === 14) {
          veryLong = ascii(u8.subarray(start, start + len));
        } else if (sub === 20) {
          encName = ascii(u8.subarray(start, start + len)).replace(/\u0000/g, "").trim();
        } else if (sub === 21) {
          longLabelsRec = u8.subarray(start, start + len);
        } else if (sub === 22) {
          longMissRec = u8.subarray(start, start + len);
        }
        r.p = start;
        r.skip(len);
      } else if (rt === 999) {
        r.i32();
        break;
      } else {
        fail("unknown record type " + rt + " in the SPSS dictionary");
      }
    }

    var encLabel = encName ? encName.toLowerCase() : (CODEPAGES[codepage] || "windows-1252");
    if (encLabel === "ascii" || encLabel === "us-ascii") encLabel = "windows-1252";
    var dec = makeDecoder(encLabel);
    function text(b) { return rtrim(dec.decode(b)); }

    /* names */
    var longMap = {};
    if (longNames) {
      var pairs = dec.decode(toAsciiBytes(longNames)).split("\t");
      for (var pi = 0; pi < pairs.length; pi++) {
        var eq = pairs[pi].indexOf("=");
        if (eq > 0) longMap[pairs[pi].slice(0, eq).toUpperCase()] = pairs[pi].slice(eq + 1).replace(/\u0000/g, "");
      }
    }
    var veryLongMap = {};
    if (veryLong) {
      var vls = veryLong.split(/[\t\u0000]+/);
      for (var vj = 0; vj < vls.length; vj++) {
        var e2 = vls[vj].indexOf("=");
        if (e2 > 0) veryLongMap[vls[vj].slice(0, e2).toUpperCase()] = parseInt(vls[vj].slice(e2 + 1), 10);
      }
    }

    /* Fold very long string segments into their first variable. */
    var real = [];
    for (var k = 0; k < vars.length; k++) {
      var vv = vars[k];
      var width = veryLongMap[vv.shortName.toUpperCase()];
      if (width && vv.type > 0) {
        var nseg = Math.ceil(width / 252);
        vv.segments = [vv];
        for (var sgi = 1; sgi < nseg && k + 1 < vars.length; sgi++) { k++; vv.segments.push(vars[k]); }
        vv.width = width;
      } else if (vv.type > 0) {
        vv.width = vv.type;
        vv.segments = [vv];
      }
      real.push(vv);
    }

    var bySlot = {};
    var out = [];
    for (var a = 0; a < real.length; a++) {
      var rv = real[a];
      var isStr = rv.type > 0;
      var fmtType = (rv.printFmt >> 16) & 0xff;
      var kind = isStr ? "string" : SAV_DATE_FMT[fmtType] ? "date" : SAV_DATETIME_FMT[fmtType] ? "datetime" : SAV_TIME_FMT[fmtType] ? "time" : "number";
      var info = {
        name: longMap[rv.shortName.toUpperCase()] || rv.shortName,
        label: rv.rawLabel ? text(rv.rawLabel) : "",
        kind: kind,
        format: savFormatString(rv.printFmt),
        valueLabels: {},
        missing: { values: [], range: null },
        _sav: rv
      };
      var nmv = rv.nMiss;
      if (isStr) {
        for (var mq = 0; mq < rv.rawMiss.length; mq++) info.missing.values.push(rtrim(dec.decode(rv.rawMiss[mq])));
      } else if (nmv) {
        var mvals = [];
        for (var mr = 0; mr < rv.rawMiss.length; mr++) {
          mvals.push(new DataView(rv.rawMiss[mr].buffer, rv.rawMiss[mr].byteOffset, 8).getFloat64(0, little));
        }
        if (nmv < 0) {
          var lo = mvals[0] <= lowest ? -Infinity : mvals[0];
          var hi = mvals[1] >= highest ? Infinity : mvals[1];
          info.missing.range = [lo, hi];
          if (nmv === -3) info.missing.values.push(mvals[2]);
        } else {
          info.missing.values = mvals;
        }
      }
      bySlot[rv.slot] = info;
      out.push(info);
    }

    /* value labels (record 3/4) */
    for (var s = 0; s < valueLabelSets.length; s++) {
      var set = valueLabelSets[s];
      for (var si = 0; si < set.slotIdx.length; si++) {
        var target = bySlot[set.slotIdx[si]];
        if (!target) continue;
        for (var lj = 0; lj < set.labels.length; lj++) {
          var rawv = set.labels[lj][0];
          var key;
          if (target.kind === "string") key = rtrim(dec.decode(rawv));
          else key = numKey(new DataView(rawv.buffer, rawv.byteOffset, 8).getFloat64(0, little));
          target.valueLabels[key] = text(set.labels[lj][1]);
        }
      }
    }

    var byName = {};
    for (var bn = 0; bn < out.length; bn++) byName[out[bn].name.toUpperCase()] = out[bn];
    if (longLabelsRec) readSavLongLabels(longLabelsRec, little, dec, byName);
    if (longMissRec) readSavLongMissing(longMissRec, little, dec, byName);

    /* data */
    var dataBytes;
    var dataStart = r.p;
    if (compression === 2) {
      dataBytes = inflateZsav(u8, dataStart, little, opts);
    } else {
      dataBytes = u8.subarray(dataStart);
    }
    var rows = (compression === 0)
      ? savRowsRaw(dataBytes, nominal, ncases, little)
      : savRowsBytecode(dataBytes, nominal, ncases, bias, little, sysmis);

    var columns = [];
    for (var c = 0; c < out.length; c++) columns.push(out[c].name);
    var data = [];
    var blanked = 0;
    for (var ri = 0; ri < rows.length; ri++) {
      var row = rows[ri];
      var res = new Array(out.length);
      for (var cj = 0; cj < out.length; cj++) {
        var vi2 = out[cj];
        var sv = vi2._sav;
        var value;
        if (vi2.kind === "string") {
          var segs = sv.segments, parts = "";
          if (segs.length === 1) {
            parts = slotString(row, sv.slot, sv.width);
          } else {
            var chunks = [];
            /* Segments are declared ceil(width / 252) long, but each one
             * except the last carries 255 bytes of the value. */
            for (var g = 0; g < segs.length; g++) {
              var segW = g < segs.length - 1 ? 255 : Math.min(segs[g].type, sv.width - 255 * (segs.length - 1));
              if (segW > 0) chunks.push(slotBytes(row, segs[g].slot, segW));
            }
            parts = concatBytes(chunks);
          }
          value = rtrim(dec.decode(parts));
          if (value !== "" && vi2.missing.values.length && vi2.missing.values.indexOf(value) >= 0) { value = null; blanked++; }
          else if (value === "") value = "";
        } else {
          var num = row.nums[sv.slot];
          if (num === null || num === sysmis || num !== num) value = null;
          else if (isSavUserMissing(num, vi2.missing)) { value = null; blanked++; }
          else value = convertSavNumber(num, vi2.kind);
        }
        res[cj] = value;
      }
      data.push(res);
    }

    for (var z = 0; z < out.length; z++) delete out[z]._sav;
    return finish({
      format: compression === 2 ? "zsav" : "sav",
      version: magic === "$FL3" ? 3 : 2,
      fileLabel: text(rawFileLabel),
      encoding: dec.label,
      variables: out, columns: columns, data: data
    }, blanked);
  }

  function toAsciiBytes(s) {
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b;
  }

  function concatBytes(chunks) {
    var n = 0, i;
    for (i = 0; i < chunks.length; i++) n += chunks[i].length;
    var out = new Uint8Array(n), p = 0;
    for (i = 0; i < chunks.length; i++) { out.set(chunks[i], p); p += chunks[i].length; }
    return out;
  }

  /* Value label keys: JS writes 1 as "1" and 1.5 as "1.5". */
  function numKey(x) { return String(x); }

  function isSavUserMissing(x, m) {
    if (m.range && x >= m.range[0] && x <= m.range[1]) return true;
    for (var i = 0; i < m.values.length; i++) if (x === m.values[i]) return true;
    return false;
  }

  function convertSavNumber(x, kind) {
    if (kind === "date") return isoDate(SPSS_EPOCH_MS + Math.round(x * 1000));
    if (kind === "datetime") return isoDateTime(SPSS_EPOCH_MS + Math.round(x * 1000));
    if (kind === "time") return hms(x);
    return x;
  }

  function slotBytes(row, slot, width) {
    var nb = Math.ceil(width / 8) * 8;
    return row.bytes.subarray(slot * 8, slot * 8 + nb).subarray(0, width);
  }
  function slotString(row, slot, width) { return slotBytes(row, slot, width); }

  function savRowsRaw(bytes, nominal, ncases, little) {
    var rowLen = nominal * 8;
    var n = Math.floor(bytes.length / rowLen);
    if (ncases >= 0 && ncases < n) n = ncases;
    if (n * nominal > MAX_CELLS) fail("this file is too large to open on the phone");
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var rows = [];
    for (var i = 0; i < n; i++) {
      var b = bytes.subarray(i * rowLen, (i + 1) * rowLen);
      var nums = new Array(nominal);
      for (var j = 0; j < nominal; j++) nums[j] = dv.getFloat64(i * rowLen + j * 8, little);
      rows.push({ bytes: b, nums: nums });
    }
    return rows;
  }

  function savRowsBytecode(bytes, nominal, ncases, bias, little, sysmis) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var rows = [];
    var p = 0;
    var cmds = null, ci = 8;
    var rowLen = nominal * 8;
    var cur = null, curNums = null, k = 0;
    var spaces = [32, 32, 32, 32, 32, 32, 32, 32];
    var done = false;
    while (!done) {
      if (ncases >= 0 && rows.length >= ncases) break;
      if (ci >= 8) {
        if (p + 8 > bytes.length) break;
        cmds = bytes.subarray(p, p + 8);
        p += 8;
        ci = 0;
      }
      var code = cmds[ci++];
      if (code === 0) continue;
      if (!cur) {
        cur = new Uint8Array(rowLen);
        curNums = new Array(nominal);
        k = 0;
      }
      var at = k * 8;
      if (code === 252) { done = true; break; }
      if (code === 253) {
        if (p + 8 > bytes.length) { done = true; break; }
        cur.set(bytes.subarray(p, p + 8), at);
        curNums[k] = dv.getFloat64(p, little);
        p += 8;
      } else if (code === 254) {
        cur.set(spaces, at);
        curNums[k] = null;
      } else if (code === 255) {
        curNums[k] = sysmis;
        new DataView(cur.buffer).setFloat64(at, sysmis, little);
      } else {
        var val = code - bias;
        curNums[k] = val;
        new DataView(cur.buffer).setFloat64(at, val, little);
      }
      k++;
      if (k === nominal) {
        rows.push({ bytes: cur, nums: curNums });
        if (rows.length * nominal > MAX_CELLS) fail("this file is too large to open on the phone");
        cur = null;
      }
    }
    return rows;
  }

  function getInflate(opts) {
    if (opts && typeof opts.inflateSync === "function") return opts.inflateSync;
    if (G && G.fflate && typeof G.fflate.unzlibSync === "function") return function (b) { return G.fflate.unzlibSync(b); };
    if (typeof require === "function") {
      try {
        var zlib = require("zlib");
        return function (b) { var o = zlib.inflateSync(b); return new Uint8Array(o.buffer, o.byteOffset, o.byteLength); };
      } catch (e) { /* not in node */ }
    }
    return null;
  }

  function inflateZsav(u8, at, little, opts) {
    var inflate = getInflate(opts);
    if (!inflate) fail("this phone cannot open compressed .zsav files; save the file as .sav in SPSS and upload that");
    var r = new Reader(u8, little);
    r.p = at;
    r.u64(); /* zheader offset */
    var ztrailerOfs = r.u64();
    r.u64(); /* ztrailer length */
    r.p = ztrailerOfs;
    r.f64(); /* bias, stored as int64 in the spec; unused */
    r.u64();
    r.i32(); /* block size */
    var nblocks = r.i32();
    if (nblocks < 0 || nblocks > 1000000) fail("the .zsav block table looks damaged");
    var chunks = [];
    for (var i = 0; i < nblocks; i++) {
      r.u64(); /* uncompressed offset */
      var cofs = r.u64();
      r.i32(); /* uncompressed size */
      var csize = r.i32();
      if (cofs + csize > u8.length) fail("the file ends early; it may be damaged or not finished downloading");
      chunks.push(inflate(u8.subarray(cofs, cofs + csize)));
    }
    return concatBytes(chunks);
  }

  function readSavLongLabels(rec, little, dec, byName) {
    var r = new Reader(rec, little);
    while (r.p + 4 <= rec.length) {
      var nlen = r.i32();
      var name = rtrim(dec.decode(r.bytes(nlen)));
      r.i32(); /* width */
      var n = r.i32();
      var info = byName[name.toUpperCase()];
      for (var i = 0; i < n; i++) {
        var vlen = r.i32();
        var val = rtrim(dec.decode(r.bytes(vlen)));
        var llen = r.i32();
        var lab = rtrim(dec.decode(r.bytes(llen)));
        if (info) info.valueLabels[val] = lab;
      }
    }
  }

  function readSavLongMissing(rec, little, dec, byName) {
    var r = new Reader(rec, little);
    while (r.p + 4 <= rec.length) {
      var nlen = r.i32();
      var name = rtrim(dec.decode(r.bytes(nlen)));
      var n = r.u8v();
      var vlen = r.i32();
      var info = byName[name.toUpperCase()];
      for (var i = 0; i < n; i++) {
        var val = rtrim(dec.decode(r.bytes(vlen)));
        if (info) info.missing.values.push(val);
      }
    }
  }

  /* ======================================================================
   * Stata .dta
   * ==================================================================== */

  var DTA_MISS = { byte: 100, int: 32740, long: 2147483620, float: 1.7014117331926443e38, double: 8.98846567431158e307 };

  function dtaKind(fmt) {
    var f = String(fmt || "").replace(/^%-?/, "");
    if (/^td/.test(f) || /^d/.test(f)) return "date";
    if (/^t[cC]/.test(f)) return "datetime";
    return "number";
  }

  function readDta(u8, opts) {
    if (ascii(u8.subarray(0, 11)) === "<stata_dta>") return readDtaTagged(u8, opts);
    var release = u8[0];
    if (release < 111 || release > 115) {
      fail(release >= 102 && release <= 110
        ? "this Stata file is too old (release " + release + "); save it again in Stata 8 or later"
        : "this is not a Stata .dta file");
    }
    var little = u8[1] === 2;
    if (u8[1] !== 1 && u8[1] !== 2) fail("could not work out the byte order of this Stata file");
    var r = new Reader(u8, little);
    r.p = 4;
    var K = r.u16();
    var N = r.u32();
    var dec = makeGuessDecoder();
    var label = rtrim(dec.decode(cut0(r.bytes(81))));
    r.skip(18);
    var types = [];
    for (var i = 0; i < K; i++) types.push(r.u8v());
    var names = [];
    for (i = 0; i < K; i++) names.push(rtrim(dec.decode(cut0(r.bytes(33)))));
    r.skip((K + 1) * 2);
    var fmtLen = release >= 114 ? 49 : 12;
    var fmts = [];
    for (i = 0; i < K; i++) fmts.push(rtrim(dec.decode(cut0(r.bytes(fmtLen)))));
    var lblNames = [];
    for (i = 0; i < K; i++) lblNames.push(rtrim(dec.decode(cut0(r.bytes(33)))));
    var vlabels = [];
    for (i = 0; i < K; i++) vlabels.push(rtrim(dec.decode(cut0(r.bytes(81)))));
    for (;;) {
      var et = r.u8v();
      var elen = r.i32();
      if (et === 0 && elen === 0) break;
      r.skip(elen);
    }
    var cols = [];
    for (i = 0; i < K; i++) {
      var t = types[i];
      var spec;
      if (t >= 1 && t <= 244) spec = { str: t, size: t };
      else if (t === 251) spec = { num: "byte", size: 1 };
      else if (t === 252) spec = { num: "int", size: 2 };
      else if (t === 253) spec = { num: "long", size: 4 };
      else if (t === 254) spec = { num: "float", size: 4 };
      else if (t === 255) spec = { num: "double", size: 8 };
      else fail("unknown Stata variable type " + t);
      cols.push(spec);
    }
    var data = readDtaRows(r, cols, N, little, dec, null, 0);
    var tables = {};
    while (r.p + 4 <= u8.length) {
      var len = r.i32();
      if (r.p + 36 + len > u8.length) break;
      var lname = rtrim(dec.decode(cut0(r.bytes(33))));
      r.skip(3);
      tables[lname] = readDtaLabelTable(r.bytes(len), little, dec);
    }
    return buildDta(release, label, dec, names, vlabels, fmts, lblNames, cols, data, tables);
  }

  function readDtaLabelTable(b, little, dec) {
    var r = new Reader(b, little);
    var n = r.i32();
    var txtlen = r.i32();
    if (n < 0 || n > 10000000) fail("a Stata value label table looks damaged");
    var offs = [], vals = [], i;
    for (i = 0; i < n; i++) offs.push(r.i32());
    for (i = 0; i < n; i++) vals.push(r.i32());
    var txt = r.bytes(Math.max(0, Math.min(txtlen, b.length - r.p)));
    var out = {};
    for (i = 0; i < n; i++) {
      if (offs[i] < 0 || offs[i] >= txt.length) continue;
      out[String(vals[i])] = dec.decode(cut0(txt.subarray(offs[i])));
    }
    return out;
  }

  function readDtaRows(r, cols, N, little, dec, strls, release) {
    var K = cols.length;
    if (N * K > MAX_CELLS) fail("this file is too large to open on the phone");
    var rowLen = 0, i, j;
    for (j = 0; j < K; j++) rowLen += cols[j].size;
    r.need(rowLen * N);
    var dv = r.dv, base = r.p;
    var data = [];
    for (i = 0; i < N; i++) {
      var p = base + i * rowLen;
      var row = new Array(K);
      for (j = 0; j < K; j++) {
        var c = cols[j], v;
        if (c.str) {
          v = rtrim(dec.decode(cut0(r.u8.subarray(p, p + c.size))));
        } else if (c.strl) {
          var vkey, okey;
          if (release === 117) {
            vkey = dv.getUint32(p, little); okey = dv.getUint32(p + 4, little);
          } else {
            /* 118: v in 2 bytes, o in 6. 119: v in 3 bytes, o in 5. */
            var vb = release === 119 ? 3 : 2;
            vkey = uintN(r.u8, p, vb, little);
            okey = uintN(r.u8, p + vb, 8 - vb, little);
          }
          v = (vkey === 0 && okey === 0) ? "" : ((strls && strls[vkey + ":" + okey]) || "");
        } else if (c.num === "byte") {
          v = dv.getInt8(p); if (v > DTA_MISS.byte) v = null;
        } else if (c.num === "int") {
          v = dv.getInt16(p, little); if (v > DTA_MISS.int) v = null;
        } else if (c.num === "long") {
          v = dv.getInt32(p, little); if (v > DTA_MISS.long) v = null;
        } else if (c.num === "float") {
          v = dv.getFloat32(p, little);
          if (v !== v || v >= DTA_MISS.float) v = null; else v = float32ToShortest(v);
        } else {
          v = dv.getFloat64(p, little); if (v !== v || v >= DTA_MISS.double) v = null;
        }
        row[j] = v;
        p += c.size;
      }
      data.push(row);
    }
    r.p = base + rowLen * N;
    return data;
  }

  function uintN(u8, at, n, little) {
    var v = 0;
    for (var i = 0; i < n; i++) {
      var b = little ? u8[at + n - 1 - i] : u8[at + i];
      v = v * 256 + b;
    }
    return v;
  }

  /* A float32 read into JS becomes e.g. 2.299999952316284; write it as the
   * shortest decimal that rounds back to the same float32 ("2.3"). */
  var F32 = typeof Float32Array !== "undefined" ? new Float32Array(1) : null;
  function float32ToShortest(x) {
    if (!F32 || x === Math.floor(x)) return x;
    for (var d = 1; d <= 9; d++) {
      var y = Number(x.toPrecision(d));
      F32[0] = y;
      if (F32[0] === x) return y;
    }
    return x;
  }

  function buildDta(release, label, dec, names, vlabels, fmts, lblNames, cols, data, tables) {
    var vars = [];
    var K = names.length, j;
    for (j = 0; j < K; j++) {
      var kind = (cols[j].str || cols[j].strl) ? "string" : dtaKind(fmts[j]);
      var vl = (lblNames[j] && tables[lblNames[j]]) || {};
      vars.push({
        name: names[j], label: vlabels[j] || "", kind: kind, format: fmts[j],
        valueLabels: (cols[j].str || cols[j].strl) ? {} : copy(vl),
        missing: { values: [], range: null }
      });
    }
    for (var i = 0; i < data.length; i++) {
      for (j = 0; j < K; j++) {
        var v = data[i][j];
        if (v === null) continue;
        if (vars[j].kind === "date") {
          data[i][j] = isoDate(STATA_EPOCH_MS + Math.round(v) * DAY_MS);
        } else if (vars[j].kind === "datetime") {
          data[i][j] = isoDateTime(STATA_EPOCH_MS + Math.round(v));
        }
      }
    }
    return finish({
      format: "dta", version: release, fileLabel: label, encoding: dec.label,
      variables: vars, columns: names.slice(), data: data
    }, 0);
  }

  function copy(o) { var r = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }

  /* ---------- tagged .dta (117, 118, 119) ---------- */

  function findTag(u8, tag, from) {
    var t = toAsciiBytes(tag);
    outer: for (var i = from; i <= u8.length - t.length; i++) {
      for (var j = 0; j < t.length; j++) if (u8[i + j] !== t[j]) continue outer;
      return i;
    }
    return -1;
  }

  function expectTag(r, tag) {
    var t = toAsciiBytes(tag);
    r.need(t.length);
    for (var j = 0; j < t.length; j++) {
      if (r.u8[r.p + j] !== t[j]) fail("the Stata file is missing its " + tag + " section");
    }
    r.p += t.length;
  }

  function readDtaTagged(u8, opts) {
    var r = new Reader(u8, true);
    expectTag(r, "<stata_dta><header><release>");
    var release = parseInt(ascii(r.bytes(3)), 10);
    if (release !== 117 && release !== 118 && release !== 119) fail("Stata file release " + release + " is not supported yet");
    expectTag(r, "</release><byteorder>");
    var bo = ascii(r.bytes(3));
    r.le = bo === "LSF";
    if (bo !== "LSF" && bo !== "MSF") fail("could not work out the byte order of this Stata file");
    expectTag(r, "</byteorder><K>");
    var K = release === 119 ? r.u32() : r.u16();
    expectTag(r, "</K><N>");
    var N = release === 117 ? r.u32() : r.u64();
    expectTag(r, "</N><label>");
    var dec = release >= 118 ? makeDecoder("utf-8") : makeGuessDecoder();
    var llen = release === 117 ? r.u8v() : r.u16();
    var label = rtrim(dec.decode(r.bytes(llen)));
    expectTag(r, "</label><timestamp>");
    var tlen = r.u8v();
    r.skip(tlen);
    expectTag(r, "</timestamp></header><map>");
    var map = [];
    for (var m = 0; m < 14; m++) map.push(r.u64());
    var nameLen = release === 117 ? 33 : 129;
    var fmtLen = release === 117 ? 49 : 57;
    var vlabLen = release === 117 ? 81 : 321;

    r.p = map[2];
    expectTag(r, "<variable_types>");
    var cols = [], i;
    for (i = 0; i < K; i++) {
      var t = r.u16();
      if (t >= 1 && t <= 2045) cols.push({ str: t, size: t });
      else if (t === 32768) cols.push({ strl: true, size: 8 });
      else if (t === 65526) cols.push({ num: "double", size: 8 });
      else if (t === 65527) cols.push({ num: "float", size: 4 });
      else if (t === 65528) cols.push({ num: "long", size: 4 });
      else if (t === 65529) cols.push({ num: "int", size: 2 });
      else if (t === 65530) cols.push({ num: "byte", size: 1 });
      else fail("unknown Stata variable type " + t);
    }
    r.p = map[3];
    expectTag(r, "<varnames>");
    var names = [];
    for (i = 0; i < K; i++) names.push(rtrim(dec.decode(cut0(r.bytes(nameLen)))));
    r.p = map[5];
    expectTag(r, "<formats>");
    var fmts = [];
    for (i = 0; i < K; i++) fmts.push(rtrim(dec.decode(cut0(r.bytes(fmtLen)))));
    r.p = map[6];
    expectTag(r, "<value_label_names>");
    var lblNames = [];
    for (i = 0; i < K; i++) lblNames.push(rtrim(dec.decode(cut0(r.bytes(nameLen)))));
    r.p = map[7];
    expectTag(r, "<variable_labels>");
    var vlabels = [];
    for (i = 0; i < K; i++) vlabels.push(rtrim(dec.decode(cut0(r.bytes(vlabLen)))));

    /* strLs come after the data, so read them first. */
    var strls = {};
    r.p = map[10];
    expectTag(r, "<strls>");
    while (r.p + 3 <= u8.length && ascii(u8.subarray(r.p, r.p + 3)) === "GSO") {
      r.p += 3;
      var v = r.u32();
      var o = release === 117 ? r.u32() : r.u64();
      var gtype = r.u8v();
      var glen = r.u32();
      var body = r.bytes(glen);
      if (gtype === 130 && glen && body[glen - 1] === 0) body = body.subarray(0, glen - 1);
      strls[v + ":" + o] = gtype === 129 ? "" : dec.decode(body);
    }

    r.p = map[9];
    expectTag(r, "<data>");
    var data = readDtaRows(r, cols, N, r.le, dec, strls, release);

    var tables = {};
    r.p = map[11];
    expectTag(r, "<value_labels>");
    while (ascii(u8.subarray(r.p, r.p + 5)) === "<lbl>") {
      r.p += 5;
      var len = r.i32();
      var lname = rtrim(dec.decode(cut0(r.bytes(nameLen))));
      r.skip(3);
      tables[lname] = readDtaLabelTable(r.bytes(len), r.le, dec);
      expectTag(r, "</lbl>");
    }
    return buildDta(release, label, dec, names, vlabels, fmts, lblNames, cols, data, tables);
  }

  /* ======================================================================
   * Shared
   * ==================================================================== */

  function finish(res, blanked) {
    var labelled = 0, sets = 0;
    for (var i = 0; i < res.variables.length; i++) {
      if (res.variables[i].label) labelled++;
      for (var k in res.variables[i].valueLabels) { if (k) { sets++; break; } }
    }
    res.notes = { missingBlanked: blanked, labelledColumns: labelled, labelSets: sets };
    return res;
  }

  function sniff(u8, name) {
    var head = ascii(u8.subarray(0, 4));
    if (head === "$FL2" || head === "$FL3") return "sav";
    if (ascii(u8.subarray(0, 11)) === "<stata_dta>") return "dta";
    if (u8.length > 4 && u8[0] >= 111 && u8[0] <= 115 && (u8[1] === 1 || u8[1] === 2) && u8[2] === 1) return "dta";
    if (/\.z?sav$/i.test(name || "")) return "sav";
    if (/\.dta$/i.test(name || "")) return "dta";
    return "";
  }

  function read(buf, opts) {
    var u8 = toU8(buf);
    var kind = sniff(u8, opts && opts.name);
    if (kind === "sav") return readSav(u8, opts || {});
    if (kind === "dta") return readDta(u8, opts || {});
    fail("this is not an SPSS (.sav) or Stata (.dta) file");
  }

  function fmtNumber(x) {
    if (typeof x !== "number") return String(x);
    if (x === Math.floor(x) && Math.abs(x) < 1e21) return String(x);
    return String(Number(x.toPrecision(15)));
  }

  function toTable(res, opts) {
    var apply = !opts || opts.applyLabels !== false;
    var vars = res.variables, K = vars.length, j, i;
    var useLabels = [];
    for (j = 0; j < K; j++) {
      var vl = vars[j].valueLabels, has = false;
      for (var key in vl) { has = true; break; }
      var ok = apply && has;
      if (ok) {
        for (i = 0; i < res.data.length; i++) {
          var v = res.data[i][j];
          if (v === null || v === "") continue;
          if (!Object.prototype.hasOwnProperty.call(vl, typeof v === "number" ? numKey(v) : String(v))) { ok = false; break; }
        }
      }
      useLabels.push(ok);
    }
    var rows = [];
    for (i = 0; i < res.data.length; i++) {
      var src = res.data[i], row = new Array(K);
      for (j = 0; j < K; j++) {
        var x = src[j];
        if (x === null || x === "") row[j] = "";
        else if (useLabels[j]) row[j] = vars[j].valueLabels[typeof x === "number" ? numKey(x) : String(x)];
        else row[j] = fmtNumber(x);
      }
      rows.push(row);
    }
    var labelsUsed = 0;
    for (j = 0; j < K; j++) if (useLabels[j]) labelsUsed++;
    return { columns: res.columns.slice(), rows: rows, labelsApplied: labelsUsed };
  }

  function isStatFileName(name) { return /\.(z?sav|dta)$/i.test(name || ""); }

  var API = {
    version: "1.0.0",
    read: read,
    toTable: toTable,
    isStatFileName: isStatFileName,
    _internal: { sniff: sniff, hms: hms, isoDate: isoDate }
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = API; }
  if (G) { G.SMD_RESEARCH_STATFILE = API; }

})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : undefined));
