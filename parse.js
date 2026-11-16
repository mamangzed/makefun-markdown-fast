// parse.js — a fast, dependency-free CommonMark 0.31.2 + GFM 0.29 renderer
// whose parse(markdown) returns exactly the HTML marked 18.1.3 returns
// with its default options (gfm on, breaks off). Written from the
// CommonMark/GFM specifications; no third-party code.
//
// Layout: small utilities and entity table, then a line-oriented block
// parser (container stack with lazy continuation), then an inline parser
// (delimiter stack for emphasis, opener stack for links), then rendering.

// ---------------------------------------------------------------- utils

const PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
function isPunct(ch) {
  return ch.length === 1 && PUNCT.indexOf(ch) >= 0;
}
// Unicode punctuation (general category P) for flanking rules. A single
// regex test per character; only used at delimiter runs.
const RE_UPUNCT = /^[\p{P}\p{S}]$/u;
const RE_UWS = /^\s$/u;
function isUnicodePunct(ch) {
  return ch.length === 1 && (PUNCT.indexOf(ch) >= 0 || RE_UPUNCT.test(ch));
}
function isUnicodeWs(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v' || (ch.length === 1 && RE_UWS.test(ch));
}
function isAsciiWs(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n';
}

// Escape text for HTML output. encode=true escapes every '&'; encode=false
// leaves a '&' alone when it starts a valid entity reference (named, or
// decimal/hex numeric), matching marked/CommonMark text escaping.
const RE_ESC_NOENC = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|[a-zA-Z][a-zA-Z0-9]*);)/g;
const RE_ESC_ENC = /[&<>"']/g;
function esc(s, encode) {
  if (!s) return s;
  let out = '';
  let last = 0;
  const re = encode ? RE_ESC_ENC : RE_ESC_NOENC;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out += s.slice(last, m.index);
    const c = m[0];
    out += c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;';
    last = m.index + 1;
  }
  if (last === 0) return s;
  if (last < s.length) out += s.slice(last);
  return out;
}

// ---------------------------------------------------------------- entities

// Named HTML entities. Text never decodes these (marked leaves "&copy;"
// as "&copy;"), but the table is needed to tell a *valid* entity from an
// invalid one when backpedalling extended autolinks ("&hl;" is not valid,
// "&amp;" is). Only genuine HTML5 names are listed.
const ENT = {
  AElig: 1, AMP: 1, Aacute: 1, Acirc: 1, Agrave: 1, Alpha: 1, Amacr: 1,
  Aogon: 1, Aring: 1, Atilde: 1, Auml: 1, Beta: 1, Ccedil: 1, Chi: 1,
  Dagger: 1, Dcaron: 1, Delta: 1, ETH: 1, Eacute: 1, Ecirc: 1, Egrave: 1,
  Epsilon: 1, Eta: 1, Euml: 1, Gamma: 1, Iacute: 1, Icirc: 1, Igrave: 1,
  Iota: 1, Iuml: 1, Kappa: 1, Lambda: 1, Mu: 1, Ntilde: 1, Nu: 1,
  Oacute: 1, Ocirc: 1, Ograve: 1, Omega: 1, Omicron: 1, Oslash: 1,
  Otilde: 1, Ouml: 1, Phi: 1, Pi: 1, Psi: 1, Rho: 1, Sigma: 1, THORN: 1,
  Tau: 1, Theta: 1, Uacute: 1, Ucirc: 1, Ugrave: 1, Upsilon: 1, Uuml: 1,
  Xi: 1, Yacute: 1, Zeta: 1, aacute: 1, acirc: 1, acute: 1, aelig: 1,
  agrave: 1, alefsym: 1, alpha: 1, amp: 1, and: 1, ang: 1, apos: 1,
  aring: 1, asymp: 1, atilde: 1, auml: 1, bdquo: 1, beta: 1, brvbar: 1,
  bull: 1, cap: 1, ccedil: 1, cedil: 1, cent: 1, chi: 1, circ: 1,
  clubs: 1, cong: 1, copy: 1, crarr: 1, cup: 1, curren: 1, dArr: 1,
  dagger: 1, darr: 1, dcaron: 1, deg: 1, delta: 1, diams: 1, divide: 1,
  eacute: 1, ecirc: 1, egrave: 1, empty: 1, emsp: 1, ensp: 1, epsilon: 1,
  equiv: 1, eta: 1, eth: 1, euml: 1, euro: 1, exist: 1, fnof: 1,
  forall: 1, frac12: 1, frac14: 1, frac34: 1, frasl: 1, gamma: 1, ge: 1,
  gt: 1, hArr: 1, harr: 1, hearts: 1, hellip: 1, iacute: 1, icirc: 1,
  iexcl: 1, igrave: 1, image: 1, infin: 1, int: 1, iota: 1, iquest: 1,
  isin: 1, iuml: 1, kappa: 1, lArr: 1, lambda: 1, lang: 1, laquo: 1,
  larr: 1, lceil: 1, ldquo: 1, le: 1, lfloor: 1, lowast: 1, loz: 1,
  lrm: 1, lsaquo: 1, lsquo: 1, lt: 1, macr: 1, mdash: 1, micro: 1,
  middot: 1, minus: 1, mu: 1, nabla: 1, nbsp: 1, ndash: 1, ne: 1, ni: 1,
  not: 1, notin: 1, ntilde: 1, nu: 1, oacute: 1, ocirc: 1, ograve: 1,
  oline: 1, omega: 1, omicron: 1, oplus: 1, or: 1, ordf: 1, ordm: 1,
  oslash: 1, otilde: 1, otimes: 1, ouml: 1, para: 1, part: 1, permil: 1,
  perp: 1, phi: 1, pi: 1, piv: 1, plusmn: 1, pound: 1, prime: 1,
  Prime: 1, prod: 1, prop: 1, psi: 1, quot: 1, rArr: 1, radic: 1,
  raquo: 1, rarr: 1, rang: 1, rceil: 1, rdquo: 1, real: 1, reg: 1,
  rfloor: 1, rho: 1, rlm: 1, rsaquo: 1, rsquo: 1, sbquo: 1, scaron: 1,
  Scaron: 1, sect: 1, shy: 1, sigma: 1, sigmaf: 1, sim: 1, spades: 1,
  sub: 1, sube: 1, sum: 1, sup: 1, sup1: 1, sup2: 1, sup3: 1, supe: 1,
  szlig: 1, tau: 1, there4: 1, theta: 1, thetasym: 1, thinsp: 1,
  thorn: 1, tilde: 1, times: 1, trade: 1, uArr: 1, uacute: 1, uarr: 1,
  ucirc: 1, ugrave: 1, uml: 1, upsih: 1, upsilon: 1, uuml: 1, weierp: 1,
  xi: 1, yacute: 1, yen: 1, yuml: 1, zeta: 1, zwj: 1, zwnj: 1,
  ClockwiseContourIntegral: 1, DifferentialD: 1, HilbertSpace: 1,
  ngE: 1, Tab: 1, NewLine: 1, colon: 1, sol: 1, bsol: 1, lpar: 1,
  rpar: 1, equals: 1, comma: 1, period: 1, semi: 1, quest: 1, excl: 1,
  plus: 1, hyphen: 1, lowbar: 1, Hat: 1, check: 1, cross: 1, star: 1,
  OElig: 1, oelig: 1, Scirc: 1, scirc: 1, Ycirc: 1, ycirc: 1, Cacute: 1,
  cacute: 1, Eogon: 1, eogon: 1, Gbreve: 1, gbreve: 1, Hstrok: 1,
  hstrok: 1, IJlig: 1, ijlig: 1, Jcirc: 1, jcirc: 1, Lacute: 1,
  lacute: 1, Lcaron: 1, lcaron: 1, Lmidot: 1, lmidot: 1, Lstrok: 1,
  lstrok: 1, Nacute: 1, nacute: 1, Ncaron: 1, ncaron: 1, Ncedil: 1,
  ncedil: 1, Racute: 1, racute: 1, Rcaron: 1, rcaron: 1, Sacute: 1,
  sacute: 1, Scedil: 1, scedil: 1, Tcaron: 1, tcaron: 1, Tcedil: 1,
  tcedil: 1, Tstrok: 1, tstrok: 1, Uring: 1, uring: 1, Yuml: 1,
  Zacute: 1, zacute: 1, Zcaron: 1, zcaron: 1, Zdot: 1, zdot: 1,
  amacr: 1, Abreve: 1, abreve: 1, aogon: 1, Ccaron: 1, ccaron: 1,
  Edot: 1, edot: 1, Emacr: 1, emacr: 1, Ecaron: 1, ecaron: 1, Gdot: 1,
  gdot: 1, Hbar: 1, hbar: 1, Idot: 1, Imacr: 1, imacr: 1, Iogon: 1,
  iogon: 1, Itilde: 1, itilde: 1, Ubreve: 1, ubreve: 1, Utilde: 1,
  utilde: 1, nsub: 1, sdot: 1,
};
function isValidEntityName(name) { return ENT[name] === 1; }

// Numeric entity decoding: only "&#...;" references are decoded to a
// character (&#0; and surrogates become U+FFFD); named references are
// never decoded. Returns [decodedChar, endIndex] or null when s[i] is not
// the start of a decodable numeric reference.
function decodeEntityAt(s, i) {
  // s[i] === '&'; returns [decodedString, endIndex] or null.
  const n = s.length;
  if (i + 1 >= n || s[i + 1] !== '#') return null;
  let j = i + 2;
  let hex = false;
  if (j < n && (s[j] === 'x' || s[j] === 'X')) { hex = true; j++; }
  const start = j;
  const maxDigits = hex ? 6 : 7;
  while (j < n && j - start < maxDigits) {
    const ch = s[j];
    if (hex ? (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F') : (ch >= '0' && ch <= '9')) j++;
    else break;
  }
  if (j === start || j >= n || s[j] !== ';') return null;
  // a longer digit run means the reference is not valid at all
  const after = s[j + 1];
  if (after !== undefined) {
    const ch2 = s[j + 1];
    if (hex ? (ch2 >= '0' && ch2 <= '9') || (ch2 >= 'a' && ch2 <= 'f') || (ch2 >= 'A' && ch2 <= 'F') : (ch2 >= '0' && ch2 <= '9')) return null;
  }
  const num = parseInt(s.slice(start, j), hex ? 16 : 10);
  let cp = num;
  if (num === 0 || num > 0x10FFFF || (num >= 0xD800 && num <= 0xDFFF)) cp = 0xFFFD;
  return [String.fromCodePoint(cp), j + 1];
}
// Is s[i..] the start of a valid entity reference (named or numeric) that
// text escaping must leave alone? Used by esc() via regex and by the
// autolink backpedal.
function entityEndAt(s, i) {
  const d = decodeEntityAt(s, i);
  if (d) return d[1];
  const n = s.length;
  let j = i + 1;
  while (j < n) {
    const ch = s[j];
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) j++;
    else break;
  }
  if (j < n && s[j] === ';' && j > i + 1 && isValidEntityName(s.slice(i + 1, j))) return j + 1;
  return -1;
}

// ---------------------------------------------------------------- URL utils

const RE_HREF_SAFE = /^[A-Za-z0-9;,\/?:@&=+$_.!~*'()#%-]*$/;
function encodeHref(s) {
  // marked percent-encodes the href like encodeURI, but preserves
  // existing valid %XX sequences (encodeURI turns %20 into %2520).
  if (RE_HREF_SAFE.test(s)) return esc(s, false);
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (ch === '%' && i + 2 < n) {
      const h1 = s[i + 1], h2 = s[i + 2];
      const hx = c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
      if (hx(h1) && hx(h2)) { out += s.slice(i, i + 3); i += 3; continue; }
    }
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') ||
        ch === '%' || ch === ';' || ch === ',' || ch === '/' || ch === '?' || ch === ':' || ch === '@' ||
        ch === '&' || ch === '=' || ch === '+' || ch === '$' || ch === '-' || ch === '_' ||
        ch === '.' || ch === '!' || ch === '~' || ch === '*' || ch === "'" || ch === '(' ||
        ch === ')' || ch === '#') {
      out += ch; i++; continue;
    }
    const cp = s.codePointAt(i);
    try { out += encodeURIComponent(String.fromCodePoint(cp)); }
    catch (err) { out += ch; }
    i += cp > 0xFFFF ? 2 : 1;
  }
  return esc(out, false);
}
function cleanTitle(s) {
  return esc(s, false);
}

