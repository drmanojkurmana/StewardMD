//! Tables, as pdfplumber 0.11's `Page.find_tables()` (default "lines"
//! settings) finds them and `Table.extract()` fills them, in the form
//! ResearchMD's extract.py stores: `{"bbox": [..], "rows": [[str|null]]}`.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use crate::interp::Paths;
use crate::words::{cluster_sorted, extract_words, PChar};

const SNAP: f64 = 3.0;
const JOIN: f64 = 3.0;
const EDGE_MIN_LENGTH: f64 = 3.0;
const EDGE_MIN_LENGTH_PREFILTER: f64 = 1.0;
const INTERSECTION_TOL: f64 = 3.0;
const TEXT_TOL: f64 = 3.0;

#[derive(Clone, Copy, Debug)]
struct Edge {
    x0: f64,
    x1: f64,
    top: f64,
    bottom: f64,
    width: f64,
    height: f64,
    /// b'h', b'v', or 0 (a curve segment that is neither)
    orient: u8,
}

/// Where pdfplumber puts the page: height and the (inverted) MediaBox
/// origin used to shift objects.
pub struct PageGeom {
    pub height: f64,
    pub mb_x0: f64,
    pub mb_top: f64,
}

fn pymin(a: f64, b: f64) -> f64 {
    if b < a {
        b
    } else {
        a
    }
}

fn pymax(a: f64, b: f64) -> f64 {
    if b > a {
        b
    } else {
        a
    }
}

/// An LTComponent bbox as pdfplumber's `process_object` places it.
fn placed(b: &[f64; 4], g: &PageGeom) -> Edge {
    let [mut x0, y0, mut x1, y1] = *b;
    let (width, height) = (x1 - x0, y1 - y0);
    let top = (g.height - y1) + g.mb_top;
    let bottom = (g.height - y0) + g.mb_top;
    if g.mb_x0 != 0.0 {
        x0 += g.mb_x0;
        x1 += g.mb_x0;
    }
    Edge { x0, x1, top, bottom, width, height, orient: 0 }
}

/// `page.edges`: line edges, then rect edges, then curve edges.
fn page_edges(paths: &Paths, g: &PageGeom) -> Vec<Edge> {
    let mut out = Vec::new();
    for l in &paths.lines {
        let mut e = placed(l, g);
        e.orient = if e.top == e.bottom { b'h' } else { b'v' };
        out.push(e);
    }
    for r in &paths.rects {
        let r = placed(r, g);
        out.push(Edge { height: 0.0, bottom: r.top, orient: b'h', ..r });
        out.push(Edge { height: 0.0, top: r.top + r.height, orient: b'h', ..r });
        out.push(Edge { width: 0.0, x1: r.x0, orient: b'v', ..r });
        out.push(Edge { width: 0.0, x0: r.x1, orient: b'v', ..r });
    }
    for c in &paths.curves {
        let pts: Vec<(f64, f64)> = c.iter().map(|&(x, y)| (g.mb_x0 + x, g.mb_top + g.height - y)).collect();
        for w in pts.windows(2) {
            let (p0, p1) = (w[0], w[1]);
            out.push(Edge {
                x0: pymin(p0.0, p1.0),
                x1: pymax(p0.0, p1.0),
                top: pymin(p0.1, p1.1),
                bottom: pymax(p0.1, p1.1),
                width: (p0.0 - p1.0).abs(),
                height: (p0.1 - p1.1).abs(),
                orient: if p0.0 == p1.0 {
                    b'v'
                } else if p0.1 == p1.1 {
                    b'h'
                } else {
                    0
                },
            });
        }
    }
    out
}

fn long_enough(e: &Edge, min: f64) -> bool {
    (if e.orient == b'v' { e.height } else { e.width }) >= min
}

