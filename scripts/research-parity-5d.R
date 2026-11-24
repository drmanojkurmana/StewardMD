#!/usr/bin/env Rscript
# ResearchMD Phase 5D.2 / 5D.3 R parity driver.
#
# Generates test/fixtures/research/parity-5d.json (gitignored, never
# committed) for backend/research/tests/test_stats_parity.py, which compares
# the canonical Python stats package (backend/research/stats/) against R.
# Runs in CI (parity-5d job in .github/workflows/research-ci.yml) and locally:
#
#   R_LIBS_USER=~/Library/R/library Rscript scripts/research-parity-5d.R
#
# Pinned reference calls (any change is a reviewed contract change):
#   lm(mpg ~ wt + hp, data = mtcars)                  t inference, AIC(lm)
#   HC3 SEs hand-computed from the hat matrix:
#     solve(X'X) %*% X' diag((e/(1-h))^2) %*% X %*% solve(X'X)
#   glm(am ~ wt + hp, family = binomial, data = mtcars)  z inference,
#     confint.default (Wald), AIC(glm)
#   survfit(Surv(time, event) ~ 1, data = lung)       event = status == 2;
#     steps at every unique time; std.err = Greenwood SE of log S;
#     conf.type = "log"; median + CI via summary()$table (minmin rule)
#   survdiff(Surv(time, event) ~ sex, data = lung, rho = 0)
#   coxph(Surv(time, event) ~ age + sex, data = lung, ties = "efron")
#   cox.zph(fit, transform = "km")                    exact score test
#   mada::reitsma(counts)                             defaults: correction 0.5,
#     correction.control "all", method "reml" (mvmeta), alphasens = alphafpr = 1
#   mada::sroc(fit, fpr = 1:99/100, type = "ruttergatsonis" | "naive")
#
# Datasets are embedded in the JSON so Python fits the exact same rows:
#   mtcars (base R), survival::lung, mada::AuditC, mada::Dementia.
# Numeric gate (plan section 12): abs diff <= 1e-4 OR rel diff <= 1e-4.

stopifnot(dir.exists("test/fixtures/research"))
OUT <- "test/fixtures/research/parity-5d.json"

for (p in c("survival", "mada")) {
  if (!requireNamespace(p, quietly = TRUE)) {
    stop(sprintf(paste0("package '%s' is not installed. Install it first:\n",
                        "  install.packages(%s, repos=\"https://cloud.r-project.org\")"),
                 p, dQuote(p)))
  }
}
suppressMessages(library(survival))
suppressMessages(library(mada))

LEVEL <- 0.95

## ---- minimal JSON writer (base R only; same shape as research-parity.R) ----
json_escape <- function(s) {
  s <- gsub("\\", "\\\\", s, fixed = TRUE)
  s <- gsub("\"", "\\\"", s, fixed = TRUE)
  s <- gsub("\n", "\\n", s, fixed = TRUE)
  s <- gsub("\r", "\\r", s, fixed = TRUE)
  s <- gsub("\t", "\\t", s, fixed = TRUE)
  s <- gsub("\f", "\\f", s, fixed = TRUE)
  paste0("\"", s, "\"")
}
json_num <- function(x) {
  if (length(x) != 1L || !is.finite(x)) stop("non-finite number in JSON output")
  formatC(unname(x), digits = 15L, format = "g")
}
json_val <- function(x) {
  if (is.null(x)) return("null")
  if (is.logical(x) && length(x) == 1L) return(if (x) "true" else "false")
  if (is.character(x) && length(x) == 1L) return(json_escape(x))
  if ((is.numeric(x) || is.integer(x)) && length(x) == 1L) return(json_num(x))
  if (is.list(x)) {
    n <- names(x)
    if (!is.null(n) && all(nzchar(n))) {
      kv <- paste(vapply(n, json_escape, character(1)),
                  vapply(x, json_val, character(1)), sep = ":")
      return(paste0("{", paste(kv, collapse = ","), "}"))
    }
    return(paste0("[", paste(vapply(x, json_val, character(1)),
                             collapse = ","), "]"))
  }
  if (is.atomic(x) && length(x) > 1L) {
    return(paste0("[",
                  paste(vapply(seq_along(x), function(i) json_val(x[i]),
                               character(1)), collapse = ","),
                  "]"))
  }
  stop("unsupported JSON value")
}
na_null <- function(x) if (length(x) == 1L && is.na(x)) NULL else x

