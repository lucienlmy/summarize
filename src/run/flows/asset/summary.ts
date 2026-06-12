import { render as renderMarkdownAnsi } from "markdansi";
import {
  buildAttachmentContentHash,
  buildLanguageKey,
  buildLengthKey,
  buildPromptContentHash,
  buildPromptHash,
} from "../../../cache.js";
import { buildModelMetaFromAttempt } from "../../../engine/model-meta.js";
import { executeSummaryAttempts } from "../../../engine/summary-execution.js";
import type { ModelAttempt } from "../../../engine/types.js";
import { formatOutputLanguageForJson } from "../../../language.js";
import type { Prompt } from "../../../llm/prompt.js";
import { SUMMARY_LENGTH_TARGET_CHARACTERS, SUMMARY_SYSTEM_PROMPT } from "../../../prompts/index.js";
import { buildRunJsonEnv } from "../../../shared/run-api-status.js";
import { countTokens } from "../../../tokenizer.js";
import { isUnsupportedAttachmentError } from "../../attachments.js";
import {
  readLastSuccessfulCliProvider,
  writeLastSuccessfulCliProvider,
} from "../../cli-fallback-state.js";
import { writeFinishLine } from "../../finish-line.js";
import { resolveTargetCharacters } from "../../format.js";
import { writeVerbose } from "../../logging.js";
import { prepareMarkdownForTerminal } from "../../markdown.js";
import { isRichTty, markdownRenderWidth, supportsColor } from "../../terminal.js";
import { prepareAssetPrompt } from "./preprocess.js";
import { buildAssetCliContext, buildAssetModelAttempts } from "./summary-attempts.js";
import type { AssetSummaryContext, AssetSummaryContextInput, SummarizeAssetArgs } from "./types.js";

function shouldBypassShortContentSummary({
  ctx,
  textContent,
}: {
  ctx: Pick<AssetSummaryContext, "forceSummary" | "lengthArg" | "maxOutputTokensArg" | "json">;
  textContent: { content: string } | null;
}): boolean {
  if (ctx.forceSummary) return false;
  if (!textContent?.content) return false;
  const targetCharacters = resolveTargetCharacters(ctx.lengthArg, SUMMARY_LENGTH_TARGET_CHARACTERS);
  if (!Number.isFinite(targetCharacters) || targetCharacters <= 0) return false;
  if (textContent.content.length > targetCharacters) return false;
  if (!ctx.json && typeof ctx.maxOutputTokensArg === "number") {
    const tokenCount = countTokens(textContent.content);
    if (tokenCount > ctx.maxOutputTokensArg) return false;
  }
  return true;
}

