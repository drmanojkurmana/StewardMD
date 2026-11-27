#!/usr/bin/env Rscript
# ResearchMD R parity driver for epiR (2x2 tables) and tableone (Table 1).
#
# Generates test/fixtures/research/parity-epi.json (gitignored, never
# committed) for test/research-stats-parity-epi.test.mjs, which compares the
# on-device JS stats (research-stats.js: compare, describe, table1 and the
# Mann-Whitney test) against these R packages. Runs in CI (parity-epi job in
# .github/workflows/research-ci.yml) and locally:
#
#   R_LIBS_USER=~/Library/R/library Rscript scripts/research-parity-epi.R
#
# Pinned reference calls (any change is a reviewed contract change):
#   epiR::epi.2by2(as.table(m), method = "cohort.count", conf.level = 0.95)
#     m is 2x2, rows Exposed / Unexposed, columns Yes / No.
#     massoc.detail: RR.strata.wald (Katz log), OR.strata.wald (Woolf),
#     chi2.strata.yates, chi2.strata.fisher
#   tableone::CreateTableOne(vars, strata, data, factorVars, addOverall = TRUE,
#     testApprox = chisq.test (correct = TRUE), testExact = fisher.test,
#     testNormal = oneway.test, var.equal = FALSE for 2 groups (Welch t) and
#     TRUE for 3+ groups (classic ANOVA), testNonNormal = wilcox.test for
#     2 groups and kruskal.test for 3+ groups)
#   stats::wilcox.test(x, y) for Mann-Whitney (exact when n < 50 and no ties,
#     normal approximation with tie and continuity correction otherwise)
#   stats::shapiro.test per group (the app picks mean or median with it)
#
# Every package number is cross-checked here against base R formulas
# (chisq.test, fisher.test, oneway.test, quantile type 7, Katz and Woolf by
# hand) and the script stops if they disagree, so the fixture holds one
# agreed answer per number.
#
# Datasets are embedded in the JSON so JS uses the exact same rows:
#   mtcars split by transmission, iris split by species, airquality May vs
#   June (with missing values), and fixed 2x2 count tables.
# Numeric gate: abs diff <= 1e-4 OR rel diff <= 1e-4.

stopifnot(dir.exists("test/fixtures/research"))
OUT <- "test/fixtures/research/parity-epi.json"

for (p in c("epiR", "tableone")) {
  if (!requireNamespace(p, quietly = TRUE)) {
    stop(sprintf(paste0("package '%s' is not installed. Install it first:\n",
                        "  install.packages(%s, repos=\"https://cloud.r-project.org\")"),
                 p, dQuote(p)))
  }
}
suppressMessages(library(epiR))
suppressMessages(library(tableone))

LEVEL <- 0.95
Z <- qnorm(1 - (1 - LEVEL) / 2)

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

## ---- helpers ----
agree <- function(got, want, label, tol = 1e-8) {
  if (length(got) != 1L || length(want) != 1L || !is.finite(got) || !is.finite(want)) {
    stop(sprintf("%s: missing value (package %s, base R %s)", label,
                 paste(got, collapse = ","), paste(want, collapse = ",")))
  }
  if (abs(got - want) > tol * max(1, abs(want))) {
    stop(sprintf("%s: package gave %.15g but base R gave %.15g", label, got, want))
  }
  invisible(got)
}
num_list <- function(x) as.list(unname(as.numeric(x)))
chr_list <- function(x) {
  out <- ifelse(is.na(x), "", as.character(x))
  as.list(unname(out))
}
p_two <- function(df, label) {
  if (is.null(df)) stop(sprintf("epiR result has no %s table", label))
  for (nm in c("p.value.2s", "p.value")) if (!is.null(df[[nm]])) return(unname(df[[nm]][1L]))
  stop(sprintf("epiR %s has no two-sided p column (columns: %s)", label,
               paste(names(df), collapse = ", ")))
}
est_ci <- function(df, label) {
  if (is.null(df)) stop(sprintf("epiR result has no %s table", label))
  for (nm in c("est", "lower", "upper")) {
    if (is.null(df[[nm]])) stop(sprintf("epiR %s has no %s column", label, nm))
  }
  list(est = unname(df$est[1L]), lo = unname(df$lower[1L]), hi = unname(df$upper[1L]))
}
sw_p <- function(x) if (length(x) >= 3L && length(x) <= 5000L) shapiro.test(x)$p.value else NULL

