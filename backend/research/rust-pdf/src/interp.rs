//! Page content interpreter: the text part of pdfminer.six's
//! `PDFPageInterpreter`, `PDFTextDevice.render_string_horizontal` and `LTChar`,
//! producing the same characters (text, box, matrix, advance) in the same
//! order. Arithmetic follows pdfminer's operation order.

use std::collections::HashMap;
use std::rc::Rc;

use lopdf::{Dictionary, Document, Object, ObjectId};

use crate::font::{Font, Unsupported};
use crate::pdfobj::{as_name, deref, dict_get, num, stream_data};
use crate::pslex::{ContentParser, Obj};

pub type M = [f64; 6];
pub const IDENT: M = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

#[inline]
pub fn mult(m1: &M, m0: &M) -> M {
    let [a1, b1, c1, d1, e1, f1] = *m1;
    let [a0, b0, c0, d0, e0, f0] = *m0;
    [
        a0 * a1 + c0 * b1,
        b0 * a1 + d0 * b1,
        a0 * c1 + c0 * d1,
        b0 * c1 + d0 * d1,
        a0 * e1 + c0 * f1 + e0,
        b0 * e1 + d0 * f1 + f0,
    ]
}

#[inline]
fn translate(m: &M, x: f64, y: f64) -> M {
    let [a, b, c, d, e, f] = *m;
    [a, b, c, d, x * a + y * c + e, x * b + y * d + f]
}

#[inline]
pub fn apply_pt(m: &M, x: f64, y: f64) -> (f64, f64) {
    let [a, b, c, d, e, f] = *m;
    (a * x + c * y + e, b * x + d * y + f)
}

pub fn apply_rect(m: &M, r: (f64, f64, f64, f64)) -> (f64, f64, f64, f64) {
    let (x0, y0, x1, y1) = r;
    let (l1, b1) = apply_pt(m, x0, y0);
    let (r1, b2) = apply_pt(m, x1, y0);
    let (r2, t1) = apply_pt(m, x1, y1);
    let (l2, t2) = apply_pt(m, x0, y1);
    (
        pymin4(l1, l2, r1, r2),
        pymin4(b1, b2, t1, t2),
        pymax4(l1, l2, r1, r2),
        pymax4(b1, b2, t1, t2),
    )
}

// Python min()/max() keep the first of equal values; matters only for -0.0.
#[inline]
fn pymin4(a: f64, b: f64, c: f64, d: f64) -> f64 {
    let mut m = a;
    for v in [b, c, d] {
        if v < m {
            m = v;
        }
    }
    m
}
#[inline]
fn pymax4(a: f64, b: f64, c: f64, d: f64) -> f64 {
    let mut m = a;
    for v in [b, c, d] {
        if v > m {
            m = v;
        }
    }
    m
}

/// One character as pdfminer's `LTChar` (PDF user space, y up).
#[derive(Debug, Clone)]
pub struct Char {
    pub text: Rc<str>,
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
    pub upright: bool,
    pub size: f64,
    pub matrix: M,
    pub adv: f64,
    /// Font size (Tf), for the stream-order lines PrepNucleus reads.
    pub fs: f64,
    /// Set in a bold font, for the stream-order lines.
    pub bold: bool,
}

#[derive(Clone)]
struct TextState {
    font: Option<Rc<Font>>,
    fontsize: f64,
    charspace: f64,
    wordspace: f64,
    scaling: f64,
    leading: f64,
    rise: f64,
    matrix: M,
    linematrix: (f64, f64),
}

impl TextState {
    fn new() -> Self {
        TextState {
            font: None,
            fontsize: 0.0,
            charspace: 0.0,
            wordspace: 0.0,
            scaling: 100.0,
            leading: 0.0,
            rise: 0.0,
            matrix: IDENT,
            linematrix: (0.0, 0.0),
        }
    }
}

