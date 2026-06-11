import { describe, expect, it } from "vitest";
import { countTokens } from "../src/tokenizer.js";

describe("countTokens", () => {
  it.each([
    ["", 0],
    ["Hello, world!", 4],
    ["The quick brown fox jumps over the lazy dog.", 10],
    ["你好，世界！こんにちは世界。안녕하세요 세계", 10],
    ["مرحبا بالعالم", 4],
    ["👨‍👩‍👧‍👦 🧑🏽‍💻 🇺🇸 🏳️‍🌈", 30],
    ["const data = await fetch('/api/items').then((response) => response.json());", 17],
    ['{"hello":"world","nested":[1,2,3],"emoji":"🔥"}', 17],
    ["\u0000\u0001\u001b[31mred\u001b[0m", 11],
    ["  leading\n\ntrailing\t  ", 6],
  ])("matches o200k token counts for %j", (text, expected) => {
    expect(countTokens(text)).toBe(expected);
  });

  it.each(["<|endoftext|>", "before <|im_start|> after", "<|endofprompt|>"])(
    "preserves special-token rejection for %s",
    (text) => {
      expect(() => countTokens(text)).toThrow(/Disallowed special token found/u);
    },
  );

  it("reports the first special token in source order", () => {
    expect(() => countTokens("<|im_start|> then <|endoftext|>")).toThrow(
      "Disallowed special token found: <|im_start|>",
    );
  });
});
