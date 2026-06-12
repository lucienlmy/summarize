import { describe, expect, it } from "vitest";
import {
  filterOpenRouterFreeModels,
  inferParamBFromIdOrName,
  parseOpenRouterCatalog,
  rankOpenRouterModelsForBenchmark,
  type OpenRouterModelEntry,
} from "../src/refresh-free/catalog.js";

function model(id: string, overrides: Partial<OpenRouterModelEntry> = {}): OpenRouterModelEntry {
  return {
    id,
    contextLength: null,
    maxCompletionTokens: null,
    supportedParametersCount: 0,
    modality: null,
    inferredParamB: null,
    createdAtMs: null,
    ...overrides,
  };
}

describe("refresh-free catalog", () => {
  it("infers the largest parameter size from common model names", () => {
    expect(inferParamBFromIdOrName("vendor/model-e2b:free")).toBe(2);
    expect(inferParamBFromIdOrName("vendor/model-1.5b:free")).toBe(1.5);
    expect(inferParamBFromIdOrName("mix-8b-and-70b")).toBe(70);
    expect(inferParamBFromIdOrName("model-without-size")).toBeNull();
  });

  it("normalizes catalog metadata and ignores malformed entries", () => {
    expect(
      parseOpenRouterCatalog({
        data: [
          null,
          { id: " " },
          {
            id: " vendor/model-70b:free ",
            name: "Model 70B",
            context_length: 131_072,
            created: 100,
            top_provider: { max_completion_tokens: 8192 },
            supported_parameters: ["temperature", "", 12, "max_tokens"],
            architecture: { modality: " text->text " },
          },
        ],
      }),
    ).toEqual([
      {
        id: "vendor/model-70b:free",
        contextLength: 131_072,
        maxCompletionTokens: 8192,
        supportedParametersCount: 2,
        modality: "text->text",
        inferredParamB: 70,
        createdAtMs: 100_000,
      },
    ]);
    expect(parseOpenRouterCatalog(null)).toEqual([]);
    expect(parseOpenRouterCatalog({ data: "invalid" })).toEqual([]);
  });

  it("reports age and size exclusions separately", () => {
    const day = 24 * 60 * 60 * 1000;
    const result = filterOpenRouterFreeModels(
      [
        model("paid"),
        model("old-70b:free", { inferredParamB: 70, createdAtMs: day }),
        model("small-7b:free", { inferredParamB: 7, createdAtMs: 9 * day }),
        model("unknown:free", { createdAtMs: 9 * day }),
        model("large-70b:free", { inferredParamB: 70, createdAtMs: 9 * day }),
      ],
      { maxAgeDays: 2, minParamB: 27, nowMs: 10 * day },
    );

    expect(result.freeModels.map((entry) => entry.id)).toEqual(["unknown:free", "large-70b:free"]);
    expect(result.ageFilteredIds).toEqual(["old-70b:free"]);
    expect(result.smallFilteredIds).toEqual(["small-7b:free"]);
  });

  it("orders benchmark candidates by freshness, capacity, features, then id", () => {
    const ranked = rankOpenRouterModelsForBenchmark([
      model("d:free", { createdAtMs: 2, contextLength: 10 }),
      model("c:free", { createdAtMs: 2, contextLength: 20, maxCompletionTokens: 10 }),
      model("b:free", {
        createdAtMs: 2,
        contextLength: 20,
        maxCompletionTokens: 20,
        supportedParametersCount: 1,
      }),
      model("a:free", {
        createdAtMs: 2,
        contextLength: 20,
        maxCompletionTokens: 20,
        supportedParametersCount: 1,
      }),
      model("newest:free", { createdAtMs: 3 }),
    ]);

    expect(ranked.map((entry) => entry.id)).toEqual([
      "newest:free",
      "a:free",
      "b:free",
      "c:free",
      "d:free",
    ]);
  });
});