async function outputBypassedAssetSummary({
  ctx,
  args,
  promptText,
  summaryText,
  assetFooterParts,
  footerLabel,
}: {
  ctx: AssetSummaryContext;
  args: SummarizeAssetArgs;
  promptText: string;
  summaryText: string;
  assetFooterParts: string[];
  footerLabel: string;
}) {
  const summary = summaryText.trimEnd();
  const extracted = {
    kind: "asset" as const,
    source: args.sourceLabel,
    mediaType: args.attachment.mediaType,
    filename: args.attachment.filename,
  };

  if (ctx.json) {
    ctx.clearProgressForStdout();
    const finishReport = ctx.shouldComputeReport ? await ctx.buildReport() : null;
    const input =
      args.sourceKind === "file"
        ? {
            kind: "file",
            filePath: args.sourceLabel,
            timeoutMs: ctx.timeoutMs,
            length:
              ctx.lengthArg.kind === "preset"
                ? { kind: "preset", preset: ctx.lengthArg.preset }
                : { kind: "chars", maxCharacters: ctx.lengthArg.maxCharacters },
            maxOutputTokens: ctx.maxOutputTokensArg,
            model: ctx.requestedModelLabel,
            language: formatOutputLanguageForJson(ctx.outputLanguage),
          }
        : {
            kind: "asset-url",
            url: args.sourceLabel,
            timeoutMs: ctx.timeoutMs,
            length:
              ctx.lengthArg.kind === "preset"
                ? { kind: "preset", preset: ctx.lengthArg.preset }
                : { kind: "chars", maxCharacters: ctx.lengthArg.maxCharacters },
            maxOutputTokens: ctx.maxOutputTokensArg,
            model: ctx.requestedModelLabel,
            language: formatOutputLanguageForJson(ctx.outputLanguage),
          };
    const payload = {
      input,
      env: buildRunJsonEnv(ctx.apiStatus),
      extracted,
      prompt: promptText,
      llm: null,
      metrics: ctx.metricsEnabled ? finishReport : null,
      summary,
    };
    ctx.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    ctx.restoreProgressAfterStdout?.();
    if (ctx.metricsEnabled && finishReport) {
      const costUsd = await ctx.estimateCostUsd();
      writeFinishLine({
        stderr: ctx.stderr,
        env: ctx.envForRun,
        elapsedMs: Date.now() - ctx.runStartedAtMs,
        elapsedLabel: null,
        model: null,
        report: finishReport,
        costUsd,
        detailed: ctx.metricsDetailed,
        extraParts: null,
        color: ctx.verboseColor,
      });
    }
    return;
  }

  ctx.clearProgressForStdout();
  const rendered =
    !ctx.plain && isRichTty(ctx.stdout)
      ? renderMarkdownAnsi(prepareMarkdownForTerminal(summary), {
          width: markdownRenderWidth(ctx.stdout, ctx.env),
          wrap: true,
          color: supportsColor(ctx.stdout, ctx.envForRun),
          hyperlinks: true,
        })
      : summary;

  if (!ctx.plain && isRichTty(ctx.stdout)) {
    ctx.stdout.write(`\n${rendered.replace(/^\n+/, "")}`);
  } else {
    if (isRichTty(ctx.stdout)) ctx.stdout.write("\n");
    ctx.stdout.write(rendered.replace(/^\n+/, ""));
  }
  if (!rendered.endsWith("\n")) {
    ctx.stdout.write("\n");
  }
  ctx.restoreProgressAfterStdout?.();
  if (assetFooterParts.length > 0) {
    ctx.writeViaFooter([...assetFooterParts, footerLabel]);
  }

  const report = ctx.shouldComputeReport ? await ctx.buildReport() : null;
  if (ctx.metricsEnabled && report) {
    const costUsd = await ctx.estimateCostUsd();
    writeFinishLine({
      stderr: ctx.stderr,
      env: ctx.envForRun,
      elapsedMs: Date.now() - ctx.runStartedAtMs,
      elapsedLabel: null,
      model: null,
      report,
      costUsd,
      detailed: ctx.metricsDetailed,
      extraParts: null,
      color: ctx.verboseColor,
    });
  }
}

export function createAssetSummaryContext(input: AssetSummaryContextInput): AssetSummaryContext {
  return {
    ...input.io,
    ...input.summary,
    ...input.model,
    ...input.output,
    ...input.hooks,
    ...input.cache,
    apiStatus: input.apiStatus,
  };
}

