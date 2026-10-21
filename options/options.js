import { ACTIONS, DEFAULTS, DEFAULT_KEYS, loadSettings, saveSettings, mergeSettings, applyTheme } from "../shared/settings.js";
import { comboFromEvent, comboCaps, normalizeCombo, comboLabel, isReservedCombo } from "../shared/keys.js";
import { icon, hydrateIcons } from "../shared/icons.js";

const $ = (sel) => document.querySelector(sel);
let settings = null;

const ACCENTS = ["#0060df", "#0a84ff", "#059669", "#d97706", "#dc2626", "#7c3aed", "#475569", "#24292f"];

// ─────────────────────────────── Schema ───────────────────────────────

const SECTIONS = [
  {
    id: "appearance", title: "Appearance", icon: "window", desc: "Make the popup look the way you like.",
    preview: true,
    items: [
      { key: "theme", type: "segmented", label: "Theme", options: [["auto", "System"], ["light", "Light"], ["dark", "Dark"]] },
      { key: "accent", type: "accent", label: "Accent color" },
      { key: "density", type: "segmented", label: "Density", desc: "Compact puts the URL next to the title.", options: [["compact", "Compact"], ["comfortable", "Comfortable"], ["spacious", "Spacious"]] },
      { key: "fontScale", type: "range", label: "Text size", min: 80, max: 130, step: 5, unit: "%" },
      { key: "popupWidth", type: "range", label: "Popup width", min: 400, max: 800, step: 20, unit: "px" },
      { key: "popupHeight", type: "range", label: "Popup height", min: 320, max: 600, step: 20, unit: "px", desc: "Firefox limits popups to 800 × 600." },
      { key: "showUrl", type: "toggle", label: "Show URL line" },
      { key: "urlStyle", type: "select", label: "URL format", parent: "showUrl", desc: "Full URLs are always shown when your search matched part of the path.", options: [["host", "Domain only"], ["full", "Full URL"]] },
      { key: "showFavicons", type: "toggle", label: "Show favicons" },
      { key: "showBadges", type: "toggle", label: "Show badges", desc: "Pinned, audio, muted, unloaded, duplicate, container and window indicators." },
      { key: "showLastAccessed", type: "toggle", label: "Show time since last used" },
      { key: "showCounts", type: "toggle", label: "Show result count" },
      { key: "showFooter", type: "toggle", label: "Show keyboard hints footer" },
      { key: "animations", type: "toggle", label: "Animations" },
    ],
  },
  {
    id: "search", title: "Search", icon: "search", desc: "Tune how results are matched and ranked.",
    items: [
      { key: "matchMode", type: "segmented", label: "Matching", desc: "<b>Fuzzy</b>: letters in order with gaps allowed (<code>ghpr</code> → GitHub pull requests). <b>Words</b>: each word must appear. <b>Exact</b>: the whole query must appear.", options: [["fuzzy", "Fuzzy"], ["words", "Words"], ["exact", "Exact"]] },
      { key: "caseSensitivity", type: "select", label: "Case sensitivity", desc: "Smart case: lowercase ignores case, any uppercase letter makes that word case-sensitive.", options: [["smart", "Smart case"], ["insensitive", "Ignore case"], ["sensitive", "Case-sensitive"]] },
      { key: "searchUrls", type: "toggle", label: "Search in URLs", desc: "Match against the address as well as the title." },
      { key: "titleWeight", type: "range", label: "Title priority", min: 1, max: 3, step: 0.25, unit: "×", desc: "How much more a title match counts than a URL match." },
      { key: "recencyBoost", type: "range", label: "Recency boost", min: 0, max: 100, step: 5, unit: "%", desc: "Rank recently used tabs higher among similar matches." },
      { key: "enableFilters", type: "toggle", label: "Search filters", desc: "Enable <code>@pinned</code> <code>@audio</code> <code>@dup</code> <code>@here</code> <code>@closed</code> <code>site:</code> <code>in:</code> <code>!exclude</code> and <code>\"exact\"</code>." },
    ],
  },
  {
    id: "sources", title: "Sources", icon: "star", desc: "Choose what appears in results besides your open tabs.",
    items: [
      { key: "scope", type: "segmented", label: "Tabs from", options: [["all", "All windows"], ["current", "Current window"]], desc: "Type <code>@here</code> to limit a single search to the current window." },
      { key: "sourceClosed", type: "toggle", label: "Recently closed tabs", desc: "Restore closed tabs and windows with their history." },
      { key: "maxClosed", type: "number", label: "Max closed results", parent: "sourceClosed", min: 1, max: 25 },
      { key: "sourceBookmarks", type: "toggle", label: "Bookmarks", perm: "bookmarks", desc: "Requires permission to read bookmarks." },
      { key: "maxBookmarks", type: "number", label: "Max bookmark results", parent: "sourceBookmarks", min: 1, max: 50 },
      { key: "sourceHistory", type: "toggle", label: "History", perm: "history", desc: "Requires permission to read browsing history." },
      { key: "maxHistory", type: "number", label: "Max history results", parent: "sourceHistory", min: 1, max: 50 },
      { key: "otherSourcesOnEmpty", type: "toggle", label: "Show other sources before typing", desc: "Otherwise closed tabs, bookmarks and history appear only once you search." },
      { key: "webSearchFallback", type: "toggle", label: "Offer web search when nothing matches", desc: "Uses your default search engine." },
      { key: "showHiddenTabs", type: "toggle", label: "Include hidden tabs", desc: "Tabs hidden by other extensions (e.g. tab-group managers)." },
    ],
  },
  {
    id: "behavior", title: "Behavior", icon: "settings", desc: "Ordering, selection and what happens after actions.",
    items: [
      { key: "sortEmpty", type: "segmented", label: "Order before typing", options: [["mru", "Recently used"], ["tabOrder", "Tab order"]] },
      { key: "groupByWindow", type: "toggle", label: "Group by window", parent: "sortEmpty", when: (s) => s.sortEmpty === "tabOrder" && s.scope === "all", desc: "Show a header for each window when listing in tab order." },
      { key: "currentTab", type: "select", label: "Current tab", options: [["last", "Move to bottom"], ["inPlace", "Keep in place"], ["hide", "Hide"]] },
      { key: "selectPrevious", type: "toggle", label: "Preselect previous tab", desc: "Like Alt-Tab: open the popup and press Enter to jump back to the last tab. (Most useful with \"Current tab: Keep in place\".)" },
      { key: "wrapAround", type: "toggle", label: "Wrap around", desc: "Moving past the last result returns to the first." },
      { key: "quickJump", type: "toggle", label: "Quick jump with Alt+1…9", desc: "Hold Alt to see the numbers." },
      { key: "mouseHoverSelect", type: "toggle", label: "Select on mouse hover" },
      { key: "closeAfterAction", type: "toggle", label: "Close popup after tab actions", desc: "Pin, mute, reload, etc. Otherwise the popup stays open so you can keep going." },
      { key: "keepQuery", type: "toggle", label: "Remember last search", desc: "Reopen with the previous query (selected, so typing replaces it)." },
      { key: "switchToExisting", type: "toggle", label: "Prefer open tabs", desc: "Opening a bookmark or history entry that is already open switches to that tab." },
      { key: "openLinksIn", type: "segmented", label: "Open bookmarks & history in", options: [["newTab", "New tab"], ["currentTab", "Current tab"]] },
    ],
  },
];