/// Number of operands pdfminer pops for each operator it knows.
fn nargs(op: &[u8]) -> Option<usize> {
    Some(match op {
        b"B" | b"BI" | b"BT" | b"BX" | b"B*" | b"EMC" | b"ET" | b"EX" | b"F" | b"ID" | b"Q" | b"S" | b"SC"
        | b"SCN" | b"T*" | b"W" | b"W*" | b"b" | b"b*" | b"f" | b"f*" | b"h" | b"n" | b"q" | b"s" | b"sc"
        | b"scn" => 0,
        b"BMC" | b"CS" | b"Do" | b"EI" | b"G" | b"J" | b"M" | b"MP" | b"TJ" | b"TL" | b"Tc" | b"Tj" | b"Tr"
        | b"Ts" | b"Tw" | b"Tz" | b"'" | b"cs" | b"g" | b"gs" | b"i" | b"j" | b"ri" | b"sh" | b"w" => 1,
        b"BDC" | b"DP" | b"TD" | b"Td" | b"Tf" | b"d" | b"l" | b"m" => 2,
        b"RG" | b"\"" | b"rg" => 3,
        b"K" | b"k" | b"re" | b"v" | b"y" => 4,
        b"Tm" | b"c" | b"cm" => 6,
        _ => return None,
    })
}

/// Python `float(x)` as pdfminer's `safe_float` uses it.
fn safe_float(o: &Obj) -> Option<f64> {
    match o {
        Obj::Int(i) => Some(*i as f64),
        Obj::Real(r) => Some(*r),
        Obj::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        Obj::Str(s) => {
            let t = std::str::from_utf8(s).ok()?.trim();
            let t = t.strip_prefix('+').unwrap_or(t);
            t.parse::<f64>().ok()
        }
        _ => None,
    }
}

pub struct FontCache {
    by_id: HashMap<ObjectId, Rc<Font>>,
}

impl FontCache {
    pub fn new() -> Self {
        FontCache { by_id: HashMap::new() }
    }
}

impl Default for FontCache {
    fn default() -> Self {
        Self::new()
    }
}

struct Frame<'d> {
    resources: Option<&'d Dictionary>,
    fontmap: HashMap<Vec<u8>, Rc<Font>>,
    ctm: M,
    ts: TextState,
    gstack: Vec<(M, TextState)>,
    args: Vec<Obj>,
    curpath: Vec<Seg>,
}

/// A path segment as pdfminer keeps it: operator and its float operands.
#[derive(Clone, Copy)]
struct Seg {
    op: u8,
    v: [f64; 6],
    n: usize,
}

impl Seg {
    fn last_pt(&self) -> (f64, f64) {
        (self.v[self.n - 2], self.v[self.n - 1])
    }
}

/// Painted paths, as pdfminer's `PDFLayoutAnalyzer.paint_path` turns them
/// into LTLine / LTRect / LTCurve (PDF user space after the device CTM).
#[derive(Default)]
pub struct Paths {
    /// bbox (x0, y0, x1, y1) of each LTLine
    pub lines: Vec<[f64; 4]>,
    /// bbox of each LTRect
    pub rects: Vec<[f64; 4]>,
    /// points of each LTCurve
    pub curves: Vec<Vec<(f64, f64)>>,
}

fn get_bound(pts: &[(f64, f64)]) -> [f64; 4] {
    let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for &(x, y) in pts {
        // Python min(a, b) keeps a unless b < a
        if x < x0 {
            x0 = x;
        }
        if y < y0 {
            y0 = y;
        }
        if x > x1 {
            x1 = x;
        }
        if y > y1 {
            y1 = y;
        }
    }
    [x0, y0, x1, y1]
}

pub struct Interp<'d, 'c> {
    doc: &'d Document,
    fonts: &'c mut FontCache,
    pub chars: Vec<Char>,
    pub paths: Paths,
    cid_buf: Vec<u32>,
    depth: usize,
    /// pdfminer's device CTM: set by cm, Q (when the stack is not empty) and
    /// at the start of every content stream, but not restored after a Form
    /// XObject. Text and paths are placed with it.
    dev_ctm: M,
}

const MAX_FORM_DEPTH: usize = 64;