## ---- regression references (mtcars) ----
mt <- mtcars
lin <- lm(mpg ~ wt + hp, data = mt)
sl <- summary(lin)
ci_lin <- confint(lin, level = LEVEL)
X <- model.matrix(lin)
e <- resid(lin)
h <- hatvalues(lin)
V_hc3 <- solve(crossprod(X)) %*% t(X) %*% diag((e / (1 - h))^2) %*% X %*% solve(crossprod(X))
r_term <- function(nm) if (nm == "(Intercept)") "Intercept" else nm
lin_coef <- lapply(seq_len(nrow(sl$coefficients)), function(j) {
  list(term = r_term(rownames(sl$coefficients)[j]),
       est = unname(sl$coefficients[j, 1]), se = unname(sl$coefficients[j, 2]),
       t = unname(sl$coefficients[j, 3]), p = unname(sl$coefficients[j, 4]),
       lo = unname(ci_lin[j, 1]), hi = unname(ci_lin[j, 2]))
})
logit <- glm(am ~ wt + hp, family = binomial, data = mt)
sg <- summary(logit)
ci_g <- confint.default(logit, level = LEVEL)
log_coef <- lapply(seq_len(nrow(sg$coefficients)), function(j) {
  list(term = r_term(rownames(sg$coefficients)[j]),
       est = unname(sg$coefficients[j, 1]), se = unname(sg$coefficients[j, 2]),
       z = unname(sg$coefficients[j, 3]), p = unname(sg$coefficients[j, 4]),
       lo = unname(ci_g[j, 1]), hi = unname(ci_g[j, 2]))
})
regression <- list(
  dataset = "mtcars",
  columns = list(mpg = mt$mpg, wt = mt$wt, hp = mt$hp, am = mt$am),
  linear = list(formula = "mpg ~ wt + hp", coefficients = lin_coef,
                hc3Se = as.list(unname(sqrt(diag(V_hc3)))),
                sigma = unname(sl$sigma), dfResidual = unname(lin$df.residual),
                r2 = unname(sl$r.squared), aic = unname(AIC(lin)), n = nrow(mt)),
  logistic = list(formula = "am ~ wt + hp", coefficients = log_coef,
                  aic = unname(AIC(logit)), deviance = unname(logit$deviance),
                  nullDeviance = unname(logit$null.deviance), n = nrow(mt))
)

## ---- survival references (lung, event = status == 2) ----
d <- survival::lung
d$event <- as.integer(d$status == 2)
stopifnot(sum(d$event) == 165L, nrow(d) == 228L,
          all(complete.cases(d[, c("time", "event", "age", "sex")])))
km <- survfit(Surv(time, event) ~ 1, data = d)
km_tab <- summary(km)$table
km_steps <- lapply(seq_along(km$time), function(i) {
  list(time = unname(km$time[i]), nRisk = unname(km$n.risk[i]),
       nEvent = unname(km$n.event[i]), nCensor = unname(km$n.censor[i]),
       surv = unname(km$surv[i]), se = unname(km$std.err[i]),
       lo = na_null(unname(km$lower[i])), hi = na_null(unname(km$upper[i])))
})
lr <- survdiff(Surv(time, event) ~ sex, data = d, rho = 0)
lr_df <- length(lr$n) - 1L
lr_groups <- lapply(seq_along(lr$n), function(k) {
  list(group = as.numeric(sub("sex=", "", names(lr$n)[k])), n = unname(lr$n[k]),
       observed = unname(lr$obs[k]), expected = unname(lr$exp[k]))
})
cx <- coxph(Surv(time, event) ~ age + sex, data = d, ties = "efron")
scx <- summary(cx)
ci_cx <- confint.default(cx, level = LEVEL)
stopifnot(any(duplicated(d$time[d$event == 1])))  # ties exercise the Efron path
cx_coef <- lapply(seq_len(nrow(scx$coefficients)), function(j) {
  list(term = rownames(scx$coefficients)[j],
       coef = unname(scx$coefficients[j, 1]), se = unname(scx$coefficients[j, 3]),
       z = unname(scx$coefficients[j, 4]), p = unname(scx$coefficients[j, 5]),
       hr = unname(scx$coefficients[j, 2]),
       lo = unname(exp(ci_cx[j, 1])), hi = unname(exp(ci_cx[j, 2])))
})
zph <- cox.zph(cx, transform = "km")
zph_terms <- lapply(seq_len(nrow(zph$table) - 1L), function(j) {
  list(term = rownames(zph$table)[j], chisq = unname(zph$table[j, 1]),
       df = unname(zph$table[j, 2]), p = unname(zph$table[j, 3]))
})
survival_refs <- list(
  dataset = "lung", eventRule = "status == 2",
  rows = lapply(seq_len(nrow(d)), function(i) {
    list(time = d$time[i], status = d$status[i], age = d$age[i], sex = d$sex[i])
  }),
  km = list(steps = km_steps, median = unname(km_tab["median"]),
            medianLo = na_null(unname(km_tab["0.95LCL"])),
            medianHi = na_null(unname(km_tab["0.95UCL"])),
            n = nrow(d), events = sum(d$event)),
  logrank = list(group = "sex", chisq = unname(lr$chisq), df = lr_df,
                 p = unname(pchisq(lr$chisq, lr_df, lower.tail = FALSE)),
                 groups = lr_groups),
  cox = list(formula = "~ age + sex", ties = "efron", coefficients = cx_coef,
             n = nrow(d), events = sum(d$event), logLik = unname(cx$loglik[2])),
  ph = list(transform = "km", terms = zph_terms,
            global = list(chisq = unname(zph$table["GLOBAL", 1]),
                          df = unname(zph$table["GLOBAL", 2]),
                          p = unname(zph$table["GLOBAL", 3])))
)