fn fcmp(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

/// `utils.snap_objects`
fn snap(edges: &[Edge], vertical: bool) -> Vec<Edge> {
    let key = |e: &Edge| if vertical { e.x0 } else { e.top };
    let mut out = Vec::with_capacity(edges.len());
    for cluster in cluster_sorted(edges, key, SNAP) {
        let mut sum = 0.0;
        for e in &cluster {
            sum += key(e);
        }
        let avg = sum / cluster.len() as f64;
        for mut e in cluster {
            let d = avg - key(&e);
            if vertical {
                e.x0 += d;
                e.x1 += d;
            } else {
                e.top += d;
                e.bottom += d;
            }
            out.push(e);
        }
    }
    out
}

/// `join_edge_group`
fn join(mut group: Vec<Edge>, horizontal: bool) -> Vec<Edge> {
    if horizontal {
        group.sort_by(|a, b| fcmp(a.x0, b.x0));
    } else {
        group.sort_by(|a, b| fcmp(a.top, b.top));
    }
    let mut joined = vec![group[0]];
    for e in group.into_iter().skip(1) {
        let last = joined.last_mut().unwrap();
        if horizontal {
            if e.x0 <= last.x1 + JOIN {
                if e.x1 > last.x1 {
                    last.width = e.x1 - last.x0;
                    last.x1 = e.x1;
                }
            } else {
                joined.push(e);
            }
        } else if e.top <= last.bottom + JOIN {
            if e.bottom > last.bottom {
                last.height += e.bottom - last.bottom;
                last.bottom = e.bottom;
            }
        } else {
            joined.push(e);
        }
    }
    joined
}

/// `TableFinder.get_edges` with the default settings.
fn table_edges(page: &[Edge]) -> Vec<Edge> {
    let v: Vec<Edge> =
        page.iter().filter(|e| e.orient == b'v' && long_enough(e, EDGE_MIN_LENGTH_PREFILTER)).copied().collect();
    let h: Vec<Edge> =
        page.iter().filter(|e| e.orient == b'h' && long_enough(e, EDGE_MIN_LENGTH_PREFILTER)).copied().collect();
    // merge_edges: snap (vertical first), sort by (orientation, position),
    // group, join
    let mut edges = snap(&v, true);
    edges.extend(snap(&h, false));
    let key = |e: &Edge| if e.orient == b'h' { (0u8, e.top) } else { (1u8, e.x0) };
    edges.sort_by(|a, b| {
        let (ka, kb) = (key(a), key(b));
        ka.0.cmp(&kb.0).then(fcmp(ka.1, kb.1))
    });
    let mut out = Vec::new();
    let mut i = 0;
    while i < edges.len() {
        let k = key(&edges[i]);
        let mut j = i + 1;
        while j < edges.len() && key(&edges[j]) == k {
            j += 1;
        }
        out.extend(join(edges[i..j].to_vec(), k.0 == 0));
        i = j;
    }
    out.retain(|e| long_enough(e, EDGE_MIN_LENGTH));
    out
}

/// A float as a hashable key with Python's equality (-0.0 == 0.0).
fn fk(x: f64) -> u64 {
    (x + 0.0).to_bits()
}

type BKey = [u64; 4];

fn bkey(e: &Edge) -> BKey {
    [fk(e.x0), fk(e.top), fk(e.x1), fk(e.bottom)]
}

struct Vertex {
    pt: (f64, f64),
    v: Vec<BKey>,
    h: Vec<BKey>,
}

fn intersections(edges: &[Edge]) -> (Vec<Vertex>, HashMap<(u64, u64), usize>) {
    let mut v: Vec<&Edge> = edges.iter().filter(|e| e.orient == b'v').collect();
    let mut h: Vec<&Edge> = edges.iter().filter(|e| e.orient == b'h').collect();
    v.sort_by(|a, b| fcmp(a.x0, b.x0).then(fcmp(a.top, b.top)));
    h.sort_by(|a, b| fcmp(a.top, b.top).then(fcmp(a.x0, b.x0)));
    let mut verts: Vec<Vertex> = Vec::new();
    let mut index: HashMap<(u64, u64), usize> = HashMap::new();
    for ve in &v {
        for he in &h {
            if ve.top <= he.top + INTERSECTION_TOL
                && ve.bottom >= he.top - INTERSECTION_TOL
                && ve.x0 >= he.x0 - INTERSECTION_TOL
                && ve.x0 <= he.x1 + INTERSECTION_TOL
            {
                let k = (fk(ve.x0), fk(he.top));
                let i = *index.entry(k).or_insert_with(|| {
                    verts.push(Vertex { pt: (ve.x0, he.top), v: Vec::new(), h: Vec::new() });
                    verts.len() - 1
                });
                verts[i].v.push(bkey(ve));
                verts[i].h.push(bkey(he));
            }
        }
    }
    (verts, index)
}

fn common(a: &[BKey], b: &[BKey]) -> bool {
    a.iter().any(|x| b.contains(x))
}

fn cells(verts: &[Vertex], index: &HashMap<(u64, u64), usize>) -> Vec<[f64; 4]> {
    let at = |p: (f64, f64)| index.get(&(fk(p.0), fk(p.1))).map(|&i| &verts[i]);
    let connects = |p1: (f64, f64), p2: (f64, f64)| -> bool {
        let (a, b) = (at(p1).unwrap(), at(p2).unwrap());
        (p1.0 == p2.0 && common(&a.v, &b.v)) || (p1.1 == p2.1 && common(&a.h, &b.h))
    };
    let mut points: Vec<(f64, f64)> = verts.iter().map(|v| v.pt).collect();
    points.sort_by(|a, b| fcmp(a.0, b.0).then(fcmp(a.1, b.1)));
    let n = points.len();
    let mut out = Vec::new();
    for i in 0..n.saturating_sub(1) {
        let pt = points[i];
        let rest = &points[i + 1..];
        let below: Vec<(f64, f64)> = rest.iter().copied().filter(|p| p.0 == pt.0).collect();
        let right: Vec<(f64, f64)> = rest.iter().copied().filter(|p| p.1 == pt.1).collect();
        'found: for &b in &below {
            if !connects(pt, b) {
                continue;
            }
            for &r in &right {
                if !connects(pt, r) {
                    continue;
                }
                let br = (r.0, b.1);
                if at(br).is_some() && connects(br, r) && connects(br, b) {
                    out.push([pt.0, pt.1, br.0, br.1]);
                    break 'found;
                }
            }
        }
    }
    out
}

