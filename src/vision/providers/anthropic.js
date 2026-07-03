// Anthropic Messages API vision adapter. `x-api-key` + `anthropic-version`
// headers; the system prompt is a top-level `system` field (not a message);
// images are base64 `source` blocks. No native JSON mode — relies on the
// system prompt + the fence-stripping/clamping parser.
export function createAnthropicAdapter({
  id = 'anthropic',
  label = 'Anthropic',
  defaultBaseUrl = 'https://api.anthropic.com/v1/messages',
  defaultModel = 'claude-haiku-4-5-20251001',
} = {}) {
  return {
    id,
    label,
    defaultBaseUrl,
    defaultModel,
    supportsJsonMode: false,
    needsKey: true,

    buildRequest({ frames, telemetry, system, baseUrl, model, apiKey }) {
      const content = [
        ...frames.map((b64) => ({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
        })),
        { type: 'text', text: telemetry },
      ];
      const body = {
        model,
        max_tokens: 300,
        temperature: 0.2,
        system,
        messages: [{ role: 'user', content }],
      };
      return {
        url: baseUrl,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      };
    },

    extractContent(data) {
      const blocks = data?.content;
      if (!Array.isArray(blocks)) return '';
      return blocks.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('');
    },
  };
}