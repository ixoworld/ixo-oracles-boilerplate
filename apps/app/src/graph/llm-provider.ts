import {
  getChatOpenAiModel,
  getLLMProvider,
  getOpenRouterChatModel,
  type LLMProvider,
} from '@ixo/common';
import { Logger } from '@nestjs/common';

// Re-use ChatOpenAIFields type via the return type of getChatOpenAiModel
type ChatOpenAIFields = Parameters<typeof getChatOpenAiModel>[0];
type ChatOpenAIInstance = ReturnType<typeof getChatOpenAiModel>;

const NEBIUS_CONFIG = {
  baseURL: 'https://api.tokenfactory.nebius.com/v1/',
  apiKeyEnv: 'NEBIUS_API_KEY' as const,
};

const logger = new Logger('LLMProvider');

// ---------------------------------------------------------------------------
// Model role → provider model mapping
// ---------------------------------------------------------------------------
export type ModelRole =
  | 'main'
  | 'skills'
  | 'subagent'
  | 'vision'
  | 'guard'
  | 'routing'
  | 'session-title'
  | 'embedding';

const MODEL_MAP: Record<LLMProvider, Record<ModelRole, string>> = {
  openrouter: {
    main: 'moonshotai/kimi-k2-thinking',
    skills: 'moonshotai/kimi-k2-thinking',
    subagent: 'moonshotai/kimi-k2-thinking',
    vision: 'google/gemini-2.5-flash-lite',
    guard: 'meta-llama/llama-3.1-8b-instruct',
    routing: 'openai/gpt-oss-20b',
    'session-title': 'meta-llama/llama-3.1-8b-instruct',
    embedding: 'text-embedding-3-small',
  },
  nebius: {
    main: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
    skills: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
    subagent: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
    vision: 'Qwen/Qwen2.5-VL-72B-Instruct',
    guard: 'meta-llama/Llama-Guard-3-8B',
    routing: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
    'session-title': 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    embedding: 'Qwen/Qwen3-Embedding-8B',
  },
};

/** OpenRouter fallback models for the 'main' role (used via `models` array, sorted by latency). */
const OPENROUTER_MAIN_FALLBACKS = [
  'qwen/qwen3-235b-a22b-thinking-2507',
  'google/gemini-2.5-flash-lite',
];

/**
 * Get the model identifier for a given role, respecting the active provider.
 */
export function getModelForRole(role: ModelRole): string {
  return MODEL_MAP[getLLMProvider()][role];
}

// ---------------------------------------------------------------------------
// Provider-aware chat model factory
// ---------------------------------------------------------------------------

/**
 * Provider-aware chat model factory.
 * Uses LLM_PROVIDER env var to select OpenRouter or Nebius.
 * Pass a `role` to auto-resolve the model, or override with `params.model`.
 */
export const getProviderChatModel = (
  role: ModelRole,
  params?: ChatOpenAIFields,
): ChatOpenAIInstance => {
  const provider = getLLMProvider();
  const model = params?.model ?? getModelForRole(role);

  // Use NestJS Logger instead of console.log
  logger.log(
    `Creating model — provider=${provider}, role=${role}, model=${model}`,
  );

  if (provider === 'openrouter') {
    // For 'main' role, add fallback models sorted by latency
    const fallbackKwargs: Record<string, unknown> =
      role === 'main'
        ? {
            models: OPENROUTER_MAIN_FALLBACKS,
            provider: { sort: 'latency' },
          }
        : {};

    return getOpenRouterChatModel({
      ...params,
      model,
      __includeRawResponse: true,
      modelKwargs: {
        require_parameters: true,
        include_reasoning: true,
        ...fallbackKwargs,
        ...params?.modelKwargs,
      },
      reasoning: {
        effort: 'medium',
        ...params?.reasoning,
      },
    });
  }

  const apiKey = process.env[NEBIUS_CONFIG.apiKeyEnv];
  logger.log(
    `Nebius config — baseURL=${NEBIUS_CONFIG.baseURL}, apiKey=${apiKey ? 'set' : 'MISSING'}`,
  );

  // Use low temperature for classification models (guard), higher for generative
  const defaultTemp = role === 'guard' ? 0 : 0.8;

  return getChatOpenAiModel({
    temperature: defaultTemp,
    apiKey,
    __includeRawResponse: true,
    model,
    ...params,
    configuration: {
      baseURL: NEBIUS_CONFIG.baseURL,
      ...params?.configuration,
    },
  });
};

// ---------------------------------------------------------------------------
// Per-model pricing cache
// ---------------------------------------------------------------------------

export interface ModelPricing {
  inputPricePerMillionTokens: number;
  outputPricePerMillionTokens: number;
}

// All cache keys are stored normalized (lowercase, :suffix stripped).
const pricingCache = new Map<string, ModelPricing>();

/** Normalize model ID for cache lookups: lowercase + strip :suffix (e.g. ":nitro"). */
function normalizeModelId(id: string): string {
  let normalized = id.toLowerCase();
  const colonIdx = normalized.lastIndexOf(':');
  if (colonIdx > 0) {
    normalized = normalized.slice(0, colonIdx);
  }
  return normalized;
}

