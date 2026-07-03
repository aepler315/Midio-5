// OpenAI vision adapter (chat completions). Bearer auth; images as data-URI
// content parts; native JSON mode via `response_format` (not every model
// accepts it — 400s are caught by the caller's global try/catch and retried
// next cycle on prompt-only parsing). Reused by OpenRouter (different base URL).
export function createOpenAIAdapter({
  id = 'openai',
  label = 'OpenAI',
  defaultBaseUrl = 'https://api.openai.com/v1/chat/completions',
  defaultModel = 'gpt-4o-mini',
} = {}) {
  return {
    id,
    label,
    defaultBaseUrl,
    defaultModel,
    supportsJsonMode: true,
    needsKey: true,

    buildRequest({ frames, telemetry, system, baseUrl, model, apiKey, jsonMode = true }) {
      const content = [
        ...frames.map((b64) => ({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${b64}` },
        })),
        { type: 'text', text: telemetry },
      ];
      const body = {
        model,
        temperature: 0.2,
        max_tokens: 300,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content },
        ],
      };
      // Some OpenAI/OpenRouter vision models reject response_format with a
      // 400. The caller drops to prompt-only (jsonMode=false) and retries.
      if (jsonMode) body.response_format = { type: 'json_object' };
      return {
        url: baseUrl,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      };
    },

    extractContent(data) {
      return data?.choices?.[0]?.message?.content ?? '';
    },
  };
}