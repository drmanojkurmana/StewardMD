//! Linear (OLS, optional HC3) and logistic (binomial GLM by IRLS) regression.
//!
//! Port of backend/research/stats/regression.py. R parity calls:
//! lm(mpg ~ wt + hp) and glm(am ~ wt + hp, family = binomial) on mtcars.
//! OLS inference uses t on n - k df (as lm); logistic uses the normal (as glm).
//! The OLS AIC counts the residual variance as a parameter, as R's AIC(lm).
//!
//! One deliberate difference from the Python: with robust = "HC3" the Python
//! takes p from the normal distribution (statsmodels' default for robust
//! covariances) while its CI and its own docstring use t on n - k df. Here p
//! uses t too, so p and the CI agree.

use crate::common::*;
use crate::dist::{norm_p2, t_p2, t_ppf};
use nalgebra::{DMatrix, DVector};
use serde_json::{json, Map, Value};

/// 'y ~ x1 + x2' or 'y ~ 1'. Additive numeric terms only.
pub fn parse_formula(formula: &str) -> Result<(String, Vec<String>)> {
    if formula.matches('~').count() != 1 {
        return err("invalid_formula");
    }
    let mut parts = formula.splitn(2, '~');
    let lhs = parts.next().unwrap_or("");
    let rhs = parts.next().unwrap_or("");
    let y = lhs.trim().to_string();
    let terms: Vec<String> = if rhs.trim() == "1" {
        vec![]
    } else {
        rhs.split('+').map(|t| t.trim().to_string()).collect()
    };
    if y.is_empty() || terms.iter().any(|t| t.is_empty()) {
        return err("invalid_formula");
    }
    let mut seen = std::collections::HashSet::new();
    for t in &terms {
        if !seen.insert(t.as_str()) || *t == y {
            return err("invalid_formula");
        }
    }
    for name in std::iter::once(&y).chain(terms.iter()) {
        // Python: name.replace("_", "").isalnum() (Unicode letters and digits)
        let stripped: String = name.chars().filter(|c| *c != '_').collect();
        if stripped.is_empty() || !stripped.chars().all(|c| c.is_alphanumeric()) {
            return err("invalid_formula");
        }
    }
    Ok((y, terms))
}

struct Design {
    y: DVector<f64>,
    x: DMatrix<f64>,
    data: Value,
}

fn design(columns: Option<&Value>, y_name: &str, x_names: &[String]) -> Result<Design> {
    let mut names = vec![y_name.to_string()];
    names.extend(x_names.iter().cloned());
    let arrays = check_columns(columns, &names)?;
    let n = arrays[0].len();
    let k = x_names.len() + 1;
    if n <= k {
        return err("too_few_rows");
    }
    let x = DMatrix::from_fn(n, k, |i, j| if j == 0 { 1.0 } else { arrays[j][i] });
    let y = DVector::from_column_slice(&arrays[0]);
    let mut data = Map::new();
    for (name, arr) in names.iter().zip(arrays.iter()) {
        data.insert(name.clone(), floats_value(arr));
    }
    Ok(Design {
        y,
        x,
        data: Value::Object(data),
    })
}

/// (X'X)^-1 from a thin QR of X; errors when X is rank deficient.
fn xtx_inverse(
    x: &DMatrix<f64>,
) -> Result<(
    DMatrix<f64>,
    nalgebra::linalg::QR<f64, nalgebra::Dyn, nalgebra::Dyn>,
)> {
    let qr = x.clone().qr();
    let r = qr.r();
    let k = r.ncols();
    let scale = (0..k).map(|i| r[(i, i)].abs()).fold(0.0_f64, f64::max);
    for i in 0..k {
        // also catches NaN on the diagonal
        #[allow(clippy::neg_cmp_op_on_partial_ord)]
        if !(r[(i, i)].abs() > scale * 1e-12) {
            return err("singular_design");
        }
    }
    let r_inv = r
        .try_inverse()
        .ok_or_else(|| StatsError::new("singular_design"))?;
    let xtx_inv = &r_inv * r_inv.transpose();
    Ok((xtx_inv, qr))
}

