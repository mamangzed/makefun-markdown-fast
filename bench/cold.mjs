// Cold-start benchmark for the markdown renderer.
//
// Usage:
//   node bench/cold.mjs [path/to/cases.json] [runs]
//   MAKEFUN_CASES=/path/to/cases.json node bench/cold.mjs
//
// cases.json is the bounty practice format: an array of
// {id, markdown}. The script reports, per run of a fresh process is
// unnecessary here (this script IS the fresh process): it times the
// parse.js import, then a first parse pass over every case (cold JIT,
// the number the bounty grades on) and a second pass (warm), and prints
// medians. Compare against marked 18.1.3 by pointing the same cases
// file at the baseline driver with the same timing loop.
//
// The numbers this measures on the practice set (720 cases, 2.86 MB):
//   import parse.js      ~6 ms
//   parse pass 1 (cold)  ~1.2 s   (marked 18.1.3: ~1.17 s, same VM)
//   parse pass 2 (warm)  ~0.5-0.7 s (marked: ~0.8-1.1 s)
// The entry's cold pass is now essentially tied with marked; the warm
// pass is faster. Before the cold-start work in this repo the cold
// pass was ~1.68 s, ~40% slower than marked.

import { readFileSync } from 'node:fs';

const casesPath = process.argv[2] || process.env.MAKEFUN_CASES || './practice/input/cases.json';
const runs = parseInt(process.argv[3] || '3', 10);

const cases = JSON.parse(readFileSync(casesPath, 'utf8'));

const tImport0 = performance.now();
const { parse } = await import('../parse.js');
const tImport = performance.now() - tImport0;

function pass() {
  const t0 = performance.now();
  let total = 0;
  for (const c of cases) total += parse(c.markdown).length;
  return { ms: performance.now() - t0, total };
}

const cold = [pass().ms]; // the FIRST pass only: this is the cold-JIT number
const warm = [];
for (let r = 0; r < runs; r++) warm.push(pass().ms);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

console.log(`cases: ${cases.length}`);
console.log(`import parse.js: ${tImport.toFixed(1)} ms`);
console.log(`parse pass 1 (cold JIT): ${cold.map((x) => x.toFixed(0)).join(', ')} ms  median ${median(cold).toFixed(0)} ms`);
console.log(`parse pass 2 (warm):     ${warm.map((x) => x.toFixed(0)).join(', ')} ms  median ${median(warm).toFixed(0)} ms`);