const NAV = [
  { id: "sec-shortcut", title: "Shortcut", icon: "keyboard" },
  ...SECTIONS.map((s) => ({ id: `sec-${s.id}`, title: s.title, icon: s.icon })),
  { id: "sec-keys", title: "Key bindings", icon: "keyboard" },
  { id: "sec-backup", title: "Backup", icon: "copy" },
];

// ─────────────────────────────── Helpers ───────────────────────────────

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Tiny safe formatter for descriptions: supports <b> and <code> only. */
function richText(str) {
  const frag = document.createDocumentFragment();
  const re = /<(b|code)>(.*?)<\/\1>/g;
  let last = 0, m;
  while ((m = re.exec(str))) {
    frag.append(str.slice(last, m.index), el(m[1] === "b" ? "strong" : "code", null, m[2]));
    last = re.lastIndex;
  }
  frag.append(str.slice(last));
  return frag;
}

function kbdCaps(combo) {
  const g = el("span", "kbd-group");
  for (const cap of comboCaps(combo)) g.append(el("kbd", null, cap));
  return g;
}

let toastTimer = 0;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

let saveTimer = 0;
function persist() {
  applyTheme(settings);
  updatePreview();
  updateDependents();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await saveSettings(settings);
    const s = $("#saveState");
    s.textContent = "✓ Saved";
    s.classList.add("show");
    setTimeout(() => s.classList.remove("show"), 1400);
  }, 200);
}