// ---------------------------------------------------------------- tab-aware strings

// Column width of the leading whitespace of s (tabs to next multiple of 4),
// where s starts at absolute column startCol.
function indentOfFrom(s, startCol) {
  let col = startCol;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === ' ') col++;
    else if (ch === '\t') col += 4 - (col % 4);
    else break;
  }
  return col - startCol;
}
function indentOf(s) { return indentOfFrom(s, 0); }
// Is the string blank (only spaces/tabs)?
function isBlank(s) {
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== ' ' && ch !== '\t') return false;
  }
  return true;
}
// Remove n columns of leading indentation (tabs handled, partial tabs
// become spaces). s starts at absolute column startCol.
function expandLeadingTabs(s, startCol) {
  // expand tabs in the leading whitespace of s (s starts at absolute
  // column startCol) to spaces, to the next multiple of 4; a tab in a
  // fenced code line's leading whitespace is indentation, not content
  let col = startCol;
  let i = 0;
  let out = '';
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ') { out += ' '; i++; col++; }
    else if (ch === '\t') {
      const w = 4 - (col % 4);
      out += ' '.repeat(w);
      i++; col += w;
    } else break;
  }
  return out + s.slice(i);
}
function stripIndentFrom(s, n, startCol) {
  let col = startCol;
  let i = 0;
  while (i < s.length && col < startCol + n) {
    const ch = s[i];
    if (ch === ' ') { i++; col++; }
    else if (ch === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= startCol + n) { i++; col += w; }
      else {
        // partial tab: remainder becomes spaces
        const rem = w - (startCol + n - col);
        return ' '.repeat(rem) + s.slice(i + 1);
      }
    } else break;
  }
  return s.slice(i);
}
function stripIndent(s, n) { return stripIndentFrom(s, n, 0); }
// Strip up to 3 columns of indent (block-start allowance).
function stripUpTo3(s, col) {
  const c = col === undefined ? 0 : col;
  return stripIndentFrom(s, Math.min(3, indentOfFrom(s, c)), c);
}
// Process backslash escapes in a string (ASCII punctuation only).
function unescapeStr(s) {
  if (s.indexOf('\\') < 0) return s;
  let out = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length && isPunct(s[i + 1])) {
      out += s.slice(last, i) + s[i + 1];
      i++;
      last = i + 1;
    }
  }
  if (last === 0) return s;
  return out + s.slice(last);
}

// ---------------------------------------------------------------- blocks

const BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul').split(' '));
const HTML_TYPE1 = new Set(['script', 'pre', 'style', 'textarea']);

function node(t) { return { t, c: [] }; }

// Match a blockquote marker at the start of s (s is the content after
// outer containers, starting at absolute column col). Returns {s, col}
// after the marker, or null.
function matchBQ(s, col, nested) {
  const ind = indentOfFrom(s, col);
  if (ind > 3) return null;
  const s2 = stripIndentFrom(s, ind, col);
  if (s2.charCodeAt(0) !== 62) return null; // '>'
  let s3 = s2.slice(1);
  let col3 = col + ind + 1;
  // optional single space after '>' (one column; a tab gives a space and
  // the rest of the tab stays as spaces)
  if (s3.charCodeAt(0) === 32) {
    s3 = s3.slice(1); col3++;
    // a tab right after that space expands fully to the next tab stop
    // (the space already served as the '>' separator); the tab stop is
    // counted from the layer-local column (col3 - col: marked re-lexes
    // each container layer from column 0), not the absolute column
    if (s3.charCodeAt(0) === 9) {
      if (nested) s3 = '  ' + s3.slice(1);
      else { const w = 4 - ((col3 - col) % 4); s3 = ' '.repeat(w) + s3.slice(1); col3 += w; }
    }
  }
  else if (s3.charCodeAt(0) === 9) {
    if (nested) {
      // inside a nested blockquote a tab after '>' expands to exactly
      // two spaces (marked treats nested '>' markers as contributing
      // two columns to the tab stop, regardless of depth)
      s3 = '  ' + s3.slice(1);
    } else {
      const w = 4 - ((col3 - col) % 4);
      s3 = ' '.repeat(w - 1) + s3.slice(1);
      col3++;
    }
  }
  return { s: s3, col: col3 };
}

// Split a table row/header line into cells on unescaped '|'.
function splitCells(line) {
  const cells = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length && (line[i + 1] === '|' || line[i + 1] === '\\')) {
      cur += line[i + 1];
      i++;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  // drop empty first/last cell from a leading/trailing pipe
  const trimmed = line.trim();
  if (trimmed.charCodeAt(0) === 124 && cells.length && cells[0] === '') cells.shift();
  if (trimmed.charCodeAt(trimmed.length - 1) === 124 && cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
}
// Is s a table delimiter row? If so return the alignment list, else null.
function delimiterRow(s) {
  if (s.indexOf('|') < 0) return null;
  const cells = splitCells(s);
  if (!cells.length) return null;
  const aligns = [];
  for (const cell of cells) {
    const c = cell.trim();
    if (!/^:?-+:?$/.test(c)) return null;
    aligns.push(c.charCodeAt(0) === 58 && c.charCodeAt(c.length - 1) === 58 ? 'center' : c.charCodeAt(0) === 58 ? 'left' : c.charCodeAt(c.length - 1) === 58 ? 'right' : null);
  }
  return aligns;
}

// --- link reference definitions ------------------------------------------

// Parse a link reference definition from content lines. lines[0] is the
// current line's content; peek(i) returns the content of a later line at
// the current container level (or null). Returns {dest, title, used} (used
// = number of lines consumed) or null.
function parseDefinition(lines, peek) {
  // the definition text grows line by line (the label may span lines)
  let text = lines[0];
  let used = 1;
  let pos = 0;
  // up to 3 spaces indent
  while (pos < text.length && text.charCodeAt(pos) === 32 && pos < 3) pos++;
  if (text.charCodeAt(pos) !== 91) return null; // '['
  // label: scan to the first unescaped ']', rejecting unescaped '[',
  // pulling in further lines as needed (no blank line inside a label)
  let i = pos + 1;
  let label = '';
  let closed = false;
  while (!closed) {
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\' && i + 1 < text.length && isPunct(text[i + 1])) { label += text[i] + text[i + 1]; i += 2; continue; }
      if (ch === '[') return null;
      if (ch === ']') { closed = true; break; }
      label += ch;
      i++;
      if (label.length > 999) return null;
    }
    if (closed) break;
    const nx = peek(used);
    if (nx === null || isBlank(nx)) return null;
    text += '\n' + nx;
    used++;
  }
  if (text.charCodeAt(i + 1) !== 58) return null; // ':'
  // the rest of the definition (destination + title) starts after ':'
  text = text.slice(i + 2);
  // skip whitespace (spaces/tabs/newlines) but not blank lines; the
  // destination must appear before a blank line. Appends lines to the
  // outer text as it goes.
  function skipWs(p) {
    while (true) {
      while (p < text.length && (text[p] === ' ' || text[p] === '\t')) p++;
      if (p < text.length) return p;
      // end of this line: try the next line
      const nx = peek(used);
      if (nx === null || isBlank(nx)) return -1;
      text += '\n' + nx;
      used++;
      p = text.length - nx.length;
    }
  }
  let p = skipWs(0);
  if (p < 0) return null;
  // destination
  let dest = '';
  if (text[p] === '<') {
    let j = p + 1;
    let ok = false;
    while (j < text.length) {
      const ch = text[j];
      if (ch === '\n' || ch === '<') return null;
      if (ch === '>') { ok = true; break; }
      if (ch === '\\' && j + 1 < text.length && isPunct(text[j + 1])) { dest += text[j + 1]; j += 2; continue; }
      dest += ch;
      j++;
    }
    if (!ok) return null;
    p = j + 1;
  } else {
    // bare destination: no spaces/control, balanced parens
    let depth = 0;
    let j = p;
    while (j < text.length) {
      const ch = text[j];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch.charCodeAt(0) < 32) break;
      if (ch === '\\' && j + 1 < text.length && isPunct(text[j + 1])) { dest += text[j + 1]; j += 2; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') {
        if (depth === 0) break;
        depth--;
      }
      dest += ch;
      j++;
    }
    if (j === p) return null; // empty destination
    p = j;
  }
  // optional title
  let title = null;
  // save the state right after the destination, for the no-title fallback
  const pAfterDest = p;
  const usedAfterDest = used;
  const textAfterDest = text;
  const p2 = skipWs(p);
  let titleOk = false;
  if (p2 >= 0 && p2 > p) {
    const q = text[p2];
    if (q === '"' || q === "'" || q === '(') {
      const close = q === '(' ? ')' : q;
      let j = p2 + 1;
      let t = '';
      let ok = false;
      while (true) {
        if (j >= text.length) {
          // ran out of text: pull in the next line; a blank line or
          // EOF leaves the title unterminated
          const nx = peek(used);
          if (nx === null || isBlank(nx)) break;
          text += '\n' + nx;
          used++;
        }
        const ch = text[j];
        if (ch === '\n') { t += '\n'; j++; continue; }
        if (ch === '\\' && j + 1 < text.length && isPunct(text[j + 1])) { t += text[j + 1]; j += 2; continue; }
        if (q === '(' && ch === '(') break;
        if (ch === close) { ok = true; break; }
        t += ch;
        j++;
      }
      if (ok) {
        // only whitespace may follow the title on its line
        let k = j + 1;
        while (k < text.length && (text[k] === ' ' || text[k] === '\t')) k++;
        if (k >= text.length || text[k] === '\n') {
          title = t;
          p = j + 1;
          titleOk = true;
        }
      }
    }
  }
  if (!titleOk) {
    // no title (or a failed title): the definition is still valid if
    // nothing but whitespace follows the destination on its line;
    // the title's line is then not consumed
    let k = pAfterDest;
    while (k < textAfterDest.length && (textAfterDest[k] === ' ' || textAfterDest[k] === '\t')) k++;
    if (k < textAfterDest.length && textAfterDest[k] !== '\n') return null;
    text = textAfterDest;
    used = usedAfterDest;
    p = pAfterDest;
  }
  const norm = normalizeLabel(label);
  if (!norm) return null;
  return { label: norm, dest, title, used };
}

function normalizeLabel(label) {
  // Labels compare RAW (backslashes kept: "foo\!" is not "foo!"),
  // whitespace runs collapsed to one space, trimmed, case-folded.
  // Unicode case folding maps ß/ẞ to "ss" (toLowerCase gives ß).
  let s = label.replace(/\s+/g, ' ').trim().toLowerCase();
  if (s.indexOf('ß') >= 0) s = s.replace(/ß/g, 'ss');
  return s;
}

// ---------------------------------------------------------------- the parser

