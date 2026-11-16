// Driver for the markdown-render-speed-02 entry: read every case from the
// input directory, render each one alone with parse() from parse.js, and
// write the HTML strings (one per case, in the cases' order) to the output
// directory as a JSON array. Outside a container, MAKEFUN_INPUT_DIR and
// MAKEFUN_OUTPUT_DIR stand in for /input and /output.
//
// Cold-start note: this driver is deliberately minimal — a single
// synchronous read, one parse() per case into a preallocated array (no
// push/grow), one stringify, one write. Measured on the practice set the
// whole cold process is dominated by parse.js itself (import ~6 ms, first
// parse pass ~1.2 s on this VM); the driver adds only node startup,
// cases.json parsing and the final stringify/write (~200 ms). Keeping the
// driver thin is what lets the parse.js optimisations (fast paths in
// esc()/parse(), table lookups, lazy delimiter tags, monomorphic node
// shapes) show up in the end-to-end number. See README.md for the
// measured cold-start figures and `npm run bench:cold` to reproduce them.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; markdown: string }[];

const html: string[] = new Array(cases.length);
for (let k = 0; k < cases.length; k++) {
  html[k] = parse(cases[k].markdown);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(join(OUTPUT_DIR, 'html.json'), JSON.stringify(html));
