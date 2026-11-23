import type { ViewStyle } from "react-native";
import { useKit } from "@/lib/kit";

const light = {
  primary: {
    backgroundImage: "linear-gradient(0deg, #262422 0%, #4a4743 100%)",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.5)",
    boxShadow: "0px 1px 2px 0px rgba(40,30,20,0.22)",
  },
  primaryInk: "#f7f5f0",
  secondary: { backgroundImage: "linear-gradient(180deg, #e6e2da 0%, #eeeae3 100%)" },
  raised: { boxShadow: "inset 0px 1px 0px rgba(255,255,255,0.55), 0px 1px 2px rgba(60,45,25,0.18)" },
  well: { boxShadow: "inset 0px 1px 2px rgba(60,45,25,0.14)" },
  recessed: { boxShadow: "inset 0px 1px 2px rgba(0,0,0,0.14)" },
  lift: { boxShadow: "0px 1px 1px rgba(60,45,25,0.06), 0px 10px 24px -10px rgba(60,45,25,0.28)" },
  float: { boxShadow: "0px 1px 1px rgba(60,45,25,0.05), 0px 18px 44px -14px rgba(60,45,25,0.32)" },
  thumbOn: { backgroundImage: "linear-gradient(180deg, #ffffff 0%, #e2e2e2 100%)", boxShadow: "0px 2px 3px rgba(0,0,0,0.18)" },
  thumbOff: { backgroundImage: "linear-gradient(180deg, #ffffff 0%, #e2e2e2 100%)", boxShadow: "0px 2px 3px rgba(0,0,0,0.18)" },
} satisfies Record<string, ViewStyle | string>;

const dark = {
  primary: {
    backgroundImage: "linear-gradient(0deg, #ffffff 0%, #ababab 100%)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.5)",
    boxShadow: "0px 1px 2px 0px rgba(0,0,0,0.1)",
  },
  primaryInk: "#111111",
  secondary: { backgroundImage: "linear-gradient(180deg, #1f2023 0%, #28292d 100%)" },
  raised: { boxShadow: "inset 0px 1px 0px rgba(255,255,255,0.07), 0px 1px 2px rgba(0,0,0,0.45)" },
  well: { boxShadow: "inset 0px 1px 2px rgba(0,0,0,0.5)" },
  recessed: { boxShadow: "inset 0px 1px 2px rgba(0,0,0,0.5)" },
  lift: { boxShadow: "0px 1px 1px rgba(0,0,0,0.3), 0px 10px 24px -10px rgba(0,0,0,0.75)" },
  float: { boxShadow: "0px 1px 1px rgba(0,0,0,0.3), 0px 18px 44px -14px rgba(0,0,0,0.8)" },
  thumbOn: { backgroundImage: "linear-gradient(180deg, #ffffff 0%, #e2e2e2 100%)", boxShadow: "0px 2px 3px rgba(0,0,0,0.18)" },
  thumbOff: { backgroundImage: "linear-gradient(180deg, #a8a8a8 0%, #7a7a7a 100%)", boxShadow: "0px 2px 3px rgba(0,0,0,0.18)" },
} satisfies typeof light;

export type Tactile = typeof light;

export const tactile = { light, dark } as const;

export const useTactile = () => tactile[useKit().dark ? "dark" : "light"];
