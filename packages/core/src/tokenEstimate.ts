// Soft token estimate: ~4 characters per token. Counts Unicode code points
// (not UTF-16 code units) so multi-codepoint emoji don't undercount badly.
// Real tokenizer can land in Phase D if the registry needs precise counts.
export function estimateTokens(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return Math.ceil(count / 4);
}
