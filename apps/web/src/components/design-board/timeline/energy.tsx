"use client";

import { EnergyLane as Lane, EnergySpark as Spark, type EnergyCurve } from "@/components/lifeos/energy-curve";
import { BEDTIME, DIP_AT, energyAt, PEAK_AT, type EnergyMode } from "./model";

const curveOf = (quality: number) =>
  ({
    points: Array.from({ length: 24 * 12 + 1 }, (_, index) => ({ minute: index * 5, level: energyAt(index * 5, quality) })),
    peak: { start: PEAK_AT, end: PEAK_AT },
    dip: { start: DIP_AT, end: DIP_AT },
    bedtime: BEDTIME,
  }) satisfies EnergyCurve;

export const EnergyLane = ({
  quality,
  ...props
}: {
  from: number;
  to: number;
  scale: number;
  now: number;
  width: number;
  quality: number;
  mode: EnergyMode;
  className?: string;
}) => <Lane curve={curveOf(quality)} {...props} />;

const SPARK = { from: 7 * 60, to: 22 * 60 } as const;

export const EnergySpark = ({ quality, ...props }: { quality: number; mode: EnergyMode; now: number; className?: string }) => {
  const curve = curveOf(quality);
  return <Spark curve={{ ...curve, points: curve.points.filter((point) => point.minute >= SPARK.from && point.minute <= SPARK.to) }} {...props} />;
};
