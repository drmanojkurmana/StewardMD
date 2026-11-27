//! `cargo run --release --example run_file -- paper.pdf [--max-pages N] [--time]`
//! prints the JSON (or, with --time, only the time taken, on stderr).
use research_pdf::{extract, Error, Limits};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let time = args.iter().any(|a| a == "--time");
    let mut limits = Limits::default();
    if let Some(i) = args.iter().position(|a| a == "--max-pages") {
        limits.max_pages = args[i + 1].parse().expect("--max-pages N");
    }
    let path = args
        .iter()
        .enumerate()
        .find(|(i, a)| !a.starts_with("--") && (*i == 0 || args[i - 1] != "--max-pages"))
        .map(|(_, a)| a)
        .expect("usage: run_file <pdf> [--max-pages N] [--time]");
    let data = std::fs::read(path).expect("read pdf");
    let t = std::time::Instant::now();
    let v = match extract(&data, &limits) {
        Ok(v) => v,
        Err(Error::Code(c)) => serde_json::json!({ "error": c }),
        Err(Error::Unsupported(r)) => serde_json::json!({ "unsupported": r }),
    };
    let dt = t.elapsed();
    if time {
        eprintln!("{:.1} ms", dt.as_secs_f64() * 1000.0);
    } else {
        println!("{v}");
    }
}
