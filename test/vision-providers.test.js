import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProvider, PROVIDER_IDS } from '../src/vision/providers/index.js';
import { parseVisionResponse } from '../src/vision/VisionLoop.js';

const FRAMES = ['AAAA', 'BBBB'];
const ARGS = (a, apiKey = 'secret') => ({
  frames: FRAMES,
  telemetry: 'TEL',
  system: 'SYS',
  baseUrl: a.defaultBaseUrl,
  model: a.defaultModel,
  apiKey,
});

// Recursively walk a value; assert the API key never appears in the request
// body (it must live only in the auth header).
function deepHas(obj, needle) {
  if (obj == null) return false;
  if (typeof obj === 'string') return obj.includes(needle);
  if (Array.isArray(obj)) return obj.some((v) => deepHas(v, needle));
  if (typeof obj === 'object') return Object.values(obj).some((v) => deepHas(v, needle));
  return false;
}

const VALID = {
  observations: { eq_motion: 1, speed_match: 0, companion_weight: 2, clutter: 0, notes: 'ok' },
  adjust: { jumpHeight: 1.1, obstacleDensity: 1.0, scrollSpeed: 1.0, eqSensitivity: 1.0, onsetThreshold: 1.0 },
  confidence: 0.8,
};

test('every provider id is wired and produces a fetch triple', () => {
  for (const id of PROVIDER_IDS) {
    const a = getProvider(id);
    const r = a.buildRequest(ARGS(a));
    assert.ok(r.url, `${id}: url missing`);
    assert.ok(r.headers && r.body, `${id}: headers/body missing`);
    assert.equal(typeof r.body, 'string', `${id}: body must be a string`);
  }
});

test('ollama: bare-base64 images, no auth header, json mode', () => {
  const a = getProvider('ollama');
  const r = a.buildRequest(ARGS(a));
  const body = JSON.parse(r.body);
  assert.equal(a.needsKey, false);
  assert.equal(a.supportsJsonMode, true);
  assert.equal(body.format, 'json');
  assert.deepEqual(body.messages[1].images, FRAMES);
  assert.equal(r.headers.Authorization, undefined);
  assert.equal(r.headers['x-api-key'], undefined);
});

test('openai: Bearer auth, data-uri image parts, response_format json', () => {
  const a = getProvider('openai');
  const r = a.buildRequest(ARGS(a));
  const body = JSON.parse(r.body);
  assert.equal(a.needsKey, true);
  assert.equal(r.headers.Authorization, 'Bearer secret');
  assert.equal(body.response_format.type, 'json_object');
  const img = body.messages[1].content[0];
  assert.equal(img.type, 'image_url');
  assert.equal(img.image_url.url, 'data:image/jpeg;base64,AAAA');
  assert.equal(body.messages[1].content.at(-1).text, 'TEL');
});

test('anthropic: x-api-key + anthropic-version, top-level system, base64 image source', () => {
  const a = getProvider('anthropic');
  const r = a.buildRequest(ARGS(a));
  const body = JSON.parse(r.body);
  assert.equal(a.needsKey, true);
  assert.equal(a.supportsJsonMode, false);
  assert.equal(r.headers['x-api-key'], 'secret');
  assert.equal(r.headers['anthropic-version'], '2023-06-01');
  assert.equal(body.system, 'SYS');
  assert.equal(body.messages[0].content[0].source.data, 'AAAA');
  assert.equal(body.messages[0].content.at(-1).text, 'TEL');
});

test('gemini: x-goog-api-key header (not URL ?key=), inline_data, systemInstruction', () => {
  const a = getProvider('gemini');
  const r = a.buildRequest(ARGS(a));
  const body = JSON.parse(r.body);
  assert.equal(a.needsKey, true);
  assert.equal(r.headers['x-goog-api-key'], 'secret');
  assert.ok(!r.url.includes('key='), 'gemini key must not leak into the URL');
  assert.ok(r.url.endsWith(':generateContent'));
  assert.equal(body.systemInstruction.parts[0].text, 'SYS');
  assert.equal(body.contents[0].parts[0].inline_data.data, 'AAAA');
  assert.equal(body.contents[0].parts.at(-1).text, 'TEL');
});

test('openrouter reuses the OpenAI shape with a different base url', () => {
  const or = getProvider('openrouter');
  const oai = getProvider('openai');
  const orReq = or.buildRequest(ARGS(or));
  const oaiReq = oai.buildRequest(ARGS(oai));
  assert.equal(or.id, 'openrouter');
  assert.notEqual(or.defaultBaseUrl, oai.defaultBaseUrl);
  // Same request shape, only url + model differ.
  const orBody = JSON.parse(orReq.body);
  const oaiBody = JSON.parse(oaiReq.body);
  assert.deepEqual(orBody.messages, oaiBody.messages);
  assert.deepEqual(orBody.response_format, oaiBody.response_format);
  assert.equal(orReq.headers.Authorization, 'Bearer secret');
});

test('the api key never appears in the request body of any provider', () => {
  for (const id of PROVIDER_IDS) {
    const a = getProvider(id);
    const r = a.buildRequest(ARGS(a));
    const body = JSON.parse(r.body);
    assert.equal(deepHas(body, 'secret'), false, `${id}: key leaked into body`);
  }
});

test('extractContent pulls the right string from each provider response shape, then parses', () => {
  const cases = [
    ['ollama', { message: { content: JSON.stringify(VALID) } }],
    ['openai', { choices: [{ message: { content: JSON.stringify(VALID) } }] }],
    ['openrouter', { choices: [{ message: { content: JSON.stringify(VALID) } }] }],
    ['anthropic', { content: [{ type: 'text', text: JSON.stringify(VALID) }] }],
    ['gemini', { candidates: [{ content: { parts: [{ text: JSON.stringify(VALID) }] } }] }],
  ];
  for (const [id, data] of cases) {
    const a = getProvider(id);
    const parsed = parseVisionResponse(a.extractContent(data));
    assert.ok(parsed, `${id}: extractContent -> parseVisionResponse failed`);
    assert.equal(parsed.adjust.jumpHeight, 1.1);
  }
});

test('extractContent returns empty string on a malformed response, parser rejects it', () => {
  for (const id of PROVIDER_IDS) {
    const a = getProvider(id);
    assert.equal(a.extractContent({}), '');
    assert.equal(parseVisionResponse(a.extractContent({})), null);
  }
});

test('jsonMode:false omits the JSON-mode field (prompt-only fallback shape)', () => {
  const ollama = getProvider('ollama');
  const oBody = JSON.parse(ollama.buildRequest({ ...ARGS(ollama), jsonMode: false }).body);
  assert.equal(oBody.format, undefined);

  const openai = getProvider('openai');
  const wBody = JSON.parse(openai.buildRequest({ ...ARGS(openai), jsonMode: false }).body);
  assert.equal(wBody.response_format, undefined);

  // Adapters without native JSON mode ignore the flag entirely.
  const anth = getProvider('anthropic');
  const aBody = JSON.parse(anth.buildRequest({ ...ARGS(anth), jsonMode: false }).body);
  assert.equal(aBody.system, 'SYS');
});