//! ResearchMD statistics in Rust.
//!
//! One core for three places: the phone app and Cloudflare Workers load it as
//! WebAssembly (see `wasm.rs` and `js/research-stats-wasm.js`), and native
//! builds can link it directly. It ports backend/research/stats (regression
//! and survival); the Reitsma diagnostic model stays in Python for now.
//!
//! IPD rule (plan 5C.3): every model refuses to run without the compliance
//! flag {"ipdApproved": true, "evidenceId": "..."}. No network, no model
//! calls; only aggregates and a sha256 data hash leave a call.
//!
//! JSON entry point: [`run_json`] takes
//! `{"family": "linear"|"logistic"|"km"|"logrank"|"cox", "compliance": {...},
//!   "level"?: 0.95, ...}` with
//! - linear:   `columns` (object of arrays), `formula` ("y ~ x1 + x2"), `robust`? ("HC3")
//! - logistic: `columns`, `formula`
//! - km:       `time`, `event` (arrays)
//! - logrank:  `time`, `event`, `group`
//! - cox:      `time`, `event`, `covariates` (object of arrays)
//!
//! and returns `{"ok": true, "result": {...}}` (same fields as the Python
//! functions) or `{"ok": false, "error": "<code or message>"}`.

pub mod common;
pub mod dist;
pub mod regression;
pub mod survival;
mod wasm;

pub use common::{StatsError, ENGINE, ENGINE_VERSION};
use serde_json::{json, Value};

/// Run one model from a parsed request.
pub fn run(request: &Value) -> common::Result<Value> {
    let obj = match request {
        Value::Object(o) => o,
        _ => return common::err("invalid_spec"),
    };
    let family = obj.get("family").and_then(Value::as_str).unwrap_or("");
    let compliance = obj.get("compliance");
    let level = common::level_of(obj)?;
    match family {
        "linear" => {
            let formula = obj.get("formula").and_then(Value::as_str).unwrap_or("");
            let robust = match obj.get("robust") {
                None | Some(Value::Null) => None,
                Some(Value::String(s)) => Some(s.as_str()),
                Some(_) => return common::err("invalid_robust"),
            };
            regression::linear_regression(obj.get("columns"), formula, compliance, robust, level)
        }
        "logistic" => {
            let formula = obj.get("formula").and_then(Value::as_str).unwrap_or("");
            regression::logistic_regression(obj.get("columns"), formula, compliance, level)
        }
        "km" => survival::kaplan_meier(obj.get("time"), obj.get("event"), compliance, level),
        "logrank" => survival::log_rank(
            obj.get("time"),
            obj.get("event"),
            obj.get("group"),
            compliance,
        ),
        "cox" => survival::cox_ph(
            obj.get("time"),
            obj.get("event"),
            obj.get("covariates"),
            compliance,
            level,
        ),
        _ => common::err("invalid_spec"),
    }
}

/// JSON text in, JSON text out. Never panics on bad input.
pub fn run_json(input: &str) -> String {
    let out = match serde_json::from_str::<Value>(input) {
        Err(_) => json!({"ok": false, "error": "invalid_json"}),
        Ok(req) => match run(&req) {
            Ok(result) => json!({"ok": true, "result": result}),
            Err(e) => json!({"ok": false, "error": e.message}),
        },
    };
    out.to_string()
}
