import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
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

async function fetchClaudeModels(apiKey: string): Promise<ModelOption[]> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const list = await client.models.list({ limit: 100 });
  const models: ModelOption[] = list.data.map((m) => ({
    id: m.id,
    label: m.display_name ?? m.id,
  }));
  // Newest first
  return models.sort((a, b) => b.id.localeCompare(a.id));
}

const OPENAI_CHAT_PREFIXES = ["gpt-4", "gpt-3.5", "o1", "o3", "o4", "chatgpt"];

async function fetchOpenAIModels(apiKey: string): Promise<ModelOption[]> {
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  const list = await client.models.list();
  const models: ModelOption[] = list.data
    .filter(
      (m) =>
        OPENAI_CHAT_PREFIXES.some((p) => m.id.startsWith(p)) &&
        !m.id.includes("instruct") &&
        !m.id.includes("embedding") &&
        !m.id.includes("whisper") &&
        !m.id.includes("tts") &&
        !m.id.includes("dall-e") &&
        m.owned_by !== "openai-internal",
    )
    .map((m) => ({ id: m.id, label: m.id }));
  return models.sort((a, b) => b.id.localeCompare(a.id));
}

async function fetchGeminiModels(apiKey: string): Promise<ModelOption[]> {
  // GoogleGenerativeAI SDK doesn't expose model listing — use REST (supports CORS via API key in query)
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=50`,
  );
  if (!res.ok) throw new Error(`Gemini API: HTTP ${res.status}`);
  const data = await res.json();
  // Validate it's a Gemini response, not an HTML CORS error page
  if (!data.models && !Array.isArray(data.models)) {
    if (data.error) throw new Error(data.error.message ?? "Gemini API error");
  }
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
  // GitHub Models uses OpenAI-compatible API
  const client = new OpenAI({
    apiKey: pat,
    baseURL: "https://models.github.ai/inference",
    defaultHeaders: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    dangerouslyAllowBrowser: true,
  });
  const list = await client.models.list();
  const models: ModelOption[] = list.data
    .filter(
      (m) =>
        // @ts-expect-error GitHub models API includes extra fields
        (m.supported_output_modalities == null || m.supported_output_modalities.includes("text")) &&
        // @ts-expect-error
        !m.tags?.includes("embedding") &&
        // @ts-expect-error
        !m.tags?.includes("image-generation"),
    )
    .map((m) => ({
      id: m.id,
      // @ts-expect-error GitHub models API includes name field
      label: (m.name as string | undefined) ?? m.id,
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