function set(key, value) {
  settings[key] = value;
  persist();
}

// ─────────────────────────────── Controls ───────────────────────────────

function toggleControl(item) {
  const wrap = el("label", "switch");
  const input = el("input");
  input.type = "checkbox";
  input.checked = !!settings[item.key];
  input.setAttribute("aria-label", item.label);
  input.addEventListener("change", () => {
    if (item.perm && input.checked) {
      // permissions.request must be called synchronously from the user gesture
      browser.permissions.request({ permissions: [item.perm] }).then((granted) => {
        if (!granted) { input.checked = false; toast("Permission not granted"); return; }
        set(item.key, true);
      });
      return;
    }
    set(item.key, input.checked);
  });
  wrap.append(input, el("span", "track"));
  return wrap;
}

function segmentedControl(item) {
  const wrap = el("div", "segmented");
  wrap.setAttribute("role", "group");
  for (const [value, label] of item.options) {
    const b = el("button", null, label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(settings[item.key] === value));
    b.addEventListener("click", () => {
      for (const x of wrap.children) x.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-pressed", "true");
      set(item.key, value);
    });
    wrap.append(b);
  }
  return wrap;
}

function selectControl(item) {
  const sel = el("select");
  for (const [value, label] of item.options) {
    const o = el("option", null, label);
    o.value = value;
    sel.append(o);
  }
  sel.value = settings[item.key];
  sel.addEventListener("change", () => set(item.key, sel.value));
  return sel;
}

function rangeControl(item) {
  const frag = document.createDocumentFragment();
  const input = el("input");
  input.type = "range";
  Object.assign(input, { min: item.min, max: item.max, step: item.step });
  input.value = settings[item.key];
  const out = el("span", "range-value");
  const show = () => { out.textContent = `${input.value}${item.unit === "×" ? "×" : ` ${item.unit}`}`.replace(" %", "%"); };
  show();
  input.addEventListener("input", () => { show(); set(item.key, Number(input.value)); });
  frag.append(input, out);
  return frag;
}

function numberControl(item) {
  const input = el("input");
  input.type = "number";
  Object.assign(input, { min: item.min, max: item.max, step: 1 });
  input.value = settings[item.key];
  input.addEventListener("change", () => {
    const v = Math.max(item.min, Math.min(item.max, Math.round(Number(input.value) || item.min)));
    input.value = v;
    set(item.key, v);
  });
  return input;
}

function accentControl(item) {
  const wrap = el("div", "swatches");
  const refresh = () => {
    for (const b of wrap.querySelectorAll(".swatch")) b.setAttribute("aria-pressed", String(b.dataset.color === settings.accent));
  };
  for (const c of ACCENTS) {
    const b = el("button", "swatch");
    b.type = "button";
    b.dataset.color = c;
    b.style.background = c;
    b.title = c;
    b.addEventListener("click", () => { set(item.key, c); custom.value = c; refresh(); });
    wrap.append(b);
  }
  const customWrap = el("label", "swatch-custom");
  customWrap.title = "Custom color";
  const custom = el("input");
  custom.type = "color";
  custom.value = settings.accent;
  custom.addEventListener("input", () => { set(item.key, custom.value); refresh(); });
  customWrap.append(custom);
  wrap.append(customWrap);
  refresh();
  return wrap;
}

const CONTROL_BUILDERS = {
  toggle: toggleControl, segmented: segmentedControl, select: selectControl,
  range: rangeControl, number: numberControl, accent: accentControl,
};

function settingRow(item) {
  const row = el("div", "setting");
  row.dataset.key = item.key;
  if (item.parent) row.classList.add("child");
  const left = el("div");
  left.append(el("div", "setting-label", item.label));
  if (item.desc) {
    const d = el("div", "setting-desc");
    d.append(richText(item.desc));
    left.append(d);
  }
  const control = el("div", "control");
  control.append(CONTROL_BUILDERS[item.type](item));
  row.append(left, control);
  return row;
}

function updateDependents() {
  for (const sec of SECTIONS) {
    for (const item of sec.items) {
      if (!item.parent) continue;
      const row = document.querySelector(`.setting[data-key="${item.key}"]`);
      const enabled = item.when ? item.when(settings) : !!settings[item.parent];
      row?.classList.toggle("disabled", !enabled);
    }
  }
}

// ─────────────────────────────── Preview ───────────────────────────────

