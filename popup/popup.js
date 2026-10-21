import { loadSettings, applyTheme, ACTIONS } from "../shared/settings.js";
import { comboFromEvent, buildKeymap, comboCaps, normalizeCombo } from "../shared/keys.js";
import { parseQuery, matchItem, recencyBonus, prepare, hasFilters, FLAG_FILTERS, SOURCE_FILTERS } from "../shared/search.js";
import { icon, hydrateIcons } from "../shared/icons.js";

const $ = (sel) => document.querySelector(sel);
const els = {
  root: document.documentElement,
  app: $("#app"),
  input: $("#q"),
  list: $("#list"),
  count: $("#count"),
  chips: $("#chips"),
  empty: $("#empty"),
  emptySub: $("#emptySub"),
  footer: $("#footer"),
  help: $("#help"),
  helpBody: $("#helpBody"),
  toast: $("#toast"),
};

const CHUNK = 80;
const SECTION_LABELS = { tab: "Tabs", closed: "Recently closed", bookmark: "Bookmarks", history: "History", web: "Web" };
const SECTION_ICONS = { tab: "window", closed: "undo", bookmark: "star", history: "clock", web: "globe" };

const state = {
  s: null,
  keymap: new Map(),
  tabs: [],
  windowNumbers: new Map(),
  containers: new Map(),
  currentWindowId: null,
  currentTabId: null,
  incognito: false,
  hostIcons: new Map(),

  closed: null,             // recently closed (lazy)
  bookmarks: null,          // flattened bookmark list (lazy)
  historyRecent: null,      // recent history (lazy)
  historySearch: new Map(), // query text -> results from history.search
  perms: { bookmarks: false, history: false },

  query: "",
  parsed: parseQuery(""),
  entries: [],
  selected: 0,
  rendered: 0,
  marked: new Set(),        // tab ids
  windowGrouping: false,
  sectionCounts: { kinds: new Map(), windows: new Map() },
};

// ─────────────────────────────── Data loading ───────────────────────────────

