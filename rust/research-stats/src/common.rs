//! Shared gates, errors, manifest and the data hash.
//!
//! Mirrors backend/research/stats/_common.py. No network and no model calls:
//! patient-level rows stay in this process; results carry aggregates and a
//! sha256 data hash only (plan 5C.3, integrity rules 5 and 10).

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::fmt;

pub const ENGINE: &str = "research-stats";
/// Same engine version as the Python package it replaces.
pub const ENGINE_VERSION: &str = "1.0.0";
pub const CRATE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// A model error. `message` is the same text the Python package raises
/// (a stable code such as `ipd_gate` or `no_events`, or a short sentence).
#[derive(Debug, Clone, PartialEq)]
pub struct StatsError {
    pub message: String,
}

impl StatsError {
    pub fn new(message: impl Into<String>) -> Self {
        StatsError {
            message: message.into(),
        }
    }
}

impl fmt::Display for StatsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for StatsError {}

pub type Result<T> = std::result::Result<T, StatsError>;

pub fn err<T>(message: impl Into<String>) -> Result<T> {
    Err(StatsError::new(message))
}

/// Refuse unless compliance == {"ipdApproved": true, "evidenceId": <non-blank str, <= 200 chars>}.
pub fn require_ipd_approval(compliance: Option<&Value>) -> Result<()> {
    let obj = match compliance {
        Some(Value::Object(o)) => o,
        _ => return err("ipd_gate"),
    };
    if obj.get("ipdApproved") != Some(&Value::Bool(true)) {
        return err("ipd_gate");
    }
    match obj.get("evidenceId") {
        Some(Value::String(s)) if !s.trim().is_empty() && s.chars().count() <= 200 => Ok(()),
        _ => err("ipd_gate"),
    }
}

/// A one-dimensional array of finite numbers (booleans count as 0/1, as numpy does).
pub fn as_float_array(values: Option<&Value>, name: &str) -> Result<Vec<f64>> {
    let arr = match values {
        Some(Value::Array(a)) => a,
        _ => return err(format!("{name} must be a one-dimensional array")),
    };
    let mut out = Vec::with_capacity(arr.len());
    for v in arr {
        let x = match v {
            Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
            Value::Bool(b) => {
                if *b {
                    1.0
                } else {
                    0.0
                }
            }
            Value::Array(_) => return err(format!("{name} must be a one-dimensional array")),
            _ => return err(format!("could not convert {name} to numbers")),
        };
        if !x.is_finite() {
            return err(format!("{name} contains non-finite values"));
        }
        out.push(x);
    }
    Ok(out)
}

/// Validate a column-oriented dataset; return finite float arrays in `names` order.
pub fn check_columns(columns: Option<&Value>, names: &[String]) -> Result<Vec<Vec<f64>>> {
    let obj = match columns {
        Some(Value::Object(o)) => o,
        _ => return err("columns must be an object of named arrays"),
    };
    let mut out: Vec<Vec<f64>> = Vec::with_capacity(names.len());
    let mut n: Option<usize> = None;
    for name in names {
        let col = match obj.get(name) {
            Some(c) => c,
            None => return err(format!("missing column {name}")),
        };
        let arr = as_float_array(Some(col), name)?;
        match n {
            None => n = Some(arr.len()),
            Some(m) if m != arr.len() => {
                return err(format!("column {name} has a different length"))
            }
            _ => {}
        }
        out.push(arr);
    }
    if n.unwrap_or(0) == 0 {
        return err("empty dataset");
    }
    Ok(out)
}

pub fn z_value(level: f64) -> Result<f64> {
    if !(level > 0.0 && level < 1.0) {
        return err("level must be between 0 and 1");
    }
    Ok(crate::dist::norm_ppf((1.0 + level) / 2.0))
}

/// Read an optional `level` (default 0.95).
pub fn level_of(input: &Map<String, Value>) -> Result<f64> {
    match input.get("level") {
        None | Some(Value::Null) => Ok(0.95),
        Some(Value::Number(n)) => Ok(n.as_f64().unwrap_or(f64::NAN)),
        _ => err("level must be between 0 and 1"),
    }
}

