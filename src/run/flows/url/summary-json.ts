import { formatOutputLanguageForJson } from "../../../language.js";
import type { UrlFlowContext } from "./types.js";

export function buildUrlJsonInput(options: {
  flags: UrlFlowContext["flags"];
  url: string;
  effectiveMarkdownMode: "off" | "auto" | "llm" | "readability";
  modelLabel: string | null;
}) {
  const { flags, url, effectiveMarkdownMode, modelLabel } = options;
  return {
    kind: "url" as const,
    url,
    timeoutMs: flags.timeoutMs,
    youtube: flags.youtubeMode,
    videoMode: flags.videoMode,
    embeddedVideo: flags.embeddedVideoMode,
    firecrawl: flags.firecrawlMode,
    format: flags.format,
    markdown: effectiveMarkdownMode,
    timestamps: flags.transcriptTimestamps,
    length:
      flags.lengthArg.kind === "preset"
        ? { kind: "preset" as const, preset: flags.lengthArg.preset }
        : { kind: "chars" as const, maxCharacters: flags.lengthArg.maxCharacters },
    maxOutputTokens: flags.maxOutputTokensArg,
    model: modelLabel,
    language: formatOutputLanguageForJson(flags.outputLanguage),
  };
}

export function buildUrlJsonEnv(apiStatus: {
  xaiApiKey: string | null;
  apiKey: string | null;
  openrouterApiKey: string | null;
  apifyToken: string | null;
  firecrawlConfigured: boolean;
  googleConfigured: boolean;
  anthropicConfigured: boolean;
}) {
  return {
    hasXaiKey: Boolean(apiStatus.xaiApiKey),
    hasOpenAIKey: Boolean(apiStatus.apiKey),
    hasOpenRouterKey: Boolean(apiStatus.openrouterApiKey),
    hasApifyToken: Boolean(apiStatus.apifyToken),
    hasFirecrawlKey: apiStatus.firecrawlConfigured,
    hasGoogleKey: apiStatus.googleConfigured,
    hasAnthropicKey: apiStatus.anthropicConfigured,
  };
}
