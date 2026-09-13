import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorldChoices } from '../src/ui/WorldChooser.js';

const WORLDS = [
  { id: 'alpine', name: 'The Range', tagline: 'Mountains that breathe with the mix.', kind: 'alpine' },
  { id: 'nocturne', name: 'After Hours', tagline: 'A city that glows with the groove.', kind: 'city' },
  { id: 'cathode', name: 'Cathode', tagline: 'A machine dreaming in four colors.', kind: 'cathode', manualOnly: true },
];

test('chooser replaces a tailored base world instead of adding a duplicate card', () => {
  const choices = buildWorldChoices(WORLDS, {
    id: 'custom', baseId: 'alpine', name: 'The Range',
    tagline: 'Mountains that breathe with the mix.', kind: 'alpine',
  });

  assert.deepEqual(choices, [
    { worldId: 'alpine', playWorldId: 'custom', name: 'The Range', tagline: 'Mountains that breathe with the mix.', kind: 'alpine' },
    { worldId: 'nocturne', playWorldId: 'nocturne', name: 'After Hours', tagline: 'A city that glows with the groove.', kind: 'city' },
    { worldId: 'cathode', playWorldId: 'cathode', name: 'Cathode', tagline: 'A machine dreaming in four colors.', kind: 'cathode' },
  ]);
});

test('chooser uses each registered world directly when there is no tailored variant', () => {
  const choices = buildWorldChoices(WORLDS);

  assert.deepEqual(choices.map(({ worldId, playWorldId }) => ({ worldId, playWorldId })), [
    { worldId: 'alpine', playWorldId: 'alpine' },
    { worldId: 'nocturne', playWorldId: 'nocturne' },
    { worldId: 'cathode', playWorldId: 'cathode' },
  ]);
});
