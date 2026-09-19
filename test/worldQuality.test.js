import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EnergyCurves } from '../src/audio/EnergyCurves.js';
import { listWorlds } from '../src/world/Worlds.js';
import { pickPreviewPassages } from '../src/ui/WorldPreview.js';
import {
  REQUIRED_FAMILIES, ACCEPTANCE_TARGET, EVAL_QUALITY, viewingOrder, evaluationSeed,
  pickEvaluationPassages, privateScores, seventyEightyCases, diagnosticsFromFeatures,
  evaluateTrack, evaluateCorpus, validateCorpus, applyReviews, summarizeAcceptance,
  autoExclusions,
} from '../src/eval/WorldQuality.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const corpus = JSON.parse(await readFile(join(root, 'test/fixtures/world-evaluation.json'), 'utf8'));

test('the fixture is a 12–20 track corpus covering every required family in both splits', () => {
  const { ok, errors, n } = validateCorpus(corpus);
  assert.equal(ok, true, errors.join('; '));
  assert.ok(n >= 12 && n <= 20);
  const families = REQUIRED_FAMILIES.slice();
  for (const split of ['tune', 'holdout']) {
    const got = new Set(corpus.tracks.filter((t) => t.split === split).map((t) => t.family));
    for (const fam of families) assert.ok(got.has(fam), `${split} missing ${fam}`);
  }
  assert.ok(corpus.tracks.some((t) => t.split === 'tune' && t.representation === 'midi'));
  assert.ok(corpus.tracks.some((t) => t.split === 'tune' && t.representation === 'audio'));
  assert.ok(corpus.tracks.some((t) => t.split === 'holdout' && t.representation === 'midi'));
  assert.ok(corpus.tracks.some((t) => t.split === 'holdout' && t.representation === 'audio'));
});

test('tune and holdout ids are disjoint, and no track stores audio bytes', () => {
  const tune = new Set(corpus.tracks.filter((t) => t.split === 'tune').map((t) => t.id));
  const hold = new Set(corpus.tracks.filter((t) => t.split === 'holdout').map((t) => t.id));
  for (const id of tune) assert.ok(!hold.has(id), `id ${id} is in both splits`);
  for (const t of corpus.tracks) {
    assert.ok(t.source && t.source.kind, `${t.id} missing source`);
    assert.equal(t.source.bytes, undefined);
    assert.equal(t.audio, undefined);
  }
});

test('viewing order is the authored world list, including Cathode, never a score ranking', () => {
  const order = viewingOrder();
  assert.deepEqual(order, listWorlds().map((w) => w.id));
  assert.ok(order.includes('cathode'));
  const dense = corpus.tracks.find((t) => t.id === 'tune-wall-guitars');
  const sheet = evaluateTrack(dense);
  assert.deepEqual(sheet.viewingOrder, order);
  const ranked = sheet.heuristic.byWorld.map((w) => w.id);
  assert.notDeepEqual(sheet.viewingOrder, ranked, 'gallery order must not follow the heuristic');
  assert.ok(!sheet.heuristic.byWorld.some((w) => w.id === 'cathode'), 'Cathode stays manual-only');
});

test('private scores are heuristics; 70–80 cases sit beside the winner without changing order', () => {
  const warm = corpus.tracks.find((t) => t.id === 'tune-bass-helix7');
  const heuristic = privateScores(warm.features);
  assert.equal(heuristic.note.includes('not visual quality'), true);
  const band = seventyEightyCases(heuristic);
  const sheet = evaluateTrack(warm);
  assert.deepEqual(sheet.viewingOrder, viewingOrder());
  if (band.length) {
    assert.ok(band.every((c) => c.score >= 70 && c.score <= 80));
  }
  for (const row of heuristic.byWorld) {
    assert.ok(row.score >= 1 && row.score <= 99);
    assert.equal(typeof row.fit, 'number');
    assert.equal(typeof row.tied, 'boolean');
    assert.equal(typeof row.eligible, 'boolean');
    assert.ok(row.parts.styleAffinity != null);
    assert.ok(Array.isArray(row.parts.problems));
  }
  assert.ok(heuristic.pickReason === 'unique' || heuristic.pickReason === 'near-tie');
});

test('every world is offered the same quiet, transition and peak clock', () => {
  const track = corpus.tracks.find((t) => t.id === 'tune-wall-guitars');
  const sheet = evaluateTrack(track);
  const { quietMs, peakMs, transitionMs, spanMs } = sheet.passages;
  assert.ok(quietMs !== peakMs);
  assert.ok(Number.isFinite(transitionMs));
  assert.equal(sheet.capture.worlds.length, listWorlds().length);
  for (const world of sheet.capture.worlds) {
    assert.deepEqual(world.stills.map((s) => s.tMs), [quietMs, transitionMs, peakMs]);
    assert.equal(world.stills[0].passage, 'quiet');
    assert.equal(world.stills[2].passage, 'peak');
    assert.equal(world.seed ?? sheet.seed, sheet.seed);
  }
  assert.equal(sheet.capture.quality, EVAL_QUALITY);
  assert.equal(spanMs, 8000);
});

