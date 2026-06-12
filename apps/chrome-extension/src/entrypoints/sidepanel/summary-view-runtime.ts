import { isYouTubeVideoUrl, shouldPreferUrlMode } from "@steipete/summarize-core/content/url";
import { buildIdleSubtitle } from "../../lib/header";
import type { PanelCachePayload } from "./panel-cache";
import { applyPanelStateAction, type PanelStateAction } from "./panel-state-store";
import { normalizeSlideImageUrl } from "./slide-images";
import { normalizeSlidesPayload } from "./slides-payload";
import { clearSummaryCopyButton } from "./summary-renderer";
import type { PanelPhase, PanelState } from "./types";

type SlidesTextControllerLike = {
  reset: () => void;
  getTranscriptAvailable: () => boolean;
};

type SlidesHydratorLike = {
  syncFromCache: (payload: {
    runId: string | null;
    summaryFromCache: boolean | null;
    hasSlides: boolean;
  }) => void;
};

type MetricsControllerLike = {
  clearForMode: (mode: "summary" | "chat") => void;
};

type HeaderControllerLike = {
  setBaseTitle: (value: string) => void;
  setBaseSubtitle: (value: string) => void;
};

type SummaryViewRuntimeOpts = {
  panelState: PanelState;
  dispatchPanelState?: (action: PanelStateAction) => void;
  renderEl: HTMLElement;
  renderSlidesHostEl: HTMLElement;
  renderMarkdownHostEl: HTMLElement;
  summaryCopyBtn: HTMLButtonElement;
  slidesRenderer: { clear: () => void };
  metricsController: MetricsControllerLike;
  headerController: HeaderControllerLike;
  slidesTextController: SlidesTextControllerLike;
  slidesHydrator: SlidesHydratorLike;
  stopSlidesStream: () => void;
  refreshSummarizeControl: () => void;
  resetChatState: () => void;
  setSlidesTranscriptTimedText: (value: string | null) => void;
  updateSlidesTextState: () => void;
  requestSlidesContext: () => void | Promise<void>;
  requestSlidesCapture: () => void;
  updateSlideSummaryFromMarkdown: (
    markdown: string,
    opts?: { preserveIfEmpty?: boolean; source?: "summary" | "slides" },
  ) => void;
  renderMarkdown: (markdown: string) => void;
  renderMarkdownDisplay: () => void;
  queueSlidesRender: () => void;
  setPhase: (phase: PanelPhase, opts?: { error?: string | null }) => void;
};

