// Search engine: query parsing, fzf-style fuzzy scoring with highlight positions, ranking.
// Pure module — no browser APIs — so it can be unit-tested in Node.

const SCORE_MATCH = 16;
const GAP_START = -3;
const GAP_EXTEND = -1;
const BONUS_BOUNDARY = 9;
const BONUS_CAMEL = 7;
const BONUS_FIRST_CHAR = 10;
const BONUS_CONSECUTIVE = 6;
const MAX_TEXT = 300;
const NEG_INF = -1e9;

const SEPARATORS = new Set([" ", "/", "\\", "-", "_", ".", ":", "?", "=", "&", "#", "(", ")", "[", "]", "|", ",", "@", "+", "~", "—", "–", "·"]);

/** Fold a string char-by-char (accents removed, optional lowercase) while keeping indices aligned. */
export function fold(str, lower) {
  let s = lower ? str.toLowerCase() : str;
  // toLowerCase can change length for a few exotic chars; fall back to per-char lowering then
  if (s.length !== str.length) s = Array.from(str, (c) => (lower ? (c.toLowerCase().length === 1 ? c.toLowerCase() : c) : c)).join("");
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7f]/.test(s)) return s;
  let out = "";
  for (const c of s) {
    const code = c.codePointAt(0);
    // only strip accents from Latin letters (À-ɏ, Ḁ-ỿ); other scripts are kept verbatim
    const latin = (code >= 0xc0 && code <= 0x24f) || (code >= 0x1e00 && code <= 0x1eff);
    out += latin ? c.normalize("NFD")[0] : c;
  }
  return out;
}

function isUpper(c) { return c !== c.toLowerCase() && c === c.toUpperCase(); }
function isLower(c) { return c !== c.toUpperCase() && c === c.toLowerCase(); }
function isDigit(c) { return c >= "0" && c <= "9"; }

function charBonus(original, j) {
  if (j === 0) return BONUS_FIRST_CHAR;
  const prev = original[j - 1];
  const cur = original[j];
  if (SEPARATORS.has(prev)) return BONUS_BOUNDARY;
  if (isLower(prev) && isUpper(cur)) return BONUS_CAMEL;
  if (!isDigit(prev) && isDigit(cur)) return BONUS_CAMEL;
  return 0;
}

/**
 * Optimal fuzzy alignment of `pattern` inside `text` (both already folded),
 * using `original` for word-boundary detection. Returns {score, positions} or null.
 */
