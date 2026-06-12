import { formatTranscriptSegments } from "../../transcript/timestamps.js";
import type { CacheMode, TranscriptDiagnostics } from "../types.js";
import { applyContentBudget, normalizeCandidate, normalizeForPrompt } from "./cleaner.js";
import {
  DEFAULT_CACHE_MODE,
  DEFAULT_TIMEOUT_MS,
  type ExtractedLinkContent,
  type EmbeddedVideoMode,
  type FetchLinkContentOptions,
  type FinalizationArguments,
  type FirecrawlMode,
  type TranscriptResolution,
} from "./types.js";

const WWW_PREFIX_PATTERN = /^www\./i;
const TRANSCRIPT_LINE_SPLIT_PATTERN = /\r?\n/;
const WORD_SPLIT_PATTERN = /\s+/g;
const EMBEDDED_VIDEO_ARTICLE_THRESHOLD = 2000;

function resolveMediaDurationSecondsFromTranscriptMetadata(
  metadata: Record<string, unknown> | null | undefined,
): number | null {
  if (!metadata) return null;
  const direct = (metadata as { durationSeconds?: unknown }).durationSeconds;
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  const media = (metadata as { media?: unknown }).media;
  if (typeof media === "object" && media !== null) {
    const nested = (media as { durationSeconds?: unknown }).durationSeconds;
    if (typeof nested === "number" && Number.isFinite(nested) && nested > 0) {
      return nested;
    }
  }
  return null;
}

function resolveTranscriptionProviderFromTranscriptMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) return null;
  const provider = (metadata as { transcriptionProvider?: unknown }).transcriptionProvider;
  return typeof provider === "string" && provider.trim().length > 0 ? provider.trim() : null;
}

export function resolveCacheMode(options?: FetchLinkContentOptions) {
  return options?.cacheMode ?? DEFAULT_CACHE_MODE;
}

export function resolveMaxCharacters(options?: FetchLinkContentOptions): number | null {
  const candidate = options?.maxCharacters;
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate <= 0) {
    return null;
  }
  return Math.floor(candidate);
}

export function resolveTimeoutMs(options?: FetchLinkContentOptions): number {
  const candidate = options?.timeoutMs;
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.floor(candidate);
}

export function resolveFirecrawlMode(options?: FetchLinkContentOptions): FirecrawlMode {
  const candidate = options?.firecrawl;
  if (candidate === "off" || candidate === "auto" || candidate === "always") {
    return candidate;
  }
  return "auto";
}

export function appendNote(existing: string | null | undefined, next: string): string {
  if (!next) {
    return existing ?? "";
  }
  if (!existing || existing.length === 0) {
    return next;
  }
  return `${existing}; ${next}`;
}

export function safeHostname(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.replace(WWW_PREFIX_PATTERN, "");
  } catch {
    return null;
  }
}