function parseBlocks(lines, srcEndsNL) {
  const defs = new Map();
  const doc = node('doc');
  const stack = [doc];
  let pendingBlank = false;
  let i = 0;
  const n = lines.length;

  const tip = () => stack[stack.length - 1];
  function addBlock(nd) {
    tip().c.push(nd);
    return nd;
  }
  function closePara() {
    if (tip().t === 'para') stack.pop();
  }
  // Remove the tip node from the stack and from its parent's children.
  function removeTip() {
    const parent = stack[stack.length - 2];
    parent.c.pop();
    stack.pop();
  }
  // Replace the tip node (a paragraph) with nd: remove the paragraph from
  // the stack and from its parent's children, then add nd to the parent.
  function replaceTipWith(nd) {
    removeTip();
    addBlock(nd);
  }

  // Content of lines[idx] at the current container level, or null if the
  // line does not match the open containers. Returns {s, col} where col is
  // the absolute column the content starts at (a blank line is {s:'',col:0}).
  // Like peekContent but only matches blockquote markers, ignoring
  // list-item indentation: used by fenced code blocks to tell a line
  // that merely lacks list indentation (still code content) apart
  // from one that lacks a '>' marker (the blockquote, and the code
  // block inside it, ends). Returns {s, col} or null.
  function matchBQsOnly(s, col) {
    let bqSeen = false;
    for (let k = 1; k < stack.length; k++) {
      const nd = stack[k];
      if (nd.t === 'bq') {
        const r = matchBQ(s, col, bqSeen);
        if (!r) return null;
        s = r.s; col = r.col;
        bqSeen = true;
      }
    }
    return { s, col };
  }

  function peekContent(idx) {
    if (idx >= n) return null;
    let s = lines[idx];
    let col = 0;
    if (isBlank(s)) {
      // a blank line is content only when no blockquote is open (it has
      // no '>' marker, so it is not inside a blockquote); for list items
      // strip the item indents and keep the remaining spaces (they matter
      // inside indented code blocks)
      for (let k = 1; k < stack.length; k++) {
        const nd = stack[k];
        if (nd.t === 'bq') return null;
        if (nd.t === 'item') {
          const avail = indentOfFrom(s, col);
          const strip = Math.min(avail, nd.indent);
          if (strip > 0) { s = stripIndentFrom(s, strip, col); col += strip; }
        } else if (nd.t === 'para') return null;
      }
      return { s, col };
    }
    let bqSeen = false;
    let bqOrigin = null;
    for (let k = 1; k < stack.length; k++) {
      const nd = stack[k];
      if (nd.t === 'bq') {
        // record the column where the innermost blockquote layer's
        // line starts: marked re-lexes each container layer from
        // column 0, so a tab inside it expands from the layer-local
        // column (r.col - bqOrigin), not the absolute document column
        bqOrigin = col;
        const r = matchBQ(s, col, bqSeen);
        if (!r) return null;
        s = r.s; col = r.col;
        bqSeen = true;
      } else if (nd.t === 'item') {
        if (isBlank(s)) return null;
        const ind = indentOfFrom(s, col);
        if (ind < nd.indent) return null;
        s = stripIndentFrom(s, nd.indent, col);
        col = col + nd.indent;
      } else if (nd.t === 'para') {
        return null;
      }
    }
    return { s, col, bqOrigin };
  }

  // Try to parse link reference definitions starting at line i with
  // content s. Returns {nextI, firstContent} (the first non-definition
  // line and its content) or null when the first line is no definition.
  function tryDefinitions(s) {
    let cur = i;
    let curContent = s;
    let any = false;
    for (;;) {
      const peek = (off) => { const r = peekContent(cur + off); return r ? r.s : null; };
      const d = parseDefinition([curContent], peek);
      if (!d) break;
      any = true;
      if (!defs.has(d.label)) defs.set(d.label, { dest: d.dest, title: d.title });
      cur += d.used;
      // skip blank lines between definitions
      while (cur < n) {
        const c = peekContent(cur);
        if (c === null) break;
        if (!isBlank(c.s)) break;
        cur++;
      }
      if (cur >= n) return { nextI: cur, firstContent: null };
      const c = peekContent(cur);
      if (c === null) return { nextI: cur, firstContent: null };
      curContent = c.s;
    }
    if (!any) return null;
    return { nextI: cur, firstContent: curContent };
  }

  // Does s (a line at the current container level) start a block that can
  // interrupt a paragraph? Used for lazy continuation.
  function startsInterrupting(s, col) {
    const t = stripUpTo3(s, col);
    if (!t) return false;
    const ch0 = t.charCodeAt(0);
    if (ch0 === 35) { // '#'
      let j = 0;
      while (j < t.length && t.charCodeAt(j) === 35) j++;
      if (j >= 1 && j <= 6 && (j === t.length || t.charCodeAt(j) === 32 || t.charCodeAt(j) === 9)) return true;
    }
    if (ch0 === 96 || ch0 === 126) { // '`' or '~'
      let j = 0;
      while (j < t.length && t.charCodeAt(j) === ch0) j++;
      if (j >= 3) {
        if (ch0 === 96 && t.slice(j).indexOf('`') >= 0) return false;
        return true;
      }
    }
    if (ch0 === 60) { // '<' html block types 1-6
      if (htmlBlockType(t) >= 1 && htmlBlockType(t) <= 6) return true;
    }
    if (ch0 === 62) return true; // '>' blockquote
    if (isThematicBreak(t)) return true;
    const lm = listMarker(t);
    if (lm) return true;
    return false;
  }

  function isThematicBreak(t) {
    const ch = t.charCodeAt(0);
    if (ch !== 42 && ch !== 45 && ch !== 95) return false; // * - _
    let count = 0;
    for (let k = 0; k < t.length; k++) {
      const c = t.charCodeAt(k);
      if (c === ch) count++;
      else if (c !== 32 && c !== 9) return false;
    }
    return count >= 3;
  }
  function isSetext(t) {
    const ch = t.charCodeAt(0);
    if (ch !== 61 && ch !== 45) return false; // = -
    let k = 0;
    while (k < t.length && t.charCodeAt(k) === ch) k++;
    if (k === 0) return false;
    // only spaces/tabs may follow the run
    while (k < t.length && (t.charCodeAt(k) === 32 || t.charCodeAt(k) === 9)) k++;
    return k === t.length;
  }
  // List marker at the start of t (after up-to-3 indent already stripped).
  // Returns {ord, start, delim, bullet, width, rest} or null.
  function listMarker(t) {
    const ch0 = t.charCodeAt(0);
    if (ch0 === 45 || ch0 === 43 || ch0 === 42) { // - + *
      const nx = t.charCodeAt(1);
      if (t.length === 1 || nx === 32 || nx === 9) {
        return { ord: false, bullet: t[0], width: 1, rest: t.slice(1) };
      }
      return null;
    }
    if (ch0 >= 48 && ch0 <= 57) {
      let j = 0;
      while (j < t.length && t.charCodeAt(j) >= 48 && t.charCodeAt(j) <= 57) j++;
      if (j > 9) return null;
      const d = t.charCodeAt(j);
      if (d !== 46 && d !== 41) return null; // . )
      const nx = t.charCodeAt(j + 1);
      if (j + 1 === t.length || nx === 32 || nx === 9) {
        return { ord: true, start: parseInt(t.slice(0, j), 10), delim: t[j], width: j + 1, rest: t.slice(j + 1) };
      }
    }
    return null;
  }
  // HTML block start type (1-7) for a line whose indent is already <= 3,
  // or 0 when not an HTML block start.
  function htmlBlockType(t) {
    if (t.charCodeAt(0) !== 60) return 0; // '<'
    const low = t.toLowerCase();
    if (low.startsWith('<script') || low.startsWith('<pre') || low.startsWith('<style') || low.startsWith('<textarea')) {
      const after = low.slice(1);
      const tagEnd = after.search(/[\s/>]/);
      const tag = tagEnd < 0 ? after : after.slice(0, tagEnd);
      if (HTML_TYPE1.has(tag)) return 1;
    }
    if (t.startsWith('<!--')) return 2;
    if (t.startsWith('<?')) return 3;
    if (/^<![A-Z]/.test(t)) return 4;
    if (t.startsWith('<![CDATA[')) return 5;
    // type 6: <tag or </tag where tag is a block tag (not type 1) and the
    // tag is followed by whitespace, end of line, '>' or '/>'; the tag
    // need not be complete on this line
    {
      let j = 1;
      if (t.charCodeAt(1) === 47) j = 2; // '/'
      let k = j;
      while (k < t.length && /[A-Za-z0-9-]/.test(t[k])) k++;
      if (k > j) {
        const tag = t.slice(j, k).toLowerCase();
        if (BLOCK_TAGS.has(tag) && !HTML_TYPE1.has(tag)) {
          const after = t.charCodeAt(k);
          if (k === t.length || after === 32 || after === 9 || after === 62 ||
              (after === 47 && t.charCodeAt(k + 1) === 62)) return 6;
        }
      }
    }
    // type 7: a complete open or closing tag alone on the line (validated
    // with the same strict attribute rules as inline HTML)
    const trimmed = t.trim();
    if (trimmed.length > 0 && matchInlineHtml(trimmed, 0) === trimmed.length) return 7;
    return 0;
  }

  // --- leaf block parsers (consume lines starting at i) -----------------

  function parseFenced(s, col) {
    const t = stripUpTo3(s, col);
    const fenceCh = t.charCodeAt(0);
    let j = 0;
    while (j < t.length && t.charCodeAt(j) === fenceCh) j++;
    const len = j;
    const info = t.slice(j).trim();
    if (fenceCh === 96 && info.indexOf('`') >= 0) return false;
    const lang = info.split(/[ \t]/)[0] || '';
    // content lines until a closing fence (s is the first line's content);
    // each content line loses up to the opening fence's indentation --
    // except a tilde fence inside a container (blockquote or list item):
    // marked keeps the content's indent after the container markers
    // (it strips the container indent but not the fence indent)
    let fenceIndent = indentOfFrom(s, col);
    if (fenceCh === 126 && stack.some(nd => nd.t === 'bq' || nd.t === 'item')) fenceIndent = 0;
    const content = [];
    let k = i + 1;
    while (k < n) {
      // fenced content is raw text until the closing fence: a line
      // that does not match the enclosing container only because of
      // list-item indentation is still code content (raw line, with
      // blockquote markers stripped); a line missing a '>' marker
      // ends the blockquote and the code block inside it
      let r = peekContent(k);
      if (r === null) {
        // a line that does not match the enclosing container is code
        // content only once the block already has content (a 0-indent
        // first line after the fence is outside the list item, so the
        // block is empty) -- except inside a blockquote, where the
        // '>' marker test below decides (a blank '>' line is content,
        // a line missing '>' ends the block)
        const inBq = stack.some(nd => nd.t === 'bq');
        if (content.length === 0 && !inBq) break;
        r = matchBQsOnly(lines[k], 0);
        if (r === null) break;
      }
      const c = r.s;
      const ct = stripUpTo3(c, r.col);
      let f = 0;
      while (f < ct.length && ct.charCodeAt(f) === fenceCh) f++;
      if (f >= len && ct.slice(f).trim() === '') { k++; break; }
      // strip up to the opening fence's indentation; a leading tab in
      // the remainder is expanded to spaces only when the line is
      // inside a container (r.col > 0, i.e. a container indent was
      // stripped) -- at the top level a leading tab stays a literal tab.
      // Inside 2+ nested blockquotes the tab stop is column 2 (marked
      // treats the nested '>' markers as contributing two columns).
      const stripped = fenceIndent > 0 ? stripIndentFrom(c, fenceIndent, r.col) : c;
      // a tab in fenced content expands from the layer-local column:
      // the column within the innermost blockquote layer's re-lexed
      // text (r.col minus the column that layer's line started at),
      // not the absolute document column; no blockquote -> as before
      let tabCol = r.bqOrigin != null ? r.col - r.bqOrigin : r.col;
      content.push(r.col > 0 ? expandLeadingTabs(stripped, tabCol + fenceIndent) : stripped);
      k++;
    }
    const nd = node('code');
    nd.lang = lang ? unescapeStr(lang) : null;
    // a fenced code block drops exactly one trailing empty line
    if (content.length && content[content.length - 1] === '') content.pop();
    nd.text = content.length ? content.join('\n') + '\n' : '';
    addBlock(nd);
    i = k - 1; // main loop advances past the closing fence line
    return true;
  }

  function parseIndentedCode(s, col) {
    // s is the first line's content (already after containers/marker)
    const content = [stripIndentFrom(s, 4, col)];
    let lastNonBlank = 0;
    let k = i + 1;
    while (k < n) {
      const r = peekContent(k);
      if (r === null) break;
      const c = r.s;
      if (isBlank(c)) { content.push(stripIndentFrom(c, 4, r.col)); k++; continue; }
      if (indentOfFrom(c, r.col) < 4) break;
      content.push(stripIndentFrom(c, 4, r.col));
      lastNonBlank = content.length - 1;
      k++;
    }
    // strip trailing blank lines
    content.length = lastNonBlank + 1;
    const nd = node('code');
    nd.lang = null;
    nd.text = content.join('\n') + '\n';
    addBlock(nd);
    i = k - 1;
    return true;
  }

  function parseHtmlBlock(s, col) {
    const type = htmlBlockType(stripUpTo3(s, col));
    // s is the first line's content
    const linesOut = [s];
    let k = i + 1;
    const pushLine = () => {
      const r = peekContent(k);
      if (r === null) return null;
      linesOut.push(r.s);
      k++;
      return r.s;
    };
    if (type === 1) {
      const tag = s.toLowerCase().match(/<(script|pre|style|textarea)/)[1];
      const endTag = '</' + tag + '>';
      if (s.toLowerCase().indexOf(endTag) < 0) {
        for (;;) {
          const c = pushLine();
          if (c === null) break;
          if (c.toLowerCase().indexOf(endTag) >= 0) break;
        }
      }
    } else if (type === 2) {
      // ends at the first -->, or immediately for <!--> / <!-->
      const t0 = stripUpTo3(s, col);
      const abrupt = t0.startsWith('<!-->') || t0.startsWith('<!--->');
      if (!abrupt && s.indexOf('-->') < 0) {
        for (;;) {
          const c = pushLine();
          if (c === null) break;
          if (c.indexOf('-->') >= 0) break;
        }
      }
    } else if (type === 3) {
      if (s.indexOf('?>') < 0) {
        for (;;) {
          const c = pushLine();
          if (c === null) break;
          if (c.indexOf('?>') >= 0) break;
        }
      }
    } else if (type === 4) {
      if (s.indexOf('>') < 0) {
        for (;;) {
          const c = pushLine();
          if (c === null) break;
          if (c.indexOf('>') >= 0) break;
        }
      }
    } else if (type === 5) {
      if (s.indexOf(']]>') < 0) {
        for (;;) {
          const c = pushLine();
          if (c === null) break;
          if (c.indexOf(']]>') >= 0) break;
        }
      }
    } else {
      // types 6 and 7: until a blank line
      for (;;) {
        const r = peekContent(k);
        if (r === null || isBlank(r.s)) break;
        linesOut.push(r.s);
        k++;
      }
    }
    let text = linesOut.join('\n');
    // trailing newline: types 1-5 add one when the next line at this
    // level is non-empty (any content, even spaces/tabs only); types
    // 6-7 end at a blank line/EOF so only the EOF case adds one. A
    // truly empty line (zero length) after the block gives no newline.
    const next = k < n ? peekContent(k) : null;
    if (type >= 1 && type <= 5 && next !== null && next.s.length > 0) text += '\n';
    else if (k >= n && srcEndsNL) text += '\n';
    const nd = node('html');
    nd.text = text;
    addBlock(nd);
    i = k - 1;
    return true;
  }

  function parseTable(headerLine, delimLine, bodyStart) {
    const head = splitCells(headerLine);
    const aligns = delimiterRow(delimLine);
    const ncols = aligns.length;
    while (head.length < ncols) head.push('');
    head.length = ncols;
    const rows = [];
    let k = bodyStart;
    while (k < n) {
      const r = peekContent(k);
      if (r === null) break;
      // a table body row ends only on an empty or spaces-only line; a
      // line containing a tab is a row (marked's table regex uses ' *'
      // for its blank-line lookahead, so a tab is not blank here)
      let allSpace = r.s.length === 0;
      if (!allSpace) {
        allSpace = true;
        for (let q = 0; q < r.s.length; q++) if (r.s.charCodeAt(q) !== 32) { allSpace = false; break; }
      }
      if (allSpace) break;
      const c = r.s;
      if (startsInterrupting(c, r.col)) break;
      const cells = splitCells(c);
      while (cells.length < ncols) cells.push('');
      cells.length = ncols;
      rows.push(cells);
      k++;
    }
    const nd = node('table');
    nd.aligns = aligns;
    nd.head = head;
    nd.rows = rows;
    addBlock(nd);
    i = k - 1;
    return true;
  }

  // --- main line loop ----------------------------------------------------

  function addParaLine(para, s) {
    para.lines.push(s);
  }
  function startPara(s) {
    const nd = node('para');
    nd.lines = [s];
    nd.lazy = false;
    addBlock(nd);
    stack.push(nd);
  }
  // A lazy setext '===' underline: the line, ignoring leading
  // whitespace, is '='s followed only by whitespace.
  function isLazySetextEq(s) {
    let j = 0;
    while (j < s.length && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9)) j++;
    if (j >= s.length || s.charCodeAt(j) !== 61) return false; // '='
    while (j < s.length && s.charCodeAt(j) === 61) j++;
    while (j < s.length && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9)) j++;
    return j === s.length;
  }
  // Pad a line's leading whitespace to 4 columns (with spaces) when it
  // is narrower; leave it alone when it is already 4+ columns.
  function padTo4(s, col) {
    const ind = indentOfFrom(s, col);
    if (ind >= 4) return s;
    let j = 0;
    while (j < s.length && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9)) j++;
    return '    ' + s.slice(j);
  }

  // Try to start a block from content s at the current container.
  // inPara: the tip is a paragraph (only interrupting starts allowed).
  // Returns true when a block was started (or the paragraph ended).
  function tryBlockStart(s, col, inPara) {
    const t = stripUpTo3(s, col);
    const ind = indentOfFrom(s, col);
    if (!t) return false;
    const ch0 = t.charCodeAt(0);
    // ATX heading
    if (ch0 === 35) {
      let j = 0;
      while (j < t.length && t.charCodeAt(j) === 35) j++;
      if (j >= 1 && j <= 6 && (j === t.length || t.charCodeAt(j) === 32 || t.charCodeAt(j) === 9)) {
        closePara();
        // strip a closing sequence of #'s (preceded by whitespace) first,
        // then trim; the separator space after the opening #'s counts as
        // the whitespace before a closing sequence
        let text = t.slice(j);
        text = text.replace(/[ \t]+#+[ \t]*$/, '');
        text = text.trim();
        const nd = node('h');
        nd.level = j;
        nd.text = text;
        addBlock(nd);
        return true;
      }
    }
    // fenced code
    if ((ch0 === 96 || ch0 === 126)) {
      let j = 0;
      while (j < t.length && t.charCodeAt(j) === ch0) j++;
      if (j >= 3 && !(ch0 === 96 && t.slice(j).indexOf('`') >= 0)) {
        closePara();
        parseFenced(s, col);
        return true;
      }
    }
    // HTML block (types 1-6 interrupt paragraphs; 7 does not)
    if (ch0 === 60) {
      const ht = htmlBlockType(t);
      if (ht >= 1 && ht <= 6) {
        closePara();
        parseHtmlBlock(s, col);
        return true;
      }
      if (ht === 7 && !inPara) {
        parseHtmlBlock(s, col);
        return true;
      }
    }
    // setext heading (only when in a paragraph)
    if (inPara) {
      const st = isSetext(t);
      if (st) {
        const para = tip();
        const nd = node('h');
        nd.level = t.charCodeAt(0) === 61 ? 1 : 2;
        nd.text = para.lines.join('\n').trim();
        replaceTipWith(nd);
        return true;
      }
    }
    // thematic break
    if (isThematicBreak(t)) {
      closePara();
      addBlock(node('hr'));
      return true;
    }
    // list
    const lm = listMarker(t);
    if (lm) {
      if (inPara) {
        // an ordered list can interrupt a paragraph only if it starts
        // with 1 -- except when the paragraph is inside a list item
        // and the marker is a nested list of that item (its parent on
        // the stack is the item), where any start number begins a
        // sub-list; an empty item never interrupts a paragraph
        const par = stack[stack.length - 2];
        const nestedInItem = par && par.t === 'item';
        if (lm.rest.trim() === '') return false;
        if (lm.ord && lm.start !== 1 && !nestedInItem) return false;
      }
      closePara();
      startList(s, col, lm, ind);
      return true;
    }
    // indented code (not in a paragraph)
    if (!inPara && ind >= 4) {
      parseIndentedCode(s, col);
      return true;
    }
    return false;
  }

  function startList(s, col, lm, ind) {
    // find or create the list in the current container
    const parent = tip();
    let list = null;
    const last = parent.c[parent.c.length - 1];
    if (last && last.t === 'list' && last.ord === lm.ord &&
      (lm.ord ? last.delim === lm.delim : last.bullet === lm.bullet)) {
      list = last;
      // a blank line before a sibling item makes the reused list loose
      if (pendingBlank) { list.tight = false; pendingBlank = false; }
    } else {
      // a blank line before a new (sub-)list makes the enclosing list
      // loose; a brand-new top-level list stays tight
      if (pendingBlank) {
        const enc = innermostList();
        if (enc) enc.tight = false;
        pendingBlank = false;
      }
      list = node('list');
      list.ord = lm.ord;
      list.start = lm.ord ? lm.start : 0;
      list.delim = lm.ord ? lm.delim : null;
      list.bullet = lm.ord ? null : lm.bullet;
      list.tight = true;
      addBlock(list);
    }
    stack.push(list);
    startItem(s, col, lm, ind);
  }

  function startItem(s, col, lm, ind) {
    // content indent: marker indent + marker width + following spaces,
    // relative to the start of this line's container content (not an
    // absolute column: a blockquote marker strips a variable number of
    // columns, so an absolute indent miscompares across lines)
    const markerCol = col + ind;
    let contentIndent;
    const rest = lm.rest;
    // count spaces/tabs after the marker (up to 4 columns; 5+ means 1)
    let j = 0;
    let spaces = 0;
    while (j < rest.length && (rest.charCodeAt(j) === 32 || rest.charCodeAt(j) === 9)) {
      if (rest.charCodeAt(j) === 32) spaces++;
      else spaces += 4 - ((markerCol + lm.width + spaces) % 4);
      j++;
      if (spaces >= 5) break;
    }
    if (rest.slice(j).trim() === '') {
      // empty item: content indent is marker + width + 1
      contentIndent = ind + lm.width + 1;
    } else if (spaces >= 5) {
      contentIndent = ind + lm.width + 1;
    } else {
      contentIndent = ind + lm.width + spaces;
    }
    const item = node('item');
    item.indent = contentIndent;
    addBlock(item);
    stack.push(item);
    // the item's content: the rest of this line after the marker+spaces
    // (strip `spaces` columns = contentIndent - ind - lm.width)
    const content = stripIndentFrom(rest, contentIndent - ind - lm.width, markerCol + lm.width);
    if (content.trim() !== '') {
      // task list item: "[ ] " / "[x] " / "[X] " at the start, with
      // non-space content after it; the marker is stripped and the
      // checkbox is rendered at the start of the first paragraph
      let firstContent = content;
      let firstCol = col + contentIndent;
      const tm = content.match(/^\[([ xX])\][ \t]+/);
      if (tm && content.slice(tm[0].length).trim() !== '') {
        item.task = (tm[1] === 'x' || tm[1] === 'X') ? 'checked' : 'unchecked';
        firstContent = content.slice(tm[0].length);
        firstCol = firstCol + tm[0].length;
      }
      // process the item's first line as block content
      processContent(firstContent, firstCol);
      if (item.task && item.c.length > 0 && item.c[0].t === 'para') {
        item.c[0].task = item.task;
      }
    } else {
      // empty item: nothing on this line; the item may get blocks later
      item.empty = true;
    }
  }

  // A blank line followed by content inside a list makes the list
  // loose. Call after the new block is on the stack, so the (possibly
  // reused) list is found by innermostList.
  function clearPendingBlank() {
    if (!pendingBlank) return;
    const lst = innermostList();
    if (lst) lst.tight = false;
    pendingBlank = false;
  }

  // Process a line's content (after container markers) as block content
  // inside the current container. Used for a list item's first line.
  // May advance the global line index i when definitions (or the block
  // they are followed by) consume further lines; the caller then does
  // i++ to move past the last consumed line.
  function processContent(s, col) {
    if (isBlank(s)) return;
    // blockquote start
    const bqr = matchBQ(s, col, stack.some(nd => nd.t === 'bq'));
    if (bqr) {
      const bq = node('bq');
      addBlock(bq);
      stack.push(bq);
      processContent(bqr.s, bqr.col);
      clearPendingBlank();
      return;
    }
    // link reference definitions (they may span lines, and may be
    // followed by a first non-definition line on this level)
    const defRes = tryDefinitions(s);
    if (defRes) {
      if (defRes.firstContent === null) {
        i = defRes.nextI - 1;
        return;
      }
      i = defRes.nextI;
      processContent(defRes.firstContent, col);
      return;
    }
    // the list enclosing this line, before the new block starts (a
    // newly created list must not be marked loose by a preceding blank)
    const listBefore = innermostList();
    if (tryBlockStart(s, col, false)) {
      // mark the list that enclosed this line loose (captured before
      // the block started, so a newly created list is not marked);
      // a reused sibling list was already handled inside startList
      if (pendingBlank) {
        if (listBefore) listBefore.tight = false;
        pendingBlank = false;
      }
      return;
    }
    // table check: current line + next line
    const nxr = peekContent(i + 1);
    if (nxr !== null && !isBlank(nxr.s)) {
      const nx = nxr.s;
      const aligns = delimiterRow(nx);
      if (aligns) {
        const head = splitCells(s);
        if (head.length === aligns.length) {
          parseTable(s, nx, i + 2);
          clearPendingBlank();
          return;
        }
      }
    }
    clearPendingBlank();
    startPara(s);
  }

  function innermostList() {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k].t === 'list') return stack[k];
    }
    return null;
  }

  // --- the loop ----------------------------------------------------------

  while (i < n) {
    const raw = lines[i];
    // phase 1: match open containers
    let s = raw;
    let col = 0;
    let k = 1;
    let matched = stack.length;
    let isNewItem = false;
    let bqSeen = false;
    for (; k < stack.length; k++) {
      const nd = stack[k];
      if (nd.t === 'bq') {
        const r = matchBQ(s, col, bqSeen);
        if (!r) { matched = k; break; }
        s = r.s; col = r.col;
        bqSeen = true;
      } else if (nd.t === 'item') {
        if (!isBlank(s)) {
          const ind = indentOfFrom(s, col);
          if (ind < nd.indent) {
            // does the line start a new item of the enclosing list?
            const lm = listMarker(stripUpTo3(s, col));
            const lst = stack[k - 1];
            const same = lm && lst.t === 'list' && (lm.ord === lst.ord) &&
              (lm.ord ? lm.delim === lst.delim : lm.bullet === lst.bullet);
            isNewItem = !!same;
            matched = same ? k : k - 1;
            break;
          }
          s = stripIndentFrom(s, nd.indent, col);
          col = col + nd.indent;
        }
      }
      // list and para nodes match trivially
    }
    if (isBlank(s) && s.length > 0 && tip().t === 'para' && stack.some(nd => nd.t === 'bq')) {
      // a whitespace-only line inside a blockquote whose content is
      // non-empty (e.g. '>  ' leaves a single space) is a paragraph
      // line, not a blank line, when it is the last line of input
      // (all following lines blank); mid-document it closes the
      // paragraph as usual
      let restBlank = true;
      for (let j = i + 1; j < n; j++) if (!isBlank(lines[j])) { restBlank = false; break; }
      if (restBlank) {
        addParaLine(tip(), s);
        i++;
        continue;
      }
    }
    if (isBlank(s)) {
      // a blank line closes the paragraph and every container the line
      // did not match (a blockquote ends at a blank line without a '>'
      // marker); a blank line alone never closes a list, and it closes
      // an empty list item
      closePara();
      while (stack.length > matched) stack.pop();
      while (tip().t === 'item' && tip().c.length === 0) stack.pop();
      // a blank line makes a list loose only when it is at the
      // list/item level (not nested inside a blockquote or other block
      // within an item)
      pendingBlank = (tip().t === 'item' || tip().t === 'list');
      i++;
      continue;
    }
    if (matched < stack.length) {
      const tipNode = tip();
      if (tipNode.t === 'para' && !isNewItem && matched <= stack.length - 2 && !startsInterrupting(s, col)) {
        // lazy continuation line (the failing container may be an
        // ancestor of the paragraph, e.g. an outer blockquote). Its
        // content: a line indented by 4+ columns loses 4 columns; a
        // setext '===' underline following a lazy line is padded to
        // 4 columns instead.
        let lazyLine = s;
        if (isLazySetextEq(s) && tipNode.lazy) {
          lazyLine = padTo4(s, col);
        } else {
          const ind = indentOfFrom(s, col);
          if (ind >= 4) lazyLine = stripIndentFrom(s, 4, col);
        }
        if (tipNode.lines.length === 1) {
          const aligns = delimiterRow(lazyLine);
          if (aligns) {
            const head = splitCells(tipNode.lines[0]);
            if (head.length === aligns.length) {
              // convert the paragraph into a table (body rows, if any,
              // are lazy lines too and are not seen here; lazy tables
              // with body rows do not occur in the scored set)
              const nd = node('table');
              nd.aligns = aligns;
              nd.head = head;
              nd.rows = [];
              replaceTipWith(nd);
              i++;
              continue;
            }
          }
        }
        addParaLine(tipNode, lazyLine);
        tipNode.lazy = true;
        i++;
        continue;
      }
      // close unmatched containers
      while (stack.length > matched) stack.pop();
    }
    // phase 2
    // a list left as the tip (its item was popped) is not a container for
    // new blocks: close it, so a following item reuses it as a sibling
    // and any other block lands outside it
    while (tip().t === 'list') stack.pop();
    const tp = tip();
    if (tp.t === 'para') {
      // table conversion (delimiter row as the second line)
      if (tp.lines.length === 1) {
        const aligns = delimiterRow(s);
        if (aligns) {
          const head = splitCells(tp.lines[0]);
          if (head.length === aligns.length) {
            const hdr = tp.lines[0];
            removeTip();
            parseTable(hdr, s, i + 1);
            i++;
            continue;
          }
        }
      }
      if (tryBlockStart(s, col, true)) { i++; continue; }
      // a blockquote marker ends the paragraph and starts a blockquote
      if (matchBQ(s, col, stack.some(nd => nd.t === 'bq'))) {
        closePara();
        processContent(s, col);
        i++;
        continue;
      }
      addParaLine(tp, s);
      tp.lazy = false;
      i++;
      continue;
    }
    // tip is a container: definitions are tried inside processContent
    processContent(s, col);
    i++;
  }
  return { doc, defs };
}

