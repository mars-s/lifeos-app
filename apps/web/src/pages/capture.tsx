import { CaptureWindow } from "../components/app/capture-window";

export default async function CaptureRoute() {
  return <CaptureWindow />;
}

export const getConfig = async () => ({ render: "static" }) as const;
