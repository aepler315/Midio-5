// Bind a parsed annotation to the exact recording it describes, and decide
// whether the pair may enter a scored evaluation
// (docs/listening/pipeline-design.md, "Case manifest", "Time and uncertainty").
//
// The annotation's audio_file is a human convenience; the manifest binds it:
//   caseId, annotationRevision, annotationSha256, annotator
//   recording         { sha256, decodedDurationMs, fileName? } -- the file the
//                     annotation's times refer to (as a production run reads it)
//   submittedAudioSha256   hash of the file submitted with the annotation
//   excerpt           null, or { parentSha256, offsetMs, alignment } when the
//                     recording is cut from another; usable only once aligned
//   recordingGroup, split ('development' | 'validation' | 'test'), splitRevision
//   purpose           'scored' or 'workflow' (annotation-format development)
//
// Labels and machine inputs are kept apart here too: labelsFor() is the only
// way to read a case's labels, and refuses analysis outright, and retrieval
// or calibration for held-out cases.

export const LISTENING_SPLITS = Object.freeze(['development', 'validation', 'test']);
const HEX64 = /^[0-9a-f]{64}$/;

/** Validate an annotation (from parseAnnotation) against its case manifest. */
export function validateCase(annotation, manifest) {
  const errors = [], warnings = [];
  if (!annotation || !Array.isArray(annotation.segments)) return { valid: false, scored: false, errors: ['not a parsed annotation'], warnings };
  if (!manifest || typeof manifest !== 'object') return { valid: false, scored: false, errors: ['no case manifest: the annotation is not bound to a recording'], warnings };

  const rec = manifest.recording || {};
  if (!HEX64.test(rec.sha256 || '')) errors.push('recording.sha256 missing');
  const duration = rec.decodedDurationMs;
  if (!(duration > 0)) errors.push('recording.decodedDurationMs missing: times cannot be checked');
  if (manifest.submittedAudioSha256 && rec.sha256 && manifest.submittedAudioSha256 !== rec.sha256) {
    errors.push('audio hash mismatch: the annotation was submitted with different bytes than the recording it is bound to');
  }
  if (!manifest.submittedAudioSha256) errors.push('submittedAudioSha256 missing: which file the listener heard is unknown');
  if (manifest.excerpt) {
    const ex = manifest.excerpt;
    if (!HEX64.test(ex.parentSha256 || '') || !Number.isFinite(ex.offsetMs)) errors.push('excerpt needs parentSha256 and offsetMs');
    if (ex.alignment !== 'verified') errors.push('unaligned excerpt: its times cannot be compared with the parent recording');
  }

  const inside = (ms) => ms === null || (ms >= 0 && (!(duration > 0) || ms <= duration));
  let prevEnd = -Infinity;
  annotation.segments.forEach((s, i) => {
    const [a, b] = s.spanMs;
    if (a === null || b === null) { warnings.push(`segments[${i}] is not placed in time yet`); return; }
    if (!(a < b)) errors.push(`segments[${i}] ${s.span.join('–')} is empty or reversed`);
    if (!inside(a) || !inside(b)) errors.push(`segments[${i}] ${s.span.join('–')} is outside the recording (${Math.round(duration)} ms)`);
    if (a < prevEnd) errors.push(`segments[${i}] starts before the previous segment ends: segments are ordered and non-overlapping`);
    prevEnd = Math.max(prevEnd, b);
  });
  annotation.trends.forEach((t, i) => {
    const [a, b] = t.spanMs;
    if (a === null || b === null) { warnings.push(`trends[${i}] is not placed in time yet`); return; }
    if (!(a < b)) errors.push(`trends[${i}] ${t.span.join('–')} is empty or reversed`);
    if (!inside(a) || !inside(b)) errors.push(`trends[${i}] ${t.span.join('–')} is outside the recording`);
  });
  annotation.events.forEach((e, i) => {
    const [a, b] = e.withinMs;
    if (a === null || b === null) { warnings.push(`events[${i}] is not placed in time yet`); return; }
    if (a > b) errors.push(`events[${i}] within ${e.within.join('–')} is reversed (equal endpoints mark an exact moment)`);
    if (!inside(a) || !inside(b)) errors.push(`events[${i}] within ${e.within.join('–')} is outside the recording`);
  });

  if (annotation.basis === 'lyrics' || annotation.basis === 'sound+lyrics') warnings.push('the reading uses lyric meaning, which audio features cannot evaluate');
  if (annotation.perspective === 'felt') warnings.push('perspective felt: the listener\'s own response, not what the music expresses');

  const scoredErrors = [];
  if (manifest.purpose === 'scored') {
    if (annotation.status === 'illustrative') scoredErrors.push('an illustrative annotation never enters scored evaluation');
    else if (annotation.status !== 'reviewed') scoredErrors.push(`status ${annotation.status}: only reviewed annotations are scored`);
    if (!manifest.caseId) scoredErrors.push('caseId missing');
    if (!manifest.annotationRevision || !HEX64.test(manifest.annotationSha256 || '')) scoredErrors.push('annotation revision and content hash missing');
    if (!manifest.annotator) scoredErrors.push('annotator missing');
    if (!manifest.recordingGroup) scoredErrors.push('recordingGroup missing: related recordings cannot be kept on one side of the split');
    if (!LISTENING_SPLITS.includes(manifest.split)) scoredErrors.push(`split must be one of ${LISTENING_SPLITS.join(', ')}`);
    if (!manifest.splitRevision) scoredErrors.push('splitRevision missing: the split is not frozen');
    if (annotation.segments.some((s) => s.spanMs.includes(null))) scoredErrors.push('unplaced segments cannot be scored');
  } else if (manifest.purpose !== 'workflow') {
    errors.push('purpose must be scored or workflow');
  }
  errors.push(...scoredErrors);
  return { valid: errors.length === 0, scored: manifest.purpose === 'scored' && errors.length === 0, errors, warnings };
}

