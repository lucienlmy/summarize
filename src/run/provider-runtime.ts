import type { SummarizeConfig } from "../config.js";
import { resolveGitHubModelsApiKey } from "../llm/github-models.js";
import type { ProviderRuntimeBindings } from "../llm/provider-profile.js";
import { parseBooleanEnv } from "./env.js";
import type { EnvState } from "./run-env.js";

export function resolveOpenAiUseChatCompletions({
  env,
  configForCli,
}: {
  env: Record<string, string | undefined>;
  configForCli: SummarizeConfig | null;
}): boolean | undefined {
  const envValue = parseBooleanEnv(env.OPENAI_USE_CHAT_COMPLETIONS);
  if (envValue !== null) return envValue;
  return typeof configForCli?.openai?.useChatCompletions === "boolean"
    ? configForCli.openai.useChatCompletions
    : undefined;
}

export function resolveProviderRuntimeBindings({
  env,
  envState,
  configForCli,
}: {
  env: Record<string, string | undefined>;
  envState: EnvState;
  configForCli: SummarizeConfig | null;
}): ProviderRuntimeBindings {
  return {
    apiKeys: {
      openai: envState.openaiApiKey,
      zai: envState.zaiApiKey,
      nvidia: envState.nvidiaApiKey,
      minimax: envState.minimaxApiKey,
      "github-copilot": resolveGitHubModelsApiKey(env),
      ollama: null,
    },
    baseUrls: {
      openai: envState.providerBaseUrls.openai,
      zai: envState.zaiBaseUrl,
      nvidia: envState.nvidiaBaseUrl,
      minimax: envState.minimaxBaseUrl,
      ollama: envState.ollamaBaseUrl,
    },
    openaiUseChatCompletions: resolveOpenAiUseChatCompletions({ env, configForCli }),
  };
}
