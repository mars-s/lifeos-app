import type { ReactNode } from "react";
import { KitProvider, useKit, type ThemeOverrides } from "@/lib/kit";

export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  mono: "GeistMono_400Regular",
  monoMedium: "GeistMono_500Medium",
} as const;

const calm = {
  light: {
    background: "#F7F4EF",
    foreground: "#282521",
    card: "#FEFCF9",
    cardForeground: "#282521",
    popover: "#FFFFFF",
    muted: "#EEEBE5",
    mutedForeground: "#67635D",
    border: "#E6E3DD",
    input: "#BDB9B2",
    primary: "#282521",
    primaryForeground: "#F7F4EF",
    secondary: "#EEEBE5",
    secondaryForeground: "#282521",
    accent: "#186BC5",
    accentForeground: "#FDFCF9",
    ring: "#186BC5",
    success: "#298646",
    warning: "#B0660C",
    danger: "#C9302D",
    dangerForeground: "#FDFCF9",
  },
  dark: {
    background: "#121314",
    foreground: "#E6E8EB",
    card: "#1A1B1D",
    cardForeground: "#E6E8EB",
    popover: "#292A2D",
    muted: "#1A1B1D",
    mutedForeground: "#999B9F",
    border: "#252628",
    input: "#55575B",
    primary: "#E6E8EB",
    primaryForeground: "#121314",
    secondary: "#292A2D",
    secondaryForeground: "#E6E8EB",
    accent: "#5DADFC",
    accentForeground: "#0C0D0F",
    ring: "#5DADFC",
    success: "#5FD37F",
    warning: "#F0BA59",
    danger: "#FD736D",
    dangerForeground: "#0C0D0F",
  },
} satisfies ThemeOverrides["colors"];

export const planner = {
  light: {
    surface: "#EEEBE5",
    surfaceInset: "#FEFCF9",
    surfaceRaised: "#E2DFD9",
    faintForeground: "#96918C",
    deadline: "#B0660C",
    area: {
      violet: "#8362CD",
      green: "#2C965D",
      orange: "#D97230",
      teal: "#0D9298",
      rose: "#D7506E",
      olive: "#848E2D",
      plum: "#A84D97",
      slate: "#657383",
    },
  },
  dark: {
    surface: "#1A1B1D",
    surfaceInset: "#0C0D0F",
    surfaceRaised: "#292A2D",
    faintForeground: "#616367",
    deadline: "#F0BA59",
    area: {
      violet: "#B199F4",
      green: "#68CD8F",
      orange: "#F7A062",
      teal: "#5AC8CD",
      rose: "#F78C9E",
      olive: "#B5C062",
      plum: "#D98DC9",
      slate: "#97A7B7",
    },
  },
} as const;

export const usePlanner = () => planner[useKit().dark ? "dark" : "light"];

export const AppTheme = ({ children }: { children: ReactNode }) => (
  <KitProvider scheme="system" radius={12} fontFamily={fonts.regular} colors={calm}>
    {children}
  </KitProvider>
);
