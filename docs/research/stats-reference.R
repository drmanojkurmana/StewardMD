# Reference values for research-stats.js (base R only).
# Run: /opt/homebrew/bin/Rscript docs/research/stats-reference.R
# Rules mirrored in the JavaScript module:
#   Welch t: t.test(..., var.equal = FALSE)
#   Wilcoxon: exact when both samples have n < 50 (ties allowed, R 4.6);
#             otherwise wilcox.test(exact = FALSE, correct = TRUE)
#   ANOVA: aov; Kruskal-Wallis: kruskal.test (tie correction)
#   Chi-square: chisq.test (Yates correction on a 2 by 2 table)
#   Fisher: fisher.test two-sided
#   McNemar: mcnemar.test (continuity correction)
#   Correlation: cor.test pearson, and spearman (t approximation when tied)
#   Shapiro-Wilk: shapiro.test (Royston AS R94)
#   Logistic: glm(..., family = binomial), Wald interval from confint.default
# Odds ratios printed below use the Woolf logit interval with qnorm(0.975).
# A zero cell gets 0.5 added to every cell before the Woolf and Katz intervals.
# No em dash or en dash is used in this file.

pr <- function(nm, x) cat(sprintf("%s %.16g\n", nm, as.numeric(x)))

z975 <- qnorm(0.975)
pr("z975", z975)

woolf <- function(tag, a, b, c, d) {
  if (min(a, b, c, d) == 0) {
    a <- a + 0.5
    b <- b + 0.5
    c <- c + 0.5
    d <- d + 0.5
  }
  or <- (a * d) / (b * c)
  se <- sqrt(1 / a + 1 / b + 1 / c + 1 / d)
  rr <- (a / (a + b)) / (c / (c + d))
  ser <- sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d))
  pr(paste0(tag, ".or"), or)
  pr(paste0(tag, ".orLo"), exp(log(or) - z975 * se))
  pr(paste0(tag, ".orHi"), exp(log(or) + z975 * se))
  pr(paste0(tag, ".rr"), rr)
  pr(paste0(tag, ".rrLo"), exp(log(rr) - z975 * ser))
  pr(paste0(tag, ".rrHi"), exp(log(rr) + z975 * ser))
}

cat("\n# sleep, group 1 describe and Shapiro-Wilk\n")
g1 <- sleep$extra[sleep$group == 1]
pr("sleep.g1.mean", mean(g1))
pr("sleep.g1.sd", sd(g1))
qq <- quantile(g1, c(0, 0.25, 0.5, 0.75, 1), type = 7)
pr("sleep.g1.min", qq[1])
pr("sleep.g1.q1", qq[2])
pr("sleep.g1.median", qq[3])
pr("sleep.g1.q3", qq[4])
pr("sleep.g1.max", qq[5])
sw <- shapiro.test(g1)
pr("sleep.g1.W", sw$statistic)
pr("sleep.g1.p", sw$p.value)

cat("\n# Shapiro-Wilk n = 3 and mtcars mpg\n")
sw3 <- shapiro.test(c(1, 2, 4))
pr("sw3.W", sw3$statistic)
pr("sw3.p", sw3$p.value)
swm <- shapiro.test(mtcars$mpg)
pr("mpg.W", swm$statistic)
pr("mpg.p", swm$p.value)

cat("\n# Welch t, sleep extra by group (both groups normal)\n")
tt <- t.test(extra ~ group, data = sleep, var.equal = FALSE)
pr("sleep.t", tt$statistic)
pr("sleep.df", tt$parameter)
pr("sleep.p", tt$p.value)
pr("sleep.lo", tt$conf.int[1])
pr("sleep.hi", tt$conf.int[2])
pr("sleep.m1", tt$estimate[1])
pr("sleep.m2", tt$estimate[2])

cat("\n# Paired Wilcoxon, sleep (a zero difference and a tie)\n")
x1 <- sleep$extra[sleep$group == 1]
x2 <- sleep$extra[sleep$group == 2]
pw <- wilcox.test(x1, x2, paired = TRUE)
pr("sleep.V", pw$statistic)
pr("sleep.Vp", pw$p.value)

cat("\n# Welch t, mtcars mpg by am\n")
tt <- t.test(mpg ~ factor(am), data = mtcars, var.equal = FALSE)
pr("am.t", tt$statistic)
pr("am.df", tt$parameter)
pr("am.p", tt$p.value)
pr("am.lo", tt$conf.int[1])
pr("am.hi", tt$conf.int[2])

cat("\n# One-way ANOVA, mtcars mpg by cyl\n")
af <- summary(aov(mpg ~ factor(cyl), data = mtcars))[[1]]
pr("cyl.F", af[["F value"]][1])
pr("cyl.p", af[["Pr(>F)"]][1])

cat("\n# Kruskal-Wallis on a hand table (third group skewed)\n")
k <- kruskal.test(list(
  c(1, 2, 3, 4, 5, 6, 7, 8, 9),
  c(2, 3, 4, 5, 6, 7, 8, 9, 10),
  c(1, 1, 1, 1, 2, 2, 3, 15, 18)
))
pr("kw.H", k$statistic)
pr("kw.p", k$p.value)

