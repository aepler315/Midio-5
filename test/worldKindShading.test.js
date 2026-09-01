// Every world kind has to shade its ranges.
//
// The strip bake is a single FLAT fill by design (silhouetteFlatFill.test.js
// enforces it: a baked gradient sliced into independently-offset dance columns
// is a hard seam at every column boundary). So the ONLY thing that gives a
// range any shading is _drawRidgeVolume -- and for a long time that was
// reachable only from BiomeManager's classic alpine path. Seven of the eight
// world kinds have their own draw function and `return` before reaching it,
// so every one of them blitted a bare flat silhouette and called it a range.
//
// That is a whole-game defect wearing the costume of a style choice: whichever
// kind a song happens to be assigned decided whether its mountains had any
// volume at all. This pins the fix so a new world kind cannot quietly ship
// flat, and so nobody removes these calls thinking they are alpine-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const KIND_FILES = {
  city: 'src/world/city/drawCity.js',
  airless: 'src/world/farside/drawFarside.js',
  abyssal: 'src/world/fathom/drawFathom.js',
  foundry: 'src/world/foundry/drawFoundry.js',
  overgrowth: 'src/world/understory/drawUnderstory.js',
  nave: 'src/world/nave/drawNave.js',
  strip: 'src/world/redline/drawRedline.js',
};

for (const [kind, file] of Object.entries(KIND_FILES)) {
  test(`the ${kind} world shades its ranges instead of blitting flat shapes`, () => {
    const src = readFileSync(file, 'utf8');
    assert.ok(src.includes('_drawRidgeVolume'),
      `${file} blits its ranges with no shading pass -- they will render as flat cutouts`);
  });

  test(`the ${kind} world does not claim alpine geology`, () => {
    // Snowcaps and sedimentary bedding are alpine-specific. A skyline, a
    // foundry's stacks and an interior vault all need SHADING; none of them
    // needs strata. Every call from these files must opt out explicitly.
    const src = readFileSync(file, 'utf8');
    const calls = src.match(/_drawRidgeVolume\([^;]*?\);/gs) || [];
    assert.ok(calls.length > 0, `${file} has no _drawRidgeVolume call to check`);
    for (const call of calls) {
      assert.ok(/geology:\s*false/.test(call),
        `${file}: a _drawRidgeVolume call did not pass { geology: false }`);
    }
  });
}

test('every kind that returns early from draw() is covered here', () => {
  // If someone adds an eighth early-return kind, this fails until the new
  // world is listed above -- which is the point: the omission that caused
  // this bug was silent.
  const bm = readFileSync('src/world/BiomeManager.js', 'utf8');
  const kinds = [...bm.matchAll(/if \(_kind === '([a-z]+)'\) \{/g)].map((m) => m[1]);
  assert.ok(kinds.length > 0, 'could not find the world-kind dispatch');
  for (const k of kinds) {
    assert.ok(KIND_FILES[k], `world kind '${k}' returns early from draw() but is not covered by this test`);
  }
  assert.equal(kinds.length, Object.keys(KIND_FILES).length);
});

test('the air color is resolved before the dispatch, not after it', () => {
  // _airColor is what every range body and the ground are washed toward. It
  // used to be assigned in the classic path, BELOW the kind dispatch, so for
  // the seven early-returning kinds it was never set at all and every
  // consumer silently fell back to a default.
  const bm = readFileSync('src/world/BiomeManager.js', 'utf8');
  const assigned = bm.indexOf('this._airColor = skyHorizonNight;');
  const dispatch = bm.indexOf("const _kind = this.world?.kind;");
  assert.ok(assigned > 0 && dispatch > 0, 'could not locate both landmarks');
  assert.ok(assigned < dispatch,
    'the air color is resolved after the world-kind dispatch, so non-alpine worlds never get one');
});
