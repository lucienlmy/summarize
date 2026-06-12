import { describe, expect, it, vi } from "vitest";
import { startPanelDaemonSummary } from "../apps/chrome-extension/src/entrypoints/background/panel-summary-daemon.js";
import { defaultSettings } from "../apps/chrome-extension/src/lib/settings.js";

function createOptions() {
  const body = { url: "https://example.com", slides: true };
  const buildSummarizeRequestBody = vi.fn(() => body);
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ ok: true, id: "run-1" }),
  })) as unknown as typeof fetch;
  const log = vi.fn();
  return {
    options: {
      extracted: {
        ok: true as const,
        url: "https://example.com",
        title: "Example",
        text: "Body",
        truncated: false,
        media: null,
      },
      settings: { ...defaultSettings, token: " secret ", slideRuntime: "daemon" as const },
      noCache: true,
      inputMode: "video" as const,
      timestamps: true,
      slides: {
        enabled: true as const,
        ocr: true,
        maxSlides: null,
        minDurationSeconds: null,
      },
      signal: new AbortController().signal,
      fetchImpl,
      buildSummarizeRequestBody,
      log,
    },
    body,
    buildSummarizeRequestBody,
    fetchImpl,
    log,
  };
}

describe("chrome panel summary daemon", () => {
  it("builds and starts a daemon summary request", async () => {
    const harness = createOptions();

    await expect(startPanelDaemonSummary(harness.options)).resolves.toBe("run-1");

    expect(harness.buildSummarizeRequestBody).toHaveBeenCalledWith({
      extracted: harness.options.extracted,
      settings: harness.options.settings,
      noCache: true,
      inputMode: "video",
      timestamps: true,
      slides: harness.options.slides,
    });
    expect(harness.fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8787/v1/summarize", {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: JSON.stringify(harness.body),
      signal: harness.options.signal,
    });
    expect(harness.log).toHaveBeenCalledWith("summarize:request", {
      url: "https://example.com",
      slides: true,
      slideRuntime: "daemon",
      slidesParallel: false,
      timestamps: true,
    });
  });

  it("surfaces daemon protocol errors", async () => {
    const harness = createOptions();
    harness.options.fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({ ok: false, error: "bad token" }),
    })) as unknown as typeof fetch;

    await expect(startPanelDaemonSummary(harness.options)).rejects.toThrow("bad token");
  });

  it("falls back to HTTP status when the daemon omits an error", async () => {
    const harness = createOptions();
    harness.options.fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ ok: false }),
    })) as unknown as typeof fetch;

    await expect(startPanelDaemonSummary(harness.options)).rejects.toThrow(
      "500 Internal Server Error",
    );
  });
});
