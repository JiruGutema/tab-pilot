// Settings schema, defaults and persistence shared by the popup and options page.

export const ACTIONS = {
  next:          { label: "Select next result",                 group: "Navigation" },
  prev:          { label: "Select previous result",             group: "Navigation" },
  pageDown:      { label: "Jump down one page",                 group: "Navigation" },
  pageUp:        { label: "Jump up one page",                   group: "Navigation" },
  first:         { label: "Jump to first result",               group: "Navigation" },
  last:          { label: "Jump to last result",                group: "Navigation" },
  open:          { label: "Switch to / open result",            group: "Actions" },
  openNewTab:    { label: "Open result in a new tab",           group: "Actions" },
  openNewWindow: { label: "Open result in a new window",        group: "Actions" },
  closeTab:      { label: "Close tab (or all marked tabs)",     group: "Actions" },
  toggleMark:    { label: "Mark / unmark result",               group: "Actions" },
  markAll:       { label: "Mark / unmark all visible tabs",     group: "Actions" },
  togglePin:     { label: "Pin / unpin tab",                    group: "Actions" },
  toggleMute:    { label: "Mute / unmute tab",                  group: "Actions" },
  reload:        { label: "Reload tab",                         group: "Actions" },
  duplicate:     { label: "Duplicate tab",                      group: "Actions" },
  moveHere:      { label: "Move tab to the current window",     group: "Actions" },
  discard:       { label: "Unload tab from memory",             group: "Actions" },
  copyUrl:       { label: "Copy URL",                           group: "Actions" },
  undoClose:     { label: "Reopen the last closed tab",         group: "Actions" },
  clearQuery:    { label: "Clear search",                       group: "Popup" },
  dismiss:       { label: "Close the popup",                    group: "Popup" },
  openSettings:  { label: "Open settings",                      group: "Popup" },
  help:          { label: "Show help & search syntax",          group: "Popup" },
};

export const DEFAULT_KEYS = {
  next:          ["ArrowDown", "Tab", "Alt+N", "Ctrl+J"],
  prev:          ["ArrowUp", "Shift+Tab", "Alt+P", "Ctrl+K"],
  pageDown:      ["PageDown", "Ctrl+F"],
  pageUp:        ["PageUp", "Ctrl+B"],
  first:         ["Ctrl+Home", "Alt+Home"],
  last:          ["Ctrl+End", "Alt+End"],
  open:          ["Enter"],
  openNewTab:    ["Ctrl+Enter"],
  openNewWindow: ["Shift+Enter"],
  closeTab:      ["Ctrl+D", "Shift+Delete"],
  toggleMark:    ["Ctrl+Space", "Alt+X"],
  markAll:       ["Alt+A"],
  togglePin:     ["Alt+Shift+P"],
  toggleMute:    ["Alt+M"],
  reload:        ["Alt+R"],
  duplicate:     ["Alt+D"],
  moveHere:      ["Alt+W"],
  discard:       ["Alt+U"],
  copyUrl:       ["Alt+C"],
  undoClose:     ["Alt+Z"],
  clearQuery:    ["Ctrl+L"],
  dismiss:       ["Escape"],
  openSettings:  ["Ctrl+,"],
  help:          ["F1", "Ctrl+/"],
};