fn cells_to_tables(cells: Vec<[f64; 4]>) -> Vec<Vec<[f64; 4]>> {
    let corners = |c: &[f64; 4]| [(fk(c[0]), fk(c[1])), (fk(c[0]), fk(c[3])), (fk(c[2]), fk(c[1])), (fk(c[2]), fk(c[3]))];
    let mut remaining = cells;
    let mut cur_corners: HashSet<(u64, u64)> = HashSet::new();
    let mut cur: Vec<[f64; 4]> = Vec::new();
    let mut tables = Vec::new();
    while !remaining.is_empty() {
        let initial = cur.len();
        let snapshot = remaining.clone();
        for cell in snapshot {
            let cc = corners(&cell);
            if cur.is_empty() || cc.iter().any(|c| cur_corners.contains(c)) {
                cur_corners.extend(cc);
                cur.push(cell);
                if let Some(p) = remaining.iter().position(|x| *x == cell) {
                    remaining.remove(p);
                }
            }
        }
        if cur.len() == initial {
            tables.push(std::mem::take(&mut cur));
            cur_corners.clear();
        }
    }
    if !cur.is_empty() {
        tables.push(cur);
    }
    let key = |t: &Vec<[f64; 4]>| {
        let mut best = (t[0][1], t[0][0]);
        for c in &t[1..] {
            let k = (c[1], c[0]);
            if fcmp(k.0, best.0).then(fcmp(k.1, best.1)) == std::cmp::Ordering::Less {
                best = k;
            }
        }
        best
    };
    tables.sort_by(|a, b| {
        let (ka, kb) = (key(a), key(b));
        fcmp(ka.0, kb.0).then(fcmp(ka.1, kb.1))
    });
    tables.retain(|t| t.len() > 1);
    tables
}

fn bbox_of<'a>(cells: impl Iterator<Item = &'a [f64; 4]>) -> [f64; 4] {
    let mut it = cells;
    let first = *it.next().unwrap();
    let mut b = first;
    for c in it {
        b[0] = pymin(b[0], c[0]);
        b[1] = pymin(b[1], c[1]);
        b[2] = pymax(b[2], c[2]);
        b[3] = pymax(b[3], c[3]);
    }
    b
}

fn char_in(c: &PChar, b: &[f64; 4]) -> bool {
    let v_mid = (c.top + c.bottom) / 2.0;
    let h_mid = (c.x0 + c.x1) / 2.0;
    h_mid >= b[0] && h_mid < b[2] && v_mid >= b[1] && v_mid < b[3]
}

/// `utils.extract_text(chars)` without layout.
fn cell_text(chars: &[PChar]) -> String {
    let words = extract_words(chars);
    let lines = cluster_sorted(&words.iter().map(|(w, _)| (w.top, w.text.as_str())).collect::<Vec<_>>(), |w| w.0, TEXT_TOL);
    lines
        .iter()
        .map(|l| l.iter().map(|w| w.1).collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join("\n")
}

fn extract_table(cells: &[[f64; 4]], chars: &[PChar]) -> Value {
    let mut sorted: Vec<[f64; 4]> = cells.to_vec();
    sorted.sort_by(|a, b| fcmp(a[1], b[1]).then(fcmp(a[0], b[0])));
    let mut xs: Vec<f64> = cells.iter().map(|c| c[0]).collect();
    xs.sort_by(|a, b| fcmp(*a, *b));
    xs.dedup_by(|a, b| a == b);
    let mut rows = Vec::new();
    let mut i = 0;
    while i < sorted.len() {
        let mut j = i + 1;
        while j < sorted.len() && sorted[j][1] == sorted[i][1] {
            j += 1;
        }
        let group = &sorted[i..j];
        let row: Vec<Option<[f64; 4]>> =
            xs.iter().map(|&x| group.iter().rev().find(|c| c[0] == x).copied()).collect();
        let rb = bbox_of(row.iter().flatten());
        let row_chars: Vec<&PChar> = chars.iter().filter(|c| char_in(c, &rb)).collect();
        let arr: Vec<Value> = row
            .iter()
            .map(|cell| match cell {
                None => Value::Null,
                Some(cb) => {
                    let cc: Vec<PChar> = row_chars.iter().filter(|c| char_in(c, cb)).map(|&c| c.clone()).collect();
                    Value::String(if cc.is_empty() { String::new() } else { cell_text(&cc) })
                }
            })
            .collect();
        rows.push(Value::Array(arr));
        i = j;
    }
    let b = bbox_of(cells.iter());
    json!({ "bbox": b.iter().map(|&v| crate::round2(v)).collect::<Vec<f64>>(), "rows": rows })
}

/// extract.py `_tables(page)`.
pub fn find_tables(paths: &Paths, chars: &[PChar], g: &PageGeom) -> Vec<Value> {
    let edges = table_edges(&page_edges(paths, g));
    let (verts, index) = intersections(&edges);
    let cells = cells(&verts, &index);
    cells_to_tables(cells).iter().map(|t| extract_table(t, chars)).collect()
}
