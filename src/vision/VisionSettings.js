// Persisted vision-provider settings (provider, apiKey, baseUrl, model) for
// the self-tuning loop. localStorage-backed with an in-memory fallback when
// storage is unavailable (private browsing); tiny pub/sub so the form and the
// running VisionLoop can hot-apply changes without a reload.
import { getProvider } from './providers/index.js';

const STORAGE_KEY = 'smw.vision';

export const DEFAULTS = Object.freeze({
  provider: 'ollama',
  apiKey: '',
  baseUrl: '', // empty -> adapter default at resolve time
  model: '',   // empty -> adapter default at resolve time
});

function storage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function loadVisionSettings() {
  const base = { ...DEFAULTS };
  const s = storage();
  if (!s) return base;
  try {
    const parsed = JSON.parse(s.getItem(STORAGE_KEY) || '{}');
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.provider === 'string') base.provider = parsed.provider;
      if (typeof parsed.apiKey === 'string') base.apiKey = parsed.apiKey;
      if (typeof parsed.baseUrl === 'string') base.baseUrl = parsed.baseUrl;
      if (typeof parsed.model === 'string') base.model = parsed.model;
    }
  } catch { /* corrupt entry -> defaults */ }
  return base;
}

export function saveVisionSettings(partial) {
  const next = { ...loadVisionSettings(), ...partial };
  const s = storage();
  if (s) {
    try { s.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* quota / disabled */ }
  }
  _notify(next);
  return next;
}

// Load + fill empty baseUrl/model from the active adapter's defaults, and
// attach the resolved adapter. This is what VisionLoop and the form consume.
export function resolveSettings() {
  const stored = loadVisionSettings();
  const adapter = getProvider(stored.provider);
  return {
    ...stored,
    baseUrl: stored.baseUrl || adapter.defaultBaseUrl,
    model: stored.model || adapter.defaultModel,
    adapter,
  };
}

const _subs = new Set();
export function subscribe(cb) {
  _subs.add(cb);
  return () => _subs.delete(cb);
}
function _notify(next) {
  const resolved = resolveSettings();
  for (const cb of _subs) {
    try { cb(resolved); } catch { /* a bad subscriber never breaks the others */ }
  }
}