#[allow(clippy::too_many_arguments)]
fn coef_record(
    term: &str,
    est: f64,
    se: f64,
    stat: f64,
    p: f64,
    lo: f64,
    hi: f64,
    stat_name: &str,
) -> Value {
    let mut m = Map::new();
    m.insert("term".into(), json!(term));
    m.insert("estimate".into(), json_f64(est));
    m.insert("se".into(), json_f64(se));
    m.insert(stat_name.into(), json_f64(stat));
    m.insert("p".into(), json_f64(p));
    m.insert("ciLower".into(), json_f64(lo));
    m.insert("ciUpper".into(), json_f64(hi));
    Value::Object(m)
}

pub fn linear_regression(
    columns: Option<&Value>,
    formula: &str,
    compliance: Option<&Value>,
    robust: Option<&str>,
    level: f64,
) -> Result<Value> {
    require_ipd_approval(compliance)?;
    if !matches!(robust, None | Some("HC3")) {
        return err("invalid_robust");
    }
    let (y_name, x_names) = parse_formula(formula)?;
    let d = design(columns, &y_name, &x_names)?;
    let (n, k) = d.x.shape();
    let (xtx_inv, qr) = xtx_inverse(&d.x)?;
    let qty = qr.q().transpose() * &d.y;
    let beta = qr
        .r()
        .solve_upper_triangular(&qty)
        .ok_or_else(|| StatsError::new("singular_design"))?;
    let fitted = &d.x * &beta;
    let resid = &d.y - fitted;
    let ssr = resid.dot(&resid);
    let df = (n - k) as f64;
    let sigma2 = ssr / df;
    let cov = if robust.is_some() {
        // HC3: (X'X)^-1 X' diag(e^2 / (1 - h)^2) X (X'X)^-1
        let xa = &d.x * &xtx_inv; // n x k
        let mut meat = DMatrix::<f64>::zeros(k, k);
        for i in 0..n {
            let xi = d.x.row(i);
            let h = xa.row(i).dot(&xi);
            let w = (resid[i] / (1.0 - h)).powi(2);
            meat += w * xi.transpose() * xi;
        }
        &xtx_inv * meat * &xtx_inv
    } else {
        sigma2 * &xtx_inv
    };
    z_value(level)?; // validates level
    let crit = t_ppf((1.0 + level) / 2.0, df);
    let mut terms = vec!["Intercept".to_string()];
    terms.extend(x_names.iter().cloned());
    let mut coefs = Vec::with_capacity(k);
    for (j, term) in terms.iter().enumerate() {
        let est = beta[j];
        let se = cov[(j, j)].sqrt();
        let t = est / se;
        coefs.push(coef_record(
            term,
            est,
            se,
            t,
            t_p2(t, df),
            est - crit * se,
            est + crit * se,
            "t",
        ));
    }
    let mean_y = d.y.mean();
    let sst: f64 = d.y.iter().map(|v| (v - mean_y).powi(2)).sum();
    let r2 = 1.0 - ssr / sst;
    let nf = n as f64;
    let aic =
        nf * ((2.0 * std::f64::consts::PI).ln() + (ssr / nf).ln() + 1.0) + 2.0 * (k as f64 + 1.0);
    let robust_v = robust.map(Value::from).unwrap_or(Value::Null);
    let spec = json!({"family": "linear", "formula": formula, "robust": robust_v, "level": level});
    Ok(json!({
        "family": "linear",
        "formula": formula,
        "robust": robust_v,
        "level": level,
        "coefficients": coefs,
        "n": n,
        "dfResidual": n - k,
        "sigma": sigma2.sqrt(),
        "r2": r2,
        "aic": aic,
        "manifest": model_manifest(spec, &d.data, n),
    }))
}

fn binom_deviance(y: &DVector<f64>, mu: &DVector<f64>) -> f64 {
    let mut dev = 0.0;
    for i in 0..y.len() {
        let (yi, mi) = (y[i], mu[i]);
        if yi > 0.0 {
            dev += 2.0 * yi * (yi / mi).ln();
        }
        if yi < 1.0 {
            dev += 2.0 * (1.0 - yi) * ((1.0 - yi) / (1.0 - mi)).ln();
        }
    }
    dev
}

fn expit(e: f64) -> f64 {
    if e >= 0.0 {
        1.0 / (1.0 + (-e).exp())
    } else {
        let z = e.exp();
        z / (1.0 + z)
    }
}

