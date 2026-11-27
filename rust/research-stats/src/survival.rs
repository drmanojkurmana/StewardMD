//! Kaplan-Meier (Greenwood log CI, minmin median), log-rank (survdiff rho = 0),
//! Cox PH with Efron ties (Newton-Raphson) and the exact cox.zph(transform =
//! "km") score test.
//!
//! Port of backend/research/stats/survival.py; see that file's docstring for
//! the R reference calls on survival::lung (event = status == 2).

use crate::common::*;
use crate::dist::{chi2_sf, norm_p2};
use nalgebra::{DMatrix, DVector};
use serde_json::{json, Map, Value};

/// survival's minmin tolerance: sqrt(machine epsilon).
fn tol() -> f64 {
    f64::EPSILON.sqrt()
}

fn check_surv_input(time: Option<&Value>, event: Option<&Value>) -> Result<(Vec<f64>, Vec<f64>)> {
    let t = as_float_array(time, "time")?;
    let e = as_float_array(event, "event")?;
    if t.len() != e.len() || t.is_empty() {
        return err("time and event must be non-empty arrays of equal length");
    }
    if t.iter().any(|v| *v < 0.0) {
        return err("time must be non-negative");
    }
    if !e.iter().all(|v| *v == 0.0 || *v == 1.0) {
        return err("event must be 0/1");
    }
    if e.iter().sum::<f64>() == 0.0 {
        return err("no_events");
    }
    Ok((t, e))
}

/// Stable argsort by time (numpy argsort kind="stable").
fn order_by_time(t: &[f64]) -> Vec<usize> {
    let mut idx: Vec<usize> = (0..t.len()).collect();
    idx.sort_by(|&a, &b| t[a].partial_cmp(&t[b]).unwrap_or(std::cmp::Ordering::Equal));
    idx
}

/// Runs of equal time in a sorted array: (start, end) half-open.
fn time_runs(ts: &[f64]) -> Vec<(usize, usize)> {
    let mut runs = Vec::new();
    let n = ts.len();
    let mut i = 0;
    while i < n {
        let mut j = i;
        while j < n && ts[j] == ts[i] {
            j += 1;
        }
        runs.push((i, j));
        i = j;
    }
    runs
}

/// Event times and KM survival just after each event time (no CI).
fn km_curve(t: &[f64], e: &[f64]) -> (Vec<f64>, Vec<f64>) {
    let order = order_by_time(t);
    let ts: Vec<f64> = order.iter().map(|&i| t[i]).collect();
    let es: Vec<f64> = order.iter().map(|&i| e[i]).collect();
    let n = ts.len();
    let (mut times, mut surv) = (Vec::new(), Vec::new());
    let mut s = 1.0;
    for (i, j) in time_runs(&ts) {
        let d: f64 = es[i..j].iter().sum();
        if d > 0.0 {
            let n_risk = (n - i) as f64;
            s *= 1.0 - d / n_risk;
            times.push(ts[i]);
            surv.push(s);
        }
    }
    (times, surv)
}

/// survival's minmin: first x where y < 0.5 + tol, flat-spot midpoint rule.
fn minmin(y: &[Option<f64>], x: &[f64]) -> Option<f64> {
    let keep: Vec<usize> = (0..y.len())
        .filter(|&i| matches!(y[i], Some(v) if v < 0.5 + tol()))
        .collect();
    let first = *keep.first()?;
    let y1 = y[first]?;
    if (y1 - 0.5).abs() < tol() {
        for &i in &keep[1..] {
            if y[i]? < y1 {
                return Some((x[first] + x[i]) / 2.0);
            }
        }
    }
    Some(x[first])
}

