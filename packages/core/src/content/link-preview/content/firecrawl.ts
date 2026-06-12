import { resolveTranscriptForLink } from "../../transcript/index.js";
import type { FirecrawlScrapeResult, LinkPreviewDeps } from "../deps.js";
import type { FirecrawlDiagnostics } from "../types.js";
import { extractArticleContent, extractPlainText } from "./article.js";
import { normalizeForPrompt } from "./cleaner.js";
import {
  BLOCKED_HTML_HINT_PATTERN,
  MIN_HTML_CONTENT_CHARACTERS,
  MIN_HTML_DOCUMENT_CHARACTERS_FOR_FALLBACK,
  MIN_METADATA_DESCRIPTION_CHARACTERS,
  READABILITY_RELATIVE_THRESHOLD,
} from "./constants.js";
import { extractJsonLdContent } from "./jsonld.js";
import { extractMetadataFromFirecrawl, extractMetadataFromHtml } from "./parsers.js";
import { isPodcastHost, isPodcastLikeJsonLdType } from "./podcast-utils.js";
import type { ExtractedLinkContent, FetchLinkContentOptions } from "./types.js";
import {
  appendNote,
  ensureTranscriptDiagnostics,
  finalizeExtractedLinkContent,
  pickFirstText,
  safeHostname,
  selectBaseContent,
  selectEmbeddedVideoContent,
} from "./utils.js";
import { detectPrimaryVideoDetailsFromHtml, resolveEmbeddedYoutubeDecision } from "./video.js";
import { refreshYoutubeSourceMetrics } from "./youtube-source-metrics.js";

export function shouldFallbackToFirecrawl(html: string): boolean {
  const plainText = normalizeForPrompt(extractPlainText(html));
  if (BLOCKED_HTML_HINT_PATTERN.test(plainText)) return true;
  const normalized = normalizeForPrompt(extractArticleContent(html));
  if (normalized.length >= MIN_HTML_CONTENT_CHARACTERS) {
    return false;
  }

  // Avoid spending Firecrawl on truly small/simple pages where the extracted HTML content is short but
  // likely complete (e.g. https://example.com). Only treat "thin" content as a Firecrawl signal when
  // the HTML document itself is large (SSR/app-shell pages, blocked pages without a match, etc.).
  return html.length >= MIN_HTML_DOCUMENT_CHARACTERS_FOR_FALLBACK;
}