export function fuzzyMatch(pattern, text, original = text) {
  const m = pattern.length;
  if (m === 0) return { score: 0, positions: [] };
  if (text.length > MAX_TEXT) { text = text.slice(0, MAX_TEXT); original = original.slice(0, MAX_TEXT); }
  const n = text.length;
  if (m > n) return null;

  // Fast reject + find the window [first, last] where a match is possible.
  let pi = 0, first = -1;
  for (let j = 0; j < n && pi < m; j++) {
    if (text[j] === pattern[pi]) { if (pi === 0) first = j; pi++; }
  }
  if (pi < m) return null;
  let last = n - 1;
  for (let j = n - 1, qi = m - 1; j >= 0; j--) {
    if (text[j] === pattern[qi]) { if (qi === m - 1) last = j; if (--qi < 0) break; }
  }

  const bonus = new Int16Array(n);
  for (let j = first; j <= last; j++) bonus[j] = charBonus(original, j);

  // M[i*n + j]: best score with pattern[i] matched at text[j]; B: back-pointer to previous j.
  const M = new Float64Array(m * n).fill(NEG_INF);
  const B = new Int32Array(m * n).fill(-1);
  const RUNB = new Int16Array(m * n); // bonus of the char that started the consecutive run ending here

  for (let j = first; j <= last; j++) {
    if (text[j] === pattern[0]) {
      // mild penalty for starting deep into the string
      M[j] = SCORE_MATCH + bonus[j] * 2 - Math.min(j, 20) * 0.25;
      RUNB[j] = bonus[j];
    }
  }

  for (let i = 1; i < m; i++) {
    const row = i * n, prevRow = (i - 1) * n;
    let gapBest = NEG_INF, gapArg = -1;
    for (let j = first + i; j <= last; j++) {
      // extend the best gapped predecessor by one more skipped char, or open a new gap at j-2
      if (gapBest > NEG_INF) gapBest += GAP_EXTEND;
      if (j >= 2) {
        const cand = M[prevRow + j - 2] + GAP_START;
        if (cand > gapBest) { gapBest = cand; gapArg = j - 2; }
      }
      if (text[j] !== pattern[i]) continue;

      let best = NEG_INF, arg = -1, runBonus = bonus[j];
      const adj = M[prevRow + j - 1];
      if (adj > NEG_INF) {
        // consecutive chars inherit the boundary bonus of the run's first char (like fzf)
        const rb = Math.max(RUNB[prevRow + j - 1], bonus[j]);
        best = adj + BONUS_CONSECUTIVE + rb;
        arg = j - 1; runBonus = rb;
      }
      if (gapBest > NEG_INF && gapBest + bonus[j] > best) {
        best = gapBest + bonus[j]; arg = gapArg; runBonus = bonus[j];
      }
      if (arg < 0) continue;
      M[row + j] = best + SCORE_MATCH;
      B[row + j] = arg;
      RUNB[row + j] = runBonus;
    }
  }

  const lastRow = (m - 1) * n;
  let bestScore = NEG_INF, bestJ = -1;
  for (let j = first; j <= last; j++) {
    if (M[lastRow + j] > bestScore) { bestScore = M[lastRow + j]; bestJ = j; }
  }
  if (bestJ < 0) return null;

  const positions = new Array(m);
  for (let i = m - 1, j = bestJ; i >= 0; i--) {
    positions[i] = j;
    j = B[i * n + j];
  }
  // Reward compact matches relative to text length (exact title hits outrank long-title hits)
  const compactness = (m / Math.max(n, m)) * 8;
  return { score: bestScore + compactness, positions };
}

/** Plain substring match, scored so earlier / word-boundary hits rank higher. */
export function substringMatch(pattern, text, original = text) {
  if (!pattern) return { score: 0, positions: [] };
  let idx = text.indexOf(pattern);
  if (idx < 0) return null;
  // prefer an occurrence at a word boundary if there is one
  let at = idx;
  while (at >= 0) {
    if (at === 0 || SEPARATORS.has(original[at - 1])) { idx = at; break; }
    at = text.indexOf(pattern, at + 1);
  }
  const positions = Array.from({ length: pattern.length }, (_, k) => idx + k);
  const boundary = idx === 0 ? BONUS_FIRST_CHAR * 2 : SEPARATORS.has(original[idx - 1]) ? BONUS_BOUNDARY * 2 : 0;
  const score = pattern.length * (SCORE_MATCH + BONUS_CONSECUTIVE) + boundary - Math.min(idx, 40) * 0.3
    + (pattern.length / Math.max(text.length, 1)) * 8;
  return { score, positions };
}

// ───────────────────────── Query language ─────────────────────────

export const FLAG_FILTERS = {
  pinned: ["pinned", "pin"],
  audible: ["audible", "audio", "sound", "playing"],
  muted: ["muted", "mute"],
  discarded: ["unloaded", "discarded", "sleeping"],
  loaded: ["loaded"],
  duplicate: ["dup", "dupe", "dupes", "duplicate", "duplicates"],
  currentWindow: ["here", "window", "win"],
  private: ["private", "incognito"],
  marked: ["marked"],
};

export const SOURCE_FILTERS = {
  tab: ["tabs", "tab", "t"],
  closed: ["closed", "recent", "c", "r"],
  bookmark: ["bookmarks", "bookmark", "bm", "b"],
  history: ["history", "hist", "h"],
};

const FLAG_LOOKUP = new Map();
for (const [flag, names] of Object.entries(FLAG_FILTERS)) for (const n of names) FLAG_LOOKUP.set(n, flag);
const SOURCE_LOOKUP = new Map();
for (const [src, names] of Object.entries(SOURCE_FILTERS)) for (const n of names) SOURCE_LOOKUP.set(n, src);
const ALL_FILTER_WORDS = [...FLAG_LOOKUP.keys(), ...SOURCE_LOOKUP.keys()];

