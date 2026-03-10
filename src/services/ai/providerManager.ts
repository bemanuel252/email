import { getSetting, getSecureSetting } from "@/services/db/settings";
import { AiError } from "./errors";
import type { AiProvider, AiProviderClient, ModelOption } from "./types";
import { DEFAULT_MODELS, MODEL_SETTINGS, PROVIDER_MODELS } from "./types";
import { createClaudeProvider, clearClaudeProvider } from "./providers/claudeProvider";
import { createOpenAIProvider, clearOpenAIProvider } from "./providers/openaiProvider";
import { createGeminiProvider, clearGeminiProvider } from "./providers/geminiProvider";
import { createOllamaProvider, clearOllamaProvider } from "./providers/ollamaProvider";
import { createCopilotProvider, clearCopilotProvider } from "./providers/copilotProvider";

const API_KEY_SETTINGS: Record<Exclude<AiProvider, "ollama">, string> = {
  claude: "claude_api_key",
  openai: "openai_api_key",
  gemini: "gemini_api_key",
  copilot: "copilot_api_key",
};

let cachedProvider: { name: AiProvider; key: string; client: AiProviderClient } | null = null;

export async function getActiveProviderName(): Promise<AiProvider> {
  const setting = await getSetting("ai_provider");
  if (setting === "openai" || setting === "gemini" || setting === "ollama" || setting === "copilot") return setting;
  return "claude";
}

export async function getActiveProvider(): Promise<AiProviderClient> {
  const providerName = await getActiveProviderName();

  if (providerName === "ollama") {
    const serverUrl = (await getSetting("ollama_server_url")) ?? "http://localhost:11434";
    const model = (await getSetting("ollama_model")) ?? "llama3.2";
    const cacheKey = `${serverUrl}|${model}`;

    if (cachedProvider && cachedProvider.name === "ollama" && cachedProvider.key === cacheKey) {
      return cachedProvider.client;
    }

    const client = createOllamaProvider(serverUrl, model);
    cachedProvider = { name: "ollama", key: cacheKey, client };
    return client;
  }

  const keySetting = API_KEY_SETTINGS[providerName];
  const apiKey = await getSecureSetting(keySetting);

  if (!apiKey) {
    throw new AiError("NOT_CONFIGURED", `${providerName} API key not configured`);
  }

  const model = (await getSetting(MODEL_SETTINGS[providerName])) ?? DEFAULT_MODELS[providerName];
  const cacheKey = `${apiKey}|${model}`;

  if (cachedProvider && cachedProvider.name === providerName && cachedProvider.key === cacheKey) {
    return cachedProvider.client;
  }

  let client: AiProviderClient;
  switch (providerName) {
    case "claude":
      client = createClaudeProvider(apiKey, model);
      break;
    case "openai":
      client = createOpenAIProvider(apiKey, model);
      break;
    case "gemini":
      client = createGeminiProvider(apiKey, model);
      break;
    case "copilot":
      client = createCopilotProvider(apiKey, model);
      break;
  }

  cachedProvider = { name: providerName, key: cacheKey, client };
  return client;
}

export async function isAiAvailable(): Promise<boolean> {
  try {
    const enabled = await getSetting("ai_enabled");
    if (enabled === "false") return false;
    const providerName = await getActiveProviderName();

    if (providerName === "ollama") {
      const serverUrl = await getSetting("ollama_server_url");
      return !!serverUrl;
    }

    const keySetting = API_KEY_SETTINGS[providerName];
    const key = await getSecureSetting(keySetting);
    return !!key;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Configured provider discovery
// ---------------------------------------------------------------------------

export const PROVIDER_DISPLAY_NAMES: Record<AiProvider, string> = {
  claude: "Claude",
  openai: "OpenAI",
  gemini: "Gemini",
  ollama: "Ollama",
  copilot: "GitHub Copilot",
};

/** One provider group shown in the chat model picker */
export interface ConfiguredProvider {
  provider: AiProvider;
  providerLabel: string;      // e.g. "Claude"
  activeModel: string;        // currently configured model for this provider
  models: ModelOption[];      // all selectable models for this provider
}

export async function getConfiguredProviders(): Promise<ConfiguredProvider[]> {
  const enabled = await getSetting("ai_enabled");
  if (enabled === "false") return [];

  const results: ConfiguredProvider[] = [];

  for (const [prov, keySetting] of Object.entries(API_KEY_SETTINGS) as [
    Exclude<AiProvider, "ollama">,
    string,
  ][]) {
    const key = await getSecureSetting(keySetting);
    if (!key) continue;
    const activeModel = (await getSetting(MODEL_SETTINGS[prov])) ?? DEFAULT_MODELS[prov];
    results.push({
      provider: prov,
      providerLabel: PROVIDER_DISPLAY_NAMES[prov],
      activeModel,
      models: PROVIDER_MODELS[prov] ?? [],
    });
  }

  // Ollama: use fetched model list from settings (ollama_model is just the active one;
  // we don't have a static list, so show just the active model)
  const ollamaUrl = await getSetting("ollama_server_url");
  if (ollamaUrl) {
    const activeModel = (await getSetting("ollama_model")) ?? DEFAULT_MODELS["ollama"];
    results.push({
      provider: "ollama",
      providerLabel: "Ollama",
      activeModel,
      models: [{ id: activeModel, label: activeModel }],
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Named provider lookup (for per-session overrides)
// ---------------------------------------------------------------------------

export async function getNamedProvider(
  provider: AiProvider,
  model: string,
): Promise<AiProviderClient> {
  if (provider === "ollama") {
    const serverUrl = (await getSetting("ollama_server_url")) ?? "http://localhost:11434";
    return createOllamaProvider(serverUrl, model);
  }

  const keySetting = API_KEY_SETTINGS[provider];
  const apiKey = await getSecureSetting(keySetting);
  if (!apiKey) {
    throw new AiError("NOT_CONFIGURED", `${provider} API key not configured`);
  }

  switch (provider) {
    case "claude":
      return createClaudeProvider(apiKey, model);
    case "openai":
      return createOpenAIProvider(apiKey, model);
    case "gemini":
      return createGeminiProvider(apiKey, model);
    case "copilot":
      return createCopilotProvider(apiKey, model);
  }
}

export function clearProviderClients(): void {
  cachedProvider = null;
  clearClaudeProvider();
  clearOpenAIProvider();
  clearGeminiProvider();
  clearOllamaProvider();
  clearCopilotProvider();
}
