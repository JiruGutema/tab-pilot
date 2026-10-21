import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSettings, saveSettings, DEFAULTS } from "../shared/settings.js";

test("loadSettings and saveSettings use local storage cache and sync storage fallback", async () => {
  const localStore = {};
  const syncStore = {};

  globalThis.browser = {
    storage: {
      local: {
        async get(k) { return typeof k === "string" ? { [k]: localStore[k] } : { ...localStore }; },
        async set(o) { Object.assign(localStore, o); },
      },
      sync: {
        async get(k) { return typeof k === "string" ? { [k]: syncStore[k] } : { ...syncStore }; },
        async set(o) { Object.assign(syncStore, o); },
      },
    },
  };

  // 1. Initial load when empty returns DEFAULTS
  const s1 = await loadSettings();
  assert.equal(s1.matchMode, DEFAULTS.matchMode);

  // 2. Saving writes to both local and sync
  await saveSettings({ ...s1, popupWidth: 700 });
  assert.equal(localStore.settings?.popupWidth, 700);
  assert.equal(syncStore.settings?.popupWidth, 700);

  // 3. Fast load from local storage
  const s2 = await loadSettings();
  assert.equal(s2.popupWidth, 700);

  // 4. Fallback to sync when local is empty (e.g., new device)
  delete localStore.settings;
  syncStore.settings = { popupWidth: 760 };
  const s3 = await loadSettings();
  assert.equal(s3.popupWidth, 760);
  // It automatically repopulated local storage cache
  assert.equal(localStore.settings?.popupWidth, 760);
});
