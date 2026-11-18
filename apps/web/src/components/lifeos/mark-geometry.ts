export const MARK = {
  box: 32,
  columns: 3,
  span: 17,
  radius: 3.3,
  filled: 4,
  tileRadius: 7.2,
} as const;

export const markDots = () => {
  const step = MARK.span / (MARK.columns - 1);
  const origin = (MARK.box - MARK.span) / 2;
  return Array.from({ length: MARK.columns ** 2 }, (_, index) => ({
    cx: origin + (index % MARK.columns) * step,
    cy: origin + Math.floor(index / MARK.columns) * step,
    filled: index < MARK.filled,
  }));
};
