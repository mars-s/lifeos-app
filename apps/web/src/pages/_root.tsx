import type { ReactNode } from "react";

export default async function RootElement({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <head />
      <body>{children}</body>
    </html>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
