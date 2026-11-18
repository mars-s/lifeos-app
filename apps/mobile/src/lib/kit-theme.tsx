import type { ReactNode } from "react";
import { KitProvider, type ThemeOverrides } from "@/lib/kit";

export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
} as const;

const calm = {
  light: {
    background: "#F9F7F3",
    foreground: "#3E3A36",
    card: "#FDFCFA",
    cardForeground: "#3E3A36",
    popover: "#FDFCFA",
    muted: "#F1EEE9",
    mutedForeground: "#8C8781",
    border: "#E9E5DF",
    input: "#E4E0DA",
    primary: "#3E3A36",
    primaryForeground: "#F9F7F3",
    secondary: "#F1EEE9",
    secondaryForeground: "#3E3A36",
    warning: "#E9B949",
  },
  dark: {
    background: "#1E1C1A",
    foreground: "#E3E0DB",
    card: "#252321",
    cardForeground: "#E3E0DB",
    popover: "#252321",
    muted: "#2C2A27",
    mutedForeground: "#99948D",
    border: "#34312E",
    input: "#3A3734",
    primary: "#E3E0DB",
    primaryForeground: "#1E1C1A",
    secondary: "#2C2A27",
    secondaryForeground: "#E3E0DB",
    accent: "#97A9C2",
    ring: "#97A9C2",
    warning: "#D9AE45",
  },
} satisfies ThemeOverrides["colors"];

export const AppTheme = ({ children }: { children: ReactNode }) => (
  <KitProvider scheme="system" accent="#5C6F8A" radius={10} fontFamily={fonts.regular} colors={calm}>
    {children}
  </KitProvider>
);