function normUrl(url) {
  return (url || "").replace(/#.*$/, "").replace(/\/$/, "");
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function queryTabsData() {
  return Promise.all([
    browser.tabs.query({}),
    browser.windows.getAll({ windowTypes: ["normal"] }),
    browser.windows.getCurrent(),
  ]);
}

function applyTabsData([tabs, wins, cur]) {
  state.currentWindowId = cur.id;
  state.incognito = cur.incognito;
  state.windowNumbers = new Map(wins.sort((a, b) => a.id - b.id).map((w, i) => [w.id, i + 1]));

  state.tabs = tabs.filter((t) => state.s.showHiddenTabs || !t.hidden);
  const active = state.tabs.find((t) => t.active && t.windowId === cur.id);
  state.currentTabId = active?.id ?? null;

  [...state.tabs]
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
    .forEach((t, i) => { t._mru = i; });

  const counts = new Map();
  for (const t of state.tabs) {
    const k = normUrl(t.url);
    counts.set(k, (counts.get(k) || 0) + 1);
    if (t.favIconUrl) {
      const host = hostOf(t.url);
      if (host && !state.hostIcons.has(host)) state.hostIcons.set(host, t.favIconUrl);
    }
  }
  for (const t of state.tabs) t._dup = counts.get(normUrl(t.url)) > 1 && !/^about:(newtab|home|blank)/.test(t.url);
  for (const id of state.marked) if (!state.tabs.some((t) => t.id === id)) state.marked.delete(id);
}

async function loadTabs() {
  const data = await queryTabsData();
  applyTabsData(data);
}

async function queryContainers() {
  try {
    const list = await (browser.contextualIdentities?.query({}) ?? Promise.resolve([]));
    return new Map(list.map((c) => [c.cookieStoreId, c]));
  } catch {
    return new Map();
  }
}

async function queryPermissions() {
  try {
    const { permissions } = await (browser.permissions?.getAll() ?? Promise.resolve({ permissions: [] }));
    return {
      bookmarks: permissions.includes("bookmarks"),
      history: permissions.includes("history"),
    };
  } catch {
    return { bookmarks: false, history: false };
  }
}

async function loadContainers() {
  state.containers = await queryContainers();
}

async function loadPermissions() {
  state.perms = await queryPermissions();
}

async function loadClosed() {
  try {
    const sessions = await browser.sessions.getRecentlyClosed({ maxResults: 25 });
    state.closed = sessions.map((s) => {
      if (s.tab) {
        return { sessionId: s.tab.sessionId, title: s.tab.title, url: s.tab.url, favIconUrl: s.tab.favIconUrl, when: s.lastModified, windowId: s.tab.windowId };
      }
      const w = s.window;
      const first = w.tabs?.[w.tabs.length - 1] ?? w.tabs?.[0];
      return { sessionId: w.sessionId, isWindow: true, count: w.tabs?.length ?? 0, title: first?.title ?? "Window", url: first?.url ?? "", favIconUrl: first?.favIconUrl, when: s.lastModified };
    }).filter((c) => c.sessionId);
  } catch {
    state.closed = [];
  }
}

async function loadBookmarks() {
  try {
    const tree = await browser.bookmarks.getTree();
    const out = [];
    const walk = (node, path) => {
      if (node.url && !node.url.startsWith("place:")) out.push({ id: node.id, title: node.title, url: node.url, folder: path, added: node.dateAdded });
      if (node.children) {
        const next = node.title ? (path ? `${path} / ${node.title}` : node.title) : path;
        for (const c of node.children) walk(c, next);
      }
    };
    walk(tree[0], "");
    state.bookmarks = out.sort((a, b) => (b.added || 0) - (a.added || 0)); // newest first
  } catch {
    state.bookmarks = [];
  }
}

async function loadRecentHistory() {
  try {
    const items = await browser.history.search({ text: "", maxResults: 1500, startTime: Date.now() - 1000 * 60 * 60 * 24 * 90 });
    state.historyRecent = items.filter((h) => h.url);
  } catch {
    state.historyRecent = [];
  }
}

let historyTimer = 0;
function queueHistorySearch(text) {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(async () => {
    if (state.historySearch.has(text)) return;
    try {
      const items = await browser.history.search({ text, maxResults: 150, startTime: 0 });
      state.historySearch.set(text, items.filter((h) => h.url));
    } catch {
      state.historySearch.set(text, []);
    }
    if (state.parsed.terms.map((t) => t.text).join(" ") === text) recompute({ keepSelection: true });
  }, 140);
}

// ─────────────────────────────── Searching ───────────────────────────────

function sourceEnabled(src, q, emptyQuery) {
  if (q.sources) {
    if (!q.sources.has(src)) return false;
    if (src === "bookmark") return state.perms.bookmarks;
    if (src === "history") return state.perms.history;
    return true;
  }
  if (src === "tab") return true;
  // tab-only filters (e.g. @pinned) imply tabs only
  if (q.flags.size || q.containers.length) return false;
  if (emptyQuery && !state.s.otherSourcesOnEmpty) return false;
  if (src === "closed") return state.s.sourceClosed;
  if (src === "bookmark") return state.s.sourceBookmarks && state.perms.bookmarks;
  if (src === "history") return state.s.sourceHistory && state.perms.history;
  return false;
}

function matchOpts() {
  const s = state.s;
  return { mode: s.matchMode, caseSensitivity: s.caseSensitivity, searchUrls: s.searchUrls, titleWeight: Number(s.titleWeight) };
}

function tabPassesFilters(t, q) {
  const f = q.flags;
  if ((state.s.scope === "current" || f.has("currentWindow")) && t.windowId !== state.currentWindowId) return false;
  if (f.has("pinned") && !t.pinned) return false;
  if (f.has("audible") && !t.audible) return false;
  if (f.has("muted") && !t.mutedInfo?.muted) return false;
  if (f.has("discarded") && !t.discarded) return false;
  if (f.has("loaded") && t.discarded) return false;
  if (f.has("duplicate") && !t._dup) return false;
  if (f.has("private") && !t.incognito) return false;
  if (f.has("marked") && !state.marked.has(t.id)) return false;
  if (q.containers.length) {
    const c = state.containers.get(t.cookieStoreId);
    const name = (c?.name ?? (t.cookieStoreId === "firefox-default" ? "default none" : "")).toLowerCase();
    if (!q.containers.some((x) => name.includes(x))) return false;
  }
  return true;
}

function searchTabs(q, emptyQuery) {
  const s = state.s;
  let tabs = state.tabs.filter((t) => tabPassesFilters(t, q));
  if (s.currentTab === "hide") tabs = tabs.filter((t) => t.id !== state.currentTabId);

  if (emptyQuery) {
    if (s.sortEmpty === "tabOrder") {
      const cur = state.currentWindowId;
      tabs.sort((a, b) =>
        (a.windowId === cur ? 0 : 1) - (b.windowId === cur ? 0 : 1)
        || (state.windowNumbers.get(a.windowId) ?? 0) - (state.windowNumbers.get(b.windowId) ?? 0)
        || a.index - b.index);
    } else {
      tabs.sort((a, b) => a._mru - b._mru);
    }
    if (s.currentTab === "last") {
      const i = tabs.findIndex((t) => t.id === state.currentTabId);
      if (i >= 0 && !(s.sortEmpty === "tabOrder" && state.windowGrouping)) tabs.push(...tabs.splice(i, 1));
    }
    return tabs.map((t) => ({ kind: "tab", key: `t${t.id}`, item: t, match: null }));
  }

  const opts = matchOpts();
  const out = [];
  for (const t of tabs) {
    const m = matchItem(t, q, opts);
    if (!m) continue;
    out.push({ kind: "tab", key: `t${t.id}`, item: t, match: m, score: m.score + recencyBonus(t._mru, s.recencyBoost) });
  }
  return out.sort((a, b) => b.score - a.score || a.item._mru - b.item._mru);
}

/** Score a list of non-tab items; with an empty query keep the given (recency) order. */
function searchList(items, kind, keyOf, q, emptyQuery, limit, skipUrls) {
  const out = [];
  const opts = matchOpts();
  for (const [i, it] of items.entries()) {
    if (skipUrls?.has(normUrl(it.url))) continue;
    if (emptyQuery) {
      if (!hasFilters(q) || matchItem(it, q, opts)) out.push({ kind, key: keyOf(it), item: it, match: null, score: -i });
      continue;
    }
    const m = matchItem(it, q, opts);
    if (m) out.push({ kind, key: keyOf(it), item: it, match: m, score: m.score + recencyBonus(i, state.s.recencyBoost / 2) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

function recompute({ keepSelection = false } = {}) {
  const s = state.s;
  const q = state.parsed;
  const emptyQuery = q.terms.length === 0;
  const prevKey = state.entries[state.selected]?.key;

  state.windowGrouping = emptyQuery && s.groupByWindow && s.sortEmpty === "tabOrder" && s.scope === "all"
    && !q.flags.has("currentWindow") && state.windowNumbers.size > 1;

  const entries = [];
  const seen = new Set();

  if (sourceEnabled("tab", q, emptyQuery)) {
    const tabs = searchTabs(q, emptyQuery);
    entries.push(...tabs);
    for (const t of state.tabs) seen.add(normUrl(t.url));
  }

  if (sourceEnabled("closed", q, emptyQuery)) {
    if (state.closed === null) { state.closed = []; loadClosed().then(() => recompute({ keepSelection: true })); }
    entries.push(...searchList(state.closed, "closed", (c) => `c${c.sessionId}`, q, emptyQuery, s.maxClosed));
  }

  if (sourceEnabled("bookmark", q, emptyQuery)) {
    if (state.bookmarks === null) { state.bookmarks = []; loadBookmarks().then(() => recompute({ keepSelection: true })); }
    const bm = searchList(state.bookmarks, "bookmark", (b) => `b${b.id}`, q, emptyQuery, s.maxBookmarks, seen);
    entries.push(...bm);
    for (const b of bm) seen.add(normUrl(b.item.url));
  }

  if (sourceEnabled("history", q, emptyQuery)) {
    if (state.historyRecent === null) { state.historyRecent = []; loadRecentHistory().then(() => recompute({ keepSelection: true })); }
    let pool = state.historyRecent;
    if (!emptyQuery) {
      const text = q.terms.map((t) => t.text).join(" ");
      const extra = state.historySearch.get(text);
      if (extra) {
        const urls = new Set(pool.map((h) => h.url));
        pool = pool.concat(extra.filter((h) => !urls.has(h.url)));
      } else {
        queueHistorySearch(text);
      }
    }
    const byUrl = new Map();
    for (const h of pool) {
      const k = normUrl(h.url);
      if (!byUrl.has(k)) byUrl.set(k, h);
    }
    entries.push(...searchList([...byUrl.values()], "history", (h) => `h${h.url}`, q, emptyQuery, s.maxHistory, seen));
  }

  if (!entries.length && !emptyQuery && s.webSearchFallback && !q.sources) {
    const text = q.terms.map((t) => t.text).join(" ");
    entries.push({ kind: "web", key: "web", item: { title: `Search the web for “${text}”`, url: "", query: text }, match: null });
  }

  state.entries = entries;

  let sel = 0;
  if (keepSelection && prevKey) {
    const i = entries.findIndex((e) => e.key === prevKey);
    sel = i >= 0 ? i : Math.min(state.selected, entries.length - 1);
  } else if (emptyQuery && s.selectPrevious && entries.length > 1 && entries[0].item.id === state.currentTabId) {
    sel = 1;
  } else if (emptyQuery && s.selectPrevious && entries.length > 1 && s.currentTab !== "hide") {
    // current tab not first (e.g. tab order): select the most recently used other tab
    const prev = entries.findIndex((e) => e.kind === "tab" && e.item._mru === 1);
    if (prev >= 0) sel = prev;
  }
  state.selected = Math.max(0, sel);
  render();
}

// ─────────────────────────────── Rendering ───────────────────────────────

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function highlight(text, positions, offset = 0) {
  const frag = document.createDocumentFragment();
  if (!positions || positions.size === 0) { frag.append(text); return frag; }
  let buf = "", inMark = false;
  const flush = () => {
    if (!buf) return;
    frag.append(inMark ? el("mark", null, buf) : document.createTextNode(buf));
    buf = "";
  };
  for (let i = 0; i < text.length; i++) {
    const hit = positions.has(i + offset);
    if (hit !== inMark) { flush(); inMark = hit; }
    buf += text[i];
  }
  flush();
  return frag;
}

function hueOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

function letterIcon(seed) {
  const d = el("div", "fav letter", (seed || "?").replace(/^www\./, "")[0] || "?");
  d.style.background = `hsl(${hueOf(seed || "?")} 55% 52%)`;
  return d;
}

function faviconFor(entry) {
  const { item, kind } = entry;
  if (kind === "web") { const g = el("div", "fav glyph"); g.append(icon("globe", 13)); return g; }
  const host = item._prep?.host ?? hostOf(item.url);
  let src = item.favIconUrl;
  if (!src && host) src = state.hostIcons.get(host);
  if (src && /^(https?:|data:|moz-extension:)/.test(src)) {
    const img = el("img", "fav");
    img.alt = "";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.src = src;
    img.addEventListener("error", () => img.replaceWith(letterIcon(host || item.title)), { once: true });
    return img;
  }
  if (!host) { const g = el("div", "fav glyph"); g.append(icon("page", 12)); return g; }
  return letterIcon(host);
}

function relTime(ts) {
  if (!ts) return "";
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400 / 7)}w`;
  return `${Math.floor(s / 86400 / 365)}y`;
}

function badge(cls, iconName, text, title) {
  const b = el("span", `badge ${cls}${text ? "" : " icon-only"}`);
  if (iconName) b.append(icon(iconName, 12));
  if (text) b.append(text);
  if (title) b.title = title;
  return b;
}

function metaFor(entry) {
  const s = state.s;
  const meta = el("div", "meta");
  const { item, kind } = entry;
  if (kind === "tab") {
    if (s.showBadges) {
      if (item.id === state.currentTabId) meta.append(badge("current", null, "current"));
      const c = state.containers.get(item.cookieStoreId);
      if (c) {
        const b = badge("container", null, null, `Container: ${c.name}`);
        b.classList.remove("icon-only");
        const dot = el("span", "dot");
        dot.style.background = c.colorCode;
        b.append(dot, c.name);
        b.style.color = c.colorCode;
        meta.append(b);
      }
      if (item._dup) meta.append(badge("dup", null, "dup", "Duplicate — another tab has the same URL"));
      if (item.pinned) meta.append(badge("pinned", "pin", null, "Pinned"));
      if (item.mutedInfo?.muted) meta.append(badge("muted", "muted", null, "Muted"));
      else if (item.audible) meta.append(badge("audible", "volume", null, "Playing audio"));
      if (item.discarded) meta.append(badge("discarded", "moon", null, "Unloaded from memory"));
      if (!state.windowGrouping && state.windowNumbers.size > 1 && item.windowId !== state.currentWindowId) {
        meta.append(badge("window", "window", String(state.windowNumbers.get(item.windowId) ?? "?"), "In another window"));
      }
    }
    if (s.showLastAccessed && item.id !== state.currentTabId) meta.append(el("span", "time", relTime(item.lastAccessed)));
  } else if (kind === "closed") {
    if (item.isWindow) meta.append(badge("window", "window", `${item.count} tabs`));
    if (s.showLastAccessed) meta.append(el("span", "time", relTime(item.when)));
  } else if (kind === "bookmark") {
    if (item.folder && s.showBadges) {
      const b = badge("folder", null, item.folder.split(" / ").pop());
      b.title = item.folder;
      meta.append(b);
    }
  } else if (kind === "history") {
    if (s.showLastAccessed) meta.append(el("span", "time", relTime(item.lastVisitTime)));
  }
  return meta;
}

function rowFor(entry, index) {
  const s = state.s;
  const { item, kind, match } = entry;
  const p = kind === "web" ? null : prepare(item);
  const row = el("div", "row");
  row.id = `row-${index}`;
  row.dataset.index = index;
  row.dataset.kind = kind;
  row.setAttribute("role", "option");
  if (kind === "tab") {
    if (state.marked.has(item.id)) row.classList.add("marked");
    if (item.discarded) row.classList.add("discarded");
  }

  const check = el("span", "check");
  check.append(icon("check", 11));
  row.append(check);
  if (s.showFavicons) row.append(faviconFor(entry));

  const text = el("div", "text");
  const titleText = (item.title || p?.display || item.url || "Untitled").trim();
  const title = el("div", "title");
  title.append(highlight(titleText, item.title ? match?.titlePositions : null));
  title.title = titleText;
  text.append(title);

  if (s.showUrl && p && p.display) {
    const url = el("div", "url");
    const positions = match?.urlPositions;
    const deep = positions && [...positions].some((x) => x >= p.host.length);
    const shown = s.urlStyle === "full" || deep || !p.host ? p.display : p.host;
    url.append(highlight(shown, positions));
    url.title = item.url;
    text.append(url);
  }
  row.append(text, metaFor(entry));

  if (kind !== "web" && kind !== "bookmark") {
    const actions = el("div", "row-actions");
    const btn = el("button", "row-btn");
    btn.type = "button";
    btn.tabIndex = -1;
    btn.title = kind === "tab" ? "Close tab" : kind === "history" ? "Remove from history" : "Forget";
    btn.dataset.act = "close";
    btn.append(icon("x", 14));
    actions.append(btn);
    row.append(actions);
  }
  if (s.quickJump && index < 9) row.append(el("span", "jump", String(index + 1)));
  return row;
}

function sectionHeader(label, iconName, n) {
  const h = el("div", "section");
  if (iconName) h.append(icon(iconName, 12));
  h.append(label);
  if (n != null) h.append(el("span", "n", `· ${n}`));
  return h;
}

/** Per-render counts used by section headers. */
function countSections() {
  const kinds = new Map();
  const windows = new Map();
  for (const e of state.entries) {
    kinds.set(e.kind, (kinds.get(e.kind) || 0) + 1);
    if (e.kind === "tab") windows.set(e.item.windowId, (windows.get(e.item.windowId) || 0) + 1);
  }
  state.sectionCounts = { kinds, windows };
}

function headerFor(i) {
  const e = state.entries[i];
  const prev = state.entries[i - 1];
  const { kinds, windows } = state.sectionCounts;
  if (e.kind === "tab" && state.windowGrouping) {
    if (prev && prev.item.windowId === e.item.windowId) return null;
    const n = windows.get(e.item.windowId);
    const label = e.item.windowId === state.currentWindowId ? "This window" : `Window ${state.windowNumbers.get(e.item.windowId) ?? ""}`;
    return sectionHeader(label, "window", n);
  }
  if (kinds.size < 2 || (prev && prev.kind === e.kind)) return null;
  return sectionHeader(SECTION_LABELS[e.kind], SECTION_ICONS[e.kind], kinds.get(e.kind));
}

function renderMore(upto) {
  const end = Math.min(upto, state.entries.length);
  if (end <= state.rendered) return;
  const frag = document.createDocumentFragment();
  for (let i = state.rendered; i < end; i++) {
    const h = headerFor(i);
    if (h) frag.append(h);
    frag.append(rowFor(state.entries[i], i));
  }
  state.rendered = end;
  els.list.append(frag);
}

function render() {
  countSections();
  els.list.textContent = "";
  state.rendered = 0;
  els.list.scrollTop = 0;
  renderMore(Math.max(CHUNK, state.selected + CHUNK / 2));

  const none = state.entries.length === 0;
  els.empty.hidden = !none;
  els.list.hidden = none;
  if (none) {
    els.emptySub.textContent = state.query
      ? "Try fewer letters, or prefix filters like @pinned, @closed, site:example.com, !exclude."
      : "No tabs to show.";
  }
  els.app.classList.toggle("has-marks", state.marked.size > 0);
  updateSelection(false);
  updateCount();
  updateChips();
  updateFooter();
}

function updateSelection(smooth = true) {
  const prev = els.list.querySelector(".row.selected");
  if (prev) { prev.classList.remove("selected"); prev.removeAttribute("aria-selected"); }
  if (!state.entries.length) { els.input.removeAttribute("aria-activedescendant"); return; }
  if (state.selected >= state.rendered) renderMore(state.selected + CHUNK);
  const row = document.getElementById(`row-${state.selected}`);
  if (!row) return;
  row.classList.add("selected");
  row.setAttribute("aria-selected", "true");
  els.input.setAttribute("aria-activedescendant", row.id);
  if (state.selected === 0) els.list.scrollTo({ top: 0, behavior: smooth && state.s.animations ? "smooth" : "auto" });
  else row.scrollIntoView({ block: "nearest", behavior: smooth && state.s.animations ? "smooth" : "auto" });
}

function updateCount() {
  if (!state.s.showCounts) { els.count.textContent = ""; return; }
  const tabsShown = state.entries.filter((e) => e.kind === "tab").length;
  const total = state.tabs.length;
  els.count.textContent = state.query || tabsShown !== total ? `${tabsShown} / ${total}` : `${total} tabs`;
}

function updateChips() {
  const chips = els.chips;
  chips.textContent = "";
  const q = state.parsed;

  // suggestions while typing a filter keyword
  const lastToken = state.query.endsWith(" ") ? "" : (state.query.split(/\s+/).pop() ?? "");
  if (state.s.enableFilters && lastToken.startsWith("@")) {
    const partial = lastToken.slice(1).toLowerCase();
    const options = [...Object.values(FLAG_FILTERS), ...Object.values(SOURCE_FILTERS)]
      .map((names) => names[0])
      .filter((n) => n.startsWith(partial) && n !== partial);
    if (options.length) {
      chips.append(el("span", "chips-label", "Filters"));
      for (const name of options) {
        const c = el("button", "chip suggest", `@${name}`);
        c.type = "button";
        c.addEventListener("click", () => completeFilter(name));
        chips.append(c);
      }
      chips.hidden = false;
      return;
    }
  }

  if (!q.filterTokens.length) { chips.hidden = true; return; }
  for (const tok of q.filterTokens) {
    if (tok === "@") continue;
    const c = el("button", "chip", tok);
    c.type = "button";
    c.title = "Remove filter";
    c.append(icon("x", 11));
    c.addEventListener("click", () => removeToken(tok));
    chips.append(c);
  }
  chips.hidden = chips.childElementCount === 0;
}

function completeFilter(name) {
  const parts = state.query.split(/(\s+)/);
  parts[parts.length - 1] = `@${name} `;
  setQuery(parts.join(""));
}

function removeToken(tok) {
  setQuery(state.query.split(/\s+/).filter((t) => t && t !== tok).join(" ") + (state.query.trim() ? " " : ""));
}

function setQuery(text) {
  els.input.value = text;
  onInput();
  els.input.focus();
}

function kbdGroup(combo) {
  const g = el("span", "kbd-group");
  for (const cap of comboCaps(combo)) g.append(el("kbd", null, cap));
  return g;
}

function firstCombo(action) {
  return state.s.keys[action]?.[0];
}

function updateFooter() {
  const f = els.footer;
  f.hidden = !state.s.showFooter;
  if (f.hidden) return;
  f.textContent = "";
  const hint = (combos, label) => {
    const h = el("span", "hint");
    for (const c of combos.filter(Boolean)) h.append(kbdGroup(c));
    h.append(label);
    f.append(h);
  };
  hint([firstCombo("next"), firstCombo("prev")], "navigate");
  const sel = state.entries[state.selected];
  hint([firstCombo("open")], sel && sel.kind !== "tab" ? "open" : "switch");
  if (!sel || sel.kind === "tab") hint([firstCombo("closeTab")], state.marked.size ? `close ${state.marked.size}` : "close");
  hint([firstCombo("toggleMark")], "mark");
  f.append(el("span", "spacer"));
  if (state.marked.size) f.append(el("span", "status", `${state.marked.size} marked`));
  hint([firstCombo("help")], "help");
}

function buildHelp() {
  const body = els.helpBody;
  body.textContent = "";
  const section = (title) => body.append(el("h3", null, title));
  const item = (left, right) => {
    const r = el("div", "help-item");
    r.append(left, right);
    body.append(r);
  };
  const code = (t) => el("code", null, t);

  section("Search syntax");
  const syntax = [
    ["gh iss", "fuzzy — all words must match"],
    ['"exact phrase"', "literal substring"],
    ["!word", "exclude results containing word"],
    ["site:github", "filter by domain"],
    ["in:work", "filter by container"],
    ["@pinned  @audio  @muted", "tab state"],
    ["@dup  @unloaded  @here", "duplicates, sleeping, this window"],
    ["@tabs @closed @bookmarks @history", "pick sources (@t @c @b @h)"],
    ["Foo", "uppercase = case-sensitive (smart case)"],
  ];
  for (const [c, d] of syntax) item(code(c), el("span", null, d));

  const groups = {};
  for (const [action, meta] of Object.entries(ACTIONS)) (groups[meta.group] ??= []).push([action, meta]);
  for (const [group, list] of Object.entries(groups)) {
    section(group);
    for (const [action, meta] of list) {
      const keys = el("span", "kbd-list");
      for (const c of state.s.keys[action] ?? []) keys.append(kbdGroup(c));
      if (!keys.childElementCount) keys.append(el("span", null, "—"));
      item(el("span", null, meta.label), keys);
    }
  }
  if (state.s.quickJump) item(el("span", null, "Open result 1–9"), kbdGroup("Alt+1"));
  section("Mouse");
  item(el("span", null, "Switch / open"), el("span", null, "Click"));
  item(el("span", null, "Close tab"), el("span", null, "Middle-click"));
  item(el("span", null, "Mark tab"), el("span", null, "Ctrl/Shift + click"));
}

function toggleHelp(show = els.help.hidden) {
  if (show) buildHelp();
  els.help.hidden = !show;
  if (!show) els.input.focus();
}

let toastTimer = 0;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1600);
}

// ─────────────────────────────── Actions ───────────────────────────────

function selectedEntry() {
  return state.entries[state.selected];
}

function move(delta) {
  const n = state.entries.length;
  if (!n) return;
  let i = state.selected + delta;
  if (state.s.wrapAround && Math.abs(delta) === 1) i = (i + n) % n;
  else i = Math.max(0, Math.min(n - 1, i));
  state.selected = i;
  updateSelection();
  updateFooter();
}

function pageSize() {
  const row = els.list.querySelector(".row");
  return Math.max(1, Math.floor(els.list.clientHeight / (row?.offsetHeight || 40)) - 1);
}

async function refresh() {
  await loadTabs();
  recompute({ keepSelection: true });
}

function finish() {
  window.close();
}

async function focusTab(tab) {
  await browser.tabs.update(tab.id, { active: true });
  if (tab.windowId !== state.currentWindowId) await browser.windows.update(tab.windowId, { focused: true });
}

async function openUrl(url, where) {
  if (state.s.switchToExisting && where === "default") {
    const existing = state.tabs.find((t) => normUrl(t.url) === normUrl(url));
    if (existing) return focusTab(existing);
  }
  if (where === "window") return browser.windows.create({ url });
  if (where === "tab" || state.s.openLinksIn === "newTab") return browser.tabs.create({ url, active: true });
  return browser.tabs.update({ url });
}

async function openEntry(entry, where = "default") {
  if (!entry) return;
  const { kind, item } = entry;
  try {
    if (kind === "tab") {
      if (where === "window") await browser.windows.create({ tabId: item.id });
      else if (where === "tab") await browser.tabs.duplicate(item.id);
      else await focusTab(item);
    } else if (kind === "closed") {
      await browser.sessions.restore(item.sessionId);
    } else if (kind === "web") {
      await browser.search.search({ query: item.query, disposition: where === "window" ? "NEW_WINDOW" : "NEW_TAB" });
    } else {
      await openUrl(item.url, where);
    }
  } catch (err) {
    // privileged URLs (about:config, file://) cannot be opened by extensions
    toast(`Can't open: ${err.message || err}`);
    return;
  }
  finish();
}

function targetTabs() {
  if (state.marked.size) return state.tabs.filter((t) => state.marked.has(t.id));
  const e = selectedEntry();
  return e?.kind === "tab" ? [e.item] : [];
}

async function closeSelected() {
  const e = selectedEntry();
  if (!state.marked.size && e && e.kind !== "tab") return removeNonTab(e);
  const tabs = targetTabs();
  if (!tabs.length) return;
  const ids = tabs.map((t) => t.id);
  const closingCurrent = ids.includes(state.currentTabId);
  // update the list immediately so rapid follow-up keys act on fresh results
  const gone = new Set(ids);
  state.tabs = state.tabs.filter((t) => !gone.has(t.id));
  ids.forEach((id) => state.marked.delete(id));
  recompute({ keepSelection: true });
  try {
    await browser.tabs.remove(ids);
  } catch (err) {
    toast(String(err.message || err));
  }
  state.closed = null;
  if (tabs.length > 1) toast(`Closed ${tabs.length} tabs`);
  if (closingCurrent && state.s.closeAfterAction) return finish();
  await refresh();
}

async function removeNonTab(e) {
  if (e.kind === "history") {
    await browser.history.deleteUrl({ url: e.item.url });
    state.historyRecent = state.historyRecent?.filter((h) => h.url !== e.item.url) ?? null;
    for (const [k, v] of state.historySearch) state.historySearch.set(k, v.filter((h) => h.url !== e.item.url));
    toast("Removed from history");
  } else if (e.kind === "closed") {
    try {
      if (e.item.isWindow) await browser.sessions.forgetClosedWindow(e.item.sessionId);
      else await browser.sessions.forgetClosedTab(e.item.windowId, e.item.sessionId);
    } catch { /* ignore */ }
    state.closed = null;
    toast("Forgotten");
  } else {
    toast("Bookmarks can't be deleted from here");
    return;
  }
  recompute({ keepSelection: true });
}

async function forEachTarget(fn, msg) {
  const tabs = targetTabs();
  if (!tabs.length) { toast("Select a tab first"); return; }
  try {
    await Promise.all(tabs.map(fn));
  } catch (err) {
    toast(String(err.message || err));
    return;
  }
  if (msg) toast(typeof msg === "function" ? msg(tabs) : msg);
  if (state.s.closeAfterAction) return finish();
  await refresh();
}

async function copyUrls() {
  const e = selectedEntry();
  const urls = state.marked.size ? targetTabs().map((t) => t.url) : e && e.item.url ? [e.item.url] : [];
  if (!urls.length) return;
  try {
    await navigator.clipboard.writeText(urls.join("\n"));
    toast(urls.length > 1 ? `Copied ${urls.length} URLs` : "URL copied");
  } catch {
    toast("Clipboard unavailable");
  }
}

async function undoClose() {
  try {
    const [last] = await browser.sessions.getRecentlyClosed({ maxResults: 1 });
    if (!last) { toast("Nothing to reopen"); return; }
    await browser.sessions.restore((last.tab ?? last.window).sessionId);
    state.closed = null;
    toast("Reopened");
    await refresh();
  } catch (err) {
    toast(String(err.message || err));
  }
}

function toggleMark(entry = selectedEntry(), advance = true) {
  if (!entry || entry.kind !== "tab") return;
  const id = entry.item.id;
  if (state.marked.has(id)) state.marked.delete(id); else state.marked.add(id);
  const row = document.getElementById(`row-${state.entries.indexOf(entry)}`);
  row?.classList.toggle("marked", state.marked.has(id));
  els.app.classList.toggle("has-marks", state.marked.size > 0);
  if (advance) move(1); else updateFooter();
}

function markAll() {
  const visible = state.entries.filter((e) => e.kind === "tab");
  const allMarked = visible.length && visible.every((e) => state.marked.has(e.item.id));
  for (const e of visible) {
    if (allMarked) state.marked.delete(e.item.id); else state.marked.add(e.item.id);
  }
  render();
}

const handlers = {
  next: () => move(1),
  prev: () => move(-1),
  pageDown: () => move(pageSize()),
  pageUp: () => move(-pageSize()),
  first: () => { state.selected = 0; updateSelection(); updateFooter(); },
  last: () => { state.selected = Math.max(0, state.entries.length - 1); updateSelection(); updateFooter(); },
  open: () => openEntry(selectedEntry()),
  openNewTab: () => openEntry(selectedEntry(), "tab"),
  openNewWindow: () => openEntry(selectedEntry(), "window"),
  closeTab: () => closeSelected(),
  toggleMark: () => toggleMark(),
  markAll: () => markAll(),
  togglePin: () => forEachTarget((t) => browser.tabs.update(t.id, { pinned: !t.pinned }), (ts) => (ts[0].pinned ? "Unpinned" : "Pinned")),
  toggleMute: () => forEachTarget((t) => browser.tabs.update(t.id, { muted: !t.mutedInfo?.muted }), (ts) => (ts[0].mutedInfo?.muted ? "Unmuted" : "Muted")),
  reload: () => forEachTarget((t) => browser.tabs.reload(t.id), "Reloaded"),
  duplicate: () => forEachTarget((t) => browser.tabs.duplicate(t.id), "Duplicated"),
  moveHere: () => forEachTarget((t) => browser.tabs.move(t.id, { windowId: state.currentWindowId, index: -1 }), "Moved to this window"),
  discard: () => {
    if (targetTabs().some((t) => t.active)) toast("Active tabs can't be unloaded");
    return forEachTarget((t) => (t.active ? null : browser.tabs.discard(t.id)), "Unloaded");
  },
  copyUrl: () => copyUrls(),
  undoClose: () => undoClose(),
  clearQuery: () => setQuery(""),
  dismiss: () => {
    if (!els.help.hidden) return toggleHelp(false);
    finish();
  },
  openSettings: () => { browser.runtime.openOptionsPage(); finish(); },
  help: () => toggleHelp(),
};

// ─────────────────────────────── Events ───────────────────────────────

function onKeyDown(e) {
  if (e.isComposing) return;
  if (e.key === "Alt") els.app.classList.add("show-jump");

  const combo = comboFromEvent(e);
  if (!combo) return;
  let action = state.keymap.get(normalizeCombo(combo));

  // Alt+1…9 quick jump
  if (!action && state.s.quickJump && /^Alt\+[1-9]$/.test(combo)) {
    e.preventDefault();
    openEntry(state.entries[Number(combo.slice(-1)) - 1]);
    return;
  }
  // Accept the first filter suggestion with → at the end of the input
  if (!action && combo === "ArrowRight" && els.input.selectionStart === els.input.value.length) {
    const first = els.chips.querySelector(".chip.suggest");
    if (first) { e.preventDefault(); completeFilter(first.textContent.slice(1)); return; }
  }
  if (!action) return;
  if (!els.help.hidden && action !== "dismiss" && action !== "help") return;

  e.preventDefault();
  e.stopPropagation();
  handlers[action]?.();
}

let inputTimer = 0;
function onInput() {
  state.query = els.input.value;
  state.parsed = parseQuery(state.query, state.s.enableFilters);
  if (state.s.keepQuery) browser.storage.local.set({ lastQuery: state.query }).catch(() => {});
  // keep typing snappy on huge tab counts by coalescing keystrokes into one frame
  cancelAnimationFrame(inputTimer);
  inputTimer = requestAnimationFrame(() => recompute());
}

function rowIndexFrom(target) {
  const row = target.closest?.(".row");
  return row ? Number(row.dataset.index) : -1;
}

function bindEvents() {
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", (e) => { if (e.key === "Alt") els.app.classList.remove("show-jump"); });
  window.addEventListener("blur", () => els.app.classList.remove("show-jump"));
  els.input.addEventListener("input", onInput);

  els.list.addEventListener("click", (e) => {
    const i = rowIndexFrom(e.target);
    if (i < 0) return;
    const entry = state.entries[i];
    if (e.target.closest("[data-act=close]")) {
      state.selected = i;
      if (entry.kind === "tab" && !state.marked.has(entry.item.id)) {
        browser.tabs.remove(entry.item.id).then(refresh);
      } else closeSelected();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.shiftKey) { toggleMark(entry, false); return; }
    openEntry(entry);
  });
  els.list.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    const i = rowIndexFrom(e.target);
    if (i < 0) return;
    e.preventDefault();
    const entry = state.entries[i];
    if (entry.kind === "tab") browser.tabs.remove(entry.item.id).then(refresh);
    else { state.selected = i; removeNonTab(entry); }
  });
  els.list.addEventListener("mousedown", (e) => {
    if (e.button === 1) e.preventDefault(); // no autoscroll
    // keep focus in the search box
    if (rowIndexFrom(e.target) >= 0) e.preventDefault();
  });
  els.list.addEventListener("mousemove", (e) => {
    if (!state.s.mouseHoverSelect) return;
    const i = rowIndexFrom(e.target);
    if (i >= 0 && i !== state.selected) { state.selected = i; updateSelection(false); updateFooter(); }
  });
  els.list.addEventListener("scroll", () => {
    const { scrollTop, scrollHeight, clientHeight } = els.list;
    if (scrollTop + clientHeight > scrollHeight - 400) renderMore(state.rendered + CHUNK);
  }, { passive: true });

  $("#settingsBtn").addEventListener("click", handlers.openSettings);
  $("#helpBtn").addEventListener("click", () => toggleHelp());
  $("#helpClose").addEventListener("click", () => toggleHelp(false));

  let refreshTimer = 0;
  const scheduleRefresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 120); };
  browser.tabs.onRemoved.addListener(scheduleRefresh);
  browser.tabs.onCreated.addListener(scheduleRefresh);
  browser.tabs.onUpdated.addListener(scheduleRefresh, { properties: ["title", "favIconUrl", "pinned", "audible", "mutedInfo", "discarded", "url"] });

  browser.storage.onChanged.addListener((changes) => {
    if (changes.settings) location.reload();
  });
}

