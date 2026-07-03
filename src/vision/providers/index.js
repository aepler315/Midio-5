// Provider registry. Each entry is a factory; the chosen adapter owns its
// request shape (auth header, image encoding, JSON mode) and response
// content extraction. `parseVisionResponse` (in VisionLoop.js) remains the
// single JSON validator across all of them.
import { createOllamaAdapter } from './ollama.js';
import { createOpenAIAdapter } from './openai.js';
import { createOpenRouterAdapter } from './openrouter.js';
import { createAnthropicAdapter } from './anthropic.js';
import { createGeminiAdapter } from './gemini.js';

const FACTORIES = {
  ollama: createOllamaAdapter,
  openai: createOpenAIAdapter,
  openrouter: createOpenRouterAdapter,
  anthropic: createAnthropicAdapter,
  gemini: createGeminiAdapter,
};

export const PROVIDER_IDS = Object.keys(FACTORIES);

export function getProvider(id) {
  const factory = FACTORIES[id] || FACTORIES.ollama;
  return factory();
}