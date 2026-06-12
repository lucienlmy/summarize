import { describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "../packages/core/src/content/link-preview/fetch-with-timeout.js";

describe("fetchWithTimeout", () => {
  it("preserves caller cancellation when init.signal is provided", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).not.toBe(controller.signal);
      expect(init?.signal?.aborted).toBe(false);
      return new Response("ok", { status: 200 });
    });

    const response = await fetchWithTimeout(fetchMock as unknown as typeof fetch, "https://x.com", {
      signal: controller.signal,
    });
    expect(await response.text()).toBe("ok");
  });

  it("keeps the timeout active when init.signal is provided", async () => {
    vi.useFakeTimers();
    try {
      const caller = new AbortController();
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }) as Promise<Response>;
      });

      const promise = fetchWithTimeout(
        fetchMock as unknown as typeof fetch,
        "https://example.com",
        { signal: caller.signal },
        10,
      );
      const assertion = expect(promise).rejects.toMatchObject({ name: "FetchTimeoutError" });
      await vi.advanceTimersByTimeAsync(20);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not report caller cancellation as a timeout", async () => {
    vi.useFakeTimers();
    try {
      const caller = new AbortController();
      let rejectFetch: ((reason?: unknown) => void) | null = null;
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            rejectFetch = () => reject(init.signal?.reason);
          });
        }) as Promise<Response>;
      });
      const cancelled = new DOMException("cancelled", "AbortError");
      const promise = fetchWithTimeout(
        fetchMock as unknown as typeof fetch,
        "https://example.com",
        { signal: caller.signal },
        1000,
      );

      caller.abort(cancelled);
      await vi.advanceTimersByTimeAsync(2000);
      rejectFetch?.();

      await expect(promise).rejects.toBe(cancelled);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws FetchTimeoutError on abort", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        return new Promise((_resolve, reject) => {
          if (!signal) {
            reject(new Error("Missing abort signal"));
            return;
          }
          signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }) as Promise<Response>;
      });

      const promise = fetchWithTimeout(
        fetchMock as unknown as typeof fetch,
        "https://example.com",
        undefined,
        10,
      );
      const assertion = expect(promise).rejects.toMatchObject({ name: "FetchTimeoutError" });
      await vi.advanceTimersByTimeAsync(20);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts even when DOMException is unavailable", async () => {
    vi.useFakeTimers();
    const originalDomException = globalThis.DOMException;
    (globalThis as unknown as { DOMException?: typeof DOMException }).DOMException = undefined;

    try {
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        return new Promise((_resolve, reject) => {
          if (!signal) {
            reject(new Error("Missing abort signal"));
            return;
          }
          signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }) as Promise<Response>;
      });

      const promise = fetchWithTimeout(
        fetchMock as unknown as typeof fetch,
        "https://example.com",
        undefined,
        -1,
      );
      const assertion = expect(promise).rejects.toMatchObject({ name: "FetchTimeoutError" });
      await vi.advanceTimersByTimeAsync(1);
      await assertion;
    } finally {
      (globalThis as unknown as { DOMException?: typeof DOMException }).DOMException =
        originalDomException;
      vi.useRealTimers();
    }
  });

  it("keeps the timeout active while consuming the response body", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        return {
          ok: true,
          text: () =>
            new Promise<string>((_resolve, reject) => {
              signal?.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
              });
            }),
        } as Response;
      });

      const promise = fetchWithTimeout(
        fetchMock as unknown as typeof fetch,
        "https://example.com",
        undefined,
        10,
        async (response) => await response.text(),
      );
      const assertion = expect(promise).rejects.toMatchObject({ name: "FetchTimeoutError" });
      await vi.advanceTimersByTimeAsync(20);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
