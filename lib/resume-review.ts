const numberPattern = /\d+(?:[.,]\d+)*(?:\s*[%％])?/g;
const termPattern = /[A-Za-z][A-Za-z\d]*(?:[.+#-][A-Za-z\d]+|\+\+|#)*/g;
const commonWords = new Set(["a", "an", "the", "and", "or", "to", "for", "with", "of", "in", "on", "at", "by", "is", "was", "as", "i", "we"]);

function additions(original: string, revised: string, pattern: RegExp, normalize: (value: string) => string) {
  const existing = new Set((original.match(pattern) ?? []).map(normalize));
  const seen = new Set<string>();
  return (revised.match(pattern) ?? []).filter((value) => {
    const key = normalize(value);
    if (existing.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function markChangedLines(text: string, comparison: string) {
  const remaining = new Map<string, number>();
  for (const line of comparison.split(/\r?\n/)) {
    const key = line.trim();
    if (key) remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return text.split(/\r?\n/).map((text) => {
    const key = text.trim();
    const count = remaining.get(key) ?? 0;
    if (count) remaining.set(key, count - 1);
    return { text, changed: Boolean(key) && count === 0 };
  });
}

/** These are review cues, not a factual verification of the revised resume. */
export function reviewResumeChanges(original: string, revised: string) {
  return {
    addedNumbers: additions(original, revised, numberPattern, (value) => value.replace(/\s/g, "")),
    addedTerms: additions(original, revised, termPattern, (value) => value.toLowerCase()).filter((value) => !commonWords.has(value.toLowerCase())),
    lines: markChangedLines(revised, original),
    originalLines: markChangedLines(original, revised),
  };
}
