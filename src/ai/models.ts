// ─── OpenRouter Model Registry ───────────────────────
// Fetches all available models from OpenRouter and caches them in IndexedDB.

import { db, getSetting, setSetting } from '../db';

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing: {
    prompt: string;
    completion: string;
    image?: string;
    request?: string;
  };
  context_length: number;
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string;
  };
  top_provider?: {
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
}

const API_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_KEY = 'openrouter_models_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ─── Fetch from API ──────────────────────────────────

async function fetchModelsFromAPI(): Promise<OpenRouterModel[]> {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

// ─── Cache in IndexedDB ──────────────────────────────

interface ModelCache {
  key: string;
  models: OpenRouterModel[];
  fetchedAt: number;
}

async function getCachedModels(): Promise<OpenRouterModel[] | null> {
  const cached = await db.settings.get(CACHE_KEY);
  if (!cached) return null;
  try {
    const parsed: ModelCache = JSON.parse(cached.value);
    if (Date.now() - parsed.fetchedAt < CACHE_TTL) {
      return parsed.models;
    }
  } catch {}
  return null;
}

async function cacheModels(models: OpenRouterModel[]): Promise<void> {
  const cache: ModelCache = {
    key: CACHE_KEY,
    models,
    fetchedAt: Date.now(),
  };
  await db.settings.put({ key: CACHE_KEY, value: JSON.stringify(cache) });
}

// ─── Public API ──────────────────────────────────────

export async function fetchModels(forceRefresh = false): Promise<OpenRouterModel[]> {
  if (!forceRefresh) {
    const cached = await getCachedModels();
    if (cached) return cached;
  }

  try {
    const models = await fetchModelsFromAPI();
    await cacheModels(models);
    return models;
  } catch (err) {
    // Fallback to stale cache if API fails
    const cached = await getCachedModels();
    if (cached) return cached;
    throw err;
  }
}

export function isFree(model: OpenRouterModel): boolean {
  return model.pricing?.prompt === '0' && model.pricing?.completion === '0';
}

export function filterModels(
  models: OpenRouterModel[],
  freeOnly: boolean
): OpenRouterModel[] {
  let filtered = models;
  if (freeOnly) {
    filtered = models.filter(isFree);
  }
  // Sort: free first, then by name
  return filtered.sort((a, b) => {
    const aFree = isFree(a);
    const bFree = isFree(b);
    if (aFree !== bFree) return aFree ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function getFreeOnlySetting(): Promise<boolean> {
  const val = await getSetting('free_only_models');
  return val === 'true';
}

export async function setFreeOnlySetting(freeOnly: boolean): Promise<void> {
  await setSetting('free_only_models', freeOnly.toString());
}

// Popular model IDs for quick selection
export const POPULAR_MODELS = [
  'xiaomi/mimo-v2.5',
  'openai/gpt-4o-mini',
  'anthropic/claude-3.5-sonnet',
  'google/gemini-2.0-flash-001',
  'meta-llama/llama-3.1-8b-instruct',
] as const;