export const DEFAULTS = {
  // Appearance
  theme: "auto",              // auto | light | dark
  accent: "#0060df",
  density: "comfortable",     // compact | comfortable | spacious
  fontScale: 100,             // percent
  popupWidth: 640,
  popupHeight: 520,
  showUrl: true,
  urlStyle: "host",           // host | full
  showFavicons: true,
  showBadges: true,           // pinned / audio / container / window badges
  showLastAccessed: true,
  showFooter: true,
  showCounts: true,
  animations: true,

  // Search
  matchMode: "words",         // fuzzy | words | exact
  caseSensitivity: "smart",   // smart | insensitive | sensitive
  searchUrls: true,
  titleWeight: 2,             // 1..3 — how much more a title match counts than a URL match
  recencyBoost: 30,           // 0..100 — how much recent use influences ranking
  enableFilters: true,        // @pinned, site:, !negation …

  // Sources
  scope: "all",               // all | current — which windows' tabs to list
  sourceClosed: true,
  sourceBookmarks: false,
  sourceHistory: false,
  maxClosed: 10,
  maxBookmarks: 10,
  maxHistory: 15,
  otherSourcesOnEmpty: false, // show closed/bookmarks/history before typing

  // Ordering & behavior
  sortEmpty: "mru",           // mru | tabOrder — ordering when query is empty
  currentTab: "last",         // inPlace | last | hide
  groupByWindow: true,        // window headers when listing in tab order
  selectPrevious: false,      // with an empty query, preselect the 2nd result (alt-tab style)
  closeAfterAction: false,    // close popup after pin/mute/etc.
  keepQuery: false,           // restore the last query when reopening
  wrapAround: true,           // navigation wraps at list ends
  mouseHoverSelect: false,    // hovering a row selects it
  quickJump: true,            // Alt+1…9 opens the Nth result
  switchToExisting: true,
  openLinksIn: "newTab",      // newTab | currentTab — for bookmarks / history results
  webSearchFallback: true,    // offer "Search the web" when nothing matches
  showHiddenTabs: false,      // include tabs hidden by other extensions     // bookmarks / history: switch to an open tab with that URL instead of opening a duplicate

  keys: DEFAULT_KEYS,
};

const STORAGE_KEY = "settings";

function storageArea() {
  // sync follows the user across devices; fall back to local if unavailable
  return browser.storage.sync ?? browser.storage.local;
}

export function mergeSettings(stored) {
  const s = { ...DEFAULTS, ...(stored || {}) };
  s.keys = { ...DEFAULT_KEYS, ...((stored && stored.keys) || {}) };
  for (const k of Object.keys(s.keys)) if (!(k in ACTIONS)) delete s.keys[k];
  return s;
}

export async function loadSettings() {
  try {
    // Fast path: read from local storage first (<5ms, avoids Firefox Sync IPC latency)
    const local = await browser.storage.local.get(STORAGE_KEY);
    if (local && local[STORAGE_KEY]) return mergeSettings(local[STORAGE_KEY]);

    // Fallback: check sync storage (e.g. first run on a new device)
    if (browser.storage.sync) {
      const sync = await browser.storage.sync.get(STORAGE_KEY);
      if (sync && sync[STORAGE_KEY]) {
        browser.storage.local.set({ [STORAGE_KEY]: sync[STORAGE_KEY] }).catch(() => {});
        return mergeSettings(sync[STORAGE_KEY]);
      }
    }
    return mergeSettings(null);
  } catch {
    return mergeSettings(null);
  }
}

/** Persist only the values that differ from the defaults, keeping sync storage small. */
export async function saveSettings(settings) {
  const diff = {};
  for (const [k, v] of Object.entries(settings)) {
    if (k === "keys") continue;
    if (JSON.stringify(v) !== JSON.stringify(DEFAULTS[k])) diff[k] = v;
  }
  const keyDiff = {};
  for (const [action, combos] of Object.entries(settings.keys || {})) {
    if (JSON.stringify(combos) !== JSON.stringify(DEFAULT_KEYS[action])) keyDiff[action] = combos;
  }
  if (Object.keys(keyDiff).length) diff.keys = keyDiff;

  // Always write immediately to local storage for instant access
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: diff });
  } catch { /* ignore */ }

  // Mirror to sync storage across devices in the background
  if (browser.storage.sync) {
    browser.storage.sync.set({ [STORAGE_KEY]: diff }).catch(() => {});
  }
}

export function applyTheme(settings, root = document.documentElement) {
  root.dataset.theme = settings.theme;
  root.dataset.density = settings.density;
  root.dataset.animations = settings.animations ? "on" : "off";
  root.style.setProperty("--accent", settings.accent);
  root.style.setProperty("--font-scale", String(settings.fontScale / 100));
}
