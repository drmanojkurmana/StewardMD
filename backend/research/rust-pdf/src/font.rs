//! Fonts, encodings and ToUnicode maps, following pdfminer.six's `pdffont.py`,
//! `cmapdb.py` and `encodingdb.py` so each character gets the same text and
//! width that pdfplumber reports.

use std::collections::HashMap;

use lopdf::{Dictionary, Document, Object};

use crate::pdfobj::{as_name, deref, dict_get, num, stream_data};
use crate::pslex::{ContentParser, Obj};
use crate::tables::{ENC_MACROMAN, ENC_PDFDOC, ENC_STANDARD, ENC_WINANSI, GLYPHS, STD14};

/// Something pdfminer does that this reader does not copy. The caller falls
/// back to the Python reader for the whole document.
#[derive(Debug, Clone)]
pub struct Unsupported(pub &'static str);

// ---------------------------------------------------------------- glyph names

fn glyph_lookup(name: &str) -> Option<&'static str> {
    GLYPHS.binary_search_by(|(k, _)| (*k).cmp(name)).ok().map(|i| GLYPHS[i].1)
}

fn valid_cp(v: u32) -> Option<char> {
    if (0xD800..0xE000).contains(&v) {
        return None;
    }
    char::from_u32(v)
}

/// pdfminer `name2unicode`. `None` where pdfminer raises KeyError/ValueError.
pub fn name2unicode(name: &str) -> Option<String> {
    let name = name.split('.').next().unwrap_or("");
    let comps: Vec<&str> = name.split('_').collect();
    if comps.len() > 1 {
        let mut out = String::new();
        for c in comps {
            out.push_str(&name2unicode(c)?);
        }
        return Some(out);
    }
    if let Some(v) = glyph_lookup(name) {
        return Some(v.to_string());
    }
    let is_hex_prefix = |s: &str| s.bytes().next().is_some_and(|b| b.is_ascii_hexdigit());
    if name.starts_with("uni") {
        let rest = name.trim_matches(|c| c == 'u' || c == 'n' || c == 'i');
        if is_hex_prefix(rest) && rest.len() % 4 == 0 {
            let mut out = String::new();
            for i in (0..rest.len()).step_by(4) {
                let v = u32::from_str_radix(rest.get(i..i + 4)?, 16).ok()?;
                out.push(valid_cp(v)?);
            }
            return Some(out);
        }
    } else if name.starts_with('u') {
        let rest = name.trim_matches('u');
        if is_hex_prefix(rest) && (4..=6).contains(&rest.len()) {
            let v = u32::from_str_radix(rest, 16).ok()?;
            return valid_cp(v).map(|c| c.to_string());
        }
    }
    None
}

fn encoding_table(name: &[u8]) -> &'static [&'static str; 256] {
    match name {
        b"MacRomanEncoding" => &ENC_MACROMAN,
        b"WinAnsiEncoding" => &ENC_WINANSI,
        b"PDFDocEncoding" => &ENC_PDFDOC,
        _ => &ENC_STANDARD,
    }
}

fn table_map(t: &'static [&'static str; 256]) -> HashMap<u32, String> {
    let mut m = HashMap::with_capacity(256);
    for (i, s) in t.iter().enumerate() {
        if !s.is_empty() {
            m.insert(i as u32, (*s).to_string());
        }
    }
    m
}

// ---------------------------------------------------------------- CMaps

fn nunpack(b: &[u8]) -> u64 {
    b.iter().fold(0u64, |a, &x| a.wrapping_shl(8) | x as u64)
}

fn utf16be(b: &[u8]) -> String {
    let units = b.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]]));
    char::decode_utf16(units).filter_map(Result::ok).collect()
}

pub enum UMap {
    File(HashMap<u32, String>),
    Identity,
}

impl UMap {
    fn get(&self, cid: u32) -> Option<String> {
        match self {
            UMap::File(m) => m.get(&cid).cloned(),
            UMap::Identity => char::from_u32(cid).map(|c| c.to_string()),
        }
    }
}