## ---- epiR: 2x2 tables (risk ratio, odds ratio, Yates and Fisher p) ----
TABLES <- list(
  list(id = "t1", cells = c(13, 2163, 5, 3349)),
  list(id = "t2", cells = c(482, 1622, 1110, 3211)),
  list(id = "t3", cells = c(15, 85, 5, 95)),
  list(id = "t4", cells = c(40, 60, 25, 75)),
  list(id = "t5", cells = c(647, 622, 27, 2)),
  list(id = "t6", cells = c(3, 7, 1, 9)),
  list(id = "t7", cells = c(8, 2, 1, 5))
)
two_by_two <- lapply(TABLES, function(tb) {
  a <- tb$cells[1]; b <- tb$cells[2]; c <- tb$cells[3]; d <- tb$cells[4]
  m <- matrix(c(a, b, c, d), nrow = 2, byrow = TRUE,
              dimnames = list(Exposure = c("Exposed", "Unexposed"),
                              Outcome = c("Yes", "No")))
  fit <- epi.2by2(dat = as.table(m), method = "cohort.count", conf.level = LEVEL)
  md <- fit$massoc.detail
  if (is.null(md)) stop("epi.2by2 returned no massoc.detail (epiR too old?)")
  rr <- est_ci(md$RR.strata.wald, "RR.strata.wald")
  or <- est_ci(md$OR.strata.wald, "OR.strata.wald")
  p_yates <- p_two(md$chi2.strata.yates, "chi2.strata.yates")
  p_fisher <- p_two(md$chi2.strata.fisher, "chi2.strata.fisher")

  rr_b <- (a / (a + b)) / (c / (c + d))
  se_rr <- sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d))
  or_b <- (a * d) / (b * c)
  se_or <- sqrt(1 / a + 1 / b + 1 / c + 1 / d)
  agree(rr$est, rr_b, paste(tb$id, "RR"))
  agree(rr$lo, exp(log(rr_b) - Z * se_rr), paste(tb$id, "RR lower"))
  agree(rr$hi, exp(log(rr_b) + Z * se_rr), paste(tb$id, "RR upper"))
  agree(or$est, or_b, paste(tb$id, "OR"))
  agree(or$lo, exp(log(or_b) - Z * se_or), paste(tb$id, "OR lower"))
  agree(or$hi, exp(log(or_b) + Z * se_or), paste(tb$id, "OR upper"))
  agree(p_yates, suppressWarnings(chisq.test(m, correct = TRUE))$p.value,
        paste(tb$id, "Yates p"))
  agree(p_fisher, fisher.test(m)$p.value, paste(tb$id, "Fisher p"))
  expected <- outer(rowSums(m), colSums(m)) / sum(m)
  list(id = tb$id, a = a, b = b, c = c, d = d,
       rr = rr, or = or, pYates = p_yates, pFisher = p_fisher,
       minExpected = min(expected))
})

## ---- stats: Mann-Whitney references ----
MW <- list(
  # ?wilcox.test two-sample example: no ties, exact
  list(id = "wilcox_doc",
       x = c(0.80, 0.83, 1.89, 1.04, 1.45, 1.38, 1.91, 1.64, 0.73, 1.46),
       y = c(1.15, 0.88, 0.90, 0.74, 1.21)),
  # n = 50 per group: normal approximation with tie and continuity correction
  list(id = "iris_petal_length_vv",
       x = iris$Petal.Length[iris$Species == "versicolor"],
       y = iris$Petal.Length[iris$Species == "virginica"]),
  list(id = "iris_sepal_width_sv",
       x = iris$Sepal.Width[iris$Species == "setosa"],
       y = iris$Sepal.Width[iris$Species == "versicolor"])
)
mann_whitney <- lapply(MW, function(cs) {
  r <- suppressWarnings(wilcox.test(cs$x, cs$y, correct = TRUE))
  ties <- any(duplicated(c(cs$x, cs$y)))
  exact <- length(cs$x) < 50 && length(cs$y) < 50 && !ties
  list(id = cs$id, x = num_list(cs$x), y = num_list(cs$y),
       W = unname(r$statistic), p = r$p.value, exact = exact, ties = ties)
})

