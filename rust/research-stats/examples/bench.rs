//! Time each model on the requests in a JSON-lines file:
//!   cargo run --release --example bench -- requests.jsonl
use std::time::Instant;

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("usage: bench requests.jsonl");
    let text = std::fs::read_to_string(path).expect("read");
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let t0 = Instant::now();
        let req: serde_json::Value = serde_json::from_str(line).expect("json");
        let parse = t0.elapsed();
        let mut best = f64::MAX;
        for _ in 0..3 {
            let t = Instant::now();
            let r = research_stats::run(&req);
            best = best.min(t.elapsed().as_secs_f64() * 1e3);
            assert!(r.is_ok(), "{:?}", r.err());
        }
        println!(
            "{:9} parse {:6.1} ms  model {:7.1} ms",
            req["family"].as_str().unwrap_or("?"),
            parse.as_secs_f64() * 1e3,
            best
        );
    }
}
