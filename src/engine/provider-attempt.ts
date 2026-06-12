import { parseGatewayStyleModelId } from "../llm/model-id.js";
import {
  resolveProviderOpenAiOverrides,
  type ProviderOpenAiOverrides,
  type ProviderRuntimeBindings,
} from "../llm/provider-profile.js";
import type { ModelAttempt } from "./types.js";

type ProviderAttempt = Pick<ModelAttempt, "transport" | "llmModelId" | "openaiBaseUrlOverride">;

export function resolveModelAttemptOpenAiOverrides(
  attempt: ProviderAttempt,
  runtime: ProviderRuntimeBindings,
): ProviderOpenAiOverrides {
  if (attempt.transport !== "native" || !attempt.llmModelId) return {};
  const provider = parseGatewayStyleModelId(attempt.llmModelId).provider;
  return resolveProviderOpenAiOverrides({
    provider,
    runtime,
    baseUrlOverride: attempt.openaiBaseUrlOverride,
  });
}

export function applyProviderRuntimeToModelAttempt(
  attempt: ModelAttempt,
  runtime: ProviderRuntimeBindings,
): ModelAttempt {
  return {
    ...attempt,
    ...resolveModelAttemptOpenAiOverrides(attempt, runtime),
  };
}
