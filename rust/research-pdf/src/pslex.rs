//! PostScript-style tokenizer, written to split bytes exactly as pdfminer.six's
//! `PSBaseParser` does (numbers, names with `#xx`, literal and hex strings,
//! keywords). Used for page content streams, ToUnicode CMaps and Type 1 font
//! headers.

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    Int(i64),
    Real(f64),
    Bool(bool),
    Name(Vec<u8>),
    Str(Vec<u8>),
    /// Any keyword, including the one- or two-byte delimiters `[ ] { } << >>`.
    Kw(Vec<u8>),
}

pub struct Lexer<'a> {
    s: &'a [u8],
    pub pos: usize,
}

#[inline]
fn is_space(c: u8) -> bool {
    // Python's bytes regex \s: space, \t, \n, \v, \f, \r
    matches!(c, b' ' | b'\t' | b'\n' | 0x0b | 0x0c | b'\r')
}

#[inline]
fn is_end_name(c: u8) -> bool {
    // END_LITERAL / END_KEYWORD: [#/%\[\]()<>{}\s]
    is_space(c) || matches!(c, b'#' | b'/' | b'%' | b'[' | b']' | b'(' | b')' | b'<' | b'>' | b'{' | b'}')
}

#[inline]
fn hexval(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

impl<'a> Lexer<'a> {
    pub fn new(s: &'a [u8]) -> Self {
        Lexer { s, pos: 0 }
    }

    pub fn data(&self) -> &'a [u8] {
        self.s
    }

    pub fn next_tok(&mut self) -> Option<Tok> {
        let s = self.s;
        loop {
            // skip whitespace
            while self.pos < s.len() && is_space(s[self.pos]) {
                self.pos += 1;
            }
            if self.pos >= s.len() {
                return None;
            }
            let c = s[self.pos];
            match c {
                b'%' => {
                    while self.pos < s.len() && s[self.pos] != b'\r' && s[self.pos] != b'\n' {
                        self.pos += 1;
                    }
                    continue;
                }
                b'/' => {
                    self.pos += 1;
                    return Some(Tok::Name(self.name()));
                }
                b'-' | b'+' | b'0'..=b'9' | b'.' => {
                    if let Some(t) = self.number() {
                        return Some(t);
                    }
                    continue;
                }
                b'(' => {
                    self.pos += 1;
                    return Some(Tok::Str(self.string()));
                }
                b'<' => {
                    self.pos += 1;
                    if self.pos < s.len() && s[self.pos] == b'<' {
                        self.pos += 1;
                        return Some(Tok::Kw(b"<<".to_vec()));
                    }
                    return Some(Tok::Str(self.hexstring()));
                }
                b'>' => {
                    self.pos += 1;
                    if self.pos < s.len() && s[self.pos] == b'>' {
                        self.pos += 1;
                        return Some(Tok::Kw(b">>".to_vec()));
                    }
                    continue;
                }
                0 => {
                    self.pos += 1;
                    continue;
                }
                _ if c.is_ascii_alphabetic() => {
                    let start = self.pos;
                    self.pos += 1;
                    while self.pos < s.len() && !is_end_name(s[self.pos]) {
                        self.pos += 1;
                    }
                    let kw = &s[start..self.pos];
                    return Some(match kw {
                        b"true" => Tok::Bool(true),
                        b"false" => Tok::Bool(false),
                        _ => Tok::Kw(kw.to_vec()),
                    });
                }
                _ => {
                    self.pos += 1;
                    return Some(Tok::Kw(vec![c]));
                }
            }
        }
    }

    fn name(&mut self) -> Vec<u8> {
        let s = self.s;
        let mut out = Vec::new();
        while self.pos < s.len() {
            let c = s[self.pos];
            if c == b'#' {
                self.pos += 1;
                let mut v: u32 = 0;
                let mut n = 0;
                while n < 2 && self.pos < s.len() {
                    if let Some(h) = hexval(s[self.pos]) {
                        v = v * 16 + h as u32;
                        n += 1;
                        self.pos += 1;
                    } else {
                        break;
                    }
                }
                if n > 0 {
                    out.push(v as u8);
                }
                continue;
            }
            if is_end_name(c) {
                break;
            }
            out.push(c);
            self.pos += 1;
        }
        out
    }

    /// pdfminer: `[-+0-9]` starts an int (a `.` switches to float); `.` starts a
    /// float. Digits only after the first byte. Unparseable tokens vanish.
    fn number(&mut self) -> Option<Tok> {
        let s = self.s;
        let start = self.pos;
        let first = s[self.pos];
        self.pos += 1;
        let mut is_float = first == b'.';
        while self.pos < s.len() && s[self.pos].is_ascii_digit() {
            self.pos += 1;
        }
        if !is_float && self.pos < s.len() && s[self.pos] == b'.' {
            is_float = true;
            self.pos += 1;
            while self.pos < s.len() && s[self.pos].is_ascii_digit() {
                self.pos += 1;
            }
        }
        let t = std::str::from_utf8(&s[start..self.pos]).ok()?;
        if is_float {
            // Python float(): needs at least one digit
            if !t.bytes().any(|b| b.is_ascii_digit()) {
                return None;
            }
            let t2 = t.strip_prefix('+').unwrap_or(t);
            t2.parse::<f64>().ok().map(Tok::Real)
        } else {
            if t.len() == 1 && (first == b'-' || first == b'+') {
                return None;
            }
            match t.parse::<i64>() {
                Ok(v) => Some(Tok::Int(v)),
                Err(_) => t.strip_prefix('+').unwrap_or(t).parse::<f64>().ok().map(Tok::Real),
            }
        }
    }

    fn string(&mut self) -> Vec<u8> {
        let s = self.s;
        let mut out = Vec::new();
        let mut depth = 1;
        while self.pos < s.len() {
            let c = s[self.pos];
            self.pos += 1;
            match c {
                b'\\' => {
                    if self.pos >= s.len() {
                        break;
                    }
                    let e = s[self.pos];
                    if (b'0'..=b'7').contains(&e) {
                        let mut v: u32 = 0;
                        let mut n = 0;
                        while n < 3 && self.pos < s.len() && (b'0'..=b'7').contains(&s[self.pos]) {
                            v = v * 8 + (s[self.pos] - b'0') as u32;
                            self.pos += 1;
                            n += 1;
                        }
                        out.push((v & 0xff) as u8);
                        continue;
                    }
                    self.pos += 1;
                    match e {
                        b'b' => out.push(8),
                        b't' => out.push(9),
                        b'n' => out.push(10),
                        b'f' => out.push(12),
                        b'r' => out.push(13),
                        b'(' => out.push(b'('),
                        b')' => out.push(b')'),
                        b'\\' => out.push(b'\\'),
                        b'\r'
                            if self.pos < s.len() && s[self.pos] == b'\n' => {
                                self.pos += 1;
                            }
                        _ => {} // pdfminer drops an unknown escape and its byte
                    }
                }
                b'(' => {
                    depth += 1;
                    out.push(c);
                }
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        return out;
                    }
                    out.push(c);
                }
                _ => out.push(c),
            }
        }
        out
    }

    fn hexstring(&mut self) -> Vec<u8> {
        let s = self.s;
        let mut digits = Vec::new();
        while self.pos < s.len() {
            let c = s[self.pos];
            if is_space(c) {
                self.pos += 1;
                continue;
            }
            match hexval(c) {
                Some(h) => {
                    digits.push(h);
                    self.pos += 1;
                }
                None => break,
            }
        }
        let mut out = Vec::with_capacity(digits.len() / 2 + 1);
        let mut i = 0;
        while i + 1 < digits.len() {
            out.push(digits[i] * 16 + digits[i + 1]);
            i += 2;
        }
        if i < digits.len() {
            out.push(digits[i]); // pdfminer: a lone last digit keeps its own value
        }
        out
    }
}

