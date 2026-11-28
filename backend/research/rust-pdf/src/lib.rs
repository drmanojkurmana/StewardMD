//! ResearchMD PDF text reader.
//!
//! Reads every page's text layer and returns the same JSON as
//! `backend/research/worker/research_worker/extract.py` (pdfplumber 0.11 /
//! pdfminer.six 20260107): page size, words with boxes, page text and tables.
//!
//! What it leaves to the Python reader:
//! - pages with no text layer (Python OCRs them): returned with
//!   `"needs_ocr": true` and no words, for Tesseract;
//! - documents using a PDF feature this reader does not copy exactly
//!   (vertical writing, predefined CJK CMaps, fonts whose only Unicode map is
//!   inside an embedded TrueType file, files lopdf cannot open). Those come
//!   back as `{"unsupported": "<reason>"}` so the caller can use pdfplumber.

pub mod font;
pub mod interp;
pub mod pdfobj;
pub mod pslex;
pub mod tables;
pub mod tables_cmap;
pub mod tablefind;
pub mod words;
pub mod lines;
pub mod ffi;


use lopdf::{Dictionary, Document, Object, ObjectId};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use font::Unsupported;
use interp::{FontCache, Interp, M};
use pdfobj::{deref, num, stream_data};
use words::{extract_text, extract_words, py_isspace, text_from_words, words_from_chars, PChar};

