#!/usr/bin/env Rscript
# ResearchMD Phase 1.5 R parity driver.
#
# Runs ONLY in CI (the parity job in .github/workflows/research-ci.yml installs
# R + metafor + metadat there). There is no R on the dev Mac, so this script is
# never run locally and test/fixtures/research/parity.json is never committed:
# CI regenerates it on every run, then test/research-parity.test.mjs compares
# research-engine.js against it.
#
# Run from the repo root:
#   Rscript scripts/research-parity.R
# which writes test/fixtures/research/parity.json.
#
# Pinned reference calls (frozen in docs/research/contracts/phase-1/
# reference-calls.md; any change is a reviewed contract change):
#   escalc(measure="OR"|"RR", ai, bi, ci, di, add=1/2, to="only0", drop00=TRUE)
#   escalc(measure="RD", ai, n1i, ci, n2i, add=1/2, to="only0", drop00=FALSE)
#   rma(yi, vi, method="FE" | "DL" | "REML",
#       control=list(stepadj=0.5, maxiter=1000, threshold=1e-10)); tau2 clamped at 0
#   HKSJ: rma(..., test="knha") without truncation by default. The truncated
#     variant (adhoc per Roever et al.) is hand-computed here as
#     estimate +/- qt((1+level)/2, k-1) * max(se_knha, se_wald) and recorded
#     only when the HKSJ CI is narrower than the Wald CI, matching the engine.
#   Prediction intervals: predict(fit) (pi.type="Riley", t with k-2 df, under test="knha",
#     normal otherwise); not recorded when k < 3, matching the engine.
#
# Datasets (dat.bcg plus 5 more metadat sets; role stated per case):
#   dat.bcg          RR  raw 2x2 counts (primary reference, 13 trials)
#   dat.bourassa1996 OR  raw 2x2 counts (handedness/eye-dominance, 54 samples)
#   dat.collins1985a RD  raw 2x2 counts (deaths; rare events keep double-zero)
#   dat.ishak2007    MD  precomputed mean differences via generic yi/vi input
#   dat.raudenbush1985 SMD precomputed standardised mean diffs, generic yi/vi
#   dat.hackshaw1998 OR  reported odds ratios with 95% CIs (SE-recovery path)
# Boundary slices of dat.bcg (documented, not extra datasets):
#   bcg-rr-k2    first 2 trials: the section-12 k = 2 boundary (PI null,
#              REML tau2 exactly 0) and the OR/RR double-zero-free baseline
#   bcg-rr-hom4  homogeneous 4-trial slice (trials 2, 3, 7, 10) that triggers
#              the truncated-HKSJ branch, which the full BCG set never does

stopifnot(file.exists("research-engine.js"),
          dir.exists("test/fixtures/research"))
OUT <- "test/fixtures/research/parity.json"

for (p in c("metafor", "metadat")) {
  if (!requireNamespace(p, quietly = TRUE)) {
    stop(sprintf(paste0("package '%s' is not installed. Install it first:\n",
                        "  install.packages(%s, repos=\"https://cloud.r-project.org\")"),
                 p, dQuote(p)))
  }
}
library(metafor)
library(metadat)

LEVEL <- 0.95
ZW <- qnorm((1 + LEVEL) / 2)

## ---- minimal JSON writer (base R only; no extra dependencies) ----
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

## ---- one pinned fit record ----
fit_rec <- function(f) {
  list(est = unname(f$b[1]), se = unname(f$se),
       lo = unname(f$ci.lb), hi = unname(f$ci.ub),
       q = unname(f$QE), df = unname(f$k - f$p), p = unname(f$QEp),
       i2 = unname(f$I2), tau2 = unname(f$tau2),
       w = 100 * as.numeric(weights(f)) / sum(as.numeric(weights(f))))
}

