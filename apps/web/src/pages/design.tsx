import { DesignBoard } from "../components/design-board/board";

export default async function DesignPage() {
  return (
    <>
      <title>Design system · LifeOS</title>
      <DesignBoard />
    </>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