pub const DEFAULT_MAX_PAGES: usize = 60;
pub const DEFAULT_MAX_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug)]
pub enum Error {
    /// Same stable codes as extract.py: ceiling_bytes, ceiling_pages.
    Code(&'static str),
    /// Use the Python reader for this file.
    Unsupported(&'static str),
}

impl From<Unsupported> for Error {
    fn from(u: Unsupported) -> Self {
        Error::Unsupported(u.0)
    }
}

/// Python `round(x, 2)` (exact half-to-even on the binary value).
pub fn round2(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    format!("{x:.2}").parse().unwrap_or(x)
}

fn word_json(t: &str, x0: f64, y0: f64, x1: f64, y1: f64) -> Value {
    let mut m = Map::new();
    m.insert("t".into(), Value::String(t.to_string()));
    m.insert("x0".into(), json!(round2(x0)));
    m.insert("y0".into(), json!(round2(y0)));
    m.insert("x1".into(), json!(round2(x1)));
    m.insert("y1".into(), json!(round2(y1)));
    Value::Object(m)
}

const INHERITABLE: [&[u8]; 4] = [b"Resources", b"MediaBox", b"CropBox", b"Rotate"];

/// pdfminer `PDFPage.create_pages`: depth-first over the page tree, with
/// inherited attributes.
fn collect_pages(doc: &Document) -> Result<Vec<Dictionary>, Error> {
    let catalog = doc.catalog().map_err(|_| Error::Unsupported("no_catalog"))?;
    let root = catalog.get(b"Pages").map_err(|_| Error::Unsupported("no_page_tree"))?;
    let mut out = Vec::new();
    let mut visited = Vec::new();
    fn dfs(
        doc: &Document,
        obj: &Object,
        parent: &Dictionary,
        visited: &mut Vec<ObjectId>,
        out: &mut Vec<Dictionary>,
        depth: usize,
    ) {
        let id = match obj {
            Object::Reference(id) => *id,
            _ => return,
        };
        if visited.contains(&id) || depth > 64 {
            return;
        }
        visited.push(id);
        let mut props = match deref(doc, obj) {
            Object::Dictionary(d) => d.clone(),
            _ => return,
        };
        for k in INHERITABLE {
            if props.get(k).is_err() {
                if let Ok(v) = parent.get(k) {
                    props.set(k.to_vec(), v.clone());
                }
            }
        }
        let ty = props.get(b"Type").or_else(|_| props.get(b"type")).ok().map(|o| deref(doc, o).clone());
        match ty {
            Some(Object::Name(n)) if n == b"Pages" && props.get(b"Kids").is_ok() => {
                let kids = match deref(doc, props.get(b"Kids").unwrap()) {
                    Object::Array(a) => a.clone(),
                    _ => Vec::new(),
                };
                for k in &kids {
                    dfs(doc, k, &props, visited, out, depth + 1);
                }
            }
            Some(Object::Name(n)) if n == b"Page" => out.push(props),
            _ => {}
        }
    }
    dfs(doc, root, catalog, &mut visited, &mut out, 0);
    if out.is_empty() {
        return Err(Error::Unsupported("no_pages_found"));
    }
    Ok(out)
}

fn rect_of(doc: &Document, o: Option<&Object>) -> Option<[f64; 4]> {
    let a = deref(doc, o?).as_array().ok()?;
    if a.len() != 4 {
        return None;
    }
    let v: Vec<f64> = a.iter().map(|x| num(doc, x)).collect::<Option<Vec<f64>>>()?;
    Some([v[0], v[1], v[2], v[3]])
}

fn page_contents(doc: &Document, attrs: &Dictionary) -> Result<(Vec<u8>, Vec<ObjectId>), Error> {
    let mut data = Vec::new();
    let mut ids = Vec::new();
    let refs: Vec<Object> = match attrs.get(b"Contents") {
        Err(_) => Vec::new(),
        Ok(o) => match deref(doc, o) {
            Object::Array(a) => a.clone(),
            _ => vec![o.clone()],
        },
    };
    for r in refs {
        let id = match r {
            Object::Reference(id) => id,
            _ => continue, // pdfminer skips streams without an object id
        };
        if let Object::Stream(s) = deref(doc, &Object::Reference(id)) {
            let d = stream_data(s).ok_or(Error::Unsupported("content_stream_filter"))?;
            if !ids.is_empty() {
                data.push(b'\n'); // pdfminer ends a token at a stream boundary
            }
            data.extend_from_slice(&d);
            ids.push(id);
        }
    }
    Ok((data, ids))
}

fn extract_page(doc: &Document, fonts: &mut FontCache, n: usize, attrs: &Dictionary) -> Result<Value, Error> {
    let rotate_raw = match attrs.get(b"Rotate").ok().map(|o| deref(doc, o)) {
        None => 0.0,
        Some(o) => num(doc, o).ok_or(Error::Unsupported("rotate"))?,
    };
    // pdfminer: (int(r) + 360) % 360 ; pdfplumber: r % 360 (Python modulo)
    let rot_miner = ((rotate_raw as i64 + 360) % 360 + 360) % 360;
    let rotation = rotate_raw.rem_euclid(360.0);

    // pdfplumber needs a MediaBox; pdfminer would default to US Letter.
    let mb = rect_of(doc, attrs.get(b"MediaBox").ok()).ok_or(Error::Unsupported("mediabox"))?;
    let [x0, y0, x1, y1] = mb;
    let ctm: M = match rot_miner {
        90 => [0.0, -1.0, 1.0, 0.0, -y0, x1],
        180 => [-1.0, 0.0, 0.0, -1.0, x1, y1],
        270 => [0.0, 1.0, -1.0, 0.0, y1, -x0],
        _ => [1.0, 0.0, 0.0, 1.0, -x0, -y0],
    };

    // pdfplumber page box (_normalize_box + _invert_box)
    let (nx0, nx1) = if mb[0] <= mb[2] { (mb[0], mb[2]) } else { (mb[2], mb[0]) };
    let (ny0, ny1) = if mb[1] <= mb[3] { (mb[1], mb[3]) } else { (mb[3], mb[1]) };
    let raw = if rotation == 90.0 || rotation == 270.0 { (ny0, nx0, ny1, nx1) } else { (nx0, ny0, nx1, ny1) };
    let mb_height = raw.3 - raw.1;
    let pbox = (raw.0, mb_height - raw.3, raw.2, mb_height - raw.1);
    let width = pbox.2 - pbox.0;
    let height = pbox.3 - pbox.1;
    let (mb_x0, mb_top) = (pbox.0, pbox.1);

    let resources = attrs.get(b"Resources").ok().and_then(|o| deref(doc, o).as_dict().ok());
    let (content, ids) = page_contents(doc, attrs)?;
    let mut it = Interp::new(doc, fonts);
    let mut anc = ids;
    it.run(resources, &content, ctm, &mut anc)?;

    let paths = std::mem::take(&mut it.paths);
    let chars: Vec<PChar> = it
        .chars
        .into_iter()
        .map(|c| {
            let (mut cx0, mut cx1) = (c.x0, c.x1);
            if mb_x0 != 0.0 {
                cx0 += mb_x0;
                cx1 += mb_x0;
            }
            PChar {
                text: c.text,
                x0: cx0,
                x1: cx1,
                top: (height - c.y1) + mb_top,
                bottom: (height - c.y0) + mb_top,
                upright: c.upright,
                size: c.size,
                matrix: c.matrix,
                adv: c.adv,
            }
        })
        .collect();

    let has_text = chars.iter().any(|c| !c.text.is_empty() && !py_isspace(&c.text));
    let mut page = Map::new();
    page.insert("n".into(), json!(n));
    page.insert("width".into(), json!(round2(width)));
    page.insert("height".into(), json!(round2(height)));
    let (words, text): (Vec<Value>, String) = if !has_text {
        (Vec::new(), String::new())
    } else if rotation == 0.0 {
        let w = extract_words(&chars);
        let text = extract_text(&w, &chars);
        (w.iter().map(|(w, _)| word_json(&w.text, w.x0, w.top, w.x1, w.bottom)).collect(), text)
    } else {
        let pairs = words_from_chars(&chars);
        let text = text_from_words(&pairs, &chars);
        (pairs.iter().map(|(w, _)| word_json(&w.text, w.x0, w.top, w.x1, w.bottom)).collect(), text)
    };
    page.insert("text".into(), Value::String(text));
    page.insert("words".into(), Value::Array(words));
    let tables = if has_text {
        tablefind::find_tables(&paths, &chars, &tablefind::PageGeom { height, mb_x0, mb_top })
    } else {
        Vec::new()
    };
    page.insert("tables".into(), Value::Array(tables));
    page.insert("ocr".into(), Value::Bool(false));
    if !has_text {
        page.insert("needs_ocr".into(), Value::Bool(true));
    }
    Ok(Value::Object(page))
}

pub struct Limits {
    pub max_pages: usize,
    pub max_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits { max_pages: DEFAULT_MAX_PAGES, max_bytes: DEFAULT_MAX_BYTES }
    }
}

pub fn sha256_hex(data: &[u8]) -> String {
    Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect()
}

/// Read a PDF. Errors carry extract.py's stable codes, or an "unsupported"
/// reason meaning: use the Python reader for this file.
pub fn extract(data: &[u8], limits: &Limits) -> Result<Value, Error> {
    let sha = sha256_hex(data);
    if data.len() > limits.max_bytes {
        return Err(Error::Code("ceiling_bytes"));
    }
    let mut doc = Document::load_mem(data).map_err(|_| Error::Unsupported("load_failed"))?;
    if doc.is_encrypted() {
        doc.decrypt("").map_err(|_| Error::Unsupported("encrypted"))?;
    }
    pdfobj::load_reals(data, &doc);
    let r = read_doc(&doc, &sha, limits);
    pdfobj::clear_reals();
    let v = r?;
    if pdfobj::reals_lost() {
        return Err(Error::Unsupported("real_precision"));
    }
    Ok(v)
}

/// Stream-order text lines with font sizes for the chosen pages (1-based),
/// for PrepNucleus deck creation and thesis chapter splitting:
/// `{"pages": [{"n", "lines": [{"tx", "size", "bold", "italic", "caps"}]}]}`
/// (see `lines.rs` for what the three flags mean).
/// Pages that are out of range are left out.
pub fn extract_lines(data: &[u8], wanted: &[usize], max_bytes: usize) -> Result<Value, Error> {
    if data.len() > max_bytes {
        return Err(Error::Code("ceiling_bytes"));
    }
    let mut doc = Document::load_mem(data).map_err(|_| Error::Unsupported("load_failed"))?;
    if doc.is_encrypted() {
        doc.decrypt("").map_err(|_| Error::Unsupported("encrypted"))?;
    }
    pdfobj::load_reals(data, &doc);
    let r = (|| {
        let pages = collect_pages(&doc)?;
        let mut fonts = FontCache::new();
        let mut out = Vec::new();
        for &n in wanted {
            if n == 0 || n > pages.len() {
                continue;
            }
            let attrs = &pages[n - 1];
            let ctm = page_ctm(&doc, attrs)?;
            let resources = attrs.get(b"Resources").ok().and_then(|o| deref(&doc, o).as_dict().ok());
            let (content, ids) = page_contents(&doc, attrs)?;
            let mut it = Interp::new(&doc, &mut fonts);
            let mut anc = ids;
            it.run(resources, &content, ctm, &mut anc)?;
            let ls: Vec<Value> = lines::page_lines(&it.chars)
                .into_iter()
                .map(|l| json!({ "tx": l.tx, "size": l.size, "bold": l.bold, "italic": l.italic, "caps": l.caps }))
                .collect();
            out.push(json!({ "n": n, "lines": ls }));
        }
        Ok(json!({ "pages": out, "total": pages.len() }))
    })();
    pdfobj::clear_reals();
    r
}

fn page_ctm(doc: &Document, attrs: &Dictionary) -> Result<M, Error> {
    let rotate_raw = match attrs.get(b"Rotate").ok().map(|o| deref(doc, o)) {
        None => 0.0,
        Some(o) => num(doc, o).ok_or(Error::Unsupported("rotate"))?,
    };
    let rot_miner = ((rotate_raw as i64 + 360) % 360 + 360) % 360;
    let mb = rect_of(doc, attrs.get(b"MediaBox").ok()).ok_or(Error::Unsupported("mediabox"))?;
    let [x0, y0, x1, y1] = mb;
    Ok(match rot_miner {
        90 => [0.0, -1.0, 1.0, 0.0, -y0, x1],
        180 => [-1.0, 0.0, 0.0, -1.0, x1, y1],
        270 => [0.0, 1.0, -1.0, 0.0, y1, -x0],
        _ => [1.0, 0.0, 0.0, 1.0, -x0, -y0],
    })
}

fn read_doc(doc: &Document, sha: &str, limits: &Limits) -> Result<Value, Error> {
    let pages = collect_pages(doc)?;
    if pages.len() > limits.max_pages {
        return Err(Error::Code("ceiling_pages"));
    }
    let mut fonts = FontCache::new();
    let mut out = Vec::with_capacity(pages.len());
    for (i, attrs) in pages.iter().enumerate() {
        out.push(extract_page(doc, &mut fonts, i + 1, attrs)?);
    }
    let needs_ocr = out.iter().any(|p| p.get("needs_ocr").is_some());
    let mut m = Map::new();
    m.insert("pages".into(), Value::Array(out));
    m.insert("ocr".into(), Value::Bool(false));
    m.insert("sha256".into(), Value::String(sha.to_string()));
    if needs_ocr {
        m.insert("needs_ocr".into(), Value::Bool(true));
    }
    Ok(Value::Object(m))
}

/// Bytes in, JSON out. On failure returns `{"error": code}` or
/// `{"unsupported": reason}`.
pub fn extract_json(data: &[u8]) -> String {
    let v = match extract(data, &Limits::default()) {
        Ok(v) => v,
        Err(Error::Code(c)) => json!({ "error": c }),
        Err(Error::Unsupported(r)) => json!({ "unsupported": r }),
    };
    serde_json::to_string(&v).unwrap_or_else(|_| "{\"error\":\"internal\"}".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A one-page PDF from a content stream and font dictionaries.
    fn make_pdf(content: &str, fonts: &[(&str, &str)]) -> Vec<u8> {
        let fontrefs: String = fonts.iter().enumerate().map(|(i, (n, _))| format!("/{n} {} 0 R ", 5 + i)).collect();
        let mut objs = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 612 792] >>".to_string(),
            format!("<< /Type /Page /Parent 2 0 R /Resources << /Font << {fontrefs}>> >> /Contents 4 0 R >>"),
            format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
        ];
        objs.extend(fonts.iter().map(|(_, d)| d.to_string()));
        let mut out = String::from("%PDF-1.4\n");
        let mut offs = Vec::new();
        for (i, o) in objs.iter().enumerate() {
            offs.push(out.len());
            out += &format!("{} 0 obj\n{o}\nendobj\n", i + 1);
        }
        let x = out.len();
        out += &format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1);
        for o in offs {
            out += &format!("{o:010} 00000 n \n");
        }
        out += &format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n", objs.len() + 1);
        out.into_bytes()
    }

    #[test]
    fn lines_carry_bold_italic_and_caps() {
        let fonts = [
            ("F1", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
            ("F2", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"),
            ("F3", "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>"),
            // Bold only by FontWeight in its descriptor (the name says nothing).
            ("F4", "<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+Thesis /FirstChar 32 /LastChar 126 \
                    /Widths [] /FontDescriptor << /Type /FontDescriptor /FontName /ABCDEF+Thesis /Flags 32 \
                    /FontWeight 700 /ItalicAngle 0 >> >>"),
        ];
        let content = "BT /F2 16 Tf 72 720 Td (CHAPTER 1) Tj ET\n\
            BT /F2 14 Tf 72 700 Td (Introduction) Tj ET\n\
            BT /F1 11 Tf 72 680 Td (Plain body text, not bold.) Tj ET\n\
            BT /F3 11 Tf 72 660 Td (An italic line) Tj ET\n\
            BT /F4 12 Tf 72 640 Td (Weight seven hundred) Tj ET\n\
            BT 2 Tr /F1 12 Tf 72 620 Td (Fake bold heading) Tj 0 Tr ET\n\
            BT /F2 11 Tf 72 600 Td (Methods.) Tj /F1 11 Tf ( We studied the patients in the ward.) Tj ET\n\
            BT /F1 11 Tf 72 580 Td (WHO 2022) Tj ET";
        let v = extract_lines(&make_pdf(content, &fonts), &[1], usize::MAX).ok().unwrap();
        let got: Vec<(String, bool, bool, bool)> = v["pages"][0]["lines"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| {
                (
                    l["tx"].as_str().unwrap().to_string(),
                    l["bold"].as_bool().unwrap(),
                    l["italic"].as_bool().unwrap(),
                    l["caps"].as_bool().unwrap(),
                )
            })
            .collect();
        let want = [
            ("CHAPTER 1", true, false, true),
            ("Introduction", true, false, false),
            ("Plain body text, not bold.", false, false, false),
            ("An italic line", false, true, false),
            ("Weight seven hundred", true, false, false),
            ("Fake bold heading", true, false, false),
            ("Methods. We studied the patients in the ward.", false, false, false),
            ("WHO 2022", false, false, true),
        ];
        let want: Vec<(String, bool, bool, bool)> =
            want.iter().map(|(t, b, i, c)| (t.to_string(), *b, *i, *c)).collect();
        assert_eq!(got, want);
        // Words and text (extract.py's result) do not change.
        let e = extract(&make_pdf(content, &fonts), &Limits::default()).ok().unwrap();
        assert!(e["pages"][0]["words"][0].get("bold").is_none());
    }
}