function previewRow({ title, url, letter, hue, badges = [], time, selected, discarded }) {
  const row = el("div", "row");
  if (selected) row.classList.add("selected");
  if (discarded) row.classList.add("discarded");
  const fav = el("div", "fav letter", letter);
  fav.style.background = `hsl(${hue} 55% 52%)`;
  const text = el("div", "text");
  const t = el("div", "title");
  for (const part of title) t.append(Array.isArray(part) ? el("mark", null, part[0]) : part);
  const u = el("div", "url");
  for (const part of url) u.append(Array.isArray(part) ? el("mark", null, part[0]) : part);
  text.append(t, u);
  const meta = el("div", "meta");
  for (const b of badges) meta.append(b);
  if (time) meta.append(el("span", "time", time));
  row.append(fav, text, meta);
  return row;
}

function previewBadge(cls, iconName, text) {
  const b = el("span", `badge ${cls}${text ? "" : " icon-only"}`);
  if (iconName) b.append(icon(iconName, 12));
  if (text) b.append(text);
  return b;
}

function buildPreview() {
  const box = el("div", "preview");
  const app = el("div", "app");
  const bar = el("header", "searchbar");
  bar.append(icon("search", 18, "search-icon"));
  const input = el("input");
  input.id = "q";
  input.value = "gh pr";
  input.readOnly = true;
  input.tabIndex = -1;
  bar.append(input, el("span", "count", "3 / 42"));
  const list = el("div", "list");
  const container = previewBadge("container", null, null);
  container.classList.remove("icon-only");
  const dot = el("span", "dot");
  dot.style.background = "#37adff";
  container.append(dot, "Work");
  container.style.color = "#37adff";
  list.append(
    previewRow({ title: [["G"], "it", ["H"], "ub · ", ["P"], "ull ", ["r"], "equests"], url: ["github.com/mozilla/gecko-dev/pulls"], letter: "G", hue: 250, badges: [previewBadge("pinned", "pin")], time: "2m", selected: true }),
    previewRow({ title: ["Fix ", ["gh"], "ost ", ["pr"], "ocess leak"], url: ["bugzilla.mozilla.org"], letter: "B", hue: 20, badges: [container], time: "1h" }),
    previewRow({ title: [["G"], "rap", ["h"], " ", ["pr"], "imer – MDN"], url: ["developer.mozilla.org"], letter: "D", hue: 200, badges: [previewBadge("discarded", "moon")], time: "3d", discarded: true }),
  );
  const footer = el("footer", "footer");
  const hint = (combos, label) => {
    const h = el("span", "hint");
    for (const c of combos) h.append(kbdCaps(c));
    h.append(label);
    footer.append(h);
  };
  hint(["ArrowDown", "ArrowUp"], "navigate");
  hint(["Enter"], "switch");
  hint(["Ctrl+D"], "close");
  app.append(bar, list, footer);
  box.append(app);
  return box;
}

function updatePreview() {
  const p = document.querySelector(".preview");
  if (!p) return;
  p.dataset.showUrl = settings.showUrl;
  p.dataset.showFavicons = settings.showFavicons;
  p.dataset.showBadges = settings.showBadges;
  p.dataset.showTime = settings.showLastAccessed;
  p.dataset.showFooter = settings.showFooter;
  p.dataset.showCounts = settings.showCounts;
  p.style.maxWidth = `${settings.popupWidth}px`;
}

// ─────────────────────────────── Global shortcuts ───────────────────────────────

const FIREFOX_KEYS = {
  ",": "Comma", ".": "Period", " ": "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert", Delete: "Delete",
};

/** Convert a keydown into Firefox's commands shortcut syntax, or null if not allowed. */
function firefoxShortcut(e) {
  let key = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1[0-2])$/.test(e.key)) key = e.key;
  else if (e.code === "Space") key = "Space";
  else key = FIREFOX_KEYS[e.key] ?? null;
  if (!key) return null;
  const mods = [];
  const isMac = /Mac/.test(navigator.platform);
  if (e.ctrlKey) mods.push(isMac ? "MacCtrl" : "Ctrl");
  if (e.metaKey) mods.push(isMac ? "Command" : null);
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  const clean = mods.filter(Boolean);
  const primary = clean.some((m) => m !== "Shift");
  if (!primary && !/^F\d+$/.test(key)) return null;
  return [...clean, key].join("+");
}

