# ResearchMD plan v2: reference values for the survival, matched and sample size
# engines (research-stats.js, research-samplesize.js). Base R 4.3 + survival 3.5.
# Run: Rscript docs/research/stats-reference-survival.R
# The numbers printed here are frozen in test/research-stats-survival.test.mjs.
suppressMessages(library(survival))
op <- function(name, x) cat(name, paste(format(x, digits = 15), collapse = " "), "\n")

lung2 <- lung; lung2$status <- lung2$status - 1          # 1/2 -> 0/1

# Kaplan-Meier, conf.type "log" (R default), one group and by sex
f <- survfit(Surv(time, status) ~ 1, data = lung2)
op("km.all.median", summary(f)$table[c("median", "0.95LCL", "0.95UCL")])
s <- summary(f, times = c(100, 300, 500))
op("km.all.surv", s$surv); op("km.all.lower", s$lower); op("km.all.upper", s$upper); op("km.all.risk", s$n.risk)
fll <- survfit(Surv(time, status) ~ 1, data = lung2, conf.type = "log-log")
s <- summary(fll, times = c(100, 300, 500)); op("km.ll.lower", s$lower); op("km.ll.upper", s$upper)
op("km.ll.median", summary(fll)$table[c("median", "0.95LCL", "0.95UCL")])
fpl <- survfit(Surv(time, status) ~ 1, data = lung2, conf.type = "plain")
s <- summary(fpl, times = c(100, 300, 500)); op("km.plain.lower", s$lower); op("km.plain.upper", s$upper)
fs <- survfit(Surv(time, status) ~ sex, data = lung2)
op("km.sex.median", summary(fs)$table[, "median"])
op("km.sex.lcl", summary(fs)$table[, "0.95LCL"]); op("km.sex.ucl", summary(fs)$table[, "0.95UCL"])

# Log-rank (survdiff, rho = 0)
sd <- survdiff(Surv(time, status) ~ sex, data = lung2)
op("lr.sex.chisq", sd$chisq); op("lr.sex.obs", sd$obs); op("lr.sex.exp", sd$exp)
op("lr.sex.p", pchisq(sd$chisq, 1, lower.tail = FALSE))
vt <- veteran; vt$celltype <- as.character(vt$celltype)
sv <- survdiff(Surv(time, status) ~ celltype, data = vt)
op("lr.cell.chisq", sv$chisq); op("lr.cell.exp", sv$exp)

# Cox, Efron (default) and Breslow
c1 <- coxph(Surv(time, status) ~ sex, data = lung2)
op("cox.sex.coef", coef(summary(c1))[, c("coef", "se(coef)", "Pr(>|z|)")]); op("cox.sex.ci", summary(c1)$conf.int[, c("lower .95", "upper .95")])
op("cox.sex.loglik", c1$loglik)
c3 <- coxph(Surv(time, status) ~ sex, data = lung2, ties = "breslow")
op("cox.sexB.coef", coef(summary(c3))[, c("coef", "se(coef)")])
c2 <- coxph(Surv(time, status) ~ age + sex + ph.ecog, data = lung2)
op("cox.multi.coef", coef(c2)); op("cox.multi.se", sqrt(diag(vcov(c2)))); op("cox.multi.n", c(c2$n, c2$nevent))
op("cox.multi.lr", -2 * (c2$loglik[1] - c2$loglik[2]))
c4 <- coxph(Surv(time, status) ~ trt + celltype + karno, data = vt)
op("cox.vet.coef", coef(c4)); op("cox.vet.se", sqrt(diag(vcov(c4))))
c4b <- coxph(Surv(time, status) ~ trt + celltype + karno, data = vt, ties = "breslow")
op("cox.vetB.coef", coef(c4b)); op("cox.vetB.se", sqrt(diag(vcov(c4b))))

# Matched odds ratio: exact binomial on the discordant pairs
bt <- binom.test(25, 35); op("mor.25.10", c(bt$conf.int / (1 - bt$conf.int), bt$p.value))
bt <- binom.test(8, 8); op("mor.8.0", c(bt$conf.int[1] / (1 - bt$conf.int[1]), bt$p.value))

# Schoenfeld events
sch <- function(hr, power, a = 0.5) ceiling((qnorm(0.975) + qnorm(power))^2 / (a * (1 - a) * log(hr)^2))
op("schoenfeld", c(sch(0.7, 0.8), sch(0.6, 0.9)))

# Fleiss with continuity correction (OpenEpi), cases per group
fleiss <- function(p0, or, r, alpha = 0.05, power = 0.8) {
  p1 <- p0 * or / (1 + p0 * (or - 1)); pbar <- (p1 + r * p0) / (r + 1)
  za <- qnorm(1 - alpha / 2); zb <- qnorm(power)
  n <- (za * sqrt((r + 1) * pbar * (1 - pbar)) + zb * sqrt(r * p1 * (1 - p1) + p0 * (1 - p0)))^2 / (r * (p1 - p0)^2)
  nc <- n / 4 * (1 + sqrt(1 + 2 * (r + 1) / (n * r * abs(p1 - p0))))^2
  c(ceiling(n), ceiling(nc), ceiling(r * ceiling(nc)))
}
op("fleiss.40.2.1", fleiss(0.40, 2, 1)); op("fleiss.30.25.2", fleiss(0.30, 2.5, 2))