pub fn kaplan_meier(
    time: Option<&Value>,
    event: Option<&Value>,
    compliance: Option<&Value>,
    level: f64,
) -> Result<Value> {
    require_ipd_approval(compliance)?;
    let (t, e) = check_surv_input(time, event)?;
    let z = z_value(level)?;
    let order = order_by_time(&t);
    let ts: Vec<f64> = order.iter().map(|&i| t[i]).collect();
    let es: Vec<f64> = order.iter().map(|&i| e[i]).collect();
    let n = ts.len();
    let mut steps = Vec::new();
    let (mut times, mut survs, mut los, mut his) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut s = 1.0_f64;
    let mut logvar = 0.0_f64;
    for (i, j) in time_runs(&ts) {
        let n_risk = n - i;
        let d = es[i..j].iter().sum::<f64>() as usize;
        let c = (j - i) - d;
        if d > 0 {
            s *= 1.0 - d as f64 / n_risk as f64;
            if n_risk > d {
                logvar += d as f64 / (n_risk as f64 * (n_risk - d) as f64);
            } else {
                logvar = f64::INFINITY;
            }
        }
        let se = if logvar.is_finite() {
            Some(logvar.sqrt())
        } else {
            None
        };
        let (lo, hi) = match se {
            None => (None, None),
            Some(_) if s == 0.0 => (None, None),
            Some(0.0) => (Some(s), Some(s)),
            Some(v) => (Some(s * (-z * v).exp()), Some((s * (z * v).exp()).min(1.0))),
        };
        steps.push(json!({
            "time": ts[i],
            "nRisk": n_risk,
            "nEvent": d,
            "nCensor": c,
            "surv": s,
            "se": opt_f64(se),
            "ciLower": opt_f64(lo),
            "ciUpper": opt_f64(hi),
        }));
        times.push(ts[i]);
        survs.push(Some(s));
        los.push(lo);
        his.push(hi);
    }
    let spec = json!({"family": "km", "level": level});
    let data = json!({"time": floats_value(&t), "event": floats_value(&e)});
    Ok(json!({
        "family": "km",
        "level": level,
        "steps": steps,
        "median": opt_f64(minmin(&survs, &times)),
        "medianCiLower": opt_f64(minmin(&los, &times)),
        "medianCiUpper": opt_f64(minmin(&his, &times)),
        "n": n,
        "events": e.iter().sum::<f64>() as usize,
        "manifest": model_manifest(spec, &data, n),
    }))
}

/// A group label as numpy's asarray(group).tolist() would give it back.
#[derive(Clone, Debug, PartialEq)]
enum Label {
    Int(i64),
    Float(f64),
    Str(String),
}

impl Label {
    fn to_value(&self) -> Value {
        match self {
            Label::Int(i) => json!(i),
            Label::Float(f) => json_f64(*f),
            Label::Str(s) => json!(s),
        }
    }
}

fn group_labels(group: Option<&Value>, n: usize) -> Result<Vec<Label>> {
    let arr = match group {
        Some(Value::Array(a)) if a.len() == n => a,
        _ => return err("group must be an array of the same length"),
    };
    let all_int = arr.iter().all(|v| v.as_i64().is_some());
    let all_num = arr.iter().all(|v| v.is_number());
    let all_str = arr.iter().all(|v| v.is_string());
    let mut out = Vec::with_capacity(n);
    for v in arr {
        let l = if all_int {
            Label::Int(v.as_i64().unwrap_or(0))
        } else if all_num {
            let f = v.as_f64().unwrap_or(f64::NAN);
            if !f.is_finite() {
                return err("group contains non-finite values");
            }
            Label::Float(f)
        } else if all_str {
            Label::Str(v.as_str().unwrap_or_default().to_string())
        } else {
            match v {
                Value::String(s) => Label::Str(s.clone()),
                Value::Number(num) => match num.as_i64() {
                    Some(i) => Label::Str(i.to_string()),
                    None => Label::Str(py_float_repr(num.as_f64().unwrap_or(f64::NAN))),
                },
                _ => return err("group must hold numbers or strings"),
            }
        };
        out.push(l);
    }
    Ok(out)
}

fn label_cmp(a: &Label, b: &Label) -> std::cmp::Ordering {
    match (a, b) {
        (Label::Int(x), Label::Int(y)) => x.cmp(y),
        (Label::Float(x), Label::Float(y)) => x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal),
        (Label::Str(x), Label::Str(y)) => x.cmp(y),
        _ => std::cmp::Ordering::Equal,
    }
}

fn solve(a: &DMatrix<f64>, b: &DVector<f64>) -> Option<DVector<f64>> {
    a.clone().lu().solve(b)
}

fn solve_mat(a: &DMatrix<f64>, b: &DMatrix<f64>) -> Option<DMatrix<f64>> {
    a.clone().lu().solve(b)
}

