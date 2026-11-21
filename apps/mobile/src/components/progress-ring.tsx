import Svg, { Circle, Path } from "react-native-svg";

const SIZE = 18;
const CENTRE = SIZE / 2;
const RADIUS = 5.5;

const wedge = (value: number) => {
  const turn = Math.min(Math.max(value, 0), 0.9999) * Math.PI * 2;
  const x = Math.round((CENTRE + RADIUS * Math.sin(turn)) * 100) / 100;
  const y = Math.round((CENTRE - RADIUS * Math.cos(turn)) * 100) / 100;
  return `M ${CENTRE} ${CENTRE} L ${CENTRE} ${CENTRE - RADIUS} A ${RADIUS} ${RADIUS} 0 ${turn > Math.PI ? 1 : 0} 1 ${x} ${y} Z`;
};

export const ProgressRing = ({ value, colour }: { value: number; colour: string }) => (
  <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Circle cx={CENTRE} cy={CENTRE} r={8} stroke={colour} strokeWidth={1.5} fill="none" />
    {value > 0 ? <Path d={wedge(value)} fill={colour} /> : null}
  </Svg>
);
