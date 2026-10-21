// Minimal in-memory mock of the WebExtension APIs used by Tab Pilot, for previewing the
// popup/options pages in a normal browser tab. Query params:
//   ?q=text          prefill search     ?settings={json}   override settings
//   ?keys=a,b,c      key combos to press after load (e.g. Ctrl+N,Ctrl+N)
(() => {
  const params = new URLSearchParams(location.search);
  const now = Date.now();
  const min = 60_000;
  const fav = (c) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='4' fill='${c}'/></svg>`)}`;
  let id = 1;
  const T = (windowId, title, url, extra = {}) => ({
    id: id++, windowId, title, url, index: 0, active: false, pinned: false, audible: false, discarded: false,
    hidden: false, incognito: false, mutedInfo: { muted: false }, cookieStoreId: "firefox-default",
    lastAccessed: now - id * 7 * min, favIconUrl: extra.fav ?? null, ...extra,
  });
  const tabs = [
    T(1, "Pull requests · mozilla/gecko-dev", "https://github.com/mozilla/gecko-dev/pulls", { pinned: true, fav: fav("#24292f"), lastAccessed: now - 2 * min }),
    T(1, "Tab Pilot — Settings", "moz-extension://abc/options/options.html", { active: true, lastAccessed: now }),
    T(1, "Inbox (3) - robel@example.com - Gmail", "https://mail.google.com/mail/u/0/#inbox", { fav: fav("#ea4335"), cookieStoreId: "firefox-container-1", lastAccessed: now - 60 * min }),
    T(1, "lofi hip hop radio 📚 - beats to relax/study to - YouTube", "https://www.youtube.com/watch?v=jfKfPfyJRdk", { audible: true, fav: fav("#ff0000"), lastAccessed: now - 15 * min }),
    T(1, "Array.prototype.map() - JavaScript | MDN", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map", { discarded: true, fav: fav("#000"), lastAccessed: now - 3 * 24 * 60 * min }),
    T(1, "Hacker News", "https://news.ycombinator.com/", { fav: fav("#ff6600"), lastAccessed: now - 4 * 60 * min }),
    T(2, "Fix ghost process leak in content process · Issue #4821", "https://github.com/mozilla/gecko-dev/issues/4821", { fav: fav("#24292f"), lastAccessed: now - 30 * min }),
    T(2, "Café Résumé — Notion", "https://www.notion.so/Cafe-Resume-8f2c", { fav: fav("#111"), lastAccessed: now - 5 * 60 * min }),
    T(2, "Hacker News", "https://news.ycombinator.com/", { fav: fav("#ff6600"), mutedInfo: { muted: true }, lastAccessed: now - 9 * 60 * min }),
    T(2, "Rust Playground", "https://play.rust-lang.org/", { cookieStoreId: "firefox-container-2", lastAccessed: now - 26 * 60 * min }),
    T(2, "about:config", "about:config", { lastAccessed: now - 40 * 60 * min }),
    T(1, "Stack Overflow - Where Developers Learn", "https://stackoverflow.com/questions", { fav: fav("#f48024"), lastAccessed: now - 8 * 24 * 60 * min }),
  ];
  tabs.forEach((t) => { t.index = tabs.filter((x) => x.windowId === t.windowId).indexOf(t); });

  const store = { settings: JSON.parse(params.get("settings") || "{}") };
  if (params.has("q")) { store.settings.keepQuery = true; store.lastQuery = params.get("q"); }
  // Hold the load event open (needs serve.py) so headless screenshots include scripted keys.
  if (params.has("keys") || params.has("wait")) {
    const img = document.createElement("img");
    img.src = `/__delay?ms=${params.get("wait") || 700}`;
    img.style.display = "none";
    document.documentElement.append(img);
  }
  const log = (window.__calls = []);
  const listeners = () => ({ addListener() {}, removeListener() {} });
  const area = {
    async get(k) { return typeof k === "string" ? { [k]: store[k] } : { ...store }; },
    async set(o) { Object.assign(store, o); },
  };

  window.browser = {
    tabs: {
      async query() { return tabs.map((t) => ({ ...t })); },
      async update(tid, props) { log.push(["tabs.update", tid, props]); const t = tabs.find((x) => x.id === tid); if (t) { if ("muted" in props) t.mutedInfo = { muted: props.muted }; Object.assign(t, props); } },
      async remove(ids) { log.push(["tabs.remove", ids]); for (const i of [].concat(ids)) tabs.splice(tabs.findIndex((t) => t.id === i), 1); },
      async duplicate(tid) { log.push(["tabs.duplicate", tid]); },
      async reload(tid) { log.push(["tabs.reload", tid]); },
      async discard(tid) { log.push(["tabs.discard", tid]); },
      async move(tid, p) { log.push(["tabs.move", tid, p]); },
      async create(p) { log.push(["tabs.create", p]); },
      onRemoved: listeners(), onCreated: listeners(), onUpdated: listeners(),
    },
    windows: {
      async getAll() { return [{ id: 1, incognito: false }, { id: 2, incognito: false }]; },
      async getCurrent() { return { id: 1, incognito: false }; },
      async update(wid, p) { log.push(["windows.update", wid, p]); },
      async create(p) { log.push(["windows.create", p]); },
    },
    contextualIdentities: {
      async query() {
        return [
          { cookieStoreId: "firefox-container-1", name: "Work", color: "blue", colorCode: "#37adff" },
          { cookieStoreId: "firefox-container-2", name: "Personal", color: "green", colorCode: "#51cd00" },
        ];
      },
    },
    sessions: {
      async getRecentlyClosed() {
        return [
          { lastModified: now - 3 * min, tab: { sessionId: "s1", windowId: 1, title: "Gecko build docs — Firefox Source Docs", url: "https://firefox-source-docs.mozilla.org/setup/" } },
          { lastModified: now - 50 * min, tab: { sessionId: "s2", windowId: 1, title: "GitHub Actions pricing", url: "https://github.com/pricing" } },
        ];
      },
      async restore(s) { log.push(["sessions.restore", s]); },
      async forgetClosedTab() {},
      async forgetClosedWindow() {},
    },
    permissions: { async getAll() { return { permissions: ["tabs", "bookmarks", "history"] }; }, async request() { return true; } },
    bookmarks: {
      async getTree() {
        return [{ id: "root", title: "", children: [{ id: "toolbar", title: "Toolbar", children: [
          { id: "b1", title: "GitHub Docs", url: "https://docs.github.com/", dateAdded: now - 1e9 },
          { id: "b2", title: "Firefox Extension Workshop", url: "https://extensionworkshop.com/", dateAdded: now - 2e9 },
        ] }] }];
      },
    },
    history: {
      async search({ text }) {
        const all = [
          { url: "https://github.com/settings/profile", title: "Your profile · GitHub", lastVisitTime: now - 2 * 60 * min, visitCount: 4 },
          { url: "https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions", title: "Browser extensions - Mozilla | MDN", lastVisitTime: now - 26 * 60 * min, visitCount: 9 },
        ];
        return text ? all.filter((h) => (h.title + h.url).toLowerCase().includes(text.toLowerCase())) : all;
      },
      async deleteUrl() {},
    },
    storage: { sync: area, local: area, onChanged: listeners() },
    commands: {
      async getAll() { return [{ name: "_execute_action", description: "", shortcut: "Ctrl+Shift+Space" }, { name: "previous-tab", description: "Jump to the previously used tab", shortcut: "" }]; },
      async update(p) { log.push(["commands.update", p]); }, async reset() {},
    },
    runtime: { openOptionsPage() { log.push(["openOptionsPage"]); }, getManifest: () => ({ version: "1.1.0" }) },
    search: { async search(p) { log.push(["search.search", p]); } },
  };
  window.close = () => log.push(["window.close"]);

  // Optional scripted interaction once the page has rendered.
  window.addEventListener("DOMContentLoaded", () => setTimeout(() => {
    const keys = (params.get("keys") || "").split(",").filter(Boolean);
    setTimeout(() => {
      for (const combo of keys) {
        const parts = combo.split("+");
        const key = parts.pop();
        const opts = { key: key.length === 1 ? key.toLowerCase() : key, code: /^[A-Z]$/.test(key) ? `Key${key}` : /^\d$/.test(key) ? `Digit${key}` : key, bubbles: true, cancelable: true,
          ctrlKey: parts.includes("Ctrl"), altKey: parts.includes("Alt"), shiftKey: parts.includes("Shift"), metaKey: parts.includes("Meta") };
        (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", opts));
      }
      const out = document.createElement("pre");
      out.id = "__log";
      out.textContent = JSON.stringify(window.__calls);
      document.title = `LOG ${JSON.stringify(window.__calls)}`;
      if (params.has("showlog")) document.body.append(out);
    }, 150);
  }, 150));
})();