fn add_cid2unichr(m: &mut HashMap<u32, String>, cid: u64, code: &Obj) -> Result<(), Unsupported> {
    let u = match code {
        Obj::Name(n) => match name2unicode(&String::from_utf8_lossy(n)) {
            Some(u) => u,
            None => return Err(Unsupported("tounicode_glyph_name")),
        },
        Obj::Str(b) => utf16be(b),
        Obj::Int(i) => match char::from_u32(*i as u32) {
            Some(c) => c.to_string(),
            None => return Err(Unsupported("tounicode_int")),
        },
        _ => return Err(Unsupported("tounicode_value")),
    };
    if cid > u32::MAX as u64 {
        return Ok(());
    }
    let cid = cid as u32;
    if u == "\u{a0}" && m.get(&cid).map(|s| s.as_str()) == Some(" ") {
        return Ok(());
    }
    m.insert(cid, u);
    Ok(())
}

/// pdfminer `CMapParser` run over a ToUnicode stream.
pub fn parse_tounicode(data: &[u8]) -> Result<HashMap<u32, String>, Unsupported> {
    let mut m: HashMap<u32, String> = HashMap::new();
    let mut p = ContentParser::new_plain(data);
    let mut stack: Vec<Obj> = Vec::new();
    let mut in_cmap = true;
    while let Some(o) = p.next_obj() {
        let kw = match o {
            Obj::Kw(k) => k,
            other => {
                stack.push(other);
                continue;
            }
        };
        match kw.as_slice() {
            b"begincmap" => {
                in_cmap = true;
                stack.clear();
                continue;
            }
            b"endcmap" => {
                in_cmap = false;
                continue;
            }
            _ => {}
        }
        if !in_cmap {
            continue;
        }
        match kw.as_slice() {
            b"def" => {
                let n = stack.len().min(2);
                stack.truncate(stack.len() - n);
            }
            b"usecmap" => {
                if !stack.is_empty() {
                    stack.pop();
                }
                return Err(Unsupported("tounicode_usecmap"));
            }
            b"begincodespacerange" | b"endcodespacerange" | b"begincidrange" | b"begincidchar" | b"beginbfrange"
            | b"beginbfchar" | b"beginnotdefrange" | b"endnotdefrange" => stack.clear(),
            b"endcidrange" => {
                let objs = std::mem::take(&mut stack);
                for ch in objs.chunks_exact(3) {
                    if let (Obj::Str(s), Obj::Str(e), Obj::Int(cid)) = (&ch[0], &ch[1], &ch[2]) {
                        if s.len() != e.len() {
                            continue;
                        }
                        let sp = &s[..s.len().saturating_sub(4)];
                        let ep = &e[..e.len().saturating_sub(4)];
                        if sp != ep {
                            continue;
                        }
                        let sv = &s[s.len().saturating_sub(4)..];
                        let ev = &e[e.len().saturating_sub(4)..];
                        let (st, en) = (nunpack(sv), nunpack(ev));
                        let vlen = sv.len();
                        let mut i = 0u64;
                        while st + i <= en {
                            let v = ((st + i) as u32).to_be_bytes();
                            let mut x = sp.to_vec();
                            x.extend_from_slice(&v[4 - vlen..]);
                            add_cid2unichr(&mut m, *cid as u64 + i, &Obj::Str(x))?;
                            i += 1;
                            if i > 1 << 20 {
                                return Err(Unsupported("cmap_range_size"));
                            }
                        }
                    }
                }
            }
            b"endcidchar" => {
                let objs = std::mem::take(&mut stack);
                for ch in objs.chunks_exact(2) {
                    if let (Obj::Int(cid), Obj::Str(_)) = (&ch[0], &ch[1]) {
                        add_cid2unichr(&mut m, *cid as u64, &ch[1])?;
                    }
                }
            }
            b"endbfrange" => {
                let objs = std::mem::take(&mut stack);
                for ch in objs.chunks_exact(3) {
                    let (s, e) = match (&ch[0], &ch[1]) {
                        (Obj::Str(s), Obj::Str(e)) if s.len() == e.len() => (s, e),
                        _ => continue,
                    };
                    let (st, en) = (nunpack(s), nunpack(e));
                    if en >= st && en - st > 1 << 20 {
                        return Err(Unsupported("cmap_range_size"));
                    }
                    match &ch[2] {
                        Obj::Arr(list) => {
                            for (k, v) in (st..=en).zip(list.iter()) {
                                add_cid2unichr(&mut m, k, v)?;
                            }
                        }
                        Obj::Str(code) => {
                            let var = &code[code.len().saturating_sub(4)..];
                            let base = nunpack(var);
                            let prefix = &code[..code.len() - var.len()];
                            let vlen = var.len();
                            let mut i = 0u64;
                            while st + i <= en {
                                let v = ((base + i) as u32).to_be_bytes();
                                let mut x = prefix.to_vec();
                                x.extend_from_slice(&v[4 - vlen..]);
                                add_cid2unichr(&mut m, st + i, &Obj::Str(x))?;
                                i += 1;
                            }
                        }
                        _ => return Err(Unsupported("tounicode_bfrange_value")),
                    }
                }
            }
            b"endbfchar" => {
                let objs = std::mem::take(&mut stack);
                for ch in objs.chunks_exact(2) {
                    if let (Obj::Str(c), Obj::Str(_)) = (&ch[0], &ch[1]) {
                        add_cid2unichr(&mut m, nunpack(c), &ch[1])?;
                    }
                }
            }
            _ => stack.push(Obj::Kw(kw)),
        }
    }
    Ok(m)
}

