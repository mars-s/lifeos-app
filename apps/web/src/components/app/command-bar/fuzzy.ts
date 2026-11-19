const CONTIGUOUS = 3;
const WORD_START = 2;
const WHOLE_BONUS = 60;
const START_BONUS = 40;

const startsWord = (text: string, at: number) => at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1] ?? "");

const termScore = (term: string, text: string) => {
  const whole = text.indexOf(term);
  if (whole !== -1) return WHOLE_BONUS + term.length * CONTIGUOUS + (startsWord(text, whole) ? START_BONUS : 0) - Math.min(whole, 30) / 3;
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const letter of term) {
    const found = text.indexOf(letter, from);
    if (found === -1) return 0;
    score += found === previous + 1 ? CONTIGUOUS : startsWord(text, found) ? WORD_START : 0;
    previous = found;
    from = found + 1;
  }
  return score >= term.length * 1.5 ? score : 0;
};

export const fuzzyScore = (query: string, text: string) => {
  let total = 0;
  for (const term of query.split(/\s+/)) {
    if (term === "") continue;
    const score = termScore(term, text);
    if (score === 0) return 0;
    total += score;
  }
  return total;
};

export const rank = <T,>(query: string, items: readonly T[], textOf: (item: T) => string, limit: number) => {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return items.slice(0, limit).map((item) => ({ item, score: 1 }));
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = fuzzyScore(wanted, textOf(item));
    if (score > 0) scored.push({ item, score });
  }
  return scored.toSorted((a, b) => b.score - a.score).slice(0, limit);
};