function tokenize(query) {
  const tokens = [];
  const re = /(!?)"([^"]*)"?|(\S+)/g;
  let m;
  while ((m = re.exec(query))) {
    if (m[2] !== undefined) tokens.push({ text: m[2], quoted: true, neg: m[1] === "!" });
    else tokens.push({ text: m[3], quoted: false, neg: false });
  }
  return tokens;
}

/**
 * Parse a raw query into search terms and filters.
 *   foo bar        fuzzy terms (all must match)
 *   "exact words"  substring term
 *   !foo           exclude results containing foo
 *   @pinned @audio @muted @dup @here @unloaded …   flag filters
 *   @tabs @closed @bookmarks @history (@t @c @b @h) source filters
 *   site:github    hostname filter      in:work   container filter
 */
export function parseQuery(query, enableFilters = true) {
  const q = { terms: [], negs: [], flags: new Set(), sources: null, sites: [], containers: [], filterTokens: [] };
  for (const tok of tokenize(query)) {
    let t = tok.text;
    if (!t) continue;
    if (tok.quoted) {
      (tok.neg ? q.negs : q.terms).push({ text: t, exact: true });
      continue;
    }
    if (enableFilters) {
      if (t.length > 1 && t[0] === "!") { q.negs.push({ text: t.slice(1), exact: true }); q.filterTokens.push(t); continue; }
      if (t[0] === "@") {
        const name = t.slice(1).toLowerCase();
        if (FLAG_LOOKUP.has(name)) { q.flags.add(FLAG_LOOKUP.get(name)); q.filterTokens.push(t); continue; }
        if (SOURCE_LOOKUP.has(name)) { (q.sources ??= new Set()).add(SOURCE_LOOKUP.get(name)); q.filterTokens.push(t); continue; }
        // a partially-typed filter shouldn't wreck the results while typing
        if (name === "" || ALL_FILTER_WORDS.some((w) => w.startsWith(name))) { q.filterTokens.push(t); continue; }
      }
      const colon = t.indexOf(":");
      if (colon > 0) {
        const key = t.slice(0, colon).toLowerCase();
        const val = t.slice(colon + 1);
        if (key === "site" || key === "host" || key === "domain") { if (val) q.sites.push(val.toLowerCase()); q.filterTokens.push(t); continue; }
        if (key === "in" || key === "container") { if (val) q.containers.push(val.toLowerCase()); q.filterTokens.push(t); continue; }
      }
    }
    q.terms.push({ text: t, exact: false });
  }
  return q;
}

export function isEmptyQuery(q) {
  return q.terms.length === 0;
}

function hasFilters(q) {
  return q.negs.length || q.flags.size || q.sources || q.sites.length || q.containers.length;
}
export { hasFilters };

// ───────────────────────── URL detection ─────────────────────────

const URL_SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;
const DOMAIN_LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,})$/i;

function isIpv4(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && host.split(".").every((p) => Number(p) <= 255);
}

function looksLikeHost(host) {
  if (!host) return false;
  if (/^localhost$/i.test(host) || isIpv4(host)) return true;
  if (/^\[[0-9a-f:.]+\]$/i.test(host)) return true;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((l) => l.length <= 63 && DOMAIN_LABEL.test(l))) return false;
  return TLD.test(labels[labels.length - 1]);
}