## ---- tableone: Table 1 by group ----
q7 <- function(x, p) unname(quantile(x, p, type = 7, names = FALSE))
one_set <- function(id, df, group, levels, num_vars, cat_vars) {
  df[[group]] <- factor(as.character(df[[group]]), levels = levels)
  df <- df[!is.na(df[[group]]), , drop = FALSE]
  for (v in cat_vars) df[[v]] <- as.character(df[[v]])
  two <- length(levels) == 2L
  tab <- suppressWarnings(CreateTableOne(
    vars = c(num_vars, cat_vars), strata = group, data = df,
    factorVars = cat_vars, addOverall = TRUE, includeNA = FALSE, test = TRUE,
    testApprox = chisq.test, argsApprox = list(correct = TRUE),
    testExact = fisher.test, argsExact = list(workspace = 2 * 10^5),
    testNormal = oneway.test, argsNormal = list(var.equal = !two),
    testNonNormal = if (two) wilcox.test else kruskal.test,
    argsNonNormal = list()))
  cont <- tab$ContTable
  catt <- tab$CatTable
  cont_p <- attr(cont, "pValues")
  cat_p <- attr(catt, "pValues")
  if (is.null(cont_p) && length(num_vars)) stop(id, ": tableone ContTable has no pValues")
  if (is.null(cat_p) && length(cat_vars)) stop(id, ": tableone CatTable has no pValues")
  strata <- c("Overall", levels)
  g <- df[[group]]

  numeric_out <- lapply(num_vars, function(v) {
    x_all <- df[[v]]
    groups_out <- lapply(strata, function(s) {
      x <- if (s == "Overall") x_all else x_all[g == s]
      x <- x[!is.na(x)]
      row <- cont[[s]]
      if (is.null(row)) stop(id, ": tableone has no stratum ", s)
      st <- list(name = s, n = length(x),
                 mean = unname(row[v, "mean"]), sd = unname(row[v, "sd"]),
                 median = unname(row[v, "median"]),
                 q1 = unname(row[v, "p25"]), q3 = unname(row[v, "p75"]),
                 shapiroP = sw_p(x))
      agree(st$mean, mean(x), paste(id, v, s, "mean"))
      agree(st$sd, sd(x), paste(id, v, s, "sd"))
      agree(st$median, median(x), paste(id, v, s, "median"))
      agree(st$q1, q7(x, 0.25), paste(id, v, s, "q1"))
      agree(st$q3, q7(x, 0.75), paste(id, v, s, "q3"))
      st
    })
    keep <- !is.na(x_all)
    xs <- x_all[keep]; gs <- droplevels(g[keep])
    p_norm <- unname(cont_p[v, "pNormal"])
    p_non <- unname(cont_p[v, "pNonNormal"])
    agree(p_norm, oneway.test(xs ~ gs, var.equal = !two)$p.value, paste(id, v, "pNormal"))
    if (two) {
      ref_non <- suppressWarnings(wilcox.test(xs[gs == levels[1]], xs[gs == levels[2]]))$p.value
    } else {
      ref_non <- kruskal.test(xs ~ gs)$p.value
    }
    agree(p_non, ref_non, paste(id, v, "pNonNormal"))
    sizes <- table(gs)
    list(variable = v, groups = groups_out, pNormal = p_norm, pNonNormal = p_non,
         normalTest = if (two) "welch_t" else "anova",
         nonNormalTest = if (two) "mann_whitney" else "kruskal",
         ties = any(duplicated(xs)), maxGroupN = max(sizes))
  })

  categorical_out <- lapply(cat_vars, function(v) {
    groups_out <- lapply(strata, function(s) {
      tb <- catt[[s]][[v]]
      if (is.null(tb)) stop(id, ": tableone has no ", v, " table for ", s)
      x <- if (s == "Overall") df[[v]] else df[[v]][g == s]
      x <- x[!is.na(x)]
      lv <- lapply(seq_len(nrow(tb)), function(k) {
        level <- as.character(tb$level[k])
        n <- unname(tb$freq[k])
        agree(n, sum(x == level), paste(id, v, s, level, "n"))
        list(level = level, n = n, pct = unname(tb$percent[k]))
      })
      list(name = s, n = length(x), counts = lv)
    })
    keep <- !is.na(df[[v]])
    m <- table(droplevels(g[keep]), df[[v]][keep])
    p_app <- unname(cat_p[v, "pApprox"])
    p_ex <- unname(cat_p[v, "pExact"])
    agree(p_app, suppressWarnings(chisq.test(m, correct = TRUE))$p.value, paste(id, v, "pApprox"))
    agree(p_ex, fisher.test(m, workspace = 2 * 10^5)$p.value, paste(id, v, "pExact"))
    list(variable = v, groups = groups_out, pApprox = p_app, pExact = p_ex,
         levels = ncol(m))
  })

  cols <- c(group, num_vars, cat_vars)
  columns <- lapply(cols, function(cn) chr_list(df[[cn]]))
  names(columns) <- cols
  types <- c(list("categorical"), rep(list("numeric"), length(num_vars)),
             lapply(cat_vars, function(v) if (length(unique(na.omit(df[[v]]))) == 2L) "binary" else "categorical"))
  names(types) <- cols
  list(id = id, group = group, levels = as.list(levels),
       columnOrder = as.list(cols), columns = columns, types = types,
       numeric = numeric_out, categorical = categorical_out)
}

