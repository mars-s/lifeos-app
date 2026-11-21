import { Accelerometer } from "expo-sensors";

const SHAKE_G = 2.2;
const WINDOW_MS = 700;
const COOLDOWN_MS = 1200;
const JOLTS = 3;

export const shakeDetector = (onShake: () => void) => {
  let jolts: number[] = [];
  let quietUntil = 0;
  return ({ x, y, z }: { x: number; y: number; z: number }, now: number) => {
    if (now < quietUntil || Math.hypot(x, y, z) < SHAKE_G) return;
    jolts = [...jolts.filter((at) => now - at < WINDOW_MS), now];
    if (jolts.length < JOLTS) return;
    jolts = [];
    quietUntil = now + COOLDOWN_MS;
    onShake();
  };
};

export const listenForShake = (onShake: () => void) => {
  const feel = shakeDetector(onShake);
  Accelerometer.setUpdateInterval(60);
  const subscription = Accelerometer.addListener((reading) => feel(reading, Date.now()));
  return () => subscription.remove();
};