export async function summarizeAsset(ctx: AssetSummaryContext, args: SummarizeAssetArgs) {
  const lastSuccessfulCliProvider = ctx.isFallbackModel
    ? await readLastSuccessfulCliProvider(ctx.envForRun)
    : null;

  const { promptText, attachments, assetFooterParts, textContent } = await prepareAssetPrompt({
    ctx: {
      env: ctx.env,
      envForRun: ctx.envForRun,
      execFileImpl: ctx.execFileImpl,
      timeoutMs: ctx.timeoutMs,
      preprocessMode: ctx.preprocessMode,
      format: ctx.format,
      lengthArg: ctx.lengthArg,
      outputLanguage: ctx.outputLanguage,
      fixedModelSpec: ctx.fixedModelSpec,
      promptOverride: ctx.promptOverride ?? null,
      lengthInstruction: ctx.lengthInstruction ?? null,
      languageInstruction: ctx.languageInstruction ?? null,
    },
    attachment: args.attachment,
  });
  const prompt: Prompt = {
    system: SUMMARY_SYSTEM_PROMPT,
    userText: promptText,
    ...(attachments.length > 0 ? { attachments } : {}),
  };

  const summaryLengthTarget =
    ctx.lengthArg.kind === "preset"
      ? ctx.lengthArg.preset
      : { maxCharacters: ctx.lengthArg.maxCharacters };

  const promptTokensForAuto = attachments.length === 0 ? countTokens(prompt.userText) : null;
  const lowerMediaType = args.attachment.mediaType.toLowerCase();
  const kind = lowerMediaType.startsWith("video/")
    ? ("video" as const)
    : lowerMediaType.startsWith("image/")
      ? ("image" as const)
      : textContent
        ? ("text" as const)
        : ("file" as const);
  const requiresVideoUnderstanding = kind === "video" && ctx.videoMode !== "transcript";

  if (
    ctx.isFallbackModel &&
    !ctx.isNamedModelSelection &&
    shouldBypassShortContentSummary({ ctx, textContent })
  ) {
    await outputBypassedAssetSummary({
      ctx,
      args,
      promptText,
      summaryText: textContent?.content ?? "",
      assetFooterParts,
      footerLabel: "short content",
    });
    return;
  }

  if (
    ctx.requestedModel.kind === "auto" &&
    !ctx.isNamedModelSelection &&
    !ctx.forceSummary &&
    !ctx.json &&
    typeof ctx.maxOutputTokensArg === "number" &&
    textContent &&
    countTokens(textContent.content) <= ctx.maxOutputTokensArg
  ) {
    ctx.clearProgressForStdout();
    ctx.stdout.write(`${textContent.content.trim()}\n`);
    ctx.restoreProgressAfterStdout?.();
    if (assetFooterParts.length > 0) {
      ctx.writeViaFooter([...assetFooterParts, "no model"]);
    }
    return;
  }

  const attempts: ModelAttempt[] = await buildAssetModelAttempts({
    ctx,
    kind,
    promptTokensForAuto,
    requiresVideoUnderstanding,
    lastSuccessfulCliProvider,
  });

  const cliContext = await buildAssetCliContext({
    ctx,
    args,
    attempts,
    attachmentsCount: attachments.length,
    summaryLengthTarget,
  });

  const cacheStore =
    ctx.cache.mode === "default" && !ctx.summaryCacheBypass ? ctx.cache.store : null;
  const contentHash = cacheStore
    ? (buildPromptContentHash({ prompt: promptText }) ??
      buildAttachmentContentHash({ attachments }))
    : null;
  const promptHash = cacheStore ? buildPromptHash(promptText) : null;
  const lengthKey = buildLengthKey(ctx.lengthArg);
  const languageKey = buildLanguageKey(ctx.outputLanguage);
  const autoSelectionCacheModel = ctx.isFallbackModel
    ? `selection:${ctx.requestedModelInput.toLowerCase()}`
    : null;

  const execution = await executeSummaryAttempts({
    attempts,
    isFallbackModel: ctx.isFallbackModel,
    isNamedModelSelection: ctx.isNamedModelSelection,
    wantsFreeNamedModel: ctx.wantsFreeNamedModel,
    requestedModelInput: ctx.requestedModelInput,
    envHasKeyFor: ctx.summaryEngine.envHasKeyFor,
    formatMissingModelError: ctx.summaryEngine.formatMissingModelError,
    cache: {
      store: cacheStore,
      ttlMs: ctx.cache.ttlMs,
      contentHash,
      promptHash,
      lengthKey,
      languageKey,
      autoSelectionModel: autoSelectionCacheModel,
    },
    verbose: (message) =>
      writeVerbose(ctx.stderr, ctx.verbose, message, ctx.verboseColor, ctx.envForRun),
    onModelChosen: args.onModelChosen,
    buildCachedResult: (attempt, summary) => ({
      summary,
      summaryEmitted: false,
      modelMeta: buildModelMetaFromAttempt(attempt),
      maxOutputTokensForCall: null,
    }),
    runAttempt: (attempt) =>
      ctx.summaryEngine.runSummaryAttempt({
        attempt,
        prompt,
        allowStreaming: ctx.streamingEnabled,
        onModelChosen: args.onModelChosen ?? null,
        cli: cliContext,
        streamHandler: ctx.summaryStream,
      }),
    onFixedModelError: (attempt, error) => {
      if (isUnsupportedAttachmentError(error)) {
        throw new Error(
          `Model ${attempt.userModelId} does not support attaching files of type ${args.attachment.mediaType}. Try a different --model.`,
          { cause: error },
        );
      }
      throw error;
    },
    fetchImpl: ctx.trackedFetch,
    timeoutMs: ctx.timeoutMs,
    rememberCliProvider: (provider) =>
      writeLastSuccessfulCliProvider({ env: ctx.envForRun, provider }),
  });

  if (!execution.result || !execution.usedAttempt) {
    if (textContent) {
      ctx.clearProgressForStdout();
      ctx.stdout.write(`${textContent.content.trim()}\n`);
      ctx.restoreProgressAfterStdout?.();
      if (assetFooterParts.length > 0) {
        ctx.writeViaFooter([...assetFooterParts, "no model"]);
      }
      return;
    }
    if (execution.failure.lastError instanceof Error) throw execution.failure.lastError;
    throw new Error("No model available for this input");
  }

  const { summary, summaryEmitted, modelMeta, maxOutputTokensForCall } = execution.result;
  const usedAttempt = execution.usedAttempt;
  const summaryFromCache = execution.summaryFromCache;

  const extracted = {
    kind: "asset" as const,
    source: args.sourceLabel,
    mediaType: args.attachment.mediaType,
    filename: args.attachment.filename,
  };

  if (ctx.json) {
    ctx.clearProgressForStdout();
    const finishReport = ctx.shouldComputeReport ? await ctx.buildReport() : null;
    const input: {
      kind: "file" | "asset-url";
      filePath?: string;
      url?: string;
      timeoutMs: number;
      length: { kind: "preset"; preset: string } | { kind: "chars"; maxCharacters: number };
      maxOutputTokens: number | null;
      model: string;
      language: ReturnType<typeof formatOutputLanguageForJson>;
    } =
      args.sourceKind === "file"
        ? {
            kind: "file",
            filePath: args.sourceLabel,
            timeoutMs: ctx.timeoutMs,
            length:
              ctx.lengthArg.kind === "preset"
                ? { kind: "preset", preset: ctx.lengthArg.preset }
                : { kind: "chars", maxCharacters: ctx.lengthArg.maxCharacters },
            maxOutputTokens: ctx.maxOutputTokensArg,
            model: ctx.requestedModelLabel,
            language: formatOutputLanguageForJson(ctx.outputLanguage),
          }
        : {
            kind: "asset-url",
            url: args.sourceLabel,
            timeoutMs: ctx.timeoutMs,
            length:
              ctx.lengthArg.kind === "preset"
                ? { kind: "preset", preset: ctx.lengthArg.preset }
                : { kind: "chars", maxCharacters: ctx.lengthArg.maxCharacters },
            maxOutputTokens: ctx.maxOutputTokensArg,
            model: ctx.requestedModelLabel,
            language: formatOutputLanguageForJson(ctx.outputLanguage),
          };
    const payload = {
      input,
      env: buildRunJsonEnv(ctx.apiStatus),
      extracted,
      prompt: promptText,
      llm: {
        provider: modelMeta.provider,
        model: usedAttempt.userModelId,
        maxCompletionTokens: maxOutputTokensForCall,
        strategy: "single" as const,
      },
      metrics: ctx.metricsEnabled ? finishReport : null,
      summary,
    };
    ctx.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    ctx.restoreProgressAfterStdout?.();
    if (ctx.metricsEnabled && finishReport) {
      const costUsd = await ctx.estimateCostUsd();
      writeFinishLine({
        stderr: ctx.stderr,
        env: ctx.envForRun,
        elapsedMs: Date.now() - ctx.runStartedAtMs,
        elapsedLabel: summaryFromCache ? "Cached" : null,
        model: usedAttempt.userModelId,
        report: finishReport,
        costUsd,
        detailed: ctx.metricsDetailed,
        extraParts: null,
        color: ctx.verboseColor,
      });
    }
    return;
  }

  if (!summaryEmitted) {
    ctx.clearProgressForStdout();
    const rendered =
      !ctx.plain && isRichTty(ctx.stdout)
        ? renderMarkdownAnsi(prepareMarkdownForTerminal(summary), {
            width: markdownRenderWidth(ctx.stdout, ctx.env),
            wrap: true,
            color: supportsColor(ctx.stdout, ctx.envForRun),
            hyperlinks: true,
          })
        : summary;

    if (!ctx.plain && isRichTty(ctx.stdout)) {
      ctx.stdout.write(`\n${rendered.replace(/^\n+/, "")}`);
    } else {
      if (isRichTty(ctx.stdout)) ctx.stdout.write("\n");
      ctx.stdout.write(rendered.replace(/^\n+/, ""));
    }
    if (!rendered.endsWith("\n")) {
      ctx.stdout.write("\n");
    }
    ctx.restoreProgressAfterStdout?.();
  }

  ctx.writeViaFooter([...assetFooterParts, `model ${usedAttempt.userModelId}`]);

  const report = ctx.shouldComputeReport ? await ctx.buildReport() : null;
  if (ctx.metricsEnabled && report) {
    const costUsd = await ctx.estimateCostUsd();
    writeFinishLine({
      stderr: ctx.stderr,
      env: ctx.envForRun,
      elapsedMs: Date.now() - ctx.runStartedAtMs,
      elapsedLabel: summaryFromCache ? "Cached" : null,
      model: usedAttempt.userModelId,
      report,
      costUsd,
      detailed: ctx.metricsDetailed,
      extraParts: null,
      color: ctx.verboseColor,
    });
  }
}
