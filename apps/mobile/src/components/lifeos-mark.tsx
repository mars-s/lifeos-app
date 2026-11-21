import Svg, { Circle } from "react-native-svg";

const BOX = 32;
const COLUMNS = 3;
const SPAN = 17;
const RADIUS = 3.3;
const FILLED = 4;
const STEP = SPAN / (COLUMNS - 1);
const ORIGIN = (BOX - SPAN) / 2;

const DOTS = Array.from({ length: COLUMNS ** 2 }, (_, index) => ({
  cx: ORIGIN + (index % COLUMNS) * STEP,
  cy: ORIGIN + Math.floor(index / COLUMNS) * STEP,
  filled: index < FILLED,
}));

export const LifeosMark = ({ size, ink, quiet }: { size: number; ink: string; quiet: string }) => (
  <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {DOTS.map((dot) => (
      <Circle key={`${dot.cx}:${dot.cy}`} cx={dot.cx} cy={dot.cy} r={RADIUS} fill={dot.filled ? ink : quiet} />
    ))}
  </Svg>
);
