import { NotesBoard } from "../../components/design-board/notes/board";

export default async function NotesDesignPage() {
  return (
    <>
      <title>Notes · Design · LifeOS</title>
      <main className="min-h-dvh">
        <NotesBoard />
      </main>
    </>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