/// A parsed object, as pdfminer's `PSStackParser` builds it.
#[derive(Debug, Clone, PartialEq)]
pub enum Obj {
    Int(i64),
    Real(f64),
    Bool(bool),
    Name(Vec<u8>),
    Str(Vec<u8>),
    Arr(Vec<Obj>),
    Dict(Vec<(Vec<u8>, Obj)>),
    Kw(Vec<u8>),
    InlineImage,
}

impl Obj {
    pub fn num(&self) -> Option<f64> {
        match self {
            Obj::Int(i) => Some(*i as f64),
            Obj::Real(r) => Some(*r),
            _ => None,
        }
    }
}

#[derive(PartialEq, Clone, Copy)]
enum Ctx {
    Arr,
    Dict,
    Proc,
    Inline,
}

/// Content stream parser: yields top-level objects; a top-level `Obj::Kw` is
/// an operator. Mirrors pdfminer's `PDFContentParser` (inline images included).
pub struct ContentParser<'a> {
    lex: Lexer<'a>,
    stack: Vec<(Ctx, Vec<Obj>)>,
    pending: Option<Obj>,
    inline: bool,
}

fn build_dict(objs: Vec<Obj>) -> Obj {
    let mut d = Vec::new();
    let mut it = objs.into_iter();
    while let (Some(k), Some(v)) = (it.next(), it.next()) {
        if let Obj::Name(n) = k {
            d.push((n, v));
        }
    }
    Obj::Dict(d)
}

