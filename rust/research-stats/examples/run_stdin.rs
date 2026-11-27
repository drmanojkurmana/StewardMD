//! Read one JSON request per line on stdin, write one JSON response per line.
//! Used by scripts/compare_python.py to replay the same inputs through Rust.
use std::io::{BufRead, Write};

fn main() {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line.expect("stdin");
        if line.trim().is_empty() {
            continue;
        }
        writeln!(out, "{}", research_stats::run_json(&line)).expect("stdout");
    }
}