pub fn floats_value(xs: &[f64]) -> Value {
    Value::Array(xs.iter().map(|&x| json_f64(x)).collect())
}

pub fn json_f64(x: f64) -> Value {
    serde_json::Number::from_f64(x)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

pub fn opt_f64(x: Option<f64>) -> Value {
    match x {
        Some(v) if v.is_finite() => json_f64(v),
        _ => Value::Null,
    }
}

// ---------------------------------------------------------------------------
// Data hash: sha256 of Python's json.dumps(data, sort_keys=True,
// separators=(",", ":"), allow_nan=False). Floats are written exactly as
// Python's repr(float); strings are escaped as Python does (ensure_ascii).
// Values that were floats in Python must be passed as `Value::Number` holding
// an f64 (serde_json keeps integers and floats apart).
// ---------------------------------------------------------------------------

pub fn data_hash(data: &Value) -> String {
    let mut s = String::new();
    write_canonical(data, &mut s);
    let digest = Sha256::digest(s.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// A float that must hash as a Python float even when it is integral.
pub fn py_float(x: f64) -> Value {
    // serde_json keeps 21.0 as an f64 Number (is_f64() == true), which the
    // canonical writer prints as "21.0", like Python.
    json_f64(x)
}

fn write_canonical(v: &Value, out: &mut String) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                {
                    use std::fmt::Write as _;
                    let _ = write!(out, "{i}");
                }
            } else if let Some(u) = n.as_u64() {
                {
                    use std::fmt::Write as _;
                    let _ = write!(out, "{u}");
                }
            } else {
                write_py_float(n.as_f64().unwrap_or(f64::NAN), out);
            }
        }
        Value::String(s) => py_json_string(s, out),
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(x, out);
            }
            out.push(']');
        }
        Value::Object(o) => {
            let mut keys: Vec<&String> = o.keys().collect();
            keys.sort_by(|a, b| py_str_cmp(a, b));
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                py_json_string(k, out);
                out.push(':');
                write_canonical(&o[*k], out);
            }
            out.push('}');
        }
    }
}

/// Python sorts str keys by code point; Rust's str order is UTF-8 byte order,
/// which is the same order for valid UTF-8.
fn py_str_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.cmp(b)
}

