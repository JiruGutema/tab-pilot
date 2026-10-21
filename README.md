# Tab Pilot — fuzzy tab search for Firefox

Press **Ctrl+Shift+Space**, type a few letters, and press **Enter**. Use **Alt+N / Alt+P** to move through the results.

## Features

- **Fuzzy search like fzf.** Matches are scored by word boundaries, camelCase, consecutive runs and how compact the match is. Matched letters are highlighted. Smart case, accent-insensitive (`cafe` finds “Café”).
- **Search syntax**

  | Query | Meaning |
  |---|---|
  | `gh iss` | every word must match (title or URL) |
  | `"exact phrase"` | literal substring |
  | `!word` | exclude results containing *word* |
  | `site:github` / `in:work` | domain / container filter |
  | `@pinned @audio @muted @dup @unloaded @here @private` | tab state |
  | `@tabs @closed @bookmarks @history` (`@t @c @b @h`) | choose sources |

- **Multiple sources:** open tabs, recently closed tabs and windows, bookmarks and history. Bookmarks and history are opt-in, and their permission is requested only when you turn them on.
- **Tab actions from the keyboard:** close, pin, mute, reload, duplicate, unload, move to this window, copy URL, reopen the last closed tab. Mark several tabs to act on all of them at once.
- **Badges:** pinned, playing or muted, unloaded, duplicate, container, window, time since last used.
- **A second command, “previous tab”:** jumps back to your last tab Alt-Tab style. It has no default shortcut; set one in Settings.

## Default keys (inside the popup)

| Action | Keys |
|---|---|
| Next / previous | **Alt+N / Alt+P**, Ctrl+J / Ctrl+K, ↓ / ↑, Tab / Shift+Tab |
| Page / first / last | PgDn, PgUp, Ctrl+Home, Ctrl+End |
| Switch / new tab / new window | Enter, Ctrl+Enter, Shift+Enter |
| Close tab (or marked tabs) | Ctrl+D, Shift+Del |
| Mark / mark all | Ctrl+Space, Alt+A |
| Pin, mute, reload, duplicate, unload | Alt+Shift+P, Alt+M, Alt+R, Alt+D, Alt+U |
| Move here, copy URL, reopen closed | Alt+W, Alt+C, Alt+Z |
| Open result 1–9 | Alt+1 … Alt+9 (hold Alt to see the numbers) |
| Help, settings | F1, Ctrl+, |

You can rebind every key in Settings.

> **Why not Ctrl+N?** Firefox reserves Ctrl+N, Ctrl+T, Ctrl+W, Ctrl+Shift+P and Ctrl+Tab. These keys never reach an extension: Ctrl+N inside the popup opens a new window. This was tested in Firefox 157. The settings page won't let you bind these keys.

## Settings

The settings page has a live preview. You can change:

- theme (system, light or dark), accent color, density, text size, popup size
- which details each row shows
- matching mode (fuzzy, words or exact), case sensitivity, title-vs-URL weight, recency boost
- sources, and the order before you type (recently used or tab order, with window grouping)
- where the current tab appears
- Alt-Tab-style preselection, wrap-around, hover-to-select, remembering the last query
- every key binding, and the global shortcuts
- import, export and reset

Settings sync through Firefox Sync.

## Development

```sh
npm test            # search-engine unit tests (node --test)
npm start           # run in a temporary Firefox profile (web-ext)
npm run lint        # web-ext lint
npm run build       # zip in web-ext-artifacts/
```

To load the extension by hand, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…** and pick `manifest.json`.

**UI harness:** run `python3 test/harness/serve.py` and open `http://127.0.0.1:8765/test/harness/popup.html`. The harness loads the real popup and settings page with a mocked `browser` API. Query parameters: `?q=text`, `?settings={"theme":"dark"}`, `?keys=Alt+N,Enter&showlog`.

Before publishing to addons.mozilla.org, change `browser_specific_settings.gecko.id` in `manifest.json`.
