import type { Command } from "commander";
import { type CacheState } from "../cache.js";
import { createModelExecutor } from "../engine/model-executor.js";
import type { ExecFileFn } from "../markitdown.js";
import type { FixedModelSpec } from "../model-spec.js";
import { scopeTranscriptCacheForDiarization } from "../shared/transcript-diarization-cache-scope.js";
import { resolveSpeakerIdentificationSettings } from "../speaker-identification/index.js";
import {
  createThemeRenderer,
  resolveThemeNameFromSources,
  resolveTrueColor,
} from "../tty/theme.js";
import { createCacheStateFromConfig } from "./cache-state.js";
import { parseCliProviderArg } from "./env.js";
import { createRunFlowContexts, createRunnerAssetInputContext } from "./flow-contexts.js";
import { isPdfExtension, isTranscribableExtension } from "./flows/asset/input.js";
import { summarizeMediaFile as summarizeMediaFileImpl } from "./flows/asset/media.js";
import { writeVerbose } from "./logging.js";
import { createMediaCacheFromConfig } from "./media-cache-state.js";
import type { PerfTrace } from "./perf-trace.js";
import { createProgressGate } from "./progress.js";
import { resolveProviderRuntimeBindings } from "./provider-runtime.js";
import { resolveRunApiStatus } from "./run-api-status.js";
import { resolveRunContextState } from "./run-context.js";
import { resolveRunInput } from "./run-input.js";
import { createRunMetrics } from "./run-metrics.js";
import { resolveModelSelection } from "./run-models.js";
import { resolveDesiredOutputTokens } from "./run-output.js";
import { buildPromptLengthInstruction, resolveSummaryLength } from "./run-settings.js";
import { resolveStreamSettings } from "./run-stream.js";
import { executeRunnerInput } from "./runner-execution.js";
import { resolveRunnerFlags } from "./runner-flags.js";
import { resolveRunnerSlidesSettings } from "./runner-slides.js";
import { createTerminalSummaryStream } from "./summary-stream.js";
import { isRichTty, supportsColor } from "./terminal.js";

export type RunnerPlan = {
  cacheState: CacheState;
  execute: () => Promise<void>;
};