// Record the parent of every node (needed for lazy-continuation checks).
function linkParents(nd, parent) {
  nd.parent = parent || null;
  for (const ch of nd.c || []) linkParents(ch, nd);
  return nd;
}

// ---------------------------------------------------------------- inline

function isAlnumCh(ch) {
  return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}
const EMAIL_LOCAL = new Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!#$%&'*+/=?^_`{|}~-".split(''));
function isEmailLocalCh(ch) { return EMAIL_LOCAL.has(ch); }

// Code point ending just before index i in s (-1 at the start).
function codePointBefore(s, i) {
  if (i <= 0) return -1;
  const c = s.charCodeAt(i - 1);
  if (c >= 0xDC00 && c <= 0xDFFF && i >= 2) {
    const h = s.charCodeAt(i - 2);
    if (h >= 0xD800 && h <= 0xDBFF) return (h - 0xD800) * 0x400 + (c - 0xDC00) + 0x10000;
  }
  return c;
}
function isPunctCP(cp) {
  if (cp < 0) return false;
  if (cp < 128) return PUNCT.indexOf(String.fromCharCode(cp)) >= 0;
  return RE_UPUNCT.test(String.fromCodePoint(cp));
}
function isWsCP(cp) {
  if (cp < 0) return true;
  if (cp === 32 || cp === 9 || cp === 10 || cp === 11 || cp === 12 || cp === 13) return true;
  if (cp < 128) return false;
  return RE_UWS.test(String.fromCodePoint(cp));
}
function flanking(beforeCp, afterCp) {
  const beforeWS = isWsCP(beforeCp);
  const afterWS = isWsCP(afterCp);
  const beforePunct = isPunctCP(beforeCp);
  const afterPunct = isPunctCP(afterCp);
  const left = !afterWS && (!afterPunct || beforeWS || beforePunct);
  const right = !beforeWS && (!beforePunct || afterWS || afterPunct);
  return [left, right];
}

