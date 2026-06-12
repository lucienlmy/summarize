import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureOffscreenDocument: vi.fn(async () => undefined),
  getPrimaryMediaInfoInTab: vi.fn(),
}));

vi.mock("../apps/chrome-extension/src/entrypoints/background/content-script-bridge.js", () => ({
  getPrimaryMediaInfoInTab: mocks.getPrimaryMediaInfoInTab,
}));

vi.mock("../apps/chrome-extension/src/entrypoints/background/browser-media.js", () => ({
  ensureOffscreenDocument: mocks.ensureOffscreenDocument,
  isBrowserMediaUrl: (value: string) => /^https?:\/\//u.test(value),
}));

import { transcribeBrowserMediaInTab } from "../apps/chrome-extension/src/entrypoints/background/browser-local-transcript.js";

const diagnostics = {
  chunksProcessed: 1,
  chunksTotal: 1,
  codec: "mp3",
  decoder: "mediabunny-webcodecs" as const,
  durationSeconds: 42,
  input: "url-range" as const,
  whisper: {
    backend: "transformers-js-webgpu" as const,
    model: "test",
    modelId: "test",
    modelSize: "tiny" as const,
    runtime: "webgpu" as const,
  },
};

describe("browser local transcript", () => {
  beforeEach(() => {
    mocks.ensureOffscreenDocument.mockClear();
    mocks.getPrimaryMediaInfoInTab.mockReset();
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn(async () => ({
          ok: true,
          diagnostics,
          text: "Transcript",
          transcriptTimedText: "[0:00] Transcript",
          truncated: false,
        })),
      },
    };
  });

  it("transcribes direct media without page inspection", async () => {
    const result = await transcribeBrowserMediaInTab({
      maxChars: 10_000,
      tabId: 7,
      tabUrl: "https://media.example/episode.mp3",
    });

    expect(result).toMatchObject({
      ok: true,
      source: "direct",
      durationSeconds: 42,
    });
    expect(mocks.getPrimaryMediaInfoInTab).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: "include",
        mediaUrl: "https://media.example/episode.mp3",
      }),
    );
  });

  it("keeps page credentials for embedded media", async () => {
    mocks.getPrimaryMediaInfoInTab.mockResolvedValue({
      ok: true,
      currentTimeSeconds: 0,
      durationSeconds: 30,
      mediaSrc: "https://media.example/embedded.mp4",
      title: "Embedded",
      url: "https://example.com/article",
    });

    const result = await transcribeBrowserMediaInTab({
      maxChars: 10_000,
      tabId: 8,
      tabUrl: "https://example.com/article",
    });

    expect(result).toMatchObject({
      ok: true,
      source: "embedded",
      durationSeconds: 30,
    });
    expect(mocks.getPrimaryMediaInfoInTab).toHaveBeenCalledWith(8);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: "include",
        mediaUrl: "https://media.example/embedded.mp4",
      }),
    );
  });
});