function applyLayout(s) {
  applyTheme(s);
  // Firefox caps popups at 800×600
  els.root.style.setProperty("--popup-width", `${Math.min(800, Math.max(380, s.popupWidth))}px`);
  els.root.style.setProperty("--popup-height", `${Math.min(600, Math.max(300, s.popupHeight))}px`);
  els.input.placeholder = "Search tabs…";
}

async function init() {
  hydrateIcons();
  bindEvents();

  // Load settings, tabs, windows, containers, permissions, and stored query all in parallel
  const [s, tabsData, containers, perms, lastQueryRes] = await Promise.all([
    loadSettings(),
    queryTabsData(),
    queryContainers(),
    queryPermissions(),
    browser.storage.local.get("lastQuery").catch(() => ({})),
  ]);

  state.s = s;
  state.keymap = buildKeymap(state.s.keys);
  applyLayout(state.s);

  state.containers = containers;
  state.perms = perms;
  applyTabsData(tabsData);

  if (state.s.keepQuery && lastQueryRes?.lastQuery) {
    const lastQuery = lastQueryRes.lastQuery;
    els.input.value = lastQuery;
    state.query = lastQuery;
    state.parsed = parseQuery(lastQuery, state.s.enableFilters);
  }

  recompute();
  // Firefox popups sometimes ignore autofocus
  els.input.focus();
  els.input.select();
  setTimeout(() => els.input.focus(), 50);
}

init();