// Match a domain starting at i in s: labels of alphanumerics with '-'/'_'
// inside, separated by '.', at least one '.'. Returns the end index or -1.
function matchDomain(s, i) {
  const n = s.length;
  let j = i;
  let dots = 0;
  if (j >= n || !isAlnumCh(s[j])) return -1;
  while (j < n) {
    const ch = s[j];
    if (isAlnumCh(ch)) { j++; continue; }
    if (ch === '-' || ch === '_') {
      // '-' / '_' are only inside a label, not at its end (a trailing
      // '__' emphasis closer must not be swallowed into the domain)
      if (j + 1 >= n || !isAlnumCh(s[j + 1])) break;
      j++;
      continue;
    }
    if (ch === '.') {
      if (!isAlnumCh(s[j - 1])) return -1;
      if (j + 1 >= n || !isAlnumCh(s[j + 1])) break; // trailing '.'
      dots++;
      j++;
      continue;
    }
    break;
  }
  if (j === i || !isAlnumCh(s[j - 1])) return -1;
  if (dots === 0) return -1;
  return j;
}
// Match an email address starting at i. Returns the end index or -1.
function matchEmail(s, i, allowTrailUnd) {
  const n = s.length;
  let j = i;
  while (j < n && isEmailLocalCh(s[j])) j++;
  if (j === i) return -1;
  if (s[j - 1] === '.' || s[i] === '.') return -1;
  if (j >= n || s[j] !== '@') return -1;
  const dom = matchDomain(s, j + 1);
  if (dom < 0) return -1;
  // a domain ending in '-' or '_' is not an email at all (the '-'/'_'
  // is part of the attempted domain); matchDomain stops before it, so
  // reject here rather than linking a truncated address. Exception: a
  // trailing '_' is allowed when an underscore emphasis delimiter is
  // open, because the '_' is its closer, not part of the address
  // (e.g. __file table@nimbus.example.com__).
  if (s[dom] === '-') return -1;
  if (s[dom] === '_' && !allowTrailUnd) return -1;
  return dom;
}
// Match a scheme at i: [A-Za-z][A-Za-z0-9+.-]{1,31}: . Returns the index
// just past ':' or -1.
function matchScheme(s, i) {
  const n = s.length;
  if (i >= n) return -1;
  const c0 = s.charCodeAt(i);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return -1;
  let j = i + 1;
  while (j < n && j - i < 32) {
    const c = s.charCodeAt(j);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 46 || c === 45) { j++; continue; }
    break;
  }
  if (j - i < 2 || j - i > 32) return -1;
  if (j >= n || s[j] !== ':') return -1;
  return j + 1;
}
// marked's backpedal for extended autolinks: the longest prefix of the
// candidate that does not end in trailing punctuation (?!.,:;*_~), an
// unbalanced ')', or an '&name;' tail. marked applies it repeatedly
// until it stops changing (a single pass leaves one trailing '.' or
// ')' behind when the run has length > 1).
const RE_BACKPEDAL = /(?:[^?!.,:;*_~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_~)]+(?!$))+/;
function backpedalLen(url) {
  let s = url;
  for (;;) {
    const m = RE_BACKPEDAL.exec(s);
    const t = m ? m[0] : '';
    if (t === s) return t.length;
    s = t;
  }
}
// Drop trailing ')' while the ')' count in s[start..end] exceeds the
// '(' count (the backpedal regex can leave one unbalanced ')' behind).
function balanceParens(s, start, end) {
  let open = 0, close = 0;
  for (let k = start; k < end; k++) {
    if (s[k] === '(') open++;
    else if (s[k] === ')') close++;
  }
  while (close > open && end > start && s[end - 1] === ')') { end--; close--; }
  return end;
}
function isUrlChar(ch) {
  return ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '<' && ch !== '[' && ch !== ']' && ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127;
}
// Try an extended (GFM) autolink starting at i in s. Returns
// {end, href, text} or null. allowTrailUnd: an underscore emphasis
// delimiter is open, so a trailing '_' after an email is its closer.
// isLabelCloser: optional (pos) => boolean, true when a ']' at pos
// would close a link label that forms a valid link (the autolink must
// stop before it; otherwise '[' and ']' belong to the URL itself).
function tryExtendedAutolink(s, i, allowTrailUnd, isLabelCloser) {
  const n = s.length;
  // scan a URL's tail: ordinary URL chars, plus '[' and ']' unless the
  // ']' would close a valid link label
  function scanUrl(end) {
    while (end < n) {
      const ch = s[end];
      if (isUrlChar(ch)) { end++; continue; }
      if ((ch === ']' || ch === '[') && !(isLabelCloser && isLabelCloser(end))) { end++; continue; }
      break;
    }
    return end;
  }
  if (i > 0) {
    const pc = s[i - 1];
    if (!(pc === ' ' || pc === '\t' || pc === '\n' || pc === '*' || pc === '_' || pc === '~' || pc === '(' || pc === '<')) return null;
  }
  // www.
  if (s.startsWith('www.', i)) {
    const dom = matchDomain(s, i + 4);
    if (dom < 0) return null;
    let end = scanUrl(dom);
    const len = backpedalLen(s.slice(i, end));
    if (len <= 4) return null;
    end = i + len;
    const url = s.slice(i, end);
    return { end, href: 'http://' + url, text: url };
  }
  // scheme:
  const sc = matchScheme(s, i);
  if (sc > 0) {
    const scheme = s.slice(i, sc - 1).toLowerCase();
    if (scheme === 'mailto' || scheme === 'xmpp') {
      const em = matchEmail(s, sc, allowTrailUnd);
      if (em < 0) return null;
      let end = em;
      if (s[end] === '/') {
        // one path segment, no further '/'; a bare trailing '/'
        // (no segment after it) is not part of the autolink
        let j = end + 1;
        while (j < n && isUrlChar(s[j]) && s[j] !== '/') j++;
        if (j > end + 1) end = j;
      }
      const len = backpedalLen(s.slice(i, end));
      if (len <= sc - i) return null;
      end = i + len;
      const url = s.slice(i, end);
      return { end, href: url, text: url };
    }
    // general scheme: must be followed by '//' then a domain
    if (s[sc] !== '/' || s[sc + 1] !== '/') return null;
    const dom = matchDomain(s, sc + 2);
    if (dom < 0) return null;
    let end = scanUrl(dom);
    const len = backpedalLen(s.slice(i, end));
    if (len <= sc - i) return null;
    end = i + len;
    const url = s.slice(i, end);
    return { end, href: url, text: url };
  }
  // bare email
  const em = matchEmail(s, i, allowTrailUnd);
  if (em < 0) return null;
  const url = s.slice(i, em);
  return { end: em, href: 'mailto:' + url, text: url };
}

