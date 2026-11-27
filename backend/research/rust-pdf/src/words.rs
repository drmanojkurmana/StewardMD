//! Words and page text, as pdfplumber 0.11's `WordExtractor` (default
//! settings) and `Page.extract_text()` build them, plus the custom rotated-page
//! path from ResearchMD's `extract.py`.

use std::rc::Rc;

/// A character in pdfplumber page coordinates (top-left origin, y down).
#[derive(Debug, Clone)]
pub struct PChar {
    pub text: Rc<str>,
    pub x0: f64,
    pub x1: f64,
    pub top: f64,
    pub bottom: f64,
    pub upright: bool,
    pub size: f64,
    pub matrix: [f64; 6],
    pub adv: f64,
}

pub struct Word {
    pub text: String,
    pub x0: f64,
    pub top: f64,
    pub x1: f64,
    pub bottom: f64,
}

const TOL: f64 = 3.0; // DEFAULT_X_TOLERANCE == DEFAULT_Y_TOLERANCE == 3

/// Python `str.isspace()`.
pub fn py_isspace(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c))
}

fn ligature(t: &str) -> &str {
    match t {
        "\u{fb00}" => "ff",
        "\u{fb03}" => "ffi",
        "\u{fb04}" => "ffl",
        "\u{fb01}" => "fi",
        "\u{fb02}" => "fl",
        "\u{fb06}" | "\u{fb05}" => "st",
        _ => t,
    }
}

/// pdfplumber `make_cluster_dict` + `cluster_list`: returns a cluster index
/// for each value.
pub(crate) fn cluster_ids(values: &[f64], tol: f64) -> Vec<usize> {
    let mut uniq: Vec<f64> = values.to_vec();
    uniq.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    uniq.dedup_by(|a, b| a == b);
    let mut ids = Vec::with_capacity(uniq.len());
    let mut cur = 0usize;
    if !uniq.is_empty() {
        ids.push(0);
        let mut last = uniq[0];
        for &x in &uniq[1..] {
            if tol == 0.0 || x > last + tol {
                cur += 1;
            }
            ids.push(cur);
            last = x;
        }
    }
    values
        .iter()
        .map(|v| {
            let i = uniq
                .binary_search_by(|u| u.partial_cmp(v).unwrap_or(std::cmp::Ordering::Equal))
                .unwrap_or(0);
            ids[i]
        })
        .collect()
}

/// `cluster_objects(xs, key, tol, preserve_order=False)`: groups in cluster
/// order (stable).
pub(crate) fn cluster_sorted<T: Clone>(xs: &[T], key: impl Fn(&T) -> f64, tol: f64) -> Vec<Vec<T>> {
    let keys: Vec<f64> = xs.iter().map(&key).collect();
    let ids = cluster_ids(&keys, tol);
    let mut idx: Vec<usize> = (0..xs.len()).collect();
    idx.sort_by_key(|&i| ids[i]);
    let mut out: Vec<Vec<T>> = Vec::new();
    let mut last: Option<usize> = None;
    for i in idx {
        if last != Some(ids[i]) {
            out.push(Vec::new());
            last = Some(ids[i]);
        }
        out.last_mut().unwrap().push(xs[i].clone());
    }
    out
}

fn fcmp(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

fn begins_new_word(prev: &PChar, cur: &PChar, ltr: bool) -> bool {
    let (ax, bx, cx, ay, cy) = if ltr {
        (prev.x0, prev.x1, cur.x0, prev.top, cur.top)
    } else {
        (prev.top, prev.bottom, cur.top, prev.x0, cur.x0)
    };
    cx < ax || cx > bx + TOL || (cy - ay).abs() > TOL
}

fn merge(chars: &[&PChar]) -> Word {
    let mut text = String::new();
    let (mut x0, mut top, mut x1, mut bottom) = (chars[0].x0, chars[0].top, chars[0].x1, chars[0].bottom);
    for c in chars {
        text.push_str(ligature(&c.text));
        if c.x0 < x0 {
            x0 = c.x0;
        }
        if c.top < top {
            top = c.top;
        }
        if c.x1 > x1 {
            x1 = c.x1;
        }
        if c.bottom > bottom {
            bottom = c.bottom;
        }
    }
    Word { text, x0, top, x1, bottom }
}

/// `WordExtractor().iter_extract_tuples(chars)` with default settings.
/// Returns each word and the indices of its chars.
pub fn extract_words(chars: &[PChar]) -> Vec<(Word, Vec<usize>)> {
    let mut out = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let upright = chars[start].upright;
        let mut end = start;
        while end < chars.len() && chars[end].upright == upright {
            end += 1;
        }
        let group: Vec<usize> = (start..end).collect();
        // iter_chars_to_lines
        let lines = if upright {
            cluster_sorted(&group, |&i| chars[i].top, TOL)
        } else {
            cluster_sorted(&group, |&i| chars[i].x0, TOL)
        };
        for mut line in lines {
            if upright {
                line.sort_by(|&a, &b| fcmp(chars[a].x0, chars[b].x0));
            } else {
                line.sort_by(|&a, &b| fcmp(chars[a].top, chars[b].top).then(fcmp(chars[a].bottom, chars[b].bottom)));
            }
            // iter_chars_to_words
            let mut cur: Vec<usize> = Vec::new();
            let flush = |cur: &mut Vec<usize>, out: &mut Vec<(Word, Vec<usize>)>| {
                if !cur.is_empty() {
                    let refs: Vec<&PChar> = cur.iter().map(|&i| &chars[i]).collect();
                    out.push((merge(&refs), std::mem::take(cur)));
                }
            };
            for i in line {
                let c = &chars[i];
                if py_isspace(&c.text) {
                    flush(&mut cur, &mut out);
                } else if let Some(&p) = cur.last() {
                    if begins_new_word(&chars[p], c, upright) {
                        flush(&mut cur, &mut out);
                    }
                    cur.push(i);
                } else {
                    cur.push(i);
                }
            }
            flush(&mut cur, &mut out);
        }
        start = end;
    }
    out
}

