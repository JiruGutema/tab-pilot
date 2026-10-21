// Background event page: handles global keyboard commands.

async function focusTab(tab) {
  await browser.tabs.update(tab.id, { active: true });
  await browser.windows.update(tab.windowId, { focused: true });
}

/** Jump to the most recently used tab other than the current one (Alt-Tab style). */
async function previousTab() {
  const [current] = await browser.tabs.query({ active: true, currentWindow: true });
  const tabs = await browser.tabs.query({});
  const candidates = tabs
    .filter((t) => !t.hidden && (!current || t.id !== current.id) && (!current || t.incognito === current.incognito))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  if (candidates.length) await focusTab(candidates[0]);
}

browser.commands.onCommand.addListener((command) => {
  if (command === "previous-tab") previousTab();
});

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") browser.runtime.openOptionsPage();
});

// Mirror any changes arriving from Firefox Sync into local storage for instant startup
if (browser.storage?.onChanged) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings?.newValue) {
      browser.storage.local.set({ settings: changes.settings.newValue }).catch(() => {});
    }
  });
}