/** Recording groups must sit wholly on one side of a frozen split. */
export function checkGroups(manifests) {
  const errors = [];
  const side = new Map(), groupOf = new Map();
  for (const m of manifests) {
    const g = m.recordingGroup, sha = m.recording?.sha256;
    if (g && side.has(g) && side.get(g) !== m.split) errors.push(`group ${g} is in both ${side.get(g)} and ${m.split}`);
    if (g) side.set(g, m.split);
    if (sha && groupOf.has(sha) && groupOf.get(sha) !== g) errors.push(`recording ${sha.slice(0, 12)} is in groups ${groupOf.get(sha)} and ${g}`);
    if (sha) groupOf.set(sha, g);
  }
  return errors;
}

/**
 * The one way to read a case's labels. Machine analysis never receives them;
 * retrieval and calibration see development labels only; model selection may
 * also use validation; scoring may read any split.
 */
export function labelsFor(caseRecord, { purpose } = {}) {
  const split = caseRecord?.manifest?.split;
  if (purpose === 'analysis') throw new Error('labels never enter a machine analysis run');
  if (purpose === 'retrieval' || purpose === 'calibration') {
    if (split !== 'development') throw new Error(`labels of a ${split ?? 'unsplit'} case cannot reach ${purpose}`);
  } else if (purpose === 'selection') {
    if (split !== 'development' && split !== 'validation') throw new Error(`labels of a ${split ?? 'unsplit'} case cannot reach selection`);
  } else if (purpose !== 'scoring') {
    throw new Error(`unknown label purpose ${purpose}`);
  }
  return caseRecord.annotation;
}

/** A production run must not carry the listener's words or labels. */
export function assertRunLabelFree(run, annotation) {
  if (!run || typeof run !== 'object') throw new Error('no run');
  if ('annotation' in run || 'labels' in run) throw new Error('the run carries labels');
  const prose = [annotation?.summary, ...(annotation?.segments || []).flatMap((s) => [s.label, s.notes])]
    .filter((t) => typeof t === 'string' && t.trim().length >= 12);
  if (!prose.length) return;
  const text = JSON.stringify(run);
  for (const p of prose) if (text.includes(JSON.stringify(p).slice(1, -1))) throw new Error('the run contains the listener\'s own words');
}
