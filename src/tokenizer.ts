import { countTokens as countBpeTokens } from "bpe-lite";

const DISALLOWED_SPECIAL_TOKENS = [
  "<|endoftext|>",
  "<|fim_prefix|>",
  "<|fim_middle|>",
  "<|fim_suffix|>",
  "<|im_start|>",
  "<|im_end|>",
  "<|im_sep|>",
  "<|endofprompt|>",
] as const;

export function countTokens(text: string): number {
  let firstSpecial: { index: number; token: string } | null = null;
  for (const token of DISALLOWED_SPECIAL_TOKENS) {
    const index = text.indexOf(token);
    if (index >= 0 && (!firstSpecial || index < firstSpecial.index)) {
      firstSpecial = { index, token };
    }
  }
  if (firstSpecial) {
    throw new Error(`Disallowed special token found: ${firstSpecial.token}`);
  }
  return countBpeTokens(text, "openai-o200k");
}
