// Regression tests for the emphasis "star-budget" rule in processEmphasis.
//
// Background: the last practice case to be closed (doc-11, an 86 KB
// generated document dense with `*`/`_` runs) was decided by the
// forward-scan count in processEmphasis.openerMatches: an opener
// matches a closer only when the star budget — the opener's length,
// plus opener-like runs and minus closer-like runs between them —
// reaches <= 0 there. A delimiter deactivated inside an inner
// emphasis is literal text and stops counting (cm-470); one consumed
// into an inner emphasis still counts via its original length
// (cm-408). If that counting is broken, nested emphasis silently
// changes shape, so these cases pin marked 18.1.3's output for the
// inputs where the count is the deciding factor.
//
// Expected HTML below was captured from marked 18.1.3 itself (the
// bounty baseline), not from this entry, so a regression here fails
// loudly instead of agreeing with a broken renderer.
//
// Run:  node test/regression.mjs
// Exit code 0 = all pinned cases byte-identical.
// The full doc-11 check runs too when the practice files are
// present (MAKEFUN_CASES / MAKEFUN_EXPECTED, or the kit defaults);
// otherwise it is skipped with a note and the pinned cases still run.

import { readFileSync, existsSync } from 'node:fs';
import { parse } from '../parse.js';

// [input, expected HTML] — expected values from marked 18.1.3.
const PINNED = [
  // Nested em: the inner `*b*` is consumed first; the outer opener
  // then matches the final closer because the budget counts the
  // consumed inner run via origN (cm-408).
  ['*a *b* c*', '<p><em>a <em>b</em> c</em></p>\n'],
  ['*foo *bar* baz*', '<p><em>foo <em>bar</em> baz</em></p>\n'],
  // Strong outer, em inner: the closer run has exactly 2 stars, so
  // it cannot satisfy both the nearest em and the farther strong —
  // the strong opener wins (see the useHere logic in processEmphasis).
  ['**a *b* c**', '<p><strong>a <em>b</em> c</strong></p>\n'],
  ['x **a *b* c** y', '<p>x <strong>a <em>b</em> c</strong> y</p>\n'],
  // Em outer, strong inner.
  ['*a **b** c*', '<p><em>a <strong>b</strong> c</em></p>\n'],
  // Same shapes with underscores.
  ['__a _b_ c__', '<p><strong>a <em>b</em> c</strong></p>\n'],
  // Two independent em pairs in one line.
  ['foo *bar* baz *qux*', '<p>foo <em>bar</em> baz <em>qux</em></p>\n'],
  // Unmatched leading opener stays literal; the inner pair still forms.
  ['a *b *c* d* e', '<p>a <em>b <em>c</em> d</em> e</p>\n'],
  // Three nested openers, one closer run of 2: the budget decides
  // which opener the closer binds to.
  ['*a *b *c* d* e*', '<p><em>a <em>b <em>c</em> d</em> e</em></p>\n'],
  // Triple-star run: em wrapping strong.
  ['***a *b* c***', '<p><em><strong>a <em>b</em> c</strong></em></p>\n'],
];

let failures = 0;
for (const [input, expected] of PINNED) {
  const got = parse(input);
  if (got !== expected) {
    failures++;
    console.log(`FAIL ${JSON.stringify(input)}\n  got:      ${JSON.stringify(got)}\n  expected: ${JSON.stringify(expected)}`);
  }
}
console.log(`pinned star-budget cases: ${PINNED.length - failures}/${PINNED.length} passed`);

// Full doc-11 check (the case that originally closed the rule).
const casesPath = process.env.MAKEFUN_CASES || '/home/hatch/workspace/makefun/kits/markdown-render-speed-02-kit/practice/input/cases.json';
const expectedPath = process.env.MAKEFUN_EXPECTED || '/home/hatch/workspace/makefun/kits/markdown-render-speed-02-kit/practice/reference/expected.json';
if (existsSync(casesPath) && existsSync(expectedPath)) {
  const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8')).cases;
  const doc11 = cases.find((c) => c.id === 'doc-11');
  const exp11 = expected.find((c) => c.id === 'doc-11');
  const got11 = parse(doc11.markdown);
  if (got11 === exp11.html) {
    console.log('doc-11: byte-identical to marked 18.1.3 (86,303 chars in, star-budget rule intact)');
  } else {
    failures++;
    console.log(`FAIL doc-11: output differs from marked (got ${got11.length} chars, expected ${exp11.html.length} chars)`);
  }
} else {
  console.log('doc-11: skipped (practice files not present at ' + casesPath + ')');
}

if (failures > 0) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('regression: OK');
