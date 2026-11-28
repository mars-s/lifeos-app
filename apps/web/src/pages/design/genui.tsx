import { GenuiBoard } from "../../components/design-board/genui/board";

export default async function GenuiDesignPage() {
  return (
    <>
      <title>GenUI · Design · LifeOS</title>
      <main className="min-h-dvh">
        <GenuiBoard />
      </main>
    </>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
