import { AiBoard } from "../../components/design-board/ai/board";

export default async function AiDesignPage() {
  return (
    <>
      <title>AI · Design · LifeOS</title>
      <main className="min-h-dvh">
        <AiBoard />
      </main>
    </>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
