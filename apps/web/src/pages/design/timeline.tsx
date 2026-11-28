import { TimelineBoard } from "../../components/design-board/timeline/board";

export default async function TimelineDesignPage() {
  return (
    <>
      <title>Timeline · Design · LifeOS</title>
      <main className="min-h-dvh">
        <TimelineBoard />
      </main>
    </>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
