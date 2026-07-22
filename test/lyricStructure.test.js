import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLine, syllableCount, toBlocks, labelBlocks, sectionEmotion } from '../src/lyrics/LyricStructure.js';

test('normalizeLine: lowercases, strips punctuation, keeps in-word apostrophes, collapses whitespace', () => {
  assert.equal(normalizeLine("  Don't Stop, Believing!!  "), "don't stop believing");
  assert.equal(normalizeLine(''), '');
  assert.equal(normalizeLine(null), '');
});

test('syllableCount: matches the vowel-group heuristic on a handful of known words', () => {
  assert.equal(syllableCount('cat'), 1);
  assert.equal(syllableCount('happy'), 2);
  assert.equal(syllableCount('wonderful'), 3);
  assert.equal(syllableCount('the'), 1);
  assert.equal(syllableCount('little'), 2);
  assert.equal(syllableCount(''), 0);
});

test('syllableCount: a whole line sums its words\' syllables and is always >= word count', () => {
  const line = 'the cat sat on the little mat';
  const words = line.split(' ').length;
  assert.ok(syllableCount(line) >= words);
});

test('toBlocks (plain): blank lines separate paragraphs, consecutive blanks collapse', () => {
  const lines = ['Verse line one', 'Verse line two', '', '', 'Chorus line one', 'Chorus line two', ''];
  const blocks = toBlocks(lines, { synced: false });
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].lines, ['Verse line one', 'Verse line two']);
  assert.deepEqual(blocks[1].lines, ['Chorus line one', 'Chorus line two']);
  assert.equal(blocks[0].startMs, undefined);
});

test('toBlocks (synced): a large gap between lines starts a new block; small gaps stay in one', () => {
  const lines = [
    { tMs: 0, text: 'a' }, { tMs: 2000, text: 'b' }, { tMs: 4000, text: 'c' },
    { tMs: 20000, text: 'd' }, { tMs: 22000, text: 'e' },
  ];
  const blocks = toBlocks(lines, { synced: true });
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].lines, ['a', 'b', 'c']);
  assert.deepEqual(blocks[1].lines, ['d', 'e']);
  assert.equal(blocks[0].startMs, 0);
  assert.equal(blocks[0].endMs, 4000);
});

test('toBlocks: empty/degenerate input never throws', () => {
  assert.deepEqual(toBlocks([], { synced: true }), []);
  assert.deepEqual(toBlocks(null, { synced: false }), []);
});

test('labelBlocks (plain, no timing): a repeated block is CHORUS, one-off blocks are VERSE, and a late-song one-off is BRIDGE', () => {
  const verse1 = ['Walking down this empty road', 'Nothing left to say'];
  const chorus = ['We rise together now', 'We rise together now'];
  const verse2 = ['Another day another fight', 'Nothing left to say twice'];
  const bridgeText = ['Everything falls apart tonight', 'A different kind of truth'];
  // Realistic shape: verse/chorus/verse/chorus/bridge/chorus -- the bridge
  // sits before a final repeat, not at the very last position (a bridge
  // as literally the last block of the song is not the typical case this
  // heuristic targets).
  const blocks = toBlocks(
    [...verse1, '', ...chorus, '', ...verse2, '', ...chorus, '', ...bridgeText, '', ...chorus, ''],
    { synced: false },
  );
  const sections = labelBlocks(blocks);
  const kinds = sections.map((s) => s.kind);
  assert.equal(kinds.filter((k) => k === 'chorus').length, 3, 'all three chorus repeats must be labeled chorus');
  assert.equal(kinds[4], 'bridge', 'the late, unique block should read as the bridge');
  assert.equal(kinds[0], 'verse');
});

test('labelBlocks (synced): inserts intro/instrumental/outro and honors durationMs for the outro check', () => {
  // Hand-built blocks (bypassing toBlocks' adaptive gap threshold, which is
  // exercised separately) so the intro/instrumental/outro boundaries are
  // exact and unambiguous.
  const blocks = [
    { lines: ['first verse line', 'still verse one'], startMs: 15000, endMs: 17000 },
    { lines: ['chorus hits here'], startMs: 40000, endMs: 42000 },
    { lines: ['closing thoughts now'], startMs: 70000, endMs: 70000 },
  ];
  const durationMs = 100000; // 30s of outro silence after the last stamp
  const sections = labelBlocks(blocks, { durationMs });
  assert.equal(sections[0].kind, 'intro', 'a >=8s lead-in before the first stamp must be an intro');
  assert.equal(sections[0].startMs, 0);
  assert.equal(sections[0].endMs, 15000);
  assert.ok(sections.some((s) => s.kind === 'instrumental'), 'a >=12s gap between blocks must read as instrumental');
  assert.equal(sections[sections.length - 1].kind, 'outro', 'the trailing silence must read as an outro');
  assert.equal(sections[sections.length - 1].startMs, 70000);
});

test('labelBlocks: an empty block list returns an empty section list', () => {
  assert.deepEqual(labelBlocks([]), []);
});

test('sectionEmotion: love/joy vocabulary reads positive-valence; blood/rage/scream vocabulary reads negative-valence and high-arousal', () => {
  const happy = sectionEmotion('I love this joy and happy sunshine dream together forever');
  const dark = sectionEmotion('blood rage scream kill destroy the demon nightmare fire burning');
  assert.ok(happy.valence > 0.3, `expected positive valence, got ${happy.valence}`);
  assert.ok(dark.valence < -0.3, `expected negative valence, got ${dark.valence}`);
  assert.ok(dark.intensity > 0.6, `expected high arousal for the aggressive text, got ${dark.intensity}`);
  const epicBridge = sectionEmotion('rise up now for glory and victory epic triumph legend');
  assert.ok(epicBridge.valence > 0 && epicBridge.intensity > 0.6, 'an "epic" bridge should read positive AND high-arousal');
});

test('sectionEmotion: unrecognized text reads neutral rather than throwing or defaulting to an extreme', () => {
  const neutral = sectionEmotion('the quick brown zephyr glyph');
  assert.equal(neutral.valence, 0);
  assert.ok(neutral.intensity > 0 && neutral.intensity < 1);
  assert.doesNotThrow(() => sectionEmotion(''));
});
