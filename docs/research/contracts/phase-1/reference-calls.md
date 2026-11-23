Pinned reference calls (the parity script and the engine both follow these; any change is a reviewed contract change):
- Effect sizes: `metafor::escalc(measure=..., add=1/2, to="only0", drop00=TRUE)` for OR/RR; `drop00=FALSE` for RD; `measure="SMD"` (Hedges' g, `vtype="LS"`).
- Fixed: `rma(yi, vi, method="FE")`. DL: `rma(yi, vi, method="DL")`. REML: `rma(yi, vi, method="REML", control=list(stepadj=0.5, maxiter=1000))`, tau² clamped at 0.
- HKSJ: `test="knha"` without truncation by default; the engine also reports the truncated variant (`adhoc` per Röver et al.) when the HKSJ CI is narrower than the Wald CI, and the UI notes it.
- Prediction interval: `predict(rma_fit)` (t with k-2 df under `test="knha"`, normal otherwise); not shown when k < 3.
