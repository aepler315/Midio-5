// OpenRouter is an OpenAI-compatible gateway — same request/response shape,
// different default base URL. Reuses the OpenAI adapter factory verbatim.
import { createOpenAIAdapter } from './openai.js';

export function createOpenRouterAdapter() {
  return createOpenAIAdapter({
    id: 'openrouter',
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'google/gemini-2.5-flash', // a multimodal OpenRouter route
  });
}