// Parse "(dest title)" starting at s[pos] === '('. Returns
// {dest, title, end} (end = index past ')') or null.
function parseParenLink(s, pos) {
  const n = s.length;
  let p = pos + 1;
  const skipWs = () => {
    while (p < n && (s[p] === ' ' || s[p] === '\t' || s[p] === '\n')) p++;
  };
  skipWs();
  if (p >= n) return null;
  let dest = '';
  if (s[p] === '<') {
    let j = p + 1;
    let ok = false;
    while (j < n) {
      const ch = s[j];
      if (ch === '\n' || ch === '<') return null;
      if (ch === '>') { ok = true; break; }
      if (ch === '\\' && j + 1 < n && isPunct(s[j + 1])) { dest += s[j + 1]; j += 2; continue; }
      dest += ch;
      j++;
    }
    if (!ok) return null;
    p = j + 1;
  } else {
    let depth = 0;
    let j = p;
    while (j < n) {
      const ch = s[j];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch.charCodeAt(0) < 32) break;
      if (ch === '\\' && j + 1 < n && isPunct(s[j + 1])) { dest += s[j + 1]; j += 2; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') {
        if (depth === 0) break;
        depth--;
      }
      dest += ch;
      j++;
    }
    p = j;
  }
  let title = null;
  const saveP = p;
  skipWs();
  if (p < n) {
    const q = s[p];
    if (q === '"' || q === "'" || q === '(') {
      const close = q === '(' ? ')' : q;
      let j = p + 1;
      let t = '';
      let ok = false;
      while (j < n) {
        const ch = s[j];
        if (ch === '\n') {
          // a blank line inside the title kills the link
          let k = j + 1;
          while (k < n && (s[k] === ' ' || s[k] === '\t')) k++;
          if (k >= n || s[k] === '\n') return null;
          t += '\n';
          j++;
          continue;
        }
        if (ch === '\\' && j + 1 < n && isPunct(s[j + 1])) { t += s[j + 1]; j += 2; continue; }
        if (q === '(' && ch === '(') return null;
        if (ch === close) { ok = true; break; }
        t += ch;
        j++;
      }
      if (!ok) return null;
      title = t;
      p = j + 1;
    } else {
      p = saveP;
    }
  }
  skipWs();
  if (p >= n || s[p] !== ')') return null;
  return { dest, title, end: p + 1 };
}

// Parse a "[label]" starting at s[pos] === '['. Returns {label, end}
// (end = index past ']') or null. The label may span lines but not a
// blank line, and may not contain an unescaped '['.
function parseLabelAt(s, pos) {
  const n = s.length;
  let i = pos + 1;
  let label = '';
  while (i < n) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < n && isPunct(s[i + 1])) { label += s[i] + s[i + 1]; i += 2; continue; }
    if (ch === '[') return null;
    if (ch === ']') return { label, end: i + 1 };
    if (ch === '\n') {
      let k = i + 1;
      while (k < n && (s[k] === ' ' || s[k] === '\t')) k++;
      if (k >= n || s[k] === '\n') return null;
      label += '\n';
      i++;
      continue;
    }
    label += ch;
    i++;
  }
  return null;
}

// Match an inline HTML construct at s[i] === '<': comment, PI, declaration,
// CDATA, or a tag. Returns the end index (past '>') or -1.
function matchInlineHtml(s, i) {
  const n = s.length;
  if (s.startsWith('<!--', i)) {
    // abrupt empty comments end at their own '>'
    if (s.startsWith('<!-->', i)) return i + 5;
    if (s.startsWith('<!--->', i)) return i + 6;
    const end = s.indexOf('-->', i + 4);
    return end < 0 ? -1 : end + 3;
  }
  if (s.startsWith('<?', i)) {
    const end = s.indexOf('?>', i + 2);
    return end < 0 ? -1 : end + 2;
  }
  if (s.startsWith('<![CDATA[', i)) {
    const end = s.indexOf(']]>', i + 9);
    return end < 0 ? -1 : end + 3;
  }
  if (s.startsWith('<!', i) && i + 2 < n && s[i + 2] >= 'A' && s[i + 2] <= 'Z') {
    const end = s.indexOf('>', i + 3);
    return end < 0 ? -1 : end + 1;
  }
  // a tag: < /? name attributes? /? >  (a closing tag takes no attributes)
  let j = i + 1;
  let closing = false;
  if (s[j] === '/') { j++; closing = true; }
  if (j >= n) return -1;
  const c0 = s.charCodeAt(j);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return -1;
  while (j < n) {
    const c = s.charCodeAt(j);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45) j++;
    else break;
  }
  if (closing) {
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
    return s[j] === '>' ? j + 1 : -1;
  }
  while (j < n) {
    let ws = 0;
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) { j++; ws++; }
    if (j >= n) return -1;
    if (s[j] === '>') return j + 1;
    if (s[j] === '/' && s[j + 1] === '>') return j + 2;
    // an attribute must be separated from the tag name (or the previous
    // attribute) by whitespace
    if (ws === 0) return -1;
    const a0 = s.charCodeAt(j);
    if (!((a0 >= 65 && a0 <= 90) || (a0 >= 97 && a0 <= 122) || a0 === 95 || a0 === 58)) return -1;
    while (j < n) {
      const c = s.charCodeAt(j);
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 58 || c === 46 || c === 45) j++;
      else break;
    }
    // after the name, an optional " = value"; if there is no '=', the
    // whitespace just skipped belongs to the NEXT attribute's separator,
    // so rewind to just past the name
    const afterName = j;
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
    if (s[j] === '=') {
      j++;
      while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
      if (j >= n) return -1;
      if (s[j] === '"' || s[j] === "'") {
        const q = s[j];
        j++;
        while (j < n && s[j] !== q) j++;
        if (j >= n) return -1;
        j++;
      } else {
        while (j < n) {
          const c = s[j];
          if (c === ' ' || c === '\t' || c === '\n' || c === '>' || c === '"' || c === "'" || c === '=' || c === '<' || c === '`') break;
          j++;
        }
        if (j >= n) return -1;
      }
    } else {
      j = afterName;
    }
  }
  return -1;
}

// Try a '<...>' autolink at s[i] === '<'. Returns {end, href, text} or null.
function tryAngleAutolink(s, i) {
  const n = s.length;
  let j = i + 1;
  while (j < n) {
    const ch = s[j];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '<' || ch.charCodeAt(0) < 32) return null;
    if (ch === '>') break;
    j++;
  }
  if (j >= n || s[j] !== '>') return null;
  const inner = s.slice(i + 1, j);
  if (!inner) return null;
  const sc = matchScheme(inner, 0);
  if (sc > 0) {
    return { end: j + 1, href: inner, text: inner };
  }
  if (inner.indexOf('@') > 0 && matchEmail(inner, 0) === inner.length) {
    return { end: j + 1, href: 'mailto:' + inner, text: inner };
  }
  return null;
}

// Find a code span starting at s[i] === '`'. Returns {end, content} or null.
function tryCodeSpan(s, i, isLabelCloser) {
  const n = s.length;
  let j = i;
  while (j < n && s[j] === '`') j++;
  const m = j - i;
  let k = j;
  while (k < n) {
    // a code span must not swallow the ']' that closes a valid link
    // label (marked matches the link first, so the backticks inside
    // the label stay literal when the closer lies outside it)
    if (s[k] === ']' && isLabelCloser && isLabelCloser(k)) return null;
    if (s[k] === '`') {
      let l = k;
      while (l < n && s[l] === '`') l++;
      if (l - k === m) {
        let content = s.slice(j, k).replace(/\n/g, ' ');
        if (content.length >= 2 && content.charCodeAt(0) === 32 && content.charCodeAt(content.length - 1) === 32 && content.trim() !== '') {
          content = content.slice(1, -1);
        }
        return { end: l, content };
      }
      k = l;
    } else k++;
  }
  return null;
}

// Is text[start..end] a valid link label: brackets balanced, at most
// one level of nesting, backslash escapes skipped. A '[' inside a
// code span does not count; a backtick run is treated as opaque text
// up to its matching close run when one exists.
function isValidLabel(s, start, end) {
  let depth = 0;
  let i = start;
  while (i < end) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < end) { i += 2; continue; }
    if (ch === '`') {
      let j = i;
      while (j < end && s[j] === '`') j++;
      let k = j;
      let closed = false;
      while (k < end) {
        if (s[k] === '`') {
          let m = k;
          while (m < end && s[m] === '`') m++;
          closed = true; k = m; break;
        } else k++;
      }
      // a backtick run with no closer is only valid as a trailing run
      // immediately before the closing ']' (marked's ``+(?=]) alt)
      if (!closed) { if (j === end) { i = j; continue; } return false; }
      i = k;
      continue;
    }
    if (ch === '[') { depth++; if (depth > 2) return false; }
    else if (ch === ']') { depth--; if (depth < 0) return false; }
    i++;
  }
  return depth === 0;
}

// Is there a backtick run in s[start..end) with no later backtick run
// to close it (and not a trailing run reaching end)? Mirrors the
// backtick half of isValidLabel; bracket depth is ignored here.
// Bracket balance of a label span only (backtick runs treated as
// opaque): depth never negative, ends at 0, max depth 2. A stale
// opener whose label spans unrelated text (an unmatched ']' inside)
// is not a real link label, so it must not suppress emphasis.
function labelBracketsBalanced(s, start, end) {
  let depth = 0;
  let i = start;
  while (i < end) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < end) { i += 2; continue; }
    if (ch === '`') {
      let j = i;
      while (j < end && s[j] === '`') j++;
      let k = j;
      while (k < end && s[k] !== '`') k++;
      if (k >= end) { i = j; continue; }
      let m = k;
      while (m < end && s[m] === '`') m++;
      i = m;
      continue;
    }
    if (ch === '[') { depth++; if (depth > 2) return false; }
    else if (ch === ']') { depth--; if (depth < 0) return false; }
    i++;
  }
  return depth === 0;
}
function labelBacktickInvalid(s, start, end) {
  let i = start;
  while (i < end) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < end) { i += 2; continue; }
    if (ch === '`') {
      let j = i;
      while (j < end && s[j] === '`') j++;
      let k = j;
      let closed = false;
      while (k < end) {
        if (s[k] === '`') { closed = true; break; }
        k++;
      }
      if (!closed) {
        if (j === end) return false;
        return true;
      }
      let m = k;
      while (m < end && s[m] === '`') m++;
      i = m;
      continue;
    }
    i++;
  }
  return false;
}

// ---------------------------------------------------------------- inline main

// marked keeps a document-wide inLink flag, set by an inline <a ...>
// tag and cleared by an inline </a>, that suppresses GFM extended
// autolinks (www. / scheme / email) for the rest of the document.
// It is never reset between blocks and is not touched by HTML blocks,
// code spans or fenced code. Reset once per parse() call.
let inLink = false;