## ---- diagnostic references (mada's own data) ----
diag_case <- function(name) {
  data(list = name, package = "mada")
  counts <- get(name)
  stopifnot(all(c("TP", "FN", "FP", "TN") %in% names(counts)))
  fit <- reitsma(counts)
  stopifnot(fit$converged)
  sf <- fit$freqdata1  # corrected counts (correction.control = "all")
  per_study <- lapply(seq_len(nrow(sf)), function(i) {
    list(id = sprintf("%s-%d", name, i),
         sens = unname(sf$tpi[i] / (sf$tpi[i] + sf$fni[i])),
         spec = unname(sf$tni[i] / (sf$fpi[i] + sf$tni[i])))
  })
  coef <- as.numeric(fit$coefficients)
  se <- sqrt(diag(fit$vcov))
  zv <- qnorm((1 + LEVEL) / 2)
  coef_rec <- lapply(1:2, function(j) {
    list(term = c("tsens", "tfpr")[j], est = coef[j], se = se[j],
         z = coef[j] / se[j], p = 2 * (1 - pnorm(abs(coef[j] / se[j]))),
         lo = coef[j] - zv * se[j], hi = coef[j] + zv * se[j])
  })
  fpr_grid <- 1:99 / 100
  rg <- sroc(fit, fpr = fpr_grid, type = "ruttergatsonis")[, 2]
  nv <- sroc(fit, fpr = fpr_grid, type = "naive")[, 2]
  list(name = name,
       studies = lapply(seq_len(nrow(counts)), function(i) {
         list(id = sprintf("%s-%d", name, i), TP = counts$TP[i], FN = counts$FN[i],
              FP = counts$FP[i], TN = counts$TN[i])
       }),
       correctionApplied = any(counts == 0),
       perStudy = per_study,
       reitsma = list(coefficients = coef_rec,
                      psi = list(as.list(unname(fit$Psi[1, ])), as.list(unname(fit$Psi[2, ]))),
                      pooledSens = unname(plogis(coef[1])),
                      pooledFpr = unname(plogis(coef[2])),
                      pooledSpec = unname(1 - plogis(coef[2]))),
       sroc = list(fpr = as.list(fpr_grid), ruttergatsonis = as.list(unname(rg)),
                   naive = as.list(unname(nv))))
}
diagnostic <- list(datasets = list(diag_case("AuditC"), diag_case("Dementia")))

## Coverage guards: both diagnostic sets must trigger the 0.5 "all"
## correction, or that branch loses parity silently.
stopifnot(diagnostic$datasets[[1]]$correctionApplied,
          diagnostic$datasets[[2]]$correctionApplied)

top <- list(
  meta = list(
    generatedAt = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    r = R.version.string,
    survival = as.character(packageVersion("survival")),
    mada = as.character(packageVersion("mada")),
    mvmeta = as.character(packageVersion("mvmeta")),
    tolerance = list(abs = 1e-4, rel = 1e-4),
    level = LEVEL,
    referenceCalls = list(
      lm = "lm(mpg ~ wt + hp, data = mtcars)",
      hc3 = "solve(X'X) %*% X' diag((e/(1-h))^2) %*% X %*% solve(X'X)",
      glm = "glm(am ~ wt + hp, family = binomial, data = mtcars), confint.default",
      survfit = "survfit(Surv(time, event) ~ 1, data = lung), conf.type = \"log\"",
      survdiff = "survdiff(Surv(time, event) ~ sex, data = lung, rho = 0)",
      coxph = "coxph(Surv(time, event) ~ age + sex, data = lung, ties = \"efron\")",
      cox_zph = "cox.zph(fit, transform = \"km\")",
      reitsma = "mada::reitsma(counts)  # correction 0.5, control \"all\", REML",
      sroc = "mada::sroc(fit, fpr = 1:99/100, type = \"ruttergatsonis\" | \"naive\")"
    )
  ),
  regression = regression,
  survival = survival_refs,
  diagnostic = diagnostic
)

writeLines(json_val(top), OUT)
cat(sprintf("wrote %s (regression + survival + %d diagnostic datasets)\n",
            OUT, length(diagnostic$datasets)))