test('annotated passages win; derived quiet/peak agree with the chooser picker', () => {
  const annotated = corpus.tracks.find((t) => t.id === 'hold-piano-audio');
  const got = pickEvaluationPassages(annotated);
  assert.equal(got.source, 'annotated');
  assert.equal(got.quietMs, annotated.passages.quietMs);
  assert.equal(got.peakMs, annotated.passages.peakMs);
  assert.equal(got.transitionMs, annotated.passages.transitionMs);

  const durationMs = 120000;
  const ec = new EnergyCurves(durationMs, 50);
  for (let i = 0; i < ec.n; i++) {
    const t01 = i / (ec.n - 1);
    const e = 0.1 + 0.8 * Math.exp(-(((t01 - 0.7) / 0.08) ** 2) * 4);
    ec.setFrame(i, [e, e, e, e, e, e, e]);
  }
  const derived = pickEvaluationPassages({ durationMs, energyCurves: ec });
  const chooser = pickPreviewPassages({ energyCurves: ec, durationMs });
  assert.equal(derived.quietMs, chooser.quietMs);
  assert.equal(derived.peakMs, chooser.peakMs);
  assert.equal(derived.source, 'derived');
  assert.ok(derived.transitionMs !== derived.quietMs);
});

test('a backward seek of the same track reproduces the seed and the passages', () => {
  const track = corpus.tracks.find((t) => t.id === 'tune-piano-midi');
  const a = evaluateTrack(track);
  const b = evaluateTrack(track);
  assert.equal(a.seed, b.seed);
  assert.equal(a.seed, evaluationSeed(track));
  assert.deepEqual(a.passages, b.passages);
  assert.deepEqual(a.heuristic.byWorld.map((w) => w.score), b.heuristic.byWorld.map((w) => w.score));
});

test('diagnostics exist and are not ratings', () => {
  const track = corpus.tracks.find((t) => t.id === 'tune-drums-midi');
  const sheet = evaluateTrack(track);
  assert.ok(sheet.diagnostics.eventDensity > 0.5);
  assert.ok(sheet.diagnostics.saturation >= sheet.diagnostics.eventDensity);
  assert.equal(sheet.diagnostics.frameMs, null);
  assert.match(sheet.diagnostics.note, /not an automatic beauty score/);
  const diag = diagnosticsFromFeatures(track.features, sheet.passages);
  assert.equal(diag.transitionMs, sheet.passages.transitionMs);
  for (const review of sheet.reviews) {
    for (const axis of ['appeal', 'musicalTiming', 'identity', 'quietInterest', 'climaxHeadroom', 'clutter']) {
      assert.equal(review[axis], null);
    }
  }
});

test('empty ratings do not claim the acceptance target; filled holdout ratings can meet it', () => {
  const report = evaluateCorpus(corpus, { split: 'holdout' });
  assert.equal(report.summary.claimed, false);
  assert.equal(report.summary.met, null);
  assert.equal(report.summary.reviewed, 0);
  assert.equal(report.summary.calibration, 'empty-holdout');
  assert.deepEqual(report.summary.exclusions, []);
  assert.equal(report.acceptance.holdoutShare, 0.8);
  assert.match(ACCEPTANCE_TARGET.note, /Calmness is a legitimate outcome/);

  const filled = report.sheets.map((sheet) => applyReviews(sheet, {
    [sheet.heuristic.recommendedId]: {
      appeal: 5, musicalTiming: 4, identity: 4, quietInterest: 4, climaxHeadroom: 4, clutter: 5, blockingDefect: false,
    },
  }));
  const ok = summarizeAcceptance(filled, { split: 'holdout' });
  assert.equal(ok.reviewed, filled.length);
  assert.equal(ok.met, true);
  assert.equal(ok.claimed, false);
  assert.equal(ok.calibration, 'holdout-reviews');
  assert.deepEqual(ok.exclusions, []);

  const blocked = report.sheets.map((sheet, i) => applyReviews(sheet, {
    [sheet.heuristic.recommendedId]: {
      appeal: i < 3 ? 2 : 5,
      musicalTiming: i < 3 ? 2 : 5,
      identity: 4, quietInterest: 4, climaxHeadroom: 4, clutter: 4,
      blockingDefect: i < 2,
    },
  }));
  const fail = summarizeAcceptance(blocked, { split: 'holdout' });
  assert.equal(fail.claimed, false);
  assert.equal(fail.met, false);
  assert.ok(fail.passing < fail.reviewed);
  assert.equal(fail.calibration, 'holdout-reviews');
  assert.equal(fail.exclusions.length, 2);
  assert.ok(fail.exclusions.every((e) => e.reason === 'blocking-defect'));
  const fromHelper = autoExclusions(blocked);
  assert.equal(fromHelper.length, 2);
});

test('evaluateCorpus --split tune never peeks at holdout tracks', () => {
  const report = evaluateCorpus(corpus, { split: 'tune' });
  assert.ok(report.sheets.length);
  assert.ok(report.sheets.every((s) => s.track.split === 'tune'));
  assert.equal(report.summary.split, 'tune');
});
