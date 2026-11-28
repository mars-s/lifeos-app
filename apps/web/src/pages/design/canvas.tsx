import { CanvasBoard } from "../../components/design-board/canvas/board";

export default async function CanvasDesignPage() {
  return (
    <>
      <title>Canvas · Design · LifeOS</title>
      <main className="min-h-dvh">
        <CanvasBoard />
      </main>
    </>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
