//! R parity for the Rust stats core, the same gate as
//! backend/research/tests/test_stats_parity.py: abs diff <= 1e-4 OR rel diff
//! <= 1e-4; p-values below 1e-6 only pin the order of magnitude.
//!
//! Reads test/fixtures/research/parity-5d.json, made by
//! `Rscript scripts/research-parity-5d.R` (R + survival + mada). The file is
//! gitignored and never faked: when it is absent these tests print how to
//! make it and pass without checking. Set RESEARCH_PARITY_5D to read another
//! path. Set RESEARCH_PARITY_REQUIRED=1 (CI) to fail instead of skipping.

use research_stats::run;
use serde_json::{json, Value};
use std::path::PathBuf;

fn parity() -> Option<Value> {
    let path = std::env::var("RESEARCH_PARITY_5D")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../test/fixtures/research/parity-5d.json")
        });
    match std::fs::read_to_string(&path) {
        Ok(s) => Some(serde_json::from_str(&s).expect("parity json")),
        Err(_) => {
            if std::env::var("RESEARCH_PARITY_REQUIRED").as_deref() == Ok("1") {
                panic!("parity file missing: {}", path.display());
            }
            eprintln!(
                "SKIP: {} is absent. Generate it with `Rscript scripts/research-parity-5d.R`.",
                path.display()
            );
            None
        }
    }
}

fn compliance() -> Value {
    json!({"ipdApproved": true, "evidenceId": "parity-fixture-public-data"})
}

fn f(v: &Value) -> f64 {
    v.as_f64().unwrap_or_else(|| panic!("not a number: {v}"))
}

fn close(actual: &Value, expected: &Value, label: &str) {
    let (a, e) = (f(actual), f(expected));
    let abs = (a - e).abs();
    let rel = abs / e.abs().max(1e-12);
    assert!(
        abs <= 1e-4 || rel <= 1e-4,
        "{label}: got {a}, want {e} (abs {abs}, rel {rel})"
    );
}

fn close_p(actual: &Value, expected: &Value, label: &str) {
    if f(expected) < 1e-6 {
        assert!(f(actual) < 1e-6, "{label}: p stays tiny, got {actual}");
    } else {
        close(actual, expected, label);
    }
}

fn null_or_close(actual: &Value, expected: &Value, label: &str) {
    if expected.is_null() {
        assert!(actual.is_null(), "{label}: want null, got {actual}");
    } else {
        close(actual, expected, label);
    }
}

fn ok(req: Value) -> Value {
    match run(&req) {
        Ok(v) => v,
        Err(e) => panic!("model failed: {e}"),
    }
}

fn lung_rows(p: &Value) -> (Vec<Value>, Vec<Value>, Vec<Value>, Vec<Value>) {
    let rows = p["survival"]["rows"].as_array().unwrap();
    let time = rows.iter().map(|r| r["time"].clone()).collect();
    let event = rows
        .iter()
        .map(|r| json!(if f(&r["status"]) == 2.0 { 1 } else { 0 }))
        .collect();
    let age = rows.iter().map(|r| r["age"].clone()).collect();
    let sex = rows.iter().map(|r| r["sex"].clone()).collect();
    (time, event, age, sex)
}

#[test]
fn linear_matches_lm_and_hc3() {
    let Some(p) = parity() else { return };
    let r = &p["regression"];
    let res = ok(
        json!({"family": "linear", "columns": r["columns"], "formula": r["linear"]["formula"], "compliance": compliance()}),
    );
    let exp = &r["linear"];
    assert_eq!(res["n"], exp["n"]);
    assert_eq!(f(&res["dfResidual"]), f(&exp["dfResidual"]));
    for (got, want) in res["coefficients"]
        .as_array()
        .unwrap()
        .iter()
        .zip(exp["coefficients"].as_array().unwrap())
    {
        assert_eq!(got["term"], want["term"]);
        let t = want["term"].as_str().unwrap();
        close(&got["estimate"], &want["est"], &format!("lm {t} estimate"));
        close(&got["se"], &want["se"], &format!("lm {t} se"));
        close(&got["t"], &want["t"], &format!("lm {t} t"));
        close_p(&got["p"], &want["p"], &format!("lm {t} p"));
        close(&got["ciLower"], &want["lo"], &format!("lm {t} ciLower"));
        close(&got["ciUpper"], &want["hi"], &format!("lm {t} ciUpper"));
    }
    close(&res["sigma"], &exp["sigma"], "lm sigma");
    close(&res["r2"], &exp["r2"], "lm R2");
    close(&res["aic"], &exp["aic"], "lm AIC");

    let hc3 = ok(
        json!({"family": "linear", "columns": r["columns"], "formula": exp["formula"], "robust": "HC3", "compliance": compliance()}),
    );
    for (got, want) in hc3["coefficients"]
        .as_array()
        .unwrap()
        .iter()
        .zip(exp["hc3Se"].as_array().unwrap())
    {
        close(&got["se"], want, "HC3 se");
    }
}