export function pickFirstText(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export function selectBaseContent(
  sourceContent: string,
  transcriptText: string | null,
  transcriptSegments?: TranscriptResolution["segments"],
): string {
  const timedTranscript = transcriptSegments?.length
    ? formatTranscriptSegments(transcriptSegments)
    : null;
  const transcriptCandidate = timedTranscript ?? transcriptText;
  if (!transcriptCandidate) {
    return sourceContent;
  }
  const normalizedTranscript = normalizeForPrompt(transcriptCandidate);
  if (normalizedTranscript.length === 0) {
    return sourceContent;
  }
  return `Transcript:\n${normalizedTranscript}`;
}

function normalizeTranscriptContent(
  transcriptText: string | null,
  transcriptSegments?: TranscriptResolution["segments"],
): string | null {
  const timedTranscript = transcriptSegments?.length
    ? formatTranscriptSegments(transcriptSegments)
    : null;
  const transcriptCandidate = timedTranscript ?? transcriptText;
  if (!transcriptCandidate) return null;
  const normalized = normalizeForPrompt(transcriptCandidate);
  return normalized.length > 0 ? normalized : null;
}

export function selectEmbeddedVideoContent({
  articleContent,
  transcriptText,
  transcriptSegments,
  mode,
  videoUrl,
}: {
  articleContent: string;
  transcriptText: string | null;
  transcriptSegments?: TranscriptResolution["segments"];
  mode: EmbeddedVideoMode;
  videoUrl: string;
}): {
  baseContent: string;
  contentSections: FinalizationArguments["contentSections"];
  composition: "article" | "transcript" | "both";
} {
  const normalizedArticle = normalizeForPrompt(articleContent);
  const normalizedTranscript = normalizeTranscriptContent(transcriptText, transcriptSegments);
  if (!normalizedTranscript) {
    return { baseContent: normalizedArticle, contentSections: null, composition: "article" };
  }

  const shouldCombine =
    normalizedArticle.length > 0 &&
    (mode === "both" ||
      (mode === "auto" && normalizedArticle.length >= EMBEDDED_VIDEO_ARTICLE_THRESHOLD));
  if (!shouldCombine) {
    return {
      baseContent: `Transcript:\n${normalizedTranscript}`,
      contentSections: null,
      composition: "transcript",
    };
  }

  const contentSections = [
    { heading: "Article", content: normalizedArticle },
    { heading: `Embedded video transcript (${videoUrl})`, content: normalizedTranscript },
  ];
  return {
    baseContent: contentSections
      .map((section) => `${section.heading}:\n${section.content}`)
      .join("\n\n"),
    contentSections,
    composition: "both",
  };
}

export function summarizeTranscript(transcriptText: string | null) {
  if (!transcriptText) {
    return { transcriptCharacters: null, transcriptLines: null, transcriptWordCount: null };
  }
  const transcriptCharacters = transcriptText.length > 0 ? transcriptText.length : null;
  const transcriptLinesRaw = transcriptText
    .split(TRANSCRIPT_LINE_SPLIT_PATTERN)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
  const transcriptLines = transcriptLinesRaw > 0 ? transcriptLinesRaw : null;
  const transcriptWordCountRaw =
    transcriptText.length > 0
      ? transcriptText
          .split(WORD_SPLIT_PATTERN)
          .map((value) => value.trim())
          .filter((value) => value.length > 0).length
      : 0;
  const transcriptWordCount = transcriptWordCountRaw > 0 ? transcriptWordCountRaw : null;
  return { transcriptCharacters, transcriptLines, transcriptWordCount };
}

export function ensureTranscriptDiagnostics(
  resolution: TranscriptResolution,
  cacheMode: CacheMode,
): TranscriptDiagnostics {
  if (resolution.diagnostics) {
    return resolution.diagnostics;
  }
  const hasText = typeof resolution.text === "string" && resolution.text.length > 0;
  const cacheStatus = cacheMode === "bypass" ? "bypassed" : hasText ? "miss" : "unknown";
  return {
    cacheMode,
    cacheStatus,
    textProvided: hasText,
    provider: resolution.source,
    attemptedProviders: resolution.source ? [resolution.source] : [],
    notes: cacheMode === "bypass" ? "Cache bypass requested" : null,
  };
}

export function finalizeExtractedLinkContent({
  url,
  baseContent,
  contentSections,
  maxCharacters,
  title,
  description,
  siteName,
  transcriptResolution,
  video,
  isVideoOnly,
  diagnostics,
}: FinalizationArguments): ExtractedLinkContent {
  const normalizedSections = (contentSections ?? [])
    .map((section) => ({
      heading: normalizeForPrompt(section.heading),
      content: normalizeForPrompt(section.content),
    }))
    .filter((section) => section.heading.length > 0 && section.content.length > 0);
  const normalized =
    normalizedSections.length > 0
      ? normalizedSections.map((section) => `${section.heading}:\n${section.content}`).join("\n\n")
      : normalizeForPrompt(baseContent);
  const contentBudget =
    typeof maxCharacters === "number" && normalizedSections.length > 1
      ? applySectionContentBudget(normalizedSections, maxCharacters)
      : typeof maxCharacters === "number"
        ? applyContentBudget(normalized, maxCharacters)
        : {
            content: normalized,
            truncated: false,
            totalCharacters: normalized.length,
            wordCount: countWords(normalized),
          };
  const { content, truncated, totalCharacters, wordCount } = contentBudget;
  const { transcriptCharacters, transcriptLines, transcriptWordCount } = summarizeTranscript(
    transcriptResolution.text,
  );
  const transcriptionProvider = resolveTranscriptionProviderFromTranscriptMetadata(
    transcriptResolution.metadata,
  );
  const mediaDurationSeconds = resolveMediaDurationSecondsFromTranscriptMetadata(
    transcriptResolution.metadata,
  );
  const transcriptSegments = transcriptResolution.segments ?? null;
  const transcriptTimedText = transcriptSegments
    ? formatTranscriptSegments(transcriptSegments)
    : null;
  const rawSourceMetrics = transcriptResolution.metadata?.sourceMetrics;
  const sourceMetricsRecord =
    rawSourceMetrics && typeof rawSourceMetrics === "object" && !Array.isArray(rawSourceMetrics)
      ? (rawSourceMetrics as Record<string, unknown>)
      : null;
  const sourceMetrics =
    sourceMetricsRecord?.platform === "youtube" &&
    typeof sourceMetricsRecord.videoId === "string" &&
    sourceMetricsRecord.videoId.length > 0 &&
    (sourceMetricsRecord.viewCount === null ||
      (typeof sourceMetricsRecord.viewCount === "number" &&
        Number.isSafeInteger(sourceMetricsRecord.viewCount) &&
        sourceMetricsRecord.viewCount >= 0)) &&
    typeof sourceMetricsRecord.observedAt === "string" &&
    Number.isFinite(Date.parse(sourceMetricsRecord.observedAt))
      ? {
          platform: "youtube" as const,
          videoId: sourceMetricsRecord.videoId,
          viewCount: sourceMetricsRecord.viewCount as number | null,
          observedAt: sourceMetricsRecord.observedAt,
        }
      : null;

  return {
    url,
    title,
    description,
    siteName,
    content,
    truncated,
    totalCharacters,
    wordCount,
    transcriptCharacters,
    transcriptLines,
    transcriptWordCount,
    transcriptSource: transcriptResolution.source,
    transcriptionProvider,
    transcriptMetadata: transcriptResolution.metadata ?? null,
    transcriptSegments,
    transcriptTimedText,
    mediaDurationSeconds,
    sourceMetrics,
    video,
    isVideoOnly,
    diagnostics,
  };
}

function countWords(content: string): number {
  return content.length > 0
    ? content
        .split(WORD_SPLIT_PATTERN)
        .map((value) => value.trim())
        .filter((value) => value.length > 0).length
    : 0;
}

function applySectionContentBudget(
  sections: Array<{ heading: string; content: string }>,
  maxCharacters: number,
) {
  const fullContent = sections
    .map((section) => `${section.heading}:\n${section.content}`)
    .join("\n\n");
  if (fullContent.length <= maxCharacters || maxCharacters < 160) {
    return applyContentBudget(fullContent, maxCharacters);
  }

  const framingCharacters = sections.reduce(
    (sum, section, index) => sum + section.heading.length + 2 + (index > 0 ? 2 : 0),
    0,
  );
  const available = Math.max(0, maxCharacters - framingCharacters);
  const initialBudgets = sections.map((section, index) => {
    const share = index === 0 ? 0.35 : 0.65 / Math.max(1, sections.length - 1);
    return Math.min(section.content.length, Math.floor(available * share));
  });
  let unused = available - initialBudgets.reduce((sum, budget) => sum + Math.max(0, budget), 0);
  for (let index = 0; index < sections.length && unused > 0; index += 1) {
    const room = sections[index]!.content.length - initialBudgets[index]!;
    const extra = Math.min(room, unused);
    initialBudgets[index] = initialBudgets[index]! + extra;
    unused -= extra;
  }

  const content = sections
    .map((section, index) => {
      const budget = Math.max(1, initialBudgets[index] ?? 1);
      return `${section.heading}:\n${applyContentBudget(section.content, budget).content}`;
    })
    .join("\n\n");
  const bounded =
    content.length > maxCharacters ? applyContentBudget(content, maxCharacters) : null;
  const finalContent = bounded?.content ?? content;
  return {
    content: finalContent,
    truncated: true,
    totalCharacters: fullContent.length,
    wordCount: countWords(finalContent),
  };
}