async function renderCommands() {
  const box = $("#commands");
  box.textContent = "";
  let commands = [];
  try { commands = await browser.commands.getAll(); } catch { /* ignore */ }
  for (const cmd of commands) {
    const row = el("div", "command-row");
    const left = el("div");
    left.append(el("div", "setting-label", cmd.name === "_execute_action" ? "Open search popup" : cmd.description || cmd.name));
    if (cmd.name === "previous-tab") left.append(el("div", "setting-desc", "Jump straight back to the last tab you used, without opening the popup."));
    const right = el("div", "key-list");
    const shortcutDisplay = el("span", "kbd-group");
    if (cmd.shortcut) {
      for (const p of cmd.shortcut.split("+")) shortcutDisplay.append(el("kbd", null, p));
    } else {
      shortcutDisplay.append(el("span", "setting-desc", "Not set"));
    }
    const change = el("button", "btn", "Change");
    change.type = "button";
    change.addEventListener("click", () => recordCommand(cmd, change));
    const reset = el("button", "btn", "Reset");
    reset.type = "button";
    reset.addEventListener("click", async () => { await browser.commands.reset(cmd.name); renderCommands(); toast("Shortcut reset"); });
    right.append(shortcutDisplay, change, reset);
    row.append(left, right);
    box.append(row);
  }
}

function recordCommand(cmd, button) {
  button.textContent = "Press shortcut…";
  button.classList.add("primary");
  const onKey = async (e) => {
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    window.removeEventListener("keydown", onKey, true);
    if (e.key === "Escape") { renderCommands(); return; }
    const shortcut = firefoxShortcut(e);
    if (!shortcut) {
      toast("Use Ctrl or Alt plus a letter, number, F-key or arrow");
      renderCommands();
      return;
    }
    try {
      await browser.commands.update({ name: cmd.name, shortcut });
      toast(`Shortcut set to ${shortcut}`);
    } catch (err) {
      toast(`Couldn't set shortcut: ${err.message || err}`);
    }
    renderCommands();
  };
  window.addEventListener("keydown", onKey, true);
}

// ─────────────────────────────── Popup key bindings ───────────────────────────────

let recording = null; // { action, button }

function renderKeys() {
  const box = $("#keys");
  box.textContent = "";
  const groups = {};
  for (const [action, meta] of Object.entries(ACTIONS)) (groups[meta.group] ??= []).push([action, meta]);
  for (const [group, list] of Object.entries(groups)) {
    box.append(el("h3", null, group));
    for (const [action, meta] of list) {
      const row = el("div", "key-row");
      const combos = settings.keys[action] ?? [];
      if (JSON.stringify(combos) !== JSON.stringify(DEFAULT_KEYS[action])) row.classList.add("modified");
      row.append(el("div", "key-label", meta.label));
      const keys = el("div", "key-list");
      for (const c of combos) {
        const chip = el("span", "key-chip");
        chip.append(kbdCaps(c));
        const rm = el("button");
        rm.type = "button";
        rm.title = `Remove ${comboLabel(c)}`;
        rm.append(icon("x", 12));
        rm.addEventListener("click", () => {
          settings.keys = { ...settings.keys, [action]: combos.filter((x) => x !== c) };
          persist();
          renderKeys();
        });
        chip.append(rm);
        keys.append(chip);
      }
      const add = el("button", "key-add", "+");
      add.type = "button";
      add.title = "Add key binding";
      add.addEventListener("click", () => startRecording(action, add));
      keys.append(add);
      if (row.classList.contains("modified")) {
        const reset = el("button", "key-reset");
        reset.type = "button";
        reset.title = "Reset to default";
        reset.append(icon("undo", 14));
        reset.addEventListener("click", () => {
          settings.keys = { ...settings.keys, [action]: [...DEFAULT_KEYS[action]] };
          persist();
          renderKeys();
        });
        keys.append(reset);
      }
      row.append(keys);
      box.append(row);
    }
  }
}

function startRecording(action, button) {
  stopRecording();
  recording = { action, button };
  button.textContent = "Press keys… (click to cancel)";
  button.classList.add("recording");
  button.addEventListener("click", stopRecording, { once: true });
}

function stopRecording() {
  if (!recording) return;
  const { button } = recording;
  recording = null;
  button.textContent = "+";
  button.classList.remove("recording");
  renderKeys();
}

