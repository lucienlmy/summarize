import { Writable } from "node:stream";
import type { CacheState } from "../cache.js";
import type { SummarizeConfig } from "../config.js";
import type {
  ExtractedLinkContent,
  LinkPreviewProgressEvent,
  MediaCache,
} from "../content/index.js";
import type { SummaryStreamHandler } from "../engine/events.js";
import { createModelExecutor } from "../engine/model-executor.js";
import type { ExecFileFn } from "../markitdown.js";
import type { FixedModelSpec } from "../model-spec.js";
import { execFileTracked } from "../processes.js";
import { createRunFlowContexts } from "../run/flow-contexts.js";
import type { UrlFlowContext } from "../run/flows/url/types.js";
import { resolveProviderRuntimeBindings } from "../run/provider-runtime.js";
import { resolveRunApiStatus } from "../run/run-api-status.js";
import { resolveRunContextState } from "../run/run-context.js";
import { createRunMetrics } from "../run/run-metrics.js";
import { resolveModelSelection } from "../run/run-models.js";
import { resolveDesiredOutputTokens } from "../run/run-output.js";
import {
  buildPromptLengthInstruction,
  createEmptyRunOverrides,
  type RunOverrides,
  resolveOutputLanguageSetting,
  resolveSummaryLength,
} from "../run/run-settings.js";
import { scopeTranscriptCacheForDiarization } from "../shared/transcript-diarization-cache-scope.js";
import type { SlideImage, SlideSettings, SlideSourceKind } from "../slides/index.js";

type TextSink = {
  writeChunk: (text: string) => void;
};

export function createDaemonSummaryStreamHandler(stdoutSink: TextSink): SummaryStreamHandler {
  return {
    onChunk: ({ streamed, prevStreamed }) => {
      const normalizedStreamed = streamed.replace(/^\n+/, "");
      const normalizedPrevious = prevStreamed.replace(/^\n+/, "");
      const chunk = normalizedStreamed.startsWith(normalizedPrevious)
        ? normalizedStreamed.slice(normalizedPrevious.length)
        : normalizedStreamed;
      if (!chunk) return false;
      stdoutSink.writeChunk(chunk);
      return true;
    },
    onDone: (finalText) => {
      if (finalText.endsWith("\n")) return false;
      stdoutSink.writeChunk("\n");
      return true;
    },
    onReset: () => {},
  };
}

function createWritableFromTextSink(sink: TextSink): NodeJS.WritableStream {
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const text =
        typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : "";
      if (text) sink.writeChunk(text);
      callback();
    },
  });
  (stream as unknown as { isTTY?: boolean }).isTTY = false;
  return stream;
}

function applyAutoCliFallbackOverrides(
  config: SummarizeConfig | null,
  overrides: RunOverrides,
): SummarizeConfig | null {
  const hasOverride = overrides.autoCliFallbackEnabled !== null || overrides.autoCliOrder !== null;
  if (!hasOverride) return config;
  const current = config ?? {};
  const currentCli = current.cli ?? {};
  const currentAutoFallback = currentCli.autoFallback ?? currentCli.magicAuto ?? {};
  return {
    ...current,
    cli: {
      ...currentCli,
      autoFallback: {
        ...currentAutoFallback,
        ...(typeof overrides.autoCliFallbackEnabled === "boolean"
          ? { enabled: overrides.autoCliFallbackEnabled }
          : {}),
        ...(Array.isArray(overrides.autoCliOrder) ? { order: overrides.autoCliOrder } : {}),
      },
    },
  };
}

export type DaemonUrlFlowContextArgs = {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  urlFetchImpl?: typeof fetch | null;
  cache: CacheState;
  mediaCache?: MediaCache | null;
  modelOverride: string | null;
  promptOverride: string | null;
  lengthRaw: unknown;
  languageRaw: unknown;
  maxExtractCharacters: number | null;
  format?: "text" | "markdown";
  overrides?: RunOverrides | null;
  extractOnly?: boolean;
  slides?: SlideSettings | null;
  hooks?: {
    onModelChosen?: ((modelId: string) => void) | null;
    onExtracted?: ((extracted: ExtractedLinkContent) => void) | null;
    onSlidesExtracted?:
      | ((
          slides: Awaited<ReturnType<typeof import("../slides/index.js").extractSlidesForSource>>,
        ) => void)
      | null;
    onSlidesProgress?: ((text: string) => void) | null;
    onSlidesDone?: ((result: { ok: boolean; error?: string | null }) => void) | null;
    onSlideChunk?: (chunk: {
      slide: SlideImage;
      meta: {
        slidesDir: string;
        sourceUrl: string;
        sourceId: string;
        sourceKind: SlideSourceKind;
        ocrAvailable: boolean;
      };
    }) => void;
    onLinkPreviewProgress?: ((event: LinkPreviewProgressEvent) => void) | null;
    onSummaryCached?: ((cached: boolean) => void) | null;
  } | null;
  runStartedAtMs: number;
  stdoutSink: TextSink;
};