export async function createRunnerPlan(options: {
  normalizedArgv: string[];
  program: Command;
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  execFileImpl: ExecFileFn;
  stdin?: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  promptOverride: string | null;
  perfTrace?: PerfTrace | null;
}): Promise<RunnerPlan> {
  const {
    normalizedArgv,
    program,
    env,
    envForRun,
    fetchImpl,
    execFileImpl,
    stdin,
    stdout,
    stderr,
    perfTrace = null,
  } = options;
  let { promptOverride } = options;
  const programOpts = program.opts() as Record<string, unknown>;

  const cliFlagPresent = normalizedArgv.some((arg) => arg === "--cli" || arg.startsWith("--cli="));
  let cliProviderArgRaw = typeof programOpts.cli === "string" ? programOpts.cli : null;
  const inputResolution = resolveRunInput({
    program,
    cliFlagPresent,
    cliProviderArgRaw,
    stdout,
  });
  perfTrace?.mark("plan:input");
  cliProviderArgRaw = inputResolution.cliProviderArgRaw;
  const inputTarget = inputResolution.inputTarget;
  const url = inputResolution.url;

  const runStartedAtMs = Date.now();
  const {
    videoModeExplicitlySet,
    embeddedVideoExplicitlySet,
    lengthExplicitlySet,
    languageExplicitlySet,
    noCacheFlag,
    noMediaCacheFlag,
    extractMode,
    json,
    forceSummary,
    slidesDebug,
    streamMode,
    plain,
    verbose,
    diarizationMode,
    speakerProfileArg,
    speakerAnchorArgs,
    speakerIdentificationOverride,
    rememberSpeakers,
    maxExtractCharacters,
    isYoutubeUrl,
    format,
    youtubeMode,
    lengthArg: requestedLengthArg,
    maxOutputTokensArg,
    timeoutMs,
    retries,
    preprocessMode,
    requestedFirecrawlMode,
    markdownMode,
    metricsEnabled,
    metricsDetailed,
    shouldComputeReport,
    markdownModeExplicitlySet,
  } = resolveRunnerFlags({
    normalizedArgv,
    programOpts,
    envForRun,
    url: inputTarget.kind === "url" ? inputTarget.url : url,
  });
  perfTrace?.mark("plan:flags");

  if (extractMode && lengthExplicitlySet && !json && isRichTty(stderr)) {
    stderr.write("Warning: --length is ignored with --extract (no summary is generated).\n");
  }
  const isDirectMediaInput =
    (inputTarget.kind === "file" && isTranscribableExtension(inputTarget.filePath)) ||
    (inputTarget.kind === "url" && isTranscribableExtension(inputTarget.url));
  if (diarizationMode && !isYoutubeUrl && !isDirectMediaInput) {
    throw new Error("--diarize requires a YouTube URL or a direct audio/video file");
  }

  const modelArg = typeof programOpts.model === "string" ? programOpts.model : null;
  const cliProviderArg =
    typeof cliProviderArgRaw === "string" && cliProviderArgRaw.trim().length > 0
      ? parseCliProviderArg(cliProviderArgRaw)
      : null;
  if (cliFlagPresent && modelArg) {
    throw new Error("Use either --model or --cli (not both).");
  }
  const explicitModelArg = cliProviderArg
    ? `cli/${cliProviderArg}`
    : cliFlagPresent
      ? "auto"
      : modelArg;

  const runContext = resolveRunContextState({
    env,
    envForRun,
    programOpts,
    languageExplicitlySet,
    videoModeExplicitlySet,
    embeddedVideoExplicitlySet,
    cliFlagPresent,
    cliProviderArg,
  });
  const {
    config,
    configPath,
    outputLanguage,
    openaiWhisperUsdPerMinute,
    videoMode,
    embeddedVideoMode,
    cliConfigForRun,
    configForCli,
    openaiUseChatCompletions,
    openaiRequestOptions,
    openaiRequestOptionsOverride,
    cliReasoningEffortOverride,
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
  perfTrace?.mark("plan:context");

  const themeName = resolveThemeNameFromSources({
    cli: (programOpts as { theme?: unknown }).theme,
    env: envForRun.SUMMARIZE_THEME,
    config: config?.ui?.theme,
  });
  envForRun.SUMMARIZE_THEME = themeName;
  if (!promptOverride && typeof config?.prompt === "string" && config.prompt.trim().length > 0) {
    promptOverride = config.prompt.trim();
  }
  const lengthArg = lengthExplicitlySet
    ? requestedLengthArg
    : resolveSummaryLength(config?.output?.length).lengthArg;

  const slidesSettings = resolveRunnerSlidesSettings({
    normalizedArgv,
    programOpts,
    config,
    inputTarget,
  });
  const transcriptTimestamps = Boolean(programOpts.timestamps) || Boolean(slidesSettings);
  const speakerSource =
    inputTarget.kind === "url"
      ? inputTarget.url
      : inputTarget.kind === "file"
        ? inputTarget.filePath
        : "";
  const speakerIdentification = resolveSpeakerIdentificationSettings({
    config: config?.speakers,
    sourceUrl: speakerSource,
    diarization: diarizationMode,
    profileArg: speakerProfileArg,
    anchorArgs: speakerAnchorArgs,
    identifyOverride: speakerIdentificationOverride,
    remember: rememberSpeakers,
  });

  const lengthInstruction = promptOverride ? buildPromptLengthInstruction(lengthArg) : null;
  const languageInstruction =
    promptOverride && outputLanguage.kind === "fixed"
      ? `Output should be ${outputLanguage.label}.`
      : null;

  const transcriptNamespace = `yt:${youtubeMode}`;
  let cacheState = await createCacheStateFromConfig({
    envForRun,
    config,
    noCacheFlag,
    transcriptNamespace,
  });
  cacheState = scopeTranscriptCacheForDiarization(cacheState, diarizationMode);
  const mediaCache = await createMediaCacheFromConfig({
    envForRun,
    config,
    noMediaCacheFlag,
  });
  perfTrace?.mark("plan:cache");

  if (markdownModeExplicitlySet && format !== "markdown") {
    throw new Error("--markdown-mode is only supported with --format md");
  }
  if (
    markdownModeExplicitlySet &&
    inputTarget.kind !== "url" &&
    inputTarget.kind !== "file" &&
    inputTarget.kind !== "stdin"
  ) {
    throw new Error("--markdown-mode is only supported for URL, file, or stdin inputs");
  }
  if (
    markdownModeExplicitlySet &&
    (inputTarget.kind === "file" || inputTarget.kind === "stdin") &&
    markdownMode !== "llm"
  ) {
    throw new Error(
      "Only --markdown-mode llm is supported for file/stdin inputs; other modes require a URL",
    );
  }

  const metrics = createRunMetrics({
    env,
    fetchImpl,
    maxOutputTokensArg,
  });
  const {
    llmCalls,
    trackedFetch,
    buildReport,
    estimateCostUsd,
    getLiteLlmCatalog,
    resolveMaxOutputTokensForCall,
    resolveMaxInputTokensForCall,
    setTranscriptionCost,
  } = metrics;

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
    configForCli,
    configPath,
    envForRun,
    explicitModelArg,
  });

  const verboseColor = supportsColor(stderr, envForRun);
  const themeForStderr = createThemeRenderer({
    themeName,
    enabled: verboseColor,
    trueColor: resolveTrueColor(envForRun),
  });
  const renderSpinnerStatus = (label: string, detail = "…") =>
    `${themeForStderr.label(label)}${themeForStderr.dim(detail)}`;
  const renderSpinnerStatusWithModel = (label: string, modelId: string) =>
    `${themeForStderr.label(label)}${themeForStderr.dim(" (model: ")}${themeForStderr.accent(
      modelId,
    )}${themeForStderr.dim(")…")}`;
  const { streamingEnabled } = resolveStreamSettings({
    streamMode,
    stdout,
    json,
    extractMode,
  });

  if (
    extractMode &&
    inputTarget.kind === "file" &&
    !isTranscribableExtension(inputTarget.filePath) &&
    !isPdfExtension(inputTarget.filePath)
  ) {
    throw new Error(
      "--extract for local files is only supported for media files (MP3, MP4, WAV, etc.) and PDF files",
    );
  }
  if (extractMode && inputTarget.kind === "stdin") {
    throw new Error("--extract is not supported for piped stdin input");
  }

  const progressEnabled = isRichTty(stderr) && !verbose && !json;
  const progressGate = createProgressGate();
  const {
    clearProgressForStdout,
    restoreProgressAfterStdout,
    setClearProgressBeforeStdout,
    clearProgressIfCurrent,
  } = progressGate;

  const fixedModelSpec: FixedModelSpec | null =
    requestedModel.kind === "fixed" ? requestedModel : null;
  const desiredOutputTokens = resolveDesiredOutputTokens({ lengthArg, maxOutputTokensArg });

  const summaryEngine = createModelExecutor({
    env,
    envForRun,
    execFileImpl,
    timeoutMs,
    retries,
    streamingEnabled,
    openaiRequestOptions,
    openaiRequestOptionsOverride,
    cliReasoningEffortOverride,
    cliConfigForRun: cliConfigForRun ?? null,
    cliAvailability,
    trackedFetch,
    resolveMaxOutputTokensForCall,
    resolveMaxInputTokensForCall,
    llmCalls,
    log: (message) => writeVerbose(stderr, verbose, message, verboseColor, envForRun),
    trace: (name, detail) => perfTrace?.mark(name, detail),
    providerRuntime,
    openrouterApiKey: apiStatus.openrouterApiKey,
  });
  const summaryStream = streamingEnabled
    ? createTerminalSummaryStream({
        stdout,
        env,
        envForRun,
        plain,
        clearProgressForStdout,
        restoreProgressAfterStdout,
      })
    : null;

  const writeViaFooter = (parts: string[]) => {
    if (json || extractMode) return;
    const filtered = parts.map((part) => part.trim()).filter(Boolean);
    if (filtered.length === 0) return;
    clearProgressForStdout();
    stderr.write(`${themeForStderr.dim(`via ${filtered.join(", ")}`)}\n`);
    restoreProgressAfterStdout?.();
  };

  const runtimeHooks = {
    setTranscriptionCost,
    writeViaFooter,
    clearProgressForStdout,
    restoreProgressAfterStdout,
    setClearProgressBeforeStdout,
    clearProgressIfCurrent,
    buildReport,
    estimateCostUsd,
  };
  const { summarizeAsset, assetSummaryContext, urlFlowContext } = createRunFlowContexts({
    cacheState,
    mediaCache,
    io: {
      env,
      envForRun,
      stdout,
      stderr,
      execFileImpl,
      fetch: trackedFetch,
    },
    flags: {
      timeoutMs,
      maxExtractCharacters: extractMode ? maxExtractCharacters : null,
      retries,
      format,
      markdownMode,
      preprocessMode,
      youtubeMode,
      firecrawlMode: requestedFirecrawlMode,
      videoMode,
      embeddedVideoMode,
      transcriptTimestamps,
      transcriptDiarization: diarizationMode,
      speakerIdentification,
      outputLanguage,
      lengthArg,
      forceSummary,
      promptOverride,
      lengthInstruction,
      languageInstruction,
      summaryCacheBypass: noCacheFlag,
      maxOutputTokensArg,
      json,
      extractMode,
      metricsEnabled,
      metricsDetailed,
      shouldComputeReport,
      runStartedAtMs,
      verbose,
      verboseColor,
      progressEnabled,
      streamMode,
      streamingEnabled,
      plain,
      configPath,
      configModelLabel,
      slides: slidesSettings,
      slidesDebug,
      slidesOutput: true,
      throwOnAssetLikeHtmlError: true,
    },
    model: {
      requestedModel,
      requestedModelInput,
      requestedModelLabel,
      fixedModelSpec,
      isFallbackModel,
      isImplicitAutoSelection,
      allowAutoCliFallback: false,
      isNamedModelSelection,
      wantsFreeNamedModel,
      desiredOutputTokens,
      configForModelSelection,
      envForAuto,
      cliAvailability,
      openaiUseChatCompletions,
      openaiRequestOptions,
      openaiRequestOptionsOverride,
      cliReasoningEffortOverride,
      openaiWhisperUsdPerMinute,
      apiStatus,
      summaryEngine,
      summaryStream,
      getLiteLlmCatalog,
      llmCalls,
    },
    runtimeHooks,
    perfTrace,
  });
  const assetInputContext = createRunnerAssetInputContext({
    summarizeMediaFileImpl,
    assetSummaryContext,
    progressEnabled,
    trackedFetch,
    setClearProgressBeforeStdout,
    clearProgressIfCurrent,
  });

  return {
    cacheState,
    execute: async () => {
      await executeRunnerInput({
        inputTarget,
        stdin: stdin ?? process.stdin,
        handleFileInputContext: assetInputContext,
        url,
        isYoutubeUrl,
        withUrlAssetContext: assetInputContext,
        slidesEnabled: Boolean(slidesSettings),
        extractMode,
        progressEnabled,
        renderSpinnerStatus,
        renderSpinnerStatusWithModel,
        extractAssetContext: {
          env,
          envForRun,
          execFileImpl,
          timeoutMs,
          preprocessMode,
        },
        outputExtractedAssetContext: {
          io: { env, envForRun, stdout, stderr },
          flags: {
            timeoutMs,
            preprocessMode,
            format,
            plain,
            json,
            metricsEnabled,
            metricsDetailed,
            shouldComputeReport,
            runStartedAtMs,
            verboseColor,
          },
          hooks: {
            clearProgressForStdout,
            restoreProgressAfterStdout,
            buildReport,
            estimateCostUsd,
          },
          apiStatus,
        },
        summarizeAsset,
        runUrlFlowContext: urlFlowContext,
      });
    },
  };
}