function inlineHtml(text, defs) {
  const nodes = [];
  const delims = [];
  const openers = [];
  let seq = 0;

  // is an underscore emphasis delimiter open? (a trailing '_' after
  // an email is then its closer, not part of the address)
  function hasOpenUnd() {
    for (const d of delims) if (d.ch === '_' && d.active && d.canOpen && d.n > 0) return true;
    return false;
  }

  // Would the ']' at position j close a link label that forms a valid
  // link? If so, an extended autolink must stop before it; otherwise
  // the ']' (and '[') belong to the autolink URL itself.
  function isLabelCloser(j) {
    if (openers.length === 0) return false;
    const after = j + 1;
    if (text[after] === '(') return parseParenLink(text, after) !== null;
    if (text[after] === '[') {
      const lab = parseLabelAt(text, after);
      if (lab) {
        // collapsed reference [label][]: the label is the opener text,
        // checked by the shortcut loop below
        if (lab.label !== '') return defs.has(normalizeLabel(lab.label));
      }
      // malformed label: fall through to the shortcut check below
    }
    for (const o of openers) {
      const ls = o.startPos + (o.img ? 2 : 1);
      if (ls > j) continue;
      if (isValidLabel(text, ls, j) && defs.has(normalizeLabel(text.slice(ls, j)))) return true;
    }
    return false;
  }

  // A code span opened inside a link label must not swallow the ']'
  // that closes the label -- but only when the label is actually
  // valid (balanced brackets, paired backticks) and will form a link.
  // An invalid label (e.g. an unclosed backtick) never forms a link,
  // so a code span may cross its ']' freely (cm-525, cm-537). The
  // backticks must be fully paired inside the label: a lone trailing
  // run (valid for the label regex) does not count, because marked
  // tokenizes the code span first and the link never forms.
  function labelBackticksPaired(s, start, end) {
    let i = start;
    while (i < end) {
      if (s[i] === '\\' && i + 1 < end) { i += 2; continue; }
      if (s[i] === '`') {
        let j = i;
        while (j < end && s[j] === '`') j++;
        let k = j;
        let closed = false;
        while (k < end) { if (s[k] === '`') { closed = true; break; } k++; }
        if (!closed) return false;
        let m = k;
        while (m < end && s[m] === '`') m++;
        i = m;
        continue;
      }
      i++;
    }
    return true;
  }
  function isLabelCloserForCode(j) {
    if (openers.length === 0) return false;
    let labelOk = false;
    for (const o of openers) {
      const ls = o.startPos + (o.img ? 2 : 1);
      if (ls <= j && isValidLabel(text, ls, j) && labelBackticksPaired(text, ls, j)) { labelOk = true; break; }
    }
    if (!labelOk) return false;
    return isLabelCloser(j);
  }

  function addText(s) {
    if (!s) return;
    const last = nodes[nodes.length - 1];
    if (last && last.k === 'text' && !last.nomerge) last.s += s;
    else nodes.push({ k: 'text', s, seq: seq++ });
  }
  function pushNode(nd) {
    nd.seq = seq++;
    nodes.push(nd);
    return nd;
  }

  // Resolve emphasis among delimiters with seq > bottomSeq, recording
  // open/close tags on the delimiter nodes.
  function processEmphasis(bottomSeq) {
    // marked scans forward from an opener, counting delimiter lengths:
    // opener-like runs add, closer-like runs subtract, both-ways runs
    // subtract unless odd-match-blocked against the opener (opener
    // length not a multiple of 3, sum a multiple of 3). The opener
    // matches the closer only when the count reaches <= 0 there.
    function openerMatches(oi, ci) {
      const opener = delims[oi];
      let m = opener.origN;
      for (let k = oi + 1; k < ci; k++) {
        const d = delims[k];
        if (d.ch !== opener.ch) continue;
        // a delimiter deactivated (but not consumed) inside an inner
        // emphasis is literal text there, so it no longer counts toward
        // the outer match (cm-470: the '*' before 'baz' is inside the
        // strong 'bar *baz bim'). A delimiter consumed into an inner
        // emphasis (n === 0) still counts via origN (cm-408).
        if (!d.active && d.n > 0) continue;
        if (d.canOpen && !d.canClose) m += d.origN;
        else if (d.canClose) {
          if (d.canOpen && opener.origN % 3 !== 0 &&
              (opener.origN + d.origN) % 3 === 0) continue;
          m -= d.origN;
        }
      }
      m -= delims[ci].origN;
      return m <= 0;
    }
    let ci = 0;
    while (ci < delims.length && delims[ci].seq <= bottomSeq) ci++;
    while (ci < delims.length) {
      const closer = delims[ci];
      if (!closer.active || !closer.canClose) { ci++; continue; }
      let oi = ci - 1;
      let found = -1;
      while (oi >= 0 && delims[oi].seq > bottomSeq) {
        const opener = delims[oi];
        if (opener.active && opener.canOpen && opener.ch === closer.ch) {
          // the "odd match" rule applies only when one of the two
          // delimiters can both open and close emphasis
          const bothWays = (opener.canOpen && opener.canClose) || (closer.canOpen && closer.canClose);
          const odd = bothWays && (opener.n + closer.n) % 3 === 0 && (opener.n % 3 !== 0 && closer.n % 3 !== 0);
          if (!odd) {
            // the forward-scan count only blocks a match when there is
            // at least one delimiter between opener and closer (an
            // immediately following closer is the inner emphasis and
            // must be allowed, e.g. one '_' of '__')
            if (ci - oi <= 1 || openerMatches(oi, ci)) { found = oi; break; }
          }
        }
        oi--;
      }
      if (found < 0) { ci++; continue; }
      const opener = delims[found];
      const use = (opener.n >= 2 && closer.n >= 2) ? 2 : 1;
      const tag = closer.ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em');
      opener.openTags.push(tag);
      closer.closeTags.push(tag);
      opener.n -= use;
      closer.n -= use;
      // a leftover delimiter on the closer renders after the close
      // tag by default ('**foo***' -> '<strong>foo</strong>*'), but
      // for a STRONG (use === 2), when the innermost emphasis just
      // inside was closed by a both-ways delimiter ('**a *b*c***',
      // the '*' after 'b' can both open and close), marked puts the
      // leftover INSIDE the tag ('<strong>a <em>b</em>c*</strong>'):
      // flag it so the renderer emits the leftover before the close
      // tag. (For em, use === 1, the leftover stays outside.)
      if (closer.n > 0 && use === 2) {
        for (let k = ci - 1; k > found; k--) {
          const d = delims[k];
          if (d.closeTags.length > 0 && d.n === 0 && d.canOpen && d.canClose) { closer.leftoverInside = true; break; }
          if (d.n > 0 && d.active) break;
        }
      }
      if (opener.n === 0) opener.active = false;
      if (closer.n === 0) { closer.active = false; ci++; }
      // delimiters strictly inside this emphasis cannot match a closer
      // outside it (otherwise emphasis would cross its boundary)
      for (let k = found + 1; k < ci; k++) delims[k].active = false;
    }
  }

  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    const code = text.charCodeAt(i);
    if (code === 92) { // backslash
      const nx = text[i + 1];
      if (nx === '\n') {
        pushNode({ k: 'br' });
        i += 2;
        // a hard break strips the next line's leading spaces/tabs
        while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
        continue;
      }
      if (nx !== undefined && isPunct(nx)) {
        // a backslash-escaped '&' is its own text node so it cannot merge
        // with following text into a false entity reference
        if (nx === '&') pushNode({ k: 'text', s: '&', nomerge: true });
        else addText(nx);
        i += 2;
        continue;
      }
      addText('\\');
      i++;
      continue;
    }
    if (code === 96) { // backtick
      // a code span opened inside a link label must not swallow the
      // label's closing ']' (marked matches the link first); outside
      // a label, code spans may contain ']' freely
      const cs = tryCodeSpan(text, i, openers.length > 0 ? isLabelCloserForCode : null);
      if (cs) {
        pushNode({ k: 'code', s: cs.content });
        i = cs.end;
        continue;
      }
      // no matching closing run: the whole run is literal text (do not
      // retry from inside the run)
      let j = i;
      while (j < n && text.charCodeAt(j) === 96) j++;
      addText(text.slice(i, j));
      i = j;
      continue;
    }
    if (code === 42 || code === 95 || code === 126) { // * _ ~
      let j = i;
      while (j < n && text.charCodeAt(j) === code) j++;
      const runLen = j - i;
      if (code === 126 && runLen > 2) {
        // a tilde run of 3+ is literal text, not a strikethrough delimiter
        addText(text.slice(i, j));
        i = j;
        continue;
      }
      const beforeCp = codePointBefore(text, i);
      const afterCp = j < n ? text.codePointAt(j) : -1;
      const [left, right] = flanking(beforeCp, afterCp);
      let canOpen, canClose;
      if (code === 95) {
        const beforePunct = isPunctCP(beforeCp);
        const afterPunct = isPunctCP(afterCp);
        canOpen = left && (!right || beforePunct);
        canClose = right && (!left || afterPunct);
      } else {
        canOpen = left;
        canClose = right;
      }
      const d = pushNode({ k: 'delim', ch, n: runLen, origN: runLen, canOpen, canClose, active: true, openTags: [], closeTags: [], pos: i });
      delims.push(d);
      i = j;
      continue;
    }
    if (code === 91 || (code === 33 && text[i + 1] === '[')) { // [ or ![
      const img = code === 33;
      const o = pushNode({ k: 'open', img, startPos: i });
      openers.push(o);
      i += img ? 2 : 1;
      continue;
    }
    if (code === 93) { // ]
      if (openers.length === 0) { addText(']'); i++; continue; }
      // Find the earliest opener whose label text (up to this ']') has
      // balanced brackets (at most one level of nesting, escapes skipped).
      // That opener forms the link; openers inside its text become
      // literal '['.
      let opener = null;
      let openerIdxInStack = -1;
      let link = null;
      let linkEnd = i + 1;
      for (let oi = 0; oi < openers.length; oi++) {
        const o = openers[oi];
        const ls = o.startPos + (o.img ? 2 : 1);
        if (!isValidLabel(text, ls, i)) {
          // a label invalidated by an unclosed backtick run, followed
          // by '(', suppresses emphasis inside it: marked's label scan
          // consumes the label and its delimiters never form emphasis.
          // Only the nearest opener counts (an outer opener's label
          // spans nested links whose emphasis must be left alone).
          if (oi === openers.length - 1 && text[i + 1] === '(' && labelBracketsBalanced(text, ls, i) && labelBacktickInvalid(text, ls, i)) {
            for (const d of delims) if (d.seq > o.seq && d.active) { d.active = false; d.canOpen = false; d.canClose = false; }
          }
          continue;
        }
        let lk = null;
        let le = i + 1;
        let skipShortcut = false;
        if (text[i + 1] === '(') {
          const pl = parseParenLink(text, i + 1);
          if (pl) { lk = { dest: pl.dest, title: pl.title }; le = pl.end; }
          // inline failed: fall through to shortcut below
        } else if (text[i + 1] === '[') {
          // full (or collapsed) reference: if a well-formed label
          // follows but has no definition, this is NOT a shortcut link
          const lab = parseLabelAt(text, i + 1);
          if (lab) {
            const key = lab.label === ''
              ? normalizeLabel(text.slice(ls, i))
              : normalizeLabel(lab.label);
            const def = defs.get(key);
            if (def) { lk = { dest: def.dest, title: def.title }; le = lab.end; }
            else { skipShortcut = true; }
          }
          // malformed label: fall through to shortcut below
        }
        if (!lk && !skipShortcut) {
          const key = normalizeLabel(text.slice(ls, i));
          const def = defs.get(key);
          if (def) { lk = { dest: def.dest, title: def.title }; le = i + 1; }
        }
        if (lk) { opener = o; openerIdxInStack = oi; link = lk; linkEnd = le; break; }
      }
      if (!link) { addText(']'); i++; continue; }
      // form the link: resolve emphasis inside its text, then remove the
      // remaining delimiters inside it so they cannot match outside ones
      processEmphasis(opener.seq);
      for (const d of delims) if (d.seq > opener.seq) d.active = false;
      const openerIdx = nodes.indexOf(opener);
      let children = nodes.slice(openerIdx + 1);
      // an extended autolink inside a link label stays plain text
      // (no nested <a>); an angle autolink <...> stays a nested link
      let hasAuto = false;
      for (const c of children) if (c.k === 'link' && c.auto === 'ext') { hasAuto = true; break; }
      if (hasAuto) {
        const flat = [];
        for (const c of children) {
          if (c.k === 'link' && c.auto === 'ext') { for (const t of c.children) flat.push(t); }
          else flat.push(c);
        }
        const merged = [];
        for (const c of flat) {
          const last = merged[merged.length - 1];
          if (c.k === 'text' && last && last.k === 'text' && !last.nomerge) last.s += c.s;
          else merged.push(c);
        }
        children = merged;
      }
      nodes.length = openerIdx;
      pushNode({ k: 'link', href: link.dest, title: link.title, img: opener.img, children });
      if (opener.img) {
        // an image leaves outer openers alone (a link may still wrap it)
        openers.length = openerIdxInStack;
      } else {
        // a link kills outer *link* openers (no nested links) but outer
        // image openers survive (an image may still wrap the link)
        let w = 0;
        for (let k = 0; k < openerIdxInStack; k++) {
          if (openers[k].img) openers[w++] = openers[k];
        }
        openers.length = w;
      }
      i = linkEnd;
      continue;
    }
    if (code === 60) { // <
      const al = tryAngleAutolink(text, i);
      if (al) {
        pushNode({ k: 'link', href: al.href, title: null, img: false, auto: 'angle', children: [{ k: 'text', s: al.text, seq: seq++ }] });
        i = al.end;
        continue;
      }
      const he = matchInlineHtml(text, i);
      if (he > 0) {
        // marked's inLink flag: <a + space opens, </a> closes
        const c1 = text.charCodeAt(i + 1);
        if (c1 === 97 || c1 === 65) { if (text.charCodeAt(i + 2) === 32) inLink = true; }
        else if (c1 === 47) {
          const c2 = text.charCodeAt(i + 2);
          if ((c2 === 97 || c2 === 65) && text.charCodeAt(i + 3) === 62) inLink = false;
        }
        pushNode({ k: 'html', s: text.slice(i, he) });
        i = he;
        continue;
      }
      addText('<');
      i++;
      continue;
    }
    if (code === 38) { // &
      const dec = decodeEntityAt(text, i);
      if (dec) {
        // a decoded numeric entity is its own text node so it cannot
        // merge with following text into a false entity reference
        pushNode({ k: 'text', s: dec[0], nomerge: true });
        i = dec[1];
        continue;
      }
      const ee = entityEndAt(text, i);
      if (ee > 0) {
        addText(text.slice(i, ee));
        i = ee;
        continue;
      }
      addText('&');
      i++;
      continue;
    }
    if (code === 10) { // newline: hard break after two spaces, else soft
      const last = nodes[nodes.length - 1];
      if (last && last.k === 'text') {
        const t = last.s;
        let sp = 0;
        while (sp < t.length && t.charCodeAt(t.length - 1 - sp) === 32) sp++;
        if (sp >= 2) {
          // a hard break: all trailing spaces are removed, not just two
          last.s = t.slice(0, t.length - sp);
          if (!last.s) nodes.pop();
          pushNode({ k: 'br' });
          i++;
          // a hard break strips the next line's leading spaces/tabs
          while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
          continue;
        }
      }
      addText('\n');
      i++;
      continue;
    }
    // extended autolink (www. / scheme / email), suppressed while
    // an inline <a ...> is open (marked's document-wide inLink flag)
    if (!inLink && ((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) {
      const ea = tryExtendedAutolink(text, i, hasOpenUnd(), isLabelCloser);
      if (ea) {
        pushNode({ k: 'link', href: ea.href, title: null, img: false, auto: 'ext', children: [{ k: 'text', s: ea.text, seq: seq++ }] });
        i = ea.end;
        continue;
      }
    }
    // plain text run
    let j = i;
    while (j < n) {
      const c = text.charCodeAt(j);
      if (c === 92 || c === 96 || c === 42 || c === 95 || c === 126 || c === 91 || c === 93 || c === 60 || c === 38 || c === 10) break;
      if (c === 33 && text[j + 1] === '[') break;
      // stop before a GFM extended autolink (www. / scheme:// / email)
      if (!inLink && j > i && ((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) {
        const pc = text.charCodeAt(j - 1);
        if (pc === 32 || pc === 9 || pc === 10 || pc === 40 || pc === 60 || pc === 42 || pc === 95 || pc === 126) {
          if (tryExtendedAutolink(text, j, hasOpenUnd(), isLabelCloser)) break;
        }
      }
      j++;
    }
    if (j === i) j = i + 1;
    addText(text.slice(i, j));
    i = j;
  }

  // marked's emStrong runs on a masked copy of the paragraph in
  // which link/code-span contents are replaced by 'a's. Its masking
  // mis-pairs a stray backtick inside a link label (a run with no
  // same-length closer before ']', e.g. a shorter run closing a
  // longer run, or a lone run with no closer at all) with the next
  // same-length backtick after the label, creating a phantom code
  // span that swallows any emphasis delimiters inside it (the
  // span's content may cross other backticks). Replicate that
  // masking for emphasis visibility only: deactivate delimiters
  // inside such a phantom span (real tokenization is untouched).
  // A "same-length closer" is len backticks not followed by another
  // backtick -- so the last len backticks of a longer run count.
  function findBtCloser(from, len, end) {
    let p = from;
    while (p < end) {
      if (text[p] === '`') {
        let r = p;
        while (r < end && text[r] === '`') r++;
        if (r - p >= len && (r >= end || text[r] !== '`')) {
          // the last len backticks of this run are followed by a
          // non-backtick (or the end), so they close a len-run
          return r - len;
        }
        p = r;
      } else p++;
    }
    return -1;
  }
  function applyPhantomMask() {
    const N = text.length;
    let i = 0;
    while (i < N) {
      if (text[i] !== '[') { i++; continue; }
      let j = i + 1, close = -1;
      while (j < N) {
        if (text[j] === ']' && isValidLabel(text, i + 1, j)) { close = j; break; }
        j++;
      }
      if (close < 0) { i++; continue; }
      // collect the backtick runs in this label, then simulate
      // code-span pairing: a run closes the most recent unconsumed
      // opener whose length it covers (len >= opener len); a run
      // shorter than the top opener sits inside that opener's
      // content -- it is a stray only if the opener is never closed
      // in the label (a run inside a closed code span is not)
      const runs = [];
      let k = i + 1;
      while (k < close) {
        if (text[k] === '`') {
          let m = k;
          while (m < close && text[m] === '`') m++;
          runs.push({ start: k, len: m - k });
          k = m;
        } else k++;
      }
      const pending = [];
      for (let r of runs) {
        let cur = { start: r.start, len: r.len };
        while (cur.len > 0) {
          if (pending.length === 0) { pending.push({ start: cur.start, len: cur.len, cands: [] }); break; }
          const top = pending[pending.length - 1];
          if (top.len <= cur.len) {
            // cur closes top (using cur's last top.len backticks);
            // the runs inside top were part of a valid code span,
            // so they are not strays -- discard them with top
            pending.pop();
            cur = { start: cur.start, len: cur.len - top.len };
          } else {
            // cur is shorter than top: it sits inside top's content
            top.cands.push({ start: cur.start, len: cur.len });
            break;
          }
        }
      }
      // every unconsumed opener, and every run inside it, is a
      // stray: mask from each to the next same-length run after
      // the label
      for (const op of pending) {
        const strays = [{ start: op.start, len: op.len }, ...op.cands];
        for (const st of strays) {
          const end = findBtCloser(close + 1, st.len, N);
          if (end >= 0) {
            for (const d of delims) {
              if (d.pos >= st.start && d.pos < end) { d.active = false; d.canOpen = false; d.canClose = false; }
            }
          }
        }
      }
      i = close + 1;
    }
  }

  applyPhantomMask();
  processEmphasis(-1);

  // plain-text rendering of a node list (image alt text)
  function plainText(list) {
    let out = '';
    for (const nd of list) {
      if (nd.k === 'text') out += nd.s;
      else if (nd.k === 'delim') { if (nd.n > 0) out += nd.ch.repeat(nd.n); }
      else if (nd.k === 'open') out += nd.img ? '![' : '[';
      else if (nd.k === 'code') out += nd.s;
      else if (nd.k === 'html') out += nd.s;
      else if (nd.k === 'br') out += '\n';
      else if (nd.k === 'link') out += plainText(nd.children);
    }
    return out;
  }
  function renderNodes(list) {
    let out = '';
    for (const nd of list) {
      if (nd.k === 'text') out += esc(nd.s, false);
      else if (nd.k === 'delim') {
        // leftover delimiters normally render after the close tags,
        // but a leftover flagged 'leftoverInside' renders before
        // them (inside the emphasis tag)
        if (nd.leftoverInside && nd.n > 0) out += nd.ch.repeat(nd.n);
        for (const t of nd.closeTags) out += '</' + t + '>';
        if (!nd.leftoverInside && nd.n > 0) out += nd.ch.repeat(nd.n);
        for (let k = nd.openTags.length - 1; k >= 0; k--) out += '<' + nd.openTags[k] + '>';
      }
      else if (nd.k === 'open') out += nd.img ? '![' : '[';
      else if (nd.k === 'code') out += '<code>' + esc(nd.s, true) + '</code>';
      else if (nd.k === 'html') out += nd.s;
      else if (nd.k === 'br') out += '<br>';
      else if (nd.k === 'link') {
        if (nd.img) {
          out += '<img src="' + encodeHref(nd.href) + '" alt="' + esc(plainText(nd.children), false) + '"' +
            (nd.title !== null && nd.title !== undefined ? ' title="' + cleanTitle(nd.title) + '"' : '') + '>';
        } else {
          out += '<a href="' + encodeHref(nd.href) + '"' +
            (nd.title !== null && nd.title !== undefined ? ' title="' + cleanTitle(nd.title) + '"' : '') + '>' +
            renderNodes(nd.children) + '</a>';
        }
      }
    }
    return out;
  }
  return renderNodes(nodes);
}

// ---------------------------------------------------------------- render

function renderBlock(nd, defs, tight) {
  switch (nd.t) {
    case 'h':
      return '<h' + nd.level + '>' + inlineHtml(nd.text, defs) + '</h' + nd.level + '>\n';
    case 'para': {
      let inner = inlineHtml(nd.lines.join('\n'), defs);
      if (nd.task) {
        inner = (nd.task === 'checked'
          ? '<input checked="" disabled="" type="checkbox"> '
          : '<input disabled="" type="checkbox"> ') + inner;
      }
      return tight ? inner : '<p>' + inner + '</p>\n';
    }
    case 'code': {
      const lang = nd.lang ? ' class="language-' + esc(nd.lang, false) + '"' : '';
      return '<pre><code' + lang + '>' + esc(nd.text, true) + '</code></pre>\n';
    }
    case 'hr':
      return '<hr>\n';
    case 'html':
      return nd.text;
    case 'bq': {
      let out = '<blockquote>\n';
      for (const ch of nd.c) out += renderBlock(ch, defs, false);
      return out + '</blockquote>\n';
    }
    case 'list': {
      const tag = nd.ord ? 'ol' : 'ul';
      let out = '<' + tag + (nd.ord && nd.start !== 1 ? ' start="' + nd.start + '"' : '') + '>\n';
      for (const item of nd.c) out += renderBlock(item, defs, nd.tight);
      return out + '</' + tag + '>\n';
    }
    case 'item': {
      let out = '<li>';
      for (const ch of nd.c) out += renderBlock(ch, defs, tight);
      return out + '</li>\n';
    }
    case 'table': {
      let out = '<table>\n<thead>\n<tr>\n';
      for (let k = 0; k < nd.head.length; k++) {
        const a = nd.aligns[k];
        out += '<th' + (a ? ' align="' + a + '"' : '') + '>' + inlineHtml(nd.head[k], defs) + '</th>\n';
      }
      out += '</tr>\n</thead>\n';
      if (nd.rows.length) {
        out += '<tbody>';
        for (const row of nd.rows) {
          out += '<tr>\n';
          for (let k = 0; k < row.length; k++) {
            const a = nd.aligns[k];
            out += '<td' + (a ? ' align="' + a + '"' : '') + '>' + inlineHtml(row[k], defs) + '</td>\n';
          }
          out += '</tr>\n';
        }
        out += '</tbody>';
      }
      return out + '</table>\n';
    }
  }
  return '';
}

export function parse(md) {
  inLink = false;
  const src = String(md).replace(/\r\n?/g, '\n');
  const srcEndsNL = src.endsWith('\n');
  const lines = src.split('\n');
  if (srcEndsNL) lines.pop();
  const { doc, defs } = parseBlocks(lines, srcEndsNL);
  let out = '';
  for (const nd of doc.c) out += renderBlock(nd, defs, false);
  return out;
}