impl<'d, 'c> Interp<'d, 'c> {
    pub fn new(doc: &'d Document, fonts: &'c mut FontCache) -> Self {
        Interp { doc, fonts, chars: Vec::new(), paths: Paths::default(), cid_buf: Vec::new(), depth: 0, dev_ctm: IDENT }
    }

    fn font_for(&mut self, frame: &mut Frame<'d>, name: &[u8]) -> Result<Rc<Font>, Unsupported> {
        if let Some(f) = frame.fontmap.get(name) {
            return Ok(f.clone());
        }
        let doc = self.doc;
        let entry = frame
            .resources
            .and_then(|r| dict_get(doc, r, b"Font"))
            .and_then(|o| o.as_dict().ok())
            .and_then(|fd| fd.get(name).ok());
        let font = match entry {
            Some(o) => {
                let id = match o {
                    Object::Reference(id) => Some(*id),
                    _ => None,
                };
                if let Some(f) = id.and_then(|id| self.fonts.by_id.get(&id)) {
                    f.clone()
                } else {
                    let spec = match deref(doc, o) {
                        Object::Dictionary(d) => d.clone(),
                        Object::Stream(s) => s.dict.clone(),
                        _ => Dictionary::new(),
                    };
                    let f = Rc::new(Font::load(doc, &spec)?);
                    if let Some(id) = id {
                        self.fonts.by_id.insert(id, f.clone());
                    }
                    f
                }
            }
            // pdfminer: unknown font id -> get_font(None, {}) (empty Type1)
            None => Rc::new(Font::load(doc, &Dictionary::new())?),
        };
        frame.fontmap.insert(name.to_vec(), font.clone());
        Ok(font)
    }

    /// `render_contents`: run content `data` with `resources` under `ctm`.
    /// `ancestors` are the stream object ids already being executed.
    pub fn run(
        &mut self,
        resources: Option<&'d Dictionary>,
        data: &[u8],
        ctm: M,
        ancestors: &mut Vec<ObjectId>,
    ) -> Result<(), Unsupported> {
        let mut frame = Frame {
            resources,
            fontmap: HashMap::new(),
            ctm,
            ts: TextState::new(),
            gstack: Vec::new(),
            args: Vec::new(),
            curpath: Vec::new(),
        };
        self.dev_ctm = ctm;
        let mut p = ContentParser::new(data);
        while let Some(o) = p.next_obj() {
            let op = match o {
                Obj::Kw(k) => k,
                other => {
                    frame.args.push(other);
                    continue;
                }
            };
            let n = match nargs(&op) {
                Some(n) => n,
                None => continue,
            };
            let args: Vec<Obj> = if n > 0 {
                let take = n.min(frame.args.len());
                let a = frame.args.split_off(frame.args.len() - take);
                if a.len() != n {
                    continue;
                }
                a
            } else {
                Vec::new()
            };
            self.exec(&mut frame, &op, args, ancestors)?;
        }
        Ok(())
    }

