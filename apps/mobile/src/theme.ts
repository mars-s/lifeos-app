export const palette = {
  light: {
    background: "#F9F7F3",
    foreground: "#3E3A36",
    muted: "#8C8781",
    border: "#E9E5DF",
    accent: "#5C6F8A",
    star: "#E9B949",
  },
  dark: {
    background: "#1E1C1A",
    foreground: "#E3E0DB",
    muted: "#99948D",
    border: "#34312E",
    accent: "#97A9C2",
    star: "#D9AE45",
  },
} as const;

export type Palette = (typeof palette)[keyof typeof palette];

export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
} as const;