/**
 * Collect all normalized model IDs referenced in MODEL_MAP + fallbacks.
 */
function getUsedModelIds(): Set<string> {
  const ids = new Set<string>();
  for (const providerModels of Object.values(MODEL_MAP)) {
    for (const modelId of Object.values(providerModels)) {
      ids.add(normalizeModelId(modelId));
    }
  }
  for (const modelId of OPENROUTER_MAIN_FALLBACKS) {
    ids.add(normalizeModelId(modelId));
  }
  return ids;
}

async function fetchNebiusPricing(usedModels: Set<string>): Promise<void> {
  const apiKey = process.env[NEBIUS_CONFIG.apiKeyEnv];
  if (!apiKey) return;

  try {
    const res = await fetch(
      'https://api.tokenfactory.nebius.com/proxy/inference/private/v1/models_info',
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!res.ok) {
      logger.warn(
        `Nebius pricing fetch failed: ${res.status} ${res.statusText}`,
      );
      return;
    }
    const data = (await res.json()) as {
      flavors?: Array<{
        model_id: string;
        input_price_per_million_tokens?: number;
        output_price_per_million_tokens?: number;
      }>;
    };
    let matched = 0;
    for (const flavor of data.flavors ?? []) {
      const normalized = normalizeModelId(flavor.model_id);
      if (!usedModels.has(normalized)) continue;
      if (
        flavor.input_price_per_million_tokens != null &&
        flavor.output_price_per_million_tokens != null
      ) {
        pricingCache.set(normalized, {
          inputPricePerMillionTokens: flavor.input_price_per_million_tokens,
          outputPricePerMillionTokens: flavor.output_price_per_million_tokens,
        });
        matched++;
      }
    }
    logger.log(
      `Nebius pricing: ${matched} matched out of ${(data.flavors ?? []).length} flavors`,
    );
  } catch (err) {
    logger.warn(`Failed to fetch Nebius pricing:`, err);
  }
}

async function fetchOpenRouterPricing(usedModels: Set<string>): Promise<void> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) {
      logger.warn(
        `OpenRouter pricing fetch failed: ${res.status} ${res.statusText}`,
      );
      return;
    }
    const data = (await res.json()) as {
      data?: Array<{
        id: string;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };
    let matched = 0;
    for (const model of data.data ?? []) {
      const normalized = normalizeModelId(model.id);
      if (!usedModels.has(normalized)) continue;
      const prompt = parseFloat(model.pricing?.prompt ?? '');
      const completion = parseFloat(model.pricing?.completion ?? '');
      if (!isNaN(prompt) && !isNaN(completion)) {
        pricingCache.set(normalized, {
          inputPricePerMillionTokens: prompt * 1_000_000,
          outputPricePerMillionTokens: completion * 1_000_000,
        });
        matched++;
      }
    }
    logger.log(
      `OpenRouter pricing: ${matched} matched out of ${(data.data ?? []).length} models`,
    );
  } catch (err) {
    logger.warn(`Failed to fetch OpenRouter pricing:`, err);
  }
}

/**
 * Initialize the model pricing cache. Call once on startup.
 * Fetches pricing from both providers in parallel; failures are logged but don't block.
 */
export async function initModelPricingCache(): Promise<void> {
  const usedModels = getUsedModelIds();
  logger.log(`Fetching pricing for models: ${[...usedModels].join(', ')}`);
  await Promise.all([
    fetchNebiusPricing(usedModels),
    fetchOpenRouterPricing(usedModels),
  ]);

  // Hardcode text-embedding-3-small — not listed in OpenRouter /models API
  if (!pricingCache.has('text-embedding-3-small')) {
    pricingCache.set('text-embedding-3-small', {
      inputPricePerMillionTokens: 0.019,
      outputPricePerMillionTokens: 0,
    });
  }

  logger.log(
    `Loaded pricing for ${pricingCache.size} models: ${[...pricingCache.keys()].join(', ')}`,
  );
}

/**
 * Look up per-model pricing. Returns null if not cached.
 * Normalizes the model ID (lowercase, strips :suffix) before lookup.
 */
export function getModelPricing(modelId: string): ModelPricing | null {
  return pricingCache.get(normalizeModelId(modelId)) ?? null;
}

// ---------------------------------------------------------------------------
// Provider config
// ---------------------------------------------------------------------------

/**
 * Provider-aware base URL and API key for raw fetch calls (e.g. file processing).
 */
export function getProviderConfig() {
  const provider = getLLMProvider();

  if (provider === 'nebius') {
    return {
      provider,
      baseURL: NEBIUS_CONFIG.baseURL,
      apiKey: process.env[NEBIUS_CONFIG.apiKeyEnv] ?? '',
      headers: {} as Record<string, string>,
    };
  }

  return {
    provider,
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPEN_ROUTER_API_KEY ?? '',
    headers: {
      'HTTP-Referer': 'oracle-app.com',
      'X-Title': process.env.ORACLE_NAME ?? 'Oracle App',
    },
  };
}

export { getLLMProvider };
