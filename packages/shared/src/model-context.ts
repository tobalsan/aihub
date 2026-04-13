import openRouterData from "./model-context-data.json" with { type: "json" };

export const MODEL_MAX_CONTEXT: Record<string, number> = {
  opus: 200_000,
  sonnet: 200_000,
  haiku: 200_000,
  "gpt-5.4": 1_000_000,
  "gpt-5.3-codex": 1_000_000,
  "gpt-5.3-codex-spark": 200_000,
  "gpt-5.2": 128_000,
  "qwen3.5-plus": 128_000,
  "qwen3-max-2026-01-23": 128_000,
  "minimax-m2.5": 128_000,
  "glm-5": 128_000,
  "kimi-k2.5": 128_000,
};

export const DEFAULT_MAX_CONTEXT = 200_000;

const openRouterContextMap: Record<string, number> = openRouterData as Record<string, number>;

export function getMaxContextTokens(model?: string): number {
  if (!model) return DEFAULT_MAX_CONTEXT;

  // 1. Exact match in OpenRouter JSON
  if (openRouterContextMap[model] != null) {
    return openRouterContextMap[model];
  }

  // 2. Substring match in OpenRouter JSON (handles partial model names)
  const lowerModel = model.toLowerCase();
  let bestMatch = "";
  let bestValue = 0;
  for (const [key, value] of Object.entries(openRouterContextMap)) {
    if (lowerModel.includes(key.toLowerCase()) && key.length > bestMatch.length) {
      bestMatch = key;
      bestValue = value;
    }
  }
  if (bestMatch) return bestValue;

  // 3. Existing hardcoded fallback
  const entries = Object.entries(MODEL_MAX_CONTEXT).sort(
    ([left], [right]) => right.length - left.length
  );
  for (const [key, value] of entries) {
    if (lowerModel.includes(key.toLowerCase())) return value;
  }

  // 4. Default
  return DEFAULT_MAX_CONTEXT;
}
