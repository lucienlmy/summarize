import type { CacheState } from "../cache.js";
import type { MediaCache } from "../content/index.js";
import type { AssetInputContext } from "./flows/asset/input.js";
import {
  createAssetSummaryContext,
  summarizeAsset as summarizeAssetFlow,
} from "./flows/asset/summary.js";
import type {
  AssetSummaryContext,
  AssetSummaryContextInput,
  SummarizeAssetArgs,
} from "./flows/asset/types.js";
import {
  createUrlFlowContext,
  type UrlFlowContext,
  type UrlFlowEventHooks,
  type UrlFlowRuntimeHooks,
} from "./flows/url/types.js";
import type { PerfTrace } from "./perf-trace.js";

type SummarizeMediaFile = typeof import("./flows/asset/media.js").summarizeMediaFile;

export function createRunFlowContexts(options: {
  cacheState: CacheState;
  mediaCache: MediaCache | null;
  io: UrlFlowContext["io"];
  flags: UrlFlowContext["flags"];
  model: UrlFlowContext["model"];
  runtimeHooks: Omit<UrlFlowRuntimeHooks, "summarizeAsset">;
  eventHooks?: Partial<UrlFlowEventHooks>;
  assetSummaryOverrides?: Partial<AssetSummaryContextInput["summary"]>;
  perfTrace?: PerfTrace | null;
}) {
  const {
    cacheState,
    mediaCache,
    io,
    flags,
    model,
    runtimeHooks,
    eventHooks,
    assetSummaryOverrides,
    perfTrace = null,
  } = options;

  const assetSummaryContext = createAssetSummaryContext({
    io: {
      env: io.env,
      envForRun: io.envForRun,
      stdout: io.stdout,
      stderr: io.stderr,
      execFileImpl: io.execFileImpl,
      trackedFetch: io.fetch,
    },
    summary: {
      timeoutMs: flags.timeoutMs,
      preprocessMode: flags.preprocessMode,
      format: flags.format,
      extractMode: flags.extractMode,
      lengthArg: flags.lengthArg,
      forceSummary: flags.forceSummary,
      outputLanguage: flags.outputLanguage,
      videoMode: flags.videoMode,
      transcriptTimestamps: flags.transcriptTimestamps,
      transcriptDiarization: flags.transcriptDiarization,
      speakerIdentification: flags.speakerIdentification,
      configPath: flags.configPath,
      promptOverride: flags.promptOverride,
      lengthInstruction: flags.lengthInstruction,
      languageInstruction: flags.languageInstruction,
      maxOutputTokensArg: flags.maxOutputTokensArg,
      summaryCacheBypass: flags.summaryCacheBypass,
      ...assetSummaryOverrides,
    },
    model: {
      fixedModelSpec: model.fixedModelSpec,
      isFallbackModel: model.isFallbackModel,
      isImplicitAutoSelection: model.isImplicitAutoSelection,
      allowAutoCliFallback: model.allowAutoCliFallback,
      desiredOutputTokens: model.desiredOutputTokens,
      envForAuto: model.envForAuto,
      configForModelSelection: model.configForModelSelection,
      cliAvailability: model.cliAvailability,
      requestedModel: model.requestedModel,
      requestedModelInput: model.requestedModelInput,
      requestedModelLabel: model.requestedModelLabel,
      wantsFreeNamedModel: model.wantsFreeNamedModel,
      isNamedModelSelection: model.isNamedModelSelection,
      summaryEngine: model.summaryEngine,
      summaryStream: model.summaryStream,
      getLiteLlmCatalog: model.getLiteLlmCatalog,
      llmCalls: model.llmCalls,
    },
    output: {
      json: flags.json,
      metricsEnabled: flags.metricsEnabled,
      metricsDetailed: flags.metricsDetailed,
      shouldComputeReport: flags.shouldComputeReport,
      runStartedAtMs: flags.runStartedAtMs,
      verbose: flags.verbose,
      verboseColor: flags.verboseColor,
      streamingEnabled: flags.streamingEnabled,
      plain: flags.plain,
    },
    hooks: {
      writeViaFooter: runtimeHooks.writeViaFooter,
      clearProgressForStdout: runtimeHooks.clearProgressForStdout,
      restoreProgressAfterStdout: runtimeHooks.restoreProgressAfterStdout,
      buildReport: runtimeHooks.buildReport,
      estimateCostUsd: runtimeHooks.estimateCostUsd,
    },
    cache: {
      cache: cacheState,
      mediaCache,
    },
    apiStatus: model.apiStatus,
  });

  const summarizeAsset = (args: SummarizeAssetArgs) =>
    summarizeAssetFlow(assetSummaryContext, args);

  return {
    assetSummaryContext,
    summarizeAsset,
    urlFlowContext: createUrlFlowContext({
      io,
      flags,
      model,
      cache: cacheState,
      mediaCache,
      perfTrace,
      runtimeHooks: {
        ...runtimeHooks,
        summarizeAsset,
      },
      eventHooks,
    }),
  };
}

export function createRunnerAssetInputContext({
  summarizeMediaFileImpl,
  assetSummaryContext,
  progressEnabled,
  trackedFetch,
  setClearProgressBeforeStdout,
  clearProgressIfCurrent,
}: {
  summarizeMediaFileImpl: SummarizeMediaFile;
  assetSummaryContext: AssetSummaryContext;
  progressEnabled: boolean;
  trackedFetch: typeof fetch;
  setClearProgressBeforeStdout: AssetInputContext["setClearProgressBeforeStdout"];
  clearProgressIfCurrent: AssetInputContext["clearProgressIfCurrent"];
}): AssetInputContext {
  const summarizeAsset = (args: SummarizeAssetArgs) =>
    summarizeAssetFlow(assetSummaryContext, args);
  const summarizeMediaFile = (args: Parameters<SummarizeMediaFile>[1]) =>
    summarizeMediaFileImpl(assetSummaryContext, args);
  return {
    env: assetSummaryContext.env,
    envForRun: assetSummaryContext.envForRun,
    stderr: assetSummaryContext.stderr,
    progressEnabled,
    timeoutMs: assetSummaryContext.timeoutMs,
    trackedFetch,
    summarizeAsset,
    summarizeMediaFile,
    setClearProgressBeforeStdout,
    clearProgressIfCurrent,
  };
}
