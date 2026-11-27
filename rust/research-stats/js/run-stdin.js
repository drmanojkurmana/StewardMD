// Node helper: JSON requests on stdin (one per line) -> results on stdout,
// through the WebAssembly build. Used by scripts/compare_python.py --runner.
//   node rust/research-stats/js/run-stdin.js path/to/research_stats.wasm < requests.jsonl
"use strict";
var fs = require("fs");
var W = require("./research-stats-wasm.js");
W.load(fs.readFileSync(process.argv[2])).then(function (stats) {
  var lines = fs.readFileSync(0, "utf8").split("\n");
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim()) { out.push(JSON.stringify(stats.run(lines[i]))); }
  }
  process.stdout.write(out.join("\n") + "\n");
});
