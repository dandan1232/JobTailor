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

/** These are review cues, not a factual verification of the revised resume. */
export function reviewResumeChanges(original: string, revised: string) {
  const originalLines = new Set(original.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const revisedLines = new Set(revised.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  return {
    addedNumbers: additions(original, revised, numberPattern, (value) => value.replace(/\s/g, "")),
    addedTerms: additions(original, revised, termPattern, (value) => value.toLowerCase()).filter((value) => !commonWords.has(value.toLowerCase())),
    lines: revised.split(/\r?\n/).map((text) => ({ text, changed: Boolean(text.trim()) && !originalLines.has(text.trim()) })),
    originalLines: original.split(/\r?\n/).map((text) => ({ text, changed: Boolean(text.trim()) && !revisedLines.has(text.trim()) })),
  };
}
