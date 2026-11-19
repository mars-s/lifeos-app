import { ConnectPage } from "../components/connect-page";

export default async function ConnectRoute() {
  return (
    <>
      <title>Connect an agent · LifeOS</title>
      <ConnectPage />
    </>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
