// Parse and structurally validate a listening annotation
// (docs/listening/README.md, listening.schema.json, format midio-listening/0.1).
//
// Safety: YAML 1.2 core schema; duplicate keys, explicit tags (!!js/...,
// !custom, even !!str), anchors/aliases and multiple documents are refused,
// and nothing in the file is executed. Meaning: the listener's words are kept
// verbatim; unknown (null/absent) stays unknown and is never turned into zero;
// simultaneous emotions, intensity and foreground role stay independent.
//
// Times become integer milliseconds beside the original strings. Segment and
// trend spans are half-open [start, end); event `within` is a closed
// uncertainty interval [earliest, latest]. Recording binding and duration
// checks belong to validateCase.js.
import { parseDocument, visit, isAlias, isNode } from 'yaml';

export const ANNOTATION_FORMAT = 'midio-listening/0.1';
export const EMOTIONS = Object.freeze(['joy', 'melancholy', 'sadness', 'longing', 'nostalgia', 'tenderness', 'calm', 'unease', 'aggression', 'triumph', 'wonder', 'playfulness']);
export const SOUND_RATINGS = Object.freeze(['brightness', 'activity', 'loudness', 'density', 'roughness']);
export const ROLES = Object.freeze(['foreground', 'undertone', 'absent', 'unclear']);
export const CONFIDENCE = Object.freeze(['high', 'medium', 'low', 'unrated']);
const STATUS = ['draft', 'reviewed', 'illustrative'];
const PERSPECTIVE = ['expressed', 'felt'];
const BASIS = ['sound', 'lyrics', 'sound+lyrics', 'unspecified'];
const PULSE = ['steady', 'free', 'unclear', null];
const GROOVE = ['straight', 'swung', 'syncopated', 'mixed', 'unclear', null];
const TIMESTAMP = /^([0-9]{2,}):([0-5][0-9])(?:\.([0-9]{1,3}))?$/;
const TREND_TARGET = new RegExp(`^(emotions\\.(${EMOTIONS.join('|')})\\.intensity|sound\\.(${SOUND_RATINGS.join('|')})|affect\\.(valence|arousal|tension))$`);
const TOP_KEYS = ['format', 'status', 'audio_file', 'listener', 'perspective', 'basis', 'summary', 'segments', 'trends', 'events'];

export class AnnotationError extends Error {
  constructor(issues) {
    super(`annotation refused:\n  - ${issues.join('\n  - ')}`);
    this.name = 'AnnotationError';
    this.issues = issues;
  }
}

/** "mm:ss(.sss)" -> integer ms; null stays null; anything else is an issue. */
export function timestampMs(value) {
  if (value === null) return null;
  const m = typeof value === 'string' ? TIMESTAMP.exec(value) : null;
  if (!m) return undefined;
  const frac = m[3] ? Number(m[3].padEnd(3, '0')) : 0;
  return Number(m[1]) * 60000 + Number(m[2]) * 1000 + frac;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function onlyKeys(obj, allowed, where, issues) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) issues.push(`${where}: unknown field ${k}`);
}

function rating(v, where, issues, lo = 0, hi = 4) {
  if (v === null || v === undefined) return;
  if (!Number.isInteger(v) || v < lo || v > hi) issues.push(`${where} must be an integer ${lo}..${hi} or null, got ${JSON.stringify(v)}`);
}

function oneOf(v, allowed, where, issues) {
  if (!allowed.includes(v)) issues.push(`${where} must be one of ${allowed.map(String).join(', ')}, got ${JSON.stringify(v)}`);
}

function pair(v, where, issues) {
  if (!Array.isArray(v) || v.length !== 2) { issues.push(`${where} must be a pair of timestamps`); return [undefined, undefined]; }
  const ms = v.map((t, i) => {
    const x = timestampMs(t);
    if (x === undefined) issues.push(`${where}[${i}] ${JSON.stringify(t)} is not a "mm:ss" or "mm:ss.sss" timestamp`);
    return x;
  });
  return ms;
}

