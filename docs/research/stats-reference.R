# ResearchMD survival reference (R 4.6.2, survival package).
# Teaching data only: survival::lung and survival::veteran. Not patient data.
# lung status is recoded to 0 = censored, 1 = event (status - 1).
# Re-run: /opt/homebrew/bin/Rscript docs/research/stats-reference.R
# This script prints the frozen numbers. It does not write fixtures.

options(digits = 17)

library(survival)

lung$status <- lung$status - 1

cat("== KM overall ==\n")
for (ct in c("log", "log-log", "plain")) {
  fit <- survfit(Surv(time, status) ~ 1, data = lung, conf.type = ct)
  cat("conf", ct, "\n")
  print(quantile(fit, probs = 0.5))
  sm <- summary(fit)
  cat("steps", length(sm$time), "\n")
}

cat("== KM by sex, log ==\n")
fitsex <- survfit(Surv(time, status) ~ sex, data = lung, conf.type = "log")
print(quantile(fitsex, probs = 0.5))

cat("== log-rank sex ==\n")
sd <- survdiff(Surv(time, status) ~ sex, data = lung, rho = 0)
cat("chisq", sd$chisq, "\n")
cat("obs", sd$obs, "\n")
cat("exp", sd$exp, "\n")
cat("df", length(sd$n) - 1, "\n")
cat("p", pchisq(sd$chisq, length(sd$n) - 1, lower.tail = FALSE), "\n")

dumpcox <- function(fit, label) {
  s <- summary(fit)
  cat("\n==", label, "==\n")
  cat("n", fit$n, "events", fit$nevent, "iter", fit$iter, "\n")
  cat("loglik0", fit$loglik[1], "loglik", fit$loglik[2], "\n")
  cat("lr.chi", s$logtest["test"], "lr.df", s$logtest["df"], "lr.p", s$logtest["pvalue"], "\n")
  coef <- s$coefficients
  ci <- s$conf.int
  for (i in seq_len(nrow(coef))) {
    cat(
      "term", rownames(coef)[i],
      "beta", coef[i, "coef"],
      "se", coef[i, "se(coef)"],
      "hr", coef[i, "exp(coef)"],
      "lo", ci[i, "lower .95"],
      "hi", ci[i, "upper .95"],
      "z", coef[i, "z"],
      "p", coef[i, "Pr(>|z|)"],
      "\n"
    )
  }
}

dumpcox(coxph(Surv(time, status) ~ sex, data = lung, ties = "efron"), "lung sex efron")
dumpcox(coxph(Surv(time, status) ~ sex, data = lung, ties = "breslow"), "lung sex breslow")
dumpcox(coxph(Surv(time, status) ~ age + sex + ph.ecog, data = lung, ties = "efron"), "lung multi efron")
dumpcox(coxph(Surv(time, status) ~ age + sex + ph.ecog, data = lung, ties = "breslow"), "lung multi breslow")
dumpcox(coxph(Surv(time, status) ~ trt + celltype, data = veteran, ties = "efron"), "veteran efron")
dumpcox(coxph(Surv(time, status) ~ trt + celltype, data = veteran, ties = "breslow"), "veteran breslow")

cat("\n== matched OR ==\n")
pl <- qbeta(0.025, 25, 11)
pu <- qbeta(0.975, 26, 10)
bt <- binom.test(25, 35, 0.5)
cat("b25 or", 25 / 10, "lo", pl / (1 - pl), "hi", pu / (1 - pu), "p", bt$p.value, "\n")
pl8 <- qbeta(0.025, 8, 1)
bt8 <- binom.test(8, 8, 0.5)
cat("b8 lo", pl8 / (1 - pl8), "p", bt8$p.value, "\n")

cat("== small medians, conf log ==\n")
showmed <- function(time, status, label) {
  fit <- survfit(Surv(time, status) ~ 1, conf.type = "log")
  cat(label, "\n")
  print(quantile(fit, probs = 0.5))
}
showmed(c(10, 30), c(1, 1), "10,30 events")
showmed(c(10, 20, 30), c(1, 0, 1), "10,20,30")
showmed(c(10, 40), c(1, 0), "10,40")
showmed(c(1, 2, 3, 4), c(1, 1, 0, 0), "1,2,3,4")
showmed(c(1, 2, 3, 10), c(1, 1, 0, 1), "1,2,3,10")