#[test]
fn logistic_matches_glm() {
    let Some(p) = parity() else { return };
    let r = &p["regression"];
    let exp = &r["logistic"];
    let res = ok(
        json!({"family": "logistic", "columns": r["columns"], "formula": exp["formula"], "compliance": compliance()}),
    );
    assert_eq!(res["n"], exp["n"]);
    for (got, want) in res["coefficients"]
        .as_array()
        .unwrap()
        .iter()
        .zip(exp["coefficients"].as_array().unwrap())
    {
        assert_eq!(got["term"], want["term"]);
        let t = want["term"].as_str().unwrap();
        close(&got["estimate"], &want["est"], &format!("glm {t} estimate"));
        close(&got["se"], &want["se"], &format!("glm {t} se"));
        close(&got["z"], &want["z"], &format!("glm {t} z"));
        close_p(&got["p"], &want["p"], &format!("glm {t} p"));
        close(&got["ciLower"], &want["lo"], &format!("glm {t} ciLower"));
        close(&got["ciUpper"], &want["hi"], &format!("glm {t} ciUpper"));
    }
    close(&res["aic"], &exp["aic"], "glm AIC");
    close(&res["deviance"], &exp["deviance"], "glm deviance");
    close(
        &res["nullDeviance"],
        &exp["nullDeviance"],
        "glm null deviance",
    );
}

#[test]
fn kaplan_meier_matches_survfit() {
    let Some(p) = parity() else { return };
    let (time, event, _, _) = lung_rows(&p);
    let res = ok(json!({"family": "km", "time": time, "event": event, "compliance": compliance()}));
    let exp = &p["survival"]["km"];
    let steps = res["steps"].as_array().unwrap();
    let want_steps = exp["steps"].as_array().unwrap();
    assert_eq!(steps.len(), want_steps.len(), "one step per unique time");
    for (got, want) in steps.iter().zip(want_steps) {
        let lab = format!("km t={}", want["time"]);
        close(&got["time"], &want["time"], &lab);
        assert_eq!(f(&got["nRisk"]), f(&want["nRisk"]), "{lab} nRisk");
        assert_eq!(f(&got["nEvent"]), f(&want["nEvent"]), "{lab} nEvent");
        assert_eq!(f(&got["nCensor"]), f(&want["nCensor"]), "{lab} nCensor");
        close(&got["surv"], &want["surv"], &format!("{lab} surv"));
        null_or_close(&got["se"], &want["se"], &format!("{lab} se"));
        null_or_close(&got["ciLower"], &want["lo"], &format!("{lab} lo"));
        null_or_close(&got["ciUpper"], &want["hi"], &format!("{lab} hi"));
    }
    close(&res["median"], &exp["median"], "km median");
    null_or_close(&res["medianCiLower"], &exp["medianLo"], "km median lo");
    null_or_close(&res["medianCiUpper"], &exp["medianHi"], "km median hi");
    assert_eq!(f(&res["n"]), f(&exp["n"]));
    assert_eq!(f(&res["events"]), f(&exp["events"]));
}

#[test]
fn log_rank_matches_survdiff() {
    let Some(p) = parity() else { return };
    let (time, event, _, sex) = lung_rows(&p);
    let res = ok(
        json!({"family": "logrank", "time": time, "event": event, "group": sex, "compliance": compliance()}),
    );
    let exp = &p["survival"]["logrank"];
    close(&res["chisq"], &exp["chisq"], "logrank chisq");
    assert_eq!(f(&res["df"]), f(&exp["df"]));
    close_p(&res["p"], &exp["p"], "logrank p");
    for (got, want) in res["groups"]
        .as_array()
        .unwrap()
        .iter()
        .zip(exp["groups"].as_array().unwrap())
    {
        close(&got["group"], &want["group"], "logrank group label");
        assert_eq!(f(&got["n"]), f(&want["n"]));
        close(&got["observed"], &want["observed"], "logrank observed");
        close(&got["expected"], &want["expected"], "logrank expected");
    }
}

#[test]
fn cox_and_zph_match_coxph() {
    let Some(p) = parity() else { return };
    let (time, event, age, sex) = lung_rows(&p);
    let res = ok(json!({"family": "cox", "time": time, "event": event,
        "covariates": {"age": age, "sex": sex}, "compliance": compliance()}));
    let exp = &p["survival"]["cox"];
    for (got, want) in res["coefficients"]
        .as_array()
        .unwrap()
        .iter()
        .zip(exp["coefficients"].as_array().unwrap())
    {
        assert_eq!(got["term"], want["term"]);
        let t = want["term"].as_str().unwrap();
        close(&got["coef"], &want["coef"], &format!("cox {t} coef"));
        close(&got["se"], &want["se"], &format!("cox {t} se"));
        close(&got["z"], &want["z"], &format!("cox {t} z"));
        close_p(&got["p"], &want["p"], &format!("cox {t} p"));
        close(&got["hr"], &want["hr"], &format!("cox {t} hr"));
        close(
            &got["hrCiLower"],
            &want["lo"],
            &format!("cox {t} HR ciLower"),
        );
        close(
            &got["hrCiUpper"],
            &want["hi"],
            &format!("cox {t} HR ciUpper"),
        );
    }
    close(&res["logLik"], &exp["logLik"], "cox logLik");
    let ph = &p["survival"]["ph"];
    for (got, want) in res["phTest"]["terms"]
        .as_array()
        .unwrap()
        .iter()
        .zip(ph["terms"].as_array().unwrap())
    {
        assert_eq!(got["term"], want["term"]);
        close(&got["chisq"], &want["chisq"], "zph chisq");
        close_p(&got["p"], &want["p"], "zph p");
    }
    close(
        &res["phTest"]["global"]["chisq"],
        &ph["global"]["chisq"],
        "zph global chisq",
    );
    close_p(
        &res["phTest"]["global"]["p"],
        &ph["global"]["p"],
        "zph global p",
    );
}
