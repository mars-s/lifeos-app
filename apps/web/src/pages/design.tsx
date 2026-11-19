import { DesignBoard } from "../components/design-board/board";
import { activitySample } from "../components/design-board/review-samples";

export default async function DesignPage() {
  return (
    <>
      <title>Design system · LifeOS</title>
      <main className="min-h-dvh">
        <DesignBoard activity={activitySample()} />
      </main>
    </>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
