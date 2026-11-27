#!/usr/bin/env Rscript
# ResearchMD R parity driver for ROC curves and AUC (pROC).
#
# Generates test/fixtures/research/parity-roc.json (gitignored, never
# committed) for test/research-stats-parity-roc.test.mjs, which compares the
# on-device JS ROC code (research-stats.js: roc) against pROC. Runs in CI
# (parity-roc job in .github/workflows/research-ci.yml) and locally:
#
#   Rscript scripts/research-parity-roc.R
#
# Pinned reference calls (any change is a reviewed contract change):
#   pROC::roc(response, predictor, levels = c(negative, positive),
#             direction = "auto" (or the forced direction), quiet = TRUE)
#     $direction, $thresholds, $sensitivities, $specificities
#   pROC::auc(r)
#   pROC::ci.auc(r, conf.level = 0.95, method = "delong")
#   pROC::var(r, method = "delong")            (the SE is its square root)
#   pROC::coords(r, x = "best", best.method = "youden",
#                ret = c("threshold", "sensitivity", "specificity"),
#                transpose = FALSE)              (every tied best row)
#   pROC::roc.test(r1, r2, method = "delong", paired = TRUE)
#     statistic (Z), p.value, conf.int, estimate
#   stats::binom.test(x, n)$conf.int            (exact sensitivity and
#                                                specificity intervals)
#
# Every pROC AUC is cross-checked here against the Mann-Whitney U / (m n)
# from base R ranks, and the DeLong variance against the placement formula
# written out by hand, and the script stops if they disagree.
#
# Datasets are embedded in the JSON so JS uses the exact same rows:
#   pROC aSAH (Turck et al. 2010, 113 subarachnoid haemorrhage patients),
#   mtcars (transmission by mpg, weight, horsepower), iris versicolor vs
#   virginica (many ties), airquality high ozone (missing values).
# Numeric gate: abs diff <= 1e-4 OR rel diff <= 1e-4.

stopifnot(dir.exists("test/fixtures/research"))
OUT <- "test/fixtures/research/parity-roc.json"

if (!requireNamespace("pROC", quietly = TRUE)) {
  stop(paste0("package 'pROC' is not installed. Install it first:\n",
              "  install.packages(\"pROC\", repos=\"https://cloud.r-project.org\")"))
}
suppressMessages(library(pROC))

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

## ---- helpers ----
agree <- function(got, want, label, tol = 1e-8) {
  if (length(got) != 1L || length(want) != 1L || !is.finite(got) || !is.finite(want)) {
    stop(sprintf("%s: missing value (pROC %s, base R %s)", label,
                 paste(got, collapse = ","), paste(want, collapse = ",")))
  }
  if (abs(got - want) > tol * max(1, abs(want))) {
    stop(sprintf("%s: pROC gave %.15g but base R gave %.15g", label, got, want))
  }
  invisible(got)
}
num_list <- function(x) as.list(unname(as.numeric(x)))

# base R AUC and DeLong variance on the "higher means positive" scale
base_auc_var <- function(cases, controls) {
  m <- length(cases); n <- length(controls)
  psi <- outer(cases, controls, function(x, y) (x > y) + 0.5 * (x == y))
  v10 <- rowMeans(psi); v01 <- colMeans(psi)
  auc <- mean(psi)
  r <- rank(c(cases, controls))
  u_auc <- (sum(r[seq_len(m)]) - m * (m + 1) / 2) / (m * n)
  agree(u_auc, auc, "Mann-Whitney AUC vs placements")
  list(auc = auc, var = var(v10) / m + var(v01) / n, v10 = v10, v01 = v01)
}

rows_of <- function(df, cols) {
  lapply(seq_len(nrow(df)), function(i) {
    lapply(cols, function(cn) {
      v <- df[[cn]][i]
      if (is.na(v)) NULL else if (is.factor(v)) as.character(v) else v
    })
  })
}

one_roc <- function(id, truth, pred, neg, pos, direction) {
  keep <- !is.na(truth) & !is.na(pred)
  y <- as.character(truth[keep]); x <- as.numeric(pred[keep])
  r <- roc(y, x, levels = c(neg, pos), direction = direction, quiet = TRUE)
  a <- as.numeric(auc(r))
  ci <- as.numeric(ci.auc(r, conf.level = LEVEL, method = "delong"))
  v <- as.numeric(var(r, method = "delong"))
  cases <- x[y == pos]; controls <- x[y == neg]
  sgn <- if (r$direction == "<") 1 else -1
  b <- base_auc_var(sgn * cases, sgn * controls)
  agree(a, b$auc, paste(id, "auc"))
  agree(v, b$var, paste(id, "DeLong variance"))
  ord <- order(r$thresholds)
  thr <- r$thresholds[ord]; se <- r$sensitivities[ord]; sp <- r$specificities[ord]
  inner <- is.finite(thr)
  best <- as.data.frame(coords(r, x = "best", best.method = "youden",
                               ret = c("threshold", "sensitivity", "specificity"),
                               transpose = FALSE))
  best_rows <- lapply(seq_len(nrow(best)), function(k) {
    tp <- round(best$sensitivity[k] * length(cases))
    tn <- round(best$specificity[k] * length(controls))
    sci <- binom.test(tp, length(cases), conf.level = LEVEL)$conf.int
    pci <- binom.test(tn, length(controls), conf.level = LEVEL)$conf.int
    list(threshold = best$threshold[k], sensitivity = best$sensitivity[k],
         specificity = best$specificity[k], tp = tp, tn = tn,
         sensLower = sci[1], sensUpper = sci[2], specLower = pci[1], specUpper = pci[2])
  })
  list(r = r, out = list(
    nCases = length(cases), nControls = length(controls), direction = r$direction,
    auc = a, se = sqrt(v), ciLower = ci[1], ciUpper = ci[3],
    innerThresholds = num_list(thr[inner]),
    sensitivities = num_list(se), specificities = num_list(sp),
    best = best_rows))
}

