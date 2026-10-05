/**
 * Who owns a key press: the page's native behavior, or the game's global
 * shortcuts.
 *
 * The global keydown handler in main.js turns single letters into actions
 * (R toggles reduced flashes, C opens recalibration, G opens fonts, F/J tap
 * the beat) and swallows Space/arrows/WASD so a first-time player mashing
 * them cannot nudge the beat anchor. None of that may happen while the
 * player is typing a URL, a library search or a seed, during IME
 * composition, or when the key is part of a browser/OS chord such as Ctrl+F
 * or Cmd+C. This module answers that question once, so the handler can ask
 * it before any branch with a side effect.
 *
 * Dialog and chooser controls are not covered here on purpose: their own
 * listeners handle Enter/Space/arrows, and the global handler already
 * leaves those to them.
 */

const TEXT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * The element the key was really aimed at. Inside a shadow root
 * `event.target` is retargeted to the host, so prefer the first entry of
 * the composed path when the browser provides one.
 */
function originalTarget(event) {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
  return (path && path.length && path[0]) || event.target || null;
}

/**
 * True when `node`, or any ancestor of it, is a form field or editable
 * content. Works on real DOM nodes and on plain objects with `tagName`,
 * `isContentEditable`, `getAttribute` and `parentElement`, so node:test can
 * exercise it without a DOM.
 */
export function isEditableTarget(node) {
  for (let n = node; n; n = n.parentElement ?? n.parentNode?.host ?? null) {
    if (n.isContentEditable) return true;
    const tag = typeof n.tagName === 'string' ? n.tagName.toUpperCase() : '';
    if (TEXT_TAGS.has(tag)) return true;
    const editable = typeof n.getAttribute === 'function' ? n.getAttribute('contenteditable') : null;
    if (editable !== null && editable !== undefined && String(editable).toLowerCase() !== 'false') return true;
  }
  return false;
}

/**
 * True when the browser, the operating system or a focused field should
 * handle this key, so no global gameplay shortcut may act on it or call
 * preventDefault on it.
 *
 * Shift alone is not a chord: Shift+R is still the reduced-flash shortcut.
 */
export function ownsNativeKeyboard(event) {
  if (!event) return false;
  if (event.defaultPrevented) return true;
  // keyCode 229 / key "Process" is what Chromium and Safari report for a key
  // the input method is consuming, sometimes before isComposing turns true.
  if (event.isComposing || event.keyCode === 229 || event.key === 'Process') return true;
  if (event.ctrlKey || event.metaKey || event.altKey) return true;
  return isEditableTarget(originalTarget(event));
}