impl<'a> ContentParser<'a> {
    pub fn new(s: &'a [u8]) -> Self {
        ContentParser { lex: Lexer::new(s), stack: Vec::new(), pending: None, inline: true }
    }

    /// Same, without inline-image handling (CMaps, font headers).
    pub fn new_plain(s: &'a [u8]) -> Self {
        ContentParser { lex: Lexer::new(s), stack: Vec::new(), pending: None, inline: false }
    }

    fn emit(&mut self, o: Obj) -> Option<Obj> {
        if let Some((_, v)) = self.stack.last_mut() {
            v.push(o);
            None
        } else {
            Some(o)
        }
    }

    fn end(&mut self, want: Ctx) -> Option<Vec<Obj>> {
        if self.stack.last().map(|(c, _)| *c) == Some(want) {
            self.stack.pop().map(|(_, v)| v)
        } else {
            None // pdfminer: PSTypeError, ignored
        }
    }

    /// Skip inline image data after `ID`, as `get_inline_data` does.
    fn skip_inline(&mut self, a85: bool) {
        let s = self.lex.data();
        let target: &[u8] = if a85 { b"~>" } else { b"EI" };
        let mut p = self.lex.pos + 1; // "ID" plus one byte
        let mut found = s.len();
        while p + target.len() < s.len() {
            if &s[p..p + target.len()] == target && is_space(s[p + target.len()]) {
                found = p + target.len() + 1;
                break;
            }
            p += 1;
        }
        self.lex.pos = found.min(s.len());
    }

    pub fn next_obj(&mut self) -> Option<Obj> {
        if let Some(o) = self.pending.take() {
            return Some(o);
        }
        loop {
            let t = self.lex.next_tok()?;
            let out = match t {
                Tok::Int(i) => self.emit(Obj::Int(i)),
                Tok::Real(r) => self.emit(Obj::Real(r)),
                Tok::Bool(b) => self.emit(Obj::Bool(b)),
                Tok::Name(n) => self.emit(Obj::Name(n)),
                Tok::Str(st) => self.emit(Obj::Str(st)),
                Tok::Kw(k) => match k.as_slice() {
                    b"[" => {
                        self.stack.push((Ctx::Arr, Vec::new()));
                        None
                    }
                    b"]" => match self.end(Ctx::Arr) {
                        Some(v) => self.emit(Obj::Arr(v)),
                        None => None,
                    },
                    b"<<" => {
                        self.stack.push((Ctx::Dict, Vec::new()));
                        None
                    }
                    b">>" => match self.end(Ctx::Dict) {
                        Some(v) => self.emit(build_dict(v)),
                        None => None,
                    },
                    b"{" => {
                        self.stack.push((Ctx::Proc, Vec::new()));
                        None
                    }
                    b"}" => match self.end(Ctx::Proc) {
                        Some(v) => self.emit(Obj::Arr(v)),
                        None => None,
                    },
                    b"BI" if self.inline => {
                        self.stack.push((Ctx::Inline, Vec::new()));
                        None
                    }
                    b"ID" if self.inline => match self.end(Ctx::Inline) {
                        Some(v) => {
                            let mut a85 = false;
                            let mut it = v.iter();
                            while let (Some(k), Some(val)) = (it.next(), it.next()) {
                                if matches!(k, Obj::Name(n) if n == b"F") {
                                    let first = match val {
                                        Obj::Arr(a) => a.first(),
                                        o => Some(o),
                                    };
                                    if matches!(first, Some(Obj::Name(n)) if n == b"A85" || n == b"ASCII85Decode") {
                                        a85 = true;
                                    }
                                }
                            }
                            self.skip_inline(a85);
                            let r = self.emit(Obj::InlineImage);
                            if !a85 {
                                if r.is_some() {
                                    self.pending = Some(Obj::Kw(b"EI".to_vec()));
                                } else {
                                    self.emit(Obj::Kw(b"EI".to_vec()));
                                }
                            }
                            r
                        }
                        None => self.emit(Obj::Kw(k)),
                    },
                    _ => self.emit(Obj::Kw(k)),
                },
            };
            if out.is_some() {
                return out;
            }
        }
    }
}