## ---- all four pinned fits + prediction intervals for one yi/vi vector ----
run_fits <- function(yi, vi) {
  stopifnot(length(yi) == length(vi), length(yi) >= 2L,
            all(is.finite(yi)), all(is.finite(vi)), all(vi > 0))
  d <- data.frame(yi = yi, vi = vi)
  k <- nrow(d)
  fe <- rma(yi, vi, data = d, method = "FE")
  dl <- rma(yi, vi, data = d, method = "DL")
  re <- rma(yi, vi, data = d, method = "REML",
            control = list(stepadj = 0.5, maxiter = 1000, threshold = 1e-10))
  rek <- rma(yi, vi, data = d, method = "REML", test = "knha",
             control = list(stepadj = 0.5, maxiter = 1000, threshold = 1e-10))
  half_w <- ZW * re$se
  half_h <- qt((1 + LEVEL) / 2, df = k - 1L) * rek$se
  tr <- NULL
  if (half_h < half_w) {
    tr <- list(se = unname(re$se),
               lo = unname(rek$b[1] - qt((1 + LEVEL) / 2, df = k - 1L) * re$se),
               hi = unname(rek$b[1] + qt((1 + LEVEL) / 2, df = k - 1L) * re$se))
  }
  fits <- list(FE = fit_rec(fe), DL = fit_rec(dl), REML = fit_rec(re),
               REML_knha = c(fit_rec(rek), list(truncated = tr)))
  # pi.type = "Riley": t on k-2 df under knha (Cochrane Handbook 10.10.4.3); metafor's default uses k-1
  pi_one <- function(f, type = "default") {
    if (k < 3L) return(NULL)
    pr <- predict(f, pi.type = type)
    # FE fits carry no pi.lb: with tau2 = 0 the prediction interval is the CI
    if (is.null(pr$pi.lb)) return(list(lower = unname(pr$ci.lb), upper = unname(pr$ci.ub)))
    list(lower = unname(pr$pi.lb), upper = unname(pr$pi.ub))
  }
  list(fits = fits,
       pi = list(FE = pi_one(fe), DL = pi_one(dl),
                 REML = pi_one(re), REML_knha = pi_one(rek, "Riley")))
}

## ---- case builders (each returns studies + yi/vi + dropped ids) ----
case_bcg <- function(rows) {
  data("dat.bcg", package = "metadat")
  e <- escalc(measure = "RR", ai = tpos, bi = tneg, ci = cpos, di = cneg,
              data = dat.bcg, add = 1 / 2, to = "only0", drop00 = TRUE)
  keep <- rows
  studies <- lapply(keep, function(i) {
    list(id = sprintf("bcg-%d", dat.bcg$trial[i]), verified = TRUE,
         events1 = dat.bcg$tpos[i], n1 = dat.bcg$tpos[i] + dat.bcg$tneg[i],
         events2 = dat.bcg$cpos[i], n2 = dat.bcg$cpos[i] + dat.bcg$cneg[i])
  })
  dropped <- sprintf("bcg-%d", dat.bcg$trial[keep[is.na(e$yi[keep])]])
  ok <- keep[!is.na(e$yi[keep])]
  list(studies = studies[keep %in% ok],
       per_study = lapply(ok, function(i) {
         list(id = sprintf("bcg-%d", dat.bcg$trial[i]),
              yi = unname(e$yi[i]), vi = unname(e$vi[i]))
       }),
       yi = unname(e$yi[ok]), vi = unname(e$vi[ok]),
       dropped = as.list(dropped))
}

case_bourassa_or <- function() {
  data("dat.bourassa1996", package = "metadat")
  b <- dat.bourassa1996
  # an arm with no subjects is not a comparison (escalc's 1/2 add would still pool it)
  cc <- which(complete.cases(b[, c("lh.le", "lh.re", "rh.le", "rh.re")]) &
              b$lh.le + b$lh.re > 0 & b$rh.le + b$rh.re > 0)
  stopifnot(length(cc) >= 3L)
  e <- escalc(measure = "OR", ai = lh.le, bi = lh.re, ci = rh.le, di = rh.re,
              data = b, add = 1 / 2, to = "only0", drop00 = TRUE,
              subset = cc)
  ids <- sprintf("bourassa-%02d", cc)
  dropped <- ids[is.na(e$yi)]
  ok <- !is.na(e$yi)
  list(studies = lapply(which(ok), function(j) {
         i <- cc[j]
         list(id = ids[j], verified = TRUE,
              events1 = b$lh.le[i], n1 = b$lh.le[i] + b$lh.re[i],
              events2 = b$rh.le[i], n2 = b$rh.le[i] + b$rh.re[i])
       }),
       per_study = lapply(which(ok), function(j) {
         list(id = ids[j], yi = unname(e$yi[j]), vi = unname(e$vi[j]))
       }),
       yi = unname(e$yi[ok]), vi = unname(e$vi[ok]),
       dropped = as.list(dropped))
}

