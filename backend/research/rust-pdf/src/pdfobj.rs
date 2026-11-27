//! Small helpers over lopdf objects.

use lopdf::{Dictionary, Document, Object, Stream};

use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use crate::pslex::{Lexer, Tok};

thread_local! {
    /// f32 bits -> the f64 written in the file (None when two different
    /// decimals share one f32).
    static REALS: RefCell<HashMap<u32, Option<f64>>> = RefCell::new(HashMap::new());
    static LOST: Cell<bool> = const { Cell::new(false) };
}

fn add_reals(bytes: &[u8], stop_at_stream: bool, map: &mut HashMap<u32, Option<f64>>) {
    let mut lx = Lexer::new(bytes);
    while let Some(t) = lx.next_tok() {
        match t {
            Tok::Real(v) => {
                let e = map.entry((v as f32).to_bits()).or_insert(Some(v));
                if *e != Some(v) && e.is_some_and(|x| x.to_bits() != v.to_bits()) {
                    *e = None;
                }
            }
            Tok::Kw(k) if stop_at_stream && (k == b"endobj" || k == b"stream") => break,
            _ => {}
        }
    }
}

/// lopdf keeps PDF reals as f32, which drops digits from numbers like
/// 841.91998. Before reading a document, re-read every object's numbers from
/// the file as f64, so `f32d` can give back the exact value pdfminer sees.
pub fn load_reals(data: &[u8], doc: &Document) {
    let mut map = HashMap::new();
    for e in doc.reference_table.entries.values() {
        if let lopdf::xref::XrefEntry::Normal { offset, .. } = e {
            if let Some(b) = data.get(*offset as usize..) {
                add_reals(b, true, &mut map);
            }
        }
    }
    for o in doc.objects.values() {
        if let Object::Stream(s) = o {
            if s.dict.get(b"Type").ok().and_then(|t| as_name(t)) == Some(b"ObjStm") {
                if let Some(d) = stream_data(s) {
                    add_reals(&d, false, &mut map);
                }
            }
        }
    }
    REALS.with(|r| *r.borrow_mut() = map);
    LOST.with(|l| l.set(false));
}

pub fn clear_reals() {
    REALS.with(|r| r.borrow_mut().clear());
}

/// True when a real was read whose exact value could not be recovered.
pub fn reals_lost() -> bool {
    LOST.with(|l| l.get())
}

fn sig_digits(s: &str) -> usize {
    let mant = s.split(['e', 'E']).next().unwrap_or(s);
    mant.trim_start_matches('-').trim_start_matches(['0', '.']).chars().filter(|c| c.is_ascii_digit()).count()
}

/// The f64 pdfminer (Python float) sees for a real that lopdf parsed as f32.
pub fn f32d(f: f32) -> f64 {
    if let Some(v) = REALS.with(|r| r.borrow().get(&f.to_bits()).copied()) {
        match v {
            Some(v) => return v,
            None => LOST.with(|l| l.set(true)),
        }
    }
    let mut b = ryu::Buffer::new();
    let s = b.format(f);
    // Up to 6 significant digits survive an f32 round trip exactly.
    if sig_digits(s) > 6 && f.fract() != 0.0 {
        LOST.with(|l| l.set(true));
    }
    if f.fract() == 0.0 && f.abs() < 1e7 {
        return f as f64;
    }
    s.parse::<f64>().unwrap_or(f as f64)
}

pub fn deref<'a>(doc: &'a Document, mut o: &'a Object) -> &'a Object {
    for _ in 0..32 {
        match o {
            Object::Reference(id) => match doc.get_object(*id) {
                Ok(t) => o = t,
                Err(_) => return &Object::Null,
            },
            _ => return o,
        }
    }
    &Object::Null
}

pub fn dict_get<'a>(doc: &'a Document, d: &'a Dictionary, key: &[u8]) -> Option<&'a Object> {
    match d.get(key) {
        Ok(o) => match deref(doc, o) {
            Object::Null => None,
            t => Some(t),
        },
        Err(_) => None,
    }
}

pub fn num(doc: &Document, o: &Object) -> Option<f64> {
    match deref(doc, o) {
        Object::Integer(i) => Some(*i as f64),
        Object::Real(r) => Some(f32d(*r)),
        _ => None,
    }
}

pub fn as_name(o: &Object) -> Option<&[u8]> {
    match o {
        Object::Name(n) => Some(n.as_slice()),
        _ => None,
    }
}

pub const MAX_STREAM: usize = 256 * 1024 * 1024;

pub fn stream_data(s: &Stream) -> Option<Vec<u8>> {
    s.get_plain_content_with_limit(MAX_STREAM).ok()
}
