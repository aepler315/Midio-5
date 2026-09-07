// Provider adapters for the vision self-tuning loop (VisionLoop.js). Every
// provider receives the same 4 frames + telemetry prompt and must return
// text that VisionLoop's schema parser can JSON.parse -- the request/response
// shapes differ, everything downstream of extractVisionContent() does not.
// Ollama stays the zero-setup default; the hosted providers require a
// user-supplied API key (never a key bundled with the app).
//
// Pure functions only (no fetch) below callVisionProvider, so the request
// builder and response extractor are unit-testable without a network or DOM.

export const VISION_PROVIDERS = {
  ollama: {
    label: 'Ollama (local)',
    endpoint: 'http://localhost:11434/api/chat',
    model: 'llava:13b',
    needsKey: false,
  },
  anthropic: {
    label: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-haiku-4-5-20251001',
    needsKey: true,
  },
  openai: {
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    needsKey: true,
  },
  gemini: {
    label: 'Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    model: 'gemini-1.5-flash',
    needsKey: true,
  },
  openrouter: {
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'meta-llama/llama-3.2-11b-vision-instruct:free',
    needsKey: true,
  },
};

/** Build the {url, options} fetch call for one provider. */
export function buildVisionRequest(provider, { apiKey, endpoint, model, systemPrompt, telemetry, frames }) {
  const cfg = VISION_PROVIDERS[provider] || VISION_PROVIDERS.ollama;
  const url = endpoint || cfg.endpoint;
  const mdl = model || cfg.model;

  switch (provider) {
    case 'anthropic':
      return {
        url,
        options: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            // Lets a key-holder call the API straight from the browser, same
            // as every other provider here -- there is no server hop in
            // this game to proxy through.
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: mdl,
            max_tokens: 400,
            system: systemPrompt,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: telemetry },
                ...frames.map((f) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f } })),
              ],
            }],
          }),
        },
      };

    case 'openai':
    case 'openrouter':
      return {
        url,
        options: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: mdl,
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: [
                  { type: 'text', text: telemetry },
                  ...frames.map((f) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${f}` } })),
                ],
              },
            ],
          }),
        },
      };

    case 'gemini': {
      const base = url.endsWith(':generateContent') ? url : `${url.replace(/\/$/, '')}/${mdl}:generateContent`;
      return {
        url: `${base}?key=${encodeURIComponent(apiKey)}`,
        options: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: `${systemPrompt}\n\n${telemetry}` },
                ...frames.map((f) => ({ inlineData: { mimeType: 'image/jpeg', data: f } })),
              ],
            }],
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
          }),
        },
      };
    }

    case 'ollama':
    default:
      return {
        url,
        options: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: mdl,
            stream: false,
            format: 'json',
            options: { temperature: 0.2, num_predict: 300 },
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: telemetry, images: frames },
            ],
          }),
        },
      };
  }
}

/** Pull the model's raw text out of whichever envelope this provider uses. */
export function extractVisionContent(provider, data) {
  switch (provider) {
    case 'anthropic':
      return data?.content?.[0]?.text ?? '';
    case 'openai':
    case 'openrouter':
      return data?.choices?.[0]?.message?.content ?? '';
    case 'gemini':
      return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    case 'ollama':
    default:
      return data?.message?.content ?? data?.response ?? '';
  }
}

/**
 * Fire one request at the configured provider. Returns the same
 * `{ message: { content } }` shape Ollama's API returns natively, so
 * VisionLoop.parseVisionResponse (and its tests) stay provider-agnostic and
 * unchanged. Throws on any transport/HTTP failure; the caller already
 * treats a thrown cycle as a silent no-op (spec: safe to fail 100% of the
 * time).
 */
export async function callVisionProvider(provider, opts) {
  const { url, options } = buildVisionRequest(provider, opts);
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(opts.timeoutMs ?? 20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const content = extractVisionContent(provider, data);
  return { message: { content } };
}
