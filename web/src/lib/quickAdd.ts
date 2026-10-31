/** A `#label` word: letters, digits, `_` and `-`, within the server's 64-character limit. */
const LABEL = /^#([\p{L}\p{N}_-]{1,64})$/u;

/**
 * Splits quick-add text into a title and `#labels` (deduplicated ignoring case, first spelling kept). Text that is
 * only labels becomes the title unparsed, so "#next" alone is a task called "#next".
 */
export function parseQuickAdd(text: string): { title: string; labels: string[] } {
  const words: string[] = [];
  const labels: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const name = LABEL.exec(word)?.[1];
    if (!name) words.push(word);
    else if (!labels.some((l) => l.toLowerCase() === name.toLowerCase())) labels.push(name);
  }
  if (!words.length) return { title: text.trim(), labels: [] };
  return { title: words.join(" "), labels };
}
