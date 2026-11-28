import { WidgetsBoard } from "../../components/design-board/widgets/board";

export default async function WidgetsDesignPage() {
  return (
    <>
      <title>Widgets · Design · LifeOS</title>
      <main className="min-h-dvh">
        <WidgetsBoard />
      </main>
    </>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
