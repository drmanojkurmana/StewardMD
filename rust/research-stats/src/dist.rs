//! Distribution functions used for inference: normal, Student t, chi-square.
//!
//! Upper tails are computed directly (erfc, regularized incomplete beta and
//! gamma) so very small p-values keep their precision, as scipy's sf does.

// The coefficient tables are copied digit for digit from the published
// algorithms; extra digits are kept on purpose.
#![allow(clippy::excessive_precision)]
// `!(x > 0.0)` is deliberate: it also rejects NaN.
#![allow(clippy::neg_cmp_op_on_partial_ord)]

use statrs::distribution::{ContinuousCDF, StudentsT};
use statrs::function::beta::beta_reg;
use statrs::function::gamma::gamma_ur;

/// Complementary error function, W. J. Cody's rational approximations
/// (CALERF), about 1e-16 relative accuracy across the range.
pub fn erfc(x: f64) -> f64 {
    const A: [f64; 5] = [
        3.16112374387056560e00,
        1.13864154151050156e02,
        3.77485237685302021e02,
        3.20937758913846947e03,
        1.85777706184603153e-1,
    ];
    const B: [f64; 4] = [
        2.36012909523441209e01,
        2.44024637934444173e02,
        1.28261652607737228e03,
        2.84423683343917062e03,
    ];
    const C: [f64; 9] = [
        5.64188496988670089e-1,
        8.88314979438837594e00,
        6.61191906371416295e01,
        2.98635138197400131e02,
        8.81952221241769090e02,
        1.71204761263407058e03,
        2.05107837782607147e03,
        1.23033935479799725e03,
        2.15311535474403846e-8,
    ];
    const D: [f64; 8] = [
        1.57449261107098347e01,
        1.17693950891312499e02,
        5.37181101862009858e02,
        1.62138957456669019e03,
        3.29079923573345963e03,
        4.36261909014324716e03,
        3.43936767414372164e03,
        1.23033935480374942e03,
    ];
    const P: [f64; 6] = [
        3.05326634961232344e-1,
        3.60344899949804439e-1,
        1.25781726111229246e-1,
        1.60837851487422766e-2,
        6.58749161529837803e-4,
        1.63153871373020978e-2,
    ];
    const Q: [f64; 5] = [
        2.56852019228982242e00,
        1.87295284992346725e00,
        5.27905102951428412e-1,
        6.05183413124413191e-2,
        2.33520497626869185e-3,
    ];
    const SQRPI: f64 = 5.6418958354775628695e-1;
    if x.is_nan() {
        return f64::NAN;
    }
    let y = x.abs();
    let scaled_exp = |y: f64, r: f64| {
        let ysq = (y * 16.0).trunc() / 16.0;
        let del = (y - ysq) * (y + ysq);
        (-ysq * ysq).exp() * (-del).exp() * r
    };
    let r = if y <= 0.5 {
        let ysq = y * y;
        let mut xnum = A[4] * ysq;
        let mut xden = ysq;
        for i in 0..3 {
            xnum = (xnum + A[i]) * ysq;
            xden = (xden + B[i]) * ysq;
        }
        let erf = x * (xnum + A[3]) / (xden + B[3]);
        return 1.0 - erf;
    } else if y <= 4.0 {
        let mut xnum = C[8] * y;
        let mut xden = y;
        for i in 0..7 {
            xnum = (xnum + C[i]) * y;
            xden = (xden + D[i]) * y;
        }
        scaled_exp(y, (xnum + C[7]) / (xden + D[7]))
    } else if y >= 26.55 {
        0.0
    } else {
        let ysq = 1.0 / (y * y);
        let mut xnum = P[5] * ysq;
        let mut xden = ysq;
        for i in 0..4 {
            xnum = (xnum + P[i]) * ysq;
            xden = (xden + Q[i]) * ysq;
        }
        let r = ysq * (xnum + P[4]) / (xden + Q[4]);
        scaled_exp(y, (SQRPI - r) / y)
    };
    if x < 0.0 {
        2.0 - r
    } else {
        r
    }
}

/// Upper tail P(Z > z) of the standard normal.
pub fn norm_sf(z: f64) -> f64 {
    0.5 * erfc(z / std::f64::consts::SQRT_2)
}

/// Two-sided normal p-value.
pub fn norm_p2(z: f64) -> f64 {
    2.0 * norm_sf(z.abs())
}

