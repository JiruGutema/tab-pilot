import { test } from "node:test";
import assert from "node:assert/strict";
import { fuzzyMatch, substringMatch, parseQuery, matchItem, fold, prepare } from "../shared/search.js";
import { DEFAULTS } from "../shared/settings.js";

const opts = { mode: "fuzzy", caseSensitivity: "smart", searchUrls: true, titleWeight: 2 };
const rank = (q, items) => items
  .map((it) => ({ it, m: matchItem(it, parseQuery(q), opts) }))
  .filter((x) => x.m).sort((a, b) => b.m.score - a.m.score).map((x) => x.it.title);

test("fuzzy finds subsequence and returns positions", () => {
  const r = fuzzyMatch("gh", "github");
  assert.deepEqual(r.positions, [0, 3]);
  assert.equal(fuzzyMatch("xyz", "github"), null);
});

test("prefers word-boundary and consecutive matches", () => {
  const a = fuzzyMatch("pr", "pull requests").score; // boundary p, r
  const b = fuzzyMatch("pr", "sharp rock").score;
  assert.ok(fuzzyMatch("pull", "the pull request").score > fuzzyMatch("pull", "p u l l").score);
  assert.ok(a > 0 && b > 0);
});

test("optimal alignment picks the boundary occurrence", () => {
  const r = fuzzyMatch("rq", "pull requests - rq");
  // either 'r'(5)+'q'(7) or 'rq' at end (16,17): consecutive at boundary should win
  assert.deepEqual(r.positions, [16, 17]);
});

test("ranking: exact-ish title beats scattered matches", () => {
  const items = [
    { title: "Random article about gardens", url: "https://example.com/a" },
    { title: "GitHub", url: "https://github.com/" },
    { title: "Gmail - Inbox", url: "https://mail.google.com/" },
  ];
  assert.equal(rank("gh", items)[0], "GitHub");
  assert.equal(rank("inbox", items)[0], "Gmail - Inbox");
  assert.equal(rank("mail", items)[0], "Gmail - Inbox");
});

test("multi-term AND across title and url", () => {
  const items = [
    { title: "Issues", url: "https://github.com/mozilla/gecko/issues" },
    { title: "Issues", url: "https://gitlab.com/foo/issues" },
  ];
  const res = rank("issues github", items);
  assert.equal(res.length, 1);
});

test("filters parse", () => {
  const q = parseQuery('@pinned site:github !draft "exact phrase" foo @b @pi');
  assert.ok(q.flags.has("pinned"));
  assert.deepEqual(q.sites, ["github"]);
  assert.equal(q.negs[0].text, "draft");
  assert.deepEqual(q.terms.map((t) => t.text), ["exact phrase", "foo"]);
  assert.ok(q.sources.has("bookmark"));
});

test("negation and site filters exclude", () => {
  const items = [
    { title: "Draft post", url: "https://blog.example.com/1" },
    { title: "Final post", url: "https://github.com/x" },
  ];
  assert.deepEqual(rank("post !draft", items), ["Final post"]);
  assert.deepEqual(rank("post site:github", items), ["Final post"]);
});

test("smart case and accent folding", () => {
  assert.equal(fold("Café Résumé", true), "cafe resume");
  const items = [{ title: "Café", url: "" }, { title: "cafe", url: "" }];
  assert.equal(rank("cafe", items).length, 2);
  assert.equal(rank("Ca", items).length, 1);
});

test("substring mode", () => {
  assert.ok(substringMatch("hub", "github"));
  assert.equal(substringMatch("gh", "github"), null);
});

test("long text and performance", () => {
  const long = "a".repeat(5000) + "needle";
  fuzzyMatch("ndl", long); // truncated; must not throw
  const items = Array.from({ length: 2000 }, (_, i) => ({ title: `Tab number ${i} some title text here`, url: `https://site${i}.example.com/path/to/page?q=${i}` }));
  const t0 = performance.now();
  rank("ex pg", items);
  const dt = performance.now() - t0;
  assert.ok(dt < 400, `took ${dt}ms`);
});

test("default search settings use words match mode", () => {
  assert.equal(DEFAULTS.matchMode, "words");
  const wordsOpts = { mode: DEFAULTS.matchMode, caseSensitivity: DEFAULTS.caseSensitivity, searchUrls: DEFAULTS.searchUrls, titleWeight: DEFAULTS.titleWeight };
  const item = { title: "GitHub Pull Requests", url: "https://github.com/pulls" };
  // Non-contiguous fuzzy query "gh" does not match in words mode
  assert.equal(matchItem(item, parseQuery("gh"), wordsOpts), null);
  // Full substring words match
  assert.notEqual(matchItem(item, parseQuery("git"), wordsOpts), null);
  assert.notEqual(matchItem(item, parseQuery("pull"), wordsOpts), null);
});

test("prepare(item) evaluates folded strings lazily", () => {
  const item = { title: "Test Page", url: "https://example.com/page" };
  const p = prepare(item);
  assert.equal(p._titleLower, null);
  assert.equal(p._displayLower, null);
  assert.equal(p.host, "example.com");
  assert.equal(p.display, "example.com/page");
  // accessing host or display leaves folded strings uncomputed
  assert.equal(p._titleLower, null);
  // accessing titleLower triggers computation and caches it
  assert.equal(p.titleLower, "test page");
  assert.equal(p._titleLower, "test page");
});