function checkEmotion(name, e, where, issues) {
  if (!EMOTIONS.includes(name)) { issues.push(`${where}: ${name} is not in the emotion vocabulary (put it in notes)`); return; }
  if (!isObj(e)) { issues.push(`${where}.${name} must be a mapping`); return; }
  onlyKeys(e, ['intensity', 'role', 'confidence', 'notes'], `${where}.${name}`, issues);
  if (!('intensity' in e) || !('role' in e)) issues.push(`${where}.${name} needs intensity and role (null intensity means unknown)`);
  rating(e.intensity, `${where}.${name}.intensity`, issues);
  oneOf(e.role, ROLES, `${where}.${name}.role`, issues);
  if (e.intensity === 0 && e.role !== 'absent') issues.push(`${where}.${name}: intensity 0 requires role absent`);
  if (e.role === 'absent' && e.intensity !== 0) issues.push(`${where}.${name}: role absent requires intensity 0`);
  if ('confidence' in e) oneOf(e.confidence, CONFIDENCE, `${where}.${name}.confidence`, issues);
  if ('notes' in e && typeof e.notes !== 'string') issues.push(`${where}.${name}.notes must be text`);
}

/** Structural checks matching listening.schema.json, plus the README's rules. */
export function checkAnnotationShape(a) {
  const issues = [];
  if (!isObj(a)) return ['the annotation must be a mapping'];
  onlyKeys(a, TOP_KEYS, 'annotation', issues);
  for (const k of TOP_KEYS) if (!(k in a)) issues.push(`missing ${k}`);
  if (a.format !== ANNOTATION_FORMAT) issues.push(`format must be ${ANNOTATION_FORMAT}`);
  oneOf(a.status, STATUS, 'status', issues);
  oneOf(a.perspective, PERSPECTIVE, 'perspective', issues);
  oneOf(a.basis, BASIS, 'basis', issues);
  for (const k of ['audio_file', 'listener']) if (a[k] !== null && typeof a[k] !== 'string') issues.push(`${k} must be text or null`);
  if (typeof a.summary !== 'string') issues.push('summary must be text');
  const reviewed = a.status === 'reviewed';
  if (reviewed) {
    if (!a.audio_file) issues.push('a reviewed annotation names its audio_file');
    if (!a.listener) issues.push('a reviewed annotation names its listener');
    if (!a.summary) issues.push('a reviewed annotation keeps the listener\'s summary');
  }
  for (const k of ['segments', 'trends', 'events']) if (!Array.isArray(a[k])) issues.push(`${k} must be a list`);
  if (reviewed && Array.isArray(a.segments) && !a.segments.length) issues.push('a reviewed annotation has at least one segment');

  (Array.isArray(a.segments) ? a.segments : []).forEach((s, i) => {
    const where = `segments[${i}]`;
    if (!isObj(s)) { issues.push(`${where} must be a mapping`); return; }
    onlyKeys(s, ['span', 'label', 'sound', 'emotions', 'affect', 'confidence', 'notes'], where, issues);
    const [start, end] = pair(s.span, `${where}.span`, issues);
    if (reviewed && (start === null || end === null)) issues.push(`${where}.span: a reviewed annotation has concrete times`);
    oneOf(s.confidence, CONFIDENCE, `${where}.confidence`, issues);
    for (const k of ['label', 'notes']) if (k in s && typeof s[k] !== 'string') issues.push(`${where}.${k} must be text`);
    if ('sound' in s) {
      if (!isObj(s.sound)) issues.push(`${where}.sound must be a mapping`);
      else {
        onlyKeys(s.sound, [...SOUND_RATINGS, 'pulse', 'groove'], `${where}.sound`, issues);
        for (const k of SOUND_RATINGS) rating(s.sound[k], `${where}.sound.${k}`, issues);
        if ('pulse' in s.sound) oneOf(s.sound.pulse, PULSE, `${where}.sound.pulse`, issues);
        if ('groove' in s.sound) oneOf(s.sound.groove, GROOVE, `${where}.sound.groove`, issues);
      }
    }
    if ('emotions' in s) {
      if (!isObj(s.emotions)) issues.push(`${where}.emotions must be a mapping`);
      else for (const [name, e] of Object.entries(s.emotions)) checkEmotion(name, e, `${where}.emotions`, issues);
    }
    if ('affect' in s) {
      if (!isObj(s.affect)) issues.push(`${where}.affect must be a mapping`);
      else {
        onlyKeys(s.affect, ['valence', 'arousal', 'tension'], `${where}.affect`, issues);
        rating(s.affect.valence, `${where}.affect.valence`, issues, -2, 2);
        rating(s.affect.arousal, `${where}.affect.arousal`, issues);
        rating(s.affect.tension, `${where}.affect.tension`, issues);
      }
    }
  });
  (Array.isArray(a.trends) ? a.trends : []).forEach((t, i) => {
    const where = `trends[${i}]`;
    if (!isObj(t)) { issues.push(`${where} must be a mapping`); return; }
    onlyKeys(t, ['span', 'target', 'direction', 'confidence', 'notes'], where, issues);
    const [start, end] = pair(t.span, `${where}.span`, issues);
    if (reviewed && (start === null || end === null)) issues.push(`${where}.span: a reviewed annotation has concrete times`);
    if (typeof t.target !== 'string' || !TREND_TARGET.test(t.target)) issues.push(`${where}.target ${JSON.stringify(t.target)} is not a ratable field`);
    oneOf(t.direction, ['rising', 'falling', 'stable'], `${where}.direction`, issues);
    oneOf(t.confidence, CONFIDENCE, `${where}.confidence`, issues);
  });
  (Array.isArray(a.events) ? a.events : []).forEach((e, i) => {
    const where = `events[${i}]`;
    if (!isObj(e)) { issues.push(`${where} must be a mapping`); return; }
    onlyKeys(e, ['within', 'type', 'from', 'to', 'confidence', 'notes'], where, issues);
    const [lo, hi] = pair(e.within, `${where}.within`, issues);
    if (reviewed && (lo === null || hi === null)) issues.push(`${where}.within: a reviewed annotation has concrete times`);
    if (e.type !== 'foreground_change') issues.push(`${where}.type must be foreground_change`);
    oneOf(e.from, EMOTIONS, `${where}.from`, issues);
    oneOf(e.to, EMOTIONS, `${where}.to`, issues);
    if (e.from === e.to) issues.push(`${where}: from and to must differ`);
    oneOf(e.confidence, CONFIDENCE, `${where}.confidence`, issues);
  });
  return issues;
}