case_collins_rd <- function() {
  data("dat.collins1985a", package = "metadat")
  cl <- dat.collins1985a
  cc <- which(complete.cases(cl[, c("d.xti", "nti", "d.xci", "nci")]))
  stopifnot(length(cc) >= 3L)
  e <- escalc(measure = "RD", ai = d.xti, n1i = nti, ci = d.xci, n2i = nci,
              data = cl, add = 1 / 2, to = "only0", drop00 = FALSE,
              subset = cc)
  ids <- sprintf("collins-%02d", seq_along(cc))
  dropped <- ids[is.na(e$yi)]
  ok <- !is.na(e$yi)
  stopifnot(all(is.finite(e$vi[ok])), all(e$vi[ok] > 0))
  list(studies = lapply(which(ok), function(j) {
         i <- cc[j]
         list(id = ids[j], verified = TRUE,
              events1 = cl$d.xti[i], n1 = cl$nti[i],
              events2 = cl$d.xci[i], n2 = cl$nci[i])
       }),
       per_study = lapply(which(ok), function(j) {
         list(id = ids[j], yi = unname(e$yi[j]), vi = unname(e$vi[j]))
       }),
       yi = unname(e$yi[ok]), vi = unname(e$vi[ok]),
       dropped = as.list(dropped))
}

case_ishak_md <- function() {
  data("dat.ishak2007", package = "metadat")
  d <- dat.ishak2007
  cc <- which(complete.cases(d[, c("y1i", "v1i")]))
  stopifnot(length(cc) >= 3L)
  ids <- sprintf("ishak-%02d", seq_along(cc))
  list(studies = lapply(seq_along(cc), function(j) {
         i <- cc[j]
         list(id = ids[j], verified = TRUE, yi = d$y1i[i], vi = d$v1i[i])
       }),
       per_study = lapply(seq_along(cc), function(j) {
         i <- cc[j]
         list(id = ids[j], yi = d$y1i[i], vi = d$v1i[i])
       }),
       yi = d$y1i[cc], vi = d$v1i[cc],
       dropped = list())
}

case_raudenbush_smd <- function() {
  data("dat.raudenbush1985", package = "metadat")
  d <- dat.raudenbush1985
  cc <- which(complete.cases(d[, c("yi", "vi")]))
  stopifnot(length(cc) >= 3L)
  ids <- sprintf("raudenbush-%02d", d$study[cc])
  list(studies = lapply(seq_along(cc), function(j) {
         i <- cc[j]
         list(id = ids[j], verified = TRUE, yi = d$yi[i], vi = d$vi[i])
       }),
       per_study = lapply(seq_along(cc), function(j) {
         i <- cc[j]
         list(id = ids[j], yi = d$yi[i], vi = d$vi[i])
       }),
       yi = d$yi[cc], vi = d$vi[cc],
       dropped = list())
}

case_hackshaw_or <- function() {
  data("dat.hackshaw1998", package = "metadat")
  d <- dat.hackshaw1998
  cc <- which(complete.cases(d[, c("or", "or.lb", "or.ub")]))
  stopifnot(length(cc) >= 3L)
  z <- qnorm((1 + LEVEL) / 2)
  yi <- log(d$or[cc])
  vi <- ((log(d$or.ub[cc]) - log(d$or.lb[cc])) / (2 * z))^2
  ids <- sprintf("hackshaw-%02d", d$study[cc])
  list(studies = lapply(seq_along(cc), function(j) {
         i <- cc[j]
         list(id = ids[j], verified = TRUE, effect = d$or[i],
              ciLower = d$or.lb[i], ciUpper = d$or.ub[i])
       }),
       per_study = lapply(seq_along(cc), function(j) {
         list(id = ids[j], yi = yi[j], vi = vi[j])
       }),
       yi = yi, vi = vi,
       dropped = list())
}

make_case <- function(id, dataset, measure, input, role, note, built) {
  r <- run_fits(built$yi, built$vi)
  c(list(id = id, dataset = dataset, measure = measure, input = input,
         level = LEVEL, role = role, note = note,
         studies = built$studies, perStudy = built$per_study,
         droppedByR = built$dropped),
    r)
}

## ---- build all cases ----
data("dat.bcg", package = "metadat")
all_rows <- seq_len(nrow(dat.bcg))
k2_rows <- c(1L, 2L)
hom4_trials <- c(2L, 3L, 7L, 10L)
hom4_rows <- which(dat.bcg$trial %in% hom4_trials)