/// `Page.extract_text()` (layout=False): words in extraction order, lines are
/// consecutive runs of the same `top` cluster.
pub fn extract_text(words: &[(Word, Vec<usize>)], chars: &[PChar]) -> String {
    let tops: Vec<f64> = words.iter().map(|(w, _)| w.top).collect();
    let ids = cluster_ids(&tops, TOL);
    let mut s = String::new();
    let mut last: Option<usize> = None;
    let mut line_len = 0usize;
    for (k, (_, idx)) in words.iter().enumerate() {
        if last != Some(ids[k]) {
            if last.is_some() {
                s.push('\n');
            }
            last = Some(ids[k]);
            line_len = 0;
        }
        if line_len > 0 {
            s.push(' ');
            line_len += 1;
        }
        for &i in idx {
            let t = ligature(&chars[i].text);
            s.push_str(t);
            line_len += t.chars().count();
        }
    }
    s
}

fn unit(m: &[f64; 6]) -> (f64, f64) {
    let mut norm = m[0].hypot(m[1]);
    if norm == 0.0 {
        norm = 1.0;
    }
    (m[0] / norm, m[1] / norm)
}

/// extract.py `_words_from_chars` (rotated pages). Returns words and the index
/// of each word's first char.
pub fn words_from_chars(chars: &[PChar]) -> Vec<(Word, usize)> {
    let mut groups: Vec<Vec<usize>> = Vec::new();
    let mut cur: Vec<usize> = Vec::new();
    for (i, ch) in chars.iter().enumerate() {
        if ch.text.is_empty() || py_isspace(&ch.text) {
            if !cur.is_empty() {
                groups.push(std::mem::take(&mut cur));
            }
            continue;
        }
        if let Some(&p) = cur.last() {
            let prev = &chars[p];
            let m = &prev.matrix;
            let (ux, uy) = unit(m);
            let ex = m[4] + prev.adv * ux;
            let ey = m[5] + prev.adv * uy;
            let cm = &ch.matrix;
            let (dx, dy) = (cm[4] - ex, cm[5] - ey);
            let along = dx * ux + dy * uy;
            let perp = (-dx * uy + dy * ux).abs();
            if along > 0.25 * prev.size || perp > 0.5 * prev.size {
                groups.push(std::mem::take(&mut cur));
            }
        }
        cur.push(i);
    }
    if !cur.is_empty() {
        groups.push(cur);
    }
    groups
        .into_iter()
        .map(|g| {
            let mut text = String::new();
            let (mut x0, mut top, mut x1, mut bottom) =
                (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
            for &i in &g {
                let c = &chars[i];
                text.push_str(&c.text);
                if c.x0 < x0 {
                    x0 = c.x0;
                }
                if c.top < top {
                    top = c.top;
                }
                if c.x1 > x1 {
                    x1 = c.x1;
                }
                if c.bottom > bottom {
                    bottom = c.bottom;
                }
            }
            (Word { text, x0, top, x1, bottom }, g[0])
        })
        .collect()
}

/// extract.py `_text_from_words` (rotated pages).
pub fn text_from_words(pairs: &[(Word, usize)], chars: &[PChar]) -> String {
    let mut lines: Vec<Vec<&str>> = Vec::new();
    let mut cur_key: Option<f64> = None;
    let mut cur_size = 12.0;
    for (w, first) in pairs {
        let c = &chars[*first];
        let (ux, uy) = unit(&c.matrix);
        let key = -c.matrix[4] * uy + c.matrix[5] * ux;
        match cur_key {
            Some(k) if (key - k).abs() > 0.5 * cur_size => lines.push(vec![&w.text]),
            _ => {
                if lines.is_empty() {
                    lines.push(Vec::new());
                }
                lines.last_mut().unwrap().push(&w.text);
            }
        }
        cur_key = Some(key);
        cur_size = c.size;
    }
    lines.iter().map(|l| l.join(" ")).collect::<Vec<_>>().join("\n")
}