function safetyIssues(doc) {
  const issues = [];
  for (const e of doc.errors) issues.push(`YAML ${e.code === 'DUPLICATE_KEY' ? 'duplicate key' : e.code === 'MULTIPLE_DOCS' ? 'has more than one document' : e.code}: ${e.message.split('\n')[0]}`);
  for (const w of doc.warnings) issues.push(`YAML ${w.code}: ${w.message.split('\n')[0]}`);
  visit(doc, {
    Node(_, node) {
      if (isAlias(node)) issues.push(`alias *${node.source} is not allowed`);
      else if (isNode(node)) {
        // Set only for an explicit tag in the source (!!str, !!js/..., !x);
        // implicit core-schema resolution leaves it unset.
        if (node.tag) issues.push(`explicit tag ${node.tag} is not allowed`);
        if (node.anchor) issues.push(`anchor &${node.anchor} is not allowed`);
      }
    },
  });
  return issues;
}

/**
 * Parse annotation YAML. Returns the annotation as written (original strings,
 * nulls and prose untouched) with `*Ms` times added; throws AnnotationError
 * with every issue found.
 */
export function parseAnnotation(text) {
  if (typeof text !== 'string') throw new AnnotationError(['annotation text must be a string']);
  const doc = parseDocument(text, { version: '1.2', schema: 'core', uniqueKeys: true, merge: false, prettyErrors: false });
  const unsafe = safetyIssues(doc);
  if (unsafe.length) throw new AnnotationError(unsafe);
  const a = doc.toJS({ maxAliasCount: 0 });
  const issues = checkAnnotationShape(a);
  if (issues.length) throw new AnnotationError(issues);
  return {
    ...a,
    segments: a.segments.map((s) => ({ ...s, spanMs: s.span.map(timestampMs) })),
    trends: a.trends.map((t) => ({ ...t, spanMs: t.span.map(timestampMs) })),
    events: a.events.map((e) => ({ ...e, withinMs: e.within.map(timestampMs) })),
  };
}
