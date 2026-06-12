import { afterEach, describe, expect, it, vi } from "vitest";
import { daemonHealth } from "../apps/chrome-extension/src/entrypoints/background/daemon-client.js";

describe("chrome daemon client", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("clears request timeouts when daemon fetch attempts reject", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const health = daemonHealth();
    await vi.advanceTimersByTimeAsync(400);

    await expect(health).resolves.toMatchObject({ ok: false });
    expect(vi.getTimerCount()).toBe(0);
  });
});