export async function buildResultFromFirecrawl({
  url,
  payload,
  cacheMode,
  maxCharacters,
  youtubeTranscriptMode,
  mediaTranscriptMode,
  embeddedVideoMode,
  transcriptTimestamps,
  transcriptDiarization,
  transcriptVideoDownload,
  firecrawlDiagnostics,
  markdownRequested,
  timeoutMs,
  deps,
}: {
  url: string;
  payload: FirecrawlScrapeResult;
  cacheMode: FetchLinkContentOptions["cacheMode"];
  maxCharacters: number | null;
  youtubeTranscriptMode: FetchLinkContentOptions["youtubeTranscript"];
  mediaTranscriptMode: FetchLinkContentOptions["mediaTranscript"];
  embeddedVideoMode: FetchLinkContentOptions["embeddedVideo"];
  transcriptTimestamps?: FetchLinkContentOptions["transcriptTimestamps"];
  transcriptDiarization?: FetchLinkContentOptions["transcriptDiarization"];
  transcriptVideoDownload?: FetchLinkContentOptions["transcriptVideoDownload"];
  firecrawlDiagnostics: FirecrawlDiagnostics;
  markdownRequested: boolean;
  timeoutMs: number;
  deps: LinkPreviewDeps;
}): Promise<ExtractedLinkContent | null> {
  const extractionStartedAt = Date.now();
  const normalizedMarkdown = normalizeForPrompt(payload.markdown ?? "");
  if (normalizedMarkdown.length === 0) {
    firecrawlDiagnostics.notes = appendNote(
      firecrawlDiagnostics.notes,
      "Firecrawl markdown normalization yielded empty text",
    );
    return null;
  }

  const jsonLd = payload.html ? extractJsonLdContent(payload.html) : null;
  const isPodcastJsonLd = isPodcastLikeJsonLdType(jsonLd?.type);

  const videoDetection = payload.html ? detectPrimaryVideoDetailsFromHtml(payload.html, url) : null;
  const video = videoDetection?.video ?? null;
  const resolvedEmbeddedVideoMode = embeddedVideoMode ?? "auto";
  const embeddedYoutube = resolveEmbeddedYoutubeDecision({
    pageUrl: url,
    detection: videoDetection,
    mode: resolvedEmbeddedVideoMode,
    youtubeTranscriptMode: youtubeTranscriptMode ?? "auto",
    mediaTranscriptMode: mediaTranscriptMode ?? "auto",
  });
  const transcriptResolution = await resolveTranscriptForLink(url, payload.html ?? null, deps, {
    timeoutMs,
    youtubeTranscriptMode: embeddedYoutube.youtubeTranscriptMode,
    mediaTranscriptMode: embeddedYoutube.mediaTranscriptMode,
    transcriptTimestamps,
    transcriptDiarization,
    transcriptVideoDownload,
    cacheMode,
    embeddedMediaUrl: embeddedYoutube.shouldUse ? embeddedYoutube.detection?.video.url : null,
  });
  if (payload.html) {
    await refreshYoutubeSourceMetrics({
      url,
      html: payload.html,
      detectedVideo: video,
      transcriptResolution,
      deps,
      timeoutMs,
      startedAtMs: extractionStartedAt,
    });
  }
  const htmlMetadata = payload.html
    ? extractMetadataFromHtml(payload.html, url)
    : { title: null, description: null, siteName: null };
  const metadata = extractMetadataFromFirecrawl(payload.metadata ?? null);

  const title = pickFirstText([jsonLd?.title, metadata.title, htmlMetadata.title]);
  const description = pickFirstText([
    jsonLd?.description,
    metadata.description,
    htmlMetadata.description,
  ]);
  const siteName = pickFirstText([metadata.siteName, htmlMetadata.siteName, safeHostname(url)]);

  const descriptionCandidate = description ? normalizeForPrompt(description) : "";
  const preferDescription =
    descriptionCandidate.length >= MIN_METADATA_DESCRIPTION_CHARACTERS &&
    (isPodcastJsonLd ||
      isPodcastHost(url) ||
      normalizedMarkdown.length < MIN_HTML_CONTENT_CHARACTERS ||
      descriptionCandidate.length >= normalizedMarkdown.length * READABILITY_RELATIVE_THRESHOLD);
  const baseCandidate = preferDescription ? descriptionCandidate : normalizedMarkdown;
  const embeddedSelection =
    embeddedYoutube.shouldUse && embeddedYoutube.detection
      ? selectEmbeddedVideoContent({
          articleContent: baseCandidate,
          transcriptText: transcriptResolution.text,
          transcriptSegments: transcriptResolution.segments,
          mode: resolvedEmbeddedVideoMode,
          videoUrl: embeddedYoutube.detection.video.url,
        })
      : null;
  const baseContent =
    embeddedSelection?.baseContent ??
    selectBaseContent(baseCandidate, transcriptResolution.text, transcriptResolution.segments);
  if (baseContent.length === 0) {
    firecrawlDiagnostics.notes = appendNote(
      firecrawlDiagnostics.notes,
      "Firecrawl produced content that normalized to an empty string",
    );
    return null;
  }

  firecrawlDiagnostics.used = true;

  const transcriptDiagnostics = ensureTranscriptDiagnostics(
    transcriptResolution,
    cacheMode ?? "default",
  );

  const isVideoOnly =
    !transcriptResolution.text &&
    normalizedMarkdown.length < MIN_HTML_CONTENT_CHARACTERS &&
    video !== null;

  return finalizeExtractedLinkContent({
    url,
    baseContent,
    contentSections: embeddedSelection?.contentSections ?? null,
    maxCharacters,
    title,
    description,
    siteName,
    transcriptResolution,
    video,
    isVideoOnly,
    diagnostics: {
      strategy: "firecrawl",
      firecrawl: firecrawlDiagnostics,
      markdown: {
        requested: markdownRequested,
        used: true,
        provider: "firecrawl",
      },
      transcript: transcriptDiagnostics,
      embeddedVideo: {
        mode: resolvedEmbeddedVideoMode,
        detected: embeddedYoutube.detection !== null,
        used: Boolean(embeddedYoutube.shouldUse && transcriptResolution.text),
        url: embeddedYoutube.detection?.video.url ?? null,
        source: embeddedYoutube.detection?.source ?? null,
        confidence: embeddedYoutube.detection?.confidence ?? null,
        composition: embeddedSelection?.composition ?? "article",
        notes: embeddedYoutube.notes,
      },
    },
  });
}