    fn exec(
        &mut self,
        fr: &mut Frame<'d>,
        op: &[u8],
        a: Vec<Obj>,
        ancestors: &mut Vec<ObjectId>,
    ) -> Result<(), Unsupported> {
        match op {
            b"q" => fr.gstack.push((fr.ctm, fr.ts.clone())),
            b"Q" => {
                if let Some((m, ts)) = fr.gstack.pop() {
                    fr.ctm = m;
                    fr.ts = ts;
                    self.dev_ctm = m;
                }
            }
            b"cm" => {
                let v: Vec<Option<f64>> = a.iter().map(safe_float).collect();
                if v.iter().all(|x| x.is_some()) {
                    let m = [v[0].unwrap(), v[1].unwrap(), v[2].unwrap(), v[3].unwrap(), v[4].unwrap(), v[5].unwrap()];
                    fr.ctm = mult(&m, &fr.ctm);
                    self.dev_ctm = fr.ctm;
                }
            }
            b"BT" => {
                fr.ts.matrix = IDENT;
                fr.ts.linematrix = (0.0, 0.0);
            }
            b"Tc" => {
                if let Some(v) = safe_float(&a[0]) {
                    fr.ts.charspace = v;
                }
            }
            b"Tw" => {
                if let Some(v) = safe_float(&a[0]) {
                    fr.ts.wordspace = v;
                }
            }
            b"Tz" => {
                if let Some(v) = safe_float(&a[0]) {
                    fr.ts.scaling = v;
                }
            }
            b"TL" => {
                if let Some(v) = safe_float(&a[0]) {
                    fr.ts.leading = -v;
                }
            }
            b"Ts" => {
                if let Some(v) = safe_float(&a[0]) {
                    fr.ts.rise = v;
                }
            }
            b"Tf" => {
                let name: Vec<u8> = match &a[0] {
                    Obj::Name(n) => n.clone(),
                    Obj::Str(s) => s.clone(),
                    _ => Vec::new(),
                };
                let f = self.font_for(fr, &name)?;
                fr.ts.font = Some(f);
                if let Some(v) = safe_float(&a[1]) {
                    fr.ts.fontsize = v;
                }
            }
            b"Td" | b"TD" => {
                let (tx, ty) = (safe_float(&a[0]), safe_float(&a[1]));
                if let (Some(tx), Some(ty)) = (tx, ty) {
                    let [a_, b_, c_, d_, e_, f_] = fr.ts.matrix;
                    fr.ts.matrix = [a_, b_, c_, d_, tx * a_ + ty * c_ + e_, tx * b_ + ty * d_ + f_];
                }
                if op == b"TD" {
                    if let Some(ty) = ty {
                        fr.ts.leading = ty;
                    }
                }
                fr.ts.linematrix = (0.0, 0.0);
            }
            b"Tm" => {
                let v: Vec<Option<f64>> = a.iter().map(safe_float).collect();
                if v.iter().all(|x| x.is_some()) {
                    fr.ts.matrix =
                        [v[0].unwrap(), v[1].unwrap(), v[2].unwrap(), v[3].unwrap(), v[4].unwrap(), v[5].unwrap()];
                    fr.ts.linematrix = (0.0, 0.0);
                }
            }
            b"T*" => self.next_line(fr),
            b"TJ" => {
                let seq = match a.into_iter().next() {
                    Some(Obj::Arr(v)) => v,
                    Some(o) => vec![o],
                    None => Vec::new(),
                };
                self.render(fr, &seq);
            }
            b"Tj" => self.render(fr, &a),
            b"'" => {
                self.next_line(fr);
                self.render(fr, &a);
            }
            b"\"" => {
                if let Some(v) = safe_float(&a[0]) {
                    fr.ts.wordspace = v;
                }
                if let Some(v) = safe_float(&a[1]) {
                    fr.ts.charspace = v;
                }
                self.render(fr, &a[2..]);
            }
            b"Do" => self.do_xobject(fr, &a[0], ancestors)?,
            b"m" | b"l" | b"c" | b"v" | b"y" => {
                let f: Vec<Option<f64>> = a.iter().map(safe_float).collect();
                if f.iter().all(|x| x.is_some()) {
                    let mut v = [0.0; 6];
                    for (i, x) in f.iter().enumerate() {
                        v[i] = x.unwrap();
                    }
                    fr.curpath.push(Seg { op: op[0], v, n: f.len() });
                }
            }
            b"h" => fr.curpath.push(Seg { op: b'h', v: [0.0; 6], n: 0 }),
            b"re" => {
                let f: Vec<Option<f64>> = a.iter().map(safe_float).collect();
                if let [Some(x), Some(y), Some(w), Some(h)] = f[..] {
                    let pt = |op: u8, px: f64, py: f64| Seg { op, v: [px, py, 0.0, 0.0, 0.0, 0.0], n: 2 };
                    fr.curpath.push(pt(b'm', x, y));
                    fr.curpath.push(pt(b'l', x + w, y));
                    fr.curpath.push(pt(b'l', x + w, y + h));
                    fr.curpath.push(pt(b'l', x, y + h));
                    fr.curpath.push(Seg { op: b'h', v: [0.0; 6], n: 0 });
                }
            }
            b"s" | b"b" | b"b*" => {
                fr.curpath.push(Seg { op: b'h', v: [0.0; 6], n: 0 });
                let path = std::mem::take(&mut fr.curpath);
                self.paint_path(&path);
            }
            b"S" | b"f" | b"f*" | b"B" | b"B*" => {
                let path = std::mem::take(&mut fr.curpath);
                self.paint_path(&path);
            }
            // pdfminer's do_F does nothing (it does not even clear the path)
            b"n" => fr.curpath.clear(),
            _ => {}
        }
        Ok(())
    }

