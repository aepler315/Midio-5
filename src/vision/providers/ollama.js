// Ollama local vision adapter. No auth; bare-base64 `images` array; native
// JSON mode via `format:'json'`. Default endpoint is the local Ollama server.
export function createOllamaAdapter({
  id = 'ollama',
  label = 'Ollama (local)',
  defaultBaseUrl = 'http://localhost:11434/api/chat',
  defaultModel = 'llava:13b',
} = {}) {
  return {
    id,
    label,
    defaultBaseUrl,
    defaultModel,
    supportsJsonMode: true,
    needsKey: false,

    buildRequest({ frames, telemetry, system, baseUrl, model, jsonMode = true }) {
      const body = {
        model,
        stream: false,
        options: { temperature: 0.2, num_predict: 300 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: telemetry, images: frames.slice() },
        ],
      };
      if (jsonMode) body.format = 'json';
      return { url: baseUrl, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    },

    extractContent(data) {
      return data?.message?.content ?? data?.response ?? '';
    },
  };
}