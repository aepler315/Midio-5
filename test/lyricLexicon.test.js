import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanLine, extractChorusPhrase } from '../src/lyrics/LyricLexicon.js';

test('scanLine: returns null for empty/whitespace input', () => {
  assert.strictEqual(scanLine(''), null);
  assert.strictEqual(scanLine('   '), null);
  assert.strictEqual(scanLine(null), null);
  assert.strictEqual(scanLine(undefined), null);
});

test('scanLine: matches common symbols at priority 1', () => {
  const r = scanLine('My heart is beating fast');
  assert.ok(r);
  assert.strictEqual(r.glyphId, 'heart');
  assert.strictEqual(r.priority, 1);
});

test('scanLine: matches specific symbols at priority 2', () => {
  const r = scanLine('Wearing a crown of thorns');
  assert.ok(r);
  assert.strictEqual(r.glyphId, 'crown');
  assert.strictEqual(r.priority, 2);
});

test('scanLine: matches easter eggs at priority 3', () => {
  const r = scanLine('Rolling up a blunt tonight');
  assert.ok(r);
  assert.strictEqual(r.glyphId, 'leaf');
  assert.strictEqual(r.priority, 3);
});

test('scanLine: higher priority wins when multiple keywords match', () => {
  const r = scanLine('The king lit a fire and stared at the stars');
  assert.ok(r);
  // crown (pri 2) or flame (pri 2) should beat star (pri 1)
  assert.ok(r.priority >= 2);
});

test('scanLine: multi-word phrases match', () => {
  const r = scanLine('Open your third eye to the truth');
  assert.ok(r);
  assert.strictEqual(r.glyphId, 'eye');
});

test('scanLine: case insensitive', () => {
  const r = scanLine('DIAMOND in the rough');
  assert.ok(r);
  assert.strictEqual(r.glyphId, 'diamond');
});

test('scanLine: no false positive on "high" or "smoke" alone', () => {
  assert.strictEqual(scanLine('High hopes'), null);
  assert.strictEqual(scanLine('Smoke on the water'), null);
});

test('extractChorusPhrase: returns uppercase short phrase', () => {
  const text = 'We are the champions\nNo time for losers\nWe are the champions of the world';
  const r = extractChorusPhrase(text);
  assert.ok(r);
  assert.ok(r.length <= 22);
  assert.strictEqual(r, r.toUpperCase());
});

test('extractChorusPhrase: returns null for empty input', () => {
  assert.strictEqual(extractChorusPhrase(''), null);
  assert.strictEqual(extractChorusPhrase(null), null);
});

test('extractChorusPhrase: picks shortest non-trivial line', () => {
  const text = 'This is a very long chorus line that goes on and on\nShort hook\nAnother medium line here';
  const r = extractChorusPhrase(text);
  assert.ok(r);
  assert.strictEqual(r, 'SHORT HOOK');
});

test('extractChorusPhrase: truncates multi-word lines at word boundary', () => {
  const text = 'Dancing through the night with you forever\nAnother long line about the sunrise coming over the hill';
  const r = extractChorusPhrase(text);
  assert.ok(r);
  assert.ok(r.length <= 22, `result "${r}" exceeds 22 chars`);
});