fn py_json_string(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 || (c as u32) > 0x7e => {
                let mut buf = [0u16; 2];
                for unit in c.encode_utf16(&mut buf) {
                    out.push_str(&format!("\\u{:04x}", unit));
                }
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Python repr(float): shortest round-trip digits; fixed notation when the
/// decimal exponent is in [-4, 16), else d.ddde+XX.
pub fn py_float_repr(x: f64) -> String {
    let mut out = String::new();
    write_py_float(x, &mut out);
    out
}

/// Append Python's repr(float) of `x` (shortest round-trip digits, fixed
/// notation when -4 <= exponent < 16, else d.ddde+XX). No heap allocation.
pub fn write_py_float(x: f64, out: &mut String) {
    if x.is_nan() {
        out.push_str("NaN");
        return;
    }
    if x.is_infinite() {
        out.push_str(if x > 0.0 { "Infinity" } else { "-Infinity" });
        return;
    }
    if x == 0.0 {
        out.push_str(if x.is_sign_negative() { "-0.0" } else { "0.0" });
        return;
    }
    let mut buf = ryu::Buffer::new();
    let s = buf.format_finite(x).as_bytes();
    let (neg, body) = if s[0] == b'-' {
        (true, &s[1..])
    } else {
        (false, s)
    };
    let (mant, exp) = match body.iter().position(|&c| c == b'e' || c == b'E') {
        Some(i) => (
            &body[..i],
            std::str::from_utf8(&body[i + 1..])
                .ok()
                .and_then(|e| e.parse::<i32>().ok())
                .unwrap_or(0),
        ),
        None => (body, 0),
    };
    // significant digits (no point), and where the point sits
    let mut digits = [0u8; 40];
    let mut len = 0usize;
    let mut int_len = 0i32;
    let mut seen_point = false;
    for &c in mant {
        if c == b'.' {
            seen_point = true;
        } else {
            if len < digits.len() {
                digits[len] = c;
                len += 1;
            }
            if !seen_point {
                int_len += 1;
            }
        }
    }
    let lead = digits[..len].iter().take_while(|&&c| c == b'0').count();
    let mut dp = int_len + exp - lead as i32;
    let mut d = &digits[lead..len];
    while d.len() > 1 && d[d.len() - 1] == b'0' {
        d = &d[..d.len() - 1];
    }
    if d.is_empty() {
        d = b"0";
        dp = 1;
    }
    let ds = std::str::from_utf8(d).unwrap_or("0");
    let sci = dp - 1;
    if neg {
        out.push('-');
    }
    let n = ds.len() as i32;
    if (-4..16).contains(&sci) {
        if dp <= 0 {
            out.push_str("0.");
            for _ in 0..-dp {
                out.push('0');
            }
            out.push_str(ds);
        } else if dp >= n {
            out.push_str(ds);
            for _ in 0..dp - n {
                out.push('0');
            }
            out.push_str(".0");
        } else {
            out.push_str(&ds[..dp as usize]);
            out.push('.');
            out.push_str(&ds[dp as usize..]);
        }
    } else {
        out.push_str(&ds[..1]);
        if n > 1 {
            out.push('.');
            out.push_str(&ds[1..]);
        }
        out.push('e');
        out.push(if sci < 0 { '-' } else { '+' });
        let a = sci.unsigned_abs();
        if a < 10 {
            out.push('0');
        }
        out.push_str(itoa_u32(a, &mut [0u8; 10]));
    }
}

fn itoa_u32(mut v: u32, buf: &mut [u8; 10]) -> &str {
    let mut i = buf.len();
    loop {
        i -= 1;
        buf[i] = b'0' + (v % 10) as u8;
        v /= 10;
        if v == 0 {
            break;
        }
    }
    std::str::from_utf8(&buf[i..]).unwrap_or("0")
}

/// Every result records the model spec, a data hash and package versions.
pub fn model_manifest(model: Value, data: &Value, n: usize) -> Value {
    json!({
        "engine": ENGINE,
        "engineVersion": ENGINE_VERSION,
        "model": model,
        "dataHash": data_hash(data),
        "n": n,
        "packages": { "research-stats-rs": CRATE_VERSION },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn python_float_repr_matches_cpython() {
        let cases = [
            (21.0, "21.0"),
            (2.62, "2.62"),
            (0.1, "0.1"),
            (1e-5, "1e-05"),
            (0.0001, "0.0001"),
            (1e16, "1e+16"),
            (1234567890123456.0, "1234567890123456.0"),
            (12345678901234567.0, "1.2345678901234568e+16"),
            (-3.5e-7, "-3.5e-07"),
            (123.456, "123.456"),
            (1.5e300, "1.5e+300"),
            (5e-324, "5e-324"),
            (100.0, "100.0"),
        ];
        for (x, want) in cases {
            assert_eq!(py_float_repr(x), want, "repr({x})");
        }
    }

    #[test]
    fn python_string_escape() {
        let mut s = String::new();
        py_json_string("a\"b\\c\né😀", &mut s);
        assert_eq!(s, "\"a\\\"b\\\\c\\n\\u00e9\\ud83d\\ude00\"");
    }

    #[test]
    fn compliance_gate() {
        assert!(require_ipd_approval(None).is_err());
        assert!(require_ipd_approval(Some(&json!({"ipdApproved": true}))).is_err());
        assert!(require_ipd_approval(Some(&json!({"ipdApproved": 1, "evidenceId": "x"}))).is_err());
        assert!(
            require_ipd_approval(Some(&json!({"ipdApproved": true, "evidenceId": "  "}))).is_err()
        );
        assert!(
            require_ipd_approval(Some(&json!({"ipdApproved": true, "evidenceId": "irb-1"})))
                .is_ok()
        );
    }
}