cat("\n# Mann-Whitney exact, skewed hand samples\n")
sk <- wilcox.test(c(1, 1, 1, 1, 2, 2, 3, 14), c(2, 2, 3, 3, 4, 10, 12, 15))
pr("sk.W", sk$statistic)
pr("sk.p", sk$p.value)

cat("\n# Mann-Whitney exact with ties, ToothGrowth len by supp\n")
tw <- wilcox.test(len ~ supp, data = ToothGrowth)
pr("tooth.W", tw$statistic)
pr("tooth.p", tw$p.value)

cat("\n# Mann-Whitney normal approximation, n = 60 (overlaps, so ties)\n")
aw <- wilcox.test(1:60, 10:69, exact = FALSE, correct = TRUE)
pr("as.W", aw$statistic)
pr("as.p", aw$p.value)

cat("\n# Pearson, mtcars mpg and wt (both normal)\n")
ct <- cor.test(mtcars$mpg, mtcars$wt, method = "pearson")
pr("pear.r", ct$estimate)
pr("pear.p", ct$p.value)
pr("pear.lo", ct$conf.int[1])
pr("pear.hi", ct$conf.int[2])

cat("\n# Spearman, mtcars mpg and hp (hp is not normal; ties)\n")
ct <- cor.test(mtcars$mpg, mtcars$hp, method = "spearman")
pr("spear.rho", ct$estimate)
pr("spear.p", ct$p.value)

cat("\n# Chi-square 2 by 2 with Yates, all expected counts above 5\n")
# columns are no, yes so the event (yes) is the second column
# group A: 12 no, 6 yes; group B: 5 no, 14 yes
ch <- chisq.test(matrix(c(12, 5, 6, 14), nrow = 2))
pr("chi.stat", ch$statistic)
pr("chi.p", ch$p.value)
woolf("chi", 6, 12, 14, 5)

cat("\n# Chi-square 3 by 2, mtcars cyl by am (no Yates)\n")
ch <- chisq.test(table(mtcars$cyl, mtcars$am))
pr("cylam.stat", ch$statistic)
pr("cylam.p", ch$p.value)

cat("\n# Fisher exact, expected count under 5\n")
# group A: 8 no, 1 yes; group B: 2 no, 7 yes
fi <- fisher.test(matrix(c(8, 2, 1, 7), nrow = 2))
pr("fish.p", fi$p.value)
woolf("fish", 1, 8, 7, 2)

cat("\n# Fisher with a zero cell (0.5 correction on the odds ratio only)\n")
# group A: 0 no, 10 yes; group B: 8 no, 3 yes
fi <- fisher.test(matrix(c(0, 8, 10, 3), nrow = 2))
pr("zero.p", fi$p.value)
woolf("zero", 10, 0, 3, 8)

cat("\n# McNemar with continuity correction\n")
mc <- mcnemar.test(matrix(c(20, 8, 3, 15), nrow = 2))
pr("mc.stat", mc$statistic)
pr("mc.p", mc$p.value)
# discordant odds b/c = 3/8
b <- 3
c <- 8
or <- b / c
se <- sqrt(1 / b + 1 / c)
pr("mc.or", or)
pr("mc.orLo", exp(log(or) - z975 * se))
pr("mc.orHi", exp(log(or) + z975 * se))

cat("\n# Paired t on rounded normal differences (set.seed 1)\n")
set.seed(1)
pta <- round(rnorm(24, 50, 8), 2)
ptb <- round(pta - rnorm(24, 4, 3), 2)
pr("pt.diffW", shapiro.test(pta - ptb)$p.value)
pt <- t.test(pta, ptb, paired = TRUE)
pr("pt.t", pt$statistic)
pr("pt.df", pt$parameter)
pr("pt.p", pt$p.value)
pr("pt.md", pt$estimate)
pr("pt.lo", pt$conf.int[1])
pr("pt.hi", pt$conf.int[2])
cat("pt.a")
cat(sprintf(" %.2f", pta))
cat("\npt.b")
cat(sprintf(" %.2f", ptb))
cat("\n")

cat("\n# Logistic, mtcars am ~ mpg + factor(cyl). 13 events, 2 factors.\n")
g <- glm(am ~ mpg + factor(cyl), data = mtcars, family = binomial)
pr("glm.conv", g$converged)
pr("glm.iter", g$iter)
s <- coef(summary(g))
ci <- confint.default(g)
for (i in seq_len(nrow(s))) {
  pr(paste0("glm.b", i), s[i, 1])
  pr(paste0("glm.se", i), s[i, 2])
  pr(paste0("glm.p", i), s[i, 4])
  pr(paste0("glm.lo", i), ci[i, 1])
  pr(paste0("glm.hi", i), ci[i, 2])
}

cat("\n# Logistic, one binary factor, 20 events, no separation\n")
y <- c(rep(0, 12), rep(1, 8), rep(0, 8), rep(1, 12))
x <- c(rep(0, 20), rep(1, 20))
g <- glm(y ~ x, family = binomial)
pr("easy.iter", g$iter)
s <- coef(summary(g))
ci <- confint.default(g)
for (i in seq_len(nrow(s))) {
  pr(paste0("easy.b", i), s[i, 1])
  pr(paste0("easy.p", i), s[i, 4])
  pr(paste0("easy.lo", i), ci[i, 1])
  pr(paste0("easy.hi", i), ci[i, 2])
}

cat("\n# end\n")
