// Keyboard combo helpers. Combos are strings like "Ctrl+Shift+K", "ArrowDown", "Alt+1".

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS", "AltGraph", "CapsLock"]);
const IS_MAC = /Mac/i.test(globalThis.navigator?.platform ?? "");

const KEY_ALIASES = {
  " ": "Space",
  Esc: "Escape",
  Del: "Delete",
  Up: "ArrowUp",
  Down: "ArrowDown",
  Left: "ArrowLeft",
  Right: "ArrowRight",
};

/** The logical key name for an event, or null for a bare modifier press. */
function eventKey(e) {
  if (MODIFIER_KEYS.has(e.key)) return null;
  // Letters: prefer the layout-aware key, but fall back to the physical code when a
  // modifier (e.g. Option on macOS) turned it into a symbol.
  if (/^[a-z]$/i.test(e.key)) return e.key.toUpperCase();
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (/^Numpad\d$/.test(e.code)) return e.code.slice(6);
  return KEY_ALIASES[e.key] ?? e.key;
}

export function comboFromEvent(e) {
  const key = eventKey(e);
  if (!key) return null;
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.metaKey) parts.push("Meta");
  if (e.altKey) parts.push("Alt");
  // Shift is implicit in printable symbols like "?" — only record it for named keys/letters/digits.
  if (e.shiftKey && (key.length > 1 || /^[A-Z0-9]$/.test(key))) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

export function normalizeCombo(combo) {
  if (!combo) return "";
  const raw = combo.split("+").map((p) => p.trim());
  // "Ctrl++" style: an empty trailing element means the key itself is "+"
  let key = raw.pop();
  if (key === "" && raw.length && raw[raw.length - 1] === "") { raw.pop(); key = "+"; }
  const mods = new Set(raw.map((m) => ({ control: "Ctrl", ctrl: "Ctrl", cmd: "Meta", command: "Meta", meta: "Meta", option: "Alt", alt: "Alt", shift: "Shift" })[m.toLowerCase()] ?? m));
  key = KEY_ALIASES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  return [...["Ctrl", "Meta", "Alt", "Shift"].filter((m) => mods.has(m)), key].join("+");
}

/** Build a lookup map combo -> action from the settings keys object. */
export function buildKeymap(keys) {
  const map = new Map();
  for (const [action, combos] of Object.entries(keys)) {
    for (const c of combos) map.set(normalizeCombo(c), action);
  }
  return map;
}

const PRETTY = IS_MAC
  ? { Ctrl: "⌃", Meta: "⌘", Alt: "⌥", Shift: "⇧" }
  : { Ctrl: "Ctrl", Meta: "Super", Alt: "Alt", Shift: "Shift" };
const PRETTY_KEYS = {
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Enter: "↵", Escape: "Esc", Delete: "Del", Backspace: "⌫", PageUp: "PgUp", PageDown: "PgDn",
};

/** Split a combo into display-ready key caps. */
export function comboCaps(combo) {
  const parts = normalizeCombo(combo).split("+");
  const key = parts.pop();
  return [...parts.map((m) => PRETTY[m] ?? m), PRETTY_KEYS[key] ?? key];
}

export function comboLabel(combo) {
  return comboCaps(combo).join(IS_MAC ? "" : "+");
}

// Shortcuts Firefox handles before extension pages ever see them (Ctrl+N/T/W/Q and
// Ctrl+Shift+P/W verified in Firefox; tab-switching keys are browser-reserved too):

const RESERVED = new Set([
  "Ctrl+N", "Ctrl+T", "Ctrl+W", "Ctrl+Q", "Ctrl+Shift+P", "Ctrl+Shift+W",
  "Ctrl+Tab", "Ctrl+Shift+Tab", "Ctrl+PageUp", "Ctrl+PageDown", "Escape",
].map(normalizeCombo));

export function isReservedCombo(combo) {
  return RESERVED.has(normalizeCombo(combo));
}