pub fn logistic_regression(
    columns: Option<&Value>,
    formula: &str,
    compliance: Option<&Value>,
    level: f64,
) -> Result<Value> {
    require_ipd_approval(compliance)?;
    let (y_name, x_names) = parse_formula(formula)?;
    let d = design(columns, &y_name, &x_names)?;
    let (n, k) = d.x.shape();
    if !d.y.iter().all(|v| *v == 0.0 || *v == 1.0) {
        return err("outcome_not_binary");
    }
    let s: f64 = d.y.sum();
    if s == 0.0 || s == n as f64 {
        return err("outcome_constant");
    }
    // IRLS from mu = (y + 0.5) / 2, as statsmodels and R's glm start.
    let mut mu = d.y.map(|v| (v + 0.5) / 2.0);
    let mut eta = mu.map(|m| (m / (1.0 - m)).ln());
    let mut dev = binom_deviance(&d.y, &mu);
    let mut beta = DVector::<f64>::zeros(k);
    let mut converged = false;
    let mut iterations = 0usize;
    let eps = 10.0 * f64::EPSILON;
    for it in 1..=200 {
        iterations = it;
        let w = mu.map(|m| (m * (1.0 - m)).max(1e-300));
        let z = DVector::from_fn(n, |i, _| eta[i] + (d.y[i] - mu[i]) / w[i]);
        let sw = w.map(f64::sqrt);
        let xw = DMatrix::from_fn(n, k, |i, j| d.x[(i, j)] * sw[i]);
        let zw = z.component_mul(&sw);
        let qr = xw.qr();
        let qtz = qr.q().transpose() * zw;
        beta = match qr.r().solve_upper_triangular(&qtz) {
            Some(b) => b,
            None => return err("logistic_not_converged"),
        };
        eta = &d.x * &beta;
        mu = eta.map(|e| expit(e).clamp(eps, 1.0 - eps));
        let new_dev = binom_deviance(&d.y, &mu);
        if (new_dev - dev).abs() <= 1e-12 * (new_dev.abs() + 0.1) {
            dev = new_dev;
            converged = true;
            break;
        }
        dev = new_dev;
    }
    if !converged || beta.iter().any(|b| !b.is_finite()) {
        return err("logistic_not_converged");
    }
    // Fisher information at the solution: X' W X
    let w = mu.map(|m| m * (1.0 - m));
    let xw = DMatrix::from_fn(n, k, |i, j| d.x[(i, j)] * w[i].sqrt());
    let (cov, _) = xtx_inverse(&xw).map_err(|_| StatsError::new("logistic_not_converged"))?;
    let z = z_value(level)?;
    let mut terms = vec!["Intercept".to_string()];
    terms.extend(x_names.iter().cloned());
    let mut coefs = Vec::with_capacity(k);
    for (j, term) in terms.iter().enumerate() {
        let est = beta[j];
        let se = cov[(j, j)].sqrt();
        if !se.is_finite() || se > 1e6 {
            return err("logistic_not_converged");
        }
        let zs = est / se;
        coefs.push(coef_record(
            term,
            est,
            se,
            zs,
            norm_p2(zs),
            est - z * se,
            est + z * se,
            "z",
        ));
    }
    let ybar = s / n as f64;
    let null_mu = DVector::from_element(n, ybar);
    let null_dev = binom_deviance(&d.y, &null_mu);
    let spec = json!({"family": "logistic", "formula": formula, "level": level});
    Ok(json!({
        "family": "logistic",
        "formula": formula,
        "level": level,
        "coefficients": coefs,
        "n": n,
        "aic": dev + 2.0 * k as f64,
        "deviance": dev,
        "nullDeviance": null_dev,
        "iterations": iterations,
        "manifest": model_manifest(spec, &d.data, n),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formula_parser() {
        assert_eq!(
            parse_formula("y ~ a + b").unwrap(),
            ("y".into(), vec!["a".into(), "b".into()])
        );
        assert_eq!(parse_formula("y ~ 1").unwrap(), ("y".into(), vec![]));
        for bad in [
            "y ~ a*b",
            "y ~ a + a",
            "y ~ y",
            "~ a",
            "y ~ a ~ b",
            "y ~ log(a)",
            "y ~ a + ",
        ] {
            assert!(parse_formula(bad).is_err(), "{bad}");
        }
    }
}
