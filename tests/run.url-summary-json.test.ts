import { describe, expect, it } from "vitest";
import { buildUrlJsonInput } from "../src/run/flows/url/summary-json.js";
import { buildRunJsonEnv } from "../src/shared/run-api-status.js";

describe("run url summary json", () => {
  it("builds preset-length input payloads", () => {
    const input = buildUrlJsonInput({
      url: "https://example.com",
      effectiveMarkdownMode: "readability",
      modelLabel: "openai/gpt-5.4",
      flags: {
        timeoutMs: 42_000,
        youtubeMode: "captions",
        firecrawlMode: "auto",
        format: "markdown",
        transcriptTimestamps: true,
        lengthArg: { kind: "preset", preset: "medium" },
        maxOutputTokensArg: 512,
        outputLanguage: { kind: "code", value: "de" },
      },
    } as never);

    expect(input).toEqual({
      kind: "url",
      url: "https://example.com",
      timeoutMs: 42_000,
      youtube: "captions",
      firecrawl: "auto",
      format: "markdown",
      markdown: "readability",
      timestamps: true,
      length: { kind: "preset", preset: "medium" },
      maxOutputTokens: 512,
      model: "openai/gpt-5.4",
      language: { mode: "fixed", label: undefined, tag: undefined },
    });
  });

  it("builds char-length input payloads and env booleans", () => {
    const input = buildUrlJsonInput({
      url: "https://example.com/page",
      effectiveMarkdownMode: "off",
      modelLabel: null,
      flags: {
        timeoutMs: 1_000,
        youtubeMode: "auto",
        firecrawlMode: "off",
        format: "text",
        transcriptTimestamps: false,
        lengthArg: { kind: "chars", maxCharacters: 9000 },
        maxOutputTokensArg: null,
        outputLanguage: { kind: "auto" },
      },
    } as never);
    expect(input.length).toEqual({ kind: "chars", maxCharacters: 9000 });
    expect(input.language).toEqual({ mode: "auto" });

    expect(
      buildRunJsonEnv({
        xaiApiKey: "x",
        apiKey: null,
        openrouterApiKey: "or",
        apifyToken: null,
        firecrawlConfigured: true,
        googleConfigured: false,
        anthropicConfigured: true,
      }),
    ).toEqual({
      hasXaiKey: true,
      hasOpenAIKey: false,
      hasOpenRouterKey: true,
      hasApifyToken: false,
      hasFirecrawlKey: true,
      hasGoogleKey: false,
      hasAnthropicKey: true,
    });
  });
});