/// pdfminer `Type1FontHeaderParser`: `dup <code> /<glyph> put` in the clear
/// text part of an embedded Type 1 font.
fn type1_encoding(data: &[u8]) -> HashMap<u32, String> {
    let mut out = HashMap::new();
    let mut p = ContentParser::new_plain(data);
    let mut stack: Vec<Obj> = Vec::new();
    while let Some(o) = p.next_obj() {
        match o {
            Obj::Kw(k) => {
                if k == b"put" && stack.len() >= 2 {
                    let v = stack.pop().unwrap();
                    let key = stack.pop().unwrap();
                    if let (Obj::Int(c), Obj::Name(n)) = (key, v) {
                        if let Some(u) = name2unicode(&String::from_utf8_lossy(&n)) {
                            if c >= 0 {
                                out.insert(c as u32, u);
                            }
                        }
                    }
                }
            }
            other => stack.push(other),
        }
    }
    out
}

// ---------------------------------------------------------------- fonts

#[derive(Clone, Copy, PartialEq)]
pub enum Decoder {
    Byte,
    Identity2,
    Empty,
}

pub struct Font {
    pub multibyte: bool,
    pub decoder: Decoder,
    widths: HashMap<i64, f64>,
    std_widths: Option<HashMap<&'static str, f64>>,
    default_width: f64,
    pub hscale: f64,
    pub vscale: f64,
    descent: f64,
    umap: Option<UMap>,
    cid2unicode: Option<HashMap<u32, String>>,
    /// Bold or heavier, from the font's name or its descriptor. Only the
    /// stream-order lines use it (chapter headings in a thesis); the pdfminer
    /// word and table output is unchanged.
    pub bold: bool,
}

