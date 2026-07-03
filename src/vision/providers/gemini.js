// Google Gemini v1beta generateContent adapter. `x-goog-api-key` header
// (preferred over `?key=` in the URL — avoids proxy/history leaks); system
// prompt goes in `systemInstruction`; images are `inline_data` parts. No
// native JSON mode — relies on the system prompt + the clamping parser.
export function createGeminiAdapter({
  id = 'gemini',
  label = 'Google Gemini',
  defaultBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/models',
  defaultModel = 'gemini-2.5-flash',
} = {}) {
  return {
    id,
    label,
    defaultBaseUrl,
    defaultModel,
    supportsJsonMode: false,
    needsKey: true,

    buildRequest({ frames, telemetry, system, baseUrl, model, apiKey }) {
      const parts = [
        ...frames.map((b64) => ({
          inline_data: { mime_type: 'image/jpeg', data: b64 },
        })),
        { text: telemetry },
      ];
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 300 },
      };
      const url = `${baseUrl.replace(/\/$/, '')}/${model}:generateContent`;
      return {
        url,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      };
    },

    extractContent(data) {
      const parts = data?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) return '';
      return parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
    },
  };
}