cases <- list(
  make_case("bcg-rr", "dat.bcg", "RR", "counts",
            "RR via raw 2x2 counts (primary reference)",
            "Colditz et al. 1994 BCG vaccine trials; 13 trials.",
            case_bcg(all_rows)),
  make_case("bcg-rr-k2", "dat.bcg", "RR", "counts",
            "Section-12 k = 2 boundary (first two trials)",
            paste0("k = 2: the prediction interval stays null, REML tau2 is ",
                   "exactly 0, and the HKSJ truncation never triggers."),
            case_bcg(k2_rows)),
  make_case("bcg-rr-hom4", "dat.bcg", "RR", "counts",
            "Truncated-HKSJ branch (homogeneous 4-trial slice)",
            paste0("Trials 2, 3, 7, 10 are underdispersed (Q < df), so the ",
                   "HKSJ CI is narrower than the Wald CI and the Roever ",
                   "adhoc truncated variant is reported. The full 13-trial ",
                   "set never triggers it."),
            case_bcg(hom4_rows)),
  make_case("bourassa-or", "dat.bourassa1996", "OR", "counts",
            "OR via raw 2x2 counts",
            paste0("Handedness/eye-dominance 2x2 tables; rows dropped by ",
                   "escalc drop00=TRUE (double-zero) are listed in ",
                   "droppedByR for exact agreement with the engine."),
            case_bourassa_or()),
  make_case("collins-rd", "dat.collins1985a", "RD", "counts",
            "RD via raw 2x2 counts (deaths; drop00=FALSE keeps double-zero)",
            paste0("Deaths (d.xti/nti vs d.xci/nci); complete-case rows only; ",
                   "double-zero studies stay in with finite variance."),
            case_collins_rd()),
  make_case("ishak-md", "dat.ishak2007", "MD", "generic",
            "MD via generic inverse-variance input",
            "UPDRS mean differences at 3 months (y1i/v1i), complete cases.",
            case_ishak_md()),
  make_case("raudenbush-smd", "dat.raudenbush1985", "SMD", "generic",
            "SMD via generic inverse-variance input",
            "Teacher-expectancy standardised mean differences (yi/vi).",
            case_raudenbush_smd()),
  make_case("hackshaw-or", "dat.hackshaw1998", "OR", "reported",
            "OR via reported effects with 95% CIs (SE-recovery path)",
            paste0("ETS/lung-cancer odds ratios; the engine recovers the SE ",
                   "from each study's own 95% CI."),
            case_hackshaw_or())
)

## Coverage guard: the homogeneous slice must trigger the truncated branch,
## or the adhoc path loses R parity silently.
hom4 <- cases[[3]]
if (is.null(hom4$fits$REML_knha$truncated)) {
  stop("coverage guard failed: bcg-rr-hom4 does not trigger truncated HKSJ")
}

top <- list(
  meta = list(
    generatedAt = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    r = R.version.string,
    metafor = as.character(packageVersion("metafor")),
    metadat = as.character(packageVersion("metadat")),
    tolerance = list(abs = 1e-4, rel = 1e-4),
    level = LEVEL,
    referenceCalls = list(
      escalc_OR_RR = paste0("escalc(measure=<OR|RR>, ai, bi, ci, di, ",
                            "add=1/2, to=\"only0\", drop00=TRUE)"),
      escalc_RD = paste0("escalc(measure=\"RD\", ai, n1i, ci, n2i, ",
                         "add=1/2, to=\"only0\", drop00=FALSE)"),
      rma_FE = "rma(yi, vi, method=\"FE\")",
      rma_DL = "rma(yi, vi, method=\"DL\")",
      rma_REML = paste0("rma(yi, vi, method=\"REML\", ",
                        "control=list(stepadj=0.5, maxiter=1000))"),
      rma_knha = paste0("rma(yi, vi, method=\"REML\", test=\"knha\", ",
                        "control=list(stepadj=0.5, maxiter=1000))"),
      truncated = paste0("estimate +/- qt((1+level)/2, k-1) * ",
                         "max(se_knha, se_wald), only when halfH < halfW"),
      predict = "predict(fit)"
    )
  ),
  cases = cases
)

writeLines(json_val(top), OUT)
cat(sprintf("wrote %s (%d cases)\n", OUT, length(cases)))
