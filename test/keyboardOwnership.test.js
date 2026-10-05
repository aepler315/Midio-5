import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEditableTarget, ownsNativeKeyboard } from '../src/ui/KeyboardOwnership.js';

// Minimal stand-ins for DOM nodes: the module only reads tagName,
// isContentEditable, getAttribute and parentElement.
function node(tagName, { parent = null, attrs = {}, isContentEditable = false } = {}) {
  return {
    tagName,
    parentElement: parent,
    isContentEditable,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
  };
}
const body = node('BODY');
const stage = node('CANVAS', { parent: body });
const key = (key, target, extra = {}) => ({
  key, target, defaultPrevented: false, isComposing: false, keyCode: 0,
  ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra,
});

test('stage keys stay with the game', () => {
  for (const k of ['r', 'R', 'c', 'f', 'j', 'g', ' ', 'ArrowLeft', 'w', 'F3', 'Escape']) {
    assert.equal(ownsNativeKeyboard(key(k, stage)), false, k);
  }
  // Shift alone is not a chord: Shift+R is still the reduced-flash key.
  assert.equal(ownsNativeKeyboard(key('R', stage, { shiftKey: true })), false);
  assert.equal(ownsNativeKeyboard(key('r', body)), false);
});

test('an r typed into a text field belongs to the field', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) {
    assert.equal(ownsNativeKeyboard(key('r', node(tag, { parent: body }))), true, tag);
  }
});

test('nested contenteditable owns the key at any depth', () => {
  const editor = node('DIV', { parent: body, attrs: { contenteditable: '' } });
  const para = node('P', { parent: editor });
  const span = node('SPAN', { parent: para });
  assert.equal(ownsNativeKeyboard(key('r', span)), true);
  assert.equal(ownsNativeKeyboard(key('a', node('B', { parent: editor }))), true);
  // A real browser also reports the inherited flag directly.
  assert.equal(isEditableTarget(node('SPAN', { isContentEditable: true })), true);
  // contenteditable="false" opts back out.
  const off = node('DIV', { parent: body, attrs: { contenteditable: 'false' } });
  assert.equal(ownsNativeKeyboard(key('r', node('SPAN', { parent: off }))), false);
});

test('IME composition is never a shortcut', () => {
  assert.equal(ownsNativeKeyboard(key('r', stage, { isComposing: true })), true);
  assert.equal(ownsNativeKeyboard(key('Process', stage)), true);
  assert.equal(ownsNativeKeyboard(key('r', stage, { keyCode: 229 })), true);
});

test('browser and OS chords are never shortcuts', () => {
  assert.equal(ownsNativeKeyboard(key('f', stage, { ctrlKey: true })), true, 'Ctrl+F');
  assert.equal(ownsNativeKeyboard(key('c', stage, { ctrlKey: true })), true, 'Ctrl+C');
  assert.equal(ownsNativeKeyboard(key('r', stage, { metaKey: true })), true, 'Cmd+R');
  assert.equal(ownsNativeKeyboard(key('f', stage, { metaKey: true })), true, 'Cmd+F');
  assert.equal(ownsNativeKeyboard(key('g', stage, { altKey: true })), true, 'Alt+G');
});

test('an event another handler already consumed is left alone', () => {
  assert.equal(ownsNativeKeyboard(key('r', stage, { defaultPrevented: true })), true);
});

test('the composed path wins over a retargeted shadow host', () => {
  const host = node('MIDIO-PANEL', { parent: body });
  const inner = node('INPUT', { parent: null });
  const e = key('r', host, { composedPath: () => [inner, host, body] });
  assert.equal(ownsNativeKeyboard(e), true);
});

test('missing or targetless events are not owned', () => {
  assert.equal(ownsNativeKeyboard(null), false);
  assert.equal(ownsNativeKeyboard(key('r', null)), false);
});