export function createDaemonUrlFlowContext(args: DaemonUrlFlowContextArgs): UrlFlowContext {
  const {
    env,
    fetchImpl,
    urlFetchImpl,
    cache,
    mediaCache = null,
    modelOverride,
    promptOverride,
    lengthRaw,
    languageRaw,
    maxExtractCharacters,
    format,
    overrides,
    extractOnly,
    slides,
    hooks,
    runStartedAtMs,
    stdoutSink,
  } = args;

  const envForRun: Record<string, string | undefined> = { ...env };

  const languageExplicitlySet = typeof languageRaw === "string" && Boolean(languageRaw.trim());

  const resolvedOverrides: RunOverrides = overrides ?? createEmptyRunOverrides();
  if (resolvedOverrides.transcriber) {
    envForRun.SUMMARIZE_TRANSCRIBER = resolvedOverrides.transcriber;
  }
  const videoModeOverride = resolvedOverrides.videoMode;
  const embeddedVideoOverride = resolvedOverrides.embeddedVideoMode;
  const resolvedFormat = format === "markdown" ? "markdown" : "text";

  const runContext = resolveRunContextState({
    env: envForRun,
    envForRun,
    programOpts: {
      videoMode: videoModeOverride ?? "auto",
      embeddedVideo: embeddedVideoOverride ?? "auto",
    },
    languageExplicitlySet,
    videoModeExplicitlySet: videoModeOverride != null,
    embeddedVideoExplicitlySet: embeddedVideoOverride != null,
    cliFlagPresent: false,
    cliProviderArg: null,
  });
  const {
    config,
    configPath,
    outputLanguage: outputLanguageFromConfig,
    openaiWhisperUsdPerMinute,
    videoMode,
    embeddedVideoMode,
    cliConfigForRun,
    configForCli,
    openaiUseChatCompletions,
    configModelLabel,
    cliAvailability,
    envForAuto,
  } = runContext;
  const apiStatus = resolveRunApiStatus(runContext);
  const providerRuntime = resolveProviderRuntimeBindings({
    env: envForRun,
    envState: runContext,
    configForCli,
  });
  const configForCliWithMagic = applyAutoCliFallbackOverrides(configForCli, resolvedOverrides);
  const allowAutoCliFallback = resolvedOverrides.autoCliFallbackEnabled === true;
  const { lengthArg } = resolveSummaryLength(lengthRaw, config?.output?.length ?? "long");

  const {
    requestedModel,
    requestedModelInput,
    requestedModelLabel,
    isNamedModelSelection,
    isImplicitAutoSelection,
    wantsFreeNamedModel,
    configForModelSelection,
    isFallbackModel,
  } = resolveModelSelection({
    config,
    configForCli: configForCliWithMagic,
    configPath,
    envForRun,
    explicitModelArg: modelOverride?.trim() ? modelOverride.trim() : null,
  });

  const fixedModelSpec: FixedModelSpec | null =
    requestedModel.kind === "fixed" ? requestedModel : null;
  const maxOutputTokensArg = resolvedOverrides.maxOutputTokensArg;
  const desiredOutputTokens = resolveDesiredOutputTokens({ lengthArg, maxOutputTokensArg });

  const metrics = createRunMetrics({ env: envForRun, fetchImpl, maxOutputTokensArg });

  const stdout = createWritableFromTextSink(stdoutSink);
  const stderr = process.stderr;

  const timeoutMs = resolvedOverrides.timeoutMs ?? 120_000;
  const retries = resolvedOverrides.retries ?? 1;
  const firecrawlMode = resolvedOverrides.firecrawlMode ?? "off";
  const markdownMode =
    resolvedOverrides.markdownMode ?? (resolvedFormat === "markdown" ? "readability" : "off");
  const preprocessMode = resolvedOverrides.preprocessMode ?? "auto";
  const youtubeMode = resolvedOverrides.youtubeMode ?? "auto";

  const summaryEngine = createModelExecutor({
    env: envForRun,
    envForRun,
    execFileImpl: execFileTracked as unknown as ExecFileFn,
    timeoutMs,
    retries,
    streamingEnabled: true,
    cliConfigForRun: cliConfigForRun ?? null,
    cliAvailability,
    trackedFetch: metrics.trackedFetch,
    resolveMaxOutputTokensForCall: metrics.resolveMaxOutputTokensForCall,
    resolveMaxInputTokensForCall: metrics.resolveMaxInputTokensForCall,
    llmCalls: metrics.llmCalls,
    providerRuntime,
    openrouterApiKey: apiStatus.openrouterApiKey,
  });
  const summaryStream = createDaemonSummaryStreamHandler(stdoutSink);

  const outputLanguage = resolveOutputLanguageSetting({
    raw: languageRaw,
    fallback: outputLanguageFromConfig,
  });

  const lengthInstruction = promptOverride ? buildPromptLengthInstruction(lengthArg) : null;
  const languageInstruction =
    promptOverride && outputLanguage.kind === "fixed"
      ? `Output should be ${outputLanguage.label}.`
      : null;

  const urlCache = scopeTranscriptCacheForDiarization(
    cache,
    resolvedOverrides.transcriptDiarization ?? null,
  );
  const io: UrlFlowContext["io"] = {
    env: envForRun,
    envForRun,
    stdout,
    stderr,
    execFileImpl: execFileTracked as unknown as ExecFileFn,
    fetch: metrics.trackedFetch,
    ...(urlFetchImpl ? { urlFetch: urlFetchImpl } : {}),
  };
  const flags: UrlFlowContext["flags"] = {
    timeoutMs,
    maxExtractCharacters,
    retries,
    format: resolvedFormat,
    markdownMode,
    preprocessMode,
    youtubeMode,
    firecrawlMode,
    videoMode,
    embeddedVideoMode,
    transcriptTimestamps: resolvedOverrides.transcriptTimestamps ?? false,
    transcriptDiarization: resolvedOverrides.transcriptDiarization ?? null,
    speakerIdentification: null,
    outputLanguage,
    lengthArg,
    forceSummary: resolvedOverrides.forceSummary ?? false,
    promptOverride,
    lengthInstruction,
    languageInstruction,
    summaryCacheBypass: false,
    maxOutputTokensArg,
    json: false,
    extractMode: extractOnly ?? false,
    metricsEnabled: false,
    metricsDetailed: false,
    shouldComputeReport: false,
    runStartedAtMs,
    verbose: false,
    verboseColor: false,
    progressEnabled: false,
    streamMode: "on",
    streamingEnabled: true,
    plain: true,
    configPath,
    configModelLabel,
    slides: slides ?? null,
    slidesDebug: false,
    slidesOutput: false,
  };
  const model: UrlFlowContext["model"] = {
    requestedModel,
    requestedModelInput,
    requestedModelLabel,
    fixedModelSpec,
    isFallbackModel,
    isImplicitAutoSelection,
    allowAutoCliFallback,
    isNamedModelSelection,
    wantsFreeNamedModel,
    desiredOutputTokens,
    configForModelSelection,
    envForAuto,
    cliAvailability,
    openaiUseChatCompletions,
    openaiWhisperUsdPerMinute,
    apiStatus,
    summaryEngine,
    summaryStream,
    getLiteLlmCatalog: metrics.getLiteLlmCatalog,
    llmCalls: metrics.llmCalls,
  };
  const runtimeHooks = {
    setTranscriptionCost: metrics.setTranscriptionCost,
    writeViaFooter: () => {},
    clearProgressForStdout: () => {},
    restoreProgressAfterStdout: undefined,
    setClearProgressBeforeStdout: () => {},
    clearProgressIfCurrent: () => {},
    buildReport: metrics.buildReport,
    estimateCostUsd: metrics.estimateCostUsd,
  };
  const { urlFlowContext } = createRunFlowContexts({
    cacheState: urlCache,
    mediaCache,
    io,
    flags,
    model,
    runtimeHooks,
    eventHooks: hooks ?? undefined,
    assetSummaryOverrides: { format: "text" },
  });

  return urlFlowContext;
}