/// Standard normal quantile, Wichura's AS 241 (PPND16), about 1e-16 relative accuracy.
pub fn norm_ppf(p: f64) -> f64 {
    if p.is_nan() || !(0.0..=1.0).contains(&p) {
        return f64::NAN;
    }
    if p == 0.0 {
        return f64::NEG_INFINITY;
    }
    if p == 1.0 {
        return f64::INFINITY;
    }
    let q = p - 0.5;
    if q.abs() <= 0.425 {
        let r = 0.180625 - q * q;
        return q
            * (((((((2509.0809287301226727 * r + 33430.575583588128105) * r
                + 67265.770927008700853)
                * r
                + 45921.953931549871457)
                * r
                + 13731.693765509461125)
                * r
                + 1971.5909503065514427)
                * r
                + 133.14166789178437745)
                * r
                + 3.387132872796366608)
            / (((((((5226.495278852545925 * r + 28729.085735721942674) * r
                + 39307.89580009271061)
                * r
                + 21213.794301586595867)
                * r
                + 5394.1960214247511077)
                * r
                + 687.1870074920579083)
                * r
                + 42.313330701600911252)
                * r
                + 1.0);
    }
    let mut r = if q < 0.0 { p } else { 1.0 - p };
    r = (-r.ln()).sqrt();
    let val = if r <= 5.0 {
        r -= 1.6;
        (((((((7.7454501427834140764e-4 * r + 0.0227238449892691845833) * r
            + 0.24178072517745061177)
            * r
            + 1.27045825245236838258)
            * r
            + 3.64784832476320460504)
            * r
            + 5.7694972214606914055)
            * r
            + 4.6303378461565452959)
            * r
            + 1.42343711074968357734)
            / (((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r
                + 0.0151986665636164571966)
                * r
                + 0.14810397642748007459)
                * r
                + 0.68976733498510000455)
                * r
                + 1.6763848301838038494)
                * r
                + 2.05319162663775882187)
                * r
                + 1.0)
    } else {
        r -= 5.0;
        (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r
            + 0.0012426609473880784386)
            * r
            + 0.026532189526576123093)
            * r
            + 0.29656057182850489123)
            * r
            + 1.7848265399172913358)
            * r
            + 5.4637849111641143699)
            * r
            + 6.6579046435011037772)
            / (((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r
                + 1.8463183175100546818e-5)
                * r
                + 7.868691311456132591e-4)
                * r
                + 0.0148753612908506148525)
                * r
                + 0.13692988092273580531)
                * r
                + 0.59983220655588793769)
                * r
                + 1.0)
    };
    if q < 0.0 {
        -val
    } else {
        val
    }
}

/// Two-sided Student t p-value on `df` degrees of freedom: I_{df/(df+t^2)}(df/2, 1/2).
pub fn t_p2(t: f64, df: f64) -> f64 {
    if !t.is_finite() {
        return if t.is_nan() { f64::NAN } else { 0.0 };
    }
    beta_reg(df / 2.0, 0.5, df / (df + t * t))
}

/// Student t quantile on `df` degrees of freedom. A statrs starting value is
/// polished by Newton steps on the exact tail so the result agrees with R's qt.
pub fn t_ppf(p: f64, df: f64) -> f64 {
    if !(p > 0.0 && p < 1.0) || !(df > 0.0) {
        return f64::NAN;
    }
    let dist = match StudentsT::new(0.0, 1.0, df) {
        Ok(d) => d,
        Err(_) => return f64::NAN,
    };
    let mut x = dist.inverse_cdf(p);
    if !x.is_finite() {
        x = norm_ppf(p);
    }
    for _ in 0..50 {
        // cdf via the incomplete beta for accuracy in both tails
        let tail = 0.5 * beta_reg(df / 2.0, 0.5, df / (df + x * x));
        let cdf = if x >= 0.0 { 1.0 - tail } else { tail };
        let pdf = statrs::distribution::Continuous::pdf(&dist, x);
        if pdf <= 0.0 || !pdf.is_finite() {
            break;
        }
        let step = (cdf - p) / pdf;
        x -= step;
        if step.abs() <= 1e-15 * (1.0 + x.abs()) {
            break;
        }
    }
    x
}

/// Upper tail of the chi-square distribution on `df` degrees of freedom.
pub fn chi2_sf(x: f64, df: f64) -> f64 {
    if x.is_nan() {
        return f64::NAN;
    }
    if x <= 0.0 {
        return 1.0;
    }
    gamma_ur(df / 2.0, x / 2.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64, tol: f64) {
        assert!((a - b).abs() <= tol * (1.0 + b.abs()), "{a} vs {b}");
    }

    #[test]
    fn against_r_reference_values() {
        // R: qnorm(0.975), qt(0.975, 29), qt(0.975, 3), pchisq(3.84, 1, lower=FALSE),
        // 2*pt(-2.5, 10), 2*pnorm(-3)
        close(norm_ppf(0.975), 1.959963984540054, 1e-15);
        close(norm_ppf(1e-10), -6.361340902404056, 1e-14);
        close(t_ppf(0.975, 29.0), 2.045229642132703, 1e-13);
        close(t_ppf(0.975, 3.0), 3.182446305283708, 1e-13);
        close(norm_p2(-6.0), 1.973175290075419e-09, 1e-13);
        close(erfc(0.3), 0.6713732405408726, 1e-15);
        close(erfc(5.5), 7.357847917974398e-15, 1e-13);
        close(chi2_sf(3.84, 1.0), 0.05004352124870519, 1e-12);
        close(t_p2(-2.5, 10.0), 0.03144684423660878, 1e-12);
        close(norm_p2(-3.0), 0.002699796063260207, 1e-13);
    }
}