mt <- mtcars
mt$transmission <- ifelse(mt$am == 1, "manual", "auto")
ir <- iris
ir$Species <- as.character(ir$Species)
aq <- airquality[airquality$Month %in% c(5, 6), ]
aq$month <- ifelse(aq$Month == 5, "May", "June")
stopifnot(sum(is.na(aq$Ozone)) > 0, sum(is.na(aq$Solar.R)) > 0)

tables <- list(
  one_set("mtcars_by_transmission", mt, "transmission", c("auto", "manual"),
          c("mpg", "hp", "wt", "qsec", "disp"), c("vs", "cyl", "gear")),
  one_set("iris_by_species", ir, "Species", c("setosa", "versicolor", "virginica"),
          c("Sepal.Length", "Sepal.Width", "Petal.Length", "Petal.Width"), character(0)),
  one_set("airquality_may_june", aq, "month", c("June", "May"),
          c("Ozone", "Solar.R", "Wind", "Temp"), character(0))
)

out <- list(
  meta = list(
    generatedBy = "scripts/research-parity-epi.R",
    rVersion = R.version.string,
    epiR = as.character(packageVersion("epiR")),
    tableone = as.character(packageVersion("tableone")),
    level = LEVEL,
    tolerance = list(abs = 1e-4, rel = 1e-4),
    referenceCalls = list(
      epi2by2 = "epiR::epi.2by2(as.table(m), method = \"cohort.count\", conf.level = 0.95)",
      tableone = "tableone::CreateTableOne(..., addOverall = TRUE, testNormal = oneway.test, testNonNormal = wilcox.test | kruskal.test)",
      wilcox = "stats::wilcox.test(x, y, correct = TRUE)"
    )
  ),
  twoByTwo = two_by_two,
  mannWhitney = mann_whitney,
  table1 = tables
)
writeLines(json_val(out), OUT)
cat(sprintf("wrote %s (%d 2x2 tables, %d Mann-Whitney cases, %d Table 1 sets)\n",
            OUT, length(two_by_two), length(mann_whitney), length(tables)))