    /// pdfminer `PDFLayoutAnalyzer.paint_path`.
    fn paint_path(&mut self, path: &[Seg]) {
        if path.first().map(|s| s.op) != Some(b'm') {
            return;
        }
        let m_count = path.iter().filter(|s| s.op == b'm').count();
        if m_count > 1 {
            // re.finditer(r"m[^m]+", shape)
            let mut i = 0;
            while i < path.len() {
                if path[i].op == b'm' {
                    let mut j = i + 1;
                    while j < path.len() && path[j].op != b'm' {
                        j += 1;
                    }
                    if j > i + 1 {
                        self.paint_path(&path[i..j]);
                    }
                    i = j;
                } else {
                    i += 1;
                }
            }
            return;
        }
        let ctm = self.dev_ctm;
        let start = path[0].last_pt();
        let mut pts: Vec<(f64, f64)> = path
            .iter()
            .map(|s| {
                let (x, y) = if s.op == b'h' { start } else { s.last_pt() };
                apply_pt(&ctm, x, y)
            })
            .collect();
        let mut shape: Vec<u8> = path.iter().map(|s| s.op).collect();
        if shape.len() > 3 && shape.ends_with(b"lh") && pts[pts.len() - 2] == pts[0] {
            shape.truncate(shape.len() - 2);
            shape.push(b'h');
            pts.pop();
        }
        match &shape[..] {
            b"mlh" | b"ml" => self.paths.lines.push(get_bound(&pts[..2])),
            b"mlllh" | b"mllll" => {
                let [(x0, y0), (x1, y1), (x2, y2), (x3, y3), p4] = [pts[0], pts[1], pts[2], pts[3], pts[4]];
                let closed = pts[0] == p4;
                let square =
                    (x0 == x1 && y1 == y2 && x2 == x3 && y3 == y0) || (y0 == y1 && x1 == x2 && y2 == y3 && x3 == x0);
                if closed && square {
                    let (rx0, ry0, rx1, ry1) = (x0, y0, x2, y2);
                    self.paths.rects.push(get_bound(&[(rx0, ry0), (rx1, ry0), (rx1, ry1), (rx0, ry1)]));
                } else {
                    self.paths.curves.push(pts);
                }
            }
            _ => self.paths.curves.push(pts),
        }
    }

    fn next_line(&mut self, fr: &mut Frame<'d>) {
        let [a, b, c, d, e, f] = fr.ts.matrix;
        let l = fr.ts.leading;
        fr.ts.matrix = [a, b, c, d, l * c + e, l * d + f];
        fr.ts.linematrix = (0.0, 0.0);
    }