one_set <- function(id, df, truth, neg, pos, tests, direction = "auto") {
  df[[truth]] <- as.character(df[[truth]])
  per <- lapply(tests, function(tc) {
    res <- one_roc(paste(id, tc), df[[truth]], df[[tc]], neg, pos, direction)
    c(list(name = tc), res$out)
  })
  pairs <- list()
  if (length(tests) >= 2L) {
    for (a in seq_len(length(tests) - 1L)) for (b in (a + 1L):length(tests)) {
      ta <- tests[a]; tb <- tests[b]
      keep <- !is.na(df[[truth]]) & !is.na(df[[ta]]) & !is.na(df[[tb]])
      sub <- df[keep, , drop = FALSE]
      ra <- roc(sub[[truth]], as.numeric(sub[[ta]]), levels = c(neg, pos),
                direction = per[[a]]$direction, quiet = TRUE)
      rb <- roc(sub[[truth]], as.numeric(sub[[tb]]), levels = c(neg, pos),
                direction = per[[b]]$direction, quiet = TRUE)
      tt <- roc.test(ra, rb, method = "delong", paired = TRUE)
      pairs[[length(pairs) + 1L]] <- list(
        a = ta, b = tb, n = nrow(sub),
        aucA = unname(tt$estimate[1]), aucB = unname(tt$estimate[2]),
        z = unname(tt$statistic), p = unname(tt$p.value),
        ciLower = tt$conf.int[1], ciUpper = tt$conf.int[2])
    }
  }
  cols <- c(truth, tests)
  list(id = id, truth = truth, positive = pos, negative = neg, direction = direction,
       columns = as.list(cols), rows = rows_of(df, cols),
       tests = per, comparisons = pairs)
}

## ---- datasets ----
data(aSAH, package = "pROC")
as <- data.frame(outcome = as.character(aSAH$outcome),
                 s100b = aSAH$s100b, ndka = aSAH$ndka,
                 wfns = as.numeric(as.character(aSAH$wfns)))

mt <- data.frame(am = as.character(mtcars$am), mpg = mtcars$mpg,
                 wt = mtcars$wt, hp = mtcars$hp)

ir <- iris[iris$Species != "setosa", ]
ir <- data.frame(Species = as.character(ir$Species),
                 Petal.Width = ir$Petal.Width, Sepal.Width = ir$Sepal.Width)

aq <- data.frame(ozone = ifelse(is.na(airquality$Ozone), NA,
                                ifelse(airquality$Ozone >= 60, "high", "low")),
                 Temp = airquality$Temp, Solar.R = airquality$Solar.R,
                 Wind = airquality$Wind)

sets <- list(
  one_set("aSAH", as, "outcome", "Good", "Poor", c("s100b", "ndka", "wfns")),
  one_set("mtcars_am", mt, "am", "0", "1", c("mpg", "wt", "hp")),
  one_set("iris_virginica", ir, "Species", "versicolor", "virginica",
          c("Petal.Width", "Sepal.Width")),
  one_set("airquality_high_ozone", aq, "ozone", "low", "high",
          c("Temp", "Solar.R", "Wind")),
  one_set("aSAH_forced_greater", as, "outcome", "Good", "Poor", c("ndka"),
          direction = ">")
)

out <- list(
  meta = list(
    generatedBy = "scripts/research-parity-roc.R",
    rVersion = R.version.string,
    pROC = as.character(packageVersion("pROC")),
    level = LEVEL,
    tolerance = list(abs = 1e-4, rel = 1e-4),
    referenceCalls = list(
      roc = "pROC::roc(response, predictor, levels = c(neg, pos), direction = \"auto\")",
      ci = "pROC::ci.auc(r, conf.level = 0.95, method = \"delong\")",
      best = "pROC::coords(r, \"best\", best.method = \"youden\", transpose = FALSE)",
      test = "pROC::roc.test(r1, r2, method = \"delong\", paired = TRUE)",
      exact = "stats::binom.test(x, n)$conf.int"
    )
  ),
  sets = sets
)
writeLines(json_val(out), OUT)
cat(sprintf("wrote %s (%d data sets, %d ROC curves, %d paired comparisons)\n",
            OUT, length(sets), sum(vapply(sets, function(s) length(s$tests), 1L)),
            sum(vapply(sets, function(s) length(s$comparisons), 1L))))
