import "../styles.css";
import type { ReactNode } from "react";
import { ConvexClientProvider } from "../components/convex-client-provider";

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ConvexClientProvider>
      <meta name="description" content="A calm place to plan the day." />
      <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ecebe6" />
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1b1c20" />
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      {children}
    </ConvexClientProvider>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
