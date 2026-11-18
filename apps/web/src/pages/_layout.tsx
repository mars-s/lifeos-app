import "../styles.css";
import type { ReactNode } from "react";
import { ConvexClientProvider } from "../components/convex-client-provider";

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ConvexClientProvider>
      <meta name="description" content="A calm place to plan the day." />
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      <main className="min-h-dvh">{children}</main>
    </ConvexClientProvider>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