pub fn log_rank(
    time: Option<&Value>,
    event: Option<&Value>,
    group: Option<&Value>,
    compliance: Option<&Value>,
) -> Result<Value> {
    require_ipd_approval(compliance)?;
    let (t, e) = check_surv_input(time, event)?;
    let g = group_labels(group, t.len())?;
    let mut labels: Vec<Label> = Vec::new();
    for l in &g {
        if !labels.contains(l) {
            labels.push(l.clone());
        }
    }
    labels.sort_by(label_cmp);
    if labels.len() < 2 {
        return err("log_rank needs at least two groups");
    }
    let gi: Vec<usize> = g
        .iter()
        .map(|l| labels.iter().position(|x| x == l).unwrap_or(0))
        .collect();
    let ng = labels.len();
    let mut observed = vec![0.0; ng];
    let mut expected = vec![0.0; ng];
    let mut var = DMatrix::<f64>::zeros(ng, ng);
    let order = order_by_time(&t);
    let ts: Vec<f64> = order.iter().map(|&i| t[i]).collect();
    let es: Vec<f64> = order.iter().map(|&i| e[i]).collect();
    let gs: Vec<usize> = order.iter().map(|&i| gi[i]).collect();
    let n = ts.len();
    // number at risk per group, updated as rows leave the risk set
    let mut nr = vec![0.0; ng];
    for &k in &gs {
        nr[k] += 1.0;
    }
    for (i, j) in time_runs(&ts) {
        let d: f64 = es[i..j].iter().sum();
        if d > 0.0 {
            let n_risk = (n - i) as f64;
            let mut dd = vec![0.0; ng];
            for r in i..j {
                if es[r] == 1.0 {
                    dd[gs[r]] += 1.0;
                }
            }
            for k in 0..ng {
                observed[k] += dd[k];
                expected[k] += d * nr[k] / n_risk;
            }
            if n_risk > 1.0 {
                let f = d * (n_risk - d) / (n_risk - 1.0);
                for a in 0..ng {
                    let pa = nr[a] / n_risk;
                    for b in 0..ng {
                        let pb = nr[b] / n_risk;
                        let diag = if a == b { pa } else { 0.0 };
                        var[(a, b)] += f * (diag - pa * pb);
                    }
                }
            }
        }
        for r in i..j {
            nr[gs[r]] -= 1.0;
        }
    }
    let m = ng - 1;
    let u = DVector::from_fn(m, |k, _| observed[k] - expected[k]);
    let v = var.view((0, 0), (m, m)).into_owned();
    let sol = solve(&v, &u).ok_or_else(|| StatsError::new("singular matrix"))?;
    let chisq = u.dot(&sol);
    let df = m;
    let groups: Vec<Value> = (0..ng)
        .map(|k| {
            json!({
                "group": labels[k].to_value(),
                "n": gi.iter().filter(|&&x| x == k).count(),
                "observed": observed[k],
                "expected": expected[k],
            })
        })
        .collect();
    let spec = json!({"family": "logrank"});
    let data = json!({
        "time": floats_value(&t),
        "event": floats_value(&e),
        "group": g.iter().map(Label::to_value).collect::<Vec<_>>(),
    });
    Ok(json!({
        "family": "logrank",
        "chisq": chisq,
        "df": df,
        "p": chi2_sf(chisq, df as f64),
        "groups": groups,
        "manifest": model_manifest(spec, &data, n),
    }))
}

/// Rows sorted by time; one block per unique event time: (start, death rows).
fn event_blocks(ts: &[f64], es: &[f64]) -> Vec<(usize, Vec<usize>)> {
    time_runs(ts)
        .into_iter()
        .filter_map(|(i, j)| {
            let deaths: Vec<usize> = (i..j).filter(|&r| es[r] == 1.0).collect();
            if deaths.is_empty() {
                None
            } else {
                Some((i, deaths))
            }
        })
        .collect()
}

/// Risk-set sums from `start` to the end, built once from the back.
struct RiskSums {
    s0: Vec<f64>,
    s1: Vec<DVector<f64>>,
    s2: Vec<DMatrix<f64>>,
}

fn risk_sums(x: &DMatrix<f64>, w: &[f64]) -> RiskSums {
    let (n, p) = x.shape();
    let mut s0 = vec![0.0; n + 1];
    let mut s1 = vec![DVector::zeros(p); n + 1];
    let mut s2 = vec![DMatrix::zeros(p, p); n + 1];
    for i in (0..n).rev() {
        let xi = x.row(i).transpose();
        s0[i] = s0[i + 1] + w[i];
        s1[i] = &s1[i + 1] + w[i] * &xi;
        s2[i] = &s2[i + 1] + w[i] * &xi * xi.transpose();
    }
    RiskSums { s0, s1, s2 }
}