function onRecordKey(e) {
  if (!recording) return;
  const combo = comboFromEvent(e);
  if (!combo) return; // bare modifier
  e.preventDefault();
  e.stopPropagation();
  const norm = normalizeCombo(combo);
  const { action } = recording;

  // plain printable keys would make typing a search impossible
  if (/^(Shift\+)?.$/.test(norm) || norm === "Space" || norm === "Backspace" || norm === "Shift+Space") {
    toast("Add a modifier (Ctrl / Alt) so the key can still be typed in the search box");
    return;
  }
  if (isReservedCombo(norm) && !(action === "dismiss" && norm === "Escape")) {
    toast(`${comboLabel(norm)} is reserved by Firefox and never reaches the popup`);
    return;
  }
  const keys = { ...settings.keys };
  for (const [other, combos] of Object.entries(keys)) {
    if (other !== action && combos.some((c) => normalizeCombo(c) === norm)) {
      keys[other] = combos.filter((c) => normalizeCombo(c) !== norm);
      toast(`${comboLabel(norm)} moved from “${ACTIONS[other].label}”`);
    }
  }
  if (!keys[action].some((c) => normalizeCombo(c) === norm)) keys[action] = [...keys[action], norm];
  settings.keys = keys;
  recording = null;
  persist();
  renderKeys();
}

// ─────────────────────────────── Backup ───────────────────────────────

function bindBackup() {
  $("#export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
    const a = el("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tab-pilot-settings.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (typeof data !== "object" || Array.isArray(data)) throw new Error("not a settings object");
      const clean = {};
      for (const k of Object.keys(DEFAULTS)) if (k in data && typeof data[k] === typeof DEFAULTS[k]) clean[k] = data[k];
      settings = mergeSettings(clean);
      await saveSettings(settings);
      renderAll();
      toast("Settings imported");
    } catch (err) {
      toast(`Import failed: ${err.message}`);
    }
    e.target.value = "";
  });
  $("#resetAll").addEventListener("click", async () => {
    if (!confirm("Reset all Tab Pilot settings and key bindings to their defaults?")) return;
    settings = mergeSettings({});
    await saveSettings(settings);
    renderAll();
    toast("Everything reset to defaults");
  });
  $("#resetKeys").addEventListener("click", () => {
    settings.keys = structuredClone(DEFAULT_KEYS);
    persist();
    renderKeys();
    toast("Key bindings reset");
  });
}

// ─────────────────────────────── Layout ───────────────────────────────

function renderSections() {
  const box = $("#sections");
  box.textContent = "";
  for (const sec of SECTIONS) {
    const card = el("section", "card");
    card.id = `sec-${sec.id}`;
    const head = el("div", "card-head");
    head.append(el("h2", null, sec.title), el("p", null, sec.desc));
    card.append(head);
    if (sec.preview) card.append(buildPreview());
    for (const item of sec.items) card.append(settingRow(item));
    box.append(card);
  }
}

function renderNav() {
  const nav = $("#nav");
  nav.textContent = "";
  for (const n of NAV) {
    const a = el("a");
    a.href = `#${n.id}`;
    a.append(icon(n.icon, 16), n.title);
    nav.append(a);
  }
  const links = [...nav.querySelectorAll("a")];
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const l of links) l.classList.toggle("active", l.getAttribute("href") === `#${entry.target.id}`);
    }
  }, { rootMargin: "-20% 0px -70% 0px" });
  for (const n of NAV) {
    const target = document.getElementById(n.id);
    if (target) observer.observe(target);
  }
}

async function syncPermissionToggles() {
  // if the user revoked a permission in about:addons, reflect it here
  try {
    const { permissions } = await browser.permissions.getAll();
    let changed = false;
    if (settings.sourceBookmarks && !permissions.includes("bookmarks")) { settings.sourceBookmarks = false; changed = true; }
    if (settings.sourceHistory && !permissions.includes("history")) { settings.sourceHistory = false; changed = true; }
    if (changed) await saveSettings(settings);
  } catch { /* ignore */ }
}

function renderAll() {
  applyTheme(settings);
  renderSections();
  renderKeys();
  renderNav();
  updatePreview();
  updateDependents();
}

async function init() {
  hydrateIcons();
  settings = await loadSettings();
  await syncPermissionToggles();
  $("#version").textContent = `Version ${browser.runtime.getManifest().version}`;
  renderAll();
  renderCommands();
  bindBackup();
  window.addEventListener("keydown", onRecordKey, true);
  window.addEventListener("click", (e) => {
    if (recording && !e.target.closest(".key-add")) stopRecording();
  });
}

init();