fn int_key(o: &Object, doc: &Document) -> Option<i64> {
    match deref(doc, o) {
        Object::Integer(i) => Some(*i),
        Object::Real(r) => {
            let f = crate::pdfobj::f32d(*r);
            if f.fract() == 0.0 {
                Some(f as i64)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// pdfminer `get_widths` for a CID font's /W array.
fn cid_widths(doc: &Document, seq: &[Object]) -> HashMap<i64, f64> {
    let mut widths = HashMap::new();
    let mut r: Vec<&Object> = Vec::new();
    for v in seq {
        let v = deref(doc, v);
        match v {
            Object::Array(list) => {
                if let Some(c1) = r.last() {
                    if let Some(c1) = int_key(c1, doc) {
                        for (i, w) in list.iter().enumerate() {
                            if let Some(w) = num(doc, w) {
                                widths.insert(c1 + i as i64, w);
                            }
                        }
                    }
                    r.clear();
                }
            }
            Object::Integer(_) | Object::Real(_) => {
                r.push(v);
                if r.len() == 3 {
                    if let (Object::Integer(a), Object::Integer(b)) = (r[0], r[1]) {
                        if let Some(w) = num(doc, r[2]) {
                            if b - a <= 1 << 20 {
                                for i in *a..=*b {
                                    widths.insert(i, w);
                                }
                            }
                        }
                    }
                    r.clear();
                }
            }
            _ => {}
        }
    }
    widths
}

fn bbox_of(doc: &Document, desc: Option<&Dictionary>) -> [f64; 4] {
    let arr = desc.and_then(|d| dict_get(doc, d, b"FontBBox")).and_then(|o| o.as_array().ok());
    if let Some(a) = arr {
        if a.len() >= 4 {
            let v: Vec<Option<f64>> = a.iter().take(4).map(|o| num(doc, o)).collect();
            if v.iter().all(|x| x.is_some()) {
                return [v[0].unwrap(), v[1].unwrap(), v[2].unwrap(), v[3].unwrap()];
            }
        }
    }
    [0.0; 4]
}

/// Bold, Black, Heavy, Semibold or Demi in the font name (after any subset
/// tag such as "ABCDEF+"), the descriptor's ForceBold flag, or a FontWeight
/// of 600 or more.
pub fn bold_name(name: &[u8]) -> bool {
    let s = String::from_utf8_lossy(name).to_ascii_lowercase();
    let s = match s.find('+') {
        Some(i) if i == 6 => &s[7..],
        _ => &s[..],
    };
    ["bold", "black", "heavy", "semibold", "demi", "extrab", "ultrab"].iter().any(|k| s.contains(k))
}

fn is_bold(doc: &Document, spec: &Dictionary) -> bool {
    if let Some(n) = dict_get(doc, spec, b"BaseFont").and_then(as_name) {
        if bold_name(n) {
            return true;
        }
    }
    let desc = dict_get(doc, spec, b"FontDescriptor").and_then(|o| o.as_dict().ok());
    if let Some(d) = desc {
        if let Some(n) = dict_get(doc, d, b"FontName").and_then(as_name) {
            if bold_name(n) {
                return true;
            }
        }
        let flags = dict_get(doc, d, b"Flags").and_then(|o| num(doc, o)).unwrap_or(0.0) as i64;
        if flags & (1 << 18) != 0 {
            return true;
        }
        if dict_get(doc, d, b"FontWeight").and_then(|o| num(doc, o)).unwrap_or(0.0) >= 600.0 {
            return true;
        }
    }
    false
}

fn desc_num(doc: &Document, desc: Option<&Dictionary>, key: &[u8]) -> f64 {
    desc.and_then(|d| dict_get(doc, d, key)).and_then(|o| num(doc, o)).unwrap_or(0.0)
}

fn simple_widths(doc: &Document, spec: &Dictionary) -> HashMap<i64, f64> {
    let first = dict_get(doc, spec, b"FirstChar").and_then(|o| int_key(o, doc)).unwrap_or(0);
    let mut widths = HashMap::new();
    match dict_get(doc, spec, b"Widths").and_then(|o| o.as_array().ok()) {
        Some(list) => {
            for (i, w) in list.iter().enumerate() {
                if let Some(w) = num(doc, w) {
                    widths.insert(first + i as i64, w);
                }
            }
        }
        None => {
            for i in 0..256 {
                widths.insert(first + i, 0.0);
            }
        }
    }
    widths
}

fn simple_encoding(doc: &Document, spec: &Dictionary, subtype: &[u8]) -> HashMap<u32, String> {
    let default: &[u8] = if subtype == b"TrueType" { b"WinAnsiEncoding" } else { b"StandardEncoding" };
    match dict_get(doc, spec, b"Encoding") {
        None => table_map(encoding_table(default)),
        Some(Object::Dictionary(d)) => {
            let base = dict_get(doc, d, b"BaseEncoding").and_then(as_name).unwrap_or(default);
            let mut m = table_map(encoding_table(base));
            if let Some(diff) = dict_get(doc, d, b"Differences").and_then(|o| o.as_array().ok()) {
                let mut cid: i64 = 0;
                for x in diff {
                    match deref(doc, x) {
                        Object::Integer(i) => cid = *i,
                        Object::Name(n) => {
                            if let Some(u) = name2unicode(&String::from_utf8_lossy(n)) {
                                if cid >= 0 {
                                    m.insert(cid as u32, u);
                                }
                            }
                            cid += 1;
                        }
                        _ => {}
                    }
                }
            }
            m
        }
        Some(o) => match as_name(o) {
            Some(n) => table_map(encoding_table(n)),
            None => table_map(&ENC_STANDARD),
        },
    }
}

fn tounicode_of(doc: &Document, spec: &Dictionary) -> Result<Option<UMap>, Unsupported> {
    match spec.get(b"ToUnicode").ok().map(|o| deref(doc, o)) {
        Some(Object::Stream(s)) => {
            let data = stream_data(s).ok_or(Unsupported("tounicode_stream"))?;
            Ok(Some(UMap::File(parse_tounicode(&data)?)))
        }
        _ => Ok(None),
    }
}

fn find_std14(name: &[u8]) -> Option<&'static crate::tables::Std14> {
    let n = std::str::from_utf8(name).ok()?;
    STD14.iter().find(|f| f.name == n)
}

impl Font {
    pub fn char_width(&self, cid: u32) -> f64 {
        if let Some(w) = self.widths.get(&(cid as i64)) {
            return w * self.hscale;
        }
        if let Some(sw) = &self.std_widths {
            if let Some(u) = self.to_unichr(cid) {
                if let Some(w) = sw.get(u.as_str()) {
                    return w * self.hscale;
                }
            }
        }
        self.default_width * self.hscale
    }

    pub fn get_descent(&self) -> f64 {
        self.descent * self.vscale
    }

    pub fn to_unichr(&self, cid: u32) -> Option<String> {
        if let Some(u) = &self.umap {
            if let Some(s) = u.get(cid) {
                return Some(s);
            }
            if self.multibyte {
                return None;
            }
        }
        self.cid2unicode.as_ref().and_then(|m| m.get(&cid).cloned())
    }

    pub fn decode(&self, s: &[u8], out: &mut Vec<u32>) {
        out.clear();
        match self.decoder {
            Decoder::Byte => out.extend(s.iter().map(|&b| b as u32)),
            Decoder::Identity2 => out.extend(s.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]]) as u32)),
            Decoder::Empty => {}
        }
    }

    /// pdfminer `PDFResourceManager.get_font`, plus the bold flag.
    pub fn load(doc: &Document, spec: &Dictionary) -> Result<Font, Unsupported> {
        let mut f = Self::load_inner(doc, spec)?;
        f.bold = f.bold || is_bold(doc, spec);
        Ok(f)
    }

    fn load_inner(doc: &Document, spec: &Dictionary) -> Result<Font, Unsupported> {
        let subtype: Vec<u8> = dict_get(doc, spec, b"Subtype").and_then(as_name).unwrap_or(b"Type1").to_vec();
        match subtype.as_slice() {
            b"Type3" => Self::load_type3(doc, spec),
            b"CIDFontType0" | b"CIDFontType2" => Self::load_cid(doc, spec),
            b"Type0" => {
                let dfonts = dict_get(doc, spec, b"DescendantFonts")
                    .and_then(|o| o.as_array().ok())
                    .ok_or(Unsupported("type0_no_descendant"))?;
                let first = dfonts.first().map(|o| deref(doc, o)).ok_or(Unsupported("type0_no_descendant"))?;
                let mut sub = first.as_dict().map_err(|_| Unsupported("type0_descendant"))?.clone();
                for k in [&b"Encoding"[..], &b"ToUnicode"[..]] {
                    if let Ok(v) = spec.get(k) {
                        sub.set(k.to_vec(), deref(doc, v).clone());
                    }
                }
                Self::load(doc, &sub)
            }
            _ => Self::load_type1(doc, spec, &subtype),
        }
    }

    fn load_type1(doc: &Document, spec: &Dictionary, subtype: &[u8]) -> Result<Font, Unsupported> {
        let basefont = dict_get(doc, spec, b"BaseFont").and_then(as_name).unwrap_or(b"unknown");
        let std = find_std14(basefont);
        let pdf_desc = dict_get(doc, spec, b"FontDescriptor").and_then(|o| o.as_dict().ok());
        let (widths, std_widths, descent, default_width) = match std {
            Some(f) => (HashMap::new(), Some(f.widths.iter().copied().collect()), f.descent, 0.0),
            None => (
                simple_widths(doc, spec),
                None,
                desc_num(doc, pdf_desc, b"Descent"),
                desc_num(doc, pdf_desc, b"MissingWidth"),
            ),
        };
        let mut cid2unicode = simple_encoding(doc, spec, subtype);
        let umap = tounicode_of(doc, spec)?;
        if std.is_none() && spec.get(b"Encoding").is_err() {
            if let Some(Object::Stream(ff)) = pdf_desc.and_then(|d| d.get(b"FontFile").ok()).map(|o| deref(doc, o)) {
                let len1 = ff.dict.get(b"Length1").ok().and_then(|o| int_key(o, doc)).unwrap_or(0).max(0) as usize;
                if let Some(data) = stream_data(ff) {
                    cid2unicode = type1_encoding(&data[..len1.min(data.len())]);
                }
            }
        }
        Ok(Font {
            multibyte: false,
            decoder: Decoder::Byte,
            widths,
            std_widths,
            default_width,
            hscale: 0.001,
            vscale: 0.001,
            descent: if descent > 0.0 { -descent } else { descent },
            umap,
            cid2unicode: Some(cid2unicode),
            bold: false,
        })
    }

    fn load_type3(doc: &Document, spec: &Dictionary) -> Result<Font, Unsupported> {
        let widths = simple_widths(doc, spec);
        let desc = dict_get(doc, spec, b"FontDescriptor").and_then(|o| o.as_dict().ok());
        let bbox = match desc {
            Some(_) => bbox_of(doc, desc),
            None => {
                let mut d = Dictionary::new();
                if let Ok(b) = spec.get(b"FontBBox") {
                    d.set("FontBBox", deref(doc, b).clone());
                }
                bbox_of(doc, Some(&d))
            }
        };
        let default_width = desc_num(doc, desc, b"MissingWidth");
        let cid2unicode = simple_encoding(doc, spec, b"Type3");
        let umap = tounicode_of(doc, spec)?;
        let m = dict_get(doc, spec, b"FontMatrix")
            .and_then(|o| o.as_array().ok())
            .ok_or(Unsupported("type3_matrix"))?;
        let mv: Vec<f64> = m.iter().filter_map(|o| num(doc, o)).collect();
        if mv.len() != 6 {
            return Err(Unsupported("type3_matrix"));
        }
        Ok(Font {
            multibyte: false,
            decoder: Decoder::Byte,
            widths,
            std_widths: None,
            default_width,
            hscale: mv[0] + mv[2],
            vscale: mv[1] + mv[3],
            descent: bbox[1],
            umap,
            cid2unicode: Some(cid2unicode),
            bold: false,
        })
    }

    fn load_cid(doc: &Document, spec: &Dictionary) -> Result<Font, Unsupported> {
        let sysinfo = dict_get(doc, spec, b"CIDSystemInfo").and_then(|o| o.as_dict().ok());
        let field = |k: &[u8]| -> String {
            sysinfo
                .and_then(|d| dict_get(doc, d, k))
                .and_then(|o| o.as_str().ok())
                .map(|b| b.iter().map(|&c| c as char).collect::<String>())
                .unwrap_or_else(|| "unknown".to_string())
        };
        let (registry, ordering) = (field(b"Registry"), field(b"Ordering"));
        let cidcoding = format!("{}-{}", registry.trim(), ordering.trim());

        let enc = spec.get(b"Encoding").ok().map(|o| deref(doc, o));
        let cmap_name: Vec<u8> = match enc {
            None => b"unknown".to_vec(),
            Some(Object::Name(n)) => n.clone(),
            Some(Object::Dictionary(d)) => dict_get(doc, d, b"CMapName").and_then(as_name).unwrap_or(b"unknown").to_vec(),
            Some(Object::Stream(s)) => dict_get(doc, &s.dict, b"CMapName").and_then(as_name).unwrap_or(b"unknown").to_vec(),
            Some(_) => return Err(Unsupported("cid_encoding")),
        };
        let cmap_name: &[u8] = match cmap_name.as_slice() {
            b"DLIdent-H" => b"Identity-H",
            b"DLIdent-V" => b"Identity-V",
            n => n,
        };
        let decoder = match cmap_name {
            b"Identity-H" => Decoder::Identity2,
            b"OneByteIdentityH" => Decoder::Byte,
            b"Identity-V" | b"OneByteIdentityV" => return Err(Unsupported("vertical_font")),
            n => {
                let n = String::from_utf8_lossy(n);
                if crate::tables_cmap::PREDEFINED_CMAPS.contains(&n.as_ref()) {
                    return Err(Unsupported("predefined_cmap"));
                }
                Decoder::Empty
            }
        };

        let desc = dict_get(doc, spec, b"FontDescriptor").and_then(|o| o.as_dict().ok());
        let has_ttf = desc.is_some_and(|d| d.get(b"FontFile2").is_ok());
        let umap = match spec.get(b"ToUnicode").ok().map(|o| deref(doc, o)) {
            Some(Object::Stream(_)) => tounicode_of(doc, spec)?,
            Some(o) => {
                let tname = as_name(o).map(|n| String::from_utf8_lossy(n).to_string()).unwrap_or_default();
                let ename = enc.and_then(as_name).map(|n| String::from_utf8_lossy(n).to_string()).unwrap_or_default();
                if ordering.contains("Identity") || tname.contains("Identity") || ename.contains("Identity") {
                    Some(UMap::Identity)
                } else {
                    None
                }
            }
            None => {
                if cidcoding == "Adobe-Identity" || cidcoding == "Adobe-UCS" {
                    if has_ttf {
                        return Err(Unsupported("truetype_cmap"));
                    }
                    None
                } else if ["Adobe-CNS1", "Adobe-GB1", "Adobe-Japan1", "Adobe-Korea1"].contains(&cidcoding.as_str()) {
                    return Err(Unsupported("predefined_unicode_map"));
                } else {
                    None
                }
            }
        };
        let widths = match dict_get(doc, spec, b"W").and_then(|o| o.as_array().ok()) {
            Some(w) => cid_widths(doc, w),
            None => HashMap::new(),
        };
        let default_width = match spec.get(b"DW") {
            Ok(o) => num(doc, o).unwrap_or(0.0),
            Err(_) => 1000.0,
        };
        let descent = desc_num(doc, desc, b"Descent");
        Ok(Font {
            multibyte: true,
            decoder,
            widths,
            std_widths: None,
            default_width,
            hscale: 0.001,
            vscale: 0.001,
            descent: if descent > 0.0 { -descent } else { descent },
            umap,
            cid2unicode: None,
            bold: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glyph_names() {
        assert_eq!(name2unicode("A").as_deref(), Some("A"));
        assert_eq!(name2unicode("uni00E9").as_deref(), Some("\u{e9}"));
        assert_eq!(name2unicode("u1F600").as_deref(), Some("\u{1F600}"));
        assert_eq!(name2unicode("f_i").as_deref(), Some("fi"));
        assert_eq!(name2unicode("A.sc").as_deref(), Some("A"));
        assert_eq!(name2unicode("g123"), None);
    }

    #[test]
    fn tounicode_ranges() {
        let cm = b"/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n\
            1 begincodespacerange <0000> <FFFF> endcodespacerange\n\
            2 beginbfchar <0003> <0020> <0011> <00660069> endbfchar\n\
            1 beginbfrange <0024> <0026> <0041> endbfrange\n\
            1 beginbfrange <0030> <0031> [<0061> <0062>] endbfrange\n\
            endcmap CMapName currentdict /CMap defineresource pop end end";
        let m = parse_tounicode(cm).unwrap();
        assert_eq!(m[&3], " ");
        assert_eq!(m[&0x11], "fi");
        assert_eq!(m[&0x25], "B");
        assert_eq!(m[&0x31], "b");
    }
}