/// Efron partial log-likelihood, score and information at beta.
fn efron_terms(
    beta: &DVector<f64>,
    x: &DMatrix<f64>,
    blocks: &[(usize, Vec<usize>)],
) -> (f64, DVector<f64>, DMatrix<f64>) {
    let p = x.ncols();
    let eta = x * beta;
    let w: Vec<f64> = eta.iter().map(|v| v.exp()).collect();
    let rs = risk_sums(x, &w);
    let mut ll = 0.0;
    let mut score = DVector::zeros(p);
    let mut info = DMatrix::zeros(p, p);
    for (start, deaths) in blocks {
        let d = deaths.len();
        let mut s0d = 0.0;
        let mut s1d = DVector::zeros(p);
        let mut s2d = DMatrix::zeros(p, p);
        for &r in deaths {
            let xr = x.row(r).transpose();
            s0d += w[r];
            s1d += w[r] * &xr;
            s2d += w[r] * &xr * xr.transpose();
            ll += eta[r];
            score += xr;
        }
        for l in 0..d {
            let f = l as f64 / d as f64;
            let s0 = rs.s0[*start] - f * s0d;
            let s1 = &rs.s1[*start] - f * &s1d;
            let s2 = &rs.s2[*start] - f * &s2d;
            let xb = s1 / s0;
            ll -= s0.ln();
            score -= &xb;
            info += s2 / s0 - &xb * xb.transpose();
        }
    }
    (ll, score, info)
}

pub fn cox_ph(
    time: Option<&Value>,
    event: Option<&Value>,
    covariates: Option<&Value>,
    compliance: Option<&Value>,
    level: f64,
) -> Result<Value> {
    require_ipd_approval(compliance)?;
    let (t, e) = check_surv_input(time, event)?;
    let cov_obj = match covariates {
        Some(Value::Object(o)) if !o.is_empty() => o,
        _ => return err("covariates must be a non-empty object of named arrays"),
    };
    let names: Vec<String> = cov_obj.keys().cloned().collect();
    let mut cols = Vec::with_capacity(names.len());
    for name in &names {
        cols.push(as_float_array(cov_obj.get(name), name)?);
    }
    let n = t.len();
    if cols.iter().any(|c| c.len() != n) {
        return err("covariate length mismatch");
    }
    let p = names.len();
    if n <= p {
        return err("too_few_rows");
    }
    let order = order_by_time(&t);
    let ts: Vec<f64> = order.iter().map(|&i| t[i]).collect();
    let es: Vec<f64> = order.iter().map(|&i| e[i]).collect();
    let xs = DMatrix::from_fn(n, p, |i, j| cols[j][order[i]]);
    let blocks = event_blocks(&ts, &es);

    let mut beta = DVector::zeros(p);
    let (mut ll, mut score, mut info) = efron_terms(&beta, &xs, &blocks);
    let mut converged = false;
    for _ in 0..100 {
        let mut step = solve(&info, &score).ok_or_else(|| StatsError::new("cox_not_converged"))?;
        if step.amax() < 1e-10 {
            converged = true;
            break;
        }
        let (mut nll, mut nscore, mut ninfo) = efron_terms(&(&beta + &step), &xs, &blocks);
        let mut halt = 0;
        while nll < ll && halt < 25 {
            step *= 0.5;
            (nll, nscore, ninfo) = efron_terms(&(&beta + &step), &xs, &blocks);
            halt += 1;
        }
        if nll < ll {
            converged = true; // no ascent left at floating-point precision; checked below
            break;
        }
        let rel = if nll != 0.0 {
            (1.0 - ll / nll).abs()
        } else {
            (nll - ll).abs()
        };
        beta += &step;
        ll = nll;
        score = nscore;
        info = ninfo;
        if rel < 1e-14 {
            converged = true;
            break;
        }
    }
    if !converged {
        return err("cox_not_converged");
    }
    let rem = solve(&info, &score).ok_or_else(|| StatsError::new("cox_not_converged"))?;
    if rem.amax() > 1e-6 {
        return err("cox_not_converged");
    }
    if beta.iter().any(|b| !b.is_finite()) || beta.amax() > 1e6 {
        return err("cox_not_converged");
    }
    let vcov = info
        .clone()
        .try_inverse()
        .ok_or_else(|| StatsError::new("cox_not_converged"))?;
    let se: Vec<f64> = (0..p).map(|j| vcov[(j, j)].sqrt()).collect();
    if se.iter().any(|s| !s.is_finite() || *s > 1e6) {
        return err("cox_not_converged");
    }
    let z = z_value(level)?;
    let coefs: Vec<Value> = names
        .iter()
        .enumerate()
        .map(|(j, name)| {
            let (b, s) = (beta[j], se[j]);
            let zs = b / s;
            json!({
                "term": name,
                "coef": b,
                "se": s,
                "z": zs,
                "p": norm_p2(zs),
                "hr": b.exp(),
                "hrCiLower": (b - z * s).exp(),
                "hrCiUpper": (b + z * s).exp(),
            })
        })
        .collect();
    let (loglik, _, _) = efron_terms(&beta, &xs, &blocks);
    let ph = schoenfeld_ph_test(&t, &e, &beta, &ts, &es, &xs, &blocks, &names)?;
    let spec = json!({"family": "cox", "ties": "efron", "covariates": names, "level": level});
    let mut data = Map::new();
    data.insert("time".into(), floats_value(&t));
    data.insert("event".into(), floats_value(&e));
    for name in &names {
        // Python hashes the covariate lists exactly as given (ints stay ints).
        data.insert(name.clone(), cov_obj[name].clone());
    }
    Ok(json!({
        "family": "cox",
        "ties": "efron",
        "covariates": names,
        "level": level,
        "coefficients": coefs,
        "n": n,
        "events": e.iter().sum::<f64>() as usize,
        "logLik": loglik,
        "phTest": ph,
        "manifest": model_manifest(spec, &Value::Object(data), n),
    }))
}