export function createSummaryViewRuntime(opts: SummaryViewRuntimeOpts) {
  const dispatch = (action: PanelStateAction) => {
    if (opts.dispatchPanelState) {
      opts.dispatchPanelState(action);
    } else {
      applyPanelStateAction(opts.panelState, action);
    }
  };
  const resolveActiveSlidesRunId = () => {
    if (opts.panelState.slidesRunId) return opts.panelState.slidesRunId;
    if (opts.panelState.slides && opts.panelState.runId) return opts.panelState.runId;
    return null;
  };

  function resetSummaryView({
    preserveChat = false,
    clearRunId = true,
    stopSlides = true,
  }: {
    preserveChat?: boolean;
    clearRunId?: boolean;
    stopSlides?: boolean;
  } = {}) {
    opts.renderEl.replaceChildren(opts.renderSlidesHostEl, opts.renderMarkdownHostEl);
    opts.renderMarkdownHostEl.innerHTML = "";
    clearSummaryCopyButton(opts.summaryCopyBtn);
    opts.metricsController.clearForMode("summary");
    dispatch({ type: "reset-summary", clearRunId, clearSlides: stopSlides });
    dispatch({
      type: "slides-session-update",
      value: {
        slidesExpanded: true,
        ...(stopSlides
          ? {
              slidesContextPending: false,
              slidesContextUrl: null,
              slidesSeededSourceId: null,
              slidesAppliedRunId: null,
            }
          : {}),
      },
    });
    if (stopSlides) {
      opts.slidesRenderer.clear();
      opts.setSlidesTranscriptTimedText(null);
      opts.slidesTextController.reset();
      opts.stopSlidesStream();
    }
    opts.refreshSummarizeControl();
    if (!preserveChat) {
      opts.resetChatState();
    }
  }

  function applyPanelCache(payload: PanelCachePayload, applyOpts?: { preserveChat?: boolean }) {
    const preserveChat = applyOpts?.preserveChat ?? false;
    resetSummaryView({ preserveChat });
    const slidesRunId =
      payload.slidesRunId ??
      (opts.panelState.slidesSession.slidesParallel ? null : (payload.runId ?? null));
    dispatch({
      type: "restore-session",
      tabId: payload.tabId,
      runId: payload.runId ?? null,
      slidesRunId,
      source: { url: payload.url, title: payload.title ?? null },
      meta: payload.lastMeta ?? {
        inputSummary: null,
        model: null,
        modelLabel: null,
      },
      summaryFromCache: payload.summaryFromCache ?? null,
    });
    dispatch({
      type: "slides-summary-update",
      value: {
        markdown: payload.slidesSummaryMarkdown ?? "",
        complete:
          payload.slidesSummaryComplete ?? Boolean((payload.slidesSummaryMarkdown ?? "").trim()),
        model:
          payload.slidesSummaryModel ??
          opts.panelState.lastMeta.model ??
          opts.panelState.ui?.settings.model ??
          null,
        pending: null,
        hadError: false,
      },
    });
    opts.headerController.setBaseTitle(payload.title || payload.url || "Summarize");
    opts.headerController.setBaseSubtitle(
      buildIdleSubtitle({
        inputSummary: opts.panelState.lastMeta.inputSummary,
        modelLabel: opts.panelState.lastMeta.modelLabel,
        model: opts.panelState.lastMeta.model,
      }),
    );
    opts.setSlidesTranscriptTimedText(payload.transcriptTimedText ?? null);
    const normalizedSlides = normalizeSlidesPayload(payload.slides);
    const hasNormalizedSlides = Boolean(normalizedSlides && normalizedSlides.slides.length > 0);
    if (normalizedSlides && hasNormalizedSlides) {
      dispatch({
        type: "slides",
        slides: {
          ...normalizedSlides,
          slides: normalizedSlides.slides.map((slide) => ({
            ...slide,
            imageUrl: normalizeSlideImageUrl(
              slide.imageUrl,
              normalizedSlides.sourceId,
              slide.index,
            ),
          })),
        },
      });
      dispatch({
        type: "slides-session-update",
        value: {
          slidesContextPending: false,
          slidesContextUrl: opts.slidesTextController.getTranscriptAvailable() ? payload.url : null,
        },
      });
      opts.updateSlidesTextState();
      if (
        !opts.slidesTextController.getTranscriptAvailable() &&
        payload.url &&
        !shouldPreferUrlMode(payload.url)
      ) {
        void opts.requestSlidesContext();
      }
      dispatch({
        type: "slides-session-update",
        value: { slidesAppliedRunId: resolveActiveSlidesRunId() },
      });
    } else {
      dispatch({ type: "slides", slides: null });
      dispatch({
        type: "slides-session-update",
        value: {
          slidesContextPending: false,
          slidesContextUrl: null,
          slidesAppliedRunId: null,
        },
      });
      opts.updateSlidesTextState();
      if (payload.summaryMarkdown && payload.url && isYouTubeVideoUrl(payload.url)) {
        opts.requestSlidesCapture();
      }
    }
    opts.slidesHydrator.syncFromCache({
      runId: opts.panelState.slidesRunId ?? null,
      summaryFromCache: payload.summaryFromCache,
      hasSlides: hasNormalizedSlides,
    });
    if ((payload.slidesSummaryMarkdown ?? "").trim()) {
      opts.updateSlideSummaryFromMarkdown(payload.slidesSummaryMarkdown ?? "", {
        preserveIfEmpty: false,
        source: "slides",
      });
    }
    if (payload.summaryMarkdown) {
      opts.renderMarkdown(payload.summaryMarkdown);
    } else {
      opts.renderMarkdownDisplay();
    }
    opts.queueSlidesRender();
    opts.setPhase("idle");
  }

  return {
    applyPanelCache,
    resetSummaryView,
  };
}