function displayUrl(raw, hadScheme) {
  const noScheme = hadScheme ? raw.replace(URL_SCHEME, "") : raw;
  return noScheme.replace(/^www\./i, "").replace(/^([^/?#]+)\/$/, "$1");
}

/**
 * If `input` looks like a URL the user wants to visit (example.com, localhost:3000,
 * https://…), return {url, display} with an absolute URL, otherwise null.
 */
export function detectUrl(input) {
  const raw = (input || "").trim();
  if (!raw || raw.length > 2048 || /\s/.test(raw)) return null;

  const scheme = URL_SCHEME.exec(raw);
  if (scheme) {
    if (!/^https?$/i.test(scheme[1])) return null;
    try {
      const u = new URL(raw);
      if (!u.hostname) return null;
      return { url: u.href, display: displayUrl(raw, true) };
    } catch {
      return null;
    }
  }

  // Reject unknown schemes such as site:github, but keep host:port.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^:/?#]+:\d+(?:[/?#]|$)/i.test(raw)) return null;

  const hostEnd = raw.search(/[/?#]/);
  const authority = hostEnd < 0 ? raw : raw.slice(0, hostEnd);
  const rest = hostEnd < 0 ? "" : raw.slice(hostEnd);
  const portMatch = /^(.*?):(\d{1,5})$/.exec(authority);
  const host = portMatch ? portMatch[1] : authority;
  const port = portMatch ? Number(portMatch[2]) : 0;
  if (portMatch && (port < 1 || port > 65535)) return null;
  if (!looksLikeHost(host)) return null;

  try {
    const u = new URL(`https://${authority}${rest}`);
    if (!u.hostname) return null;
    return { url: u.href, display: displayUrl(raw, false) };
  } catch {
    return null;
  }
}

// ───────────────────────── Matching items ─────────────────────────

/**
 * Prepare an item for matching. Items need {title, url}; derived fields are cached on the item.
 */
export function prepare(item) {
  if (item._prep) return item._prep;
  const title = item.title || "";
  const url = item.url || "";
  let host = "";
  let display = url;
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, "");
    display = (u.protocol === "http:" || u.protocol === "https:")
      ? host + (u.pathname === "/" ? "" : u.pathname) + u.search + u.hash
      : url;
  } catch { /* about:, data: … */ }
  item._prep = {
    title, display, host,
    _titleLower: null,
    _titleExact: null,
    _displayLower: null,
    _displayExact: null,
    _hostLower: null,
    get titleLower() { return this._titleLower ??= fold(this.title, true); },
    get titleExact() { return this._titleExact ??= fold(this.title, false); },
    get displayLower() { return this._displayLower ??= fold(this.display, true); },
    get displayExact() { return this._displayExact ??= fold(this.display, false); },
    get hostLower() { return this._hostLower ??= this.host.toLowerCase(); },
  };
  return item._prep;
}

/**
 * Match a parsed query against an item.
 * Returns {score, titlePositions:Set, urlPositions:Set} or null.
 * opts: {mode: fuzzy|words|exact, caseSensitivity: smart|insensitive|sensitive, searchUrls, titleWeight}
 */
export function matchItem(item, q, opts) {
  const p = prepare(item);

  for (const site of q.sites) if (!p.hostLower.includes(site)) return null;
  for (const neg of q.negs) {
    const n = fold(neg.text, true);
    if (p.titleLower.includes(n) || p.displayLower.includes(n)) return null;
  }

  const titlePositions = new Set();
  const urlPositions = new Set();
  let total = 0;

  let terms = q.terms;
  if (opts.mode === "exact" && terms.length > 1) {
    terms = [{ text: terms.map((t) => t.text).join(" "), exact: true }];
  }

  for (const term of terms) {
    const sensitive = opts.caseSensitivity === "sensitive"
      || (opts.caseSensitivity === "smart" && /[A-Z]/.test(term.text));
    const pat = fold(term.text, !sensitive);
    const title = sensitive ? p.titleExact : p.titleLower;
    const disp = sensitive ? p.displayExact : p.displayLower;
    const useSubstring = term.exact || opts.mode !== "fuzzy";
    const fn = useSubstring ? substringMatch : fuzzyMatch;

    const tm = fn(pat, title, p.title);
    const um = opts.searchUrls ? fn(pat, disp, p.display) : null;
    const tScore = tm ? tm.score * opts.titleWeight : NEG_INF;
    const uScore = um ? um.score : NEG_INF;
    if (!tm && !um) return null;

    if (tScore >= uScore) { total += tScore; tm.positions.forEach((x) => titlePositions.add(x)); }
    else { total += uScore; um.positions.forEach((x) => urlPositions.add(x)); }
  }
  return { score: total, titlePositions, urlPositions };
}

/** Bonus for recently used items. rank 0 = most recent. */
export function recencyBonus(rank, boostPercent) {
  if (!boostPercent || rank == null) return 0;
  return (boostPercent / 100) * 40 / (1 + rank / 4);
}
