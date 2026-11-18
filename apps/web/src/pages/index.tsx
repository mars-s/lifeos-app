import { TodayView } from "../components/today-view";

export default async function TodayPage() {
  return (
    <>
      <title>Today · LifeOS</title>
      <TodayView />
    </>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
