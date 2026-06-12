import type { SummaryLength } from "@steipete/summarize-core";
import type { CacheState } from "../../../cache.js";
import type { CliProvider, SummarizeConfig } from "../../../config.js";
import type { MediaCache } from "../../../content/index.js";
import type { LlmCall, RunMetricsReport } from "../../../costs.js";
import type { SummaryStreamHandler } from "../../../engine/events.js";
import type { createModelExecutor } from "../../../engine/model-executor.js";
import type { OutputLanguage } from "../../../language.js";
import type { ExecFileFn } from "../../../markitdown.js";
import type { FixedModelSpec, RequestedModel } from "../../../model-spec.js";
import type { RunApiStatus } from "../../../shared/run-api-status.js";
import type { SpeakerIdentificationSettings } from "../../../speaker-identification/index.js";
import type { AssetAttachment } from "../../attachments.js";

export type AssetSummaryContext = {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  execFileImpl: ExecFileFn;
  timeoutMs: number;
  preprocessMode: "off" | "auto" | "always";
  format: "text" | "markdown";
  extractMode: boolean;
  lengthArg: { kind: "preset"; preset: SummaryLength } | { kind: "chars"; maxCharacters: number };
  forceSummary: boolean;
  outputLanguage: OutputLanguage;
  videoMode: "auto" | "transcript" | "understand";
  transcriptTimestamps: boolean;
  transcriptDiarization: "auto" | "elevenlabs" | "openai" | null;
  speakerIdentification: SpeakerIdentificationSettings | null;
  configPath: string | null;
  fixedModelSpec: FixedModelSpec | null;
  promptOverride?: string | null;
  lengthInstruction?: string | null;
  languageInstruction?: string | null;
  isFallbackModel: boolean;
  isImplicitAutoSelection: boolean;
  allowAutoCliFallback: boolean;
  desiredOutputTokens: number | null;
  envForAuto: Record<string, string | undefined>;
  configForModelSelection: SummarizeConfig | null;
  cliAvailability: Partial<Record<CliProvider, boolean>>;
  requestedModel: RequestedModel;
  requestedModelInput: string;
  requestedModelLabel: string;
  wantsFreeNamedModel: boolean;
  isNamedModelSelection: boolean;
  maxOutputTokensArg: number | null;
  json: boolean;
  metricsEnabled: boolean;
  metricsDetailed: boolean;
  shouldComputeReport: boolean;
  runStartedAtMs: number;
  verbose: boolean;
  verboseColor: boolean;
  streamingEnabled: boolean;
  plain: boolean;
  summaryEngine: ReturnType<typeof createModelExecutor>;
  summaryStream: SummaryStreamHandler | null;
  trackedFetch: typeof fetch;
  writeViaFooter: (parts: string[]) => void;
  clearProgressForStdout: () => void;
  restoreProgressAfterStdout?: (() => void) | null;
  getLiteLlmCatalog: () => Promise<
    Awaited<ReturnType<typeof import("../../../pricing/litellm.js").loadLiteLlmCatalog>>["catalog"]
  >;
  buildReport: () => Promise<RunMetricsReport>;
  estimateCostUsd: () => Promise<number | null>;
  llmCalls: LlmCall[];
  cache: CacheState;
  summaryCacheBypass: boolean;
  mediaCache: MediaCache | null;
  apiStatus: RunApiStatus;
};

export type AssetSummaryContextInput = {
  io: Pick<
    AssetSummaryContext,
    "env" | "envForRun" | "stdout" | "stderr" | "execFileImpl" | "trackedFetch"
  >;
  summary: Pick<
    AssetSummaryContext,
    | "timeoutMs"
    | "preprocessMode"
    | "format"
    | "extractMode"
    | "lengthArg"
    | "forceSummary"
    | "outputLanguage"
    | "videoMode"
    | "transcriptTimestamps"
    | "transcriptDiarization"
    | "speakerIdentification"
    | "configPath"
    | "promptOverride"
    | "lengthInstruction"
    | "languageInstruction"
    | "maxOutputTokensArg"
    | "summaryCacheBypass"
  >;
  model: Pick<
    AssetSummaryContext,
    | "fixedModelSpec"
    | "isFallbackModel"
    | "isImplicitAutoSelection"
    | "allowAutoCliFallback"
    | "desiredOutputTokens"
    | "envForAuto"
    | "configForModelSelection"
    | "cliAvailability"
    | "requestedModel"
    | "requestedModelInput"
    | "requestedModelLabel"
    | "wantsFreeNamedModel"
    | "isNamedModelSelection"
    | "summaryEngine"
    | "summaryStream"
    | "getLiteLlmCatalog"
    | "llmCalls"
  >;
  output: Pick<
    AssetSummaryContext,
    | "json"
    | "metricsEnabled"
    | "metricsDetailed"
    | "shouldComputeReport"
    | "runStartedAtMs"
    | "verbose"
    | "verboseColor"
    | "streamingEnabled"
    | "plain"
  >;
  hooks: Pick<
    AssetSummaryContext,
    | "writeViaFooter"
    | "clearProgressForStdout"
    | "restoreProgressAfterStdout"
    | "buildReport"
    | "estimateCostUsd"
  >;
  cache: Pick<AssetSummaryContext, "cache" | "mediaCache">;
  apiStatus: AssetSummaryContext["apiStatus"];
};

export type SummarizeAssetArgs = {
  sourceKind: "file" | "asset-url";
  sourceLabel: string;
  attachment: AssetAttachment;
  onModelChosen?: ((modelId: string) => void) | null;
};
