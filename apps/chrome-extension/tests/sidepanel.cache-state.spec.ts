import { expect, test } from "@playwright/test";
import {
  buildSlidesPayload,
  mockDaemonSummarize,
  routePlaceholderSlideImages,
} from "./helpers/daemon-fixtures";
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
import {
  applySlidesPayload,
  getPanelSlideDescriptions,
  getPanelSlidesTimeline,
  getPanelSummaryMarkdown,
  waitForApplySlidesHook,
} from "./helpers/panel-hooks";

test("sidepanel restores cached state when switching YouTube tabs", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await mockDaemonSummarize(harness);
    await seedSettings(harness, {
      token: "test-token",
      autoSummarize: false,
      slidesEnabled: true,
      slidesOcrEnabled: true,
    });
    const page = await openExtensionPage(harness, "sidepanel.html", "#title", () => {
      (
        window as typeof globalThis & { __summarizeTestHooks?: Record<string, unknown> }
      ).__summarizeTestHooks = {};
    });
    await waitForPanelPort(page);

    const sseBody = (text: string) =>
      ["event: chunk", `data: ${JSON.stringify({ text })}`, "", "event: done", "data: {}", ""].join(
        "\n",
      );
    await page.route("http://127.0.0.1:8787/v1/summarize/**/events", async (route) => {
      const url = route.request().url();
      const match = url.match(/summarize\/([^/]+)\/events/);
      const runId = match ? (match[1] ?? "") : "";
      const body = runId === "run-a" ? sseBody("Summary A") : sseBody("Summary B");
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body,
      });
    });

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

    const tabAState = buildUiState({
      tab: { id: 1, url: "https://www.youtube.com/watch?v=alpha123", title: "Alpha Tab" },
      settings: {
        autoSummarize: false,
        slidesEnabled: true,
        slidesOcrEnabled: true,
        tokenPresent: true,
      },
      status: "",
    });
    await sendBgMessage(harness, { type: "ui:state", state: tabAState });
    await sendBgMessage(harness, {
      type: "run:start",
      run: {
        id: "run-a",
        url: "https://www.youtube.com/watch?v=alpha123",
        title: "Alpha Tab",
        model: "auto",
        reason: "manual",
      },
    });
    await expect(page.locator("#render")).toContainText("Summary A");

    await page.waitForFunction(
      () => {
        const hooks = (
          window as typeof globalThis & {
            __summarizeTestHooks?: { applySlidesPayload?: (payload: unknown) => void };
          }
        ).__summarizeTestHooks;
        return Boolean(hooks?.applySlidesPayload);
      },
      null,
      { timeout: 5_000 },
    );
    const slidesPayloadA = {
      sourceUrl: "https://www.youtube.com/watch?v=alpha123",
      sourceId: "alpha",
      sourceKind: "url",
      ocrAvailable: true,
      slides: [
        {
          index: 1,
          timestamp: 0,
          imageUrl: "http://127.0.0.1:8787/v1/slides/alpha/1?v=1",
          ocrText: "Alpha slide one.",
        },
        {
          index: 2,
          timestamp: 12,
          imageUrl: "http://127.0.0.1:8787/v1/slides/alpha/2?v=1",
          ocrText: "Alpha slide two.",
        },
      ],
    };
    await page.evaluate((payload) => {
      const hooks = (
        window as typeof globalThis & {
          __summarizeTestHooks?: { applySlidesPayload?: (payload: unknown) => void };
        }
      ).__summarizeTestHooks;
      hooks?.applySlidesPayload?.(payload);
    }, slidesPayloadA);
    await expect.poll(async () => (await getPanelSlideDescriptions(page)).length).toBe(2);
    const slidesA = await getPanelSlideDescriptions(page);
    expect(slidesA[0]?.[1] ?? "").toContain("Alpha");

    const tabBState = buildUiState({
      tab: { id: 2, url: "https://www.youtube.com/watch?v=bravo456", title: "Bravo Tab" },
      settings: {
        autoSummarize: false,
        slidesEnabled: true,
        slidesOcrEnabled: true,
        tokenPresent: true,
      },
      status: "",
    });
    await sendBgMessage(harness, { type: "ui:state", state: tabBState });
    await expect(page.locator("#title")).toHaveText("Bravo Tab");
    await sendBgMessage(harness, {
      type: "run:start",
      run: {
        id: "run-b",
        url: "https://www.youtube.com/watch?v=bravo456",
        title: "Bravo Tab",
        model: "auto",
        reason: "manual",
      },
    });
    await expect(page.locator("#render")).toContainText("Summary B");

    const slidesPayloadB = {
      sourceUrl: "https://www.youtube.com/watch?v=bravo456",
      sourceId: "bravo",
      sourceKind: "url",
      ocrAvailable: true,
      slides: [
        {
          index: 1,
          timestamp: 0,
          imageUrl: "http://127.0.0.1:8787/v1/slides/bravo/1?v=1",
          ocrText: "Bravo slide one.",
        },
      ],
    };
    await page.evaluate((payload) => {
      const hooks = (
        window as typeof globalThis & {
          __summarizeTestHooks?: { applySlidesPayload?: (payload: unknown) => void };
        }
      ).__summarizeTestHooks;
      hooks?.applySlidesPayload?.(payload);
    }, slidesPayloadB);
    await expect.poll(async () => (await getPanelSlideDescriptions(page)).length).toBe(1);
    const slidesB = await getPanelSlideDescriptions(page);
    expect(slidesB[0]?.[1] ?? "").toContain("Bravo");

    await sendBgMessage(harness, { type: "ui:state", state: tabAState });
    await expect(page.locator("#title")).toHaveText("Alpha Tab");
    await expect.poll(async () => await getPanelSummaryMarkdown(page)).toContain("Summary A");
    const restoredSlides = await getPanelSlideDescriptions(page);
    expect(restoredSlides[0]?.[1] ?? "").toContain("Alpha");
    expect(restoredSlides.some((entry) => entry[1].includes("Bravo"))).toBe(false);

    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test("sidepanel clears cached slides when switching from a cached YouTube video to an uncached one", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await mockDaemonSummarize(harness);
    await seedSettings(harness, {
      token: "test-token",
      autoSummarize: false,
      slidesEnabled: true,
      slidesParallel: true,
      slidesOcrEnabled: true,
    });
    const page = await openExtensionPage(harness, "sidepanel.html", "#title", () => {
      (
        window as typeof globalThis & { __summarizeTestHooks?: Record<string, unknown> }
      ).__summarizeTestHooks = {};
    });
    await waitForPanelPort(page);

    const sseBody = (text: string) =>
      ["event: chunk", `data: ${JSON.stringify({ text })}`, "", "event: done", "data: {}", ""].join(
        "\n",
      );
    await page.route("http://127.0.0.1:8787/v1/summarize/**/events", async (route) => {
      const runId =
        route
          .request()
          .url()
          .match(/summarize\/([^/]+)\/events/)?.[1] ?? "";
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: runId === "run-a" ? sseBody("Summary A") : sseBody("Summary B"),
      });
    });
    await routePlaceholderSlideImages(page);

    const tabAState = buildUiState({
      tab: { id: 1, url: "https://www.youtube.com/watch?v=alpha123", title: "Alpha Tab" },
      settings: {
        autoSummarize: false,
        slidesEnabled: true,
        slidesParallel: true,
        slidesOcrEnabled: true,
        tokenPresent: true,
      },
    });
    const tabBState = buildUiState({
      tab: { id: 2, url: "https://www.youtube.com/watch?v=bravo456", title: "Bravo Tab" },
      settings: {
        autoSummarize: false,
        slidesEnabled: true,
        slidesParallel: true,
        slidesOcrEnabled: true,
        tokenPresent: true,
      },
    });

    await sendBgMessage(harness, { type: "ui:state", state: tabAState });
    await sendBgMessage(harness, {
      type: "run:start",
      run: {
        id: "run-a",
        url: "https://www.youtube.com/watch?v=alpha123",
        title: "Alpha Tab",
        model: "auto",
        reason: "manual",
      },
    });
    await expect(page.locator("#render")).toContainText("Summary A");
    await waitForApplySlidesHook(page);
    await applySlidesPayload(
      page,
      buildSlidesPayload({
        sourceUrl: "https://www.youtube.com/watch?v=alpha123",
        sourceId: "youtube-alpha123",
        count: 2,
        textPrefix: "Alpha",
      }),
    );
    await expect.poll(async () => (await getPanelSlideDescriptions(page)).length).toBe(2);
    expect((await getPanelSlideDescriptions(page))[0]?.[1] ?? "").toContain("Alpha");

    await sendBgMessage(harness, { type: "ui:state", state: tabBState });
    await expect(page.locator("#title")).toHaveText("Bravo Tab");
    const emptyState = page.locator('#render [data-empty-state="true"]');
    await expect(emptyState).toContainText("Click Summarize to start.");
    await expect(emptyState).toContainText("Bravo Tab");
    await expect(page.locator("#render")).not.toContainText("Summary A");
    await expect.poll(async () => (await getPanelSlideDescriptions(page)).length).toBe(0);

    await sendBgMessage(harness, { type: "ui:state", state: tabAState });
    await expect(page.locator("#title")).toHaveText("Alpha Tab");
    await expect.poll(async () => await getPanelSummaryMarkdown(page)).toContain("Summary A");
    const restoredSlides = await getPanelSlideDescriptions(page);
    expect(restoredSlides).toHaveLength(2);
    expect(restoredSlides.every(([, text]) => text.includes("Alpha"))).toBe(true);

    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test("sidepanel keeps cached slides isolated while a different YouTube video resumes uncached slides", async ({
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
    const page = await openExtensionPage(harness, "sidepanel.html", "#title", () => {
      (
        window as typeof globalThis & { __summarizeTestHooks?: Record<string, unknown> }
      ).__summarizeTestHooks = {};
    });
    await waitForPanelPort(page);

    const summaryBody = (text: string) =>
      ["event: chunk", `data: ${JSON.stringify({ text })}`, "", "event: done", "data: {}", ""].join(
        "\n",
      );
    await page.route("http://127.0.0.1:8787/v1/summarize/**/events", async (route) => {
      const runId =
        route
          .request()
          .url()
          .match(/summarize\/([^/]+)\/events/)?.[1] ?? "";
      let body = summaryBody("Summary");
      if (runId === "run-a") body = summaryBody("Summary A");
      if (runId === "run-b") body = summaryBody("Summary B");
      if (runId === "slides-a") body = summaryBody("Slides summary A");
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body,
      });
    });

    const alphaPayload = buildSlidesPayload({
      sourceUrl: "https://www.youtube.com/watch?v=alpha123",
      sourceId: "youtube-alpha123",
      count: 2,
      textPrefix: "Alpha",
    });
    await page.route("http://127.0.0.1:8787/v1/summarize/**/slides", async (route) => {
      const url = route.request().url();
      if (url.includes("/slides-a/slides")) {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ok: true, slides: alphaPayload }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: false, error: "not found" }),
      });
    });
    await page.route("http://127.0.0.1:8787/v1/summarize/slides-a/slides/events", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: [
          "event: slides",
          `data: ${JSON.stringify(alphaPayload)}`,
          "",
          "event: done",
          "data: {}",
          "",
        ].join("\n"),
      });
    });
    await routePlaceholderSlideImages(page);

    const tabAState = buildUiState({
      tab: { id: 1, url: "https://www.youtube.com/watch?v=alpha123", title: "Alpha Tab" },
      media: { hasVideo: true, hasAudio: true, hasCaptions: true },
      settings: {
        autoSummarize: false,
        slidesEnabled: true,
        slidesParallel: true,
        slidesOcrEnabled: true,
        tokenPresent: true,
      },
    });
    const tabBState = buildUiState({
      tab: { id: 2, url: "https://www.youtube.com/watch?v=bravo456", title: "Bravo Tab" },
      media: { hasVideo: true, hasAudio: true, hasCaptions: true },
      settings: {
        autoSummarize: false,
        slidesEnabled: true,
        slidesParallel: true,
        slidesOcrEnabled: true,
        tokenPresent: true,
      },
    });

    await sendBgMessage(harness, { type: "ui:state", state: tabAState });
    await sendBgMessage(harness, {
      type: "run:start",
      run: {
        id: "run-a",
        url: "https://www.youtube.com/watch?v=alpha123",
        title: "Alpha Tab",
        model: "auto",
        reason: "manual",
      },
    });
    await expect(page.locator("#render")).toContainText("Summary A");

    await sendBgMessage(harness, { type: "ui:state", state: tabBState });
    await sendBgMessage(harness, {
      type: "run:start",
      run: {
        id: "run-b",
        url: "https://www.youtube.com/watch?v=bravo456",
        title: "Bravo Tab",
        model: "auto",
        reason: "manual",
      },
    });
    await expect(page.locator("#render")).toContainText("Summary B");
    await waitForApplySlidesHook(page);
    await applySlidesPayload(
      page,
      buildSlidesPayload({
        sourceUrl: "https://www.youtube.com/watch?v=bravo456",
        sourceId: "youtube-bravo456",
        count: 1,
        textPrefix: "Bravo",
      }),
    );
    await expect.poll(async () => (await getPanelSlideDescriptions(page)).length).toBe(1);
    expect((await getPanelSlideDescriptions(page))[0]?.[1] ?? "").toContain("Bravo");

    await sendBgMessage(harness, {
      type: "slides:run",
      ok: true,
      runId: "slides-a",
      url: "https://www.youtube.com/watch?v=alpha123",
    });
    await expect.poll(async () => await getPanelSummaryMarkdown(page)).toContain("Summary B");
    await expect.poll(async () => (await getPanelSlidesTimeline(page)).length).toBe(1);

    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});
