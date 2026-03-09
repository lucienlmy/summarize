import { expect, test } from "@playwright/test";
import { buildSlidesPayload, routePlaceholderSlideImages } from "./helpers/daemon-fixtures";
import {
  assertNoErrors,
  buildUiState,
  closeExtension,
  getBrowserFromProject,
  launchExtension,
  openExtensionPage,
  seedSettings,
  sendBgMessage,
  waitForPanelPort,
} from "./helpers/extension-harness";
import { allowFirefoxExtensionTests } from "./helpers/extension-test-config";
import {
  applySlidesPayload,
  getPanelSlideDescriptions,
  getPanelSlideSummaryEntries,
  getPanelSlideTitleEntries,
  getPanelSlidesSummaryMarkdown,
  getPanelSlidesTimeline,
  waitForApplySlidesHook,
  waitForSlidesRuntimeHooks,
  waitForSettingsHydratedHook,
  waitForTranscriptTimedTextHook,
} from "./helpers/panel-hooks";

test.skip(
  ({ browserName }) => browserName === "firefox" && !allowFirefoxExtensionTests,
  "Firefox extension tests are blocked by Playwright limitations. Set ALLOW_FIREFOX_EXTENSION_TESTS=1 to run.",
);

test("sidepanel replaces placeholder slides with the final smaller payload", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await seedSettings(harness, {
      token: "test-token",
      autoSummarize: false,
      slidesEnabled: true,
      slidesParallel: true,
      slidesOcrEnabled: true,
    });
    const page = await openExtensionPage(harness, "sidepanel.html", "#title");
    await waitForPanelPort(page);
    await waitForSettingsHydratedHook(page);
    await waitForSlidesRuntimeHooks(page);
    await waitForTranscriptTimedTextHook(page);
    await routePlaceholderSlideImages(page);

    await sendBgMessage(harness, {
      type: "ui:state",
      state: buildUiState({
        tab: {
          id: 1,
          url: "https://www.youtube.com/watch?v=helia123",
          title: "Helia Video",
        },
        media: { hasVideo: true, hasAudio: true, hasCaptions: true },
        settings: {
          autoSummarize: false,
          slidesEnabled: true,
          slidesParallel: true,
          slidesOcrEnabled: true,
          tokenPresent: true,
        },
      }),
    });

    await applySlidesPayload(page, {
      sourceUrl: "https://www.youtube.com/watch?v=helia123",
      sourceId: "youtube-helia123",
      sourceKind: "youtube",
      ocrAvailable: false,
      slides: [
        { index: 1, timestamp: 2, imageUrl: "", ocrText: null },
        { index: 2, timestamp: 63, imageUrl: "", ocrText: null },
      ],
    });

    await expect.poll(async () => (await getPanelSlidesTimeline(page)).length).toBe(2);

    await applySlidesPayload(
      page,
      buildSlidesPayload({
        sourceUrl: "https://www.youtube.com/watch?v=helia123",
        sourceId: "youtube-helia123",
        count: 1,
        textPrefix: "Final",
      }),
    );

    await expect.poll(async () => (await getPanelSlidesTimeline(page)).length).toBe(1);
    await expect(
      page.locator("img.slideStrip__thumbImage, img.slideInline__thumbImage"),
    ).toHaveCount(1);
    await expect(
      page.locator(
        'img.slideStrip__thumbImage[data-loaded="true"], img.slideInline__thumbImage[data-loaded="true"]',
      ),
    ).toHaveCount(1);
    const slides = await getPanelSlideDescriptions(page);
    expect(slides[0]?.[1] ?? "").toContain("Final slide 1");

    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test("sidepanel shows transcript-first gallery cards and hides the big summary block in slide mode", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await seedSettings(harness, {
      token: "test-token",
      autoSummarize: false,
      slidesEnabled: true,
      slidesParallel: true,
      slidesOcrEnabled: true,
      slidesLayout: "strip",
    });
    const page = await openExtensionPage(harness, "sidepanel.html", "#title");
    await waitForPanelPort(page);
    await waitForSettingsHydratedHook(page);
    await waitForApplySlidesHook(page);

    await sendBgMessage(harness, {
      type: "ui:state",
      state: buildUiState({
        tab: {
          id: 1,
          url: "https://www.youtube.com/watch?v=heliafast",
          title: "Helia Video",
        },
        media: { hasVideo: true, hasAudio: true, hasCaptions: true },
        stats: { pageWords: 120, videoDurationSeconds: 120 },
        settings: {
          autoSummarize: false,
          slidesEnabled: true,
          slidesParallel: true,
          slidesOcrEnabled: true,
          slidesLayout: "strip",
          tokenPresent: true,
        },
      }),
    });

    await applySlidesPayload(page, {
      sourceUrl: "https://www.youtube.com/watch?v=heliafast",
      sourceId: "youtube-heliafast",
      sourceKind: "youtube",
      ocrAvailable: false,
      slides: [
        { index: 1, timestamp: 2, imageUrl: "", ocrText: "Helia returns to command." },
        { index: 2, timestamp: 60, imageUrl: "", ocrText: null },
      ],
    });

    await expect
      .poll(
        async () => (await getPanelSlideDescriptions(page)).map(([, text]) => text).join("\n"),
        { timeout: 10_000 },
      )
      .toContain("Helia returns to command.");
    await expect(page.locator(".slideGallery")).toHaveCount(1);
    await expect(page.locator(".slideStrip")).toHaveCount(0);

    await page.evaluate((markdown) => {
      const hooks = (
        window as typeof globalThis & {
          __summarizeTestHooks?: {
            applySummaryMarkdown?: (value: string) => void;
          };
        }
      ).__summarizeTestHooks;
      hooks?.applySummaryMarkdown?.(markdown);
    }, "Overall summary that should stay hidden in slide mode.");

    await expect(page.locator("#render")).not.toContainText(
      "Overall summary that should stay hidden in slide mode.",
    );
    await expect(
      page.locator(
        'img.slideStrip__thumbImage[data-loaded="true"], img.slideInline__thumbImage[data-loaded="true"]',
      ),
    ).toHaveCount(0);

    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test("sidepanel scrolls YouTube slides and shows text for each slide", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await seedSettings(harness, {
      token: "test-token",
      autoSummarize: false,
      slidesEnabled: true,
      slidesLayout: "gallery",
      slidesOcrEnabled: true,
    });
    const page = await openExtensionPage(harness, "sidepanel.html", "#title");
    await waitForPanelPort(page);
    await waitForSettingsHydratedHook(page);

    const placeholderPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3kq0cAAAAASUVORK5CYII=",
      "base64",
    );
    await page.route("http://127.0.0.1:8787/v1/slides/**", async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "image/png",
          "x-summarize-slide-ready": "1",
        },
        body: placeholderPng,
      });
    });

    const sourceUrl = "https://www.youtube.com/watch?v=scrollTest123";
    const uiState = buildUiState({
      tab: { id: 1, url: sourceUrl, title: "Scroll Test" },
      media: { hasVideo: true, hasAudio: true, hasCaptions: false },
      stats: { pageWords: 120, videoDurationSeconds: 600 },
      settings: {
        autoSummarize: false,
        slidesEnabled: true,
        slidesOcrEnabled: true,
        slidesLayout: "gallery",
        tokenPresent: true,
      },
      status: "",
    });
    await sendBgMessage(harness, { type: "ui:state", state: uiState });

    await waitForApplySlidesHook(page);

    const slidesPayload = buildSlidesPayload({
      sourceUrl,
      sourceId: "yt-scroll",
      count: 12,
      textPrefix: "YouTube",
    });
    await page.evaluate((payload) => {
      const hooks = (
        window as typeof globalThis & {
          __summarizeTestHooks?: {
            applySlidesPayload?: (payload: unknown) => void;
          };
        }
      ).__summarizeTestHooks;
      hooks?.applySlidesPayload?.(payload);
    }, slidesPayload);

    await expect.poll(async () => (await getPanelSlideDescriptions(page)).length).toBe(12);
    const renderedCount = await page.evaluate(() => {
      const hooks = (
        window as typeof globalThis & {
          __summarizeTestHooks?: { forceRenderSlides?: () => number };
        }
      ).__summarizeTestHooks;
      return hooks?.forceRenderSlides?.() ?? 0;
    });
    expect(renderedCount).toBeGreaterThan(0);

    const slideItems = page.locator(".slideGallery__item");
    await expect(slideItems).toHaveCount(12);

    const galleryList = page.locator(".slideGallery__list");
    await expect(galleryList).toBeVisible();
    await galleryList.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(slideItems.nth(11)).toBeVisible();

    await expect
      .poll(async () =>
        page.evaluate(() =>
          Array.from(
            document.querySelectorAll<HTMLImageElement>("img.slideInline__thumbImage"),
          ).every((img) => (img.dataset.slideImageUrl ?? "").trim().length > 0),
        ),
      )
      .toBe(true);

    await expect
      .poll(async () =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>(".slideGallery__text")).every(
            (el) => (el.textContent ?? "").trim().length > 0,
          ),
        ),
      )
      .toBe(true);

    const slideDescriptions = await getPanelSlideDescriptions(page);
    expect(slideDescriptions).toHaveLength(12);
    expect(slideDescriptions.every(([, text]) => text.trim().length > 0)).toBe(true);

    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});
