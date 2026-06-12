import { describe, expect, it } from "vitest";
import type { SandboxHandlers } from "../apps/chrome-extension/src/automation/repl-sandbox-contracts";
import { buildSandboxHtml } from "../apps/chrome-extension/src/automation/repl-sandbox-document";
import { dispatchSandboxRpc } from "../apps/chrome-extension/src/automation/repl-sandbox-rpc";

describe("automation REPL sandbox", () => {
  it("builds the isolated execution document with the supported helper contract", () => {
    const html = buildSandboxHtml();

    expect(html).toContain("summarize-repl");
    expect(html).toContain("new AsyncFunction(");
    expect(html).toContain("const browserjs = async");
    expect(html).toContain("const navigate = async");
    expect(html).toContain("const returnFile =");
    expect(html).toContain("const createOrUpdateArtifact =");
  });

  it("routes sandbox RPC actions to typed handlers", async () => {
    const browserCalls: unknown[] = [];
    const navigateCalls: unknown[] = [];
    const artifactCalls: unknown[] = [];
    const handlers: SandboxHandlers = {
      onBrowserJs: async (payload) => {
        browserCalls.push(payload);
        return "browser-result";
      },
      onNavigate: async (payload) => {
        navigateCalls.push(payload);
        return "navigate-result";
      },
      onArtifacts: async (payload) => {
        artifactCalls.push(payload);
        return payload.action;
      },
    };

    await expect(
      dispatchSandboxRpc("browserjs", { fnSource: "() => 1", args: [1] }, handlers),
    ).resolves.toBe("browser-result");
    await expect(
      dispatchSandboxRpc("navigate", { url: "https://example.com", newTab: true }, handlers),
    ).resolves.toBe("navigate-result");
    await expect(dispatchSandboxRpc("listArtifacts", {}, handlers)).resolves.toBe("list");
    await expect(
      dispatchSandboxRpc("getArtifact", { fileName: "a.txt", asBase64: true }, handlers),
    ).resolves.toBe("get");
    await expect(
      dispatchSandboxRpc(
        "createOrUpdateArtifact",
        { fileName: "a.txt", content: "hello", mimeType: "text/plain" },
        handlers,
      ),
    ).resolves.toBe("upsert");
    await expect(
      dispatchSandboxRpc("deleteArtifact", { fileName: "a.txt" }, handlers),
    ).resolves.toBe("delete");

    expect(browserCalls).toEqual([{ fnSource: "() => 1", args: [1] }]);
    expect(navigateCalls).toEqual([{ url: "https://example.com", newTab: true }]);
    expect(artifactCalls).toEqual([
      { action: "list" },
      { action: "get", fileName: "a.txt", asBase64: true },
      { action: "upsert", fileName: "a.txt", content: "hello", mimeType: "text/plain" },
      { action: "delete", fileName: "a.txt" },
    ]);
  });

  it("rejects unsupported RPC actions", async () => {
    const handlers: SandboxHandlers = {
      onBrowserJs: async () => null,
      onNavigate: async () => null,
      onArtifacts: async () => null,
    };

    await expect(dispatchSandboxRpc("unknown", {}, handlers)).rejects.toThrow(
      "Unknown action: unknown",
    );
  });
});
