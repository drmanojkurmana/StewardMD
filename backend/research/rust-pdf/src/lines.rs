//! Stream-order text lines with font sizes, the way PrepNucleus
//! (`prep-source.js` `itemsToLines`) builds them from pdf.js text items:
//! characters stay in content-stream order (reading order for most PDFs,
//! two-column ones included); a line ends when the baseline moves by more than
//! half the font size; a space goes in at a visible gap; a line's size is the
//! font size carrying most of its characters, rounded to 0.1.
//!
//! Each line also says how it looks, for finding headings: `bold` / `italic`
//! when more than half of its visible characters are in a bold / italic font
//! (or drawn with text render mode 2, "fake bold", for bold), and `caps` when
//! it has at least two letters and none of them is lower case.

use crate::interp::Char;
use crate::words::py_isspace;

fn r1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

/// One line: text, font size and how it looks.
#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    pub tx: String,
    pub size: f64,
    pub bold: bool,
    pub italic: bool,
    pub caps: bool,
}

struct Cur {
    tx: String,
    nbold: usize,
    nitalic: usize,
    w: Vec<(f64, usize)>,
    key: f64,
    dir: (f64, f64),
    end: Option<f64>,
    n: usize,
    size0: f64,
}

fn close(cur: &mut Option<Cur>, out: &mut Vec<Line>) {
    if let Some(c) = cur.take() {
        let mut best = 0.0;
        let mut bw: isize = -1;
        for &(s, n) in &c.w {
            if n as isize > bw {
                bw = n as isize;
                best = s;
            }
        }
        if !c.tx.trim().is_empty() {
            let letters = c.tx.chars().filter(|ch| ch.is_alphabetic()).count();
            let caps = letters >= 2 && !c.tx.chars().any(|ch| ch.is_lowercase());
            out.push(Line { bold: c.nbold * 2 > c.n, italic: c.nitalic * 2 > c.n, caps, tx: c.tx, size: best });
        }
    }
}

pub fn page_lines(chars: &[Char]) -> Vec<Line> {
    let mut out = Vec::new();
    let mut cur: Option<Cur> = None;
    for ch in chars {
        let m = &ch.matrix;
        let size = r1(ch.fs * m[2].hypot(m[3]));
        // Work along the text direction, so rotated pages and vertical
        // labels read like pdf.js (which sees them before page rotation).
        let norm = m[0].hypot(m[1]);
        let dir = if norm > 0.0 { (m[0] / norm, m[1] / norm) } else { (1.0, 0.0) };
        let key = -m[4] * dir.1 + m[5] * dir.0;
        let pos = m[4] * dir.0 + m[5] * dir.1;
        let text: &str = &ch.text;
        // Glyphs with no Unicode come back as "(cid:N)"; pdf.js drops them.
        let text = if text.starts_with("(cid:") { "" } else { text };
        if !text.is_empty() && !py_isspace(text) {
            if let Some(c) = &cur {
                let turned = c.dir.0 * dir.0 + c.dir.1 * dir.1 < 0.99;
                if c.n > 0 && (turned || (key - c.key).abs() > 2f64.max(size.max(c.size0) * 0.5)) {
                    close(&mut cur, &mut out);
                }
            }
            let c = cur.get_or_insert_with(|| Cur { tx: String::new(), nbold: 0, nitalic: 0, w: Vec::new(), key, dir, end: None, n: 0, size0: size });
            if c.n > 0 {
                if let Some(end) = c.end {
                    if pos > end + 1f64.max(size * 0.15) && !c.tx.ends_with(' ') {
                        c.tx.push(' ');
                    }
                }
            }
            c.tx.push_str(text);
            c.n += 1;
            c.nbold += ch.bold as usize;
            c.nitalic += ch.italic as usize;
            c.key = key;
            c.dir = dir;
            match c.w.iter_mut().find(|(s, _)| *s == size) {
                Some(e) => e.1 += 1,
                None => c.w.push((size, 1)),
            }
            c.end = Some(pos + ch.adv * norm);
        } else if text.is_empty() {
            // A dropped glyph still takes its room, so no space opens up where
            // it was (pdf.js reads "overows", not "over ows").
            if let Some(c) = cur.as_mut() {
                if c.n > 0 {
                    c.end = Some(pos + ch.adv * norm);
                }
            }
        } else if let Some(c) = cur.as_mut() {
            if !c.tx.ends_with(' ') {
                c.tx.push(' ');
            }
        }
    }
    close(&mut cur, &mut out);
    out
}