    fn do_xobject(&mut self, fr: &mut Frame<'d>, name: &Obj, ancestors: &mut Vec<ObjectId>) -> Result<(), Unsupported> {
        let doc = self.doc;
        let name = match name {
            Obj::Name(n) => n,
            _ => return Ok(()),
        };
        let entry = fr
            .resources
            .and_then(|r| dict_get(doc, r, b"XObject"))
            .and_then(|o| o.as_dict().ok())
            .and_then(|x| x.get(name).ok());
        let (id, xobj) = match entry {
            Some(Object::Reference(id)) => match doc.get_object(*id).map(|o| deref(doc, o)) {
                Ok(Object::Stream(s)) => (*id, s),
                _ => return Ok(()),
            },
            _ => return Ok(()),
        };
        if dict_get(doc, &xobj.dict, b"Subtype").and_then(as_name) != Some(b"Form") || xobj.dict.get(b"BBox").is_err() {
            return Ok(());
        }
        if ancestors.contains(&id) || self.depth >= MAX_FORM_DEPTH {
            return Ok(());
        }
        let matrix: M = match dict_get(doc, &xobj.dict, b"Matrix").and_then(|o| o.as_array().ok()) {
            Some(arr) => {
                let v: Vec<f64> = arr.iter().map(|o| num(doc, o).unwrap_or(0.0)).collect();
                if v.len() != 6 {
                    return Err(Unsupported("form_matrix"));
                }
                [v[0], v[1], v[2], v[3], v[4], v[5]]
            }
            None => IDENT,
        };
        let res = match dict_get(doc, &xobj.dict, b"Resources") {
            Some(Object::Dictionary(d)) if !d.is_empty() => Some(d),
            Some(Object::Dictionary(_)) | None => fr.resources,
            Some(_) => None,
        };
        let data = stream_data(xobj).ok_or(Unsupported("form_stream"))?;
        let ctm = mult(&matrix, &fr.ctm);
        ancestors.push(id);
        self.depth += 1;
        let r = self.run(res, &data, ctm, ancestors);
        self.depth -= 1;
        ancestors.pop();
        r
    }

    fn render(&mut self, fr: &mut Frame<'d>, seq: &[Obj]) {
        let font = match &fr.ts.font {
            Some(f) => f.clone(),
            None => return,
        };
        let ts = &fr.ts;
        let matrix = mult(&ts.matrix, &self.dev_ctm);
        let fontsize = ts.fontsize;
        let scaling = ts.scaling * 0.01;
        let charspace = ts.charspace * scaling;
        let mut wordspace = ts.wordspace * scaling;
        let rise = ts.rise;
        if font.multibyte {
            wordspace = 0.0;
        }
        let dxscale = 0.001 * fontsize * scaling;
        let (mut x, y) = ts.linematrix;
        let mut needcharspace = false;
        let descent = font.get_descent() * fontsize;
        let mut cids = std::mem::take(&mut self.cid_buf);
        for obj in seq {
            match obj {
                Obj::Int(_) | Obj::Real(_) | Obj::Bool(_) => {
                    let v = safe_float(obj).unwrap_or(0.0);
                    x -= v * dxscale;
                    needcharspace = true;
                }
                Obj::Str(s) => {
                    font.decode(s, &mut cids);
                    for &cid in cids.iter() {
                        if needcharspace {
                            x += charspace;
                        }
                        let m = translate(&matrix, x, y);
                        let text: Rc<str> = match font.to_unichr(cid) {
                            Some(t) => Rc::from(t.as_str()),
                            None => Rc::from(format!("(cid:{cid})").as_str()),
                        };
                        let textwidth = font.char_width(cid);
                        let adv = textwidth * fontsize * scaling;
                        let bbox = (0.0, descent + rise, adv, descent + rise + fontsize);
                        let [a, b, c, d, _, _] = m;
                        let upright = 0.0 < a * d * scaling && b * c <= 0.0;
                        let (mut x0, mut y0, mut x1, mut y1) = apply_rect(&m, bbox);
                        if x1 < x0 {
                            std::mem::swap(&mut x0, &mut x1);
                        }
                        if y1 < y0 {
                            std::mem::swap(&mut y0, &mut y1);
                        }
                        self.chars.push(Char { text, x0, y0, x1, y1, upright, size: y1 - y0, matrix: m, adv, fs: fontsize, bold: font.bold });
                        x += adv;
                        if cid == 32 && wordspace != 0.0 {
                            x += wordspace;
                        }
                        needcharspace = true;
                    }
                }
                _ => {}
            }
        }
        self.cid_buf = cids;
        fr.ts.linematrix = (x, y);
    }
}
