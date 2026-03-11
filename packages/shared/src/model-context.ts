export const MODEL_MAX_CONTEXT: Record<string, number> = {
  opus: 200_000,
  sonnet: 200_000,
  haiku: 200_000,
  "gpt-5.4": 200_000,
  "gpt-5.3-codex": 200_000,
  "gpt-5.3-codex-spark": 200_000,
  "gpt-5.2": 128_000,
  "qwen3.5-plus": 128_000,
  "qwen3-max-2026-01-23": 128_000,
  "minimax-m2.5": 128_000,
  "glm-5": 128_000,
  "kimi-k2.5": 128_000,
};

export const DEFAULT_MAX_CONTEXT = 200_000;

export function getMaxContextTokens(model?: string): number {
  if (!model) return DEFAULT_MAX_CONTEXT;
  const lowerModel = model.toLowerCase();
  for (const [key, value] of Object.entries(MODEL_MAX_CONTEXT)) {
    if (lowerModel.includes(key.toLowerCase())) {
      return value;
    }
  }
  return DEFAULT_MAX_CONTEXT;
}