#[allow(clippy::too_many_arguments)]
fn schoenfeld_ph_test(
    t: &[f64],
    e: &[f64],
    beta: &DVector<f64>,
    ts: &[f64],
    es: &[f64],
    xs: &DMatrix<f64>,
    blocks: &[(usize, Vec<usize>)],
    names: &[String],
) -> Result<Value> {
    let (event_times, surv) = km_curve(t, e);
    let mut prefix = vec![1.0];
    prefix.extend(surv.iter().copied());
    // g(t) = 1 - KM(t-), searchsorted(event_times, ts, side="left")
    let g: Vec<f64> = ts
        .iter()
        .map(|&tv| {
            let idx = event_times.partition_point(|&et| et < tv);
            1.0 - prefix[idx]
        })
        .collect();
    let (mut gsum, mut gcount) = (0.0, 0.0);
    for i in 0..g.len() {
        if es[i] == 1.0 {
            gsum += g[i];
            gcount += 1.0;
        }
    }
    let gmean = gsum / gcount;
    let gc: Vec<f64> = g.iter().map(|v| v - gmean).collect();
    let p = xs.ncols();
    let mut u = DVector::zeros(p);
    let mut ibb = DMatrix::zeros(p, p);
    let mut ibt = DMatrix::zeros(p, p);
    let mut itt = DMatrix::zeros(p, p);
    let eta = xs * beta;
    let emax = eta.max();
    let w: Vec<f64> = eta.iter().map(|v| (v - emax).exp()).collect();
    let rs = risk_sums(xs, &w);
    for (start, deaths) in blocks {
        let d = deaths.len();
        let mut s0d = 0.0;
        let mut s1d = DVector::zeros(p);
        let mut s2d = DMatrix::zeros(p, p);
        let mut xd_sum = DVector::zeros(p);
        for &r in deaths {
            let xr = xs.row(r).transpose();
            s0d += w[r];
            s1d += w[r] * &xr;
            s2d += w[r] * &xr * xr.transpose();
            xd_sum += xr;
        }
        let mut a = DMatrix::zeros(p, p);
        let mut xb_sum = DVector::zeros(p);
        for l in 0..d {
            let f = l as f64 / d as f64;
            let s0 = rs.s0[*start] - f * s0d;
            let xb = (&rs.s1[*start] - f * &s1d) / s0;
            a += (&rs.s2[*start] - f * &s2d) / s0 - &xb * xb.transpose();
            xb_sum += xb;
        }
        let r_t = xd_sum - xb_sum;
        let gt = gc[deaths[0]];
        u += gt * r_t;
        ibb += &a;
        ibt += gt * &a;
        itt += gt * gt * &a;
    }
    let sol = solve_mat(&ibb, &ibt).ok_or_else(|| StatsError::new("singular matrix"))?;
    let schur = itt - ibt.transpose() * sol;
    let terms: Vec<Value> = names
        .iter()
        .enumerate()
        .map(|(j, name)| {
            let chisq = u[j].powi(2) / schur[(j, j)];
            json!({"term": name, "chisq": chisq, "df": 1, "p": chi2_sf(chisq, 1.0)})
        })
        .collect();
    let gsol = solve(&schur, &u).ok_or_else(|| StatsError::new("singular matrix"))?;
    let global = u.dot(&gsol);
    Ok(json!({
        "transform": "km",
        "terms": terms,
        "global": {"chisq": global, "df": p, "p": chi2_sf(global, p as f64)},
    }))
}
