// node js/run-file.js target/wasm32-unknown-unknown/release/research_pdf.wasm paper.pdf [--max-pages N]
var fs = require("fs");
var loadResearchPdf = require("./research-pdf-wasm.js").loadResearchPdf;
var a = process.argv.slice(2);
var i = a.indexOf("--max-pages");
loadResearchPdf(fs.readFileSync(a[0])).then(function (r) {
  var pdf = new Uint8Array(fs.readFileSync(a[1]));
  var t = process.hrtime.bigint();
  var out = i >= 0 ? r.extract(pdf, Number(a[i + 1]), 25 * 1024 * 1024) : r.extract(pdf);
  if (a.indexOf("--time") >= 0) console.error(Number(process.hrtime.bigint() - t) / 1e6 + " ms");
  else process.stdout.write(JSON.stringify(out));
});
