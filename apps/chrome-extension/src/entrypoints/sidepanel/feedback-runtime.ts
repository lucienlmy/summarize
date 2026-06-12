import { createErrorController } from "./error-controller";
import { createHeaderController } from "./header-controller";
import type { PanelState } from "./types";

type FeedbackEventTarget = {
  addEventListener: (type: string, listener: EventListener) => void;
};

const OPTIONS_TAB_STORAGE_KEY = "summarize:options-tab";

export function createSidepanelFeedbackRuntime({
  panelState,
  headerEl,
  titleEl,
  subtitleEl,
  progressFillEl,
  panelErrorEl,
  panelErrorMessageEl,
  panelErrorRetryBtn,
  panelErrorLogsBtn,
  inlineErrorEl,
  inlineErrorMessageEl,
  inlineErrorRetryBtn,
  inlineErrorLogsBtn,
  inlineErrorCloseBtn,
  slideNoticeEl,
  slideNoticeMessageEl,
  slideNoticeRetryBtn,
  retryLastAction,
  retrySlidesStream,
  sendOpenOptions,
  eventTarget = window,
  storage = localStorage,
}: {
  panelState: PanelState;
  headerEl: HTMLElement;
  titleEl: HTMLElement;
  subtitleEl: HTMLElement;
  progressFillEl: HTMLElement;
  panelErrorEl: HTMLElement;
  panelErrorMessageEl: HTMLElement;
  panelErrorRetryBtn: HTMLButtonElement;
  panelErrorLogsBtn: HTMLButtonElement;
  inlineErrorEl: HTMLElement;
  inlineErrorMessageEl: HTMLElement;
  inlineErrorRetryBtn: HTMLButtonElement;
  inlineErrorLogsBtn: HTMLButtonElement;
  inlineErrorCloseBtn: HTMLButtonElement;
  slideNoticeEl: HTMLElement;
  slideNoticeMessageEl: HTMLElement;
  slideNoticeRetryBtn: HTMLButtonElement;
  retryLastAction: () => void;
  retrySlidesStream: () => void;
  sendOpenOptions: () => void;
  eventTarget?: FeedbackEventTarget;
  storage?: Pick<Storage, "setItem">;
}) {
  const headerController = createHeaderController({
    headerEl,
    titleEl,
    subtitleEl,
    progressFillEl,
    getState: () => ({
      phase: panelState.phase,
      summaryFromCache: panelState.summaryFromCache,
    }),
  });

  const openOptionsTab = (tabId: string) => {
    try {
      storage.setItem(OPTIONS_TAB_STORAGE_KEY, tabId);
    } catch {
      // Continue opening options when local storage is unavailable.
    }
    sendOpenOptions();
  };

  const errorController = createErrorController({
    panelEl: panelErrorEl,
    panelMessageEl: panelErrorMessageEl,
    panelRetryBtn: panelErrorRetryBtn,
    panelLogsBtn: panelErrorLogsBtn,
    inlineEl: inlineErrorEl,
    inlineMessageEl: inlineErrorMessageEl,
    inlineRetryBtn: inlineErrorRetryBtn,
    inlineLogsBtn: inlineErrorLogsBtn,
    inlineCloseBtn: inlineErrorCloseBtn,
    onRetry: retryLastAction,
    onOpenLogs: () => openOptionsTab("logs"),
    onPanelVisibilityChange: headerController.updateHeaderOffset,
  });

  const hideSlideNotice = () => {
    slideNoticeEl.classList.add("hidden");
    slideNoticeMessageEl.textContent = "";
    slideNoticeRetryBtn.hidden = true;
    headerController.updateHeaderOffset();
  };

  const showSlideNotice = (message: string, options?: { allowRetry?: boolean }) => {
    slideNoticeMessageEl.textContent = message;
    slideNoticeRetryBtn.hidden = !options?.allowRetry;
    slideNoticeEl.classList.remove("hidden");
    headerController.updateHeaderOffset();
  };

  headerController.updateHeaderOffset();
  eventTarget.addEventListener("resize", headerController.updateHeaderOffset as EventListener);
  slideNoticeRetryBtn.addEventListener("click", retrySlidesStream);

  return {
    errorController,
    headerController,
    hideSlideNotice,
    showSlideNotice,
  };
}
