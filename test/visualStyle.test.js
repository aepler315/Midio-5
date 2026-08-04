import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveVisualStyle, nextVisualStyle, styleDials, isRendered, styleLabel,
  shiftLightness, STYLE_CLASSIC, STYLE_RENDERED,
} from '../src/render/VisualStyle.js';
import { bloomStrength } from '../src/render/Renderer.js';

test('resolveVisualStyle always returns the house look', () => {
  assert.equal(resolveVisualStyle('classic'), STYLE_RENDERED);
  assert.equal(resolveVisualStyle('neon'), STYLE_RENDERED);
  assert.equal(resolveVisualStyle('rendered'), STYLE_RENDERED);
  assert.equal(resolveVisualStyle(''), STYLE_RENDERED);
});

test('nextVisualStyle is a no-op', () => {
  assert.equal(nextVisualStyle(STYLE_RENDERED), STYLE_RENDERED);
  assert.equal(nextVisualStyle(STYLE_CLASSIC), STYLE_RENDERED);
});

test('house dials: CGI terrain + ocean contours, no retro', () => {
  const d = styleDials(STYLE_RENDERED);
  assert.equal(d.retroFilter, false);
  assert.equal(d.spaceWash, true);
  assert.equal(d.oceanDrawContours, true);
  assert.ok(d.oceanLineAlpha > 0);
  assert.equal(d.heatShimmerSlices, false);
  assert.ok(d.spaceRidgeAlpha > 0);
  assert.ok(d.bloomBaseMul >= 1);
});

test('styleLabel is fixed house label', () => {
  assert.match(styleLabel(STYLE_RENDERED), /Midio/i);
  assert.match(styleLabel(STYLE_CLASSIC), /Midio/i);
});

test('shiftLightness darkens and lightens without leaving the hex space', () => {
  const base = '#2b2145';
  const dark = shiftLightness(base, -0.15);
  const lit = shiftLightness(base, 0.15);
  assert.match(dark, /^#[0-9a-f]{6}$/i);
  assert.match(lit, /^#[0-9a-f]{6}$/i);
  assert.notEqual(dark, lit);
});

test('bloomStrength is positive for house look', () => {
  const b = bloomStrength(null, null, false, STYLE_RENDERED);
  assert.ok(b > 0);
  assert.ok(isRendered(STYLE_RENDERED));
  assert.ok(isRendered(STYLE_CLASSIC));
});
