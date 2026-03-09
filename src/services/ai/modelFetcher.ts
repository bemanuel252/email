import type { AiProvider, ModelOption } from "./types";
import { PROVIDER_MODELS } from "./types";

const CLOUD_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  models: ModelOption[];
  fetchedAt: number;
}

// In-memory cache keyed by `${provider}:${last8ofKey}`
const cache = new Map<string, CacheEntry>();

function cacheKey(provider: AiProvider, apiKey: string): string {
  return `${provider}:${apiKey.slice(-8)}`;
}

function formatModelLabel(id: string): string {
  // Turn "claude-sonnet-4-20250514" → "Claude Sonnet 4 (2025-05-14)"
  // Turn "gpt-4o-mini" → "GPT-4o Mini"
  // For Anthropic models with date suffix
  const anthropicMatch = id.match(/^(claude-[\w-]+?)(?:-(\d{8}))?$/);
  if (anthropicMatch) {
    const base = anthropicMatch[1]!
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    if (anthropicMatch[2]) {
      const d = anthropicMatch[2];
      return `${base} (${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)})`;
    }
    return base;
  }
  return id;
}

async function fetchClaudeModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) throw new Error(`Anthropic API: HTTP ${res.status}`);
  const data = await res.json();
  const models: ModelOption[] = (data.data ?? []).map((m: { id: string; display_name?: string }) => ({
    id: m.id,
    label: m.display_name ?? formatModelLabel(m.id),
  }));
  // Newest first (ids are lexicographically sortable by date suffix)
  return models.sort((a, b) => b.id.localeCompare(a.id));
}

const OPENAI_CHAT_PREFIXES = ["gpt-4", "gpt-3.5", "o1", "o3", "o4", "chatgpt"];

async function fetchOpenAIModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OpenAI API: HTTP ${res.status}`);
  const data = await res.json();
  const models: ModelOption[] = (data.data ?? [])
    .filter(
      (m: { id: string; owned_by?: string }) =>
        OPENAI_CHAT_PREFIXES.some((p) => m.id.startsWith(p)) &&
        !m.id.includes("instruct") &&
        !m.id.includes("embedding") &&
        !m.id.includes("whisper") &&
        !m.id.includes("tts") &&
        !m.id.includes("dall-e") &&
        m.owned_by !== "openai-internal",
    )
    .map((m: { id: string }) => ({ id: m.id, label: m.id }));
  return models.sort((a, b) => b.id.localeCompare(a.id));
}

async function fetchGeminiModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=50`,
  );
  if (!res.ok) throw new Error(`Gemini API: HTTP ${res.status}`);
  const data = await res.json();
  const models: ModelOption[] = (data.models ?? [])
    .filter((m: { supportedGenerationMethods?: string[] }) =>
      m.supportedGenerationMethods?.includes("generateContent"),
    )
    .map((m: { name: string; displayName?: string }) => ({
      id: m.name.replace("models/", ""),
      label: m.displayName ?? m.name.replace("models/", ""),
    }));
  return models.sort((a, b) => a.label.localeCompare(b.label));
}

async function fetchCopilotModels(pat: string): Promise<ModelOption[]> {
  const res = await fetch("https://models.github.ai/catalog/models", {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GitHub Models API: HTTP ${res.status}`);
  const data = await res.json();
  const models: ModelOption[] = (Array.isArray(data) ? data : [])
    .filter(
      (m: { supported_output_modalities?: string[]; tags?: string[] }) =>
        m.supported_output_modalities?.includes("text") &&
        !m.tags?.includes("embedding") &&
        !m.tags?.includes("image-generation"),
    )
    .map((m: { id: string; name?: string }) => ({
      id: m.id,
      label: m.name ?? m.id,
    }));
  return models.sort((a, b) => a.label.localeCompare(b.label));
}

async function fetchOllamaModels(serverUrl: string): Promise<ModelOption[]> {
  const base = serverUrl.replace(/\/$/, "") || "http://localhost:11434";
  const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Ollama: HTTP ${res.status}`);
  const data = await res.json();
  return (data.models ?? []).map((m: { name: string }) => ({
    id: m.name,
    label: m.name,
  }));
}

export interface FetchModelsResult {
  models: ModelOption[];
  fetchedAt: number | null;
  error: string | null;
}

export async function fetchModels(
  provider: AiProvider,
  apiKey: string,
  ollamaServerUrl?: string,
): Promise<FetchModelsResult> {
  const key = cacheKey(provider, apiKey);
  const now = Date.now();

  // Ollama: always fresh (local, fast)
  // Cloud: serve cache if still within TTL
  if (provider !== "ollama") {
    const cached = cache.get(key);
    if (cached && now - cached.fetchedAt < CLOUD_TTL_MS) {
      return { models: cached.models, fetchedAt: cached.fetchedAt, error: null };
    }
  }

  try {
    let models: ModelOption[];
    switch (provider) {
      case "claude":
        models = await fetchClaudeModels(apiKey);
        break;
      case "openai":
        models = await fetchOpenAIModels(apiKey);
        break;
      case "gemini":
        models = await fetchGeminiModels(apiKey);
        break;
      case "copilot":
        models = await fetchCopilotModels(apiKey);
        break;
      case "ollama":
        models = await fetchOllamaModels(ollamaServerUrl ?? "http://localhost:11434");
        break;
    }

    if (models.length > 0) {
      cache.set(key, { models, fetchedAt: now });
      return { models, fetchedAt: now, error: null };
    }
    // Empty list — fall through to fallback
    throw new Error("No models returned");
  } catch (err) {
    const fallback = provider !== "ollama" ? (PROVIDER_MODELS[provider] ?? []) : [];
    return {
      models: fallback,
      fetchedAt: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function clearModelCache(provider?: AiProvider): void {
  if (provider) {
    for (const key of cache.keys()) {
      if (key.startsWith(`${provider}:`)) cache.delete(key);
    }
  } else {
    cache.clear();
  }
}
